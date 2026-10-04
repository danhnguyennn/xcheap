import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import session from 'express-session';
// Named import, not the default — esbuild's CJS bundling of this external
// package (dist/server.cjs, built via `--packages=external`) forces a
// default import's `.default` to resolve to the whole required module
// object instead of connect-mongo's own inner class, even though the
// package itself sets `__esModule` and a correct `.default` (tsx's own dev
// loader doesn't have this quirk, which is why this only broke in the
// production Docker build, never in `npm run dev`). The named export isn't
// affected by that interop ambiguity.
import { MongoStore } from 'connect-mongo';
import type { Request, Response, NextFunction } from 'express';
import { db } from './mongodb';
import { User, UserRole } from '../src/types';

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    // The account's authVersion at the moment this session was created.
    authVersion?: number;
  }
}

const SALT_ROUNDS = 10;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// Generates a real, unique per-account API key — used both for a brand new
// account and to backfill any account created before this feature existed.
export function generateApiKey(): string {
  return 'xck_' + crypto.randomBytes(24).toString('hex');
}

// A User document carries `passwordHash` and `apiKey` internally — both are
// stripped before the document is ever put on an HTTP response. apiKey is
// only ever re-attached on a user's own /api/user/me response (see
// server.ts) — every other route that lists or returns other accounts
// (e.g. the admin user list) must never leak it.
export function toPublicUser(user: User): Omit<User, 'passwordHash' | 'apiKey' | 'authVersion'> {
  const { passwordHash, apiKey, authVersion, ...publicUser } = user;
  return publicUser;
}

export function sessionMiddleware() {
  const secret = process.env.SESSION_SECRET || 'xcheap_dev_session_secret_ai_studio_2026_fallback';
  if (!process.env.SESSION_SECRET) {
    console.warn('[auth] SESSION_SECRET is not set in environment. Using fallback development session secret.');
  }

  // Without a persistent store, express-session falls back to MemoryStore —
  // sessions live only in this process's RAM, so every deploy/restart (e.g.
  // `npm run build` + restarting the server) wipes every logged-in user's
  // session at once, even though their browser still holds a now-orphaned
  // cookie (getSessionUser's req.session.userId lookup just comes back
  // empty, which reads the same as never having logged in). Persisting
  // sessions in the same MongoDB the rest of the app already uses means a
  // restart no longer logs anyone out. Falls back to MemoryStore only when
  // no MONGODB_URI is configured at all (local/offline dev), matching how
  // MongoDBEngine itself degrades to in-memory mode in server/mongodb.ts.
  const mongoUrl = process.env.MONGODB_URI;
  let store: session.Store | undefined;
  if (mongoUrl) {
    store = MongoStore.create({
      mongoUrl,
      dbName: process.env.MONGODB_DB_NAME || 'xscr_store_db',
      collectionName: 'sessions',
      ttl: 60 * 60 * 24 * 7, // matches cookie.maxAge below (seconds, not ms)
    });
    store.on('error', (err) => {
      console.warn('[auth] Session store (MongoDB) error — falling back to in-memory sessions for this process:', err);
    });
  } else {
    console.warn('[auth] MONGODB_URI is not set. Sessions will use in-memory storage and will NOT survive a server restart.');
  }

  return session({
    secret,
    store,
    resave: false,
    saveUninitialized: false,
    // Rolling: every authenticated request pushes maxAge back out, so an
    // account in active use never gets logged out mid-session — only
    // genuinely idle sessions expire.
    rolling: true,
    cookie: {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days of inactivity
      sameSite: 'lax',
      // 'auto' defers to req.secure instead of a hardcoded true/false. A
      // flat `true` here silently broke logins: the hop between cloudflared
      // and this container is plain HTTP, so with NODE_ENV=production
      // forcing secure:true unconditionally, the browser dropped the
      // Set-Cookie on login whenever it didn't see the original connection
      // as HTTPS — the login response still looked successful, but no
      // session was ever actually stored. 'auto' + app.set('trust proxy', 1)
      // in server.ts (so req.secure reflects cloudflared's
      // X-Forwarded-Proto) fixes it while still requiring real HTTPS.
      secure: 'auto',
    },
  });
}

// Pulls an API key out of either an `Authorization: Bearer <key>` header or
// a plain `X-API-Key` header — whichever a script sends.
function extractApiKey(req: Request): string | null {
  const authHeader = req.headers['authorization'];
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const key = authHeader.slice('Bearer '.length).trim();
    if (key) return key;
  }
  const headerKey = req.headers['x-api-key'];
  if (typeof headerKey === 'string' && headerKey.trim()) return headerKey.trim();
  return null;
}

// Looks up the logged-in user from the browser session cookie — or, when
// there's no session (a script calling the API directly rather than a
// signed-in browser tab), from a per-account API key sent as
// `Authorization: Bearer <key>` or `X-API-Key`. Every route that already
// calls this picks up API-key auth for free, with no per-route changes.
export async function getSessionUser(req: Request): Promise<User | null> {
  const userCol = db.collection<User>('users');

  const userId = req.session.userId;
  if (userId) {
    const user = await userCol.findOne({ id: userId });
    // A session created before the password was last changed carries an older
    // authVersion and no longer counts as logged in — that's how "change
    // password" signs every OTHER device out. Sessions from before this field
    // existed have none, which reads as 0 and matches accounts that have never
    // changed their password.
    if (user && (req.session.authVersion ?? 0) === (user.authVersion ?? 0)) return user;
  }

  const apiKey = extractApiKey(req);
  if (apiKey) {
    return userCol.findOne({ apiKey });
  }

  return null;
}

// Express middleware: 401s any request without a valid session.
export function requireAuth() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = await getSessionUser(req);
    if (!user) return res.status(401).json({ error: 'Vui lòng đăng nhập' });
    next();
  };
}

// Express middleware: 401s when logged out, 403s when logged in as a role
// not in the allow-list. This is what replaces the old free-for-all role
// switcher — access is now decided by the account you're actually logged
// into, not a button anyone could click.
export function requireRole(...roles: UserRole[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = await getSessionUser(req);
    if (!user) return res.status(401).json({ error: 'Vui lòng đăng nhập' });
    if (!roles.includes(user.role)) {
      return res.status(403).json({ error: 'Bạn không có quyền truy cập chức năng này' });
    }
    next();
  };
}
