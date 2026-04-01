/**
 * Pool Connectors - Phase 5 Mining Pool Integration
 *
 * Provides unified access to mining pool APIs (Foundry USA, Luxor, etc.)
 * with realistic mock data fallback for demo/development environments.
 *
 * Architecture:
 *   - Per-pool connector classes with standardized interfaces
 *   - Credential storage in pool_config table (base64 obfuscated)
 *   - Unified aggregation layer across all connected pools
 *   - Cache integration for rate-limited pool APIs
 *
 * Supported pools:
 *   Tier 1: Foundry USA (REST API)
 *   Tier 2: Luxor (GraphQL API)
 */

import axios from 'axios';
import { getCache, setCache } from '../cache/database.js';

// ─── Credential Helpers ─────────────────────────────────────────────────────

/**
 * Basic obfuscation for API keys stored at rest.
 * NOT cryptographic encryption - prevents casual plaintext exposure only.
 */
function encodeCredential(value) {
  if (!value) return null;
  return Buffer.from(String(value)).toString('base64');
}

function decodeCredential(encoded) {
  if (!encoded) return null;
  try {
    return Buffer.from(encoded, 'base64').toString('utf-8');
  } catch {
    return null;
  }
}

// ─── In-memory pool registry (persisted via pool_config table) ──────────────

let poolRegistry = [];
let registryLoaded = false;

/**
 * Load pool registry from database. Lazily called on first access.
 */
function loadRegistry() {
  if (registryLoaded) return;
  try {
    // Import dynamically to avoid circular deps at module load time
    const cached = getCache('pool_config');
    if (cached?.data) {
      poolRegistry = cached.data;
    }
  } catch {
    poolRegistry = [];
  }
  registryLoaded = true;
}

function persistRegistry() {
  try {
    setCache('pool_config', poolRegistry, 525600); // 1 year TTL - effectively permanent
  } catch (e) {
    console.error('[PoolConnectors] Failed to persist pool registry:', e.message);
  }
}

// ─── Pool Connector Definitions ─────────────────────────────────────────────

const POOL_DEFINITIONS = {
  foundry: {
    id: 'foundry',
    name: 'Foundry USA',
    tier: 1,
    baseUrl: 'https://api.foundryusapool.com',
    authType: 'api_key',
    authHeader: 'X-API-Key',
    description: 'Foundry USA Pool - largest North American Bitcoin mining pool',
    endpoints: {
      hashrate: '/hashrate',
      workers: '/workers',
      earnings: '/earnings',
      payouts: '/payouts',
    },
  },
  luxor: {
    id: 'luxor',
    name: 'Luxor',
    tier: 2,
    baseUrl: 'https://api.beta.luxor.tech/graphql',
    authType: 'api_key',
    authHeader: 'x-lux-api-key',
    description: 'Luxor Technology - GraphQL-based mining pool with advanced analytics',
    endpoints: {
      graphql: '/graphql',
    },
  },
};

// ─── Foundry USA Connector ──────────────────────────────────────────────────

async function foundryRequest(endpoint, apiKey, params = {}) {
  const def = POOL_DEFINITIONS.foundry;
  const url = `${def.baseUrl}${endpoint}`;

  const response = await axios.get(url, {
    headers: {
      [def.authHeader]: apiKey,
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json',
    },
    params,
    timeout: 15000,
  });

  return response.data;
}

async function foundryGetHashrate(apiKey) {
  const cacheKey = 'pool-foundry-hashrate';
  const cached = getCache(cacheKey);
  if (cached && !cached.stale) return cached.data;

  try {
    const data = await foundryRequest('/hashrate', apiKey);
    const result = {
      current: data.hashrate || data.currentHashrate,
      average24h: data.hashrate24h || data.averageHashrate,
      unit: 'TH/s',
      timestamp: new Date().toISOString(),
    };
    setCache(cacheKey, result, 5);
    return result;
  } catch (e) {
    console.error('[Foundry] Hashrate fetch failed:', e.message);
    throw e;
  }
}

async function foundryGetWorkers(apiKey) {
  const cacheKey = 'pool-foundry-workers';
  const cached = getCache(cacheKey);
  if (cached && !cached.stale) return cached.data;

  try {
    const data = await foundryRequest('/workers', apiKey);
    const result = {
      workers: data.workers || data.data || [],
      total: data.totalWorkers || data.total || 0,
      active: data.activeWorkers || data.active || 0,
      timestamp: new Date().toISOString(),
    };
    setCache(cacheKey, result, 5);
    return result;
  } catch (e) {
    console.error('[Foundry] Workers fetch failed:', e.message);
    throw e;
  }
}

