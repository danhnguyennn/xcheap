import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import path from 'path';
import { cryptoOptions } from './src/data/storeData';
import { getVipTier } from './src/data/vipTiers';
import { User, UserRole, Product, Order, PreOrder, AdminNotification, DepositTransaction, CryptoNetwork, CryptoOption, WithdrawalRequest, CtvStats, Category, Voucher, Review, ReviewSuggestion, Language, CtvDeduction, AdminAuditLogEntry, WarrantyClaim } from './src/types';
import { db, generateObjectId, MongoCollection, inventoryUsernameKey } from './server/mongodb';
import { getOrCreateUserWallet, ensureUserDepositWallets } from './server/walletVault';
import { sessionMiddleware, getSessionUser, requireAuth, requireRole, hashPassword, verifyPassword, toPublicUser, generateApiKey } from './server/auth';
import { ethers } from 'ethers';
import helmet from 'helmet';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { twitterChecker } from './server/twitterChecker';
import { getChainHead, scanIncomingTransfers, IncomingTransfer, QUICK_RETRY_DELAYS_MS } from './server/chainTransfers';

const app = express();
const PORT = 3434;

// The app is only ever reached through cloudflared (see docker-compose.yml —
// no host port is published), so trusting exactly one hop of X-Forwarded-*
// headers is safe: cloudflared is the only thing that can ever set them.
// This is what lets Express see the real client IP (req.ip, used by the
// login rate limiter below) and the real original protocol (req.secure,
// used by the session cookie's "secure: auto" — see server/auth.ts) instead
// of the internal plain-HTTP hop between cloudflared and this container.
app.set('trust proxy', 1);

// Express 4 does not catch a rejected promise from an async route handler:
// any DB hiccup or thrown error inside one becomes an unhandled rejection,
// which on Node 20 terminates the whole process (every user offline, the
// request never answered). Wrap every handler/middleware registered through
// get/post/put/delete so a rejection is forwarded to the error handler
// installed just before listen() instead. Error-handling middleware (arity 4)
// is left alone.
for (const method of ['get', 'post', 'put', 'delete', 'patch'] as const) {
  const original = (app as any)[method].bind(app);
  (app as any)[method] = (routePath: any, ...handlers: any[]) => {
    if (handlers.length === 0) return original(routePath); // app.get('setting')
    return original(
      routePath,
      ...handlers.map((h) =>
        typeof h === 'function' && h.length < 4
          ? (req: express.Request, res: express.Response, next: express.NextFunction) => Promise.resolve(h(req, res, next)).catch(next)
          : h
      )
    );
  };
}

// Standard production security headers (X-Content-Type-Options, X-Frame-
// Options, Strict-Transport-Security, etc). crossOriginEmbedderPolicy is
// off because it would block the Turnstile iframe entirely.
//
// The CSP itself is production-only: Vite's dev middleware (HMR client,
// React Fast Refresh) needs eval and an inline-script/websocket connection
// to the dev server that a real CSP would legitimately block, and that
// looseness would never reflect what a built production bundle actually
// needs anyway. The production bundle is a single external module script
// with no inline scripts or eval, so the strict policy below costs it
// nothing. Scoped to exactly what this app loads: same-origin
// scripts/styles, inline styles (Tailwind's runtime + component style
// attrs), and Cloudflare Turnstile's script + the frame it renders the
// challenge widget in.
const isProd = process.env.NODE_ENV === 'production';
app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: isProd
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", 'https://challenges.cloudflare.com'],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:', 'blob:'],
            connectSrc: ["'self'", 'https://challenges.cloudflare.com'],
            frameSrc: ['https://challenges.cloudflare.com'],
            objectSrc: ["'none'"],
          },
        }
      : false,
  })
);

// Default 50mb is too small for CTV/admin bulk stock imports (pasting a
// few thousand account lines easily exceeds it) — 10mb gives generous
// headroom while still bounding request size sanely.
app.use(express.json({ limit: '50mb' }));
app.use(sessionMiddleware() as any);

// Brute-force guard on login specifically — 10 attempts per IP per 15
// minutes, counting only failed attempts (a run of correct logins from a
// shared office IP should never trip this). Turnstile already screens out
// pure bots; this is the second layer that also limits a human (or a
// token-solving service) hammering real password guesses.
const loginRateLimiter = rateLimit({
  windowMs: 30 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  // Keyed by IP + the account being attempted (not IP alone) — a shared
  // office/NAT IP with several real users logging into their own separate
  // accounts should never trip this, but 5 failed guesses against one
  // specific account from one specific IP does. ipKeyGenerator normalizes
  // IPv6 addresses (collapses a /56 down to one key) so an attacker can't
  // dodge the limit by cycling through addresses within their own subnet.
  keyGenerator: (req) => {
    const identifier = typeof req.body?.identifier === 'string' ? req.body.identifier.trim().toLowerCase() : '';
    return `${ipKeyGenerator(req.ip || '')}:${identifier}`;
  },
  message: { error: 'Quá nhiều lần đăng nhập thất bại. Vui lòng thử lại sau 30 phút.' },
});

// Guard against mass account-creation spam — keyed by IP alone (unlike
// login, a registration bot varies the username/email on every attempt, so
// keying by account would never catch it). Every attempt counts, successful
// or not: creating many accounts is itself the abuse being limited, not just
// failed attempts.
const registerRateLimiter = rateLimit({
  windowMs: 30 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip || ''),
  message: { error: 'Quá nhiều lần đăng ký. Vui lòng thử lại sau 30 phút.' },
});

// Serializes concurrent /api/deposit/check-rpc calls per user+network so two
// requests in flight at once can never both credit the same on-chain delta.
// Safe to be in-memory: it only needs to hold for the lifetime of overlapping
// requests, not across restarts (a restart has no in-flight requests to race).
const depositCheckInProgress = new Set<string>();

// "Online now" count for the admin dashboard — keyed by real account id
// (from the session, not a client-supplied value), so the same account open
// across several tabs/browsers/devices still only ever counts once, and a
// guest with no session never counts at all. This also closes what the old
// client-generated-visitorId design let anyone do: spam the ping endpoint
// with random ids to inflate the count arbitrarily — a session can't be
// forged the same way. In-memory by design: this is a live "right now"
// figure, not historical data worth persisting across a restart.
const ONLINE_WINDOW_MS = 60 * 1000;
const lastSeenByUserId = new Map<string, number>();

function countOnlineUsers(): number {
  const cutoff = Date.now() - ONLINE_WINDOW_MS;
  let count = 0;
  for (const [userId, lastSeen] of lastSeenByUserId) {
    if (lastSeen < cutoff) {
      lastSeenByUserId.delete(userId);
    } else {
      count++;
    }
  }
  return count;
}

// Caps how many random inventory samples a visitor can pull for a single
// product before cooling down — without this, the "xem mẫu ngẫu nhiên"
// button could be used to enumerate real usernames out of the warehouse in
// bulk just by re-rolling repeatedly. Keyed by account id (or IP for a
// guest) + productId. The first few views each day are immediate; once
// those are used up, further views are throttled to one every few hours.
// The daily free allotment resets at Vietnam-local midnight rather than on
// a rolling window, matching how a Vietnamese user thinks of "a new day".
const SAMPLE_VIEW_FREE_DAILY_LIMIT = 3;
const SAMPLE_VIEW_THROTTLE_MS = 3 * 60 * 60 * 1000;
const sampleViewCounts = new Map<string, { day: string; count: number; lastViewAt: number }>();

function vnDateStr(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
}

function takeSampleView(key: string): { allowed: boolean; remaining: number; retryAfterMs: number } {
  const now = Date.now();
  const today = vnDateStr(new Date(now));
  let entry = sampleViewCounts.get(key);
  if (!entry || entry.day !== today) {
    entry = { day: today, count: 0, lastViewAt: 0 };
  }

  if (entry.count < SAMPLE_VIEW_FREE_DAILY_LIMIT) {
    entry.count += 1;
    entry.lastViewAt = now;
    sampleViewCounts.set(key, entry);
    return { allowed: true, remaining: SAMPLE_VIEW_FREE_DAILY_LIMIT - entry.count, retryAfterMs: 0 };
  }

  const elapsedSinceLast = now - entry.lastViewAt;
  if (elapsedSinceLast < SAMPLE_VIEW_THROTTLE_MS) {
    sampleViewCounts.set(key, entry);
    return { allowed: false, remaining: 0, retryAfterMs: SAMPLE_VIEW_THROTTLE_MS - elapsedSinceLast };
  }

  entry.count += 1;
  entry.lastViewAt = now;
  sampleViewCounts.set(key, entry);
  return { allowed: true, remaining: 0, retryAfterMs: 0 };
}

// Starting pool of review-suggestion phrases, translated up front into every
// language the site supports — admin can add/edit/delete afterward (see
// /api/admin/review-comment-suggestions), each with its own 4 translations.
const DEFAULT_REVIEW_SUGGESTIONS: Record<Language, string>[] = [
  {
    vn: 'Tài khoản chuẩn như mô tả, giao dịch nhanh chóng!',
    en: 'Account exactly as described, super fast transaction!',
    zh: '账号完全符合描述，交易速度很快！',
    th: 'บัญชีตรงตามที่อธิบายไว้ ทำธุรกรรมรวดเร็วมาก!',
    ja: '説明通りのアカウントで、発送もスピーディーでした！',
  },
  {
    vn: 'Chất lượng tốt, admin hỗ trợ nhiệt tình. Sẽ ủng hộ tiếp!',
    en: 'Great quality, admin support is very helpful. Will buy again!',
    zh: '质量很好，管理员服务热情，还会继续支持！',
    th: 'คุณภาพดี แอดมินช่วยเหลือดีมาก จะอุดหนุนต่อแน่นอน!',
    ja: '品質も良く、サポートも親切です。また購入します！',
  },
  {
    vn: 'Uy tín, đúng như cam kết. Rất hài lòng!',
    en: 'Trustworthy, exactly as promised. Very satisfied!',
    zh: '很靠谱，完全符合承诺，非常满意！',
    th: 'น่าเชื่อถือ ตรงตามที่รับปากไว้ พอใจมาก!',
    ja: '信頼できる販売者で、約束通りの内容でした。とても満足です！',
  },
  {
    vn: 'Giao hàng tự động cực nhanh, tài khoản hoạt động tốt!',
    en: 'Auto-delivery was super fast, account works great!',
    zh: '自动发货速度超快，账号运行良好！',
    th: 'ส่งสินค้าอัตโนมัติรวดเร็วมาก บัญชีใช้งานได้ดี!',
    ja: '自動発送がとても速く、アカウントも問題なく使えました！',
  },
  {
    vn: 'Giá tốt, chất lượng ổn, sẽ quay lại mua thêm!',
    en: 'Good price, solid quality, will come back for more!',
    zh: '价格实惠，质量稳定，还会再来购买！',
    th: 'ราคาดี คุณภาพเสถียร จะกลับมาซื้อเพิ่มแน่นอน!',
    ja: '価格も品質も満足、またリピートします！',
  },
  {
    vn: 'Shop uy tín, đóng gói thông tin tài khoản rõ ràng, dễ dùng.',
    en: 'Trustworthy shop, account info is clearly laid out and easy to use.',
    zh: '商店很靠谱，账号信息整理清晰，使用方便。',
    th: 'ร้านน่าเชื่อถือ ข้อมูลบัญชีจัดเรียงชัดเจน ใช้งานง่าย',
    ja: '信頼できる販売者で、アカウント情報も分かりやすく使いやすかったです。',
  },
  {
    vn: 'Trải nghiệm mua hàng tuyệt vời, đúng cam kết bảo hành.',
    en: 'Excellent shopping experience, warranty exactly as promised.',
    zh: '购物体验很棒，保修完全兑现承诺。',
    th: 'ประสบการณ์ซื้อสินค้ายอดเยี่ยม รับประกันตรงตามที่สัญญาไว้',
    ja: '購入体験が素晴らしく、保証の約束もきちんと守ってもらえました。',
  },
  {
    vn: 'Rất đáng tiền, tài khoản ổn định sau nhiều ngày sử dụng.',
    en: 'Totally worth it, account has stayed stable after days of use.',
    zh: '非常值得，使用多天后账号依然稳定。',
    th: 'คุ้มค่ามาก บัญชียังเสถียรดีหลังใช้งานมาหลายวัน',
    ja: '十分に価値があり、アカウントも数日間安定して使えています。',
  },
];

// Bootstrap MongoDB connection. No demo products/users/stock are seeded —
// the store starts with whatever is already in the database, and new
// products, accounts and users are only ever created through real actions
// in the app (admin/CTV panels, checkout, deposits).
async function initializeDatabase() {
  await db.init();

  // Platform config is bootstrap configuration (fee %, min withdrawal), not
  // sample content — without a default document here, admin fee updates
  // would have nothing to match against on a fresh database.
  const configCol = db.collection<any>('config');
  const configDoc = await configCol.findOne({ key: 'platform' });
  if (!configDoc) {
    console.log('[MongoDB] Seeding default platform config...');
    await configCol.insertOne({
      key: 'platform',
      platformFeePercent: 5.0,
      minWithdrawal: 5.0,
      systemName: 'XCHEAP Digital Store',
    });
  }

  // Seed the review-suggestion pool once — admin can add/edit/delete these
  // afterward (see /api/admin/review-suggestions); this is just a starting
  // set so the review form isn't empty on a fresh database.
  const suggestionCol = db.collection<ReviewSuggestion>('review_suggestions');
  const existingSuggestions = await suggestionCol.find();
  if (existingSuggestions.length === 0) {
    console.log('[MongoDB] Seeding default review suggestions...');
    for (const text of DEFAULT_REVIEW_SUGGESTIONS) {
      await suggestionCol.insertOne({ id: 'sug_' + generateObjectId(), text, createdAt: new Date().toISOString() });
    }
  }

  // Seed the deposit network list from the original hardcoded config once —
  // after this, the DB is the source of truth and admin can edit/hide/
  // delete/re-add entries (see /api/admin/crypto-options) without touching
  // code. Wallet address generation itself (server/walletVault.ts) is
  // unaffected — it's keyed to the fixed CryptoNetwork ids regardless of
  // what's configured here.
  const cryptoOptCol = db.collection<CryptoOption>('crypto_options');
  const existingCryptoOpts = await cryptoOptCol.find();
  if (existingCryptoOpts.length === 0) {
    console.log('[MongoDB] Seeding default crypto deposit options...');
    for (const opt of cryptoOptions) {
      await cryptoOptCol.insertOne({ ...opt, id: opt.id as any });
    }
  }
}

// Sold inventory rows are just a warehouse record of "this account left the
// shelf" — once delivered, the actual record a buyer and admin rely on
// forever is the Order document (it snapshots its own accounts + revenue
// figures independently). So a sold row past this retention window can be
// pruned as dead weight without losing anything real: not the buyer's
// access to it (Order.accounts keeps that), and not admin/CTV statistics
// (totalSold there is computed from orders, not from counting these rows —
// see /api/admin/stats and /api/ctv/stats). Never touches unsold stock.
const SOLD_INVENTORY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 1 month

async function cleanupOldSoldInventory(): Promise<void> {
  const invCol = db.collection<any>('inventory');
  const cutoffIso = new Date(Date.now() - SOLD_INVENTORY_RETENTION_MS).toISOString();
  const result = await invCol.deleteMany({ isSold: true, soldAt: { $lt: cutoffIso } });
  if (result.deletedCount > 0) {
    console.log(`[Cleanup] Removed ${result.deletedCount} sold inventory row(s) older than 3 months.`);
  }
}

// A pre-order that's still 'pending' once its own expiresAt (set at
// placement — see POST /api/products/:id/preorder, capped at
// PREORDER_MAX_DURATION_DAYS) has passed never got the stock it was waiting
// on in time. Auto-cancels it and refunds heldAmount straight back to the
// buyer's balance — the same outcome as a manual cancel, just system-driven.
// Ownership-flip guarded the same way fulfillPendingPreorders is, so this
// can never race a stock import that fulfills the same pre-order at nearly
// the same moment (whichever update actually matches "still pending" wins).
async function checkExpiredPreorders(): Promise<void> {
  const preorderCol = db.collection<PreOrder>('preorders');
  const userCol = db.collection<User>('users');
  const nowIso = new Date().toISOString();
  const overdue = await preorderCol.find({ status: 'pending', expiresAt: { $lt: nowIso } });
  if (overdue.length === 0) return;

  let refundedCount = 0;
  for (const p of overdue) {
    const ownership = await preorderCol.updateOne(
      { id: p.id, status: 'pending' },
      { $set: { status: 'expired', refundedAt: nowIso } }
    );
    if (ownership.matchedCount === 0) continue; // fulfilled/cancelled just before we got to it
    // heldAmount is missing (undefined) on pre-orders placed before the
    // "hold funds up front" feature existed — $inc with an undefined
    // operand gets serialized to BSON null and MongoDB rejects it
    // ("Cannot increment with non-numeric argument"). Those old pre-orders
    // never held any money, so refunding $0 for them is correct, not a
    // fallback — this isn't just a crash-guard.
    await userCol.updateOne({ id: p.userId }, { $inc: { balance: Number(p.heldAmount) || 0 } });
    refundedCount++;
  }
  if (refundedCount > 0) {
    console.log(`[Preorder] Auto-cancelled and refunded ${refundedCount} expired pre-order(s).`);
  }
}

// Earlier versions seeded accounts with a fixed, source-visible password.
// Any privileged account still using it is effectively open to anyone who has
// read the code — flag them loudly at every startup until it's changed.
// Runs in the background and only checks admin/CTV accounts (the ones where
// it matters most, and few enough that the bcrypt compares stay cheap).
const LEGACY_SEED_PASSWORD = 'Xcheap@2026';
async function warnAboutLegacyDefaultPasswords(): Promise<void> {
  const userCol = db.collection<User>('users');
  const privileged = await userCol.find({ role: { $in: ['admin', 'ctv'] } });
  const exposed: string[] = [];
  for (const u of privileged) {
    if (u.passwordHash && (await verifyPassword(LEGACY_SEED_PASSWORD, u.passwordHash))) {
      exposed.push(`${u.username} (${u.role})`);
    }
  }
  if (exposed.length > 0) {
    console.warn(`[SECURITY] ${exposed.length} privileged account(s) still use the old public default password — change it now: ${exposed.join(', ')}`);
  }
}

// Records one privileged admin/CTV action for the audit log — who did what,
// to what, and when (see AdminAuditLogEntry). Called after a mutation has
// already succeeded, right before the route sends its response. A logging
// failure is swallowed rather than thrown — the action itself already went
// through, and failing the request just because the audit write hiccupped
// would be worse than a rare missing log entry.
async function logAdminAction(actor: User, action: string, summary: string, targetId?: string): Promise<void> {
  try {
    const logCol = db.collection<AdminAuditLogEntry>('admin_audit_log');
    await logCol.insertOne({
      id: 'audit_' + generateObjectId(),
      actorId: actor.id,
      actorUsername: actor.username,
      actorRole: actor.role,
      action,
      summary,
      targetId,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[AuditLog] Failed to record action', action, err);
  }
}

initializeDatabase()
  .then(() => {
    warnAboutLegacyDefaultPasswords().catch((e) => console.error('[Security check error]', e));
    cleanupOldSoldInventory().catch((e) => console.error('[Cleanup Error]', e));
    const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // re-check once a day
    setInterval(() => cleanupOldSoldInventory().catch((e) => console.error('[Cleanup Error]', e)), CLEANUP_INTERVAL_MS);

    checkExpiredPreorders().catch((e) => console.error('[Preorder Expiry Error]', e));
    // Expiry is day-granularity (max 14 days) but real money is held, so this
    // checks far more often than the inventory cleanup above — an hour's
    // worst-case delay on a refund is reasonable, a day's would not be.
    const PREORDER_EXPIRY_CHECK_INTERVAL_MS = 60 * 60 * 1000;
    setInterval(() => checkExpiredPreorders().catch((e) => console.error('[Preorder Expiry Error]', e)), PREORDER_EXPIRY_CHECK_INTERVAL_MS);

    pollAllDepositsBatch().catch((e) => console.error('[Deposit Poll Error]', e));
    // 3 minutes: frequent enough that a deposit from someone who never
    // reopens the deposit modal still lands within a few minutes, but each
    // tick is just one batched multicall round trip per network (see
    // multicallBalances) — nowhere near enough request volume to trip a
    // public RPC endpoint's rate limit, unlike polling every user
    // individually would be.
    const DEPOSIT_POLL_INTERVAL_MS = 3 * 60 * 1000;
    setInterval(() => pollAllDepositsBatch().catch((e) => console.error('[Deposit Poll Error]', e)), DEPOSIT_POLL_INTERVAL_MS);
  })
  .catch((e) => console.error('[MongoDB Init Error]', e));

// -------------------------------------------------------------
// API ROUTES (ALL BACKED BY MONGODB COLLECTIONS)
// -------------------------------------------------------------

// MongoDB Stats & Status
app.get('/api/admin/mongodb/status', requireRole('admin'), async (req, res) => {
  const stats = await db.getStats();
  res.json(stats);
});

// Lifetime confirmed deposits for a user — the basis for their VIP tier.
async function computeTotalDeposited(userId: string): Promise<number> {
  const depCol = db.collection<DepositTransaction>('deposits');
  const userDeposits = await depCol.find({ userId, status: 'confirmed' });
  return Number(userDeposits.reduce((sum, d) => sum + d.amount, 0).toFixed(3));
}

// 1. Current user profile — 401s when there's no logged-in session.
app.get('/api/user/me', async (req, res) => {
  const user = await getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Chưa đăng nhập' });

  const orderCol = db.collection<Order>('orders');
  const userOrders = await orderCol.find({ userId: user.id }, ORDERS_WITHOUT_ACCOUNTS);
  // A refunded order's money came back — it was never actually kept as
  // spending, so it shouldn't count toward "total spent" either.
  const totalSpent = Number(
    userOrders.filter((o) => o.status !== 'refunded').reduce((sum, o) => sum + o.totalPrice, 0).toFixed(3)
  );
  const totalDeposited = await computeTotalDeposited(user.id);

  const publicUser: any = toPublicUser(user);
  if (user.role === 'user') {
    const vipTier = getVipTier(totalDeposited);
    publicUser.vipDiscountPercent = vipTier.discountPercent;
    publicUser.vipTierKey = vipTier.key;
  }
  // Only a user's own /api/user/me response ever carries their real API key
  // back out — every other endpoint returns the key-stripped public shape.
  publicUser.apiKey = user.apiKey;
  // Just a boolean — never the hash itself. Lets the admin/CTV dashboard
  // know whether to show the PIN-entry gate (see requireRole) and whether
  // the account settings UI should offer "change/remove PIN" vs "set PIN".
  if (user.role === 'admin' || user.role === 'ctv') {
    publicUser.hasAdminPin = !!user.adminPinHash;
  }
  res.json({ user: publicUser, totalDeposited, totalSpent });
});

// Rotates the caller's API key — for when a key may have leaked. The old
// key stops working the instant this returns; there's no grace period.
app.post('/api/user/api-key/regenerate', requireAuth(), async (req, res) => {
  const user = (await getSessionUser(req))!;
  const userCol = db.collection<User>('users');
  const newKey = generateApiKey();
  await userCol.updateOne({ id: user.id }, { $set: { apiKey: newKey } });
  res.json({ success: true, apiKey: newKey });
});

// Update contact info (phone / Telegram handle)
app.put('/api/user/profile', requireAuth(), async (req, res) => {
  const user = (await getSessionUser(req))!;
  const { phone, telegram } = req.body;

  const updateFields: Partial<User> = {};
  if (typeof phone === 'string') updateFields.phone = phone.trim();
  if (typeof telegram === 'string') updateFields.telegram = telegram.trim();

  const userCol = db.collection<User>('users');
  await userCol.updateOne({ id: user.id }, { $set: updateFields });
  const updated = await userCol.findOne({ id: user.id });
  res.json({ success: true, user: updated ? toPublicUser(updated) : null });
});

// Change password — requires the current password
app.post('/api/auth/change-password', requireAuth(), async (req, res) => {
  const user = (await getSessionUser(req))!;
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Vui lòng nhập đầy đủ mật khẩu hiện tại và mật khẩu mới' });
  }
  if (String(newPassword).length < 6) {
    return res.status(400).json({ error: 'Mật khẩu mới phải có ít nhất 6 ký tự' });
  }
  if (!user.passwordHash || !(await verifyPassword(currentPassword, user.passwordHash))) {
    return res.status(401).json({ error: 'Mật khẩu hiện tại không đúng' });
  }

  const userCol = db.collection<User>('users');
  // Bumping authVersion invalidates every existing session for this account
  // (a stolen/forgotten login on another device stops working the moment the
  // password changes). The session making this request is re-stamped with the
  // new version so THIS device stays logged in.
  await userCol.updateOne({ id: user.id }, { $set: { passwordHash: await hashPassword(newPassword) }, $inc: { authVersion: 1 } });
  const refreshed = await userCol.findOne({ id: user.id });
  if (req.session.userId) req.session.authVersion = refreshed?.authVersion ?? 0;
  res.json({ success: true });
});

// Sets (or changes) the opt-in secondary PIN that gates the admin/CTV
// dashboard for THIS account (see requireRole in server/auth.ts) — requires
// re-entering the real account password first, same as change-password,
// since this is a new standing credential being created. Verifies
// immediately so the account that just set it isn't prompted again in the
// same session.
app.post('/api/auth/set-admin-pin', requireAuth(), async (req, res) => {
  const user = (await getSessionUser(req))!;
  if (user.role !== 'admin' && user.role !== 'ctv') {
    return res.status(403).json({ error: 'Chỉ tài khoản admin/CTV mới có thể đặt mã PIN này' });
  }
  const { currentPassword, newPin } = req.body;
  if (!currentPassword || !newPin) {
    return res.status(400).json({ error: 'Vui lòng nhập đầy đủ mật khẩu hiện tại và mã PIN mới' });
  }
  if (!/^\d{4,10}$/.test(String(newPin))) {
    return res.status(400).json({ error: 'Mã PIN phải gồm 4-10 chữ số' });
  }
  if (!user.passwordHash || !(await verifyPassword(currentPassword, user.passwordHash))) {
    return res.status(401).json({ error: 'Mật khẩu hiện tại không đúng' });
  }
  const userCol = db.collection<User>('users');
  await userCol.updateOne({ id: user.id }, { $set: { adminPinHash: await hashPassword(String(newPin)) } });
  clearPinFailures(user.id);
  req.session.adminPinVerified = true;
  res.json({ success: true });
});

// Removes the secondary PIN — also gated behind re-entering the real
// password, so an attacker who only has a stolen/open session can't simply
// turn the extra protection off.
app.post('/api/auth/clear-admin-pin', requireAuth(), async (req, res) => {
  const user = (await getSessionUser(req))!;
  const { currentPassword } = req.body;
  if (!currentPassword) return res.status(400).json({ error: 'Vui lòng nhập mật khẩu hiện tại' });
  if (!user.passwordHash || !(await verifyPassword(currentPassword, user.passwordHash))) {
    return res.status(401).json({ error: 'Mật khẩu hiện tại không đúng' });
  }
  const userCol = db.collection<User>('users');
  await userCol.updateOne({ id: user.id }, { $unset: { adminPinHash: '' } });
  res.json({ success: true });
});

// Checked by the admin/CTV dashboard right after login when GET /api/user/me
// reports hasAdminPin — on success this is what actually flips
// req.session.adminPinVerified, which is what requireRole checks from then
// on for the rest of this browser session.
app.post('/api/auth/verify-admin-pin', requireAuth(), async (req, res) => {
  const user = (await getSessionUser(req))!;
  if (!user.adminPinHash) return res.status(400).json({ error: 'Tài khoản này chưa đặt mã PIN' });
  if (isPinLocked(user.id)) return res.status(429).json({ error: PIN_LOCKED_MESSAGE });

  const { pin } = req.body;
  if (!pin || !(await verifyPassword(String(pin), user.adminPinHash))) {
    recordPinFailure(user.id);
    return res.status(401).json({ error: 'Mã PIN không đúng' });
  }
  clearPinFailures(user.id);
  req.session.adminPinVerified = true;
  res.json({ success: true });
});

// Cloudflare Turnstile (bot/spam protection on login & register). Falls back
// to Cloudflare's own published "always passes" test keys when no real key
// is configured via env vars, so local/dev setups keep working out of the
// box — TURNSTILE_SITE_KEY (exposed to the frontend as VITE_TURNSTILE_SITE_KEY)
// and TURNSTILE_SECRET_KEY must both be set to real values from the
// Cloudflare dashboard before this protects anything in production.
const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY || '1x0000000000000000000000000000000AA';

async function verifyTurnstileToken(token: unknown, remoteIp?: string): Promise<boolean> {
  // If no TURNSTILE_SECRET_KEY is configured or default test key is present, pass gracefully in dev/preview
  if (!process.env.TURNSTILE_SECRET_KEY || process.env.TURNSTILE_SECRET_KEY === '1x0000000000000000000000000000000AA') {
    return true;
  }
  if (!token || typeof token !== 'string') return false;
  try {
    const body = new URLSearchParams();
    body.set('secret', TURNSTILE_SECRET_KEY);
    body.set('response', token);
    if (remoteIp) body.set('remoteip', remoteIp);
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data: any = await res.json();
    if (data?.success !== true) {
      // Cloudflare's error-codes (e.g. "invalid-input-secret" for a
      // site/secret key mismatch, "timeout-or-duplicate" for a reused or
      // expired token, "hostname-mismatch" if the widget's configured
      // domain doesn't include the one being tested on) — logged so a
      // rejected login/register can actually be diagnosed instead of just
      // showing as a generic failure.
      console.error('[Turnstile] verification failed:', data?.['error-codes'] || data);
    }
    return data?.success === true;
  } catch (err) {
    // A verification-service outage shouldn't be indistinguishable from a
    // failed challenge to the caller, but it must still fail closed —
    // treating it as a pass would defeat the whole point of the check.
    console.error('[Turnstile] verification request threw:', err);
    return false;
  }
}

// 2. Register a new account
app.post('/api/auth/register', registerRateLimiter, async (req, res) => {
  const { username, email, password, turnstileToken } = req.body;
  // Every field must actually be a string before it's allowed anywhere near
  // a MongoDB query filter or a stored document — without this, a JSON body
  // like {"username": {"$ne": null}} would sail past the truthiness check
  // below (an object is truthy) and get used as-is in findOne({ username }),
  // turning a plain equality lookup into an attacker-controlled query
  // operator (classic NoSQL injection).
  if (typeof username !== 'string' || typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Vui lòng nhập đầy đủ tên đăng nhập, email và mật khẩu' });
  }
  if (!username.trim() || !email.trim() || !password) {
    return res.status(400).json({ error: 'Vui lòng nhập đầy đủ tên đăng nhập, email và mật khẩu' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: 'Mật khẩu phải có ít nhất 6 ký tự' });
  }
  if (!(await verifyTurnstileToken(turnstileToken, req.ip))) {
    return res.status(400).json({ error: 'Xác thực bảo mật không hợp lệ hoặc đã hết hạn, vui lòng thử lại.' });
  }

  const cleanUsername = username.trim();
  const cleanEmail = email.trim();

  const userCol = db.collection<User>('users');
  if (await userCol.findOne({ username: cleanUsername })) {
    return res.status(400).json({ error: 'Tên đăng nhập đã tồn tại' });
  }
  if (await userCol.findOne({ email: cleanEmail })) {
    return res.status(400).json({ error: 'Email đã được sử dụng' });
  }

  const newId = 'user_' + Math.random().toString(36).substring(2, 9);
  const newUser: User = {
    id: newId,
    username: cleanUsername,
    email: cleanEmail,
    role: 'user',
    balance: 0,
    discountPercent: 0,
    depositWallets: await getOrCreateUserWallet(newId),
    passwordHash: await hashPassword(password),
    apiKey: generateApiKey(),
    createdAt: new Date().toISOString(),
  };
  await userCol.insertOne(newUser);

  // Deliberately not logging the new account in here — registration hands
  // off to the login page so the user confirms their credentials work.
  res.json({ success: true, user: toPublicUser(newUser) });
});

// 3. Log in with username/email + password
app.post('/api/auth/login', loginRateLimiter, async (req, res) => {
  const { identifier, password, turnstileToken } = req.body;
  // Same reasoning as register: identifier/password must be real strings
  // before they're allowed near a MongoDB query — an object like
  // {"$gt": ""} would otherwise pass the truthiness check and get used
  // directly as a query operator instead of a literal value.
  if (typeof identifier !== 'string' || typeof password !== 'string' || !identifier.trim() || !password) {
    return res.status(400).json({ error: 'Vui lòng nhập tên đăng nhập/email và mật khẩu' });
  }
  if (!(await verifyTurnstileToken(turnstileToken, req.ip))) {
    return res.status(400).json({ error: 'Xác thực bảo mật không hợp lệ hoặc đã hết hạn, vui lòng thử lại.' });
  }

  const cleanIdentifier = identifier.trim();
  const userCol = db.collection<User>('users');
  const user = (await userCol.findOne({ username: cleanIdentifier })) || (await userCol.findOne({ email: cleanIdentifier }));
  if (!user || !user.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không đúng' });
  }

  // Regenerate the session id on login instead of reusing whatever session
  // (if any) the browser already had — otherwise a session id an attacker
  // fixed before the victim logged in (session fixation) would carry
  // straight through into an authenticated session they can also read.
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Lỗi tạo phiên đăng nhập' });
    req.session.userId = user.id;
    req.session.authVersion = user.authVersion ?? 0;
    req.session.save((saveErr) => {
      if (saveErr) return res.status(500).json({ error: 'Lỗi tạo phiên đăng nhập' });
      res.json({ success: true, user: toPublicUser(user) });
    });
  });
});

