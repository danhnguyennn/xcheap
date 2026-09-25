import { ethers } from 'ethers';
import type { CryptoOption } from '../src/types';

// Looks up the REAL on-chain transactions behind a deposit. A wallet's token
// balance only says how much arrived, not which transaction brought it — the
// transaction hash has to come from the token contract's Transfer events.
// Nothing here is ever invented: if a lookup can't be answered (RPC down, range
// not supported, no matching event) the caller gets an "unknown" result and
// stores no hash rather than a made-up one.

const TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');

// Public RPCs cap how many blocks one eth_getLogs may span (Base ~2000,
// Polygon ~10000, BSC ~5000). 2000 is accepted everywhere tried.
const LOG_CHUNK_BLOCKS = 2000;
const RPC_CALL_TIMEOUT_MS = 6000;
// Public RPCs intermittently refuse a call (rate limits, brief overload). Every
// lookup call goes through all endpoints, and the whole round is retried a
// couple of times with growing pauses before it counts as failed.
export const RETRY_DELAYS_MS = [0, 500, 1500];
// For the interactive deposit check, which must stay responsive.
export const QUICK_RETRY_DELAYS_MS = [0];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Extra endpoints tried when the configured RPC can't serve the query. The
// default BSC endpoint (bsc-dataseed.binance.org) rejects eth_getLogs
// outright ("limit exceeded"), so it needs a log-capable one alongside it.
const FALLBACK_RPC_URLS: Record<string, string[]> = {
  bsc: ['https://bsc-rpc.publicnode.com', 'https://bsc.rpc.blxrbdn.com'],
  polygon: ['https://polygon-bor-rpc.publicnode.com'],
  base: [],
};

export interface IncomingTransfer {
  txHash: string;
  blockNumber: number;
  logIndex: number;
  amount: number;
}

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), RPC_CALL_TIMEOUT_MS)),
  ]);
}

function providersFor(cfg: CryptoOption, preferLogCapable: boolean): ethers.JsonRpcProvider[] {
  const urls = [cfg.rpcUrl, ...(FALLBACK_RPC_URLS[cfg.id] || [])].filter((u, i, a) => u && a.indexOf(u) === i);
  // For log queries the fallbacks go first: the configured node may not
  // support eth_getLogs at all (BSC), and trying it first just burns a call.
  const ordered = preferLogCapable ? [...urls.slice(1), urls[0]] : urls;
  return ordered.map((url) => new ethers.JsonRpcProvider(url, cfg.chainId, { staticNetwork: true }));
}

export async function getChainHead(cfg: CryptoOption, retryDelays: number[] = RETRY_DELAYS_MS): Promise<number | null> {
  const providers = providersFor(cfg, false);
  for (const delay of retryDelays) {
    if (delay > 0) await sleep(delay);
    for (const provider of providers) {
      try {
        return await withTimeout(provider.getBlockNumber(), 'getBlockNumber');
      } catch {
        // try the next endpoint
      }
    }
  }
  return null;
}

async function getLogsAnyProvider(
  providers: ethers.JsonRpcProvider[],
  cfg: CryptoOption,
  address: string,
  fromBlock: number,
  toBlock: number,
  retryDelays: number[]
): Promise<ethers.Log[] | null> {
  for (const delay of retryDelays) {
    if (delay > 0) await sleep(delay);
    for (const provider of providers) {
      try {
        return await withTimeout(
          provider.getLogs({
            address: cfg.contractAddress,
            topics: [TRANSFER_TOPIC, null, ethers.zeroPadValue(address, 32)],
            fromBlock,
            toBlock,
          }),
          'getLogs'
        );
      } catch {
        // this endpoint can't serve the range right now — try the next one
      }
    }
  }
  return null;
}

