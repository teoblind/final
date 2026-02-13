/**
 * On-Chain Data Connector (Phase 5)
 *
 * Real-time Bitcoin on-chain monitoring via Mempool.space API (primary)
 * with Blockchain.info fallback.  Feeds mempool state, fee estimates,
 * block data, and network health into the Sangha MineOS dashboard and
 * hashprice engine.
 */

import { getCache, setCache } from '../cache/database.js';

const MEMPOOL_API = 'https://mempool.space/api';
const BLOCKCHAIN_INFO_API = 'https://blockchain.info';

const TTL = {                    // cache TTLs in minutes (setCache unit)
  MEMPOOL:        0.5,           // 30 s
  FEE_ESTIMATES:  0.5,           // 30 s
  RECENT_BLOCKS:  1,             // 60 s
  NETWORK_HEALTH: 5,             // 5 min
  FEE_HISTORY:    60,            // 1 hr
};

const FETCH_TIMEOUT_MS = 12_000;
const BLOCK_SUBSIDY    = 3.125;  // Post April-2024 halving

// -- HTTP helpers -----------------------------------------------------------

async function apiFetch(url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return res.json();
  } finally { clearTimeout(t); }
}

async function apiFetchText(url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return (await res.text()).trim();
  } finally { clearTimeout(t); }
}

// -- Cache-aware wrapper ----------------------------------------------------

async function cachedFetch(cacheKey, ttl, liveFn, mockFn) {
  const cached = getCache(cacheKey);
  if (cached && !cached.stale) {
    return { ...cached.data, cached: true, fetchedAt: cached.fetchedAt };
  }
  try {
    const data = await liveFn();
    data.isMock = false;
    data.fetchedAt = new Date().toISOString();
    setCache(cacheKey, data, ttl);
    return data;
  } catch (err) {
    console.error(`[ChainConnector] ${cacheKey} fetch failed:`, err.message);
    if (cached) return { ...cached.data, cached: true, stale: true, fetchedAt: cached.fetchedAt };
    const mock = mockFn();
    mock.isMock = true;
    mock.fetchedAt = new Date().toISOString();
    return mock;
  }
}

// -- Shared block formatter --------------------------------------------------

function formatBlock(blk) {
  const ex = blk.extras || {};
  return {
    height: blk.height, hash: blk.id,
    timestamp: blk.timestamp,
    dateISO: new Date(blk.timestamp * 1000).toISOString(),
    size: blk.size, weight: blk.weight, txCount: blk.tx_count,
    totalFeesBTC: ex.totalFees ? ex.totalFees / 1e8 : null,
    feeRangeMin: ex.feeRange?.[0] ?? null,
    feeRangeMax: ex.feeRange?.[ex.feeRange?.length - 1] ?? null,
    medianFee: ex.medianFee ?? null,
    pool: ex.pool ? { name: ex.pool.name, slug: ex.pool.slug ?? null } : null,
    reward: ex.reward ? ex.reward / 1e8 : BLOCK_SUBSIDY,
  };
}

// == 1. getMempool ==========================================================

export async function getMempool() {
  return cachedFetch('chain:mempool', TTL.MEMPOOL, async () => {
    const [stats, projected] = await Promise.all([
      apiFetch(`${MEMPOOL_API}/mempool`),
      apiFetch(`${MEMPOOL_API}/v1/fees/mempool-blocks`),
    ]);
    return {
      count: stats.count,
      sizeMB: Math.round((stats.vsize / 1e6) * 100) / 100,
      sizeBytes: stats.vsize,
      totalFeeBTC: stats.total_fee / 1e8,
      feeRateBuckets: (projected || []).map((b, i) => ({
        block: i + 1, medianFee: b.medianFee,
        minFee: b.feeRange?.[0] ?? b.medianFee,
        maxFee: b.feeRange?.[b.feeRange.length - 1] ?? b.medianFee,
        txCount: b.nTx,
        sizeMB: Math.round((b.blockVSize / 1e6) * 100) / 100,
      })),
      source: 'mempool.space',
    };
  }, mockMempool);
}