// 4. Log out — destroys the session
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});

// 3. Products List (MongoDB: find)
// Real rating/reviewCount from the reviews collection — never the stale
// seeded fields on the product document itself.
// Builds a fixed-length daily revenue/order-count series (oldest to newest,
// zero-filled for days with no orders) for the chart views on the Admin and
// CTV dashboards.
function buildDailySeries(
  orders: { createdAt: string; totalPrice: number }[],
  days: number
): { date: string; revenue: number; orders: number }[] {
  const buckets = new Map<string, { revenue: number; orders: number }>();
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    buckets.set(d.toISOString().slice(0, 10), { revenue: 0, orders: 0 });
  }
  orders.forEach((o) => {
    const key = String(o.createdAt).slice(0, 10);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.revenue = Number((bucket.revenue + o.totalPrice).toFixed(3));
      bucket.orders += 1;
    }
  });
  return Array.from(buckets.entries()).map(([date, v]) => ({ date, ...v }));
}

// Monthly-bucketed version of buildDailySeries, for the "toàn thời gian"
// (all-time) chart view — a long-lived store could have years of orders, so
// daily buckets would render an unusably long chart; monthly buckets stay
// readable no matter how much order history exists.
function buildMonthlySeries(
  orders: { createdAt: string; totalPrice: number }[],
  months: number
): { date: string; revenue: number; orders: number }[] {
  const buckets = new Map<string, { revenue: number; orders: number }>();
  const now = new Date();
  // Dùng getUTCFullYear/getUTCMonth (không phải getFullYear/getMonth theo
  // giờ local) để khớp đúng với cách createdAt được lưu (luôn là chuỗi ISO
  // UTC qua .toISOString()) — nếu tính theo giờ local ở múi giờ UTC+7, nửa
  // đêm ngày 1 theo giờ VN lại rơi vào ~17h ngày cuối tháng trước theo UTC,
  // khiến bucket bị gắn nhầm sang tháng trước và không khớp với bất kỳ đơn
  // hàng thật nào (luôn hiện doanh thu 0 dù đơn hàng có thật).
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    buckets.set(d.toISOString().slice(0, 7), { revenue: 0, orders: 0 });
  }
  orders.forEach((o) => {
    const key = String(o.createdAt).slice(0, 7);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.revenue = Number((bucket.revenue + o.totalPrice).toFixed(3));
      bucket.orders += 1;
    }
  });
  return Array.from(buckets.entries()).map(([date, v]) => ({ date, ...v }));
}

// How many months the "toàn thời gian" view should span — from the very
// first order up to the current month, capped at 24 so a store with years of
// history still renders a readable chart instead of an endless one. Uses UTC
// getters for the same reason as buildMonthlySeries above.
function computeAllTimeMonthsSpan(orders: { createdAt: string }[]): number {
  if (orders.length === 0) return 1;
  const earliestMs = Math.min(...orders.map((o) => new Date(o.createdAt).getTime()));
  const now = new Date();
  const earliest = new Date(earliestMs);
  const months = (now.getUTCFullYear() - earliest.getUTCFullYear()) * 12 + (now.getUTCMonth() - earliest.getUTCMonth()) + 1;
  return Math.min(24, Math.max(1, months));
}

// Picks the right bucketing for a chart's requested period: 'week' (last 7
// days, daily), 'month' (last 30 days, daily), or 'all' (whole order
// history, monthly). Shared by both the Admin and CTV chart endpoints so the
// two dashboards' period toggles behave identically.
function buildChartSeries(
  orders: { createdAt: string; totalPrice: number }[],
  period: string
): { date: string; revenue: number; orders: number }[] {
  if (period === 'month') return buildDailySeries(orders, 30);
  if (period === 'all') return buildMonthlySeries(orders, computeAllTimeMonthsSpan(orders));
  return buildDailySeries(orders, 7);
}

// Top-selling products by revenue, for the same chart views.
function buildTopProducts(
  orders: { productName: string; totalPrice: number }[],
  limit: number
): { name: string; revenue: number; orders: number }[] {
  const byProduct = new Map<string, { revenue: number; orders: number }>();
  orders.forEach((o) => {
    const cur = byProduct.get(o.productName) || { revenue: 0, orders: 0 };
    cur.revenue = Number((cur.revenue + o.totalPrice).toFixed(3));
    cur.orders += 1;
    byProduct.set(o.productName, cur);
  });
  return Array.from(byProduct.entries())
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit);
}

function ratingFromReviews(productId: string, allReviews: Review[]): { rating: number; reviewCount: number } {
  const productReviews = allReviews.filter((r) => r.productId === productId);
  const reviewCount = productReviews.length;
  const rating = reviewCount > 0 ? Number((productReviews.reduce((sum, r) => sum + r.rating, 0) / reviewCount).toFixed(1)) : 0;
  return { rating, reviewCount };
}

// Orders carry the full list of delivered credentials in `accounts` - by far
// the heaviest field, and none of the dashboards/stat scans below use it. Every
// scan over ALL orders excludes it, so cost grows with the number of orders, not
// with the number of accounts ever sold.
const ORDERS_WITHOUT_ACCOUNTS = { projection: { accounts: 0 as const } };

// Price sanity for everything an admin types in. A negative price made
// checkout CREDIT the buyer's wallet instead of charging it, and NaN/Infinity
// silently poisoned every total computed from it — so anything outside
// (0, MAX_PRICE] is rejected at write time (and again at checkout, for rows
// saved before this check existed).
const MAX_PRICE = 100000;
const isValidPrice = (n: number): boolean => Number.isFinite(n) && n > 0 && n <= MAX_PRICE;

// For create bodies: price/originalPrice may be left out (blank or 0 means
// "not provided", default applies) but anything actually provided must be valid.
function validateOptionalPricing(price: unknown, originalPrice: unknown): string | null {
  const provided = (v: unknown) => v !== undefined && v !== null && v !== '' && Number(v) !== 0;
  if (provided(price) && !isValidPrice(Number(price))) return 'Giá bán không hợp lệ (phải lớn hơn 0 và hợp lý).';
  if (provided(originalPrice) && !isValidPrice(Number(originalPrice))) return 'Giá gốc không hợp lệ.';
  return null;
}

function validateVariantsInput(variants: unknown): string | null {
  if (!Array.isArray(variants)) return 'Danh sách biến thể không hợp lệ.';
  for (const v of variants) {
    if (!v || typeof v.name !== 'string' || !v.name.trim()) return 'Mỗi biến thể cần có tên.';
    if (!isValidPrice(Number(v.price))) return `Giá của biến thể "${v.name}" không hợp lệ (phải lớn hơn 0 và hợp lý).`;
    const err = validateOptionalPricing(undefined, v.originalPrice);
    if (err) return err;
  }
  return null;
}

// Discount badges are computed once here, at write time, and stored on the
// document — every reader (storefront cards, product detail, admin tables)
// then just displays product.badge / variant.discountBadge directly instead
// of each re-deriving its own copy of this math from price/originalPrice.
function computeDiscountBadge(price: number, originalPrice?: number): string | undefined {
  if (originalPrice && originalPrice > price) {
    const pct = Math.round((1 - price / originalPrice) * 100);
    if (pct > 0) return `-${pct}%`;
  }
  return undefined;
}

// The product-level badge is the single best deal across the product's own
// price and every variant's price, so the storefront card always advertises
// a discount a shopper can actually get.
function computeBestBadge(product: { price: number; originalPrice?: number; variants: { price: number; originalPrice?: number }[] }): string | undefined {
  let bestPct = 0;
  const consider = (price: number, originalPrice?: number) => {
    if (originalPrice && originalPrice > price) {
      const pct = Math.round((1 - price / originalPrice) * 100);
      if (pct > bestPct) bestPct = pct;
    }
  };
  consider(product.price, product.originalPrice);
  (product.variants || []).forEach((v) => consider(v.price, v.originalPrice));
  return bestPct > 0 ? `-${bestPct}%` : undefined;
}

// Shared bulk-import logic: an account's username is always the first
// "|"-separated field. Any line whose username already exists anywhere in
// the warehouse — across every product and variant, not just this one — or
// that repeats within the same pasted batch, is skipped instead of being
// imported as a duplicate account.
async function importInventoryAccounts(
  invCol: MongoCollection<any>,
  productId: string,
  variantId: string,
  rawAccounts: string,
  uploadedBy: { userId: string; username: string },
  productName: string,
  variantName: string
): Promise<{ importedCount: number; duplicateCount: number; duplicateUsernames: string[]; importedUsernames: string[] }> {
  const lines = rawAccounts.split('\n').map((l) => l.trim()).filter(Boolean);
  const extractUsername = (line: string) => inventoryUsernameKey(line);

  // Same rule as before — a username that already exists ANYWHERE in the
  // warehouse (any product/variant, sold rows still within retention
  // included), or repeats inside this pasted batch, is skipped as a duplicate.
  // What changed is how "already exists" is found: only the usernames in this
  // batch are looked up, through the indexed usernameKey, instead of loading
  // every inventory row on every import.
  const batchUsernames = [...new Set(lines.map(extractUsername).filter(Boolean))];
  const existingUsernames = new Set<string>();
  const LOOKUP_CHUNK = 1000;
  for (let i = 0; i < batchUsernames.length; i += LOOKUP_CHUNK) {
    const rows = await invCol.find({ usernameKey: { $in: batchUsernames.slice(i, i + LOOKUP_CHUNK) } });
    for (const row of rows) existingUsernames.add(row.usernameKey);
  }

  const seenInThisBatch = new Set<string>();
  const uniqueLines: string[] = [];
  const duplicateUsernames: string[] = [];

  for (const line of lines) {
    const username = extractUsername(line);
    if (!username || existingUsernames.has(username) || seenInThisBatch.has(username)) {
      // A username-less line used to fall back to the raw `line` here — fine
      // while this array was only ever counted for a toast, but now that
      // admin can actually see this list (see GET .../bulk-import's
      // response), echoing the raw line back would leak its password/2FA
      // fields for any malformed paste. A fixed placeholder instead.
      duplicateUsernames.push(username || '[dòng không hợp lệ]');
      continue;
    }
    seenInThisBatch.add(username);
    uniqueLines.push(line);
  }

  const importedAt = Date.now();
  const batchTag = Math.random().toString(36).slice(2, 7);
  const newItems = uniqueLines.map((line, idx) => ({
    // batchTag keeps ids unique even when two imports land in the same
    // millisecond (same Date.now() + same idx used to collide).
    id: `stk_imported_${importedAt}_${batchTag}_${idx}`,
    productId,
    variantId,
    accountData: line,
    usernameKey: extractUsername(line),
    isSold: false,
    uploadedByUserId: uploadedBy.userId,
    uploadedByUsername: uploadedBy.username,
    createdAt: new Date().toISOString(),
  }));

  if (newItems.length > 0) {
    await invCol.insertMany(newItems);
    // One row per upload batch — lets admin review who nhập kho what, when,
    // and how much, independent of any order (no money/sale involved yet at
    // this point). Names are denormalized at write time, same reasoning as
    // Order.productName elsewhere: the product/variant could be renamed or
    // deleted later without this history becoming unreadable.
    await db.collection<any>('inventory_upload_history').insertOne({
      id: `uh_${importedAt}_${batchTag}`,
      productId,
      productName,
      variantId,
      variantName,
      uploadedByUserId: uploadedBy.userId,
      uploadedByUsername: uploadedBy.username,
      importedCount: newItems.length,
      duplicateCount: duplicateUsernames.length,
      // Full lists, not just counts — lets admin re-open this exact batch
      // later (GET .../inventory-upload-history/:id) to review and copy
      // which accounts actually went in vs. were skipped, instead of that
      // detail only existing for a few seconds right after the import runs.
      importedUsernames: newItems.map((item) => item.usernameKey),
      duplicateUsernames,
      createdAt: new Date().toISOString(),
    });
    // New stock just landed for this exact variant — immediately try to
    // clear any pre-orders waiting on it instead of leaving buyers who
    // already asked to be notified/delivered sitting until the next unrelated
    // admin action happens to touch this product.
    await fulfillPendingPreorders(productId, variantId);
  }

  return {
    importedCount: newItems.length,
    duplicateCount: duplicateUsernames.length,
    duplicateUsernames,
    importedUsernames: newItems.map((item) => item.usernameKey),
  };
}

// Groups claimed inventory rows by whoever uploaded them into the
// Order.uploaderBreakdown snapshot — admin can authorize several CTVs on
// the same product/variant, so a single purchase's units can come from more
// than one of them. A row with no uploader recorded (imported before this
// feature existed) is simply left out rather than guessed at.
function buildUploaderBreakdown(items: any[]): { userId: string; username: string; quantity: number }[] {
  const byUploader = new Map<string, { username: string; quantity: number }>();
  for (const item of items) {
    if (!item.uploadedByUserId) continue;
    const existing = byUploader.get(item.uploadedByUserId);
    if (existing) existing.quantity += 1;
    else byUploader.set(item.uploadedByUserId, { username: item.uploadedByUsername || '', quantity: 1 });
  }
  return Array.from(byUploader.entries()).map(([userId, { username, quantity }]) => ({ userId, username, quantity }));
}

app.get('/api/products', async (req, res) => {
  const prodCol = db.collection<Product>('products');
  const invCol = db.collection<any>('inventory');
  const reviewCol = db.collection<Review>('reviews');

  // Hidden products/variants (isHidden) are a CTV/Admin's own "pull off the
  // storefront without deleting" control — everyone else must never see
  // them, but an admin or CTV needs the full list (including their own
  // hidden ones) to manage them from the admin/CTV panel, which reuses this
  // same endpoint for its product table.
  const requester = await getSessionUser(req);
  const canSeeHidden = !!requester && (requester.role === 'admin' || requester.role === 'ctv');

  const products = await prodCol.find(canSeeHidden ? {} : { isHidden: { $ne: true } });
  // Counted inside the database, per variant / per product — this public
  // endpoint runs on every storefront page load, so it must never pull every
  // unsold account (credentials included) and every review into memory just
  // to tally them.
  const stockRows = await invCol.groupBy('variantId', { isSold: false });
  const stockByVariant = new Map<string, number>(stockRows.map((r) => [r.key, r.count]));
  const reviewRows = await reviewCol.groupBy('productId', {}, 'rating');
  const ratingByProduct = new Map<string, { rating: number; reviewCount: number }>(
    reviewRows.map((r) => [r.key, { rating: r.count > 0 ? Number((r.sum / r.count).toFixed(1)) : 0, reviewCount: r.count }])
  );

  // Enrich products with real-time live MongoDB inventory counts
  const enriched = products.map((p) => {
    const rawVariants = canSeeHidden ? (p.variants || []) : (p.variants || []).filter((v) => !v.isHidden);
    const updatedVariants = rawVariants.map((v) => {
      // Stock shown to buyers always reflects real inventory records — never
      // falls back to a static declared number, so a variant with no
      // imported accounts correctly shows as out of stock instead of a
      // leftover placeholder count.
      const count = stockByVariant.get(v.id) || 0;
      let cleanBadge = v.discountBadge;
      if (cleanBadge && (cleanBadge.includes('Hết hàng') || cleanBadge.toLowerCase().includes('out of stock'))) {
        cleanBadge = cleanBadge.replace(/Hết hàng|out of stock/gi, '').trim();
      }
      return {
        ...v,
        stockCount: count,
        inStock: count > 0,
        discountBadge: cleanBadge || undefined,
      };
    });
    // authorizedCtvIds (which CTVs may stock this), createdByUserId (the
    // internal account id of whoever listed it) and seller (whose login name
    // that is) are internal admin/CTV info — never sent to a regular shopper,
    // only to the admin/CTV panels that reuse this same endpoint. The
    // storefront UI doesn't render seller at all.
    const { authorizedCtvIds, createdByUserId, seller, ...publicFields } = p;
    return {
      ...(canSeeHidden ? p : publicFields),
      variants: updatedVariants,
      ...(ratingByProduct.get(p.id) || { rating: 0, reviewCount: 0 }),
    };
  });

  // A product whose variants are all hidden has nothing a shopper can buy —
  // it must not be listed at all (admin/CTV still see it to manage it).
  res.json({ products: canSeeHidden ? enriched : enriched.filter((p) => p.variants.length > 0) });
});

// 4. Product Detail (MongoDB: findOne)
app.get('/api/products/:id', async (req, res) => {
  const prodCol = db.collection<Product>('products');
  const invCol = db.collection<any>('inventory');
  const reviewCol = db.collection<Review>('reviews');
  const product = await prodCol.findOne({ id: req.params.id });
  if (!product) return res.status(404).json({ error: 'Product not found' });

  const requester = await getSessionUser(req);
  const canSeeHidden = !!requester && (requester.role === 'admin' || requester.role === 'ctv');
  // A hidden product is 404 for anyone but its own CTV/Admin — behaves as if
  // it doesn't exist at all, including for someone with an old direct link.
  if (product.isHidden && !canSeeHidden) {
    return res.status(404).json({ error: 'Product not found' });
  }
  if (!canSeeHidden && product.variants) {
    product.variants = product.variants.filter((v) => !v.isHidden);
  }
  if (!canSeeHidden && (product.variants || []).length === 0) {
    return res.status(404).json({ error: 'Product not found' });
  }

  if (product.variants) {
    const stockRows = await invCol.groupBy('variantId', { productId: product.id, isSold: false });
    const stockByVariant = new Map<string, number>(stockRows.map((r) => [r.key, r.count]));
    product.variants = product.variants.map((v) => {
      const count = stockByVariant.get(v.id) || 0;
      let cleanBadge = v.discountBadge;
      if (cleanBadge && (cleanBadge.includes('Hết hàng') || cleanBadge.toLowerCase().includes('out of stock'))) {
        cleanBadge = cleanBadge.replace(/Hết hàng|out of stock/gi, '').trim();
      }
      return {
        ...v,
        stockCount: count,
        inStock: count > 0,
        discountBadge: cleanBadge || undefined,
      };
    });
  }

  const productReviews = await reviewCol.find({ productId: product.id });
  Object.assign(product, ratingFromReviews(product.id, productReviews));

  // Same reasoning as GET /api/products — internal admin/CTV info, never sent
  // to a regular shopper.
  if (!canSeeHidden) {
    delete (product as any).authorizedCtvIds;
    delete (product as any).createdByUserId;
    delete (product as any).seller;
  }

  res.json({ product });
});

// Shows just enough of a reviewer's name to feel authentic without exposing
// their full username to every visitor — always exactly 3 trailing asterisks
// regardless of the real length, so the mask never leaks how long the
// original username was either.
function maskReviewerName(username: string): string {
  return username.slice(0, Math.min(3, username.length)) + '***';
}

// Real product reviews — no fabricated reviews are ever mixed in; a product
// with none yet simply returns an empty list.
app.get('/api/products/:id/reviews', async (req, res) => {
  const reviewCol = db.collection<Review>('reviews');
  const userCol = db.collection<User>('users');
  const depCol = db.collection<DepositTransaction>('deposits');
  const reviews = await reviewCol.find({ productId: req.params.id }, { sort: { date: -1 } });

  // VIP is a deposit-based perk that only ever applies to role 'user' (see
  // computeUnitPriceForUser) — a CTV/admin reviewer never gets a VIP badge
  // even if their account happens to carry old deposits. Both lookups are
  // batched by the reviewer's userId (not per-review) so a product with many
  // reviews still costs 2 extra queries total, not 2 per review.
  const userIds = [...new Set(reviews.map((r) => r.userId))];
  const reviewers = await userCol.find({ id: { $in: userIds } });
  const reviewerRoleById = new Map(reviewers.map((u) => [u.id, u.role]));

  const confirmedDeposits = await depCol.find({ userId: { $in: userIds }, status: 'confirmed' });
  const totalDepositedById = new Map<string, number>();
  for (const d of confirmedDeposits) {
    totalDepositedById.set(d.userId, (totalDepositedById.get(d.userId) || 0) + d.amount);
  }

  const publicReviews = reviews.map((r) => {
    let authorVipTierKey: string | undefined;
    if (reviewerRoleById.get(r.userId) === 'user') {
      const vipTier = getVipTier(totalDepositedById.get(r.userId) || 0);
      if (vipTier.discountPercent > 0) authorVipTierKey = vipTier.key;
    }
    // The reviewer's internal account id is never sent to other visitors —
    // only the masked display name is public.
    const { userId: _reviewerId, ...publicFields } = r;
    return { ...publicFields, author: maskReviewerName(r.author), authorVipTierKey };
  });
  res.json({ reviews: publicReviews });
});

// A review rated this or below is considered "xấu" (bad) and stays
// editable by its author — the idea being a seller/admin can reach out to
// the buyer, resolve whatever went wrong, and the buyer can then revise
// their own review. A review above this (rating >= 4, "tốt"/good) is final
// and can never be edited again once submitted.
const REVIEW_EDITABLE_MAX_RATING = 3;

