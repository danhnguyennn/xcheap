export type UserRole = 'user' | 'ctv' | 'admin';

export type Language = 'vn' | 'en' | 'zh' | 'th';

export type CryptoNetwork = 'bsc' | 'polygon' | 'trc' | 'base';

export interface CryptoOption {
  id: CryptoNetwork;
  name: string;
  token: string;
  networkLabel: string;
  decimals: number;
  contractAddress: string;
  rpcUrl: string;
  explorerTxUrl: string;
  icon: string;
  minDeposit: number;
  chainId?: number; // EVM chain id, used to skip ethers' network auto-detection
  // Admin can pull a deposit network off the deposit page without deleting
  // its config (and without breaking any already-generated user wallet
  // addresses for it) — same on/off pattern as Product.isHidden.
  isHidden?: boolean;
}

export interface User {
  id: string;
  username: string;
  email: string;
  role: UserRole;
  balance: number;
  discountPercent: number; // e.g. 10% for CTV
  depositWallets: Record<CryptoNetwork, string>;
  passwordHash?: string; // server-side only — a public User response must never include this
  // Like passwordHash, stripped from every public User response by default
  // (toPublicUser) — it's only ever re-attached on a user's own /api/user/me
  // response, never when listing/returning OTHER accounts.
  apiKey?: string;
  // Bumped whenever the password changes. Every login session records the
  // value it was created under; a session whose recorded value no longer
  // matches is treated as logged out (see getSessionUser). Server-side only —
  // stripped from public User responses like passwordHash.
  authVersion?: number;
  phone?: string;
  telegram?: string;
  createdAt: string;
  // Computed on each /api/user/me response from lifetime confirmed deposits —
  // not a stored field. Only meaningful for role === 'user' accounts.
  vipDiscountPercent?: number;
  vipTierKey?: string;
}

export interface AccountSummary {
  user: User;
  totalDeposited: number;
  totalSpent: number;
}

export interface ProductVariant {
  id: string;
  name: string;
  price: number;
  originalPrice?: number;
  discountBadge?: string;
  // Never stored in the database — GET /api/products and /api/products/:id
  // always compute these live from the real inventory collection and inject
  // them into the response, so they're only optional from storage's point
  // of view. Any variant object that actually reached the frontend has them.
  stockCount?: number;
  inStock?: boolean;
  // Set by the owning CTV/Admin to pull a variant off the storefront without
  // deleting it (and its inventory) outright — e.g. to pause selling one
  // package while restocking. Missing/false means visible, same as before
  // this field existed, so no backfill is needed for existing variants.
  isHidden?: boolean;
}

export interface Product {
  id: string;
  name: string;
  category: string;
  categorySlug: string;
  badge?: string;
  image: string;
  rating: number;
  reviewCount: number;
  // Internal: the login name of whoever listed the product. Only ever sent to
  // admin/CTV — stripped from the public product API (the storefront doesn't
  // render it), so it's absent on anything a guest/shopper received.
  seller?: {
    name: string;
    statusText: string;
    isActive: boolean;
  };
  // The account id of whoever actually created this listing (admin or CTV) —
  // the real source of truth for ownership checks (see ctvOwnsProduct in
  // server.ts). seller.name is just a display string and must never be
  // parsed back into an ownership decision: two different CTVs both get
  // "CTV" in their seller name, so substring-matching it would let any CTV
  // manage any other CTV's listings.
  createdByUserId?: string;
  isHot?: boolean;
  isFeatured?: boolean;
  // Set by the owning CTV/Admin to pull the whole product off the
  // storefront without deleting it — hidden products are skipped by every
  // customer-facing listing/detail/category-count endpoint, but still show
  // up (clearly marked) in the owner's own admin/CTV product table so they
  // can be unhidden later. Missing/false means visible.
  isHidden?: boolean;
  inStock: boolean;
  price: number;
  originalPrice?: number;
  variants: ProductVariant[];
  // Real, per-product content written by whoever listed it (CTV or admin) —
  // never a fixed/shared default. Both are optional: a product with neither
  // set yet just shows no description/format block rather than a fabricated
  // placeholder. Editable and clearable at any time after creation via
  // PUT /api/admin/products/:id (admin) or PUT /api/ctv/products/:id/description
  // (the owning CTV).
  descriptionHtml?: string;
  accountFormat?: string;
  // Real machine translations of descriptionHtml (source language is always
  // Vietnamese, since that's what CTV/admin actually write) — computed once
  // server-side whenever the description is saved, not fabricated and not
  // recomputed on every page view. Missing a key just means that language's
  // translation isn't available yet (e.g. the translation service was
  // unreachable when saved) — the frontend falls back to the original
  // Vietnamese text rather than showing anything made up.
  descriptionTranslations?: Partial<Record<'en' | 'zh' | 'th', string>>;
  // Whitelist of CTV account ids admin has explicitly granted permission to
  // upload stock into this product — CTV no longer creates products (only
  // admin does, via POST /api/admin/products), so this is the only way a
  // CTV gets access to a storefront at all. Several CTVs can be granted the
  // same product, which is exactly why income has to be attributed per
  // uploaded row (see Order.uploaderBreakdown) rather than per product.
  // Admin-only info — never sent on the public-facing GET /api/products.
  authorizedCtvIds?: string[];
}

export interface AccountStockItem {
  id: string;
  productId: string;
  variantId: string;
  data: string; // UID|Password|2FA|Email|EmailPass|BackupCodes|Cookie
  isSold: boolean;
  soldToUserId?: string;
  soldAt?: string;
  orderId?: string;
}