// == 2. getMempoolHistory ====================================================

export async function getMempoolHistory(hours = 24) {
  return cachedFetch(`chain:mempool-history:${hours}`, TTL.MEMPOOL, async () => {
    // No dedicated history endpoint; accumulate snapshots in local cache
    const current = await getMempool();
    const existing = getCache('chain:mempool-snapshots');
    const snaps = existing?.data?.snapshots ?? [];
    snaps.push({
      timestamp: new Date().toISOString(),
      count: current.count, sizeMB: current.sizeMB, totalFeeBTC: current.totalFeeBTC,
    });
    const cutoff = Date.now() - hours * 3_600_000;
    const trimmed = snaps.filter(s => new Date(s.timestamp).getTime() >= cutoff);
    setCache('chain:mempool-snapshots', { snapshots: trimmed }, 1440);
    return { hours, snapshots: trimmed, source: 'mempool.space (aggregated)' };
  }, () => mockMempoolHistory(hours));
}

// == 3. getLatestBlocks ======================================================

export async function getLatestBlocks(count = 10) {
  return cachedFetch(`chain:latest-blocks:${count}`, TTL.RECENT_BLOCKS, async () => {
    const blocks = await apiFetch(`${MEMPOOL_API}/blocks`);
    const formatted = blocks.slice(0, count).map(formatBlock);
    return { count: formatted.length, blocks: formatted, source: 'mempool.space' };
  }, () => mockLatestBlocks(count));
}

// == 4. getBlockByHeight =====================================================

export async function getBlockByHeight(height) {
  return cachedFetch(`chain:block:${height}`, 1440, async () => {
    const blockHash = await apiFetchText(`${MEMPOOL_API}/block-height/${height}`);
    const blk = await apiFetch(`${MEMPOOL_API}/block/${blockHash}`);
    const base = formatBlock(blk);
    return {
      ...base,
      difficulty: blk.difficulty, nonce: blk.nonce,
      merkleRoot: blk.merkle_root, previousBlockHash: blk.previousblockhash,
      source: 'mempool.space',
    };
  }, () => mockBlock(height));
}

// == 5. getFeeEstimates ======================================================

export async function getFeeEstimates() {
  return cachedFetch('chain:fee-estimates', TTL.FEE_ESTIMATES, async () => {
    const [rec, projected] = await Promise.all([
      apiFetch(`${MEMPOOL_API}/v1/fees/recommended`),
      apiFetch(`${MEMPOOL_API}/v1/fees/mempool-blocks`),
    ]);
    return {
      nextBlock: rec.fastestFee, thirtyMinutes: rec.halfHourFee,
      oneHour: rec.hourFee, day: rec.economyFee, minimum: rec.minimumFee,
      projectedBlocks: (projected || []).slice(0, 6).map((b, i) => ({
        block: i + 1, medianFee: b.medianFee, txCount: b.nTx,
      })),
      source: 'mempool.space',
    };
  }, mockFeeEstimates);
}

// == 6. getFeeHistory ========================================================

export async function getFeeHistory(days = 7) {
  return cachedFetch(`chain:fee-history:${days}`, TTL.FEE_HISTORY, async () => {
    // Derive fee history from recent blocks, grouped by calendar day
    const blocks = await apiFetch(`${MEMPOOL_API}/blocks`);
    const byDay = {};
    for (const blk of blocks) {
      const day = new Date(blk.timestamp * 1000).toISOString().split('T')[0];
      (byDay[day] ??= []).push({
        medianFee: blk.extras?.medianFee ?? 0,
        feesBTC: blk.extras?.totalFees ? blk.extras.totalFees / 1e8 : 0,
      });
    }
    const history = Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b)).slice(-days)
      .map(([date, entries]) => {
        const fees = entries.map(e => e.medianFee);
        const total = entries.reduce((s, e) => s + e.feesBTC, 0);
        return {
          date,
          avgMedianFee: Math.round(fees.reduce((a, b) => a + b, 0) / fees.length * 10) / 10,
          minFee: Math.min(...fees), maxFee: Math.max(...fees),
          blocksObserved: entries.length,
          totalFeesBTC: Math.round(total * 1e6) / 1e6,
        };
      });
    return { days, history, source: 'mempool.space (derived from blocks)' };
  }, () => mockFeeHistory(days));
}