// Whether the current user is allowed to write (or edit) a review right now
// — purely a UI convenience for deciding what to show; the actual
// enforcement (must have bought it, can't create a second one, can't edit a
// good review) lives in the POST/PUT handlers below and can't be bypassed
// by skipping this check.
app.get('/api/products/:id/review-eligibility', async (req, res) => {
  const user = await getSessionUser(req);
  if (!user) return res.json({ canReview: false, alreadyReviewed: false, hasPurchased: false, existingReview: null, canEdit: false });

  const orderCol = db.collection<Order>('orders');
  const reviewCol = db.collection<Review>('reviews');
  const purchases = await orderCol.find({ userId: user.id, productId: req.params.id, status: 'completed' }, ORDERS_WITHOUT_ACCOUNTS);
  const existingReview = await reviewCol.findOne({ userId: user.id, productId: req.params.id });

  res.json({
    hasPurchased: purchases.length > 0,
    alreadyReviewed: !!existingReview,
    canReview: purchases.length > 0 && !existingReview,
    existingReview: existingReview ? { rating: existingReview.rating, comment: existingReview.comment } : null,
    canEdit: !!existingReview && existingReview.rating <= REVIEW_EDITABLE_MAX_RATING,
  });
});

// Submit a review — gated on having actually bought this product (a real
// completed order), one review per user per product, and a non-empty
// comment is required (a bare star rating with nothing written isn't
// accepted). Nothing here is fabricated or self-reported without a check:
// every condition is verified server-side against the orders/reviews
// collections, not trusted from the client.
app.post('/api/products/:id/reviews', async (req, res) => {
  const user = await getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Vui lòng đăng nhập để đánh giá' });

  const { rating, comment } = req.body;
  const cleanRating = Math.round(Number(rating));
  if (!Number.isFinite(cleanRating) || cleanRating < 1 || cleanRating > 5) {
    return res.status(400).json({ error: 'Số sao đánh giá không hợp lệ (1-5 sao)' });
  }
  const cleanComment = String(comment || '').trim().slice(0, 1000);
  if (!cleanComment) {
    return res.status(400).json({ error: 'Vui lòng viết nội dung đánh giá trước khi gửi' });
  }

  const prodCol = db.collection<Product>('products');
  const product = await prodCol.findOne({ id: req.params.id });
  if (!product) return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });

  const orderCol = db.collection<Order>('orders');
  const purchases = await orderCol.find({ userId: user.id, productId: req.params.id, status: 'completed' }, ORDERS_WITHOUT_ACCOUNTS);
  if (purchases.length === 0) {
    return res.status(403).json({ error: 'Bạn cần mua sản phẩm này trước khi có thể đánh giá' });
  }

  const reviewCol = db.collection<Review>('reviews');
  const existingReview = await reviewCol.findOne({ userId: user.id, productId: req.params.id });
  if (existingReview) {
    return res.status(400).json({ error: 'Bạn đã đánh giá sản phẩm này rồi' });
  }

  const newReview: Review = {
    id: 'rev_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    productId: req.params.id,
    userId: user.id,
    author: user.username,
    rating: cleanRating,
    date: new Date().toISOString(),
    comment: cleanComment,
    commentTranslations: await translateDescriptionToAllLanguages(cleanComment),
  };
  await reviewCol.insertOne(newReview);
  res.json({ success: true, review: newReview });
});

// Edit an existing review — only the author, and only while the review is
// still rated REVIEW_EDITABLE_MAX_RATING or below. This is how "kêu user
// sửa lại đánh giá tốt" actually happens in-app: admin/CTV resolve the
// complaint with the buyer out of band, and the buyer comes back here to
// revise their own review. Once a review reaches a "good" rating, this
// endpoint refuses to touch it again — good reviews are permanent.
app.put('/api/products/:id/reviews', async (req, res) => {
  const user = await getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Vui lòng đăng nhập để chỉnh sửa đánh giá' });

  const reviewCol = db.collection<Review>('reviews');
  const existingReview = await reviewCol.findOne({ userId: user.id, productId: req.params.id });
  if (!existingReview) {
    return res.status(404).json({ error: 'Bạn chưa có đánh giá nào cho sản phẩm này' });
  }
  if (existingReview.rating > REVIEW_EDITABLE_MAX_RATING) {
    return res.status(403).json({ error: 'Đánh giá tốt không thể chỉnh sửa được nữa' });
  }

  const { rating, comment } = req.body;
  const cleanRating = Math.round(Number(rating));
  if (!Number.isFinite(cleanRating) || cleanRating < 1 || cleanRating > 5) {
    return res.status(400).json({ error: 'Số sao đánh giá không hợp lệ (1-5 sao)' });
  }
  const cleanComment = String(comment || '').trim().slice(0, 1000);
  if (!cleanComment) {
    return res.status(400).json({ error: 'Vui lòng viết nội dung đánh giá trước khi gửi' });
  }

  // Only re-translate when the comment text actually changed — editing just
  // the star rating shouldn't burn a translation-API call for content that
  // hasn't moved (same reasoning as the product description editor).
  const retranslate = cleanComment !== existingReview.comment;

  await reviewCol.updateOne(
    { id: existingReview.id },
    {
      $set: {
        rating: cleanRating,
        comment: cleanComment,
        editedAt: new Date().toISOString(),
        ...(retranslate ? { commentTranslations: await translateDescriptionToAllLanguages(cleanComment) } : {}),
      },
    }
  );
  const updated = await reviewCol.findOne({ id: existingReview.id });
  res.json({ success: true, review: updated });
});

// Products the user has actually bought (completed orders) but hasn't
// reviewed yet — powers the "gợi ý đánh giá" prompt so the user doesn't
// have to hunt down what they've already bought to leave a review for.
app.get('/api/user/review-suggestions', async (req, res) => {
  const user = await getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Vui lòng đăng nhập' });

  const orderCol = db.collection<Order>('orders');
  const reviewCol = db.collection<Review>('reviews');

  const myOrders = await orderCol.find({ userId: user.id, status: 'completed' }, ORDERS_WITHOUT_ACCOUNTS);
  const reviewedProductIds = new Set((await reviewCol.find({ userId: user.id })).map((r) => r.productId));

  const seen = new Set<string>();
  const suggestions: { productId: string; productName: string }[] = [];
  for (const o of myOrders) {
    if (reviewedProductIds.has(o.productId) || seen.has(o.productId)) continue;
    seen.add(o.productId);
    suggestions.push({ productId: o.productId, productName: o.productName });
  }

  res.json({ suggestions });
});

// Quick-pick comment phrases shown in the review form — public read; the
// pool itself is only ever managed through the admin CRUD endpoints below.
app.get('/api/review-comment-suggestions', async (req, res) => {
  const suggestionCol = db.collection<ReviewSuggestion>('review_suggestions');
  const suggestions = await suggestionCol.find();
  res.json({ suggestions });
});

const REVIEW_SUGGESTION_LANGUAGES: Language[] = ['vn', 'en', 'zh', 'th', 'ja'];

// Every suggestion needs real text in all 4 languages — a partial object
// would leave the pill blank for whichever language wasn't filled in.
function parseReviewSuggestionText(body: any): Record<Language, string> | null {
  const text: Partial<Record<Language, string>> = {};
  for (const lang of REVIEW_SUGGESTION_LANGUAGES) {
    const value = String(body?.text?.[lang] || '').trim().slice(0, 300);
    if (!value) return null;
    text[lang] = value;
  }
  return text as Record<Language, string>;
}

// Admin-only CRUD over the review-suggestion phrase pool ("câu đánh giá đề
// xuất") — add/edit/delete, stored in the review_suggestions collection.
app.post('/api/admin/review-comment-suggestions', requireRole('admin'), async (req, res) => {
  const text = parseReviewSuggestionText(req.body);
  if (!text) return res.status(400).json({ error: 'Vui lòng nhập nội dung gợi ý cho đủ cả 4 ngôn ngữ' });
  const suggestionCol = db.collection<ReviewSuggestion>('review_suggestions');
  const newSuggestion: ReviewSuggestion = { id: 'sug_' + generateObjectId(), text, createdAt: new Date().toISOString() };
  await suggestionCol.insertOne(newSuggestion);
  res.json({ success: true, suggestion: newSuggestion });
});

app.put('/api/admin/review-comment-suggestions/:id', requireRole('admin'), async (req, res) => {
  const text = parseReviewSuggestionText(req.body);
  if (!text) return res.status(400).json({ error: 'Vui lòng nhập nội dung gợi ý cho đủ cả 4 ngôn ngữ' });
  const suggestionCol = db.collection<ReviewSuggestion>('review_suggestions');
  const result = await suggestionCol.updateOne({ id: req.params.id }, { $set: { text } });
  if (result.matchedCount === 0) return res.status(404).json({ error: 'Không tìm thấy gợi ý này' });
  const updated = await suggestionCol.findOne({ id: req.params.id });
  res.json({ success: true, suggestion: updated });
});

app.delete('/api/admin/review-comment-suggestions/:id', requireRole('admin'), async (req, res) => {
  const suggestionCol = db.collection<ReviewSuggestion>('review_suggestions');
  await suggestionCol.deleteOne({ id: req.params.id });
  res.json({ success: true });
});

// Reviews for admin/CTV moderation visibility — admin sees every review in
// the system, a CTV only sees reviews on their own products (same
// ownership rule used for CTV stats). Lets them spot low-rated ("xấu")
// reviews to reach out to the buyer about — the actual outreach happens
// outside the app (Telegram etc.); this endpoint only provides the list.
app.get('/api/admin/reviews', requireRole('admin', 'ctv'), async (req, res) => {
  const user = (await getSessionUser(req))!;
  const reviewCol = db.collection<Review>('reviews');
  const prodCol = db.collection<Product>('products');
  const invCol = db.collection<any>('inventory');
  const orderCol = db.collection<Order>('orders');

  const allReviews = await reviewCol.find();
  const allProducts = await prodCol.find();
  const productById = new Map(allProducts.map((p) => [p.id, p]));

  let scopedReviews = allReviews;
  if (user.role === 'ctv') {
    // A product "involves" this CTV if admin has authorized them on it, or
    // they've ever actually uploaded stock to it (covers a product whose
    // authorization was later revoked — the CTV should still see reviews
    // tied to accounts they personally handed over). Combines still-unsold
    // inventory rows (never pruned) with orders' uploaderBreakdown
    // (permanent) so a product stays in scope even after its old sold
    // inventory rows get cleaned up (see cleanupOldSoldInventory).
    const myProductIds = new Set<string>(allProducts.filter((p) => p.authorizedCtvIds?.includes(user.id)).map((p) => p.id));
    for (const row of await invCol.groupBy('productId', { uploadedByUserId: user.id, isSold: false })) myProductIds.add(row.key);
    const allOrders = await orderCol.find({}, ORDERS_WITHOUT_ACCOUNTS);
    for (const o of allOrders) {
      if (o.uploaderBreakdown?.some((e) => e.userId === user.id)) myProductIds.add(o.productId);
    }
    scopedReviews = allReviews.filter((r) => myProductIds.has(r.productId));
  }

  scopedReviews.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  res.json({
    reviews: scopedReviews.map((r) => ({ ...r, productName: productById.get(r.productId)?.name || r.productId })),
    editableMaxRating: REVIEW_EDITABLE_MAX_RATING,
  });
});

// 5. Random Sample Preview (MongoDB: inventory find)
const sampleRequestHistory: Record<string, number[]> = {};
app.get('/api/products/:id/sample', async (req, res) => {
  const prodCol = db.collection<Product>('products');
  const product = await prodCol.findOne({ id: req.params.id });
  if (!product) return res.status(404).json({ error: 'Product not found' });

  const user = await getSessionUser(req);
  const identity = user ? user.id : req.ip;
  const { allowed, remaining, retryAfterMs } = takeSampleView(`${identity}:${product.id}`);
  if (!allowed) {
    const waitMins = Math.max(1, Math.ceil(retryAfterMs / 60000));
    const hours = Math.floor(waitMins / 60);
    const mins = waitMins % 60;
    const waitText = hours > 0 ? `${hours} giờ ${mins > 0 ? mins + ' phút' : ''}`.trim() : `${mins} phút`;
    return res.status(429).json({
      error: `Bạn đã dùng hết lượt xem mẫu miễn phí hôm nay cho sản phẩm này. Vui lòng thử lại sau ${waitText}.`,
      remainingViews: 0,
    });
  }

  const invCol = db.collection<any>('inventory');
  // Count and one random row, both inside the database - this is a public
  // endpoint, so it must not load the product's whole stock just to pick one.
  const availableCount = await invCol.countDocuments({ productId: product.id, isSold: false });
  if (availableCount === 0) {
    return res.status(404).json({ error: 'Hiện không có tài khoản nào trong kho để xem mẫu', totalStockAvailable: 0 });
  }
  const [sampleRow] = await invCol.sample({ productId: product.id, isSold: false }, 1);
  if (!sampleRow) {
    return res.status(404).json({ error: 'Hiện không có tài khoản nào trong kho để xem mẫu', totalStockAvailable: 0 });
  }

  const rawSample = sampleRow.accountData;
  const catKey = (product.categorySlug || product.image || '').toLowerCase();

  const parts = rawSample.split('|');
  let u = parts[0] ? parts[0].trim() : '';
  if (u.includes('@')) {
    u = u.split('@')[0];
  }
  // If it's a numeric UID, map to a short display handle; otherwise use the
  // real stored username as-is. Always derived from the actual inventory
  // record — never a fabricated placeholder.
  let cleanUsername = '';
  if (/^\d+$/.test(u)) {
    cleanUsername = catKey === 'twitter' ? `x_${u.slice(-6)}` : `id_${u.slice(-8)}`;
  } else if (u.length > 0) {
    cleanUsername = u;
  }

  if (!cleanUsername) {
    return res.status(500).json({ error: 'Không thể đọc dữ liệu tài khoản mẫu từ kho' });
  }

  // Construct direct profile URL based on platform
  let profileUrl = `https://x.com/${cleanUsername}`;
  let displayLink = `x.com/${cleanUsername}`;
  let platform = 'Twitter / X';

  if (catKey.includes('twitter') || product.name.toLowerCase().includes('twitter') || product.name.toLowerCase().includes('x ')) {
    profileUrl = `https://x.com/${cleanUsername}`;
    displayLink = `x.com/${cleanUsername}`;
    platform = 'Twitter / X';
  } else if (catKey.includes('facebook') || product.name.toLowerCase().includes('facebook') || product.name.toLowerCase().includes('fb')) {
    profileUrl = `https://facebook.com/${cleanUsername}`;
    displayLink = `facebook.com/${cleanUsername}`;
    platform = 'Facebook';
  } else if (catKey.includes('instagram')) {
    profileUrl = `https://instagram.com/${cleanUsername}`;
    displayLink = `instagram.com/${cleanUsername}`;
    platform = 'Instagram';
  } else if (catKey.includes('telegram')) {
    profileUrl = `https://t.me/${cleanUsername}`;
    displayLink = `t.me/${cleanUsername}`;
    platform = 'Telegram';
  } else if (catKey.includes('tiktok')) {
    profileUrl = `https://tiktok.com/@${cleanUsername}`;
    displayLink = `tiktok.com/@${cleanUsername}`;
    platform = 'TikTok';
  } else if (catKey.includes('discord')) {
    profileUrl = `https://discord.com`;
    displayLink = `discord.com/users/${cleanUsername}`;
    platform = 'Discord';
  } else if (catKey.includes('kling')) {
    profileUrl = `https://klingai.com`;
    displayLink = `klingai.com/@${cleanUsername}`;
    platform = 'Kling AI';
  } else if (catKey.includes('gmail') || catKey.includes('google')) {
    profileUrl = `https://mail.google.com`;
    displayLink = `${cleanUsername}@gmail.com`;
    platform = 'Gmail / Google';
  }

  res.json({
    sample: `Tài khoản: ${cleanUsername}`,
    usernameOnly: cleanUsername,
    profileUrl,
    displayLink,
    platform,
    status: 'Live & Sẵn sàng',
    remainingViews: remaining,
    totalStockAvailable: availableCount,
  });
});

// Same role/VIP discount math used by checkout — pulled out so pre-order
// fulfillment (which prices an order at delivery time, not at the moment the
// pre-order was placed) can price it identically instead of duplicating the
// logic and risking the two ever drifting apart.
// CTV/admin no longer get an automatic role-based discount when buying —
// they pay the exact listed price, same as a regular user with no VIP tier
// yet. Only the VIP-by-deposit system below still applies (role === 'user').
async function computeUnitPriceForUser(user: User, listedPrice: number): Promise<number> {
  let unitPrice = listedPrice;
  if (user.role === 'user') {
    const totalDeposited = await computeTotalDeposited(user.id);
    const vipDiscountPercent = getVipTier(totalDeposited).discountPercent;
    if (vipDiscountPercent > 0) {
      unitPrice = Number((unitPrice * (1 - vipDiscountPercent / 100)).toFixed(3));
    }
  }
  return unitPrice;
}

// Runs right after new stock is imported for a variant — walks that
// variant's pending pre-orders oldest-first (FIFO) and auto-delivers as many
// as the fresh stock covers. Money was already taken when each pre-order was
// placed (heldAmount/unitPrice locked in then — see POST .../preorder), so
// delivery here never touches balance again, just claims stock and hands it
// over at the price that was already charged. If a stock claim can't cover
// the next pre-order's full quantity, fulfillment stops there (the remaining
// stock is left for whichever pre-order needed less, on the next import)
// rather than letting a later, smaller pre-order jump the queue.
async function fulfillPendingPreorders(productId: string, variantId: string): Promise<void> {
  const preorderCol = db.collection<PreOrder>('preorders');
  const invCol = db.collection<any>('inventory');
  const userCol = db.collection<User>('users');
  const prodCol = db.collection<Product>('products');
  const orderCol = db.collection<Order>('orders');

  const pending = (await preorderCol.find({ productId, variantId, status: 'pending' })).sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
  if (pending.length === 0) return;

  const product = await prodCol.findOne({ id: productId });
  const variant = product?.variants.find((v) => v.id === variantId);
  if (!product || !variant || !isValidPrice(Number(variant.price))) return;

  for (const preorder of pending) {
    const candidateItems = await invCol.find({ variantId, isSold: false }, { limit: preorder.quantity });
    if (candidateItems.length < preorder.quantity) break; // not enough fresh stock yet — wait for the next import

    // Single bulkWrite for the whole batch (see the identical fix in
    // POST /api/orders/checkout) — this whole function runs synchronously
    // inside the admin/CTV stock-import request, so N sequential updateOne
    // calls here directly slowed down that request too, not just the buyer.
    const soldAtNow = new Date().toISOString();
    const claimResult = await invCol.bulkWrite(
      candidateItems.map((item) => ({
        filter: { id: item.id, isSold: false },
        update: { $set: { isSold: true, soldToUserId: preorder.userId, soldAt: soldAtNow } },
      }))
    );
    const claimedItems =
      claimResult.matchedCount === candidateItems.length
        ? candidateItems
        : await invCol.find({ id: { $in: candidateItems.map((item) => item.id) }, soldToUserId: preorder.userId, soldAt: soldAtNow });

    if (claimedItems.length < preorder.quantity) {
      await invCol.bulkWrite(claimedItems.map((item) => ({ filter: { id: item.id }, update: { $set: { isSold: false } } })));
      break;
    }

    const releaseClaimed = () =>
      invCol.bulkWrite(claimedItems.map((item) => ({ filter: { id: item.id }, update: { $set: { isSold: false } } })));

    // Take exclusive ownership of this pre-order before touching money: two
    // stock imports finishing at nearly the same time both load the same
    // pending list, and without this guarded flip each would charge and
    // deliver the same pre-order again. Only the request whose update
    // actually matches "still pending" goes on.
    const ownership = await preorderCol.updateOne(
      { id: preorder.id, status: 'pending' },
      { $set: { status: 'fulfilled', fulfilledAt: new Date().toISOString() } }
    );
    if (ownership.matchedCount === 0) {
      await releaseClaimed();
      continue;
    }

    const buyer = await userCol.findOne({ id: preorder.userId });
    if (!buyer) {
      // Account no longer exists — nobody to deliver to, and no balance to
      // refund the hold into either. Hand the reserved stock back and close
      // the pre-order instead of leaving those accounts marked sold with no
      // order behind them.
      await releaseClaimed();
      await preorderCol.updateOne({ id: preorder.id }, { $set: { status: 'cancelled' } });
      continue;
    }

    const deliveredAccounts = claimedItems.map((item) => item.accountData);
    const orderId = 'ord_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const newOrder: Order = {
      id: orderId,
      orderCode: 'XCHEAP-' + Math.random().toString(36).substring(2, 8).toUpperCase(),
      userId: buyer.id,
      username: buyer.username,
      productId: product.id,
      productName: product.name,
      variantId: variant.id,
      variantName: variant.name,
      quantity: preorder.quantity,
      unitPrice: preorder.unitPrice,
      totalPrice: preorder.heldAmount,
      accounts: deliveredAccounts,
      createdAt: new Date().toISOString(),
      status: 'completed',
      uploaderBreakdown: buildUploaderBreakdown(claimedItems),
    };
    await orderCol.insertOne(newOrder);
    await preorderCol.updateOne({ id: preorder.id }, { $set: { orderId } });
  }
}

// 6. Buy / Checkout endpoint (MongoDB: Transaction & Updates)
app.post('/api/orders/checkout', async (req, res) => {
  const { productId, variantId, couponCode } = req.body;
  // Must be a validated positive integer before it ever reaches
  // invCol.find(..., { limit: quantity }) below: MongoCollection.find()
  // only applies .limit() when it's truthy, so quantity: 0 silently
  // returned (and let a buyer claim + receive for free) the entire unsold
  // stock of a variant, and a negative quantity flipped totalPrice negative,
  // crediting the buyer's balance instead of charging it. Mirrors the same
  // validation already used for pre-orders below (POST /:id/preorder).
  const quantity = Math.max(1, Math.floor(Number(req.body.quantity)) || 1);
  const userCol = db.collection<User>('users');
  const prodCol = db.collection<Product>('products');
  const invCol = db.collection<any>('inventory');
  const orderCol = db.collection<Order>('orders');

  const user = await getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Vui lòng đăng nhập để mua hàng' });

  const product = await prodCol.findOne({ id: productId });
  if (!product) return res.status(404).json({ error: 'Product not found' });

  const variant = (product.variants || []).find((v) => v.id === variantId);
  if (!variant) return res.status(404).json({ error: 'Variant not found' });

  // Defense in depth for rows saved before price validation existed — a
  // non-positive / non-finite price must never reach the charge math (a
  // negative total would credit the buyer instead of charging them).
  if (!isValidPrice(Number(variant.price))) {
    return res.status(400).json({ error: 'Giá của sản phẩm này đang không hợp lệ — vui lòng liên hệ admin.' });
  }

  // A product/variant an admin pulled off the storefront (isHidden) must not
  // stay purchasable by anyone who still knows its id — hiding it is how
  // selling gets paused. Admin/CTV keep access, same as they still see hidden
  // items in the product listings.
  if ((product.isHidden || variant.isHidden) && user.role === 'user') {
    return res.status(404).json({ error: 'Sản phẩm này hiện không được bán.' });
  }

  // Lock out coupon guessing before any stock is touched.
  if (couponCode && isCouponLocked(user.id)) {
    return res.status(429).json({ error: COUPON_LOCKED_MESSAGE });
  }

  let unitPrice = await computeUnitPriceForUser(user, variant.price);

  // Reserve real inventory BEFORE any money changes hands. Each claim is
  // guarded on isSold: false in the query itself (not just read then set) so
  // two concurrent buyers racing for the last unit can never both "win" the
  // same account. If the warehouse can't cover the full requested quantity,
  // the checkout fails here — nothing is charged and nothing fabricated.
  const candidateItems = await invCol.find({ variantId: variant.id, isSold: false }, { limit: quantity });
  if (candidateItems.length < quantity) {
    return res.status(400).json({
      error: `Kho không đủ hàng cho biến thể này — chỉ còn ${candidateItems.length}/${quantity} tài khoản sẵn sàng.`,
      availableStock: candidateItems.length,
    });
  }

  // One bulkWrite for the whole batch instead of one updateOne per item —
  // buying a large quantity used to mean that many sequential DB round-trips
  // (seconds to minutes for a few hundred accounts); this is a single
  // round-trip regardless of quantity. Each op still carries its own
  // isSold:false guard, so the race-safety against concurrent buyers is
  // unchanged. bulkWrite only reports an aggregate matchedCount, not which
  // specific ops matched — but since candidateItems were just read as
  // isSold:false a moment ago, matchedCount === candidateItems.length in the
  // overwhelming majority of requests (no concurrent claim happened in that
  // gap), so the fast path skips the extra verification read entirely; the
  // rarer case (a race actually occurred) is verified precisely below.
  const soldAtNow = new Date().toISOString();
  const claimResult = await invCol.bulkWrite(
    candidateItems.map((item) => ({
      filter: { id: item.id, isSold: false },
      update: { $set: { isSold: true, soldToUserId: user.id, soldAt: soldAtNow } },
    }))
  );
  const claimedItems =
    claimResult.matchedCount === candidateItems.length
      ? candidateItems
      : await invCol.find({ id: { $in: candidateItems.map((item) => item.id) }, soldToUserId: user.id, soldAt: soldAtNow });

  const releaseClaimedItems = async () => {
    await invCol.bulkWrite(claimedItems.map((item) => ({ filter: { id: item.id }, update: { $set: { isSold: false } } })));
  };

  if (claimedItems.length < quantity) {
    // Lost the race on some units to a concurrent buyer between the read
    // above and the claim — give back whatever we did manage to claim
    // rather than charging for accounts that were never actually reserved.
    await releaseClaimedItems();
    return res.status(400).json({
      error: 'Kho vừa hết hàng do có đơn khác mua trước — vui lòng thử lại.',
    });
  }

  const deliveredAccounts = claimedItems.map((item) => item.accountData);

  // Voucher redemption — validated and atomically consumed here (guarded on
  // usedCount < maxUses) so concurrent checkouts can never push a code past
  // its redemption limit.
  let redeemedVoucher: Voucher | null = null;
  if (couponCode) {
    const voucherCol = db.collection<Voucher>('vouchers');
    const cleanCode = String(couponCode).trim().toUpperCase();
    const voucher = await voucherCol.findOne({ code: cleanCode });

    // Every rejection below happens AFTER the inventory was reserved above,
    // so each one must hand those accounts back — otherwise anyone could
    // drain the stock just by submitting a bad/expired code.
    const rejectVoucher = async (error: string) => {
      recordCouponFailure(user.id);
      await releaseClaimedItems();
      return res.status(400).json({ error });
    };

    if (!voucher) return rejectVoucher('Mã giảm giá không tồn tại');
    if (voucher.expiresAt && new Date(voucher.expiresAt).getTime() < Date.now()) {
      return rejectVoucher('Mã giảm giá đã hết hạn');
    }
    if (voucher.applicableProductId && voucher.applicableProductId !== productId) {
      return rejectVoucher(
        `Mã giảm giá này chỉ áp dụng cho sản phẩm "${voucher.applicableProductName || voucher.applicableProductId}"`
      );
    }
    if (voucher.applicableVariantId && voucher.applicableVariantId !== variant.id) {
      return rejectVoucher(
        `Mã giảm giá này chỉ áp dụng cho biến thể "${voucher.applicableVariantName || voucher.applicableVariantId}"`
      );
    }

    const redemption = await voucherCol.updateOne(
      { code: cleanCode, usedCount: { $lt: voucher.maxUses } },
      { $inc: { usedCount: 1 } }
    );
    if (redemption.matchedCount === 0) return rejectVoucher('Mã giảm giá đã hết lượt sử dụng');

    redeemedVoucher = voucher;
    unitPrice = Number((unitPrice * (1 - voucher.discountPercent / 100)).toFixed(3));
  }

  const totalPrice = Number((unitPrice * quantity).toFixed(3));

  // Deduct balance atomically, guarded on balance >= totalPrice — this is the
  // real enforcement. Reading user.balance and writing it back with a plain
  // $set (the old code) lets concurrent checkout requests from the same user
  // all read the same starting balance and all pass the check, so firing the
  // buy request several times in parallel could deliver several orders' worth
  // of accounts while only ever deducting the price once.
  const balanceUpdate = await userCol.updateOne(
    { id: user.id, balance: { $gte: totalPrice } },
    { $inc: { balance: -totalPrice } }
  );

  if (balanceUpdate.matchedCount === 0) {
    // Release the inventory we reserved above — the order never actually
    // went through, so those accounts must go back on the shelf.
    await releaseClaimedItems();
    if (redeemedVoucher) {
      // Roll back the redemption — the order never actually went through.
      await db.collection<Voucher>('vouchers').updateOne({ code: redeemedVoucher.code }, { $inc: { usedCount: -1 } });
    }
    return res.status(400).json({
      error: 'Số dư tài khoản không đủ! Vui lòng nạp thêm tiền.',
      required: totalPrice,
      currentBalance: user.balance,
      missing: Number((totalPrice - user.balance).toFixed(3)),
    });
  }

  // Balance was already atomically deducted above — re-read it so the
  // confirmation response shows the true post-purchase balance.
  const updatedUser = await userCol.findOne({ id: user.id });
  const newBalance = updatedUser ? updatedUser.balance : Number((user.balance - totalPrice).toFixed(3));

  // Stock is never stored on the variant — it's always the live count of
  // unsold inventory rows (see GET /api/products), which already reflects
  // this purchase since the accounts above were just marked isSold: true.

  // Insert Order into MongoDB orders collection
  const orderId = 'ord_' + Date.now();
  const newOrder: Order = {
    id: orderId,
    orderCode: 'XCHEAP-' + Math.random().toString(36).substring(2, 8).toUpperCase(),
    userId: user.id,
    username: user.username,
    productId: product.id,
    productName: product.name,
    variantId: variant.id,
    variantName: variant.name,
    quantity,
    unitPrice,
    totalPrice,
    accounts: deliveredAccounts,
    createdAt: new Date().toISOString(),
    status: 'completed',
    uploaderBreakdown: buildUploaderBreakdown(claimedItems),
  };

  await orderCol.insertOne(newOrder);

  res.json({
    success: true,
    order: newOrder,
    newBalance,
    accounts: deliveredAccounts,
  });
});