// Scans backwards from toBlock (newest first) for Transfer events whose
// recipient is `address`. Stops as soon as `stopWhen` says the collected
// transfers are enough, at fromBlock, after maxChunks, or at the deadline.
// `complete` is false when a chunk couldn't be read — the result is then a
// partial view and must not be trusted to be the whole story.
export async function scanIncomingTransfers(
  cfg: CryptoOption,
  address: string,
  opts: {
    fromBlock: number;
    toBlock: number;
    maxChunks?: number;
    deadlineMs?: number;
    retryDelays?: number[];
    stopWhen?: (found: IncomingTransfer[]) => boolean;
  }
): Promise<{ transfers: IncomingTransfer[]; complete: boolean }> {
  const providers = providersFor(cfg, true);
  const maxChunks = opts.maxChunks ?? 30;
  const deadline = Date.now() + (opts.deadlineMs ?? 12000);
  const found: IncomingTransfer[] = [];
  let complete = true;

  let chunkTo = opts.toBlock;
  for (let i = 0; i < maxChunks && chunkTo >= opts.fromBlock; i++) {
    if (Date.now() > deadline) {
      complete = false;
      break;
    }
    const chunkFrom = Math.max(opts.fromBlock, chunkTo - LOG_CHUNK_BLOCKS + 1);
    const logs = await getLogsAnyProvider(providers, cfg, address, chunkFrom, chunkTo, opts.retryDelays ?? RETRY_DELAYS_MS);
    if (logs === null) {
      complete = false;
      break;
    }
    // Newest first inside the chunk too.
    logs.sort((a, b) => b.blockNumber - a.blockNumber || b.index - a.index);
    for (const log of logs) {
      found.push({
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
        logIndex: log.index,
        amount: Number(ethers.formatUnits(BigInt(log.data), cfg.decimals)),
      });
    }
    if (opts.stopWhen && opts.stopWhen(found)) return { transfers: found, complete: true };
    chunkTo = chunkFrom - 1;
  }
  if (chunkTo >= opts.fromBlock && complete) complete = false; // stopped on maxChunks before reaching fromBlock
  return { transfers: found, complete };
}

// Is this hash a real transaction on this chain? 'unknown' means no endpoint
// could answer (never treated as "fake").
export async function transactionExists(cfg: CryptoOption, txHash: string): Promise<'yes' | 'no' | 'unknown'> {
  // A real transaction hash is exactly 32 bytes of hex. Anything else (older
  // code produced short ~13-character strings) can't be a transaction, and the
  // RPC just errors on it instead of answering "not found" — so decide here.
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return 'no';
  const providers = providersFor(cfg, false);
  let answered = false;
  for (const delay of RETRY_DELAYS_MS) {
    if (delay > 0) await sleep(delay);
    for (const provider of providers) {
      try {
        const tx = await withTimeout(provider.getTransaction(txHash), 'getTransaction');
        if (tx) return 'yes';
        answered = true; // a clean "not found" from this endpoint
      } catch {
        // endpoint failed — try the next
      }
    }
    if (answered) break;
  }
  return answered ? 'no' : 'unknown';
}

// Highest block whose timestamp is <= the given unix time (binary search).
export async function blockAtOrBefore(cfg: CryptoOption, unixSeconds: number): Promise<number | null> {
  const providers = providersFor(cfg, false);
  const head = await getChainHead(cfg);
  if (head === null) return null;
  const blockTime = async (n: number): Promise<number | null> => {
    for (const delay of RETRY_DELAYS_MS) {
      if (delay > 0) await sleep(delay);
      for (const provider of providers) {
        try {
          const block = await withTimeout(provider.getBlock(n), 'getBlock');
          if (block) return block.timestamp;
        } catch {
          // next endpoint
        }
      }
    }
    return null;
  };
  let lo = 1;
  let hi = head;
  const headTime = await blockTime(head);
  if (headTime === null) return null;
  if (unixSeconds >= headTime) return head;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    const t = await blockTime(mid);
    if (t === null) return null;
    if (t <= unixSeconds) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