// == 7. getNetworkHealth =====================================================

export async function getNetworkHealth() {
  return cachedFetch('chain:network-health', TTL.NETWORK_HEALTH, async () => {
    const [hr, diff, pools] = await Promise.all([
      apiFetch(`${MEMPOOL_API}/v1/mining/hashrate/3m`),
      apiFetch(`${MEMPOOL_API}/v1/difficulty-adjustment`),
      apiFetch(`${MEMPOOL_API}/v1/mining/pools/1w`),
    ]);

    const latest = hr.hashrates?.[hr.hashrates.length - 1];
    const curEH = latest ? latest.avgHashrate / 1e18 : hr.currentHashrate / 1e18;

    return {
      hashrate: {
        currentEH: Math.round(curEH * 100) / 100,
        series: (hr.hashrates || []).map(h => ({
          timestamp: h.timestamp,
          dateISO: new Date(h.timestamp * 1000).toISOString(),
          hashrateEH: Math.round((h.avgHashrate / 1e18) * 100) / 100,
        })),
      },
      difficulty: {
        current: diff.difficultyChange !== undefined ? diff.previousRetarget : hr.currentDifficulty,
        progressPercent: diff.progressPercent,
        remainingBlocks: diff.remainingBlocks,
        remainingTime: diff.remainingTime,
        estimatedChangePercent: Math.round((diff.difficultyChange ?? 0) * 100) / 100,
        nextRetargetHeight: diff.nextRetargetHeight,
        previousRetargetDate: diff.previousRetarget ? new Date(diff.previousRetarget * 1000).toISOString() : null,
        avgBlockTimeSec: diff.timeAvg ?? 600,
      },
      blockRate: {
        avgBlockTimeSec: diff.timeAvg ?? 600,
        blocksMinedLast24h: pools.blockCount ? Math.round(pools.blockCount / 7) : 144,
      },
      topPools: (pools.pools || []).slice(0, 10).map(p => ({
        name: p.name, slug: p.slug, blockCount: p.blockCount,
        sharePercent: Math.round((p.blockCount / (pools.blockCount || 1)) * 10000) / 100,
        emptyBlocks: p.emptyBlocks ?? 0,
      })),
      source: 'mempool.space',
    };
  }, mockNetworkHealth);
}

// == 8. getFeeRevenuePercent (feeds into hashprice engine) ===================

export async function getFeeRevenuePercent() {
  return cachedFetch('chain:fee-revenue-pct', TTL.RECENT_BLOCKS, async () => {
    const blocks = await apiFetch(`${MEMPOOL_API}/blocks`);
    let totalFees = 0;
    for (const blk of blocks) totalFees += blk.extras?.totalFees ? blk.extras.totalFees / 1e8 : 0;
    const n = blocks.length;
    const totalSubsidy = n * BLOCK_SUBSIDY;
    const totalReward = totalSubsidy + totalFees;
    const avg = n > 0 ? Math.round((totalFees / n) * 1e6) / 1e6 : 0;
    return {
      feePercent: totalReward > 0 ? Math.round((totalFees / totalReward) * 10000) / 100 : 0,
      avgFeesPerBlockBTC: avg,
      subsidyBTC: BLOCK_SUBSIDY,
      totalRewardBTC: BLOCK_SUBSIDY + avg,
      blocksAnalyzed: n,
      totalFeesBTC: Math.round(totalFees * 1e6) / 1e6,
      totalSubsidyBTC: Math.round(totalSubsidy * 1e6) / 1e6,
      source: 'mempool.space',
    };
  }, mockFeeRevenuePercent);
}

// -- Mock / fallback data generators ----------------------------------------