async function foundryGetEarnings(apiKey, period = '24h') {
  const cacheKey = `pool-foundry-earnings-${period}`;
  const cached = getCache(cacheKey);
  if (cached && !cached.stale) return cached.data;

  try {
    const data = await foundryRequest('/earnings', apiKey, { period });
    const result = {
      totalEarnings: data.totalEarnings || data.earnings,
      period,
      currency: 'BTC',
      timestamp: new Date().toISOString(),
    };
    setCache(cacheKey, result, 10);
    return result;
  } catch (e) {
    console.error('[Foundry] Earnings fetch failed:', e.message);
    throw e;
  }
}

async function foundryGetPayouts(apiKey, start, end) {
  const cacheKey = `pool-foundry-payouts-${start}-${end}`;
  const cached = getCache(cacheKey);
  if (cached && !cached.stale) return cached.data;

  try {
    const data = await foundryRequest('/payouts', apiKey, { start, end });
    const result = {
      payouts: data.payouts || data.data || [],
      timestamp: new Date().toISOString(),
    };
    setCache(cacheKey, result, 30);
    return result;
  } catch (e) {
    console.error('[Foundry] Payouts fetch failed:', e.message);
    throw e;
  }
}

// ─── Luxor Connector (GraphQL) ──────────────────────────────────────────────