// Ghi 1 thông báo THẬT vào bảng admin_notifications — không có gì được bịa
// ra ở phía client: chuông thông báo trong Header chỉ hiển thị đúng những gì
// đã được lưu ở đây.
async function notifyAdmin(type: string, title: string, message: string, relatedId?: string): Promise<void> {
  const notifCol = db.collection<AdminNotification>('admin_notifications');
  await notifCol.insertOne({
    id: 'notif_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    type,
    title,
    message,
    createdAt: new Date().toISOString(),
    read: false,
    relatedId,
  });
}

// 6b. Pre-orders — placed against a variant that's currently out of stock.
// Money IS held here now: unitPrice is locked in and heldAmount deducted
// from the buyer's balance immediately, atomically (the same balance-guard
// pattern as checkout, so two concurrent requests can't both pass the
// balance check and overdraw). Delivery later (fulfillPendingPreorders)
// never touches money again — it just claims stock and hands it over. If
// the pre-order expires first (see checkExpiredPreorders), heldAmount is
// refunded back automatically.
const PREORDER_MAX_DURATION_DAYS = 14;

app.post('/api/products/:id/preorder', async (req, res) => {
  const { variantId, quantity = 1, durationDays } = req.body;
  const user = await getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Vui lòng đăng nhập để đặt trước' });

  const prodCol = db.collection<Product>('products');
  const invCol = db.collection<any>('inventory');
  const preorderCol = db.collection<PreOrder>('preorders');
  const userCol = db.collection<User>('users');

  const product = await prodCol.findOne({ id: req.params.id });
  if (!product) return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });
  const variant = (product.variants || []).find((v) => v.id === variantId);
  if (!variant) return res.status(404).json({ error: 'Không tìm thấy phân loại' });
  if ((product.isHidden || variant.isHidden) && user.role === 'user') {
    return res.status(404).json({ error: 'Sản phẩm này hiện không được bán.' });
  }
  if (!isValidPrice(Number(variant.price))) {
    return res.status(400).json({ error: 'Giá của sản phẩm này đang không hợp lệ — vui lòng liên hệ admin.' });
  }

  const cleanQuantity = Math.max(1, Math.floor(Number(quantity)) || 1);
  const cleanDurationDays = Math.min(PREORDER_MAX_DURATION_DAYS, Math.max(1, Math.floor(Number(durationDays)) || PREORDER_MAX_DURATION_DAYS));

  // Đặt trước chỉ áp dụng khi phân loại này thực sự đang hết hàng — còn hàng
  // thì phải mua bình thường qua /api/orders/checkout (giữ nguyên logic trừ
  // tiền + giao ngay đã có, tránh trùng lặp hai luồng mua hàng).
  const stockCount = await invCol.countDocuments({ variantId, isSold: false });
  if (stockCount > 0) {
    return res.status(400).json({ error: 'Phân loại này vẫn còn hàng — vui lòng đặt mua trực tiếp thay vì đặt trước.' });
  }

  const unitPrice = await computeUnitPriceForUser(user, variant.price);
  const chargeAmount = Number((unitPrice * cleanQuantity).toFixed(3));

  // Atomic balance-guarded deduction — same shape as checkout's own charge:
  // the filter itself requires enough balance, so a race between two
  // requests from the same account can never let both through.
  const charge = await userCol.updateOne({ id: user.id, balance: { $gte: chargeAmount } }, { $inc: { balance: -chargeAmount } });
  if (charge.matchedCount === 0) {
    return res.status(400).json({ error: `Số dư không đủ để đặt trước (cần $${chargeAmount.toFixed(2)}).` });
  }

  // Nếu user đã có 1 đơn đặt trước đang chờ (pending) cho đúng phân loại
  // này, cộng dồn số lượng + tiền giữ vào đơn cũ thay vì tạo thêm bản ghi
  // trùng lặp. Hạn tự hủy (expiresAt) giữ nguyên theo đơn gốc — nạp thêm
  // không kéo dài thời hạn.
  const existing = await preorderCol.findOne({ userId: user.id, variantId, status: 'pending' });
  if (existing) {
    await preorderCol.updateOne(
      { id: existing.id },
      { $inc: { quantity: cleanQuantity, heldAmount: chargeAmount }, $set: { unitPrice } }
    );
    const updated = await preorderCol.findOne({ id: existing.id });
    await notifyAdmin(
      'preorder_placed',
      `Đặt trước thêm: ${product.name}`,
      `${user.username} vừa đặt trước thêm ${cleanQuantity} tài khoản "${variant.name}" (tổng ${updated?.quantity ?? cleanQuantity}, đã giữ $${(updated?.heldAmount ?? chargeAmount).toFixed(2)}).`,
      existing.id
    );
    return res.json({ success: true, preorder: updated });
  }

  const nowIso = new Date().toISOString();
  const newPreorder: PreOrder = {
    id: 'pre_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    userId: user.id,
    username: user.username,
    productId: product.id,
    productName: product.name,
    variantId: variant.id,
    variantName: variant.name,
    quantity: cleanQuantity,
    unitPrice,
    heldAmount: chargeAmount,
    durationDays: cleanDurationDays,
    createdAt: nowIso,
    expiresAt: new Date(Date.now() + cleanDurationDays * 24 * 60 * 60 * 1000).toISOString(),
    status: 'pending',
  };
  await preorderCol.insertOne(newPreorder);
  await notifyAdmin(
    'preorder_placed',
    `Đặt trước mới: ${product.name}`,
    `${user.username} vừa đặt trước ${cleanQuantity} tài khoản "${variant.name}", đã giữ $${chargeAmount.toFixed(2)} — tự hủy và hoàn tiền sau ${cleanDurationDays} ngày nếu chưa có hàng.`,
    newPreorder.id
  );
  res.json({ success: true, preorder: newPreorder });
});

// Current user's own pre-orders — shown on the Account page so they can
// track status (pending / fulfilled / needs balance topped up / cancelled).
app.get('/api/user/preorders', async (req, res) => {
  const user = await getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Vui lòng đăng nhập' });
  const preorderCol = db.collection<PreOrder>('preorders');
  const mine = await preorderCol.find({ userId: user.id });
  mine.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  res.json({ preorders: mine });
});

// A user can cancel their own still-pending pre-order — heldAmount goes
// straight back to their balance since it was deducted up front at
// placement time (see POST .../preorder).
app.delete('/api/user/preorders/:id', async (req, res) => {
  const user = await getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Vui lòng đăng nhập' });
  const preorderCol = db.collection<PreOrder>('preorders');
  const userCol = db.collection<User>('users');
  const preorder = await preorderCol.findOne({ id: req.params.id });
  if (!preorder || preorder.userId !== user.id) return res.status(404).json({ error: 'Không tìm thấy đơn đặt trước' });
  if (preorder.status !== 'pending') {
    return res.status(400).json({ error: 'Đơn đặt trước này không còn ở trạng thái chờ để hủy' });
  }
  // Ownership flip first (same race-guard reasoning as fulfillPendingPreorders)
  // so a cancel racing against fulfillment/expiry can't double-refund.
  const ownership = await preorderCol.updateOne(
    { id: req.params.id, status: 'pending' },
    { $set: { status: 'cancelled', refundedAt: new Date().toISOString() } }
  );
  if (ownership.matchedCount === 0) {
    return res.status(400).json({ error: 'Đơn đặt trước này không còn ở trạng thái chờ để hủy' });
  }
  // heldAmount is missing (undefined) on pre-orders placed before the "hold
  // funds up front" feature existed — see checkExpiredPreorders for why
  // Number(...) || 0 here is the correct refund, not just a crash-guard.
  const refundAmount = Number(preorder.heldAmount) || 0;
  await userCol.updateOne({ id: user.id }, { $inc: { balance: refundAmount } });
  res.json({ success: true, refundedAmount: refundAmount });
});

// Admin visibility over every pre-order in the system, across all users.
app.get('/api/admin/preorders', requireRole('admin'), async (req, res) => {
  const preorderCol = db.collection<PreOrder>('preorders');
  const all = await preorderCol.find();
  all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  res.json({ preorders: all });
});

// Admin can force-cancel any user's still-pending pre-order (e.g. the buyer
// can't be reached, or the product is being discontinued before the normal
// per-product delete flow runs) — same refund behavior as the buyer's own
// cancel (DELETE /api/user/preorders/:id), just without the ownership check.
app.delete('/api/admin/preorders/:id', requireRole('admin'), async (req, res) => {
  const preorderCol = db.collection<PreOrder>('preorders');
  const userCol = db.collection<User>('users');
  const preorder = await preorderCol.findOne({ id: req.params.id });
  if (!preorder) return res.status(404).json({ error: 'Không tìm thấy đơn đặt trước' });
  if (preorder.status !== 'pending') {
    return res.status(400).json({ error: 'Đơn đặt trước này không còn ở trạng thái chờ để hủy' });
  }
  // Same ownership-flip guard as every other cancel/fulfill path, so this
  // can never race a buyer's own cancel or a stock import fulfilling it at
  // nearly the same moment into a double refund.
  const ownership = await preorderCol.updateOne(
    { id: req.params.id, status: 'pending' },
    { $set: { status: 'cancelled', refundedAt: new Date().toISOString() } }
  );
  if (ownership.matchedCount === 0) {
    return res.status(400).json({ error: 'Đơn đặt trước này không còn ở trạng thái chờ để hủy' });
  }
  // heldAmount is missing (undefined) on pre-orders placed before the "hold
  // funds up front" feature existed — see checkExpiredPreorders for why
  // Number(...) || 0 here is the correct refund, not just a crash-guard.
  const refundAmount = Number(preorder.heldAmount) || 0;
  await userCol.updateOne({ id: preorder.userId }, { $inc: { balance: refundAmount } });
  const admin = (await getSessionUser(req))!;
  await logAdminAction(admin, 'preorder.cancel', `Hủy đơn đặt trước "${preorder.productName}" của ${preorder.username}, hoàn $${refundAmount}`, preorder.id);
  res.json({ success: true, refundedAmount: refundAmount });
});

// Real admin notifications (currently: a user placing/adding to a
// pre-order). The header bell polls this instead of showing a fixed,
// hardcoded badge.
app.get('/api/admin/notifications', requireRole('admin'), async (req, res) => {
  const notifCol = db.collection<AdminNotification>('admin_notifications');
  const all = await notifCol.find();
  all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  res.json({ notifications: all.slice(0, 50), unreadCount: all.filter((n) => !n.read).length });
});

app.post('/api/admin/notifications/read-all', requireRole('admin'), async (req, res) => {
  const notifCol = db.collection<AdminNotification>('admin_notifications');
  const unread = await notifCol.find({ read: false });
  for (const n of unread) {
    await notifCol.updateOne({ id: n.id }, { $set: { read: true } });
  }
  res.json({ success: true });
});

// 7. Get Orders (MongoDB: find)
// Always scoped to the caller's own purchases, regardless of role — admin
// and CTV manage every order platform-wide from their own dedicated
// endpoints instead (GET /api/admin/orders, GET /api/ctv/orders), not from
// here. Keeping this one strictly "my own orders" means an admin's personal
// /orders page never doubles as an accidental all-orders view again.
app.get('/api/orders', async (req, res) => {
  const orderCol = db.collection<Order>('orders');
  const user = await getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Vui lòng đăng nhập' });

  let matching = await orderCol.find({ userId: user.id });
  matching.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Can only ever see the last 7 days of purchase history through this
  // endpoint — enforced here, not just hidden in the UI, so a direct API
  // call can't bypass it. Order rows themselves are never deleted for this;
  // it's purely a visibility limit.
  const USER_ORDER_VIEW_WINDOW_DAYS = 7;
  const cutoffMs = Date.now() - USER_ORDER_VIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  matching = matching.filter((o) => new Date(o.createdAt).getTime() >= cutoffMs);

  // page/limit are optional — omitting them keeps returning the full list
  // (unchanged behavior for the in-app Orders modal), so this stays
  // backward-compatible while giving API callers real pagination.
  const rawPage = req.query.page ? parseInt(String(req.query.page), 10) : NaN;
  const rawLimit = req.query.limit ? parseInt(String(req.query.limit), 10) : NaN;
  if (!isNaN(rawPage) || !isNaN(rawLimit)) {
    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 20;
    const start = (page - 1) * limit;
    return res.json({ orders: matching.slice(start, start + limit), total: matching.length, page, limit });
  }

  res.json({ orders: matching });
});

// Single order detail, looked up by its user-facing order code — a
// registered user can only view their own orders (Admin can view any).
app.get('/api/orders/:orderCode', async (req, res) => {
  const orderCol = db.collection<Order>('orders');
  const user = await getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Vui lòng đăng nhập' });

  const order = await orderCol.findOne({ orderCode: req.params.orderCode });
  if (!order || (order.userId !== user.id && user.role !== 'admin')) {
    return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });
  }

  res.json({ order });
});

// Admin order management — every order platform-wide. Kept separate from
// GET /api/orders (which is always "my own purchases only", any role) so
// an admin's personal order history can never again double as an
// accidental all-orders view.
app.get('/api/admin/orders', requireRole('admin'), async (req, res) => {
  const orderCol = db.collection<Order>('orders');
  const orders = await orderCol.find({}, ORDERS_WITHOUT_ACCOUNTS);
  orders.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  res.json({ orders });
});

// Full detail for one order, including the delivered account credentials —
// the list endpoint above strips `accounts` to keep the table light, so the
// admin UI fetches this only when someone opens a specific order (e.g. to
// answer "I didn't receive my account" disputes).
app.get('/api/admin/orders/:orderCode', requireRole('admin'), async (req, res) => {
  const orderCol = db.collection<Order>('orders');
  const order = await orderCol.findOne({ orderCode: req.params.orderCode });
  if (!order) return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });
  const claims = await db.collection<WarrantyClaim>('warranty_claims').find({ orderCode: order.orderCode });
  claims.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  res.json({ order, claims, warranty: warrantyStatus(order, claims) });
});

// Warranty: a claim is only valid within WARRANTY_WINDOW_MS of the purchase
// and only on an order that hasn't been refunded. Replacements can never
// exceed the quantity the buyer actually bought, counted across every claim
// on that order together.
const WARRANTY_WINDOW_MS = 72 * 60 * 60 * 1000;

function warrantyStatus(order: Order, claims: WarrantyClaim[]) {
  const windowEndsAt = new Date(new Date(order.createdAt).getTime() + WARRANTY_WINDOW_MS).toISOString();
  const replacedCount = claims.reduce((sum, c) => sum + (c.replacements?.length || 0), 0);
  return {
    windowEndsAt,
    withinWindow: order.status !== 'refunded' && Date.now() <= new Date(windowEndsAt).getTime(),
    replacedCount,
    replaceRemaining: Math.max(0, order.quantity - replacedCount),
  };
}

app.post('/api/admin/orders/:orderCode/warranty/replace', requireRole('admin'), async (req, res) => {
  const orderCol = db.collection<Order>('orders');
  const invCol = db.collection<any>('inventory');
  const claimCol = db.collection<WarrantyClaim>('warranty_claims');

  const order = await orderCol.findOne({ orderCode: req.params.orderCode });
  if (!order) return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });
  const claims = await claimCol.find({ orderCode: order.orderCode });
  const status = warrantyStatus(order, claims);
  if (!status.withinWindow) {
    return res.status(400).json({ error: 'Đơn này không còn trong thời hạn bảo hành (72 giờ) hoặc đã hoàn tiền' });
  }

  const input = req.body?.brokenAccounts;
  if (!Array.isArray(input) || input.length === 0 || !input.every((s) => typeof s === 'string')) {
    return res.status(400).json({ error: 'Vui lòng chọn ít nhất một tài khoản lỗi' });
  }
  const broken = Array.from(new Set(input as string[]));
  if (broken.length > status.replaceRemaining) {
    return res.status(400).json({ error: `Chỉ còn có thể bù tối đa ${status.replaceRemaining} tài khoản cho đơn này` });
  }
  if (broken.some((b) => !order.accounts.includes(b))) {
    return res.status(400).json({ error: 'Có tài khoản không thuộc đơn này' });
  }

  // The CTV who supplied each broken account is recorded on the sold
  // inventory row (still kept for 1 month — see cleanupOldSoldInventory).
  const soldRows = await invCol.find({
    variantId: order.variantId,
    isSold: true,
    soldToUserId: order.userId,
    accountData: { $in: broken },
  });
  const supplierOf = new Map<string, { id: string; username: string }>();
  for (const row of soldRows) {
    if (row.uploadedByUserId) supplierOf.set(row.accountData, { id: row.uploadedByUserId, username: row.uploadedByUsername || '' });
  }
  const unresolved = broken.filter((b) => !supplierOf.has(b));
  if (unresolved.length > 0) {
    return res.status(400).json({ error: 'Không xác định được CTV cung cấp một số tài khoản lỗi — chỉ có thể hoàn tiền cho đơn này' });
  }

  // Claim one unsold account per broken one, from that same CTV's stock.
  // Each claim is guarded on isSold:false so a concurrent buyer can't take it.
  const claimedIds: string[] = [];
  const replacementFor = new Map<string, string>();
  const releaseClaimed = async () => {
    for (const id of claimedIds) {
      await invCol.updateOne({ id }, { $set: { isSold: false } });
    }
  };
  for (const b of broken) {
    const supplier = supplierOf.get(b)!;
    const candidates = await invCol.find(
      { variantId: order.variantId, isSold: false, uploadedByUserId: supplier.id },
      { limit: 20 }
    );
    let picked: any = null;
    for (const cand of candidates) {
      const claim = await invCol.updateOne(
        { id: cand.id, isSold: false },
        { $set: { isSold: true, soldToUserId: order.userId, soldAt: new Date().toISOString() } }
      );
      if (claim.matchedCount === 1) {
        picked = cand;
        break;
      }
    }
    if (!picked) {
      await releaseClaimed();
      return res.status(400).json({
        error: `Kho của CTV "${supplier.username}" không còn tài khoản để bù — chỉ có thể hoàn tiền cho đơn này`,
      });
    }
    claimedIds.push(picked.id);
    replacementFor.set(b, picked.accountData);
  }

  const newAccounts = order.accounts.map((a) => replacementFor.get(a) ?? a);
  const replacementList = broken.map((b) => replacementFor.get(b)!);
  await orderCol.updateOne(
    { orderCode: order.orderCode },
    {
      $set: {
        accounts: newAccounts,
        warrantyReplacedCount: (order.warrantyReplacedCount || 0) + broken.length,
        warrantyReplacedAccounts: [...(order.warrantyReplacedAccounts || []), ...replacementList],
      },
    }
  );

  const admin = (await getSessionUser(req))!;
  const claim: WarrantyClaim = {
    id: 'war_' + generateObjectId(),
    orderCode: order.orderCode,
    userId: order.userId,
    username: order.username,
    action: 'replace',
    replacements: broken.map((b) => ({ broken: b, replacement: replacementFor.get(b)!, ctvUserId: supplierOf.get(b)!.id })),
    createdAt: new Date().toISOString(),
    adminId: admin.id,
    adminUsername: admin.username,
  };
  await claimCol.insertOne(claim);
  await logAdminAction(admin, 'warranty.replace', `Bù ${broken.length} tài khoản lỗi cho đơn #${order.orderCode} của ${order.username}`, order.orderCode);
  res.json({ success: true, claim, accounts: newAccounts });
});

app.post('/api/admin/orders/:orderCode/warranty/refund', requireRole('admin'), async (req, res) => {
  const orderCol = db.collection<Order>('orders');
  const userCol = db.collection<User>('users');
  const claimCol = db.collection<WarrantyClaim>('warranty_claims');

  const order = await orderCol.findOne({ orderCode: req.params.orderCode });
  if (!order) return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });
  const claims = await claimCol.find({ orderCode: order.orderCode });
  if (!warrantyStatus(order, claims).withinWindow) {
    return res.status(400).json({ error: 'Đơn này không còn trong thời hạn bảo hành (72 giờ) hoặc đã hoàn tiền' });
  }

  // Same guarded status flip as the regular order refund: only credit the
  // wallet if this update actually claimed the order.
  const refundedAt = new Date().toISOString();
  const flip = await orderCol.updateOne(
    { orderCode: order.orderCode, status: { $ne: 'refunded' } },
    { $set: { status: 'refunded', refundedAt } }
  );
  if (flip.matchedCount === 0) {
    return res.status(400).json({ error: 'Đơn hàng này đã được hoàn tiền trước đó' });
  }
  try {
    await userCol.updateOne({ id: order.userId }, { $inc: { balance: order.totalPrice } });
  } catch (err) {
    await orderCol.updateOne({ orderCode: order.orderCode }, { $set: { status: 'completed', refundedAt: '' } });
    throw err;
  }

  const admin = (await getSessionUser(req))!;
  const claim: WarrantyClaim = {
    id: 'war_' + generateObjectId(),
    orderCode: order.orderCode,
    userId: order.userId,
    username: order.username,
    action: 'refund',
    createdAt: refundedAt,
    adminId: admin.id,
    adminUsername: admin.username,
  };
  await claimCol.insertOne(claim);
  await logAdminAction(admin, 'warranty.refund', `Hoàn tiền bảo hành đơn #${order.orderCode} ($${order.totalPrice}) cho ${order.username}`, order.orderCode);
  res.json({ success: true, claim });
});

// CTV order management — only orders this CTV actually contributed stock to
// (has an entry in uploaderBreakdown; buildUploaderBreakdown and
// ctvShareOfOrder are defined further down but hoisted — this route only
// runs at request time, well after the whole module has finished loading).
// A CTV who's uploaded nothing sees an empty list here, never another
// CTV's orders.
app.get('/api/ctv/orders', requireRole('admin', 'ctv'), async (req, res) => {
  const orderCol = db.collection<Order>('orders');

  const ctvUser = (await getSessionUser(req))!;
  const allOrders = await orderCol.find({}, ORDERS_WITHOUT_ACCOUNTS);
  // An order shows up here if this CTV uploaded any part of what it
  // contains — admin can grant several CTVs the same product, so "products
  // I'm authorized on" no longer decides this on its own.
  const myOrders = allOrders
    .filter((o) => o.uploaderBreakdown?.some((e) => e.userId === ctvUser.id))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  res.json({ orders: myOrders });
});

// Refund — credits the order's totalPrice straight back to the buyer's
// wallet balance and marks the order refunded. Never touches inventory:
// the accounts were already handed over (and the buyer has already seen
// the credentials), so a refund here means "money back", not "un-sell the
// stock" — that would let a buyer who already grabbed working credentials
// get both the accounts and their money back. Admin can refund any order;
// a CTV can only refund an order for one of their own products.
app.post('/api/orders/:orderCode/refund', requireRole('admin', 'ctv'), async (req, res) => {
  const orderCol = db.collection<Order>('orders');
  const userCol = db.collection<User>('users');

  const order = await orderCol.findOne({ orderCode: req.params.orderCode });
  if (!order) return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });
  if (order.status === 'refunded') return res.status(400).json({ error: 'Đơn hàng này đã được hoàn tiền trước đó' });

  const actor = (await getSessionUser(req))!;
  // A CTV can refund an order if they uploaded any part of what it
  // contains — admin can grant several CTVs the same product, so "products
  // I'm authorized on" no longer decides this. There's no partial refund,
  // so any contributing CTV can refund the whole order (matches the
  // existing all-or-nothing refund model).
  if (actor.role === 'ctv' && !order.uploaderBreakdown?.some((e) => e.userId === actor.id)) {
    return res.status(403).json({ error: 'Bạn không có quyền hoàn tiền đơn hàng này' });
  }

  // Flip the status FIRST with a guard on "not already refunded", and only
  // credit the wallet if that update actually matched — the earlier
  // read-check-then-credit let parallel refund requests all pass the check
  // and each credit the buyer, paying the same order out several times.
  const refundedAt = new Date().toISOString();
  const claim = await orderCol.updateOne(
    { orderCode: order.orderCode, status: { $ne: 'refunded' } },
    { $set: { status: 'refunded', refundedAt } }
  );
  if (claim.matchedCount === 0) {
    return res.status(400).json({ error: 'Đơn hàng này đã được hoàn tiền trước đó' });
  }
  try {
    await userCol.updateOne({ id: order.userId }, { $inc: { balance: order.totalPrice } });
  } catch (err) {
    // Credit failed after the status flipped — put the order back so the
    // refund can be retried instead of being marked done with no money moved.
    await orderCol.updateOne({ orderCode: order.orderCode }, { $set: { status: 'completed', refundedAt: '' } });
    throw err;
  }

  await logAdminAction(actor, 'order.refund', `Hoàn tiền đơn hàng #${order.orderCode} ($${order.totalPrice}) cho ${order.username}`, order.orderCode);
  const updated = await orderCol.findOne({ orderCode: order.orderCode });
  res.json({ success: true, order: updated });
});

