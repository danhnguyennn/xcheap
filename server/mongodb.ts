import fs from 'fs';
import path from 'path';
import { MongoClient, Db, Collection, Filter, Document } from 'mongodb';

// Define MongoDB Document interface
export interface MongoDoc {
  _id?: any;
  id?: string;
  [key: string]: any;
}

// Generate a MongoDB ObjectId-like 24-character hex id (used for legacy JSON
// documents that were seeded before a real `_id` existed).
export function generateObjectId(): string {
  const timestamp = Math.floor(Date.now() / 1000).toString(16).padStart(8, '0');
  const random = Array.from({ length: 16 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('');
  return timestamp + random;
}

const STANDARD_COLLECTIONS = ['products', 'categories', 'users', 'orders', 'inventory', 'withdrawals', 'config', 'deposits', 'wallets', 'vouchers', 'reviews'];

export class MongoCollection<T extends MongoDoc> {
  public name: string;
  private col: Collection<Document>;

  constructor(collection: Collection<Document>, name: string) {
    this.col = collection;
    this.name = name;
  }

  // MongoDB: find()
  public async find(
    query: Record<string, any> = {},
    options?: { sort?: Record<string, 1 | -1>; limit?: number; skip?: number }
  ): Promise<T[]> {
    let cursor = this.col.find(query as Filter<Document>);
    if (options?.sort) cursor = cursor.sort(options.sort);
    if (options?.skip) cursor = cursor.skip(options.skip);
    if (options?.limit) cursor = cursor.limit(options.limit);
    return (await cursor.toArray()) as unknown as T[];
  }

  // MongoDB: findOne()
  public async findOne(query: Record<string, any>): Promise<T | null> {
    const doc = await this.col.findOne(query as Filter<Document>);
    return (doc as unknown as T) ?? null;
  }

  // MongoDB: insertOne()
  public async insertOne(doc: T): Promise<{ acknowledged: boolean; insertedId: string }> {
    const clone: any = { ...doc };
    if (!clone.id) clone.id = generateObjectId();
    if (!clone.createdAt) clone.createdAt = new Date().toISOString();
    const result = await this.col.insertOne(clone);
    return { acknowledged: result.acknowledged, insertedId: clone.id };
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
    const result = await this.col.insertMany(newDocs);
    return { acknowledged: result.acknowledged, insertedCount: result.insertedCount };
  }

  // MongoDB: updateOne()
  public async updateOne(
    query: Record<string, any>,
    update: { $set?: Partial<T>; $inc?: Record<string, number> }
  ): Promise<{ matchedCount: number; modifiedCount: number }> {
    const mongoUpdate: Record<string, any> = {};
    if (update.$set) mongoUpdate.$set = { ...update.$set, updatedAt: new Date().toISOString() };
    if (update.$inc) mongoUpdate.$inc = update.$inc;
    const result = await this.col.updateOne(query as Filter<Document>, mongoUpdate);
    return { matchedCount: result.matchedCount, modifiedCount: result.modifiedCount };
  }

  // MongoDB: deleteOne()
  public async deleteOne(query: Record<string, any>): Promise<{ acknowledged: boolean; deletedCount: number }> {
    const result = await this.col.deleteOne(query as Filter<Document>);
    return { acknowledged: result.acknowledged, deletedCount: result.deletedCount };
  }

  // MongoDB: deleteMany()
  public async deleteMany(query: Record<string, any>): Promise<{ acknowledged: boolean; deletedCount: number }> {
    const result = await this.col.deleteMany(query as Filter<Document>);
    return { acknowledged: result.acknowledged, deletedCount: result.deletedCount };
  }

  // MongoDB: countDocuments()
  public async countDocuments(query: Record<string, any> = {}): Promise<number> {
    return this.col.countDocuments(query as Filter<Document>);
  }
}

// Database Manager — connects to a real MongoDB server (local service or Atlas).
export class MongoDBEngine {
  public uri: string;
  private dbName: string;
  private client: MongoClient;
  private database!: Db;
  private collections: Map<string, MongoCollection<any>> = new Map();
  private legacyJsonDir: string;
  public isConnected: boolean = false;

  constructor(uri: string, dbName: string, legacyJsonDir: string) {
    this.uri = uri;
    this.dbName = dbName;
    this.legacyJsonDir = legacyJsonDir;
    this.client = new MongoClient(uri);
  }

  public collection<T extends MongoDoc>(name: string): MongoCollection<T> {
    if (!this.collections.has(name)) {
      const col = new MongoCollection<T>(this.database.collection(name), name);
      this.collections.set(name, col);
    }
    return this.collections.get(name)!;
  }

  public async init(): Promise<void> {
    console.log(`[MongoDB] Connecting to ${this.uri}...`);
    await this.client.connect();
    this.database = this.client.db(this.dbName);
    this.isConnected = true;
    console.log(`[MongoDB] Connected successfully to database "${this.dbName}".`);

    await this.migrateLegacyJsonIfPresent();
  }

  // One-time import of the old JSON-file snapshots (from before this project
  // used a real MongoDB connection) so local test data isn't lost. Only runs
  // per collection when that collection is still empty in MongoDB.
  private async migrateLegacyJsonIfPresent(): Promise<void> {
    if (!fs.existsSync(this.legacyJsonDir)) return;

    for (const name of STANDARD_COLLECTIONS) {
      const filePath = path.join(this.legacyJsonDir, `${name}.json`);
      if (!fs.existsSync(filePath)) continue;

      const existingCount = await this.database.collection(name).countDocuments();
      if (existingCount > 0) continue;

      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const docs = JSON.parse(raw);
        if (Array.isArray(docs) && docs.length > 0) {
          await this.database.collection(name).insertMany(docs);
          console.log(`[MongoDB] Migrated ${docs.length} legacy document(s) into "${name}" from data/mongodb/${name}.json`);
        }
      } catch (err) {
        console.error(`[MongoDB] Failed to migrate legacy collection "${name}":`, err);
      }
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
      stats[name] = await this.database.collection(name).countDocuments();
    }
    return {
      status: this.isConnected ? 'connected' : 'disconnected',
      uri: this.uri,
      engine: 'MongoDB',
      collections: stats,
    };
  }
}

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || 'xscr_store_db';
const LEGACY_JSON_DIR = path.join(process.cwd(), 'data', 'mongodb');

export const db = new MongoDBEngine(MONGODB_URI, MONGODB_DB_NAME, LEGACY_JSON_DIR);