async function luxorGraphQL(query, variables, apiKey) {
  const def = POOL_DEFINITIONS.luxor;

  const response = await axios.post(
    def.baseUrl,
    { query, variables },
    {
      headers: {
        [def.authHeader]: apiKey,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    },
  );

  if (response.data.errors) {
    throw new Error(`Luxor GraphQL error: ${response.data.errors[0].message}`);
  }

  return response.data.data;
}

async function luxorGetHashrate(apiKey) {
  const cacheKey = 'pool-luxor-hashrate';
  const cached = getCache(cacheKey);
  if (cached && !cached.stale) return cached.data;

  try {
    const query = `
      query {
        getMiningSummary(mpn: BTC, userName: "") {
          hashrate
          hashrate1hrAvg
          hashrate24hrAvg
        }
      }
    `;
    const data = await luxorGraphQL(query, {}, apiKey);
    const summary = data.getMiningSummary;
    const result = {
      current: summary.hashrate,
      average1h: summary.hashrate1hrAvg,
      average24h: summary.hashrate24hrAvg,
      unit: 'TH/s',
      timestamp: new Date().toISOString(),
    };
    setCache(cacheKey, result, 5);
    return result;
  } catch (e) {
    console.error('[Luxor] Hashrate fetch failed:', e.message);
    throw e;
  }
}

async function luxorGetWorkers(apiKey) {
  const cacheKey = 'pool-luxor-workers';
  const cached = getCache(cacheKey);
  if (cached && !cached.stale) return cached.data;

  try {
    const query = `
      query {
        getWorkers(mpn: BTC, userName: "", first: 2000) {
          nodes {
            workerName
            hashrate
            status
            lastShare
          }
          totalCount
        }
      }
    `;
    const data = await luxorGraphQL(query, {}, apiKey);
    const workers = data.getWorkers;
    const result = {
      workers: workers.nodes || [],
      total: workers.totalCount || 0,
      active: (workers.nodes || []).filter(w => w.status === 'Active').length,
      timestamp: new Date().toISOString(),
    };
    setCache(cacheKey, result, 5);
    return result;
  } catch (e) {
    console.error('[Luxor] Workers fetch failed:', e.message);
    throw e;
  }
}

async function luxorGetEarnings(apiKey, period = '24h') {
  const cacheKey = `pool-luxor-earnings-${period}`;
  const cached = getCache(cacheKey);
  if (cached && !cached.stale) return cached.data;

  try {
    const query = `
      query {
        getRevenueSummary(mpn: BTC, userName: "") {
          totalRevenue
          totalFees
        }
      }
    `;
    const data = await luxorGraphQL(query, {}, apiKey);
    const result = {
      totalEarnings: data.getRevenueSummary.totalRevenue,
      fees: data.getRevenueSummary.totalFees,
      period,
      currency: 'BTC',
      timestamp: new Date().toISOString(),
    };
    setCache(cacheKey, result, 10);
    return result;
  } catch (e) {
    console.error('[Luxor] Earnings fetch failed:', e.message);
    throw e;
  }
}

async function luxorGetPayouts(apiKey, start, end) {
  const cacheKey = `pool-luxor-payouts-${start}-${end}`;
  const cached = getCache(cacheKey);
  if (cached && !cached.stale) return cached.data;

  try {
    const query = `
      query {
        getPayouts(mpn: BTC, userName: "", first: 100) {
          nodes {
            amount
            txHash
            paidOn
          }
        }
      }
    `;
    const data = await luxorGraphQL(query, {}, apiKey);
    const result = {
      payouts: data.getPayouts.nodes || [],
      timestamp: new Date().toISOString(),
    };
    setCache(cacheKey, result, 30);
    return result;
  } catch (e) {
    console.error('[Luxor] Payouts fetch failed:', e.message);
    throw e;
  }
}

// ─── Mock Data Generator ────────────────────────────────────────────────────

/**
 * Generate high-fidelity mock data for demo environments.
 * Modeled after a ~40 MW facility running S21 Pro and S19 XP machines.
 */
function generateMockWorkers() {
  const workers = [];
  const rows = ['row1', 'row2', 'row3', 'row4', 'row5', 'row6', 'row7', 'row8'];
  const models = [
    { prefix: 's21pro', hashMin: 200, hashMax: 300, count: 1100 },
    { prefix: 's19xp', hashMin: 100, hashMax: 150, count: 315 },
  ];

  let activeCount = 0;
  let inactiveCount = 0;
  let deadCount = 0;

  for (const model of models) {
    let placed = 0;
    for (const row of rows) {
      const perRow = Math.ceil(model.count / rows.length);
      for (let i = 0; i < perRow && placed < model.count; i++) {
        placed++;
        const id = String(placed).padStart(3, '0');
        const workerName = `container_${row}.${model.prefix}_${id}`;

        // Determine status: ~98.9% active, ~0.85% inactive, ~0.2% dead
        let status = 'active';
        const roll = Math.random();
        if (roll > 0.998) {
          status = 'dead';
          deadCount++;
        } else if (roll > 0.991) {
          status = 'inactive';
          inactiveCount++;
        } else {
          activeCount++;
        }

        const baseHash = model.hashMin + Math.random() * (model.hashMax - model.hashMin);
        const currentHash = status === 'active' ? baseHash * (0.95 + Math.random() * 0.1) : 0;
        const rejectRate = status === 'active' ? 0.003 + Math.random() * 0.008 : 0;

        workers.push({
          workerName,
          hashrate: Math.round(currentHash * 100) / 100,
          hashrateUnit: 'TH/s',
          averageHashrate24h: status === 'active' ? Math.round(baseHash * 100) / 100 : 0,
          status,
          rejectRate: Math.round(rejectRate * 10000) / 10000,
          lastShare: status === 'active'
            ? new Date(Date.now() - Math.random() * 120000).toISOString()
            : status === 'inactive'
              ? new Date(Date.now() - 3600000 - Math.random() * 7200000).toISOString()
              : new Date(Date.now() - 86400000 * (1 + Math.random() * 5)).toISOString(),
          uptime: status === 'active' ? 0.95 + Math.random() * 0.05 : 0,
          temperature: status === 'active' ? 55 + Math.random() * 20 : 0,
          fanSpeed: status === 'active' ? 4000 + Math.random() * 2000 : 0,
        });
      }
    }
  }

  return {
    workers,
    summary: {
      total: workers.length,
      active: activeCount,
      inactive: inactiveCount,
      dead: deadCount,
    },
  };
}

function generateMockHashrate() {
  const totalActiveTH = 8870000; // ~8.87 EH/s across all workers
  const jitter = (Math.random() - 0.5) * 200000;

  return {
    current: totalActiveTH + jitter,
    average1h: totalActiveTH + (Math.random() - 0.5) * 100000,
    average24h: totalActiveTH,
    average7d: totalActiveTH * 0.998,
    unit: 'TH/s',
    currentEH: (totalActiveTH + jitter) / 1e6,
    average24hEH: totalActiveTH / 1e6,
    timestamp: new Date().toISOString(),
  };
}

function generateMockHashrateHistory(start, end, interval = '1h') {
  const startMs = start ? new Date(start).getTime() : Date.now() - 7 * 86400000;
  const endMs = end ? new Date(end).getTime() : Date.now();

  const intervalMs = interval === '1d' ? 86400000
    : interval === '4h' ? 14400000
    : interval === '15m' ? 900000
    : 3600000; // default 1h

  const baseTH = 8870000;
  const points = [];
  let t = startMs;

  while (t <= endMs) {
    const hourOfDay = new Date(t).getUTCHours();
    // Slight diurnal variation (curtailment during peak hours)
    const diurnal = hourOfDay >= 14 && hourOfDay <= 18 ? -200000 : 0;
    const noise = (Math.random() - 0.5) * 300000;

    points.push({
      timestamp: new Date(t).toISOString(),
      hashrate: Math.round(baseTH + diurnal + noise),
      unit: 'TH/s',
    });

    t += intervalMs;
  }

  return { history: points, interval, count: points.length };
}

function generateMockEarnings(period = '24h') {
  const dailyBTC = 0.095;
  const multiplier = period === '7d' ? 7
    : period === '30d' ? 30
    : period === '1h' ? 1 / 24
    : 1;

  const earnings = dailyBTC * multiplier;
  const btcPrice = 97500 + (Math.random() - 0.5) * 5000;

  return {
    totalEarnings: Math.round(earnings * 1e8) / 1e8,
    earningsUSD: Math.round(earnings * btcPrice * 100) / 100,
    period,
    currency: 'BTC',
    btcPrice,
    dailyAverage: dailyBTC,
    dailyAverageUSD: Math.round(dailyBTC * btcPrice * 100) / 100,
    rewardType: 'FPPS',
    poolFeePercent: 2.0,
    timestamp: new Date().toISOString(),
  };
}

function generateMockPayouts(start, end) {
  const startMs = start ? new Date(start).getTime() : Date.now() - 30 * 86400000;
  const endMs = end ? new Date(end).getTime() : Date.now();
  const payouts = [];

  // Daily payouts
  let t = startMs;
  while (t <= endMs) {
    const dailyAmount = 0.09 + Math.random() * 0.015;
    const txHash = Array.from({ length: 64 }, () =>
      '0123456789abcdef'[Math.floor(Math.random() * 16)]
    ).join('');

    payouts.push({
      amount: Math.round(dailyAmount * 1e8) / 1e8,
      currency: 'BTC',
      txHash,
      paidOn: new Date(t + 14 * 3600000).toISOString(), // Paid around 2 PM UTC
      status: 'confirmed',
      confirmations: Math.floor(Math.random() * 1000) + 6,
    });

    t += 86400000;
  }

  return {
    payouts: payouts.reverse(),
    count: payouts.length,
    totalPaid: Math.round(payouts.reduce((s, p) => s + p.amount, 0) * 1e8) / 1e8,
  };
}

function generateMockShares() {
  const accepted = 12847523 + Math.floor(Math.random() * 50000);
  const rejected = Math.floor(accepted * (0.007 + Math.random() * 0.002));
  const stale = Math.floor(accepted * (0.001 + Math.random() * 0.001));

  return {
    accepted,
    rejected,
    stale,
    total: accepted + rejected + stale,
    rejectRate: Math.round((rejected / (accepted + rejected + stale)) * 10000) / 10000,
    staleRate: Math.round((stale / (accepted + rejected + stale)) * 10000) / 10000,
    luck: Math.round((0.98 + Math.random() * 0.06) * 10000) / 100, // ~98-104%
    luck24h: 101.0 + (Math.random() - 0.5) * 6,
    luck7d: 100.0 + (Math.random() - 0.5) * 4,
    luck30d: 100.0 + (Math.random() - 0.5) * 2,
    difficulty: 119.12e12,
    timestamp: new Date().toISOString(),
  };
}

function generateMockPoolInfo(poolId) {
  const def = POOL_DEFINITIONS[poolId] || { name: poolId, tier: 3 };

  return {
    poolId: poolId,
    name: def.name || poolId,
    tier: def.tier || 3,
    algorithm: 'SHA-256',
    coin: 'BTC',
    rewardMethod: 'FPPS',
    feePercent: poolId === 'foundry' ? 2.0 : 2.5,
    minPayout: 0.01,
    payoutFrequency: 'daily',
    serverLocations: poolId === 'foundry'
      ? ['us-east', 'us-west', 'eu-west']
      : ['us-east', 'eu-west', 'asia-southeast'],
    stratumEndpoints: poolId === 'foundry'
      ? ['stratum+tcp://us.foundryusapool.com:3333', 'stratum+ssl://us.foundryusapool.com:25']
      : ['stratum+tcp://us.luxor.tech:700', 'stratum+ssl://us.luxor.tech:443'],
    networkHashratePercent: poolId === 'foundry' ? 32.8 : 3.2,
    blocksFound24h: poolId === 'foundry' ? 47 : 5,
    lastBlockFound: new Date(Date.now() - Math.random() * 1800000).toISOString(),
    status: 'operational',
    latency: Math.round(15 + Math.random() * 30),
    timestamp: new Date().toISOString(),
  };
}

// ─── Connector Dispatcher ───────────────────────────────────────────────────

/**
 * Route a request to the correct pool connector, falling back to mock data.
 */
function getPoolCredentials(poolId) {
  loadRegistry();
  const pool = poolRegistry.find(p => p.id === poolId);
  if (!pool || !pool.credentials) return null;

  const decoded = {};
  for (const [key, val] of Object.entries(pool.credentials)) {
    decoded[key] = decodeCredential(val);
  }
  return decoded;
}

function hasRealCredentials(poolId) {
  const creds = getPoolCredentials(poolId);
  return creds && creds.apiKey && creds.apiKey.length > 8;
}

async function dispatchHashrate(poolId) {
  const creds = getPoolCredentials(poolId);

  if (creds?.apiKey) {
    try {
      if (poolId === 'foundry') return await foundryGetHashrate(creds.apiKey);
      if (poolId === 'luxor') return await luxorGetHashrate(creds.apiKey);
    } catch (e) {
      console.warn(`[PoolConnectors] Live ${poolId} hashrate failed, using mock:`, e.message);
    }
  }

  return { ...generateMockHashrate(), isMock: true, source: `${poolId}-mock` };
}

async function dispatchHashrateHistory(poolId, start, end, interval) {
  // History is always mock for now - pool APIs rarely offer granular history
  return { ...generateMockHashrateHistory(start, end, interval), isMock: true, source: `${poolId}-mock` };
}

async function dispatchWorkers(poolId) {
  const creds = getPoolCredentials(poolId);

  if (creds?.apiKey) {
    try {
      if (poolId === 'foundry') return await foundryGetWorkers(creds.apiKey);
      if (poolId === 'luxor') return await luxorGetWorkers(creds.apiKey);
    } catch (e) {
      console.warn(`[PoolConnectors] Live ${poolId} workers failed, using mock:`, e.message);
    }
  }

  const mock = generateMockWorkers();
  return {
    workers: mock.workers,
    total: mock.summary.total,
    active: mock.summary.active,
    inactive: mock.summary.inactive,
    dead: mock.summary.dead,
    isMock: true,
    source: `${poolId}-mock`,
    timestamp: new Date().toISOString(),
  };
}

async function dispatchWorkerDetail(poolId, workerId) {
  const allWorkers = await dispatchWorkers(poolId);
  const worker = allWorkers.workers.find(w => w.workerName === workerId);

  if (!worker) {
    return { error: `Worker '${workerId}' not found`, poolId };
  }

  return {
    ...worker,
    poolId,
    hashrate1h: worker.hashrate * (0.97 + Math.random() * 0.06),
    hashrate24h: worker.averageHashrate24h || worker.hashrate,
    shares24h: {
      accepted: Math.floor(50000 + Math.random() * 20000),
      rejected: Math.floor(300 + Math.random() * 200),
      stale: Math.floor(50 + Math.random() * 50),
    },
    isMock: allWorkers.isMock || false,
    source: allWorkers.source || poolId,
    timestamp: new Date().toISOString(),
  };
}

async function dispatchEarnings(poolId, period) {
  const creds = getPoolCredentials(poolId);

  if (creds?.apiKey) {
    try {
      if (poolId === 'foundry') return await foundryGetEarnings(creds.apiKey, period);
      if (poolId === 'luxor') return await luxorGetEarnings(creds.apiKey, period);
    } catch (e) {
      console.warn(`[PoolConnectors] Live ${poolId} earnings failed, using mock:`, e.message);
    }
  }

  return { ...generateMockEarnings(period), isMock: true, source: `${poolId}-mock` };
}

async function dispatchPayouts(poolId, start, end) {
  const creds = getPoolCredentials(poolId);

  if (creds?.apiKey) {
    try {
      if (poolId === 'foundry') return await foundryGetPayouts(creds.apiKey, start, end);
      if (poolId === 'luxor') return await luxorGetPayouts(creds.apiKey, start, end);
    } catch (e) {
      console.warn(`[PoolConnectors] Live ${poolId} payouts failed, using mock:`, e.message);
    }
  }

  return { ...generateMockPayouts(start, end), isMock: true, source: `${poolId}-mock` };
}

// ─── Exported Public API ────────────────────────────────────────────────────

/**
 * Get all configured pools with connection status.
 */
export function getConfiguredPools() {
  loadRegistry();

  if (poolRegistry.length === 0) {
    // Return available pool definitions with demo status
    return Object.values(POOL_DEFINITIONS).map(def => ({
      id: def.id,
      name: def.name,
      tier: def.tier,
      description: def.description,
      connected: false,
      hasCredentials: false,
      status: 'not_configured',
      lastSeen: null,
    }));
  }

  return poolRegistry.map(pool => {
    const def = POOL_DEFINITIONS[pool.id] || {};
    return {
      id: pool.id,
      name: def.name || pool.name || pool.id,
      tier: def.tier || pool.tier || 3,
      description: def.description || '',
      connected: pool.connected || false,
      hasCredentials: !!(pool.credentials?.apiKey),
      status: pool.status || 'unknown',
      lastSeen: pool.lastSeen || null,
      addedAt: pool.addedAt || null,
    };
  });
}

/**
 * Add a new pool connection with credentials.
 * @param {object} pool - { id, name, tier? }
 * @param {object} credentials - { apiKey, accountId?, subaccount? }
 */
export function addPoolConnection(pool, credentials) {
  loadRegistry();

  if (!pool?.id) {
    throw new Error('Pool id is required');
  }

  // Encode credentials
  const encoded = {};
  for (const [key, val] of Object.entries(credentials || {})) {
    encoded[key] = encodeCredential(val);
  }

  // Check if pool already exists
  const existing = poolRegistry.findIndex(p => p.id === pool.id);
  const entry = {
    id: pool.id,
    name: pool.name || POOL_DEFINITIONS[pool.id]?.name || pool.id,
    tier: pool.tier || POOL_DEFINITIONS[pool.id]?.tier || 3,
    credentials: encoded,
    connected: true,
    status: 'configured',
    addedAt: new Date().toISOString(),
    lastSeen: null,
  };

  if (existing >= 0) {
    poolRegistry[existing] = { ...poolRegistry[existing], ...entry };
  } else {
    poolRegistry.push(entry);
  }

  persistRegistry();

  return {
    success: true,
    poolId: pool.id,
    message: `Pool ${entry.name} configured successfully`,
  };
}

/**
 * Remove a pool connection.
 */
export function removePoolConnection(poolId) {
  loadRegistry();

  const idx = poolRegistry.findIndex(p => p.id === poolId);
  if (idx < 0) {
    return { success: false, message: `Pool '${poolId}' not found` };
  }

  const removed = poolRegistry.splice(idx, 1)[0];
  persistRegistry();

  return {
    success: true,
    poolId,
    message: `Pool ${removed.name || poolId} removed`,
  };
}

/**
 * Test pool API connectivity.
 */
export async function testPoolConnection(poolId) {
  const creds = getPoolCredentials(poolId);
  const def = POOL_DEFINITIONS[poolId];

  if (!def) {
    return { success: false, poolId, error: `Unknown pool: ${poolId}` };
  }

  if (!creds?.apiKey) {
    return {
      success: false,
      poolId,
      error: 'No API key configured',
      suggestion: 'Add credentials with addPoolConnection()',
    };
  }

  try {
    const startMs = Date.now();

    if (poolId === 'foundry') {
      await foundryRequest('/hashrate', creds.apiKey);
    } else if (poolId === 'luxor') {
      const query = '{ getMiningSummary(mpn: BTC, userName: "") { hashrate } }';
      await luxorGraphQL(query, {}, creds.apiKey);
    }

    const latencyMs = Date.now() - startMs;

    // Update registry status
    loadRegistry();
    const entry = poolRegistry.find(p => p.id === poolId);
    if (entry) {
      entry.status = 'connected';
      entry.connected = true;
      entry.lastSeen = new Date().toISOString();
      entry.latencyMs = latencyMs;
      persistRegistry();
    }

    return {
      success: true,
      poolId,
      latencyMs,
      message: `Connected to ${def.name} successfully`,
    };
  } catch (e) {
    // Update registry status
    loadRegistry();
    const entry = poolRegistry.find(p => p.id === poolId);
    if (entry) {
      entry.status = 'error';
      entry.connected = false;
      entry.lastError = e.message;
      persistRegistry();
    }

    return {
      success: false,
      poolId,
      error: e.message,
      statusCode: e.response?.status || null,
    };
  }
}

/**
 * Get current hashrate from a pool.
 */
export async function getPoolHashrate(poolId) {
  try {
    return await dispatchHashrate(poolId);
  } catch (e) {
    return { error: e.message, poolId, timestamp: new Date().toISOString() };
  }
}

/**
 * Get historical hashrate data from a pool.
 */
export async function getPoolHashrateHistory(poolId, start, end, interval = '1h') {
  try {
    return await dispatchHashrateHistory(poolId, start, end, interval);
  } catch (e) {
    return { error: e.message, poolId, timestamp: new Date().toISOString() };
  }
}

/**
 * Get worker list from a pool.
 */
export async function getPoolWorkers(poolId) {
  try {
    return await dispatchWorkers(poolId);
  } catch (e) {
    return { error: e.message, poolId, timestamp: new Date().toISOString() };
  }
}

/**
 * Get specific worker details from a pool.
 */
export async function getPoolWorkerDetail(poolId, workerId) {
  try {
    return await dispatchWorkerDetail(poolId, workerId);
  } catch (e) {
    return { error: e.message, poolId, workerId, timestamp: new Date().toISOString() };
  }
}

/**
 * Get earnings summary from a pool.
 */
export async function getPoolEarnings(poolId, period = '24h') {
  try {
    return await dispatchEarnings(poolId, period);
  } catch (e) {
    return { error: e.message, poolId, timestamp: new Date().toISOString() };
  }
}

/**
 * Get payout history from a pool.
 */
export async function getPoolPayouts(poolId, start, end) {
  try {
    return await dispatchPayouts(poolId, start, end);
  } catch (e) {
    return { error: e.message, poolId, timestamp: new Date().toISOString() };
  }
}

/**
 * Get share and luck statistics from a pool.
 */
export async function getPoolShares(poolId) {
  // Share stats rarely have live API support - use mock with cache
  const cacheKey = `pool-shares-${poolId}`;
  const cached = getCache(cacheKey);
  if (cached && !cached.stale) return cached.data;

  const data = { ...generateMockShares(), poolId, isMock: !hasRealCredentials(poolId) };
  setCache(cacheKey, data, 5);
  return data;
}

/**
 * Get pool-level info and metadata.
 */
export async function getPoolInfo(poolId) {
  const cacheKey = `pool-info-${poolId}`;
  const cached = getCache(cacheKey);
  if (cached && !cached.stale) return cached.data;

  const info = generateMockPoolInfo(poolId);
  info.hasCredentials = hasRealCredentials(poolId);
  info.isMock = !info.hasCredentials;

  setCache(cacheKey, info, 15);
  return info;
}

/**
 * Get unified data across all configured (or default demo) pools.
 * Aggregates hashrate, workers, and earnings from all sources.
 */
export async function getUnifiedPoolData() {
  loadRegistry();

  // Use configured pools, or fall back to foundry as demo default
  const poolIds = poolRegistry.length > 0
    ? poolRegistry.map(p => p.id)
    : ['foundry'];

  const results = await Promise.allSettled(
    poolIds.map(async (poolId) => {
      const [hashrate, workers, earnings, shares, info] = await Promise.allSettled([
        getPoolHashrate(poolId),
        getPoolWorkers(poolId),
        getPoolEarnings(poolId, '24h'),
        getPoolShares(poolId),
        getPoolInfo(poolId),
      ]);

      return {
        poolId,
        hashrate: hashrate.status === 'fulfilled' ? hashrate.value : null,
        workers: workers.status === 'fulfilled' ? workers.value : null,
        earnings: earnings.status === 'fulfilled' ? earnings.value : null,
        shares: shares.status === 'fulfilled' ? shares.value : null,
        info: info.status === 'fulfilled' ? info.value : null,
      };
    }),
  );

  // Aggregate across pools
  let totalHashrateTH = 0;
  let totalWorkers = 0;
  let totalActiveWorkers = 0;
  let totalInactiveWorkers = 0;
  let totalDeadWorkers = 0;
  let totalEarnings24h = 0;
  let weightedRejectRate = 0;
  let weightedLuck = 0;
  let poolCount = 0;

  const pools = [];

  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    const data = result.value;
    pools.push(data);

    if (data.hashrate?.current) totalHashrateTH += data.hashrate.current;
    if (data.workers?.total) totalWorkers += data.workers.total;
    if (data.workers?.active) totalActiveWorkers += data.workers.active;
    if (data.workers?.inactive) totalInactiveWorkers += data.workers.inactive;
    if (data.workers?.dead) totalDeadWorkers += data.workers.dead;
    if (data.earnings?.totalEarnings) totalEarnings24h += data.earnings.totalEarnings;
    if (data.shares?.rejectRate) {
      weightedRejectRate += data.shares.rejectRate;
      poolCount++;
    }
    if (data.shares?.luck24h) {
      weightedLuck += data.shares.luck24h;
    }
  }

  const avgRejectRate = poolCount > 0 ? weightedRejectRate / poolCount : 0;
  const avgLuck = poolCount > 0 ? weightedLuck / poolCount : 100;

  return {
    timestamp: new Date().toISOString(),
    poolCount: pools.length,
    aggregate: {
      totalHashrateTH,
      totalHashrateEH: totalHashrateTH / 1e6,
      totalWorkers,
      activeWorkers: totalActiveWorkers,
      inactiveWorkers: totalInactiveWorkers,
      deadWorkers: totalDeadWorkers,
      onlinePercent: totalWorkers > 0
        ? Math.round((totalActiveWorkers / totalWorkers) * 10000) / 100
        : 0,
      totalEarnings24h,
      totalEarnings24hUnit: 'BTC',
      avgRejectRate: Math.round(avgRejectRate * 10000) / 10000,
      avgLuck24h: Math.round(avgLuck * 100) / 100,
    },
    pools,
    isMock: pools.every(p => p.hashrate?.isMock || p.earnings?.isMock),
  };
}

