import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import session from 'express-session';
import type { Request, Response, NextFunction } from 'express';
import { db } from './mongodb';
import { User, UserRole } from '../src/types';

declare module 'express-session' {
  interface SessionData {
    userId?: string;
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
export function toPublicUser(user: User): Omit<User, 'passwordHash' | 'apiKey'> {
  const { passwordHash, apiKey, ...publicUser } = user;
  return publicUser;
}

export function sessionMiddleware() {
  const secret = process.env.SESSION_SECRET || 'xcheap_dev_session_secret_ai_studio_2026_fallback';
  if (!process.env.SESSION_SECRET) {
    console.warn('[auth] SESSION_SECRET is not set in environment. Using fallback development session secret.');
  }

  return session({
    secret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
      sameSite: 'lax',
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
    if (user) return user;
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