// 8. Deposit Wallets for current user
app.get('/api/deposit/wallets', async (req, res) => {
  const depCol = db.collection<DepositTransaction>('deposits');
  const cryptoOptCol = db.collection<CryptoOption>('crypto_options');
  const user = await getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Vui lòng đăng nhập' });

  const userWallets = await ensureUserDepositWallets(user);
  // A network an admin has hidden from the deposit page must not appear
  // here either — this response is exactly what the deposit modal renders.
  const activeCryptoOptions = (await cryptoOptCol.find()).filter((o) => !o.isHidden);
  // Same reasoning as the public /api/crypto-options — rpcUrl is never read
  // by the deposit modal and must not leak to any logged-in user.
  const optionsWithUserAddress = activeCryptoOptions.map(({ rpcUrl, ...opt }) => ({
    ...opt,
    userDepositAddress: userWallets[opt.id],
  }));

  const userDeposits = await depCol.find({ userId: user.id }, { sort: { timestamp: -1 } });

  res.json({
    wallets: optionsWithUserAddress,
    userBalance: user.balance,
    transactions: userDeposits,
  });
});

// Works out which real on-chain transfer(s) a just-credited amount came from.
// Scans the token's Transfer events into the user's wallet, newest first, back
// to the previous checkpoint. Only answers when the match is unambiguous:
//  - the newest transfers add up to exactly the credited amount -> one row per
//    transfer (amounts adjusted by rounding so the rows still sum to the credit,
//    which VIP tiers are computed from), or
//  - a single transfer covers it (it was larger only because some funds were
//    also swept out in the same window) -> one row for the credited amount.
// Anything else (RPC couldn't read the range, several transfers overshooting the
// amount) returns null and the row keeps no hash — never a guess.
async function findDepositTransactions(
  cfg: CryptoOption,
  address: string,
  credited: number,
  head: number,
  lastCheckedBlock: number | null
): Promise<{ txHash: string; blockNumber: number; amount: number }[] | null> {
  const MAX_LOOKBACK_BLOCKS = 60000;
  const fromBlock = Math.max(lastCheckedBlock !== null ? lastCheckedBlock + 1 : 0, head - MAX_LOOKBACK_BLOCKS, 0);
  const tolerance = 0.0015;
  const total = (list: IncomingTransfer[]) => list.reduce((sum, t) => sum + t.amount, 0);

  const scan = await scanIncomingTransfers(cfg, address, {
    fromBlock,
    toBlock: head,
    maxChunks: 30,
    deadlineMs: 10000,
    retryDelays: [0, 500],
    stopWhen: (found) => total(found) >= credited - tolerance,
  });

  const picked: IncomingTransfer[] = [];
  for (const t of scan.transfers) {
    picked.push(t);
    if (total(picked) >= credited - tolerance) break;
  }
  if (picked.length === 0) return null;
  const sum = total(picked);

  if (Math.abs(sum - credited) <= tolerance) {
    const rows = picked.map((t) => ({ txHash: t.txHash, blockNumber: t.blockNumber, amount: Number(t.amount.toFixed(3)) }));
    const others = rows.slice(0, -1).reduce((s, r) => s + r.amount, 0);
    rows[rows.length - 1].amount = Number((credited - others).toFixed(3));
    return rows.every((r) => r.amount > 0) ? rows : null;
  }
  if (picked.length === 1 && sum > credited) {
    return [{ txHash: picked[0].txHash, blockNumber: picked[0].blockNumber, amount: credited }];
  }
  return null;
}

// Shared by both the user-triggered check (POST /api/deposit/check-rpc) and
// the background poller (pollAllDepositsBatch) below — the only difference
// between them is WHERE onChainBalance/chainHead come from (a single live
// RPC call vs. a batched multicall result). Credit = how much the wallet's
// on-chain balance has GROWN since the last time it was observed (see the
// deposit_checkpoints reasoning at the call sites) — comparing against a
// per-user+network checkpoint, never lifetime totals, so a sweep never
// blocks a later deposit from being credited.
async function creditDepositFromOnChainBalance(
  user: User,
  network: CryptoNetwork,
  cryptoConfig: CryptoOption,
  userAddress: string,
  onChainBalance: number,
  chainHead: number | null
): Promise<{ creditedNow: number; newBalance: number }> {
  const userCol = db.collection<User>('users');
  const depCol = db.collection<DepositTransaction>('deposits');
  const cpCol = db.collection<any>('deposit_checkpoints');

  const checkpoint = await cpCol.findOne({ userId: user.id, network });
  const priorDeposits = await depCol.find({ userId: user.id, network });
  const alreadyCredited = Number(
    priorDeposits.filter((d) => !String(d.id).startsWith('tx_sim_')).reduce((sum, d) => sum + d.amount, 0).toFixed(3)
  );
  const baseline: number = checkpoint ? Number(checkpoint.lastBalance) : alreadyCredited;
  const newDepositDelta = onChainBalance - baseline;

  let creditedNow = 0;
  let newBalance = user.balance;

  const previousBlock = checkpoint && typeof checkpoint.lastBlock === 'number' ? checkpoint.lastBlock : null;
  const checkpointFields: Record<string, any> = { lastBalance: onChainBalance, updatedAt: new Date().toISOString() };
  if (chainHead !== null) checkpointFields.lastBlock = chainHead;
  if (checkpoint) {
    await cpCol.updateOne({ userId: user.id, network }, { $set: checkpointFields });
  } else {
    await cpCol.insertOne({ id: `cp_${user.id}_${network}`, userId: user.id, network, ...checkpointFields });
  }

  // A >=0.001 floor (rather than >0) avoids sub-thousandth floating-point
  // dust re-triggering a $0.000 "deposit" row on every poll.
  if (newDepositDelta >= 0.001) {
    creditedNow = Number(newDepositDelta.toFixed(3));
    try {
      await userCol.updateOne({ id: user.id }, { $inc: { balance: creditedNow } });
      const updatedUser = await userCol.findOne({ id: user.id });
      newBalance = updatedUser ? updatedUser.balance : Number((user.balance + creditedNow).toFixed(3));

      const rowBase = {
        userId: user.id,
        username: user.username,
        network,
        tokenSymbol: cryptoConfig.token,
        walletAddress: userAddress,
        status: 'confirmed' as const,
        detectedVia: cryptoConfig.rpcUrl,
      };
      const stamp = Date.now();
      const provisional: DepositTransaction = {
        id: 'tx_' + stamp,
        ...rowBase,
        amount: creditedNow,
        txHash: '',
        blockNumber: chainHead ?? 0,
        timestamp: new Date().toISOString(),
      };
      await depCol.insertOne(provisional);

      if (chainHead !== null) {
        const head = chainHead;
        const resolveHashes = async () => {
          try {
            const attributed = await findDepositTransactions(cryptoConfig, userAddress, creditedNow, head, previousBlock);
            if (!attributed) return;
            await depCol.updateOne(
              { id: provisional.id },
              { $set: { amount: attributed[0].amount, txHash: attributed[0].txHash, blockNumber: attributed[0].blockNumber } }
            );
            for (let i = 1; i < attributed.length; i++) {
              await depCol.insertOne({
                id: `tx_${stamp}_${i}`,
                ...rowBase,
                amount: attributed[i].amount,
                txHash: attributed[i].txHash,
                blockNumber: attributed[i].blockNumber,
                timestamp: provisional.timestamp,
              });
            }
          } catch (lookupErr) {
            console.warn(`[Deposit] Could not resolve tx hash for ${creditedNow} ${network} deposit of user ${user.id}:`, lookupErr);
          }
        };
        // Wait for the lookup only briefly so a live caller (the HTTP route)
        // stays responsive; if it's slow it keeps running in the background
        // and fills the hash in on the row when it finishes. The background
        // poller doesn't need this cap for responsiveness but shares it for
        // simplicity — it already runs detached from any request.
        await Promise.race([resolveHashes(), new Promise((resolve) => setTimeout(resolve, 8000))]);
      }
    } catch (err) {
      console.error(`[Deposit] Failed to credit ${creditedNow} for user ${user.id} on ${network} after moving checkpoint — needs manual review.`, err);
      throw err;
    }
  }

  return { creditedNow, newBalance };
}

// Background deposit poller — closes the gap where a user's balance was
// only ever checked when THEY had the deposit modal open (manual click or
// its 15s auto-poll while open). Someone who sends funds and never reopens
// that modal would otherwise sit uncredited indefinitely. Batched via
// Multicall3 (same contract/pattern already proven in sweep_wallets.py — an
// ~11-14x speedup there) so checking every user's wallet on a network costs
// one RPC round trip per chunk of DEPOSIT_POLL_CHUNK addresses, not one call
// per user — the whole reason this can run as a scheduled job at all without
// getting the public RPC endpoints (bsc-dataseed, polygon publicnode, base
// mainnet) rate-limiting or blocking this server.
const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11';
const MULTICALL3_ABI = [
  'function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) payable returns (tuple(bool success, bytes returnData)[] returnData)',
];
const DEPOSIT_POLL_CHUNK = 400;
// TRC (Tron) is deliberately excluded — its deposit-crediting path was
// reverted earlier this project and stays out of scope here; only the
// already-working EVM networks are polled in the background.
const DEPOSIT_POLL_EVM_NETWORKS: CryptoNetwork[] = ['bsc', 'polygon', 'base'];

async function multicallBalances(cryptoConfig: CryptoOption, addresses: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (addresses.length === 0) return result;

  const provider = new ethers.JsonRpcProvider(cryptoConfig.rpcUrl, cryptoConfig.chainId, { staticNetwork: true });
  const multicall = new ethers.Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, provider);
  const erc20Interface = new ethers.Interface(['function balanceOf(address) view returns (uint256)']);

  for (let i = 0; i < addresses.length; i += DEPOSIT_POLL_CHUNK) {
    const chunk = addresses.slice(i, i + DEPOSIT_POLL_CHUNK);
    const calls = chunk.map((addr) => ({
      target: cryptoConfig.contractAddress,
      allowFailure: true,
      callData: erc20Interface.encodeFunctionData('balanceOf', [addr]),
    }));
    try {
      const raw = (await Promise.race([
        multicall.aggregate3.staticCall(calls),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Multicall timeout')), 20000)),
      ])) as { success: boolean; returnData: string }[];
      chunk.forEach((addr, idx) => {
        const entry = raw[idx];
        if (entry?.success && entry.returnData && entry.returnData !== '0x') {
          const [value] = erc20Interface.decodeFunctionResult('balanceOf', entry.returnData) as unknown as [bigint];
          result.set(addr.toLowerCase(), Number(ethers.formatUnits(value, cryptoConfig.decimals)));
        }
      });
    } catch (err) {
      // Leave this chunk's addresses unresolved for this tick — the next
      // scheduled run retries them. Deliberately no fallback to sequential
      // per-address calls here: that's exactly the RPC load this batching
      // exists to avoid, and a 3-minute-later retry costs nothing real.
      console.warn(`[Deposit Poll] Multicall batch failed for ${cryptoConfig.id} (addresses ${i}-${i + chunk.length}):`, err);
    }
  }
  return result;
}

async function pollAllDepositsBatch(): Promise<void> {
  const userCol = db.collection<User>('users');
  const cryptoOptCol = db.collection<CryptoOption>('crypto_options');

  for (const network of DEPOSIT_POLL_EVM_NETWORKS) {
    const cryptoConfig = await cryptoOptCol.findOne({ id: network });
    if (!cryptoConfig || cryptoConfig.isHidden) continue;

    // Only users who already have a deposit wallet for this network (i.e.
    // have opened the deposit modal at least once) — this job never
    // force-generates one, same scoping as the user-triggered check.
    const users = await userCol.find(
      { [`depositWallets.${network}`]: { $exists: true, $ne: '' } },
      { projection: { id: 1, username: 1, balance: 1, role: 1, depositWallets: 1 } }
    );
    if (users.length === 0) continue;

    let chainHead: number | null = null;
    try {
      chainHead = await getChainHead(cryptoConfig, QUICK_RETRY_DELAYS_MS);
    } catch {
      // Left null — creditDepositFromOnChainBalance treats that as "chain
      // head unknown" (checkpoint still updates, just without a block
      // number to resolve the real tx hash from).
    }

    const addresses = users.map((u) => u.depositWallets[network]);
    const balances = await multicallBalances(cryptoConfig, addresses);
    if (balances.size === 0) continue; // whole batch failed this tick — retried next tick

    for (const user of users) {
      const addr = user.depositWallets[network];
      const onChainBalance = balances.get(addr.toLowerCase());
      if (onChainBalance === undefined) continue; // this address's call failed — retried next tick
      try {
        await creditDepositFromOnChainBalance(user, network, cryptoConfig, addr, onChainBalance, chainHead);
      } catch (err) {
        console.error(`[Deposit Poll] Failed crediting user ${user.id} on ${network}:`, err);
      }
    }
  }
}

// 9. Real RPC Check / Poll endpoint
app.post('/api/deposit/check-rpc', async (req, res) => {
  const { network = 'bsc' } = req.body as { network: CryptoNetwork };
  if (typeof network !== 'string') return res.status(400).json({ error: 'Invalid network' });
  const depCol = db.collection<DepositTransaction>('deposits');
  const cryptoOptCol = db.collection<CryptoOption>('crypto_options');
  const user = await getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Vui lòng đăng nhập' });

  const cryptoConfig = await cryptoOptCol.findOne({ id: network });
  if (!cryptoConfig) return res.status(400).json({ error: 'Invalid network' });

  const userAddress = (await ensureUserDepositWallets(user))[network];

  // Serialize concurrent checks for the same user+network — without this,
  // two requests fired in parallel (e.g. the 15s auto-poll overlapping a
  // manual "check now" click, or a scripted flood) would both read the same
  // "already credited" total before either had inserted its deposit row,
  // and both would credit the same on-chain delta a second time.
  const lockKey = `${user.id}:${network}`;
  if (depositCheckInProgress.has(lockKey)) {
    return res.status(429).json({ error: 'Đang kiểm tra giao dịch nạp tiền, vui lòng đợi giây lát' });
  }
  depositCheckInProgress.add(lockKey);

  let onChainBalance = 0;
  let rpcStatus = 'online';
  // True only when the chain was actually queried and answered. A failed or
  // unsupported lookup leaves onChainBalance at 0 — that must never be
  // treated as "the wallet is empty" (it would reset the checkpoint below and
  // re-credit the whole balance on the next successful poll).
  let rpcOk = false;
  // Real chain head as of this check (null when it couldn't be read). Read
  // BEFORE the balance so any transfer landing after it is guaranteed to be
  // covered by the next lookup's block range.
  let chainHead: number | null = null;

  try {
    try {
      if (network === 'bsc' || network === 'polygon' || network === 'base') {
        // Passing the chain id up front skips ethers' automatic network
        // detection handshake — without it, a slow/unreachable RPC endpoint
        // throws "failed to detect network... retry in 1s" in a loop.
        const provider = new ethers.JsonRpcProvider(
          cryptoConfig.rpcUrl,
          cryptoConfig.chainId,
          { staticNetwork: true }
        );
        const tokenContract = new ethers.Contract(
          cryptoConfig.contractAddress,
          ['function balanceOf(address account) view returns (uint256)'],
          provider
        );
        chainHead = await getChainHead(cryptoConfig, QUICK_RETRY_DELAYS_MS);
        const balanceBigInt = (await Promise.race([
          tokenContract.balanceOf(userAddress),
          new Promise((_, reject) => setTimeout(() => reject(new Error('RPC timeout')), 3500)),
        ])) as bigint;
        onChainBalance = Number(ethers.formatUnits(balanceBigInt, cryptoConfig.decimals));
        rpcOk = true;
      }
    } catch (rpcErr: any) {
      rpcStatus = 'active';
    }

    // alreadyCredited is only for the response payload below (nothing in
    // this route relies on it for crediting logic anymore — see
    // creditDepositFromOnChainBalance, which recomputes its own baseline the
    // same way so it stays correct independent of whatever this route does).
    const priorDeposits = await depCol.find({ userId: user.id, network });
    const alreadyCredited = Number(
      priorDeposits.filter((d) => !String(d.id).startsWith('tx_sim_')).reduce((sum, d) => sum + d.amount, 0).toFixed(3)
    );

    let creditedNow = 0;
    let newBalance = user.balance;

    if (rpcOk) {
      ({ creditedNow, newBalance } = await creditDepositFromOnChainBalance(user, network, cryptoConfig, userAddress, onChainBalance, chainHead));
    }

    res.json({
      success: true,
      network,
      userAddress,
      rpcNode: cryptoConfig.rpcUrl,
      rpcStatus,
      blockNumber: chainHead ?? 0,
      onChainBalance,
      alreadyCredited,
      creditedNow,
      currentBalance: newBalance,
    });
  } finally {
    depositCheckInProgress.delete(lockKey);
  }
});

// 10b. Deposit networks (crypto_options) CRUD — lets admin edit display
// fields (name/icon/min deposit/RPC endpoint/contract address...) and
// show/hide/delete/restore a network on the deposit page, without touching
// code. Scoped deliberately to the CryptoNetwork ids the wallet-generation
// system (server/walletVault.ts) already knows how to derive an address
// for ('bsc' | 'polygon' | 'trc' | 'base') — adding real support for a new
// blockchain needs actual wallet/RPC integration code, not just a new row
// here, so create is restricted to that fixed set.
const KNOWN_CRYPTO_NETWORK_IDS: CryptoNetwork[] = ['bsc', 'polygon', 'trc', 'base'];

app.get('/api/crypto-options', async (req, res) => {
  const cryptoOptCol = db.collection<CryptoOption>('crypto_options');
  // rpcUrl is never read by any storefront/deposit frontend code — only the
  // admin config panel (its own /api/admin/crypto-options) needs it. This is
  // a public, unauthenticated endpoint, so a private/paid RPC URL (which can
  // carry a provider API key in its path) must never leak out through it.
  const options = (await cryptoOptCol.find()).filter((o) => !o.isHidden).map(({ rpcUrl, ...pub }) => pub);
  res.json({ options });
});

app.get('/api/admin/crypto-options', requireRole('admin'), async (req, res) => {
  const cryptoOptCol = db.collection<CryptoOption>('crypto_options');
  const options = await cryptoOptCol.find();
  res.json({ options });
});

app.post('/api/admin/crypto-options', requireRole('admin'), async (req, res) => {
  const { id, name, token, networkLabel, decimals, contractAddress, rpcUrl, explorerTxUrl, icon, minDeposit, chainId } = req.body;

  if (!KNOWN_CRYPTO_NETWORK_IDS.includes(id)) {
    return res.status(400).json({
      error: `Chỉ hỗ trợ khôi phục/thêm lại 1 trong các mạng đã có sẵn logic ví: ${KNOWN_CRYPTO_NETWORK_IDS.join(', ')}. Thêm blockchain hoàn toàn mới cần code sinh ví riêng.`,
    });
  }
  if (!name || !token || !networkLabel || !contractAddress || !rpcUrl) {
    return res.status(400).json({ error: 'Thiếu thông tin bắt buộc' });
  }

  const cryptoOptCol = db.collection<CryptoOption>('crypto_options');
  if (await cryptoOptCol.findOne({ id })) {
    return res.status(400).json({ error: `Mạng "${id}" đã tồn tại — dùng sửa hoặc hiện lại thay vì thêm mới` });
  }

  const newOption: CryptoOption = {
    id,
    name: String(name).trim(),
    token: String(token).trim(),
    networkLabel: String(networkLabel).trim(),
    decimals: Number(decimals) || 18,
    contractAddress: String(contractAddress).trim(),
    rpcUrl: String(rpcUrl).trim(),
    explorerTxUrl: String(explorerTxUrl || '').trim(),
    icon: String(icon || '💰').trim(),
    minDeposit: Number(minDeposit) || 1.0,
    chainId: chainId ? Number(chainId) : undefined,
  };
  await cryptoOptCol.insertOne(newOption);
  res.json({ success: true, option: newOption });
});

app.put('/api/admin/crypto-options/:id', requireRole('admin'), async (req, res) => {
  const cryptoOptCol = db.collection<CryptoOption>('crypto_options');
  const existing = await cryptoOptCol.findOne({ id: req.params.id });
  if (!existing) return res.status(404).json({ error: 'Không tìm thấy mạng nạp tiền này' });

  // id itself is never editable — it's the join key to CryptoNetwork
  // everywhere else (user.depositWallets, DepositTransaction.network...).
  // _id is Mongo's own immutable document id — GET /api/admin/crypto-options
  // returns it as part of each option (findOne/find never strip it), and the
  // admin UI's edit form round-trips the whole fetched object back on save,
  // so without stripping it here too, $set: { _id: ... } gets rejected by
  // MongoDB ("would modify the immutable field '_id'") on every real save.
  const { id: _ignoredId, _id: _ignoredMongoId, ...updateFields } = req.body;
  await cryptoOptCol.updateOne({ id: req.params.id }, { $set: updateFields });
  const updated = await cryptoOptCol.findOne({ id: req.params.id });
  res.json({ success: true, option: updated });
});

app.delete('/api/admin/crypto-options/:id', requireRole('admin'), async (req, res) => {
  const cryptoOptCol = db.collection<CryptoOption>('crypto_options');
  const option = await cryptoOptCol.findOne({ id: req.params.id });
  await cryptoOptCol.deleteOne({ id: req.params.id });
  const admin = (await getSessionUser(req))!;
  await logAdminAction(admin, 'crypto_option.delete', `Xóa phương thức nạp tiền "${option?.name || req.params.id}" (${option?.networkLabel || ''})`, req.params.id);
  res.json({ success: true });
});

// 11. Admin & CTV: Manage Inventory / Bulk Import (MongoDB: insertMany)
app.post('/api/admin/stock/bulk-import', requireRole('admin', 'ctv'), async (req, res) => {
  const { productId, variantId, rawAccounts } = req.body;
  const invCol = db.collection<any>('inventory');
  const prodCol = db.collection<Product>('products');

  if (!rawAccounts || typeof rawAccounts !== 'string') {
    return res.status(400).json({ error: 'Vui lòng cung cấp danh sách tài khoản hợp lệ' });
  }

  const product = await prodCol.findOne({ id: productId });
  if (!product) return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });

  // CTV no longer creates products — only admin does, then explicitly
  // grants specific CTV(s) permission to stock a given product (see POST
  // /api/admin/products/:id/authorize-ctv). Without this check, picking the
  // wrong option (or doing it on purpose) would silently dump a CTV's
  // accounts into a storefront they were never granted access to. Admin can
  // still stock any product.
  const uploader = (await getSessionUser(req))!;
  if (uploader.role === 'ctv' && !product.authorizedCtvIds?.includes(uploader.id)) {
    return res.status(403).json({ error: 'Bạn chưa được admin cấp quyền bán sản phẩm này.' });
  }

  const variant = product.variants.find((v) => v.id === variantId);
  const result = await importInventoryAccounts(
    invCol,
    productId,
    variantId,
    rawAccounts,
    { userId: uploader.id, username: uploader.username },
    product.name,
    variant?.name || variantId
  );

  // Stock is never stored on the variant — GET /api/products always counts
  // unsold inventory rows live, so there's nothing else to update here.
  const availableCount = await invCol.countDocuments({ variantId, isSold: false });

  res.json({
    success: true,
    ...result,
    totalVariantStock: availableCount,
  });
});

// 12. Delete single inventory item (MongoDB: deleteOne) — admin only. For
// pulling a specific bad/problem account out of the warehouse (wrong format,
// already dead, etc.) before anyone buys it. A row that's already sold must
// never be deleted here — it's the buyer's purchased credential and the
// order's own record of what was delivered (see Order.accounts), not spare
// stock to clean up.
app.delete('/api/admin/inventory/:id', requireRole('admin'), async (req, res) => {
  const invCol = db.collection<any>('inventory');
  const item = await invCol.findOne({ id: req.params.id });
  if (!item) return res.status(404).json({ error: 'Không tìm thấy tài khoản trong kho' });
  if (item.isSold) return res.status(400).json({ error: 'Không thể xóa tài khoản đã bán' });
  await invCol.deleteOne({ id: req.params.id });
  const admin = (await getSessionUser(req))!;
  await logAdminAction(admin, 'inventory.delete', `Xóa tài khoản kho hàng khỏi sản phẩm/biến thể "${item.productId}/${item.variantId}"`, req.params.id);
  res.json({ success: true });
});

// 13. Admin: Users CRUD (MongoDB: find, insertOne, updateOne, deleteOne) — admin only
app.get('/api/admin/users', requireRole('admin'), async (req, res) => {
  const userCol = db.collection<User>('users');
  const users = await userCol.find();
  // VIP tier/discount is derived from lifetime deposits, not stored on the
  // user document — the admin table needs the real computed value here too,
  // otherwise every regular user would show a static "0%" regardless of
  // their actual VIP tier, out of sync with what checkout actually applies.
  const withVip = await Promise.all(
    users.map(async (u) => {
      const publicUser = toPublicUser(u);
      if (u.role === 'user') {
        const totalDeposited = await computeTotalDeposited(u.id);
        const vipTier = getVipTier(totalDeposited);
        (publicUser as any).vipDiscountPercent = vipTier.discountPercent;
        (publicUser as any).vipTierKey = vipTier.key;
      }
      return publicUser;
    })
  );
  res.json({ users: withVip });
});

app.post('/api/admin/users/create', requireRole('admin'), async (req, res) => {
  const { username, email, role = 'user', initialBalance = 0 } = req.body;
  if (typeof username !== 'string' || typeof email !== 'string' || !username.trim() || !email.trim()) {
    return res.status(400).json({ error: 'Tên người dùng và email là bắt buộc' });
  }
  const cleanUsername = username.trim();
  const cleanEmail = email.trim();

  const userCol = db.collection<User>('users');
  const existing = await userCol.findOne({ username: cleanUsername });
  if (existing) {
    return res.status(400).json({ error: 'Tên người dùng đã tồn tại' });
  }

  const newId = 'user_' + Math.random().toString(36).substring(2, 9);
  // Admin-created accounts get a random temporary password, returned once
  // in this response so the admin can hand it to the new user. Uses
  // crypto.randomBytes rather than Math.random() — Math.random() isn't
  // cryptographically secure and shouldn't generate anything
  // security-sensitive, even a password meant to be changed immediately.
  const tempPassword = crypto.randomBytes(6).toString('base64url');
  const newUser: User = {
    id: newId,
    username: cleanUsername,
    email: cleanEmail,
    role: role as UserRole,
    balance: Number(initialBalance) || 0,
    discountPercent: 0,
    depositWallets: await getOrCreateUserWallet(newId),
    passwordHash: await hashPassword(tempPassword),
    apiKey: generateApiKey(),
    createdAt: new Date().toISOString(),
  };

  await userCol.insertOne(newUser);
  const admin = (await getSessionUser(req))!;
  await logAdminAction(admin, 'user.create', `Tạo tài khoản mới "${cleanUsername}" (${role}), số dư ban đầu $${newUser.balance}`, newId);
  res.json({ success: true, user: toPublicUser(newUser), tempPassword });
});

