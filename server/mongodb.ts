import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { MongoClient, Db, Collection, Filter, Document } from 'mongodb';

// Define MongoDB Document interface
export interface MongoDoc {
  _id?: any;
  id?: string;
  [key: string]: any;
}

// The dedupe key of an inventory row: the account's username — always the
// first "|"-separated field of the account line — trimmed and lowercased.
// Stored on every row (usernameKey, indexed) so bulk import can look up
// "does this username already exist anywhere in the warehouse?" for just the
// usernames in the pasted batch, instead of loading the entire inventory.
export function inventoryUsernameKey(accountData: string): string {
  return String(accountData || '').split('|')[0].trim().toLowerCase();
}

// Generate a MongoDB ObjectId-like 24-character hex id
export function generateObjectId(): string {
  const timestamp = Math.floor(Date.now() / 1000).toString(16).padStart(8, '0');
  const random = Array.from({ length: 16 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('');
  return timestamp + random;
}

const STANDARD_COLLECTIONS = [
  'products',
  'categories',
  'users',
  'orders',
  'inventory',
  'withdrawals',
  'config',
  'deposits',
  'wallets',
  'vouchers',
  'reviews',
  'review_suggestions',
  'preorders',
  'admin_notifications',
  'ctv_deductions',
  'deposit_checkpoints'
];

function matchesFilter(item: any, query: Record<string, any>): boolean {
  if (!query || Object.keys(query).length === 0) return true;
  for (const [key, expected] of Object.entries(query)) {
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      if ('$lt' in expected && !(item[key] < expected.$lt)) return false;
      if ('$lte' in expected && !(item[key] <= expected.$lte)) return false;
      if ('$gt' in expected && !(item[key] > expected.$gt)) return false;
      if ('$gte' in expected && !(item[key] >= expected.$gte)) return false;
      if ('$ne' in expected && item[key] === expected.$ne) return false;
      if ('$in' in expected && (!Array.isArray(expected.$in) || !expected.$in.includes(item[key]))) return false;
    } else {
      if (item[key] !== expected) return false;
    }
  }
  return true;
}

function applySort<T>(items: T[], sortObj?: Record<string, 1 | -1>): T[] {
  if (!sortObj) return items;
  const sortKeys = Object.entries(sortObj);
  return [...items].sort((a: any, b: any) => {
    for (const [k, dir] of sortKeys) {
      if (a[k] < b[k]) return dir === 1 ? -1 : 1;
      if (a[k] > b[k]) return dir === 1 ? 1 : -1;
    }
    return 0;
  });
}

export class MongoCollection<T extends MongoDoc> {
  public name: string;
  private col: Collection<Document> | null = null;
  private memoryDocs: T[] = [];

  constructor(collection: Collection<Document> | null, name: string, initialDocs: T[] = []) {
    this.col = collection;
    this.name = name;
    this.memoryDocs = [...initialDocs];
  }

  public setRealCollection(col: Collection<Document>) {
    this.col = col;
  }

  // MongoDB: find()
  public async find(
    query: Record<string, any> = {},
    options?: { sort?: Record<string, 1 | -1>; limit?: number; skip?: number; projection?: Record<string, 0 | 1> }
  ): Promise<T[]> {
    if (this.col) {
      try {
        let cursor = this.col.find(query as Filter<Document>);
        // Lets callers leave out heavy fields they don't need (e.g. an order's
        // delivered "accounts" array) so a dashboard scan doesn't pull every
        // sold credential out of the database.
        if (options?.projection) cursor = cursor.project(options.projection);
        if (options?.sort) cursor = cursor.sort(options.sort);
        if (options?.skip) cursor = cursor.skip(options.skip);
        if (options?.limit) cursor = cursor.limit(options.limit);
        return (await cursor.toArray()) as unknown as T[];
      } catch (err) {
        console.warn(`[MongoDB] Query on collection ${this.name} failed, falling back to in-memory:`, err);
      }
    }

    let results = this.memoryDocs.filter((doc) => matchesFilter(doc, query));
    if (options?.sort) {
      results = applySort(results, options.sort);
    }
    if (options?.skip) {
      results = results.slice(options.skip);
    }
    if (options?.limit) {
      results = results.slice(0, options.limit);
    }
    const cloned = JSON.parse(JSON.stringify(results));
    if (options?.projection) {
      const entries = Object.entries(options.projection);
      const exclude = entries.every(([, v]) => v === 0);
      for (const doc of cloned) {
        for (const key of Object.keys(doc)) {
          if (key === '_id' || key === 'id') continue;
          const listed = entries.some(([k, v]) => k === key && v === (exclude ? 0 : 1));
          if (exclude ? listed : !listed) delete doc[key];
        }
      }
    }
    return cloned;
  }

  // One (or a few) random documents matching the filter, picked inside the
  // database. Used where the old approach was to load EVERY matching row into
  // memory only to pick one of them.
  public async sample(query: Record<string, any>, size = 1): Promise<T[]> {
    if (this.col) {
      try {
        const rows = await this.col.aggregate([{ $match: query as Filter<Document> }, { $sample: { size } }]).toArray();
        return rows as unknown as T[];
      } catch (err) {
        console.warn(`[MongoDB] sample on collection ${this.name} failed, falling back to in-memory:`, err);
      }
    }
    const pool = this.memoryDocs.filter((doc) => matchesFilter(doc, query));
    const picked: T[] = [];
    while (picked.length < size && pool.length > 0) {
      picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    }
    return JSON.parse(JSON.stringify(picked));
  }

  // MongoDB: findOne()
  public async findOne(query: Record<string, any>): Promise<T | null> {
    if (this.col) {
      try {
        const doc = await this.col.findOne(query as Filter<Document>);
        return (doc as unknown as T) ?? null;
      } catch (err) {
        console.warn(`[MongoDB] findOne on collection ${this.name} failed, falling back to in-memory:`, err);
      }
    }

    const doc = this.memoryDocs.find((item) => matchesFilter(item, query));
    return doc ? JSON.parse(JSON.stringify(doc)) : null;
  }

  // MongoDB: insertOne()
  public async insertOne(doc: T): Promise<{ acknowledged: boolean; insertedId: string }> {
    const clone: any = { ...doc };
    if (!clone.id) clone.id = generateObjectId();
    if (!clone.createdAt) clone.createdAt = new Date().toISOString();

    if (this.col) {
      try {
        const result = await this.col.insertOne(clone);
        return { acknowledged: result.acknowledged, insertedId: clone.id };
      } catch (err) {
        console.warn(`[MongoDB] insertOne on collection ${this.name} failed, updating in-memory:`, err);
      }
    }

    this.memoryDocs.push(clone);
    return { acknowledged: true, insertedId: clone.id };
  }

  // MongoDB: insertMany()
  public async insertMany(docs: T[]): Promise<{ acknowledged: boolean; insertedCount: number }> {
    if (docs.length === 0) return { acknowledged: true, insertedCount: 0 };
    const newDocs = docs.map((doc) => {
      const clone: any = { ...doc };
      if (!clone.id) clone.id = generateObjectId();
      if (!clone.createdAt) clone.createdAt = new Date().toISOString();
      return clone;
    });

    if (this.col) {
      try {
        const result = await this.col.insertMany(newDocs);
        return { acknowledged: result.acknowledged, insertedCount: result.insertedCount };
      } catch (err) {
        console.warn(`[MongoDB] insertMany on collection ${this.name} failed, updating in-memory:`, err);
      }
    }

    this.memoryDocs.push(...newDocs);
    return { acknowledged: true, insertedCount: newDocs.length };
  }

  // MongoDB: updateOne()
  public async updateOne(
    query: Record<string, any>,
    update: { $set?: Partial<T>; $inc?: Record<string, number> }
  ): Promise<{ matchedCount: number; modifiedCount: number }> {
    if (this.col) {
      try {
        const mongoUpdate: Record<string, any> = {};
        if (update.$set) mongoUpdate.$set = { ...update.$set, updatedAt: new Date().toISOString() };
        if (update.$inc) mongoUpdate.$inc = update.$inc;
        const result = await this.col.updateOne(query as Filter<Document>, mongoUpdate);
        return { matchedCount: result.matchedCount, modifiedCount: result.modifiedCount };
      } catch (err) {
        console.warn(`[MongoDB] updateOne on collection ${this.name} failed, updating in-memory:`, err);
      }
    }

    const index = this.memoryDocs.findIndex((item) => matchesFilter(item, query));
    if (index === -1) return { matchedCount: 0, modifiedCount: 0 };

    const target: any = this.memoryDocs[index];
    if (update.$set) {
      Object.assign(target, update.$set);
      target.updatedAt = new Date().toISOString();
    }
    if (update.$inc) {
      for (const [key, amount] of Object.entries(update.$inc)) {
        target[key] = (Number(target[key]) || 0) + Number(amount);
      }
    }
    return { matchedCount: 1, modifiedCount: 1 };
  }

  // MongoDB: bulkWrite() with a list of updateOne-style operations — one
  // network round-trip for N updates instead of N. Used where a request
  // needs to claim/release many inventory rows at once (e.g. buying a large
  // quantity in one checkout); doing that with N sequential updateOne calls
  // made large purchases take seconds to minutes instead of near-instant.
  public async bulkWrite(
    ops: { filter: Record<string, any>; update: { $set?: Partial<T> } }[]
  ): Promise<{ matchedCount: number; modifiedCount: number }> {
    if (ops.length === 0) return { matchedCount: 0, modifiedCount: 0 };

    if (this.col) {
      try {
        const now = new Date().toISOString();
        const bulkOps = ops.map((op) => ({
          updateOne: {
            filter: op.filter as Filter<Document>,
            update: { $set: { ...op.update.$set, updatedAt: now } },
          },
        }));
        const result = await this.col.bulkWrite(bulkOps, { ordered: false });
        return { matchedCount: result.matchedCount, modifiedCount: result.modifiedCount };
      } catch (err) {
        console.warn(`[MongoDB] bulkWrite on collection ${this.name} failed, updating in-memory:`, err);
      }
    }

    // In-memory fallback — same semantics as updateOne, applied per op.
    let matchedCount = 0;
    for (const op of ops) {
      const index = this.memoryDocs.findIndex((item) => matchesFilter(item, op.filter));
      if (index === -1) continue;
      matchedCount++;
      const target: any = this.memoryDocs[index];
      if (op.update.$set) {
        Object.assign(target, op.update.$set);
        target.updatedAt = new Date().toISOString();
      }
    }
    return { matchedCount, modifiedCount: matchedCount };
  }

  // Group-and-aggregate in the database: returns one row per distinct value of
  // groupField (count of matching docs, plus the sum of sumField when given).
  // Lets callers get "how many unsold rows per variant" or "average rating per
  // product" without pulling every document into memory just to count them.
  public async groupBy(
    groupField: string,
    filter: Record<string, any> = {},
    sumField?: string
  ): Promise<{ key: any; count: number; sum: number }[]> {
    if (this.col) {
      try {
        const rows = await this.col
          .aggregate([
            { $match: filter as Filter<Document> },
            { $group: { _id: '$' + groupField, count: { $sum: 1 }, sum: { $sum: sumField ? '$' + sumField : 0 } } },
          ])
          .toArray();
        return rows.map((r: any) => ({ key: r._id, count: Number(r.count), sum: Number(r.sum) }));
      } catch (err) {
        console.warn(`[MongoDB] groupBy on collection ${this.name} failed, using in-memory:`, err);
      }
    }
    const groups = new Map<any, { key: any; count: number; sum: number }>();
    for (const item of this.memoryDocs as any[]) {
      if (!matchesFilter(item, filter)) continue;
      const key = item[groupField];
      const g = groups.get(key) || { key, count: 0, sum: 0 };
      g.count += 1;
      if (sumField) g.sum += Number(item[sumField]) || 0;
      groups.set(key, g);
    }
    return Array.from(groups.values());
  }

  // MongoDB: deleteOne()
  public async deleteOne(query: Record<string, any>): Promise<{ acknowledged: boolean; deletedCount: number }> {
    if (this.col) {
      try {
        const result = await this.col.deleteOne(query as Filter<Document>);
        return { acknowledged: result.acknowledged, deletedCount: result.deletedCount };
      } catch (err) {
        console.warn(`[MongoDB] deleteOne on collection ${this.name} failed, updating in-memory:`, err);
      }
    }

    const index = this.memoryDocs.findIndex((item) => matchesFilter(item, query));
    if (index === -1) return { acknowledged: true, deletedCount: 0 };

    this.memoryDocs.splice(index, 1);
    return { acknowledged: true, deletedCount: 1 };
  }

  // MongoDB: deleteMany()
  public async deleteMany(query: Record<string, any>): Promise<{ acknowledged: boolean; deletedCount: number }> {
    if (this.col) {
      try {
        const result = await this.col.deleteMany(query as Filter<Document>);
        return { acknowledged: result.acknowledged, deletedCount: result.deletedCount };
      } catch (err) {
        console.warn(`[MongoDB] deleteMany on collection ${this.name} failed, updating in-memory:`, err);
      }
    }

    const initialLength = this.memoryDocs.length;
    this.memoryDocs = this.memoryDocs.filter((item) => !matchesFilter(item, query));
    const deletedCount = initialLength - this.memoryDocs.length;
    return { acknowledged: true, deletedCount };
  }

  // MongoDB: countDocuments()
  public async countDocuments(query: Record<string, any> = {}): Promise<number> {
    if (this.col) {
      try {
        return await this.col.countDocuments(query as Filter<Document>);
      } catch (err) {
        console.warn(`[MongoDB] countDocuments on collection ${this.name} failed, falling back to in-memory:`, err);
      }
    }

    return this.memoryDocs.filter((item) => matchesFilter(item, query)).length;
  }
}

// Database Manager with In-Memory fallback for AI Studio container environment
export class MongoDBEngine {
  public uri: string;
  private dbName: string;
  private client: MongoClient | null = null;
  private database: Db | null = null;
  private collections: Map<string, MongoCollection<any>> = new Map();
  public isConnected: boolean = false;
  // server.ts calls init() from two independent startup paths (seeding in
  // initializeDatabase(), then again before app.listen() in start()) — both
  // need the connection ready, but without this guard each call opened its
  // own MongoClient, doubling every startup log line and leaking the first
  // client. Caching the in-flight/completed promise makes every caller after
  // the first just await the same connection instead of reconnecting.
  private initPromise: Promise<void> | null = null;

  constructor(uri: string, dbName: string) {
    this.uri = uri;
    this.dbName = dbName;
  }

  public collection<T extends MongoDoc>(name: string): MongoCollection<T> {
    if (!this.collections.has(name)) {
      const realCol = this.database ? this.database.collection(name) : null;
      const col = new MongoCollection<T>(realCol, name);
      this.collections.set(name, col);
    }
    return this.collections.get(name)!;
  }

  public async init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.connect();
    }
    return this.initPromise;
  }

  private async connect(): Promise<void> {
    if (process.env.MONGODB_URI) {
      try {
        const safeUri = this.uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@');
        console.log(`[MongoDB] Attempting connection to ${safeUri}...`);
        this.client = new MongoClient(this.uri, { serverSelectionTimeoutMS: 20000 });
        await this.client.connect();
        this.database = this.client.db(this.dbName);
        this.isConnected = true;
        console.log(`[MongoDB] Connected successfully to database "${this.dbName}".`);

        for (const [name, col] of this.collections.entries()) {
          col.setRealCollection(this.database.collection(name));
        }

        await this.ensureIndexes();
      } catch (err) {
        console.warn(`[MongoDB] Connection to ${this.uri} failed or timed out. Operating in high-performance in-memory database mode.`);
        this.isConnected = false;
      }
    } else {
      console.log('[MongoDB] Running in high-performance in-memory database mode.');
      this.isConnected = false;
    }

    await this.seedDefaultStoreDataIfEmpty();
  }

  // Indexes for the hot lookups (bulk-import duplicate check, per-variant stock
  // counts, id/username/apiKey/orderCode lookups). createIndex is a no-op when
  // the index already exists, so this is cheap on every start.
  private async ensureIndexes(): Promise<void> {
    if (!this.database) return;
    try {
      const inv = this.database.collection('inventory');
      await inv.createIndex({ usernameKey: 1 });
      await inv.createIndex({ variantId: 1, isSold: 1 });

      // Every collection is looked up by a business key (id, username, apiKey,
      // orderCode...), not by Mongo's own _id — with no index each of those is a
      // full scan. Checkout claims N inventory rows by id in one bulk write, so
      // without inventory.id that was N scans of the whole collection (buying
      // 5,000 accounts out of 50,000 took ~5s; quadratic in the quantity).
      // Non-unique on purpose: an old duplicate must never block startup.
      const wanted: Record<string, Record<string, 1 | -1>[]> = {
        inventory: [{ id: 1 }, { productId: 1, isSold: 1 }, { uploadedByUserId: 1, isSold: 1 }],
        users: [{ id: 1 }, { username: 1 }, { email: 1 }, { apiKey: 1 }],
        orders: [{ id: 1 }, { orderCode: 1 }, { userId: 1, createdAt: -1 }, { productId: 1 }],
        products: [{ id: 1 }],
        deposits: [{ userId: 1, network: 1 }],
        withdrawals: [{ userId: 1 }, { id: 1 }],
        preorders: [{ id: 1 }, { userId: 1 }, { variantId: 1, status: 1 }],
        reviews: [{ productId: 1 }, { userId: 1, productId: 1 }],
        vouchers: [{ code: 1 }],
      };
      for (const [collectionName, specs] of Object.entries(wanted)) {
        for (const spec of specs) {
          await this.database.collection(collectionName).createIndex(spec).catch((e: any) => {
            console.warn(`[MongoDB] Could not create index ${JSON.stringify(spec)} on ${collectionName}:`, e?.message);
          });
        }
      }
    } catch (err) {
      console.warn('[MongoDB] Could not ensure indexes:', err);
    }
  }

  private async seedDefaultStoreDataIfEmpty(): Promise<void> {
    const userCol = this.collection<any>('users');
    const userCount = await userCol.countDocuments({});
    if (userCount === 0) {
      // A brand-new database needs one admin to get in with. Its password is
      // generated fresh here and printed ONCE to the server log — never a fixed
      // value baked into the source (anyone who can read the code could
      // otherwise log in as admin on every fresh install). No demo/CTV accounts
      // with made-up balances are created. Change the password after first login.
      const initialPassword = crypto.randomBytes(12).toString('base64url');
      console.log('[MongoDB] Seeding initial admin account...');
      console.log('==================================================================');
      console.log(` INITIAL ADMIN LOGIN  username: admin   password: ${initialPassword}`);
      console.log(' Shown only once — sign in and change it right away.');
      console.log('==================================================================');
      await userCol.insertMany([
        {
          id: 'user_admin',
          username: 'admin',
          email: 'admin@xcheap.top',
          role: 'admin',
          balance: 0,
          discountPercent: 0,
          // Real deposit addresses are generated on first use (see
          // ensureUserDepositWallets) — nothing hardcoded here.
          depositWallets: {},
          passwordHash: bcrypt.hashSync(initialPassword, 10),
          apiKey: 'xck_admin_seed_' + generateObjectId(),
          createdAt: new Date().toISOString(),
        },
      ]);
    }

    const catCol = this.collection<any>('categories');
    const catCount = await catCol.countDocuments({});
    if (catCount === 0) {
      console.log('[MongoDB] Seeding default categories...');
      await catCol.insertMany([
        { id: 'cat_twitter', name: 'Twitter / X', slug: 'twitter', icon: 'twitter', description: 'Tài khoản Twitter/X cổ, tick xanh, tài khoản quảng cáo và tương tác cao.' },
        { id: 'cat_facebook', name: 'Facebook', slug: 'facebook', icon: 'facebook', description: 'Via Facebook, Clone, BM Agency và tài khoản quảng cáo Facebook.' },
        { id: 'cat_gmail', name: 'Gmail / Google', slug: 'gmail', icon: 'gmail', description: 'Gmail cổ tạo lâu năm, Gmail mới ngâm, Google Voice phục vụ MMO.' },
        { id: 'cat_instagram', name: 'Instagram', slug: 'instagram', icon: 'instagram', description: 'Tài khoản Instagram tương tác cao, follow thật, đăng ký lâu năm.' },
        { id: 'cat_discord', name: 'Discord', slug: 'discord', icon: 'discord', description: 'Tài khoản Discord verify Phone/Mail, token bot, Nitro giá rẻ.' },
        { id: 'cat_telegram', name: 'Telegram', slug: 'telegram', icon: 'telegram', description: 'Tài khoản Telegram Session/Tdata, Telegram Premium chính chủ.' },
        { id: 'cat_tiktok', name: 'TikTok', slug: 'tiktok', icon: 'tiktok', description: 'TikTok Shop, TikTok Beta kiếm tiền, follow cao và live stream.' },
        { id: 'cat_tool', name: 'Công Cụ & AI', slug: 'tool', icon: 'tool', description: 'Tài khoản Kling AI, Midjourney, ChatGPT Plus và tool MMO tự động.' },
      ]);
    }

    const prodCol = this.collection<any>('products');
    const prodCount = await prodCol.countDocuments({});
    if (prodCount === 0) {
      console.log('[MongoDB] Seeding default products with real stock...');
      await prodCol.insertMany([
        {
          id: 'prod_twitter_aged',
          name: 'Twitter / X Cổ (2015-2022) | Đã Kháng Tụt Follow | Full Cookie & 2FA',
          category: 'Twitter / X',
          categorySlug: 'twitter',
          badge: '-30%',
          image: '/src/assets/images/storefront_twitter_1789374041650.jpg',
          rating: 4.9,
          reviewCount: 48,
          seller: { name: 'XCheap Official', statusText: 'Online 24/7', isActive: true },
          createdByUserId: 'user_admin',
          isHot: true,
          isFeatured: true,
          inStock: true,
          price: 1.25,
          originalPrice: 1.80,
          accountFormat: 'Username|Password|2FA_Secret|Email|MailPassword',
          descriptionHtml: '<p>Tài khoản Twitter/X ngâm cực kỹ, đăng ký từ năm 2015 - 2022 trên dải IP sạch. Đã bật sẵn 2FA và có đầy đủ token/cookie hỗ trợ đăng nhập tức thì không checkpoint.</p>',
          variants: [
            { id: 'var_tw_2018', name: 'X Cổ 2018-2020 | 50-200 Follower | Đã Ngâm Kỹ', price: 1.25, originalPrice: 1.80, discountBadge: '-30%' },
            { id: 'var_tw_2015', name: 'X Cổ 2015-2017 | > 500 Follower | Trâu Cho Crypto', price: 2.50, originalPrice: 3.50, discountBadge: '-28%' },
            { id: 'var_tw_blue', name: 'X Tick Xanh Cá Nhân (Premium Active 30 Ngày)', price: 8.90, originalPrice: 11.50, discountBadge: '-22%' },
          ],
        },
        {
          id: 'prod_facebook_via',
          name: 'Via Facebook Ngoại Cổ (US/EU/PH) | Kháng SPAM | Bao Back 7 Ngày',
          category: 'Facebook',
          categorySlug: 'facebook',
          badge: '-32%',
          image: '/src/assets/images/storefront_facebook_1789374061137.jpg',
          rating: 4.8,
          reviewCount: 36,
          seller: { name: 'XCheap Official', statusText: 'Online 24/7', isActive: true },
          createdByUserId: 'user_admin',
          isHot: true,
          isFeatured: true,
          inStock: true,
          price: 0.95,
          originalPrice: 1.40,
          accountFormat: 'UID|Password|2FA_Secret|Email|MailPassword',
          descriptionHtml: '<p>Via Facebook ngoại tương tác thực, có bạn bè thật và hoạt động thường xuyên. Thích hợp chạy quảng cáo Ads, seeding group hoặc nuôi tài khoản agency.</p>',
          variants: [
            { id: 'var_fb_us', name: 'Via US Cổ 2017-2021 | 100-500 Bạn Bè | 2FA Live', price: 0.95, originalPrice: 1.40, discountBadge: '-32%' },
            { id: 'var_fb_bm', name: 'Tài Khoản BM50 Cổ | Tạo Được Pixel Ads Kháng Limit', price: 3.20, originalPrice: 4.50, discountBadge: '-28%' },
          ],
        },
        {
          id: 'prod_gmail_aged',
          name: 'Gmail Cổ 2019-2023 | Đã Xác Minh SĐT | Kèm Mail Khôi Phục | Sạch 100%',
          category: 'Gmail / Google',
          categorySlug: 'gmail',
          badge: '-35%',
          image: '/src/assets/images/storefront_gmail_1789374076403.jpg',
          rating: 5.0,
          reviewCount: 82,
          seller: { name: 'XCheap Official', statusText: 'Online 24/7', isActive: true },
          createdByUserId: 'user_admin',
          isHot: true,
          isFeatured: true,
          inStock: true,
          price: 0.45,
          originalPrice: 0.70,
          accountFormat: 'Email|Password|RecoveryEmail',
          descriptionHtml: '<p>Hộp thư Gmail cá nhân ngâm sâu, bao sống mọi IP. Có sẵn email khôi phục không lo bị quét hay verify lại số điện thoại.</p>',
          variants: [
            { id: 'var_gm_2022', name: 'Gmail Ngâm 2022-2023 | Kèm Mail Khôi Phục', price: 0.45, originalPrice: 0.70, discountBadge: '-35%' },
            { id: 'var_gm_voice', name: 'Gmail Kèm Số Google Voice US Active | Nhận SMS MMO', price: 2.10, originalPrice: 2.90, discountBadge: '-27%' },
          ],
        },
        {
          id: 'prod_discord_token',
          name: 'Tài Khoản Discord Cổ 2019-2022 | Verify Phone + Email | Kèm Token',
          category: 'Discord',
          categorySlug: 'discord',
          badge: '-27%',
          image: '/src/assets/images/storefront_discord_1789374156955.jpg',
          rating: 4.9,
          reviewCount: 29,
          seller: { name: 'XCheap Official', statusText: 'Online 24/7', isActive: true },
          createdByUserId: 'user_admin',
          isHot: false,
          isFeatured: true,
          inStock: true,
          price: 0.65,
          originalPrice: 0.90,
          accountFormat: 'Email|Password|Token',
          descriptionHtml: '<p>Tài khoản Discord đã verify số điện thoại thực và email. Đầy đủ token để chạy tool bot hoặc tạo server MMO chất lượng cao.</p>',
          variants: [
            { id: 'var_dc_token', name: 'Discord Token Full Verify Phone/Mail (Đã Ngâm)', price: 0.65, originalPrice: 0.90, discountBadge: '-27%' },
            { id: 'var_dc_aged', name: 'Discord Account Cổ 2019 | Tạo Server Thoải Mái', price: 1.80, originalPrice: 2.50, discountBadge: '-28%' },
          ],
        },
        {
          id: 'prod_telegram_session',
          name: 'Telegram Tdata / Session Ngoại (US/UK/RU) | Tương Thích Telethon & Pyrogram',
          category: 'Telegram',
          categorySlug: 'telegram',
          badge: '-37%',
          image: '/src/assets/images/storefront_telegram_1789374112699.jpg',
          rating: 4.8,
          reviewCount: 41,
          seller: { name: 'XCheap Official', statusText: 'Online 24/7', isActive: true },
          createdByUserId: 'user_admin',
          isHot: true,
          isFeatured: true,
          inStock: true,
          price: 0.50,
          originalPrice: 0.80,
          accountFormat: 'Phone|SessionString|2FA',
          descriptionHtml: '<p>Tài khoản Telegram dạng file Session hoặc thư mục Tdata mở là chạy trên Telegram Desktop. Chống quét và tương thích hoàn hảo với các script tự động.</p>',
          variants: [
            { id: 'var_tg_session', name: 'Telegram Session Ngoại (Ngâm > 30 ngày) | Kèm 2FA', price: 0.50, originalPrice: 0.80, discountBadge: '-37%' },
            { id: 'var_tg_tdata', name: 'Telegram Tdata Thư Mục Giải Nén Dùng Ngay Trên PC', price: 0.70, originalPrice: 1.00, discountBadge: '-30%' },
          ],
        },
        {
          id: 'prod_kling_ai',
          name: 'Tài Khoản Kling AI / Midjourney / ChatGPT Plus Chính Hãng 30 Ngày',
          category: 'Công Cụ & AI',
          categorySlug: 'tool',
          badge: '-25%',
          image: '/src/assets/images/storefront_kling_1789374089827.jpg',
          rating: 5.0,
          reviewCount: 55,
          seller: { name: 'XCheap Official', statusText: 'Online 24/7', isActive: true },
          createdByUserId: 'user_admin',
          isHot: true,
          isFeatured: true,
          inStock: true,
          price: 4.50,
          originalPrice: 6.00,
          accountFormat: 'Email|Password|AuthDetails',
          descriptionHtml: '<p>Tài khoản AI tạo video điện ảnh thế hệ mới Kling AI và ChatGPT Plus siêu ổn định, bảo hành 1 đổi 1 trọn thời gian sử dụng.</p>',
          variants: [
            { id: 'var_kling_credits', name: 'Kling AI 660 Credits Tạo Video Chuyển Động Điện Ảnh', price: 4.50, originalPrice: 6.00, discountBadge: '-25%' },
            { id: 'var_gpt_plus', name: 'ChatGPT Plus (Dùng Chung Siêu Ổn Định) 30 Ngày', price: 3.90, originalPrice: 5.50, discountBadge: '-29%' },
          ],
        },
      ]);

      // Seed matching inventory accounts so customers can purchase immediately
      const invCol = this.collection<any>('inventory');
      const seedInventory: any[] = [];
      const stockTemplates: Record<string, string[]> = {
        var_tw_2018: [
          'alpha_mmo_tw1|PassWord2026@|4N5B6V7C8X9Z1Q2W|recovery_tw1@hotmail.com|HotmailPass123',
          'alpha_mmo_tw2|PassWord2026@|9A8B7C6D5E4F3G2H|recovery_tw2@hotmail.com|HotmailPass123',
          'alpha_mmo_tw3|PassWord2026@|1K2J3H4G5F6D7S8A|recovery_tw3@hotmail.com|HotmailPass123',
        ],
        var_tw_2015: [
          'crypto_whale15|XPass2015!|A1B2C3D4E5F6G7H8|crypto_old15@gmail.com|GPass12345',
          'crypto_whale16|XPass2015!|Z9Y8X7W6V5U4T3S2|crypto_old16@gmail.com|GPass12345',
        ],
        var_tw_blue: [
          'verified_pro_x|VerifiedSecret2026|BLUE2FA7788990011|verified_pro@outlook.com|BluePass2026',
        ],
        var_fb_us: [
          '100084729104812|FbPass2026#|JBSWY3DPEHPK3PXP|fb_us_mmo1@yahoo.com|YPass2026',
          '100084729104813|FbPass2026#|KBSWY3DPEHPK3PXQ|fb_us_mmo2@yahoo.com|YPass2026',
          '100084729104814|FbPass2026#|LBSWY3DPEHPK3PXR|fb_us_mmo3@yahoo.com|YPass2026',
        ],
        var_fb_bm: [
          'bm_agency_2024_01|BMSecretKey@2026|BM2FA9988776655|bm_admin@agency.com|AgencyPass1',
        ],
        var_gm_2022: [
          'mmo_master_vn22@gmail.com|GooglePass2026@|rec_mmo22@mail.ru',
          'mmo_master_vn23@gmail.com|GooglePass2026@|rec_mmo23@mail.ru',
          'mmo_master_vn24@gmail.com|GooglePass2026@|rec_mmo24@mail.ru',
          'mmo_master_vn25@gmail.com|GooglePass2026@|rec_mmo25@mail.ru',
        ],
        var_gm_voice: [
          'gvoice_us_919@gmail.com|GVPass2026!|gvoice_rec1@outlook.com|+19195550192',
          'gvoice_us_415@gmail.com|GVPass2026!|gvoice_rec2@outlook.com|+14155550144',
        ],
        var_dc_token: [
          'discord_pro_1@hotmail.com|DiscordPass2026|MTI5ODc2NTQzMjEwOTg3NjU0Mw.G-AbCd.1234567890abcdefghijklmnopqrstuv',
          'discord_pro_2@hotmail.com|DiscordPass2026|MTI5ODc2NTQzMjEwOTg3NjU0NA.G-EfGh.0987654321zyxwvutsrqponmlkjihgfedc',
        ],
        var_dc_aged: [
          'dc_server_owner2019@outlook.com|DiscordAged2019!|MTI5ODc2NTQzMjEwOTg3NjU0NQ.G-Aged.agedtoken2019ownerdiscordkey',
        ],
        var_tg_session: [
          '+12025550188|1BQAAAAA=session_telethon_key_data_sample_01|2FaTele2026@',
          '+12025550189|1BQAAAAA=session_telethon_key_data_sample_02|2FaTele2026@',
        ],
        var_tg_tdata: [
          '+447700900122|tdata_archive_link_d9f8e7|2FaTele2026@',
        ],
        var_kling_credits: [
          'kling_ai_vip660@gmail.com|KlingSecret2026@|660_Credits_Active_US_Region',
          'kling_ai_vip661@gmail.com|KlingSecret2026@|660_Credits_Active_US_Region',
        ],
        var_gpt_plus: [
          'chatgpt_plus_share1@openai-team.com|GptPlusPass2026@|ProTeam30Days',
        ],
      };

      for (const [varId, lines] of Object.entries(stockTemplates)) {
        let prodId = 'prod_twitter_aged';
        if (varId.startsWith('var_fb')) prodId = 'prod_facebook_via';
        else if (varId.startsWith('var_gm')) prodId = 'prod_gmail_aged';
        else if (varId.startsWith('var_dc')) prodId = 'prod_discord_token';
        else if (varId.startsWith('var_tg')) prodId = 'prod_telegram_session';
        else if (varId.startsWith('var_kling') || varId.startsWith('var_gpt')) prodId = 'prod_kling_ai';

        lines.forEach((line, idx) => {
          seedInventory.push({
            id: `stk_seed_${varId}_${idx}`,
            productId: prodId,
            variantId: varId,
            accountData: line,
            usernameKey: inventoryUsernameKey(line),
            isSold: false,
            createdAt: new Date().toISOString(),
          });
        });
      }

      await invCol.insertMany(seedInventory);
    }
  }

  public async getStats(): Promise<{
    status: string;
    uri: string;
    engine: string;
    collections: Record<string, number>;
  }> {
    const stats: Record<string, number> = {};
    for (const name of STANDARD_COLLECTIONS) {
      const col = this.collection(name);
      stats[name] = await col.countDocuments();
    }
    return {
      status: this.isConnected ? 'connected' : 'in-memory (active)',
      uri: this.isConnected ? this.uri : 'in-memory://xcheap-memory-db',
      engine: this.isConnected ? 'MongoDB Atlas/Local' : 'AI Studio In-Memory MongoDB Engine',
      collections: stats,
    };
  }
}

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || 'xscr_store_db';

export const db = new MongoDBEngine(MONGODB_URI, MONGODB_DB_NAME);
