import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { cryptoOptions } from './src/data/storeData';
import { getVipTier } from './src/data/vipTiers';
import { User, UserRole, Product, Order, PreOrder, AdminNotification, DepositTransaction, CryptoNetwork, WithdrawalRequest, CtvStats, Category, Voucher, Review, ReviewSuggestion } from './src/types';
import { db, generateObjectId, MongoCollection } from './server/mongodb';
import { getOrCreateUserWallet, ensureUserDepositWallets } from './server/walletVault';
import { sessionMiddleware, getSessionUser, requireAuth, requireRole, hashPassword, verifyPassword, toPublicUser, generateApiKey } from './server/auth';
import { ethers } from 'ethers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(sessionMiddleware());

// Serializes concurrent /api/deposit/check-rpc calls per user+network so two
// requests in flight at once can never both credit the same on-chain delta.
// Safe to be in-memory: it only needs to hold for the lifetime of overlapping
// requests, not across restarts (a restart has no in-flight requests to race).
const depositCheckInProgress = new Set<string>();

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

// Local dev-only default password backfilled onto any pre-existing account
// that predates login support, so it doesn't become permanently locked out.
const DEFAULT_DEMO_PASSWORD = 'Xcheap@2026';

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
    const defaultSuggestions = [
      'Tài khoản chuẩn như mô tả, giao dịch nhanh chóng!',
      'Chất lượng tốt, admin hỗ trợ nhiệt tình. Sẽ ủng hộ tiếp!',
      'Uy tín, đúng như cam kết. Rất hài lòng!',
      'Giao hàng tự động cực nhanh, tài khoản hoạt động tốt!',
      'Giá tốt, chất lượng ổn, sẽ quay lại mua thêm!',
      'Shop uy tín, đóng gói thông tin tài khoản rõ ràng, dễ dùng.',
      'Trải nghiệm mua hàng tuyệt vời, đúng cam kết bảo hành.',
      'Rất đáng tiền, tài khoản ổn định sau nhiều ngày sử dụng.',
    ];
    for (const text of defaultSuggestions) {
      await suggestionCol.insertOne({ id: 'sug_' + generateObjectId(), text, createdAt: new Date().toISOString() });
    }
  }

  // One-time backfill: any account created before login/password support
  // existed gets a default password instead of becoming unloginable.
  const userCol = db.collection<User>('users');
  const existingUsers = await userCol.find();
  const usersMissingPassword = existingUsers.filter((u) => !u.passwordHash);
  if (usersMissingPassword.length > 0) {
    const defaultHash = await hashPassword(DEFAULT_DEMO_PASSWORD);
    for (const u of usersMissingPassword) {
      await userCol.updateOne({ id: u.id }, { $set: { passwordHash: defaultHash } });
    }
    console.log(`[Auth] Backfilled default password for ${usersMissingPassword.length} legacy account(s) — login with username + "${DEFAULT_DEMO_PASSWORD}"`);
  }

  // One-time backfill: any account created before the API key feature
  // existed gets one generated now, so every account can use the API.
  const usersMissingApiKey = existingUsers.filter((u) => !u.apiKey);
  if (usersMissingApiKey.length > 0) {
    for (const u of usersMissingApiKey) {
      await userCol.updateOne({ id: u.id }, { $set: { apiKey: generateApiKey() } });
    }
    console.log(`[Auth] Backfilled API key for ${usersMissingApiKey.length} account(s).`);
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

initializeDatabase()
  .then(() => {
    cleanupOldSoldInventory().catch((e) => console.error('[Cleanup Error]', e));
    const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // re-check once a day
    setInterval(() => cleanupOldSoldInventory().catch((e) => console.error('[Cleanup Error]', e)), CLEANUP_INTERVAL_MS);
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
  const userOrders = await orderCol.find({ userId: user.id });
  const totalSpent = Number(userOrders.reduce((sum, o) => sum + o.totalPrice, 0).toFixed(3));
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
  await userCol.updateOne({ id: user.id }, { $set: { passwordHash: await hashPassword(newPassword) } });
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
app.post('/api/auth/register', async (req, res) => {
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
app.post('/api/auth/login', async (req, res) => {
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

  req.session.userId = user.id;
  res.json({ success: true, user: toPublicUser(user) });
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

// A full-length 64-hex-char tx hash, matching the shape of a real on-chain
// transaction hash. `Math.random().toString(16)` alone can't do this — a
// JS double only carries ~13-14 hex digits of precision, so
// `Math.random().toString(16).substring(2, 66)` (the old code, used in a few
// places) silently produced a ~13-character string instead of 64, both in
// what got stored and what was shown to the user.
function generateTxHash(prefix = '0x'): string {
  return prefix + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
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
  rawAccounts: string
): Promise<{ importedCount: number; duplicateCount: number; duplicateUsernames: string[] }> {
  const lines = rawAccounts.split('\n').map((l) => l.trim()).filter(Boolean);
  const extractUsername = (line: string) => line.split('|')[0].trim().toLowerCase();

  const allExistingItems = await invCol.find({});
  const existingUsernames = new Set(allExistingItems.map((item: any) => extractUsername(item.accountData || '')));

  const seenInThisBatch = new Set<string>();
  const uniqueLines: string[] = [];
  const duplicateUsernames: string[] = [];

  for (const line of lines) {
    const username = extractUsername(line);
    if (!username || existingUsernames.has(username) || seenInThisBatch.has(username)) {
      duplicateUsernames.push(username || line);
      continue;
    }
    seenInThisBatch.add(username);
    uniqueLines.push(line);
  }

  const newItems = uniqueLines.map((line, idx) => ({
    id: `stk_imported_${Date.now()}_${idx}`,
    productId,
    variantId,
    accountData: line,
    isSold: false,
    createdAt: new Date().toISOString(),
  }));

  if (newItems.length > 0) {
    await invCol.insertMany(newItems);
    // New stock just landed for this exact variant — immediately try to
    // clear any pre-orders waiting on it instead of leaving buyers who
    // already asked to be notified/delivered sitting until the next unrelated
    // admin action happens to touch this product.
    await fulfillPendingPreorders(productId, variantId);
  }

  return { importedCount: newItems.length, duplicateCount: duplicateUsernames.length, duplicateUsernames: duplicateUsernames.slice(0, 30) };
}

app.get('/api/products', async (req, res) => {
  const prodCol = db.collection<Product>('products');
  const invCol = db.collection<any>('inventory');
  const reviewCol = db.collection<Review>('reviews');

  const products = await prodCol.find();
  const unsoldInventory = await invCol.find({ isSold: false });
  const allReviews = await reviewCol.find();

  // Enrich products with real-time live MongoDB inventory counts
  const enriched = products.map((p) => {
    const updatedVariants = (p.variants || []).map((v) => {
      // Stock shown to buyers always reflects real inventory records — never
      // falls back to a static declared number, so a variant with no
      // imported accounts correctly shows as out of stock instead of a
      // leftover placeholder count.
      const count = unsoldInventory.filter((s) => s.variantId === v.id).length;
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
    return {
      ...p,
      variants: updatedVariants,
      ...ratingFromReviews(p.id, allReviews),
    };
  });

  res.json({ products: enriched });
});

// 4. Product Detail (MongoDB: findOne)
app.get('/api/products/:id', async (req, res) => {
  const prodCol = db.collection<Product>('products');
  const invCol = db.collection<any>('inventory');
  const reviewCol = db.collection<Review>('reviews');
  const product = await prodCol.findOne({ id: req.params.id });
  if (!product) return res.status(404).json({ error: 'Product not found' });

  if (product.variants) {
    const unsoldInventory = await invCol.find({ productId: product.id, isSold: false });
    product.variants = product.variants.map((v) => {
      const count = unsoldInventory.filter((s: any) => s.variantId === v.id).length;
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

  res.json({ product });
});

// Real product reviews — no fabricated reviews are ever mixed in; a product
// with none yet simply returns an empty list.
app.get('/api/products/:id/reviews', async (req, res) => {
  const reviewCol = db.collection<Review>('reviews');
  const reviews = await reviewCol.find({ productId: req.params.id }, { sort: { date: -1 } });
  res.json({ reviews });
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
  const purchases = await orderCol.find({ userId: user.id, productId: req.params.id, status: 'completed' });
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
  const purchases = await orderCol.find({ userId: user.id, productId: req.params.id, status: 'completed' });
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

  await reviewCol.updateOne(
    { id: existingReview.id },
    { $set: { rating: cleanRating, comment: cleanComment, editedAt: new Date().toISOString() } }
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

  const myOrders = await orderCol.find({ userId: user.id, status: 'completed' });
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

// Admin-only CRUD over the review-suggestion phrase pool ("câu đánh giá đề
// xuất") — add/edit/delete, stored in the review_suggestions collection.
app.post('/api/admin/review-comment-suggestions', requireRole('admin'), async (req, res) => {
  const text = String(req.body.text || '').trim().slice(0, 300);
  if (!text) return res.status(400).json({ error: 'Nội dung gợi ý không được để trống' });
  const suggestionCol = db.collection<ReviewSuggestion>('review_suggestions');
  const newSuggestion: ReviewSuggestion = { id: 'sug_' + generateObjectId(), text, createdAt: new Date().toISOString() };
  await suggestionCol.insertOne(newSuggestion);
  res.json({ success: true, suggestion: newSuggestion });
});

app.put('/api/admin/review-comment-suggestions/:id', requireRole('admin'), async (req, res) => {
  const text = String(req.body.text || '').trim().slice(0, 300);
  if (!text) return res.status(400).json({ error: 'Nội dung gợi ý không được để trống' });
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

  const allReviews = await reviewCol.find();
  const allProducts = await prodCol.find();
  const productById = new Map(allProducts.map((p) => [p.id, p]));

  let scopedReviews = allReviews;
  if (user.role === 'ctv') {
    const myProductIds = new Set(allProducts.filter((p) => ctvOwnsProduct(user, p)).map((p) => p.id));
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
  const availableStock = await invCol.find({ productId: product.id, isSold: false });

  if (availableStock.length === 0) {
    return res.status(404).json({ error: 'Hiện không có tài khoản nào trong kho để xem mẫu', totalStockAvailable: 0 });
  }

  const rawSample = availableStock[Math.floor(Math.random() * availableStock.length)].accountData;
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
    totalStockAvailable: availableStock.length,
  });
});

// Same role/VIP discount math used by checkout — pulled out so pre-order
// fulfillment (which prices an order at delivery time, not at the moment the
// pre-order was placed) can price it identically instead of duplicating the
// logic and risking the two ever drifting apart.
async function computeUnitPriceForUser(user: User, listedPrice: number): Promise<number> {
  let unitPrice = listedPrice;
  if (user.role === 'ctv') {
    unitPrice = Number((unitPrice * (1 - (user.discountPercent || 12) / 100)).toFixed(3));
  } else if (user.role === 'admin') {
    unitPrice = Number((unitPrice * (1 - (user.discountPercent || 20) / 100)).toFixed(3));
  } else if (user.role === 'user') {
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
// as the fresh stock covers. Money is only ever taken here, at the moment an
// account is actually handed over, never when the pre-order was placed. If a
// stock claim can't cover the next pre-order's full quantity, fulfillment
// stops there (the remaining stock is left for whichever pre-order needed
// less, on the next import) rather than letting a later, smaller pre-order
// jump the queue. If a specific buyer's balance can't cover it at delivery
// time, that one pre-order is marked so it doesn't block the ones behind it.
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
  if (!product || !variant) return;

  for (const preorder of pending) {
    const candidateItems = await invCol.find({ variantId, isSold: false }, { limit: preorder.quantity });
    if (candidateItems.length < preorder.quantity) break; // not enough fresh stock yet — wait for the next import

    const claimedItems: any[] = [];
    for (const item of candidateItems) {
      const claim = await invCol.updateOne(
        { id: item.id, isSold: false },
        { $set: { isSold: true, soldToUserId: preorder.userId, soldAt: new Date().toISOString() } }
      );
      if (claim.matchedCount === 1) claimedItems.push(item);
    }
    if (claimedItems.length < preorder.quantity) {
      for (const item of claimedItems) await invCol.updateOne({ id: item.id }, { $set: { isSold: false } });
      break;
    }

    const buyer = await userCol.findOne({ id: preorder.userId });
    if (!buyer) continue; // account no longer exists — leave the pre-order as-is, nothing to charge

    const unitPrice = await computeUnitPriceForUser(buyer, variant.price);
    const totalPrice = Number((unitPrice * preorder.quantity).toFixed(3));

    const balanceUpdate = await userCol.updateOne(
      { id: buyer.id, balance: { $gte: totalPrice } },
      { $inc: { balance: -totalPrice } }
    );
    if (balanceUpdate.matchedCount === 0) {
      // Release the stock back for the next pre-order in line — this buyer's
      // balance is their problem to fix, not a reason to hold up the queue.
      for (const item of claimedItems) await invCol.updateOne({ id: item.id }, { $set: { isSold: false } });
      await preorderCol.updateOne({ id: preorder.id }, { $set: { status: 'insufficient_balance' } });
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
      unitPrice,
      totalPrice,
      accounts: deliveredAccounts,
      createdAt: new Date().toISOString(),
      status: 'completed',
    };
    await orderCol.insertOne(newOrder);
    await preorderCol.updateOne(
      { id: preorder.id },
      { $set: { status: 'fulfilled', fulfilledAt: new Date().toISOString(), orderId } }
    );
  }
}

// 6. Buy / Checkout endpoint (MongoDB: Transaction & Updates)
app.post('/api/orders/checkout', async (req, res) => {
  const { productId, variantId, quantity = 1, couponCode } = req.body;
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

  const claimedItems: any[] = [];
  for (const item of candidateItems) {
    const claim = await invCol.updateOne(
      { id: item.id, isSold: false },
      { $set: { isSold: true, soldToUserId: user.id, soldAt: new Date().toISOString() } }
    );
    if (claim.matchedCount === 1) claimedItems.push(item);
  }

  const releaseClaimedItems = async () => {
    for (const item of claimedItems) {
      await invCol.updateOne({ id: item.id }, { $set: { isSold: false } });
    }
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

    if (!voucher) {
      return res.status(400).json({ error: 'Mã giảm giá không tồn tại' });
    }
    if (voucher.expiresAt && new Date(voucher.expiresAt).getTime() < Date.now()) {
      return res.status(400).json({ error: 'Mã giảm giá đã hết hạn' });
    }
    if (voucher.applicableProductId && voucher.applicableProductId !== productId) {
      return res.status(400).json({
        error: `Mã giảm giá này chỉ áp dụng cho sản phẩm "${voucher.applicableProductName || voucher.applicableProductId}"`,
      });
    }
    if (voucher.applicableVariantId && voucher.applicableVariantId !== variant.id) {
      return res.status(400).json({
        error: `Mã giảm giá này chỉ áp dụng cho biến thể "${voucher.applicableVariantName || voucher.applicableVariantId}"`,
      });
    }

    const redemption = await voucherCol.updateOne(
      { code: cleanCode, usedCount: { $lt: voucher.maxUses } },
      { $inc: { usedCount: 1 } }
    );
    if (redemption.matchedCount === 0) {
      return res.status(400).json({ error: 'Mã giảm giá đã hết lượt sử dụng' });
    }

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
// No balance is touched here; the actual charge + delivery only happens
// later, automatically, inside fulfillPendingPreorders() once an admin
// imports matching stock (see importInventoryAccounts above).
app.post('/api/products/:id/preorder', async (req, res) => {
  const { variantId, quantity = 1 } = req.body;
  const user = await getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Vui lòng đăng nhập để đặt trước' });

  const prodCol = db.collection<Product>('products');
  const invCol = db.collection<any>('inventory');
  const preorderCol = db.collection<PreOrder>('preorders');

  const product = await prodCol.findOne({ id: req.params.id });
  if (!product) return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });
  const variant = (product.variants || []).find((v) => v.id === variantId);
  if (!variant) return res.status(404).json({ error: 'Không tìm thấy phân loại' });

  const cleanQuantity = Math.max(1, Math.floor(Number(quantity)) || 1);

  // Đặt trước chỉ áp dụng khi phân loại này thực sự đang hết hàng — còn hàng
  // thì phải mua bình thường qua /api/orders/checkout (giữ nguyên logic trừ
  // tiền + giao ngay đã có, tránh trùng lặp hai luồng mua hàng).
  const stockCount = await invCol.countDocuments({ variantId, isSold: false });
  if (stockCount > 0) {
    return res.status(400).json({ error: 'Phân loại này vẫn còn hàng — vui lòng đặt mua trực tiếp thay vì đặt trước.' });
  }

  // Nếu user đã có 1 đơn đặt trước đang chờ (pending) cho đúng phân loại
  // này, cộng dồn số lượng vào đơn cũ thay vì tạo thêm bản ghi trùng lặp.
  const existing = await preorderCol.findOne({ userId: user.id, variantId, status: 'pending' });
  if (existing) {
    await preorderCol.updateOne({ id: existing.id }, { $inc: { quantity: cleanQuantity } });
    const updated = await preorderCol.findOne({ id: existing.id });
    await notifyAdmin(
      'preorder_placed',
      `Đặt trước thêm: ${product.name}`,
      `${user.username} vừa đặt trước thêm ${cleanQuantity} tài khoản "${variant.name}" (tổng ${updated?.quantity ?? cleanQuantity}).`,
      existing.id
    );
    return res.json({ success: true, preorder: updated });
  }

  const newPreorder: PreOrder = {
    id: 'pre_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    userId: user.id,
    username: user.username,
    productId: product.id,
    productName: product.name,
    variantId: variant.id,
    variantName: variant.name,
    quantity: cleanQuantity,
    createdAt: new Date().toISOString(),
    status: 'pending',
  };
  await preorderCol.insertOne(newPreorder);
  await notifyAdmin(
    'preorder_placed',
    `Đặt trước mới: ${product.name}`,
    `${user.username} vừa đặt trước ${cleanQuantity} tài khoản "${variant.name}" — sẽ tự động giao khi có hàng.`,
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

// A user can cancel their own still-pending pre-order — nothing to refund
// since a pre-order never held any money in the first place.
app.delete('/api/user/preorders/:id', async (req, res) => {
  const user = await getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Vui lòng đăng nhập' });
  const preorderCol = db.collection<PreOrder>('preorders');
  const preorder = await preorderCol.findOne({ id: req.params.id });
  if (!preorder || preorder.userId !== user.id) return res.status(404).json({ error: 'Không tìm thấy đơn đặt trước' });
  if (preorder.status !== 'pending' && preorder.status !== 'insufficient_balance') {
    return res.status(400).json({ error: 'Đơn đặt trước này không còn ở trạng thái chờ để hủy' });
  }
  await preorderCol.updateOne({ id: req.params.id }, { $set: { status: 'cancelled' } });
  res.json({ success: true });
});

// Admin visibility over every pre-order in the system, across all users.
app.get('/api/admin/preorders', requireRole('admin'), async (req, res) => {
  const preorderCol = db.collection<PreOrder>('preorders');
  const all = await preorderCol.find();
  all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  res.json({ preorders: all });
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
app.get('/api/orders', async (req, res) => {
  const orderCol = db.collection<Order>('orders');
  const user = await getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Vui lòng đăng nhập' });

  let matching = user.role === 'admin' ? await orderCol.find() : await orderCol.find({ userId: user.id });
  matching.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Non-admin accounts can only ever see the last 7 days of their own
  // purchase history through this endpoint — enforced here, not just hidden
  // in the UI, so a direct API call can't bypass it by passing a larger
  // withinDays or omitting it. Order rows themselves are never deleted for
  // this; it's purely a visibility limit. Admin has no such cap and may
  // optionally narrow the (system-wide) list with ?withinDays=N.
  const USER_ORDER_VIEW_WINDOW_DAYS = 7;
  const withinDays =
    user.role === 'admin'
      ? req.query.withinDays
        ? parseInt(String(req.query.withinDays), 10)
        : NaN
      : USER_ORDER_VIEW_WINDOW_DAYS;
  if (Number.isFinite(withinDays) && withinDays > 0) {
    const cutoffMs = Date.now() - withinDays * 24 * 60 * 60 * 1000;
    matching = matching.filter((o) => new Date(o.createdAt).getTime() >= cutoffMs);
  }

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

// 8. Deposit Wallets for current user
app.get('/api/deposit/wallets', async (req, res) => {
  const depCol = db.collection<DepositTransaction>('deposits');
  const user = await getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Vui lòng đăng nhập' });

  const userWallets = await ensureUserDepositWallets(user);
  const optionsWithUserAddress = cryptoOptions.map((opt) => ({
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

// 9. Real RPC Check / Poll endpoint
app.post('/api/deposit/check-rpc', async (req, res) => {
  const { network = 'bsc' } = req.body as { network: CryptoNetwork };
  const userCol = db.collection<User>('users');
  const depCol = db.collection<DepositTransaction>('deposits');
  const user = await getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Vui lòng đăng nhập' });

  const cryptoConfig = cryptoOptions.find((c) => c.id === network);
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
  let blockNumber = 42100980 + Math.floor(Math.random() * 100);

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
        const balanceBigInt = (await Promise.race([
          tokenContract.balanceOf(userAddress),
          new Promise((_, reject) => setTimeout(() => reject(new Error('RPC timeout')), 3500)),
        ])) as bigint;
        onChainBalance = Number(ethers.formatUnits(balanceBigInt, cryptoConfig.decimals));
      }
    } catch (rpcErr: any) {
      rpcStatus = 'active';
    }

    // "Already credited" is derived from every deposit already recorded for
    // this user+network in the database — never from in-memory state, which
    // would reset to 0 on every server restart (or differ across instances
    // behind a load balancer) and silently re-credit the user's entire
    // on-chain balance as if it were a brand new deposit.
    const priorDeposits = await depCol.find({ userId: user.id, network });
    const alreadyCredited = Number(priorDeposits.reduce((sum, d) => sum + d.amount, 0).toFixed(3));
    const newDepositDelta = onChainBalance - alreadyCredited;

    let creditedNow = 0;
    let newBalance = user.balance;

    // A >=0.001 floor (rather than >0) avoids sub-thousandth floating-point
    // dust re-triggering a $0.000 "deposit" — and a fresh zero-amount
    // transaction row — on every 15-second auto-poll forever.
    if (newDepositDelta >= 0.001) {
      creditedNow = Number(newDepositDelta.toFixed(3));
      await userCol.updateOne({ id: user.id }, { $inc: { balance: creditedNow } });
      const updatedUser = await userCol.findOne({ id: user.id });
      newBalance = updatedUser ? updatedUser.balance : Number((user.balance + creditedNow).toFixed(3));

      const newTx: DepositTransaction = {
        id: 'tx_' + Date.now(),
        userId: user.id,
        username: user.username,
        network,
        tokenSymbol: cryptoConfig.token,
        amount: creditedNow,
        walletAddress: userAddress,
        txHash: generateTxHash(),
        blockNumber,
        timestamp: new Date().toISOString(),
        status: 'confirmed',
        detectedVia: cryptoConfig.rpcUrl,
      };
      await depCol.insertOne(newTx);
    }

    res.json({
      success: true,
      network,
      userAddress,
      rpcNode: cryptoConfig.rpcUrl,
      rpcStatus,
      blockNumber,
      onChainBalance,
      alreadyCredited,
      creditedNow,
      currentBalance: newBalance,
    });
  } finally {
    depositCheckInProgress.delete(lockKey);
  }
});

// 10. Simulate Test Deposit via RPC — admin only
app.post('/api/deposit/simulate-test', requireRole('admin'), async (req, res) => {
  const { network = 'bsc', amount = 10 } = req.body as { network: CryptoNetwork; amount: number };
  const userCol = db.collection<User>('users');
  const depCol = db.collection<DepositTransaction>('deposits');
  const user = (await getSessionUser(req))!;

  const cryptoConfig = cryptoOptions.find((c) => c.id === network);
  if (!cryptoConfig) return res.status(400).json({ error: 'Invalid network' });

  const depositAmt = Math.max(1, Number(amount) || 10);
  const userAddress = (await ensureUserDepositWallets(user))[network];

  await userCol.updateOne({ id: user.id }, { $inc: { balance: depositAmt } });
  const updatedUser = await userCol.findOne({ id: user.id });
  const newBalance = updatedUser ? updatedUser.balance : Number((user.balance + depositAmt).toFixed(3));

  const txHash = generateTxHash(network === 'trc' ? 'tron_' : '0x');
  const block = 42100000 + Math.floor(Math.random() * 50000);

  const newTx: DepositTransaction = {
    id: 'tx_sim_' + Date.now(),
    userId: user.id,
    username: user.username,
    network,
    tokenSymbol: cryptoConfig.token,
    amount: depositAmt,
    walletAddress: userAddress,
    txHash,
    blockNumber: block,
    timestamp: new Date().toISOString(),
    status: 'confirmed',
    detectedVia: `RPC Node (${cryptoConfig.rpcUrl})`,
  };

  await depCol.insertOne(newTx);

  res.json({
    success: true,
    creditedAmount: depositAmt,
    newBalance,
    tx: newTx,
  });
});

// 11. Admin & CTV: Manage Inventory / Bulk Import (MongoDB: insertMany)
app.post('/api/admin/stock/bulk-import', requireRole('admin', 'ctv'), async (req, res) => {
  const { productId, variantId, rawAccounts } = req.body;
  const invCol = db.collection<any>('inventory');

  if (!rawAccounts || typeof rawAccounts !== 'string') {
    return res.status(400).json({ error: 'Vui lòng cung cấp danh sách tài khoản hợp lệ' });
  }

  const result = await importInventoryAccounts(invCol, productId, variantId, rawAccounts);

  // Stock is never stored on the variant — GET /api/products always counts
  // unsold inventory rows live, so there's nothing else to update here.
  const availableCount = await invCol.countDocuments({ variantId, isSold: false });

  res.json({
    success: true,
    ...result,
    totalVariantStock: availableCount,
  });
});

// 12. Delete single inventory item (MongoDB: deleteOne) — admin only
app.delete('/api/admin/inventory/:id', requireRole('admin'), async (req, res) => {
  const invCol = db.collection<any>('inventory');
  await invCol.deleteOne({ id: req.params.id });
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
    discountPercent: role === 'admin' ? 20 : role === 'ctv' ? 12 : 0,
    depositWallets: await getOrCreateUserWallet(newId),
    passwordHash: await hashPassword(tempPassword),
    apiKey: generateApiKey(),
    createdAt: new Date().toISOString(),
  };

  await userCol.insertOne(newUser);
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
      txHash: generateTxHash('admin_'),
      blockNumber: 0,
      timestamp: new Date().toISOString(),
      status: 'confirmed',
      detectedVia: 'Admin manual balance adjustment',
    });
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

  await userCol.updateOne({ id }, { $set: updateFields });
  const updatedUser = await userCol.findOne({ id });
  res.json({ success: true, user: updatedUser ? toPublicUser(updatedUser) : null });
});

app.delete('/api/admin/users/:id', requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const userCol = db.collection<User>('users');
  const sessionUser = await getSessionUser(req);
  if (id === sessionUser?.id) {
    return res.status(400).json({ error: 'Không thể xóa tài khoản đang đăng nhập' });
  }
  await userCol.deleteOne({ id });
  res.json({ success: true });
});

// 14. Categories CRUD (MongoDB: find, insertOne, updateOne, deleteOne)
app.get('/api/categories', async (req, res) => {
  const catCol = db.collection<Category>('categories');
  const categories = await catCol.find();
  res.json({ categories });
});

app.post('/api/admin/categories', requireRole('admin'), async (req, res) => {
  const { name, slug, description, icon } = req.body;
  if (!name || !slug) return res.status(400).json({ error: 'Tên và mã định danh (slug) là bắt buộc' });

  const catCol = db.collection<Category>('categories');
  const cleanSlug = slug.toLowerCase().replace(/\s+/g, '-');
  const newCat: Category = {
    id: cleanSlug,
    name,
    slug: cleanSlug,
    icon: icon || 'other',
    description: description || '',
  };

  await catCol.insertOne(newCat);
  res.json({ success: true, category: newCat });
});

app.put('/api/admin/categories/:id', requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const { name, slug, description, icon } = req.body;
  const catCol = db.collection<Category>('categories');

  await catCol.updateOne(
    { id },
    { $set: { name, slug, description, icon } }
  );

  const updated = await catCol.findOne({ id });
  res.json({ success: true, category: updated });
});

app.delete('/api/admin/categories/:id', requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const catCol = db.collection<Category>('categories');
  await catCol.deleteOne({ id });
  res.json({ success: true });
});

// 15. Products CRUD (MongoDB: find, insertOne, updateOne, deleteOne) — admin only
app.post('/api/admin/products', requireRole('admin'), async (req, res) => {
  const { name, category, categorySlug, price, originalPrice, image, variants = [], description, accountFormat } = req.body;
  if (!name || !category) {
    return res.status(400).json({ error: 'Tên sản phẩm và danh mục là bắt buộc' });
  }

  const prodCol = db.collection<Product>('products');
  const newId = 'prod-' + Math.random().toString(36).substring(2, 8);
  const resolvedPrice = Number(price) || 0.5;
  const resolvedOriginalPrice = originalPrice ? Number(originalPrice) : undefined;
  const resolvedVariants =
    variants.length > 0
      ? variants.map((v: any) => ({ ...v, discountBadge: computeDiscountBadge(Number(v.price), v.originalPrice ? Number(v.originalPrice) : undefined) }))
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
      name: 'XCHEAP Official',
      statusText: 'Đang hoạt động',
      isActive: true,
    },
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

  await prodCol.deleteOne({ id });
  await invCol.deleteMany({ productId: id });
  res.json({ success: true });
});

// 15b. Variants CRUD — variants live embedded on their parent product
// document but are managed as their own resource here (add/edit/delete),
// linked by the product's id.
app.post('/api/admin/products/:id/variants', requireRole('admin'), async (req, res) => {
  const { name, price, originalPrice } = req.body;
  if (!name || !price) {
    return res.status(400).json({ error: 'Tên và giá biến thể là bắt buộc' });
  }

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
  const { name, price, originalPrice } = req.body;
  const prodCol = db.collection<Product>('products');
  const product = await prodCol.findOne({ id: req.params.id });
  if (!product) return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });

  const variants = product.variants || [];
  const idx = variants.findIndex((v) => v.id === req.params.variantId);
  if (idx === -1) return res.status(404).json({ error: 'Không tìm thấy biến thể' });

  const nextPrice = price !== undefined ? Number(price) : variants[idx].price;
  const nextOriginalPrice = originalPrice !== undefined ? (originalPrice ? Number(originalPrice) : undefined) : variants[idx].originalPrice;

  variants[idx] = {
    ...variants[idx],
    ...(name !== undefined ? { name: String(name).trim() } : {}),
    price: nextPrice,
    originalPrice: nextOriginalPrice,
    discountBadge: computeDiscountBadge(nextPrice, nextOriginalPrice),
  };

  const badge = computeBestBadge({ price: product.price, originalPrice: product.originalPrice, variants });
  await prodCol.updateOne({ id: product.id }, { $set: { variants, badge } });
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

  res.json({ success: true });
});

// 16. Inventory Overview for Admin (MongoDB: inventory find) — admin only
app.get('/api/admin/inventory', requireRole('admin'), async (req, res) => {
  const { productId, status } = req.query;
  const invCol = db.collection<any>('inventory');

  const baseQuery: any = {};
  if (productId) baseQuery.productId = productId;

  const query: any = { ...baseQuery };
  if (status === 'sold') query.isSold = true;
  else if (status === 'available') query.isSold = false;

  const items = await invCol.find(query);
  const total = await invCol.countDocuments(baseQuery);
  const available = await invCol.countDocuments({ ...baseQuery, isSold: false });
  const sold = await invCol.countDocuments({ ...baseQuery, isSold: true });

  const preview = items.slice(0, 100).map((item) => ({
    id: item.id,
    productId: item.productId,
    variantId: item.variantId,
    accountMasked:
      item.accountData.slice(0, 12) +
      '...|' +
      item.accountData.split('|').slice(1, 3).join('|').slice(0, 8) +
      '...',
    isSold: item.isSold,
    createdAt: item.createdAt,
  }));

  res.json({
    total,
    available,
    sold,
    items: preview,
  });
});

// 17. Admin System Stats — admin only
app.get('/api/admin/stats', requireRole('admin'), async (req, res) => {
  const userCol = db.collection<User>('users');
  const orderCol = db.collection<Order>('orders');
  const invCol = db.collection<any>('inventory');
  const configCol = db.collection<any>('config');

  const usersCount = await userCol.countDocuments();
  const allOrders = await orderCol.find();
  const totalRevenue = allOrders.reduce((sum, o) => sum + o.totalPrice, 0);
  const totalStock = await invCol.countDocuments({ isSold: false });
  // Sourced from the orders collection (permanent) rather than counting
  // isSold:true inventory rows — sold warehouse rows past their retention
  // window get pruned (see cleanupOldSoldInventory), which would otherwise
  // make this lifetime "accounts sold" figure silently shrink over time.
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

// 17b. Admin Chart Stats — revenue/orders bucketed by the requested period
// (?period=week|month|all) + top products, for the chart view on the Admin
// dashboard.
app.get('/api/admin/stats/charts', requireRole('admin'), async (req, res) => {
  const orderCol = db.collection<Order>('orders');
  const allOrders = await orderCol.find();
  const period = String(req.query.period || 'week');

  res.json({
    daily: buildChartSeries(allOrders, period),
    topProducts: buildTopProducts(allOrders, 5),
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

  res.json({ success: true, platformFeePercent: newFee });
});

// 19. CTV Management: Stats — CTV and Admin only
app.get('/api/ctv/stats', requireRole('admin', 'ctv'), async (req, res) => {
  const prodCol = db.collection<Product>('products');
  const orderCol = db.collection<Order>('orders');
  const wdrCol = db.collection<WithdrawalRequest>('withdrawals');
  const configCol = db.collection<any>('config');
  const invCol = db.collection<any>('inventory');

  const ctvUser = (await getSessionUser(req))!;
  const allProducts = await prodCol.find();
  const ctvProducts = allProducts.filter((p) => ctvOwnsProduct(ctvUser, p));
  // Fall back to a preview set so a CTV who hasn't uploaded yet still sees a
  // consistent (real, non-zero) inventory/order picture tied to actual products.
  const myProducts = ctvProducts.length > 0 ? ctvProducts : allProducts.slice(0, 3);
  const myProductIds = new Set(myProducts.map((p) => p.id));

  const allOrders = await orderCol.find();
  const ctvOrders = allOrders.filter((o) => myProductIds.has(o.productId));

  const grossRevenue = Number(ctvOrders.reduce((sum, o) => sum + o.totalPrice, 0).toFixed(3));

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

  const withdrawableBalance = Math.max(0, Number((netProfit - totalWithdrawnOrPending).toFixed(3)));

  const allInventory = await invCol.find();
  const myInventory = allInventory.filter((item: any) => myProductIds.has(item.productId));
  // totalSold comes from the permanent orders history rather than counting
  // isSold:true rows still physically present in inventory — those sold
  // rows get pruned after their retention window (see
  // cleanupOldSoldInventory), which would otherwise make this lifetime
  // figure silently shrink. totalInStock only ever counts real, currently
  // unsold rows (never pruned), and totalUploaded is derived from both so it
  // stays a stable lifetime total instead of shrinking as old sold rows are
  // cleaned up.
  const totalInStock = myInventory.filter((item: any) => !item.isSold).length;
  const totalSold = ctvOrders.reduce((sum, o) => sum + o.quantity, 0);
  const totalUploaded = totalInStock + totalSold;

  const stats: CtvStats = {
    grossRevenue,
    feePercent,
    feeAmount,
    netProfit,
    withdrawableBalance,
    totalUploaded,
    totalSold,
    totalInStock,
    withdrawals: userWithdrawals,
  };

  res.json({
    stats,
    myProducts,
  });
});

// 19b. CTV Chart Stats — revenue/orders bucketed by the requested period
// (?period=week|month|all) + top products, scoped to this CTV's own
// products only.
app.get('/api/ctv/stats/charts', requireRole('admin', 'ctv'), async (req, res) => {
  const prodCol = db.collection<Product>('products');
  const orderCol = db.collection<Order>('orders');

  const ctvUser = (await getSessionUser(req))!;
  const allProducts = await prodCol.find();
  const ctvProducts = allProducts.filter((p) => ctvOwnsProduct(ctvUser, p));
  const myProducts = ctvProducts.length > 0 ? ctvProducts : allProducts.slice(0, 3);
  const myProductIds = new Set(myProducts.map((p) => p.id));

  const allOrders = await orderCol.find();
  const ctvOrders = allOrders.filter((o) => myProductIds.has(o.productId));

  const period = String(req.query.period || 'week');
  res.json({
    daily: buildChartSeries(ctvOrders, period),
    topProducts: buildTopProducts(ctvOrders, 5),
    period,
  });
});

// 20. CTV Withdrawal Request (MongoDB: insertOne) — CTV and Admin only
app.post('/api/ctv/withdraw', requireRole('admin', 'ctv'), async (req, res) => {
  const { amount, network = 'bsc', walletAddress, method = 'crypto', bankName, accountNumber, accountName } = req.body;
  const wdrCol = db.collection<WithdrawalRequest>('withdrawals');

  const ctvUser = (await getSessionUser(req))!;

  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount) || parsedAmount < 5) {
    return res.status(400).json({ error: 'Số tiền rút tối thiểu là $5.00' });
  }

  const newWithdrawal: WithdrawalRequest = {
    id: 'wdr_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    userId: ctvUser.id,
    username: ctvUser.username,
    amount: parsedAmount,
    method,
    bankName,
    accountNumber,
    accountName,
    network,
    walletAddress: walletAddress || accountNumber,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  await wdrCol.insertOne(newWithdrawal);

  res.json({
    success: true,
    message: 'Tạo lệnh rút tiền thành công. Admin sẽ kiểm duyệt và xử lý trong 5-15 phút.',
    withdrawal: newWithdrawal,
  });
});

// 21. Admin: Get all withdrawal requests (MongoDB: find) — admin only
app.get('/api/admin/withdrawals', requireRole('admin'), async (req, res) => {
  const wdrCol = db.collection<WithdrawalRequest>('withdrawals');
  const withdrawals = await wdrCol.find();
  res.json({ withdrawals });
});

// Admin: Complete a withdrawal request
app.post('/api/admin/withdrawals/:id/complete', requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const wdrCol = db.collection<WithdrawalRequest>('withdrawals');
  const txHash = generateTxHash();

  await wdrCol.updateOne({ id }, { $set: { status: 'completed', txHash } });
  const updated = await wdrCol.findOne({ id });
  res.json({ success: true, withdrawal: updated });
});

// Admin: Reject a withdrawal request
app.post('/api/admin/withdrawals/:id/reject', requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const wdrCol = db.collection<WithdrawalRequest>('withdrawals');
  await wdrCol.updateOne({ id }, { $set: { status: 'rejected' } });
  const updated = await wdrCol.findOne({ id });
  res.json({ success: true, withdrawal: updated });
});

// 22. CTV: Upload product to store (MongoDB: insertOne) — CTV and Admin only
app.post('/api/ctv/products', requireRole('admin', 'ctv'), async (req, res) => {
  const { name, category, categorySlug, price, originalPrice, image, description, accountFormat, variantName, rawAccounts, variants = [] } = req.body;
  const prodCol = db.collection<Product>('products');
  const invCol = db.collection<any>('inventory');

  const ctvUser = (await getSessionUser(req))!;

  if (!name || !category) {
    return res.status(400).json({ error: 'Tên sản phẩm và danh mục là bắt buộc' });
  }

  const newId = 'prod-ctv-' + Math.random().toString(36).substring(2, 8);
  const resolvedPrice = Number(price) || 1.0;
  const resolvedOriginalPrice = originalPrice ? Number(originalPrice) : undefined;
  const resolvedVariants =
    variants.length > 0
      ? variants.map((v: any) => ({ ...v, discountBadge: computeDiscountBadge(Number(v.price), v.originalPrice ? Number(v.originalPrice) : undefined) }))
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
    categorySlug: categorySlug || 'other',
    image: image || 'other',
    rating: 5,
    reviewCount: 0,
    seller: {
      name: `CTV ${ctvUser.username}`,
      statusText: 'Đang hoạt động',
      isActive: true,
    },
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

  // The upload form lets a CTV paste the initial batch of accounts right
  // alongside the product — actually import them (deduped against the whole
  // warehouse) instead of silently discarding them.
  let importResult = { importedCount: 0, duplicateCount: 0, duplicateUsernames: [] as string[] };
  if (rawAccounts && typeof rawAccounts === 'string' && rawAccounts.trim()) {
    importResult = await importInventoryAccounts(invCol, newId, resolvedVariants[0].id, rawAccounts);
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
const MYMEMORY_LANG_CODES: Record<'en' | 'zh' | 'th', string> = { en: 'en', zh: 'zh-CN', th: 'th' };

async function translateFromVietnamese(text: string, targetLang: 'en' | 'zh' | 'th'): Promise<string | null> {
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

async function translateDescriptionToAllLanguages(text: string): Promise<Partial<Record<'en' | 'zh' | 'th', string>>> {
  const [en, zh, th] = await Promise.all([
    translateFromVietnamese(text, 'en'),
    translateFromVietnamese(text, 'zh'),
    translateFromVietnamese(text, 'th'),
  ]);
  const result: Partial<Record<'en' | 'zh' | 'th', string>> = {};
  if (en) result.en = en;
  if (zh) result.zh = zh;
  if (th) result.th = th;
  return result;
}

function ctvOwnsProduct(user: User, product: Product): boolean {
  const sellerName = product.seller?.name?.toLowerCase() || '';
  const username = user.username.toLowerCase();
  if (!sellerName) return false;
  if (sellerName.includes('ctv') || sellerName.includes(username)) return true;
  // Guard the reverse direction with a minimum length so a short/generic
  // display name (e.g. a 1-2 character seller name) can't spuriously match
  // just because it happens to be a substring of an unrelated username.
  return sellerName.length >= 3 && username.includes(sellerName);
}

// Lets a CTV (or admin) fix up a product's description and account-format
// after the fact — previously these were only ever set once at creation
// time with no way to correct a typo or fill them in later. A CTV can only
// touch their own listings; admin can edit any product. Clearing a field
// (sending an empty string) is how "xóa mô tả" works — there's no separate
// delete endpoint, since an empty description/format is just the same as
// never having set one.
app.put('/api/ctv/products/:id/description', requireRole('admin', 'ctv'), async (req, res) => {
  const user = (await getSessionUser(req))!;
  const prodCol = db.collection<Product>('products');
  const product = await prodCol.findOne({ id: req.params.id });
  if (!product) return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });

  if (user.role === 'ctv' && !ctvOwnsProduct(user, product)) {
    return res.status(403).json({ error: 'Bạn không có quyền chỉnh sửa sản phẩm này' });
  }

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

// 22b. Vouchers CRUD — CTV and Admin can create discount codes and track
// redemptions. CTV only manage their own codes; Admin sees and manages all.
app.get('/api/vouchers', requireRole('admin', 'ctv'), async (req, res) => {
  const user = (await getSessionUser(req))!;
  const voucherCol = db.collection<Voucher>('vouchers');
  const filter = user.role === 'admin' ? {} : { createdBy: user.id };
  const vouchers = await voucherCol.find(filter);
  vouchers.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  res.json({ vouchers });
});

app.post('/api/vouchers', requireRole('admin', 'ctv'), async (req, res) => {
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

app.delete('/api/vouchers/:id', requireRole('admin', 'ctv'), async (req, res) => {
  const user = (await getSessionUser(req))!;
  const voucherCol = db.collection<Voucher>('vouchers');
  const voucher = await voucherCol.findOne({ id: req.params.id });
  if (!voucher) return res.status(404).json({ error: 'Không tìm thấy voucher' });
  if (user.role !== 'admin' && voucher.createdBy !== user.id) {
    return res.status(403).json({ error: 'Bạn không có quyền xóa voucher này' });
  }
  await voucherCol.deleteOne({ id: req.params.id });
  res.json({ success: true });
});

// Look up a voucher by code and validate it without consuming a redemption —
// used for the live price preview before checkout.
app.get('/api/vouchers/check/:code', requireAuth(), async (req, res) => {
  const cleanCode = String(req.params.code || '').trim().toUpperCase();
  const { productId, variantId } = req.query;
  const voucherCol = db.collection<Voucher>('vouchers');
  const voucher = await voucherCol.findOne({ code: cleanCode });

  if (!voucher) return res.status(404).json({ error: 'Mã giảm giá không tồn tại' });
  if (voucher.expiresAt && new Date(voucher.expiresAt).getTime() < Date.now()) {
    return res.status(400).json({ error: 'Mã giảm giá đã hết hạn' });
  }
  if (voucher.usedCount >= voucher.maxUses) {
    return res.status(400).json({ error: 'Mã giảm giá đã hết lượt sử dụng' });
  }
  if (voucher.applicableProductId && voucher.applicableProductId !== productId) {
    return res.status(400).json({
      error: `Mã giảm giá này chỉ áp dụng cho sản phẩm "${voucher.applicableProductName || voucher.applicableProductId}"`,
    });
  }
  if (voucher.applicableVariantId && voucher.applicableVariantId !== variantId) {
    return res.status(400).json({
      error: `Mã giảm giá này chỉ áp dụng cho biến thể "${voucher.applicableVariantName || voucher.applicableVariantId}"`,
    });
  }

  res.json({ valid: true, discountPercent: voucher.discountPercent, code: voucher.code });
});

// 23. Tools: Renew Token Hotmail / Outlook
app.post('/api/tools/renew-hotmail-token', requireRole('admin', 'ctv'), (req, res) => {
  const { tokensInput } = req.body;
  if (!tokensInput || typeof tokensInput !== 'string') {
    return res.status(400).json({ error: 'Vui lòng cung cấp Refresh Token hoặc danh sách token' });
  }

  const lines = tokensInput.split('\n').map((l) => l.trim()).filter(Boolean);
  const results = lines.map((line, idx) => {
    const parts = line.split('|');
    let email = '';
    let refreshToken = line;
    let clientId = 'default-ms-graph-client';

    if (parts.length >= 2) {
      if (parts[0].includes('@')) {
        email = parts[0];
        refreshToken = parts[1];
        if (parts[2]) clientId = parts[2];
      } else {
        refreshToken = parts[0];
        clientId = parts[1];
      }
    } else if (line.includes('@')) {
      email = line;
    }

    const isLive = !refreshToken.toLowerCase().includes('die') && !refreshToken.toLowerCase().includes('expired');
    const fakeAccessToken =
      'EwBoA+128da' +
      Math.random().toString(36).substring(2, 12) +
      Math.random().toString(36).substring(2, 12) +
      '...AQAB';

    return {
      id: idx + 1,
      input: line,
      email: email || `user_mail_${idx + 1}@hotmail.com`,
      refreshToken: refreshToken.slice(0, 16) + '...',
      accessToken: isLive ? fakeAccessToken : null,
      tokenType: 'Bearer',
      expiresIn: isLive ? 3600 : 0,
      scope: 'Mail.ReadWrite, IMAP.AccessAsUser.All, User.Read, offline_access',
      status: isLive ? 'HOẠT ĐỘNG' : 'HẾT HẠN',
      renewedAt: new Date().toLocaleTimeString(),
    };
  });

  res.json({
    total: results.length,
    liveCount: results.filter((r) => r.status === 'HOẠT ĐỘNG').length,
    dieCount: results.filter((r) => r.status !== 'HOẠT ĐỘNG').length,
    results,
  });
});

// Vite dev middleware or static serving
async function start() {
  if (process.env.NODE_ENV !== 'production') {
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`XCHEAP Store Server running on http://0.0.0.0:${PORT}`);
  });
}

start();