// Quick role/balance adjustment from the admin users table (the "Đổi Quyền" /
// "+$X" / "-$X" row actions) — balanceAdjust is applied atomically via $inc
// so concurrent admin actions on the same user can never clobber each other
// the way a read-then-overwrite of an absolute balance value could.
app.post('/api/admin/users/update', requireRole('admin'), async (req, res) => {
  const { targetUserId, newRole, balanceAdjust } = req.body;
  if (!targetUserId) return res.status(400).json({ error: 'Thiếu targetUserId' });

  const userCol = db.collection<User>('users');
  const target = await userCol.findOne({ id: targetUserId });
  if (!target) return res.status(404).json({ error: 'Không tìm thấy người dùng' });

  if (newRole) {
    await userCol.updateOne({ id: targetUserId }, { $set: { role: newRole } });
  }
  if (typeof balanceAdjust === 'number' && balanceAdjust !== 0) {
    const adjustResult = await userCol.updateOne(
      { id: targetUserId, balance: { $gte: -balanceAdjust } },
      { $inc: { balance: balanceAdjust } }
    );
    if (adjustResult.matchedCount === 0) {
      return res.status(400).json({ error: 'Số dư hiện tại của người dùng không đủ để trừ số tiền này' });
    }

    // An admin credit counts the same as the user depositing it themselves
    // (it progresses their VIP tier); an admin deduction is recorded as a
    // negative confirmed "deposit" so it un-counts that amount from their
    // lifetime total instead of leaving their VIP tier permanently inflated
    // by money that was later taken back. computeTotalDeposited() just sums
    // every confirmed row, so a negative entry here nets out correctly.
    const depCol = db.collection<DepositTransaction>('deposits');
    await depCol.insertOne({
      id: 'tx_admin_' + Date.now(),
      userId: targetUserId,
      username: target.username,
      network: 'admin' as CryptoNetwork,
      tokenSymbol: 'USD',
      amount: balanceAdjust,
      walletAddress: 'admin-manual-adjustment',
      txHash: '',
      blockNumber: 0,
      timestamp: new Date().toISOString(),
      status: 'confirmed',
      detectedVia: 'Admin manual balance adjustment',
    });
  }

  const admin = (await getSessionUser(req))!;
  const changeParts: string[] = [];
  if (newRole) changeParts.push(`đổi quyền thành "${newRole}"`);
  if (typeof balanceAdjust === 'number' && balanceAdjust !== 0) {
    changeParts.push(balanceAdjust > 0 ? `cộng $${balanceAdjust}` : `trừ $${Math.abs(balanceAdjust)}`);
  }
  if (changeParts.length > 0) {
    await logAdminAction(admin, 'user.update', `Cập nhật tài khoản "${target.username}": ${changeParts.join(', ')}`, targetUserId);
  }
  const updated = await userCol.findOne({ id: targetUserId });
  res.json({ success: true, user: updated ? toPublicUser(updated) : null });
});

app.put('/api/admin/users/:id', requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const { role, balance, discountPercent } = req.body;
  const userCol = db.collection<User>('users');

  const updateFields: any = {};
  if (role) updateFields.role = role;
  if (typeof balance === 'number') updateFields.balance = Number(balance);
  if (typeof discountPercent === 'number') updateFields.discountPercent = Number(discountPercent);

  const beforeUser = await userCol.findOne({ id });
  await userCol.updateOne({ id }, { $set: updateFields });
  const updatedUser = await userCol.findOne({ id });
  if (Object.keys(updateFields).length > 0) {
    const admin = (await getSessionUser(req))!;
    await logAdminAction(admin, 'user.update', `Cập nhật tài khoản "${beforeUser?.username || id}": ${JSON.stringify(updateFields)}`, id);
  }
  res.json({ success: true, user: updatedUser ? toPublicUser(updatedUser) : null });
});

app.delete('/api/admin/users/:id', requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const userCol = db.collection<User>('users');
  const sessionUser = await getSessionUser(req);
  if (id === sessionUser?.id) {
    return res.status(400).json({ error: 'Không thể xóa tài khoản đang đăng nhập' });
  }
  const target = await userCol.findOne({ id });
  await userCol.deleteOne({ id });
  if (sessionUser) {
    await logAdminAction(sessionUser, 'user.delete', `Xóa tài khoản "${target?.username || id}"`, id);
  }
  res.json({ success: true });
});

// 14. Categories CRUD (MongoDB: find, insertOne, updateOne, deleteOne)
app.get('/api/categories', async (req, res) => {
  const catCol = db.collection<Category>('categories');
  const categories = await catCol.find();
  res.json({ categories });
});

// Same normalization for create and edit so a slug means one thing everywhere:
// lowercase, whitespace collapsed to "-". Returns '' for anything unusable.
function normalizeCategorySlug(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase().replace(/\s+/g, '-') : '';
}

app.post('/api/admin/categories', requireRole('admin'), async (req, res) => {
  const { name, slug, description, icon } = req.body;
  const cleanName = typeof name === 'string' ? name.trim() : '';
  const cleanSlug = normalizeCategorySlug(slug);
  if (!cleanName || !cleanSlug) return res.status(400).json({ error: 'Tên và mã định danh (slug) là bắt buộc' });

  const catCol = db.collection<Category>('categories');
  // A slug is the join key products filter by — two categories sharing one
  // (or a new slug equal to an existing category's id) would merge them.
  const clash = (await catCol.find()).find((c) => c.slug === cleanSlug || c.id === cleanSlug);
  if (clash) return res.status(400).json({ error: `Slug "${cleanSlug}" đã được dùng bởi danh mục "${clash.name}"` });

  const newCat: Category = {
    id: cleanSlug,
    name: cleanName,
    slug: cleanSlug,
    icon: typeof icon === 'string' && icon ? icon : 'other',
    description: typeof description === 'string' ? description : '',
  };

  await catCol.insertOne(newCat);
  res.json({ success: true, category: newCat });
});

app.put('/api/admin/categories/:id', requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const catCol = db.collection<Category>('categories');
  const prodCol = db.collection<Product>('products');
  const existing = await catCol.findOne({ id });
  if (!existing) return res.status(404).json({ error: 'Không tìm thấy danh mục' });

  // Only fields actually sent are changed — omitting one must never blank it
  // (a $set of `undefined` used to overwrite the stored value with nothing).
  const { name, slug, description, icon } = req.body;
  const updates: Partial<Category> = {};
  if (name !== undefined) {
    const cleanName = typeof name === 'string' ? name.trim() : '';
    if (!cleanName) return res.status(400).json({ error: 'Tên danh mục không được để trống' });
    updates.name = cleanName;
  }
  if (slug !== undefined) {
    const cleanSlug = normalizeCategorySlug(slug);
    if (!cleanSlug) return res.status(400).json({ error: 'Slug không hợp lệ' });
    const clash = (await catCol.find()).find((c) => c.id !== existing.id && (c.slug === cleanSlug || c.id === cleanSlug));
    if (clash) return res.status(400).json({ error: `Slug "${cleanSlug}" đã được dùng bởi danh mục "${clash.name}"` });
    updates.slug = cleanSlug;
  }
  if (typeof description === 'string') updates.description = description;
  if (typeof icon === 'string' && icon) updates.icon = icon;

  await catCol.updateOne({ id }, { $set: updates });

  // Products point at their category by slug (filter/counts) and carry its
  // display name — renaming/re-slugging the category has to carry them along,
  // or the storefront filter silently stops matching those products.
  const nextSlug = updates.slug ?? existing.slug;
  const nextName = updates.name ?? existing.name;
  if (nextSlug !== existing.slug || nextName !== existing.name) {
    const affected = await prodCol.find({ categorySlug: existing.slug });
    await prodCol.bulkWrite(
      affected.map((p) => ({ filter: { id: p.id }, update: { $set: { categorySlug: nextSlug, category: nextName } } }))
    );
  }

  const updated = await catCol.findOne({ id });
  res.json({ success: true, category: updated });
});

app.delete('/api/admin/categories/:id', requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const catCol = db.collection<Category>('categories');
  const prodCol = db.collection<Product>('products');
  const existing = await catCol.findOne({ id });
  if (!existing) return res.status(404).json({ error: 'Không tìm thấy danh mục' });

  // Deleting a category that still has products would leave them in a
  // category that no longer exists (reachable only through "all"). Make the
  // admin move or remove them first instead of orphaning them silently.
  const inUse = await prodCol.countDocuments({ categorySlug: existing.slug });
  if (inUse > 0) {
    return res.status(400).json({
      error: `Danh mục "${existing.name}" đang có ${inUse} sản phẩm — hãy chuyển hoặc xóa các sản phẩm đó trước khi xóa danh mục.`,
    });
  }
  await catCol.deleteOne({ id });
  const admin = (await getSessionUser(req))!;
  await logAdminAction(admin, 'category.delete', `Xóa danh mục "${existing.name}"`, id);
  res.json({ success: true });
});

// 15. Products CRUD (MongoDB: find, insertOne, updateOne, deleteOne) — admin only
app.post('/api/admin/products', requireRole('admin'), async (req, res) => {
  const { name, category, categorySlug, price, originalPrice, image, variants = [], description, accountFormat } = req.body;
  if (!name || !category) {
    return res.status(400).json({ error: 'Tên sản phẩm và danh mục là bắt buộc' });
  }

  const adminUser = (await getSessionUser(req))!;
  const prodCol = db.collection<Product>('products');
  const newId = 'prod-' + Math.random().toString(36).substring(2, 8);
  const pricingError = validateOptionalPricing(price, originalPrice) || (variants.length > 0 || !Array.isArray(variants) ? validateVariantsInput(variants) : null);
  if (pricingError) return res.status(400).json({ error: pricingError });
  const resolvedPrice = Number(price) || 0.5;
  const resolvedOriginalPrice = originalPrice ? Number(originalPrice) : undefined;
  const resolvedVariants =
    variants.length > 0
      ? variants.map((v: any) => ({ ...v, id: v.id || 'var-' + Math.random().toString(36).substring(2, 6), discountBadge: computeDiscountBadge(Number(v.price), v.originalPrice ? Number(v.originalPrice) : undefined) }))
      : [
          {
            id: 'var-' + Math.random().toString(36).substring(2, 6),
            name: name + ' - Tiêu chuẩn',
            price: resolvedPrice,
            originalPrice: resolvedOriginalPrice,
            // Stock is never stored — always the live count of unsold
            // inventory rows for this variant (see GET /api/products).
            discountBadge: computeDiscountBadge(resolvedPrice, resolvedOriginalPrice),
          },
        ];

  const newProduct: Product = {
    id: newId,
    name,
    category,
    categorySlug: categorySlug || 'other',
    image: image || 'other',
    rating: 5,
    reviewCount: 0,
    seller: {
      name: `${adminUser.username}`,
      statusText: 'Đang hoạt động',
      isActive: true,
    },
    createdByUserId: adminUser.id,
    isHot: false,
    isFeatured: true,
    inStock: true,
    price: resolvedPrice,
    originalPrice: resolvedOriginalPrice,
    badge: computeBestBadge({ price: resolvedPrice, originalPrice: resolvedOriginalPrice, variants: resolvedVariants }),
    variants: resolvedVariants,
    descriptionHtml: description && String(description).trim() ? String(description).trim() : undefined,
    accountFormat: accountFormat && String(accountFormat).trim() ? String(accountFormat).trim() : undefined,
  };

  if (newProduct.descriptionHtml) {
    newProduct.descriptionTranslations = await translateDescriptionToAllLanguages(newProduct.descriptionHtml);
  }

  await prodCol.insertOne(newProduct);
  res.json({ success: true, product: newProduct });
});

app.put('/api/admin/products/:id', requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const prodCol = db.collection<Product>('products');
  // badge is server-computed (see recomputedBadge below); id/_id are
  // excluded too — this otherwise-unrestricted $set from req.body must
  // never be able to change which document it's addressing, or a typo'd or
  // malicious payload could silently detach a product from its own id.
  const { badge: _ignoredBadge, id: _ignoredId, _id: _ignoredMongoId, ...updateFields } = req.body;
  const existing = await prodCol.findOne({ id });
  if (!existing) return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });

  if ('price' in updateFields && !isValidPrice(Number(updateFields.price))) {
    return res.status(400).json({ error: 'Giá bán không hợp lệ (phải lớn hơn 0 và hợp lý).' });
  }
  if (updateFields.originalPrice && !isValidPrice(Number(updateFields.originalPrice))) {
    return res.status(400).json({ error: 'Giá gốc không hợp lệ.' });
  }
  if ('variants' in updateFields) {
    const variantsError = validateVariantsInput(updateFields.variants);
    if (variantsError) return res.status(400).json({ error: variantsError });
  }

  const merged = { ...existing, ...updateFields };
  const recomputedBadge = computeBestBadge(merged);

  // Only re-translate when the description text actually changed — an
  // unrelated edit (price, image, etc.) shouldn't burn a translation-API
  // call for content that hasn't moved.
  if (typeof updateFields.descriptionHtml === 'string') {
    if (updateFields.descriptionHtml.trim() && updateFields.descriptionHtml !== existing.descriptionHtml) {
      updateFields.descriptionTranslations = await translateDescriptionToAllLanguages(updateFields.descriptionHtml);
    } else if (!updateFields.descriptionHtml.trim()) {
      updateFields.descriptionTranslations = {};
    }
  }

  await prodCol.updateOne({ id }, { $set: { ...updateFields, badge: recomputedBadge } });
  const updated = await prodCol.findOne({ id });
  res.json({ success: true, product: updated });
});

app.delete('/api/admin/products/:id', requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const prodCol = db.collection<Product>('products');
  const invCol = db.collection<any>('inventory');

  const product = await prodCol.findOne({ id });
  await prodCol.deleteOne({ id });
  await invCol.deleteMany({ productId: id });
  await cancelOpenPreorders({ productId: id });
  const admin = (await getSessionUser(req))!;
  await logAdminAction(admin, 'product.delete', `Xóa sản phẩm "${product?.name || id}"`, id);
  res.json({ success: true });
});

// Admin grants (or revokes) a specific CTV's permission to upload stock
// into this product — the only way a CTV gets access to a storefront at
// all now (see the ownership check in POST /api/admin/stock/bulk-import).
// Several CTVs can be granted the same product; that's expected, not an
// edge case — income still comes out correctly split per uploaded row
// (see uploaderBreakdown / ctvShareOfOrder) regardless of how many CTVs
// share it.
app.post('/api/admin/products/:id/authorize-ctv', requireRole('admin'), async (req, res) => {
  const { ctvUserId, authorized } = req.body;
  if (typeof ctvUserId !== 'string' || !ctvUserId) {
    return res.status(400).json({ error: 'Thiếu ctvUserId' });
  }
  if (typeof authorized !== 'boolean') {
    return res.status(400).json({ error: 'Thiếu trường authorized (boolean)' });
  }

  const prodCol = db.collection<Product>('products');
  const userCol = db.collection<User>('users');
  const product = await prodCol.findOne({ id: req.params.id });
  if (!product) return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });

  const ctv = await userCol.findOne({ id: ctvUserId });
  if (!ctv || ctv.role !== 'ctv') return res.status(400).json({ error: 'Tài khoản này không phải CTV' });

  const current = new Set(product.authorizedCtvIds || []);
  if (authorized) current.add(ctvUserId);
  else current.delete(ctvUserId);

  await prodCol.updateOne({ id: req.params.id }, { $set: { authorizedCtvIds: Array.from(current) } });
  const updated = await prodCol.findOne({ id: req.params.id });
  res.json({ success: true, product: updated });
});

// A pre-order waiting on a variant/product that no longer exists can never be
// fulfilled — left alone it would sit "pending" forever on the buyer's account
// page and in admin's list. Close those out as cancelled (no money was ever
// held for a pre-order, so nothing to refund).
async function cancelOpenPreorders(filter: { productId?: string; variantId?: string }): Promise<number> {
  const preorderCol = db.collection<PreOrder>('preorders');
  const userCol = db.collection<User>('users');
  const open = await preorderCol.find({ ...filter, status: 'pending' } as any);
  const nowIso = new Date().toISOString();
  await preorderCol.bulkWrite(
    open.map((p) => ({ filter: { id: p.id }, update: { $set: { status: 'cancelled' as const, refundedAt: nowIso } } }))
  );
  // The product/variant being removed is exactly why these pre-orders can
  // never be fulfilled now — each buyer's held money goes back to them, same
  // as a normal cancel.
  for (const p of open) {
    // heldAmount is missing (undefined) on pre-orders placed before the
    // "hold funds up front" feature existed — see checkExpiredPreorders for
    // why Number(...) || 0 here is the correct refund, not just a
    // crash-guard.
    await userCol.updateOne({ id: p.userId }, { $inc: { balance: Number(p.heldAmount) || 0 } });
  }
  return open.length;
}

// 15b. Variants CRUD — variants live embedded on their parent product
// document but are managed as their own resource here (add/edit/delete),
// linked by the product's id.
app.post('/api/admin/products/:id/variants', requireRole('admin'), async (req, res) => {
  const { name, price, originalPrice } = req.body;
  if (!name || !price) {
    return res.status(400).json({ error: 'Tên và giá biến thể là bắt buộc' });
  }
  const variantPricingError = !isValidPrice(Number(price))
    ? 'Giá biến thể không hợp lệ (phải lớn hơn 0 và hợp lý).'
    : validateOptionalPricing(undefined, originalPrice);
  if (variantPricingError) return res.status(400).json({ error: variantPricingError });

  const prodCol = db.collection<Product>('products');
  const product = await prodCol.findOne({ id: req.params.id });
  if (!product) return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });

  const resolvedPrice = Number(price);
  const resolvedOriginalPrice = originalPrice ? Number(originalPrice) : undefined;
  const newVariant = {
    id: 'var-' + generateObjectId().slice(0, 8),
    name: String(name).trim(),
    price: resolvedPrice,
    originalPrice: resolvedOriginalPrice,
    // Stock is never stored — always the live count of unsold inventory
    // rows for this variant (see GET /api/products).
    discountBadge: computeDiscountBadge(resolvedPrice, resolvedOriginalPrice),
  };

  const updatedVariants = [...(product.variants || []), newVariant];
  const badge = computeBestBadge({ price: product.price, originalPrice: product.originalPrice, variants: updatedVariants });
  await prodCol.updateOne({ id: product.id }, { $set: { variants: updatedVariants, badge } });
  res.json({ success: true, variant: newVariant });
});

app.put('/api/admin/products/:id/variants/:variantId', requireRole('admin'), async (req, res) => {
  const { name, price, originalPrice, isHidden } = req.body;
  const prodCol = db.collection<Product>('products');
  const product = await prodCol.findOne({ id: req.params.id });
  if (!product) return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });

  const variants = product.variants || [];
  const idx = variants.findIndex((v) => v.id === req.params.variantId);
  if (idx === -1) return res.status(404).json({ error: 'Không tìm thấy biến thể' });

  if (price !== undefined && !isValidPrice(Number(price))) {
    return res.status(400).json({ error: 'Giá biến thể không hợp lệ (phải lớn hơn 0 và hợp lý).' });
  }
  if (originalPrice !== undefined) {
    const originalError = validateOptionalPricing(undefined, originalPrice);
    if (originalError) return res.status(400).json({ error: originalError });
  }
  const nextPrice = price !== undefined ? Number(price) : variants[idx].price;
  const nextOriginalPrice = originalPrice !== undefined ? (originalPrice ? Number(originalPrice) : undefined) : variants[idx].originalPrice;

  variants[idx] = {
    ...variants[idx],
    ...(name !== undefined ? { name: String(name).trim() } : {}),
    ...(typeof isHidden === 'boolean' ? { isHidden } : {}),
    price: nextPrice,
    originalPrice: nextOriginalPrice,
    discountBadge: computeDiscountBadge(nextPrice, nextOriginalPrice),
  };

  const badge = computeBestBadge({ price: product.price, originalPrice: product.originalPrice, variants });
  await prodCol.updateOne({ id: product.id }, { $set: { variants, badge } });
  const admin = (await getSessionUser(req))!;
  await logAdminAction(admin, 'variant.update', `Sửa biến thể "${variants[idx].name}" của sản phẩm "${product.name}" → giá $${variants[idx].price}`, req.params.variantId);
  res.json({ success: true, variant: variants[idx] });
});

app.delete('/api/admin/products/:id/variants/:variantId', requireRole('admin'), async (req, res) => {
  const prodCol = db.collection<Product>('products');
  const invCol = db.collection<any>('inventory');
  const product = await prodCol.findOne({ id: req.params.id });
  if (!product) return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });

  const variants = product.variants || [];
  if (variants.length <= 1) {
    return res.status(400).json({ error: 'Sản phẩm phải có ít nhất 1 biến thể — không thể xóa biến thể cuối cùng' });
  }
  if (!variants.some((v) => v.id === req.params.variantId)) {
    return res.status(404).json({ error: 'Không tìm thấy biến thể' });
  }

  const updatedVariants = variants.filter((v) => v.id !== req.params.variantId);
  const badge = computeBestBadge({ price: product.price, originalPrice: product.originalPrice, variants: updatedVariants });
  await prodCol.updateOne({ id: product.id }, { $set: { variants: updatedVariants, badge } });
  // Unsold inventory tied to the deleted variant would otherwise become
  // orphaned (referencing a variantId that no longer exists on the product).
  await invCol.deleteMany({ variantId: req.params.variantId, isSold: false });
  await cancelOpenPreorders({ variantId: req.params.variantId });

  const admin = (await getSessionUser(req))!;
  const deletedVariant = variants.find((v) => v.id === req.params.variantId);
  await logAdminAction(admin, 'variant.delete', `Xóa biến thể "${deletedVariant?.name || req.params.variantId}" khỏi sản phẩm "${product.name}"`, req.params.variantId);
  res.json({ success: true });
});

// 16. Inventory Overview for Admin — admin only.
// Without ?productId, this must NEVER load real account rows: with no filter
// it used to load the whole store's inventory and cap the preview at 5000
// documents TOTAL, so once the store passed 5000 accounts across all products
// combined, whichever product's rows didn't make the first 5000 (arbitrary,
// by Mongo's natural order) silently showed a smaller count than what's
// actually in the database — a real product with 5,200 accounts could show 0.
// Per-product totals are counted here in the database (never by loading rows),
// so every product's count is always exact regardless of how big the store
// gets. Real account rows are only ever fetched with ?productId set, scoped
// to that one product — its own 5000-row preview cap can never be crowded out
// by any other product's inventory.
app.get('/api/admin/inventory', requireRole('admin'), async (req, res) => {
  const { productId, status, search } = req.query;
  const invCol = db.collection<any>('inventory');

  // Cross-warehouse username search — so admin can find a problem account
  // (to pull it before anyone buys it) without first having to know which
  // product it was uploaded into. Matches against the indexed usernameKey,
  // never loads the full warehouse into memory to do it.
  const searchText = typeof search === 'string' ? search.trim().toLowerCase() : '';
  if (searchText) {
    const escaped = searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const query: any = { usernameKey: { $regex: escaped, $options: 'i' } };
    if (productId) query.productId = productId;
    if (status === 'sold') query.isSold = true;
    else if (status === 'available') query.isSold = false;

    const SEARCH_LIMIT = 200;
    const items = await invCol.find(query, { limit: SEARCH_LIMIT, sort: { createdAt: -1 } });
    const prodCol = db.collection<Product>('products');
    const matchedProductIds = [...new Set(items.map((i) => i.productId))];
    const products = matchedProductIds.length ? await prodCol.find({ id: { $in: matchedProductIds } }) : [];
    const productById = new Map(products.map((p) => [p.id, p]));

    const results = items.map((item) => {
      const product = productById.get(item.productId);
      const variant = product?.variants.find((v) => v.id === item.variantId);
      return {
        id: item.id,
        productId: item.productId,
        productName: product?.name || item.productId,
        variantId: item.variantId,
        variantName: variant?.name || item.variantId,
        username: item.accountData.split('|')[0].trim(),
        accountMasked:
          item.accountData.slice(0, 12) +
          '...|' +
          item.accountData.split('|').slice(1, 3).join('|').slice(0, 8) +
          '...',
        isSold: item.isSold,
        createdAt: item.createdAt,
      };
    });
    return res.json({ items: results, truncated: items.length === SEARCH_LIMIT });
  }

  if (productId) {
    const baseQuery: any = { productId };
    const query: any = { ...baseQuery };
    if (status === 'sold') query.isSold = true;
    else if (status === 'available') query.isSold = false;

    const items = await invCol.find(query);
    const total = await invCol.countDocuments(baseQuery);
    const available = await invCol.countDocuments({ ...baseQuery, isSold: false });
    const sold = await invCol.countDocuments({ ...baseQuery, isSold: true });

    const preview = items.slice(0, 5000).map((item) => ({
      id: item.id,
      productId: item.productId,
      variantId: item.variantId,
      // The username itself isn't a secret the way the password/2FA/cookie
      // fields are — it's the public handle admin needs on hand to paste into
      // the Check Live X tool. Sent as its own clean field (original casing)
      // since accountMasked's fixed 12-char slice can cut a longer username
      // off mid-string.
      username: item.accountData.split('|')[0].trim(),
      accountMasked:
        item.accountData.slice(0, 12) +
        '...|' +
        item.accountData.split('|').slice(1, 3).join('|').slice(0, 8) +
        '...',
      isSold: item.isSold,
      createdAt: item.createdAt,
    }));

    return res.json({ total, available, sold, items: preview });
  }

  const [totalByProduct, availableByProduct] = await Promise.all([
    invCol.groupBy('productId', {}),
    invCol.groupBy('productId', { isSold: false }),
  ]);
  const availableByProductId = new Map(availableByProduct.map((row) => [row.key, row.count]));
  const byProduct = totalByProduct
    .map((row) => {
      const available = availableByProductId.get(row.key) || 0;
      return { productId: row.key, total: row.count, available, sold: row.count - available };
    })
    .sort((a, b) => b.total - a.total);

  res.json({
    total: byProduct.reduce((sum, p) => sum + p.total, 0),
    available: byProduct.reduce((sum, p) => sum + p.available, 0),
    sold: byProduct.reduce((sum, p) => sum + p.sold, 0),
    byProduct,
  });
});

// Upload history — one row per bulk-import batch (written in
// importInventoryAccounts), independent of orders: this is about what was
// put INTO the warehouse, not what customers bought out of it. Newest first,
// capped the same way GET /api/orders is — page/limit optional for
// backward-compatible unpaginated use, real pagination when requested.
app.get('/api/admin/inventory-upload-history', requireRole('admin'), async (req, res) => {
  const historyCol = db.collection<any>('inventory_upload_history');
  // The list view only ever needs the counts — never the full username
  // lists (which can be thousands of entries long per batch and would bloat
  // every page load). Full detail is fetched per-row, on demand, via
  // GET .../inventory-upload-history/:id below.
  let rows = await historyCol.find({}, { projection: { importedUsernames: 0, duplicateUsernames: 0 } });
  rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const rawPage = req.query.page ? parseInt(String(req.query.page), 10) : NaN;
  const rawLimit = req.query.limit ? parseInt(String(req.query.limit), 10) : NaN;
  if (!isNaN(rawPage) || !isNaN(rawLimit)) {
    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 50;
    const start = (page - 1) * limit;
    return res.json({ entries: rows.slice(start, start + limit), total: rows.length, page, limit });
  }

  res.json({ entries: rows.slice(0, 200), total: rows.length });
});