/**
 * Get side-by-side comparison of all pools for a given period.
 */
export async function getPoolComparison(period = '24h') {
  loadRegistry();

  const poolIds = poolRegistry.length > 0
    ? poolRegistry.map(p => p.id)
    : ['foundry', 'luxor'];

  const comparisons = await Promise.allSettled(
    poolIds.map(async (poolId) => {
      const [hashrate, earnings, shares, info] = await Promise.allSettled([
        getPoolHashrate(poolId),
        getPoolEarnings(poolId, period),
        getPoolShares(poolId),
        getPoolInfo(poolId),
      ]);

      return {
        poolId,
        name: info.status === 'fulfilled' ? info.value?.name : poolId,
        tier: info.status === 'fulfilled' ? info.value?.tier : null,
        hashrate: hashrate.status === 'fulfilled' ? {
          current: hashrate.value?.current || 0,
          average24h: hashrate.value?.average24h || hashrate.value?.average24hEH || 0,
          unit: hashrate.value?.unit || 'TH/s',
        } : null,
        earnings: earnings.status === 'fulfilled' ? {
          total: earnings.value?.totalEarnings || 0,
          usd: earnings.value?.earningsUSD || 0,
          period: earnings.value?.period || period,
        } : null,
        shares: shares.status === 'fulfilled' ? {
          rejectRate: shares.value?.rejectRate || 0,
          luck24h: shares.value?.luck24h || 100,
          luck7d: shares.value?.luck7d || 100,
        } : null,
        fee: info.status === 'fulfilled' ? info.value?.feePercent : null,
        rewardMethod: info.status === 'fulfilled' ? info.value?.rewardMethod : null,
        networkShare: info.status === 'fulfilled' ? info.value?.networkHashratePercent : null,
        status: info.status === 'fulfilled' ? info.value?.status : 'unknown',
        isMock: hashrate.value?.isMock || earnings.value?.isMock || false,
      };
    }),
  );

  const pools = comparisons
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value);

  return {
    timestamp: new Date().toISOString(),
    period,
    pools,
    poolCount: pools.length,
    isMock: pools.every(p => p.isMock),
  };
}

export default {
  getConfiguredPools,
  addPoolConnection,
  removePoolConnection,
  testPoolConnection,
  getPoolHashrate,
  getPoolHashrateHistory,
  getPoolWorkers,
  getPoolWorkerDetail,
  getPoolEarnings,
  getPoolPayouts,
  getPoolShares,
  getPoolInfo,
  getUnifiedPoolData,
  getPoolComparison,
};