function mockMempool() {
  return {
    count: 84_732,
    sizeMB: 152.34,
    sizeBytes: 159_726_592,
    totalFeeBTC: 1.847,
    feeRateBuckets: [
      { block: 1, medianFee: 45, minFee: 38, maxFee: 112, txCount: 2800, sizeMB: 1.48 },
      { block: 2, medianFee: 28, minFee: 22, maxFee: 37,  txCount: 3100, sizeMB: 1.50 },
      { block: 3, medianFee: 18, minFee: 14, maxFee: 21,  txCount: 3400, sizeMB: 1.50 },
      { block: 4, medianFee: 12, minFee: 10, maxFee: 13,  txCount: 3600, sizeMB: 1.49 },
      { block: 5, medianFee: 8,  minFee: 6,  maxFee: 9,   txCount: 4200, sizeMB: 1.50 },
    ],
    source: 'mock',
  };
}

function mockMempoolHistory(hours) {
  const now = Date.now();
  const step = 600_000; // 10-min intervals
  const n = Math.min(Math.floor((hours * 3_600_000) / step), 144);
  const snapshots = Array.from({ length: n + 1 }, (_, j) => {
    const i = n - j;
    return {
      timestamp: new Date(now - i * step).toISOString(),
      count: Math.round(85_000 + Math.sin(i / 12) * 15_000 + (Math.random() - 0.5) * 8000),
      sizeMB: Math.round((150 + Math.sin(i / 8) * 40 + (Math.random() - 0.5) * 20) * 100) / 100,
      totalFeeBTC: Math.round((1.5 + Math.random() * 1.5) * 1000) / 1000,
    };
  });
  return { hours, snapshots, source: 'mock' };
}

const MOCK_POOLS = [
  'Foundry USA', 'AntPool', 'F2Pool', 'ViaBTC', 'Binance Pool',
  'Mara Pool', 'Luxor', 'SBI Crypto', 'Braiins Pool', 'Ocean',
];
const mockHash = h => `0000000000000000000${h.toString(16).padStart(16, '0')}`;
const mockPoolObj = name => ({ name, slug: name.toLowerCase().replace(/\s+/g, '-') });

function mockLatestBlocks(count) {
  const base = 879_120, now = Math.floor(Date.now() / 1000);
  const blocks = Array.from({ length: count }, (_, i) => {
    const h = base - i, ts = now - i * 580 - Math.floor(Math.random() * 120);
    const fees = Math.round((0.15 + Math.random() * 0.45) * 1e6) / 1e6;
    return {
      height: h, hash: mockHash(h), timestamp: ts,
      dateISO: new Date(ts * 1000).toISOString(),
      size: 1_400_000 + Math.floor(Math.random() * 400_000),
      weight: 3_990_000 + Math.floor(Math.random() * 10_000),
      txCount: 2800 + Math.floor(Math.random() * 1500),
      totalFeesBTC: fees,
      feeRangeMin: 4 + Math.floor(Math.random() * 6),
      feeRangeMax: 80 + Math.floor(Math.random() * 120),
      medianFee: 12 + Math.floor(Math.random() * 30),
      pool: mockPoolObj(MOCK_POOLS[Math.floor(Math.random() * MOCK_POOLS.length)]),
      reward: BLOCK_SUBSIDY + fees,
    };
  });
  return { count: blocks.length, blocks, source: 'mock' };
}

function mockBlock(height) {
  const ts = Math.floor(Date.now() / 1000) - (879_120 - height) * 600;
  const fees = Math.round((0.18 + Math.random() * 0.35) * 1e6) / 1e6;
  return {
    height, hash: mockHash(height), timestamp: ts,
    dateISO: new Date(ts * 1000).toISOString(),
    size: 1_500_000, weight: 3_993_000, txCount: 3200,
    difficulty: 110_450_000_000_000, nonce: 2_948_173_526,
    merkleRoot: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    previousBlockHash: mockHash(height - 1),
    totalFeesBTC: fees, medianFee: 18,
    pool: mockPoolObj(MOCK_POOLS[height % MOCK_POOLS.length]),
    reward: BLOCK_SUBSIDY + fees, source: 'mock',
  };
}