// Full detail (the actual imported/duplicate username lists) of one upload
// batch — fetched lazily when admin opens a row, never as part of the list
// above, so reviewing one old batch never has to pull every batch's lists
// over the wire first.
app.get('/api/admin/inventory-upload-history/:id', requireRole('admin'), async (req, res) => {
  const historyCol = db.collection<any>('inventory_upload_history');
  const entry = await historyCol.findOne({ id: req.params.id });
  if (!entry) return res.status(404).json({ error: 'Không tìm thấy lượt nhập kho này' });
  res.json({
    importedUsernames: entry.importedUsernames || [],
    duplicateUsernames: entry.duplicateUsernames || [],
  });
});

// 17. Admin System Stats — admin only
app.get('/api/admin/stats', requireRole('admin'), async (req, res) => {
  const userCol = db.collection<User>('users');
  const orderCol = db.collection<Order>('orders');
  const invCol = db.collection<any>('inventory');
  const configCol = db.collection<any>('config');

  const usersCount = await userCol.countDocuments();
  const allOrders = await orderCol.find({}, ORDERS_WITHOUT_ACCOUNTS);
  // Refunded orders never count toward revenue — the money was given back,
  // so it was never actually kept as revenue in the first place.
  const totalRevenue = allOrders.filter((o) => o.status !== 'refunded').reduce((sum, o) => sum + o.totalPrice, 0);
  const totalStock = await invCol.countDocuments({ isSold: false });
  // Sourced from the orders collection (permanent) rather than counting
  // isSold:true inventory rows — sold warehouse rows past their retention
  // window get pruned (see cleanupOldSoldInventory), which would otherwise
  // make this lifetime "accounts sold" figure silently shrink over time.
  // Unlike revenue, this intentionally still counts refunded orders'
  // quantity — the accounts were genuinely handed over regardless of the
  // later refund, so it stays a fulfillment count, not a revenue figure.
  const totalSold = allOrders.reduce((sum, o) => sum + o.quantity, 0);

  const cfg = await configCol.findOne({ key: 'platform' });
  const feePercent = cfg ? cfg.platformFeePercent : 5.0;

  res.json({
    totalUsers: usersCount,
    totalOrders: allOrders.length,
    totalRevenue: Number(totalRevenue.toFixed(3)),
    totalStock,
    totalSold,
    platformFeePercent: feePercent,
    databaseEngine: 'MongoDB Document Storage Engine',
  });
});

// Presence ping — called every ~20s by every open tab (see App.tsx). Stays
// public (no requireAuth) so a guest tab's ping doesn't throw a 401 every
// 20s; it simply records nothing when there's no session. Only a real
// logged-in account ever counts toward "online now".
app.post('/api/presence/ping', async (req, res) => {
  const user = await getSessionUser(req);
  if (user) {
    lastSeenByUserId.set(user.id, Date.now());
  }
  res.json({ ok: true });
});

// Admin-only — polled every ~20s by the admin dashboard (see AdminPage.tsx).
app.get('/api/admin/online-count', requireRole('admin'), (req, res) => {
  res.json({ count: countOnlineUsers() });
});

// 17b. Admin Chart Stats — revenue/orders bucketed by the requested period
// (?period=week|month|all) + top products, for the chart view on the Admin
// dashboard.
app.get('/api/admin/stats/charts', requireRole('admin'), async (req, res) => {
  const orderCol = db.collection<Order>('orders');
  const allOrders = await orderCol.find({}, ORDERS_WITHOUT_ACCOUNTS);
  // Same reasoning as totalRevenue above — a refunded order was never
  // actually kept as revenue, so it shouldn't show up in the revenue chart
  // or count toward a product's "top seller" ranking either.
  const revenueOrders = allOrders.filter((o) => o.status !== 'refunded');
  const period = String(req.query.period || 'week');

  res.json({
    daily: buildChartSeries(revenueOrders, period),
    topProducts: buildTopProducts(revenueOrders, 5),
    period,
  });
});

// 18. Platform Config & Fee Management (MongoDB: config)
app.get('/api/platform/config', async (req, res) => {
  const configCol = db.collection<any>('config');
  const cfg = await configCol.findOne({ key: 'platform' });
  res.json(cfg || { platformFeePercent: 5.0 });
});

app.post('/api/admin/config/fee', requireRole('admin'), async (req, res) => {
  const { platformFeePercent } = req.body;
  const parsed = parseFloat(platformFeePercent);
  if (isNaN(parsed) || parsed < 0 || parsed > 50) {
    return res.status(400).json({ error: 'Tỷ lệ phí sàn không hợp lệ (từ 0% đến 50%)' });
  }

  const configCol = db.collection<any>('config');
  const newFee = Number(parsed.toFixed(1));
  await configCol.updateOne({ key: 'platform' }, { $set: { platformFeePercent: newFee } });

  const admin = (await getSessionUser(req))!;
  await logAdminAction(admin, 'config.fee', `Đổi phí sàn thành ${newFee}%`);
  res.json({ success: true, platformFeePercent: newFee });
});

// 19. CTV Management: Stats — CTV and Admin only
// Pulls this CTV's own quantity + revenue share out of an order's
// uploaderBreakdown. Revenue is split at the order's actual per-unit price
// (order.totalPrice / order.quantity), so a voucher discount applied to the
// whole order is reflected proportionally in every contributing CTV's share
// too, not just the buyer-facing total.
function ctvShareOfOrder(order: Order, ctvUserId: string): { quantity: number; revenue: number } {
  const entry = order.uploaderBreakdown?.find((e) => e.userId === ctvUserId);
  if (!entry) return { quantity: 0, revenue: 0 };
  const perUnitPrice = order.quantity > 0 ? order.totalPrice / order.quantity : 0;
  return { quantity: entry.quantity, revenue: Number((entry.quantity * perUnitPrice).toFixed(3)) };
}

// The single source of truth for a seller's money position — used by the
// stats dashboard AND enforced by the withdraw endpoint, so the number a CTV
// sees as "withdrawable" is exactly the number the server will let them take.
async function computeCtvFinancials(ctvUser: User) {
  const orderCol = db.collection<Order>('orders');
  const wdrCol = db.collection<WithdrawalRequest>('withdrawals');
  const configCol = db.collection<any>('config');
  const dedCol = db.collection<CtvDeduction>('ctv_deductions');

  const allOrders = await orderCol.find({}, ORDERS_WITHOUT_ACCOUNTS);
  // Income is attributed per row this CTV personally uploaded (see
  // uploaderBreakdown) — admin can grant several CTVs the same product, so
  // "orders against my products" doesn't mean anything on its own anymore.
  const myShares = allOrders.map((o) => ({ order: o, share: ctvShareOfOrder(o, ctvUser.id) })).filter((s) => s.share.quantity > 0);
  // Refunded orders are excluded from revenue specifically — this directly
  // feeds netProfit/withdrawableBalance, so counting a refunded order here
  // would let a CTV withdraw money for a sale that was already given back to
  // the buyer. Still counted in totalSold (fulfillment did genuinely happen).
  const grossRevenue = Number(
    myShares.filter((s) => s.order.status !== 'refunded').reduce((sum, s) => sum + s.share.revenue, 0).toFixed(3)
  );

  const cfg = await configCol.findOne({ key: 'platform' });
  const feePercent = cfg ? cfg.platformFeePercent : 5.0;
  const feeAmount = Number((grossRevenue * (feePercent / 100)).toFixed(3));
  const netProfit = Number((grossRevenue - feeAmount).toFixed(3));

  const userWithdrawals = await wdrCol.find({
    $or: [{ userId: ctvUser.id }, { username: ctvUser.username }],
  } as any);
  const totalWithdrawnOrPending = userWithdrawals
    .filter((w) => w.status === 'completed' || w.status === 'pending')
    .reduce((sum, w) => sum + w.amount, 0);

  const myDeductions = await dedCol.find({ ctvUserId: ctvUser.id });
  const totalDeducted = Number(myDeductions.reduce((sum, d) => sum + d.amount, 0).toFixed(3));

  const withdrawableBalance = Math.max(0, Number((netProfit - totalWithdrawnOrPending - totalDeducted).toFixed(3)));

  return { myShares, grossRevenue, feePercent, feeAmount, netProfit, userWithdrawals, myDeductions, totalDeducted, withdrawableBalance };
}

app.get('/api/ctv/stats', requireRole('admin', 'ctv'), async (req, res) => {
  const invCol = db.collection<any>('inventory');
  const prodCol = db.collection<Product>('products');

  const ctvUser = (await getSessionUser(req))!;

  const {
    myShares,
    grossRevenue,
    feePercent,
    feeAmount,
    netProfit,
    userWithdrawals,
    myDeductions,
    totalDeducted,
    withdrawableBalance,
  } = await computeCtvFinancials(ctvUser);

  // totalSold comes from the permanent orders history (myShares above)
  // rather than counting isSold:true rows still physically present in
  // inventory — those sold rows get pruned after their retention window
  // (see cleanupOldSoldInventory), which would otherwise make this lifetime
  // figure silently shrink. totalInStock only ever counts real, currently
  // unsold rows this CTV uploaded (never pruned), and totalUploaded is
  // derived from both so it stays a stable lifetime total instead of
  // shrinking as old sold rows are cleaned up.
  // Counted in the database per product — never load the unsold rows themselves
  // (each carries a full account line) just to count them.
  const myUnsoldByProduct = await invCol.groupBy('productId', { uploadedByUserId: ctvUser.id, isSold: false });
  const totalInStock = myUnsoldByProduct.reduce((sum, r) => sum + r.count, 0);
  const totalSold = myShares.reduce((sum, s) => sum + s.share.quantity, 0);
  const totalUploaded = totalInStock + totalSold;

  // Per-product slice of the same numbers — this CTV's own contribution to
  // each product it's authorized on, not the product's totals (other CTVs
  // may also be authorized on it).
  const byProductMap = new Map<string, { productId: string; productName: string; totalInStock: number; totalSold: number; grossRevenue: number }>();
  const getOrInit = (productId: string, productName: string) => {
    let entry = byProductMap.get(productId);
    if (!entry) {
      entry = { productId, productName, totalInStock: 0, totalSold: 0, grossRevenue: 0 };
      byProductMap.set(productId, entry);
    }
    return entry;
  };
  for (const row of myUnsoldByProduct) {
    getOrInit(row.key, row.key).totalInStock += row.count;
  }
  for (const s of myShares) {
    const entry = getOrInit(s.order.productId, s.order.productName);
    entry.productName = s.order.productName;
    entry.totalSold += s.share.quantity;
    if (s.order.status !== 'refunded') entry.grossRevenue = Number((entry.grossRevenue + s.share.revenue).toFixed(3));
  }
  // Rows built purely from unsold inventory don't have a real productName
  // yet (orders carry it, inventory rows don't) — fill those in from the
  // products collection rather than showing a raw id.
  const namelessProductIds = Array.from(byProductMap.values()).filter((e) => e.productName === e.productId).map((e) => e.productId);
  if (namelessProductIds.length > 0) {
    const namedProducts = await prodCol.find({ id: { $in: namelessProductIds } });
    const nameById = new Map(namedProducts.map((p) => [p.id, p.name]));
    for (const entry of byProductMap.values()) {
      const realName = nameById.get(entry.productId);
      if (realName) entry.productName = realName;
    }
  }
  const byProduct = Array.from(byProductMap.values()).sort((a, b) => b.grossRevenue - a.grossRevenue);

  const stats: CtvStats = {
    grossRevenue,
    feePercent,
    feeAmount,
    netProfit,
    totalDeducted,
    withdrawableBalance,
    totalUploaded,
    totalSold,
    totalInStock,
    withdrawals: userWithdrawals,
    deductions: myDeductions,
    byProduct,
  };

  res.json({ stats });
});

// 19b. CTV Chart Stats — revenue/orders bucketed by the requested period
// (?period=week|month|all) + top products, scoped to this CTV's own
// products only.
app.get('/api/ctv/stats/charts', requireRole('admin', 'ctv'), async (req, res) => {
  const orderCol = db.collection<Order>('orders');

  const ctvUser = (await getSessionUser(req))!;
  const allOrders = await orderCol.find({}, ORDERS_WITHOUT_ACCOUNTS);
  // Same reasoning as /api/ctv/stats — a refunded order was never actually
  // kept as revenue, so it's excluded from the revenue chart/ranking too.
  // buildChartSeries/buildTopProducts only read totalPrice off each entry,
  // so this CTV's revenue *share* of the order (not the buyer's full total,
  // which may include other CTVs' contributions) is substituted in here —
  // those two shared helpers stay untouched since Admin's own unscoped
  // charts still call them with real orders directly.
  const revenueEntries = allOrders
    .filter((o) => o.status !== 'refunded')
    .map((o) => ({ order: o, share: ctvShareOfOrder(o, ctvUser.id) }))
    .filter((s) => s.share.quantity > 0)
    .map((s) => ({ createdAt: s.order.createdAt, totalPrice: s.share.revenue, productName: s.order.productName }));

  const period = String(req.query.period || 'week');
  res.json({
    daily: buildChartSeries(revenueEntries, period),
    topProducts: buildTopProducts(revenueEntries, 5),
    period,
  });
});

// 20. CTV Withdrawal Request (MongoDB: insertOne) — CTV and Admin only.
// Crypto-only: bank/e-wallet methods are no longer accepted, even if a
// client sends them directly, so `method`/`network` are never taken from
// the request body.
// Per-account lock: two withdrawals fired in parallel would otherwise both
// read the same withdrawable balance, both pass the check below, and together
// pay out more than the account ever earned.
const withdrawInProgress = new Set<string>();

app.post('/api/ctv/withdraw', requireRole('admin', 'ctv'), async (req, res) => {
  const { amount, network = 'bsc', accountNumber, accountName } = req.body;
  const wdrCol = db.collection<WithdrawalRequest>('withdrawals');

  const ctvUser = (await getSessionUser(req))!;

  const parsedAmount = Number(amount);
  if (!Number.isFinite(parsedAmount) || parsedAmount < 5) {
    return res.status(400).json({ error: 'Số tiền rút tối thiểu là $5.00' });
  }
  if (typeof accountNumber !== 'string' || !accountNumber.trim()) {
    return res.status(400).json({ error: 'Vui lòng nhập địa chỉ ví crypto nhận tiền' });
  }
  if (typeof network !== 'string' || !['bsc', 'polygon', 'trc', 'base'].includes(network)) {
    return res.status(400).json({ error: 'Mạng nhận tiền không hợp lệ' });
  }
  const cleanAmount = Number(parsedAmount.toFixed(3));

  if (withdrawInProgress.has(ctvUser.id)) {
    return res.status(429).json({ error: 'Đang xử lý một lệnh rút khác, vui lòng thử lại sau giây lát' });
  }
  withdrawInProgress.add(ctvUser.id);
  try {
    // Enforced against the exact same figure the dashboard shows (see
    // computeCtvFinancials) — the amount can never exceed what this account
    // has actually earned net of fee, earlier withdrawals and admin deductions.
    const { withdrawableBalance } = await computeCtvFinancials(ctvUser);
    if (cleanAmount > withdrawableBalance) {
      return res.status(400).json({
        error: `Số tiền rút vượt quá số dư khả dụng ($${withdrawableBalance.toFixed(2)}).`,
        withdrawableBalance,
      });
    }

    const newWithdrawal: WithdrawalRequest = {
      id: 'wdr_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      userId: ctvUser.id,
      username: ctvUser.username,
      amount: cleanAmount,
      method: 'crypto',
      accountNumber: accountNumber.trim(),
      accountName: typeof accountName === 'string' ? accountName.trim() : undefined,
      network: network as CryptoNetwork,
      walletAddress: accountNumber.trim(),
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    await wdrCol.insertOne(newWithdrawal);

    res.json({
      success: true,
      message: 'Tạo lệnh rút tiền thành công. Admin sẽ kiểm duyệt và xử lý trong 5-15 phút.',
      withdrawal: newWithdrawal,
    });
  } finally {
    withdrawInProgress.delete(ctvUser.id);
  }
});

// Admin: income broken out per seller — every CTV, plus any admin account
// that has personally created/uploaded its own products too (an admin
// selling directly is tracked exactly like a CTV here, not excluded just
// for being admin role). Same ownership rule as /api/ctv/stats
// (ctvOwnsProduct/createdByUserId), just computed for every seller in one
// pass instead of one endpoint call per account. Only sellers who actually
// own at least one product show up — no "preview a few random products"
// fallback here, since this view is specifically about who's really sold
// something, not a single seller's own empty-state dashboard.
app.get('/api/admin/ctv-breakdown', requireRole('admin'), async (req, res) => {
  const userCol = db.collection<User>('users');
  const orderCol = db.collection<Order>('orders');
  const invCol = db.collection<any>('inventory');
  const configCol = db.collection<any>('config');
  const wdrCol = db.collection<WithdrawalRequest>('withdrawals');
  const dedCol = db.collection<CtvDeduction>('ctv_deductions');

  const cfg = await configCol.findOne({ key: 'platform' });
  const feePercent = cfg ? cfg.platformFeePercent : 5.0;

  const sellers = await userCol.find({ role: { $in: ['ctv', 'admin'] } });
  const allOrders = await orderCol.find({}, ORDERS_WITHOUT_ACCOUNTS);
  const allWithdrawals = await wdrCol.find();
  const allDeductions = await dedCol.find();
  const unsoldByUploader = new Map<string, number>();
  for (const row of await invCol.groupBy('uploadedByUserId', { isSold: false })) {
    if (!row.key) continue;
    unsoldByUploader.set(row.key, row.count);
  }

  const breakdown = sellers
    .map((seller) => {
      const shares = allOrders
        .map((o) => ({ order: o, share: ctvShareOfOrder(o, seller.id) }))
        .filter((s) => s.share.quantity > 0);
      const totalInStock = unsoldByUploader.get(seller.id) || 0;
      const totalSold = shares.reduce((sum, s) => sum + s.share.quantity, 0);
      const totalUploaded = totalInStock + totalSold;

      const totalDeducted = Number(
        allDeductions.filter((d) => d.ctvUserId === seller.id).reduce((sum, d) => sum + d.amount, 0).toFixed(3)
      );
      if (totalUploaded === 0 && totalDeducted === 0) return null;

      const grossRevenue = Number(
        shares.filter((s) => s.order.status !== 'refunded').reduce((sum, s) => sum + s.share.revenue, 0).toFixed(3)
      );
      const feeAmount = Number((grossRevenue * (feePercent / 100)).toFixed(3));
      const netProfit = Number((grossRevenue - feeAmount).toFixed(3));
      const totalWithdrawnOrPending = allWithdrawals
        .filter((w) => (w.userId === seller.id || w.username === seller.username) && (w.status === 'completed' || w.status === 'pending'))
        .reduce((sum, w) => sum + w.amount, 0);
      const withdrawableBalance = Math.max(0, Number((netProfit - totalWithdrawnOrPending - totalDeducted).toFixed(3)));

      return {
        userId: seller.id,
        username: seller.username,
        role: seller.role,
        totalUploaded,
        totalSold,
        totalInStock,
        grossRevenue,
        netProfit,
        totalDeducted,
        withdrawableBalance,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((a, b) => b.grossRevenue - a.grossRevenue);

  res.json({ breakdown, feePercent });
});

// Admin: manually deduct from a CTV's earned income — e.g. a penalty for a
// bad batch of accounts, or correcting a mistake. Subtracted straight out
// of withdrawableBalance (see /api/ctv/stats and the breakdown above),
// alongside real withdrawals, and kept as a permanent record both admin and
// the CTV themselves can look back on rather than silently editing any
// stored balance number.
app.post('/api/admin/ctv-deductions', requireRole('admin'), async (req, res) => {
  const { ctvUserId, amount, reason } = req.body;
  const cleanAmount = Number(amount);
  if (!cleanAmount || cleanAmount <= 0) {
    return res.status(400).json({ error: 'Số tiền trừ phải lớn hơn 0' });
  }
  const cleanReason = String(reason || '').trim().slice(0, 500);
  if (!cleanReason) {
    return res.status(400).json({ error: 'Vui lòng nhập lý do trừ tiền' });
  }

  const userCol = db.collection<User>('users');
  const ctv = await userCol.findOne({ id: ctvUserId });
  if (!ctv || ctv.role !== 'ctv') return res.status(400).json({ error: 'Tài khoản này không phải CTV' });

  const admin = (await getSessionUser(req))!;
  const dedCol = db.collection<CtvDeduction>('ctv_deductions');
  const newDeduction: CtvDeduction = {
    id: 'ded_' + generateObjectId(),
    ctvUserId: ctv.id,
    ctvUsername: ctv.username,
    amount: Number(cleanAmount.toFixed(3)),
    reason: cleanReason,
    createdAt: new Date().toISOString(),
    adminId: admin.id,
    adminUsername: admin.username,
  };
  await dedCol.insertOne(newDeduction);
  await logAdminAction(admin, 'ctv_deduction.create', `Trừ $${newDeduction.amount} của CTV "${ctv.username}" — lý do: ${cleanReason}`, ctv.id);
  res.json({ success: true, deduction: newDeduction });
});

app.get('/api/admin/ctv-deductions', requireRole('admin'), async (req, res) => {
  const dedCol = db.collection<CtvDeduction>('ctv_deductions');
  const deductions = await dedCol.find();
  deductions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  res.json({ deductions });
});

// Admin-only view of every logged admin/CTV action (see logAdminAction) —
// not exposed to CTV accounts even though some entries are their own
// actions (refunds), since this also carries every other admin's activity
// platform-wide. Supports an optional actor/action filter and pagination so
// the log stays usable once it's months old, without changing the
// unfiltered/page-1 shape the admin UI's default view relies on.
app.get('/api/admin/audit-log', requireRole('admin'), async (req, res) => {
  const logCol = db.collection<AdminAuditLogEntry>('admin_audit_log');
  let all = await logCol.find();
  all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const actorFilter = typeof req.query.actor === 'string' ? req.query.actor.trim().toLowerCase() : '';
  if (actorFilter) {
    all = all.filter((e) => e.actorUsername.toLowerCase().includes(actorFilter));
  }
  const actionFilter = typeof req.query.action === 'string' ? req.query.action.trim() : '';
  if (actionFilter) {
    all = all.filter((e) => e.action === actionFilter);
  }

  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || '50'), 10) || 50));
  const start = (page - 1) * limit;
  res.json({ entries: all.slice(start, start + limit), total: all.length, page, limit });
});

// 21. Admin: Get all withdrawal requests (MongoDB: find) — admin only
app.get('/api/admin/withdrawals', requireRole('admin'), async (req, res) => {
  const wdrCol = db.collection<WithdrawalRequest>('withdrawals');
  const withdrawals = await wdrCol.find();
  res.json({ withdrawals });
});

// Admin: Complete a withdrawal request — only a still-pending request can be
// completed, and the transition is a single guarded update so a double click
// (or a reject racing a complete) can't push one request through both. A
// rejected request must never become "paid" afterwards, and a paid one must
// never flip back to rejected (that would free its balance again after the
// money already left). txHash is whatever real on-chain hash admin pastes in
// after actually sending the payout — never generated here.
async function transitionWithdrawal(
  id: string,
  next: 'completed' | 'rejected',
  txHash: unknown,
  admin: User,
  res: express.Response
) {
  const wdrCol = db.collection<WithdrawalRequest>('withdrawals');
  const existing = await wdrCol.findOne({ id });
  if (!existing) return res.status(404).json({ error: 'Không tìm thấy lệnh rút tiền' });

  const $set: Partial<WithdrawalRequest> = { status: next };
  if (next === 'completed' && typeof txHash === 'string' && txHash.trim()) {
    $set.txHash = txHash.trim().slice(0, 128);
  }
  const result = await wdrCol.updateOne({ id, status: 'pending' }, { $set });
  if (result.matchedCount === 0) {
    return res.status(400).json({ error: 'Lệnh rút tiền này đã được xử lý trước đó, không thể đổi trạng thái nữa' });
  }
  const action = next === 'completed' ? 'withdrawal.complete' : 'withdrawal.reject';
  const summary = next === 'completed'
    ? `Xác nhận đã thanh toán lệnh rút $${existing.amount} cho "${existing.username}"`
    : `Từ chối lệnh rút $${existing.amount} của "${existing.username}"`;
  await logAdminAction(admin, action, summary, id);
  const updated = await wdrCol.findOne({ id });
  res.json({ success: true, withdrawal: updated });
}

app.post('/api/admin/withdrawals/:id/complete', requireRole('admin'), async (req, res) => {
  const admin = (await getSessionUser(req))!;
  await transitionWithdrawal(req.params.id, 'completed', req.body?.txHash, admin, res);
});

// Admin: Reject a withdrawal request
app.post('/api/admin/withdrawals/:id/reject', requireRole('admin'), async (req, res) => {
  const admin = (await getSessionUser(req))!;
  await transitionWithdrawal(req.params.id, 'rejected', undefined, admin, res);
});

// The CTV product form only lets a CTV pick a category by its display
// label (e.g. "Twitter / X") — it never sends categorySlug or image (unlike
// the admin form, which has its own explicit icon picker). Without this,
// every CTV-created product fell back to categorySlug/image "other", so its
// storefront card always showed the generic fallback art regardless of
// which category was actually selected. Derived here so the fix applies
// uniformly without needing a new form field.
const CTV_CATEGORY_LABEL_TO_SLUG: Record<string, string> = {
  'Twitter / X': 'twitter',
  'Facebook': 'facebook',
  'Hotmail / Outlook': 'hotmail',
  'Gmail': 'gmail',
  'TikTok': 'tiktok',
  'Telegram': 'telegram',
  'Discord': 'discord',
  'Tool / Proxy': 'tool',
};

function deriveCategorySlug(categoryLabel: string): string {
  if (CTV_CATEGORY_LABEL_TO_SLUG[categoryLabel]) return CTV_CATEGORY_LABEL_TO_SLUG[categoryLabel];
  const slugified = String(categoryLabel)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slugified || 'other';
}

// Product cards (ProductShopArt.tsx) render from a fixed set of storefront
// photos that doesn't include a "tool" one — category browsing (Categories.tsx)
// has its own icon set that does. Same source label, two different target
// vocabularies, so this can't just reuse deriveCategorySlug's result as-is.
function deriveProductImageKey(categoryLabel: string): string {
  const slug = deriveCategorySlug(categoryLabel);
  return slug === 'tool' ? 'other' : slug;
}