export interface Order {
  id: string;
  orderCode: string;
  userId: string;
  username: string;
  productId: string;
  productName: string;
  variantId: string;
  variantName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  accounts: string[];
  createdAt: string;
  status: 'completed' | 'refunded';
  // Set only when an admin refunds this order (see POST
  // /api/admin/orders/:orderCode/refund) — absent on every normal order.
  refundedAt?: string;
  // Snapshot, at purchase time, of which CTV(s) uploaded the specific
  // inventory rows this order claimed — admin can authorize several CTVs on
  // the same product, so income has to be attributed per uploaded row, not
  // per product. Captured on the order itself (never re-derived from the
  // inventory rows later) because sold inventory rows get pruned after
  // their retention window — see cleanupOldSoldInventory in server.ts —
  // which would otherwise make a CTV's lifetime income silently shrink as
  // old rows are cleaned up. Absent on orders placed before this feature
  // existed, and an entry is skipped for any claimed row that (for the
  // same legacy reason) has no uploader recorded on it.
  uploaderBreakdown?: { userId: string; username: string; quantity: number }[];
}

// A manual balance adjustment admin makes against a CTV's earned income —
// e.g. a penalty for a bad batch of accounts, or correcting a mistake.
// Always negative in effect (see POST /api/admin/ctv-deductions): it's
// subtracted from withdrawableBalance alongside real withdrawals, and kept
// as a permanent, visible record for both admin and the CTV themselves
// rather than silently editing any stored balance number.
export interface CtvDeduction {
  id: string;
  ctvUserId: string;
  ctvUsername: string;
  amount: number;
  reason: string;
  createdAt: string;
  adminId: string;
  adminUsername: string;
}

// A "đặt trước" (pre-order) placed against a variant that's currently out of
// stock — no money changes hands until real inventory shows up and it's
// auto-fulfilled (see fulfillPendingPreorders in server.ts). It never holds
// a price: pricing (role/VIP discounts) is only ever computed live, at the
// moment it's actually fulfilled, exactly like a normal checkout.
export interface PreOrder {
  id: string;
  userId: string;
  username: string;
  productId: string;
  productName: string;
  variantId: string;
  variantName: string;
  quantity: number;
  createdAt: string;
  status: 'pending' | 'fulfilled' | 'insufficient_balance' | 'cancelled';
  fulfilledAt?: string;
  orderId?: string;
}

// A real, server-generated event admin needs to see — e.g. a user placing a
// pre-order. Never fabricated client-side: the bell in the header only ever
// shows rows that actually exist in this collection.
export interface AdminNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
  relatedId?: string;
}

export interface DepositTransaction {
  id: string;
  userId: string;
  username: string;
  network: CryptoNetwork;
  tokenSymbol: string;
  amount: number;
  walletAddress: string;
  txHash: string;
  blockNumber: number;
  timestamp: string;
  status: 'confirmed' | 'pending';
  detectedVia: string;
  // Set once the stored txHash/blockNumber of an older row has been checked
  // against the chain (see recoverDepositTxHashes) so it isn't re-checked.
  txHashChecked?: boolean;
  // How many start-ups tried and failed to resolve it (gives up after a few).
  txHashAttempts?: number;
}

export interface Review {
  id: string;
  productId: string;
  userId: string;
  author: string;
  rating: number;
  date: string;
  comment: string;
  editedAt?: string;
  // Only present when the reviewer is a regular user (role 'user') with an
  // active VIP tier at the time the review list was fetched — a CTV/admin
  // reviewer never gets one, since they don't receive the VIP perk either.
  authorVipTierKey?: string;
}

// Quick-pick phrases shown in the review form — managed by admin (add/edit/
// delete) and stored in the DB rather than hardcoded, so the pool can be
// tuned without a code change. Always positive/praise phrasing by design;
// nothing negative is ever suggested to a reviewer.
export interface ReviewSuggestion {
  id: string;
  text: Record<Language, string>;
  createdAt: string;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  description?: string;
  icon?: string;
  count?: number;
}

export interface WithdrawalRequest {
  id: string;
  userId: string;
  username: string;
  amount: number;
  method?: 'bank' | 'crypto' | 'momo';
  bankName?: string;
  accountNumber?: string;
  accountName?: string;
  note?: string;
  network?: CryptoNetwork;
  walletAddress?: string;
  status: 'pending' | 'completed' | 'rejected';
  createdAt: string;
  txHash?: string;
}

export interface CtvStats {
  grossRevenue: number;
  feePercent: number;
  feeAmount: number;
  netProfit: number;
  totalDeducted: number;
  withdrawableBalance: number;
  totalUploaded: number;
  totalSold: number;
  totalInStock: number;
  withdrawals: WithdrawalRequest[];
  deductions: CtvDeduction[];
  // This CTV's own contribution to each product it's authorized on — a
  // product can be stocked by several CTVs now, so this is this CTV's
  // personal slice of it, not the product's overall numbers.
  byProduct: { productId: string; productName: string; totalInStock: number; totalSold: number; grossRevenue: number }[];
}

export interface Voucher {
  id: string;
  code: string; // uppercase, unique
  discountPercent: number;
  maxUses: number;
  usedCount: number;
  createdBy: string; // userId
  createdByUsername: string;
  expiresAt?: string; // ISO date, optional
  createdAt: string;
  // Scope: omitted = applies to every product. Set productId only = applies to
  // any variant of that product. Set both = applies to that exact variant only.
  applicableProductId?: string;
  applicableProductName?: string; // denormalized for display, avoids a join in the admin/ctv tables
  applicableVariantId?: string;
  applicableVariantName?: string;
}