function mockFeeEstimates() {
  return {
    nextBlock: 42, thirtyMinutes: 28, oneHour: 18, day: 8, minimum: 4,
    projectedBlocks: [
      [1,42,2800],[2,28,3100],[3,18,3500],[4,12,3800],[5,8,4100],[6,6,4500],
    ].map(([block, medianFee, txCount]) => ({ block, medianFee, txCount })),
    source: 'mock',
  };
}

function mockFeeHistory(days) {
  const now = new Date();
  const history = Array.from({ length: days }, (_, j) => {
    const d = days - 1 - j, base = 15 + Math.sin(d / 3) * 10;
    return {
      date: new Date(now - d * 86_400_000).toISOString().split('T')[0],
      avgMedianFee: Math.round((base + Math.random() * 8) * 10) / 10,
      minFee: Math.max(2, Math.round(base - 8 + Math.random() * 3)),
      maxFee: Math.round(base + 30 + Math.random() * 50),
      blocksObserved: 140 + Math.floor(Math.random() * 10),
      totalFeesBTC: Math.round((18 + Math.random() * 12) * 1000) / 1000,
    };
  });
  return { days, history, source: 'mock' };
}

function mockNetworkHealth() {
  const now = Date.now();
  const series = Array.from({ length: 91 }, (_, j) => {
    const i = 90 - j;
    return {
      timestamp: Math.floor((now - i * 86_400_000) / 1000),
      dateISO: new Date(now - i * 86_400_000).toISOString(),
      hashrateEH: Math.round((750 + i * 1.2 + (Math.random() - 0.5) * 20) * 100) / 100,
    };
  });

  const poolData = [
    ['Foundry USA', 328, 32.47, 1], ['AntPool', 254, 25.15, 0],
    ['F2Pool', 108, 10.69, 0],       ['ViaBTC', 96, 9.50, 0],
    ['Binance Pool', 52, 5.15, 0],    ['Mara Pool', 48, 4.75, 0],
    ['Luxor', 34, 3.37, 0],           ['SBI Crypto', 28, 2.77, 0],
    ['Braiins Pool', 26, 2.57, 0],    ['Ocean', 16, 1.58, 0],
  ];

  return {
    hashrate: { currentEH: 858.4, series },
    difficulty: {
      current: 110_450_000_000_000, progressPercent: 62.3,
      remainingBlocks: 762, remainingTime: 457_200,
      estimatedChangePercent: 3.18, nextRetargetHeight: 879_264,
      previousRetargetDate: new Date(now - 8 * 86_400_000).toISOString(),
      avgBlockTimeSec: 582,
    },
    blockRate: { avgBlockTimeSec: 582, blocksMinedLast24h: 148 },
    topPools: poolData.map(([name, blockCount, sharePercent, emptyBlocks]) => ({
      name, slug: name.toLowerCase().replace(/\s+/g, '-'), blockCount, sharePercent, emptyBlocks,
    })),
    source: 'mock',
  };
}

function mockFeeRevenuePercent() {
  const avgFees = 0.28 + Math.random() * 0.22; // ~0.28-0.50 BTC
  const total = BLOCK_SUBSIDY + avgFees;
  const pct = Math.round((avgFees / total) * 10000) / 100; // ~8-14%

  return {
    feePercent: pct,
    avgFeesPerBlockBTC: Math.round(avgFees * 1e6) / 1e6,
    subsidyBTC: BLOCK_SUBSIDY,
    totalRewardBTC: Math.round(total * 1e6) / 1e6,
    blocksAnalyzed: 15,
    totalFeesBTC: Math.round(avgFees * 15 * 1e6) / 1e6,
    totalSubsidyBTC: Math.round(BLOCK_SUBSIDY * 15 * 1e6) / 1e6,
    source: 'mock',
  };
}

export default {
  getMempool,
  getMempoolHistory,
  getLatestBlocks,
  getBlockByHeight,
  getFeeEstimates,
  getFeeHistory,
  getNetworkHealth,
  getFeeRevenuePercent,
};