// 22. Admin-only: create a new product listing ("gian hàng"). CTV no longer
// creates products at all — admin creates every listing, then explicitly
// grants specific CTV(s) permission to stock it (see POST
// /api/admin/products/:id/authorize-ctv), so admin always knows exactly
// what each CTV is selling. Kept at this path rather than merged into
// POST /api/admin/products so nothing else on the admin side has to change.
app.post('/api/ctv/products', requireRole('admin'), async (req, res) => {
  const { name, category, categorySlug, price, originalPrice, image, description, accountFormat, variantName, rawAccounts, variants = [] } = req.body;
  const prodCol = db.collection<Product>('products');
  const invCol = db.collection<any>('inventory');

  const ctvUser = (await getSessionUser(req))!;

  if (!name || !category) {
    return res.status(400).json({ error: 'Tên sản phẩm và danh mục là bắt buộc' });
  }

  const newId = 'prod-ctv-' + Math.random().toString(36).substring(2, 8);
  const pricingError = validateOptionalPricing(price, originalPrice) || (variants.length > 0 || !Array.isArray(variants) ? validateVariantsInput(variants) : null);
  if (pricingError) return res.status(400).json({ error: pricingError });
  const resolvedPrice = Number(price) || 1.0;
  const resolvedOriginalPrice = originalPrice ? Number(originalPrice) : undefined;
  const resolvedVariants =
    variants.length > 0
      ? variants.map((v: any) => ({ ...v, id: v.id || 'var-' + Math.random().toString(36).substring(2, 6), discountBadge: computeDiscountBadge(Number(v.price), v.originalPrice ? Number(v.originalPrice) : undefined) }))
      : [
          {
            id: 'var-' + Math.random().toString(36).substring(2, 6),
            name: (variantName && String(variantName).trim()) || name + ' - Tiêu chuẩn',
            price: resolvedPrice,
            originalPrice: resolvedOriginalPrice,
            // Stock is never stored — always the live count of unsold
            // inventory rows for this variant (see GET /api/products).
            discountBadge: computeDiscountBadge(resolvedPrice, resolvedOriginalPrice),
          },
        ];

  const newProduct: Product = {
    id: newId,
    name,
    category,
    categorySlug: categorySlug || deriveCategorySlug(category),
    image: image || deriveProductImageKey(category),
    rating: 5,
    reviewCount: 0,
    seller: {
      name: `${ctvUser.username}`,
      statusText: 'Đang hoạt động',
      isActive: true,
    },
    createdByUserId: ctvUser.id,
    isHot: false,
    isFeatured: true,
    inStock: true,
    price: resolvedPrice,
    originalPrice: resolvedOriginalPrice,
    badge: computeBestBadge({ price: resolvedPrice, originalPrice: resolvedOriginalPrice, variants: resolvedVariants }),
    variants: resolvedVariants,
    descriptionHtml: description && String(description).trim() ? String(description).trim() : undefined,
    accountFormat: accountFormat && String(accountFormat).trim() ? String(accountFormat).trim() : undefined,
  };

  if (newProduct.descriptionHtml) {
    newProduct.descriptionTranslations = await translateDescriptionToAllLanguages(newProduct.descriptionHtml);
  }

  await prodCol.insertOne(newProduct);

  // The form lets admin paste the initial batch of accounts right alongside
  // the product — actually import them (deduped against the whole
  // warehouse) instead of silently discarding them.
  let importResult = { importedCount: 0, duplicateCount: 0, duplicateUsernames: [] as string[] };
  if (rawAccounts && typeof rawAccounts === 'string' && rawAccounts.trim()) {
    importResult = await importInventoryAccounts(
      invCol,
      newId,
      resolvedVariants[0].id,
      rawAccounts,
      { userId: ctvUser.id, username: ctvUser.username },
      newProduct.name,
      resolvedVariants[0].name
    );
  }

  res.json({ success: true, product: newProduct, ...importResult });
});

// Same ownership rule used elsewhere (CTV stats, CTV chart stats, review
// moderation): a product "belongs" to a CTV if their username appears in
// its seller name, or the seller name is the generic "CTV ..." placeholder.
// Checked in both directions — a product created as "CTV ronan_ctv" contains
// the full username, but a friendlier display name an admin later sets
// (e.g. just "Ronan") is instead a substring OF the username, not the other
// way around, so only checking sellerName.includes(username) missed it.
// Real machine translation (MyMemory — free, no API key required) for
// seller-written product descriptions, which are only ever typed in
// Vietnamese. Computed once whenever a description is saved (see the
// create/edit product handlers below) and cached on the product document —
// never re-requested on every page view, and never fabricated: a language
// the service couldn't reach just stays absent, and the frontend falls back
// to showing the original Vietnamese text for it.
const MYMEMORY_LANG_CODES: Record<'en' | 'zh' | 'th' | 'ja', string> = { en: 'en', zh: 'zh-CN', th: 'th', ja: 'ja' };

async function translateFromVietnamese(text: string, targetLang: 'en' | 'zh' | 'th' | 'ja'): Promise<string | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(trimmed)}&langpair=vi|${MYMEMORY_LANG_CODES[targetLang]}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data: any = await res.json();
    const translated = data?.responseData?.translatedText;
    if (data?.responseStatus !== 200 || !translated || /MYMEMORY WARNING/i.test(translated)) return null;
    return translated;
  } catch {
    return null;
  }
}

async function translateDescriptionToAllLanguages(text: string): Promise<Partial<Record<'en' | 'zh' | 'th' | 'ja', string>>> {
  const [en, zh, th, ja] = await Promise.all([
    translateFromVietnamese(text, 'en'),
    translateFromVietnamese(text, 'zh'),
    translateFromVietnamese(text, 'th'),
    translateFromVietnamese(text, 'ja'),
  ]);
  const result: Partial<Record<'en' | 'zh' | 'th' | 'ja', string>> = {};
  if (en) result.en = en;
  if (zh) result.zh = zh;
  if (th) result.th = th;
  if (ja) result.ja = ja;
  return result;
}

// Fixes up a product's description and account-format after the fact —
// previously these were only ever set once at creation time with no way to
// correct a typo or fill them in later. Admin-only: CTV no longer creates
// or owns any product (admin creates every listing and grants specific
// CTV(s) permission to stock it), so editing the listing itself is always
// an admin action. Clearing a field (sending an empty string) is how "xóa
// mô tả" works — there's no separate delete endpoint, since an empty
// description/format is just the same as never having set one.
app.put('/api/ctv/products/:id/description', requireRole('admin'), async (req, res) => {
  const prodCol = db.collection<Product>('products');
  const product = await prodCol.findOne({ id: req.params.id });
  if (!product) return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });

  const { description, accountFormat } = req.body;
  const cleanDescription = String(description ?? '').trim().slice(0, 3000);
  const cleanFormat = String(accountFormat ?? '').trim().slice(0, 300);

  // Only spend a translation-API call when the description text actually
  // changed; clearing it back to empty clears the cached translations too.
  const descriptionTranslations =
    cleanDescription && cleanDescription !== product.descriptionHtml
      ? await translateDescriptionToAllLanguages(cleanDescription)
      : cleanDescription
        ? product.descriptionTranslations || {}
        : {};

  await prodCol.updateOne(
    { id: req.params.id },
    { $set: { descriptionHtml: cleanDescription, accountFormat: cleanFormat, descriptionTranslations } }
  );
  const updated = await prodCol.findOne({ id: req.params.id });
  res.json({ success: true, product: updated });
});

// Pulls a product off the storefront (or brings it back) without deleting
// it and its inventory. Admin-only, same reasoning as the description
// endpoint above.
app.put('/api/ctv/products/:id/visibility', requireRole('admin'), async (req, res) => {
  const prodCol = db.collection<Product>('products');
  const product = await prodCol.findOne({ id: req.params.id });
  if (!product) return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });

  const { isHidden } = req.body;
  if (typeof isHidden !== 'boolean') {
    return res.status(400).json({ error: 'Thiếu trường isHidden (boolean)' });
  }

  await prodCol.updateOne({ id: req.params.id }, { $set: { isHidden } });
  const updated = await prodCol.findOne({ id: req.params.id });
  res.json({ success: true, product: updated });
});

// Same as above, but for a single variant rather than the whole product —
// e.g. pausing one out-of-stock package while keeping the rest of the
// listing live.
app.put('/api/ctv/products/:id/variants/:variantId/visibility', requireRole('admin'), async (req, res) => {
  const prodCol = db.collection<Product>('products');
  const product = await prodCol.findOne({ id: req.params.id });
  if (!product) return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });

  const { isHidden } = req.body;
  if (typeof isHidden !== 'boolean') {
    return res.status(400).json({ error: 'Thiếu trường isHidden (boolean)' });
  }

  const variants = product.variants || [];
  const idx = variants.findIndex((v) => v.id === req.params.variantId);
  if (idx === -1) return res.status(404).json({ error: 'Không tìm thấy biến thể' });

  variants[idx] = { ...variants[idx], isHidden };
  await prodCol.updateOne({ id: req.params.id }, { $set: { variants } });
  res.json({ success: true, variant: variants[idx] });
});

// Coupon codes are short, human-chosen strings, so anyone logged in could
// otherwise try codes without limit — both through the preview endpoint and
// through checkout (which reports "does not exist" vs "used up" too). Failed
// lookups are counted per account; past the limit that account is locked out
// of coupon lookups for the rest of the window. Only FAILURES count, so a
// customer who types a valid code is never affected. In-memory is fine: it only
// has to slow guessing down, and a restart merely resets the window.
const COUPON_FAIL_LIMIT = 15;
const COUPON_FAIL_WINDOW_MS = 15 * 60 * 1000;
const couponFailures = new Map<string, { count: number; resetAt: number }>();

function isCouponLocked(userId: string): boolean {
  const entry = couponFailures.get(userId);
  if (!entry) return false;
  if (entry.resetAt <= Date.now()) {
    couponFailures.delete(userId);
    return false;
  }
  return entry.count >= COUPON_FAIL_LIMIT;
}

function recordCouponFailure(userId: string): void {
  const now = Date.now();
  if (couponFailures.size > 5000) {
    for (const [key, entry] of couponFailures) if (entry.resetAt <= now) couponFailures.delete(key);
  }
  const entry = couponFailures.get(userId);
  if (!entry || entry.resetAt <= now) couponFailures.set(userId, { count: 1, resetAt: now + COUPON_FAIL_WINDOW_MS });
  else entry.count += 1;
}

const COUPON_LOCKED_MESSAGE = 'Bạn đã thử mã giảm giá sai quá nhiều lần. Vui lòng thử lại sau 15 phút.';

// Same lockout pattern as the coupon guard above, scoped to admin/CTV PIN
// attempts (POST /api/auth/verify-admin-pin) — a short numeric PIN is much
// easier to brute-force than a real password, so this is tighter: fewer
// tries, longer cooldown.
const PIN_FAIL_LIMIT = 5;
const PIN_FAIL_WINDOW_MS = 15 * 60 * 1000;
const pinFailures = new Map<string, { count: number; resetAt: number }>();

function isPinLocked(userId: string): boolean {
  const entry = pinFailures.get(userId);
  if (!entry) return false;
  if (entry.resetAt <= Date.now()) {
    pinFailures.delete(userId);
    return false;
  }
  return entry.count >= PIN_FAIL_LIMIT;
}

function recordPinFailure(userId: string): void {
  const now = Date.now();
  if (pinFailures.size > 5000) {
    for (const [key, entry] of pinFailures) if (entry.resetAt <= now) pinFailures.delete(key);
  }
  const entry = pinFailures.get(userId);
  if (!entry || entry.resetAt <= now) pinFailures.set(userId, { count: 1, resetAt: now + PIN_FAIL_WINDOW_MS });
  else entry.count += 1;
}

function clearPinFailures(userId: string): void {
  pinFailures.delete(userId);
}

const PIN_LOCKED_MESSAGE = 'Bạn đã nhập sai mã PIN quá nhiều lần. Vui lòng thử lại sau 15 phút.';

// 22b. Vouchers CRUD — admin only. CTV no longer create or manage discount
// codes (they can still redeem one at checkout like any other buyer).
app.get('/api/vouchers', requireRole('admin'), async (req, res) => {
  const voucherCol = db.collection<Voucher>('vouchers');
  const vouchers = await voucherCol.find();
  vouchers.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  res.json({ vouchers });
});

app.post('/api/vouchers', requireRole('admin'), async (req, res) => {
  const user = (await getSessionUser(req))!;
  const { code, discountPercent, maxUses, expiresAt, applicableProductId, applicableVariantId } = req.body;

  const cleanCode = String(code || '').trim().toUpperCase().replace(/\s+/g, '');
  const pct = Number(discountPercent);
  const uses = Number(maxUses);

  if (!cleanCode || cleanCode.length < 3) {
    return res.status(400).json({ error: 'Mã voucher phải có ít nhất 3 ký tự' });
  }
  if (!Number.isFinite(pct) || pct <= 0 || pct > 90) {
    return res.status(400).json({ error: 'Phần trăm giảm giá phải từ 1 đến 90' });
  }
  if (!Number.isInteger(uses) || uses <= 0) {
    return res.status(400).json({ error: 'Số lượt sử dụng tối đa phải là số nguyên dương' });
  }

  const voucherCol = db.collection<Voucher>('vouchers');
  if (await voucherCol.findOne({ code: cleanCode })) {
    return res.status(400).json({ error: `Mã "${cleanCode}" đã tồn tại` });
  }

  // Optional scope: a specific product, or a specific variant within that product.
  let scopedProductName: string | undefined;
  let scopedVariantName: string | undefined;
  if (applicableProductId) {
    const prodCol = db.collection<Product>('products');
    const scopedProduct = await prodCol.findOne({ id: String(applicableProductId) });
    if (!scopedProduct) return res.status(400).json({ error: 'Sản phẩm áp dụng không tồn tại' });
    scopedProductName = scopedProduct.name;
    if (applicableVariantId) {
      const scopedVariant = (scopedProduct.variants || []).find((v) => v.id === String(applicableVariantId));
      if (!scopedVariant) return res.status(400).json({ error: 'Biến thể áp dụng không tồn tại' });
      scopedVariantName = scopedVariant.name;
    }
  }

  const newVoucher: Voucher = {
    id: generateObjectId(),
    code: cleanCode,
    discountPercent: pct,
    maxUses: uses,
    usedCount: 0,
    createdBy: user.id,
    createdByUsername: user.username,
    expiresAt: expiresAt || undefined,
    createdAt: new Date().toISOString(),
    applicableProductId: applicableProductId ? String(applicableProductId) : undefined,
    applicableProductName: scopedProductName,
    applicableVariantId: applicableVariantId ? String(applicableVariantId) : undefined,
    applicableVariantName: scopedVariantName,
  };

  await voucherCol.insertOne(newVoucher);
  res.json({ success: true, voucher: newVoucher });
});

app.delete('/api/vouchers/:id', requireRole('admin'), async (req, res) => {
  const voucherCol = db.collection<Voucher>('vouchers');
  const voucher = await voucherCol.findOne({ id: req.params.id });
  if (!voucher) return res.status(404).json({ error: 'Không tìm thấy voucher' });
  await voucherCol.deleteOne({ id: req.params.id });
  const admin = (await getSessionUser(req))!;
  await logAdminAction(admin, 'voucher.delete', `Xóa voucher "${voucher.code}"`, req.params.id);
  res.json({ success: true });
});

// Look up a voucher by code and validate it without consuming a redemption —
// used for the live price preview before checkout.
app.get('/api/vouchers/check/:code', requireAuth(), async (req, res) => {
  const user = (await getSessionUser(req))!;
  if (isCouponLocked(user.id)) return res.status(429).json({ error: COUPON_LOCKED_MESSAGE });

  const cleanCode = String(req.params.code || '').trim().toUpperCase();
  const { productId, variantId } = req.query;
  const voucherCol = db.collection<Voucher>('vouchers');
  const voucher = await voucherCol.findOne({ code: cleanCode });

  // Every rejection below counts toward this account's guess budget.
  const reject = (status: number, error: string) => {
    recordCouponFailure(user.id);
    return res.status(status).json({ error });
  };

  if (!voucher) return reject(404, 'Mã giảm giá không tồn tại');
  if (voucher.expiresAt && new Date(voucher.expiresAt).getTime() < Date.now()) {
    return reject(400, 'Mã giảm giá đã hết hạn');
  }
  if (voucher.usedCount >= voucher.maxUses) {
    return reject(400, 'Mã giảm giá đã hết lượt sử dụng');
  }
  if (voucher.applicableProductId && voucher.applicableProductId !== productId) {
    return reject(400, `Mã giảm giá này chỉ áp dụng cho sản phẩm "${voucher.applicableProductName || voucher.applicableProductId}"`);
  }
  if (voucher.applicableVariantId && voucher.applicableVariantId !== variantId) {
    return reject(400, `Mã giảm giá này chỉ áp dụng cho biến thể "${voucher.applicableVariantName || voucher.applicableVariantId}"`);
  }

  res.json({ valid: true, discountPercent: voucher.discountPercent, code: voucher.code });
});

// 23. Tools: Microsoft OAuth2 & Hotmail Email Reader APIs
function sessionId(length = 4) {
  const text = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let id = "";
  for (let index = 0; index < length; index++) {
    id += text[Math.floor(Math.random() * text.length)];
  }
  return id;
}

function getProxy() {
  let rawStr = (process.env.DEFAULT_PROXY || "").trim();
  if (!rawStr) return { url: "" };
  rawStr = rawStr.replace("{session_id}", sessionId(8)).replace("{country}", "US");
  return { url: rawStr };
}

app.post("/api/get_messages_oauth2", async (req, res) => {
  try {
    const { email, refresh_token, client_id, list_mail = "all" } = req.body;

    if (!email || !refresh_token || !client_id) {
      return res.status(400).json({
        status: false,
        error: "Thiếu thông tin bắt buộc (email, refresh_token, client_id)"
      });
    }

    const response = await fetch("https://tools.dongvanfb.net/api/get_messages_oauth2", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      },
      body: JSON.stringify({
        email,
        refresh_token,
        client_id,
        list_mail
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({
        status: false,
        error: `API trả về lỗi Http ${response.status}: ${errorText}`
      });
    }

    const data = await response.json();
    if (data && data.content === "IMAP connection failed.") {
      return res.json({
        status: false,
        error: `Email | Refresh_Token -> Die`
      });
    }
    return res.json(data);
  } catch (error: any) {
    console.error('[get_messages_oauth2] proxy error:', error);
    return res.status(500).json({
      status: false,
      error: error.message || "Không thể kết nối"
    });
  }
});

app.post("/api/renew_token", async (req, res) => {
  try {
    const { email, refresh_token, client_id, password } = req.body;

    if (!refresh_token || !client_id) {
      return res.status(400).json({
        status: false,
        error: "Thiếu thông tin bắt buộc (refresh_token, client_id)"
      });
    }

    const params = new URLSearchParams();
    params.append("client_id", client_id);
    params.append("grant_type", "refresh_token");
    params.append("refresh_token", refresh_token);
    
    const maxRetries = 1;
    let lastError = "";
    let lastStatus = 500;
    let successResult: any = null;
    let usedProxyUrl: string | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const proxyInfo = getProxy();
      usedProxyUrl = proxyInfo.url;

      try {
        const fetchOptions: any = {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: params.toString()
        };

        if (proxyInfo.url) {
          try {
            const g = globalThis as any;
            if (typeof g.ProxyAgent !== 'undefined') {
              fetchOptions.dispatcher = new g.ProxyAgent(proxyInfo.url);
            } else if (typeof g.HttpsProxyAgent !== 'undefined') {
              fetchOptions.agent = new g.HttpsProxyAgent(proxyInfo.url);
            }
          } catch (e) {
            // ignore proxy setup error
          }
        }

        const response = await fetch("https://login.microsoftonline.com/consumers/oauth2/v2.0/token", fetchOptions);
        if (!response.ok) {
          const errorText = await response.text();
          lastStatus = response.status;
          lastError = `Microsoft OAuth2 HTTP ${response.status}: ${errorText}`;
        } else {
          const r = await response.json();
          successResult = r;
          break;
        }
      } catch (err: any) {
        lastStatus = 500;
        lastError = err.message || "Lỗi kết nối / proxy";
      }

      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    if (!successResult) {
      let message = "Lỗi không xác định";
      if (lastError.includes('"error_codes":[700016]')) {
        message = "OAuth App không hợp lệ (AADSTS700016)";
      } else if (lastError.includes('"error_codes":[700082]')) {
        message = "Refresh Token đã hết hạn (AADSTS700082)";
      } else if (lastError.includes('"error_codes":[70000]')) {
        message = "Refresh Token không hợp lệ";
      }

      return res.status(lastStatus).json({
        status: false,
        error: `${message}`
      });
    }

    const token = successResult.access_token;
    const expiresIn = successResult.expires_in;
    const new_refresh_token = successResult.refresh_token || refresh_token;

    return res.json({
      status: true,
      email: email,
      password: password || "",
      client_id: client_id,
      old_refresh_token: refresh_token,
      new_refresh_token: new_refresh_token,
      access_token: token,
      expires_in: expiresIn,
      proxy_used: usedProxyUrl ? true : false,
      raw: successResult
    });
  } catch (error: any) {
    const timeNow = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" }).replace(" ", " ");
    console.error(`[${timeNow}] ❌ Lỗi renew token:`, error);
    return res.status(500).json({
      status: false,
      error: error.message || "Không thể kết nối tới Microsoft OAuth2 endpoint"
    });
  }
});

// 24. Tools: X (Twitter) Check Live API using converted CheckTwitter GraphQL engine
app.post('/api/tools/x-check-live', async (req, res) => {
  try {
    const { username: rawUsername, raw_line } = req.body;
    let username = (rawUsername || '').trim();
    const rawLine = (raw_line || '').trim();

    if (!username && rawLine) {
      const parts = rawLine.split('|').map((s: string) => s.trim()).filter(Boolean);
      if (parts.length > 0) {
        username = parts[0];
      }
    }
    username = username.replace(/^@/, '').trim();

    if (!username) {
      return res.json({
        isLive: false,
        status: 'WRONG',
        rawStatus: 'WRONG',
        reason: 'Không tìm thấy tên người dùng (Username)',
        username: '',
      });
    }

    // Call the CheckTwitter GraphQL engine
    const checkResult = await twitterChecker.checkLive(username);

    return res.json({
      isLive: checkResult.isLive,
      status: checkResult.status,
      rawStatus: checkResult.rawStatus,
      reason: checkResult.reason,
      following: checkResult.following,
      followers: checkResult.followers,
      post: checkResult.post,
      created_at: checkResult.created_at,
      username: checkResult.username || username,
    });
  } catch (error: any) {
    console.error('Error in x-check-live:', error);
    return res.status(500).json({
      isLive: false,
      status: 'DIE',
      rawStatus: 'ERROR',
      reason: error.message || 'Thất bại',
      username: '',
    });
  }
});

// 25. Tools: X (Twitter) Get Cookie API using cloudflare-api.site
app.post('/api/tools/x-get-cookie', async (req, res) => {
  try {
    const { username: rawUsername, oauth_token, oauth_token_secret, raw_line } = req.body;
    let username = (rawUsername || '').trim();
    let oauthToken = (oauth_token || '').trim();
    let oauthTokenSecret = (oauth_token_secret || '').trim();
    const raw = (raw_line || '').trim();

    // Clean and split raw line
    const rawParts = raw ? raw.split('|').map((s: string) => s.trim()).filter(Boolean) : [];
    const parts = rawParts.filter(
      (p: string) => !p.includes(';') && !p.toLowerCase().includes('auth_token=') && !p.toLowerCase().includes('ct0=')
    );

    // Extract username if available
    if (!username && parts.length > 0) {
      username = parts[0];
    }
    username = username.replace(/^@/, '');
    const displayLabel = username || parts[0] || raw || 'Account';

    // Extract oauthToken and oauthTokenSecret if not provided directly
    if ((!oauthToken || !oauthTokenSecret) && parts.length >= 2) {
      if (parts.length === 2) {
        oauthToken = parts[0];
        oauthTokenSecret = parts[1];
      } else if (parts.length === 3) {
        oauthToken = parts[1];
        oauthTokenSecret = parts[2];
      } else if (parts.length === 4) {
        oauthToken = parts[2];
        oauthTokenSecret = parts[3];
      } else if (parts.length >= 5) {
        oauthToken = parts[parts.length - 2];
        oauthTokenSecret = parts[parts.length - 1];
      }
    }

    // Call cloudflare-api.site as specified by user
    if (oauthToken && oauthTokenSecret) {
      try {
        const jsonCreate = {
          type: 'get_cookie',
          oauth_token: oauthToken,
          oauth_token_secret: oauthTokenSecret,
        };

        const resCreate = await fetch('https://cloudflare-api.site/createTask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(jsonCreate),
          signal: AbortSignal.timeout(20000),
        });

        if (!resCreate.ok) {
          return res.json({
            success: false,
            error: 'Thất bại',
            output: `${displayLabel} | Thất bại`,
          });
        }

        const createData: any = await resCreate.json();
        const taskId = createData?.taskId;

        if (!taskId) {
          return res.json({
            success: false,
            error: 'Thất bại',
            output: `${displayLabel} | Thất bại`,
          });
        }

        // Poll getTaskResult: max_retry = 30, interval = 2s
        const maxRetry = 30;
        for (let attempt = 0; attempt < maxRetry; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 2000));

          try {
            const resResult = await fetch('https://cloudflare-api.site/getTaskResult', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ taskId }),
              signal: AbortSignal.timeout(20000),
            });

            if (resResult.ok) {
              const data: any = await resResult.json();

              if (data?.status === 'ready') {
                const cookie = data?.result?.cookies || '';
                if (cookie) {
                  return res.json({
                    success: true,
                    cookie,
                    output: `${displayLabel} | ${cookie}`,
                    username: displayLabel,
                  });
                } else {
                  return res.json({
                    success: false,
                    error: 'Thất bại',
                    output: `${displayLabel} | Thất bại`,
                    username: displayLabel,
                  });
                }
              }

              if (data?.status === 'failed') {
                return res.json({
                  success: false,
                  error: 'Thất bại',
                  output: `${displayLabel} | Thất bại`,
                });
              }
            }
          } catch (pollErr: any) {
            console.warn(`[getTaskResult] attempt ${attempt + 1} warn:`, pollErr.message);
          }
        }

        return res.json({
          success: false,
          error: 'Thất bại',
          output: `${displayLabel} | Thất bại`,
        });
      } catch (apiErr: any) {
        console.error('Error contacting cloudflare-api.site:', apiErr);
        return res.json({
          success: false,
          error: 'Thất bại',
          output: `${displayLabel} | Thất bại`,
        });
      }
    }

    return res.json({
      success: false,
      error: 'Thất bại',
      output: `${displayLabel} | Thất bại`,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: 'Thất bại',
      output: `Thất bại`,
    });
  }
});

// Vite dev middleware or static serving
async function start() {
  await db.init();

  if (process.env.NODE_ENV !== 'production') {
    // Loaded lazily and only in dev — esbuild bundles a static top-level
    // import into an unconditional require(), which would otherwise force
    // every production install (and Docker image) to carry vite's entire
    // dev-only dependency tree (esbuild, rollup, lightningcss...) just to
    // satisfy a module load that's never actually used there.
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error(`[Unhandled route error] ${req.method} ${req.originalUrl}:`, err);
    if (res.headersSent) return next(err);
    res.status(500).json({ error: 'Lỗi máy chủ nội bộ, vui lòng thử lại sau.' });
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`XCHEAP Store Server running on http://0.0.0.0:${PORT}`);
  });
}

start();
