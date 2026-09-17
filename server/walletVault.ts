import { ethers } from 'ethers';
import { db } from './mongodb';
import { User, CryptoNetwork } from '../src/types';

// Internal record only — address is the sole field ever returned to a
// caller. privateKey/mnemonic never leave this module, are never put on an
// HTTP response, and are only ever read here for a future signing/sweep
// operation you run yourself, server-side.
interface WalletRecord {
  id: string;
  userId: string;
  evmAddress: string;
  evmPrivateKey: string;
  evmMnemonic: string;
  tronAddress: string;
  createdAt?: string;
}

const NETWORKS: CryptoNetwork[] = ['bsc', 'polygon', 'trc', 'base'];

function toPublicAddresses(record: WalletRecord): Record<CryptoNetwork, string> {
  return {
    bsc: record.evmAddress,
    polygon: record.evmAddress,
    base: record.evmAddress,
    trc: record.tronAddress,
  };
}

// Generates a real, randomly-keyed wallet the first time it's needed for a
// user and persists it in the `wallets` collection; every call after that
// just looks the existing one up. Only ever returns public addresses.
export async function getOrCreateUserWallet(userId: string): Promise<Record<CryptoNetwork, string>> {
  const vault = db.collection<WalletRecord>('wallets');
  const existing = await vault.findOne({ userId });
  if (existing) return toPublicAddresses(existing);

  const evmWallet = ethers.Wallet.createRandom();
  // TRON isn't an EVM chain so it can't reuse the wallet above; this is a
  // display-only placeholder address (this project never signs real TRON
  // transactions), generated from real randomness rather than a public salt.
  const tronAddress = 'T' + ethers.hexlify(ethers.randomBytes(17)).slice(2);

  const record: WalletRecord = {
    id: userId,
    userId,
    evmAddress: evmWallet.address,
    evmPrivateKey: evmWallet.privateKey,
    evmMnemonic: evmWallet.mnemonic?.phrase || '',
    tronAddress,
  };
  await vault.insertOne(record);
  return toPublicAddresses(record);
}

// Makes sure a user's cached `depositWallets` (on the users collection —
// safe, address-only) match the vault's record, creating one if needed and
// migrating anyone still on an older, insecurely-derived address.
export async function ensureUserDepositWallets(user: User): Promise<Record<CryptoNetwork, string>> {
  const wallets = await getOrCreateUserWallet(user.id);
  const isUpToDate = user.depositWallets && NETWORKS.every((n) => user.depositWallets[n] === wallets[n]);
  if (!isUpToDate) {
    const userCol = db.collection<User>('users');
    await userCol.updateOne({ id: user.id }, { $set: { depositWallets: wallets } });
  }
  return wallets;
}
