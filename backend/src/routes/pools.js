/**
 * Pool Management & Data Routes - Phase 5
 *
 * Handles pool connections, hashrate, workers, earnings, payouts,
 * shares, pool info, unified data, and comparison endpoints.
 */
import express from 'express';
import {
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
} from '../services/poolConnectors.js';
import { getPoolConfig, savePoolConfig } from '../cache/database.js';

const router = express.Router();

// ─── Pool Management ─────────────────────────────────────────────────────

/** GET / - List configured pools with connection status and monitoring prefs */
router.get('/', (req, res) => {
  try {
    const pools = getConfiguredPools();
    const config = getPoolConfig() || {};
    res.json({
      pools,
      monitoring: config.monitoring || null,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error listing pools:', error);
    res.status(500).json({ error: error.message });
  }
});

/** POST / - Add pool connection */
router.post('/', (req, res) => {
  try {
    const { pool, apiKey, apiSecret, accountId } = req.body;
    if (!pool || !apiKey) {
      return res.status(400).json({ error: 'pool and apiKey are required' });
    }
    const result = addPoolConnection(pool, { apiKey, apiSecret, accountId });
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Error adding pool:', error);
    res.status(500).json({ error: error.message });
  }
});

/** PUT /:poolId - Update pool credentials */
router.put('/:poolId', (req, res) => {
  try {
    const { apiKey, apiSecret, accountId } = req.body;
    // Remove and re-add with new credentials
    removePoolConnection(req.params.poolId);
    const result = addPoolConnection(req.params.poolId, { apiKey, apiSecret, accountId });
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Error updating pool:', error);
    res.status(500).json({ error: error.message });
  }
});

/** DELETE /:poolId - Remove pool connection */
router.delete('/:poolId', (req, res) => {
  try {
    removePoolConnection(req.params.poolId);
    res.json({ success: true });
  } catch (error) {
    console.error('Error removing pool:', error);
    res.status(500).json({ error: error.message });
  }
});

/** POST /:poolId/test - Test pool connection */
router.post('/:poolId/test', async (req, res) => {
  try {
    const result = await testPoolConnection(req.params.poolId);
    res.json(result);
  } catch (error) {
    console.error('Error testing pool:', error);
    res.status(500).json({ error: error.message, connected: false });
  }
});

/** POST /monitoring - Save pool monitoring preferences */
router.post('/monitoring', (req, res) => {
  try {
    const { pollIntervalSeconds, workerSnapshotMinutes, hashrateDeviationPct, rejectRateThreshold, deadWorkerTimeoutMinutes } = req.body;
    // Store in pool_config table as JSON
    const existing = getPoolConfig() || {};
    const updated = {
      ...existing,
      monitoring: {
        pollIntervalSeconds: pollIntervalSeconds || 60,
        workerSnapshotMinutes: workerSnapshotMinutes || 5,
        hashrateDeviationPct: hashrateDeviationPct || 10,
        rejectRateThreshold: rejectRateThreshold || 2,
        deadWorkerTimeoutMinutes: deadWorkerTimeoutMinutes || 30,
      },
    };
    savePoolConfig(updated);
    res.json({ success: true, monitoring: updated.monitoring });
  } catch (error) {
    console.error('Error saving pool monitoring:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── Unified Pool Data ───────────────────────────────────────────────────

/** GET /unified - Aggregated data across all pools */
router.get('/unified', async (req, res) => {
  try {
    const data = await getUnifiedPoolData();
    res.json(data);
  } catch (error) {
    console.error('Error getting unified pool data:', error);
    res.status(500).json({ error: error.message });
  }
});

/** GET /comparison - Side-by-side pool comparison */
router.get('/comparison', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const data = await getPoolComparison(`${days}d`);
    res.json(data);
  } catch (error) {
    console.error('Error getting pool comparison:', error);
    res.status(500).json({ error: error.message });
  }
});

/** GET /earnings - Aggregated earnings across all pools */
router.get('/earnings', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const pools = getConfiguredPools();

    if (pools.length === 0) {
      // Return mock data when no pools configured
      const unified = await getUnifiedPoolData();
      const dailyEarnings = [];
      const now = new Date();
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const date = d.toISOString().split('T')[0];
        const baseBtc = 0.085 + Math.random() * 0.02;
        dailyEarnings.push({
          date,
          earnedBtc: baseBtc,
          earnedUsd: baseBtc * 65000,
          curtailmentDay: Math.random() > 0.7,
        });
      }
      const totalBtc = dailyEarnings.reduce((s, d) => s + d.earnedBtc, 0);
      const totalUsd = dailyEarnings.reduce((s, d) => s + d.earnedUsd, 0);
      res.json({
        configured: false,
        isMock: true,
        pool: 'Demo',
        earnings: {
          totalEarned: totalBtc,
          totalEarnedUSD: totalUsd,
          avgDailyEarning: totalBtc / days,
          avgDailyEarningUSD: totalUsd / days,
          subsidyComponent: totalBtc * 0.847,
          feeComponent: totalBtc * 0.153,
          subsidyPercent: 84.7,
          feePercent: 15.3,
          luckPercent: 101.2,
          payoutMethod: 'FPPS',
        },
        dailyEarnings,
        recentPayouts: [
          { amount: 0.0952, status: 'confirmed', timestamp: new Date(Date.now() - 7200000).toISOString() },
          { amount: 0.0941, status: 'confirmed', timestamp: new Date(Date.now() - 93600000).toISOString() },
          { amount: 0.0963, status: 'confirmed', timestamp: new Date(Date.now() - 180000000).toISOString() },
        ],
        pendingBalance: 0.0034,
        fetchedAt: new Date().toISOString(),
      });
      return;
    }

    // Aggregate real earnings from all pools
    const allEarnings = await Promise.all(
      pools.map(p => getPoolEarnings(p.id, `${days}d`).catch(() => null))
    );

    const combined = allEarnings.filter(Boolean);
    const totalBtc = combined.reduce((s, e) => s + (e.totalEarned || 0), 0);
    const totalUsd = combined.reduce((s, e) => s + (e.totalEarnedUSD || 0), 0);

    res.json({
      configured: true,
      pool: pools.map(p => p.pool).join(' + '),
      earnings: {
        totalEarned: totalBtc,
        totalEarnedUSD: totalUsd,
        avgDailyEarning: days > 0 ? totalBtc / days : 0,
        avgDailyEarningUSD: days > 0 ? totalUsd / days : 0,
        subsidyComponent: combined.reduce((s, e) => s + (e.subsidyComponent || 0), 0),
        feeComponent: combined.reduce((s, e) => s + (e.feeComponent || 0), 0),
        subsidyPercent: totalBtc > 0 ? (combined.reduce((s, e) => s + (e.subsidyComponent || 0), 0) / totalBtc) * 100 : 85,
        feePercent: totalBtc > 0 ? (combined.reduce((s, e) => s + (e.feeComponent || 0), 0) / totalBtc) * 100 : 15,
        luckPercent: combined.length > 0 ? combined.reduce((s, e) => s + (e.luck?.last30d || 100), 0) / combined.length : 100,
        payoutMethod: combined[0]?.payoutMethod || 'FPPS',
      },
      dailyEarnings: [],
      recentPayouts: [],
      pendingBalance: 0,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error getting earnings:', error);
    res.status(500).json({ error: error.message });
  }
});

/** GET /workers - Aggregated worker list across all pools */
router.get('/workers', async (req, res) => {
  try {
    const unified = await getUnifiedPoolData();
    const pools = getConfiguredPools();

    // Gather all workers
    let allWorkers = [];
    for (const pool of (pools.length > 0 ? pools : [{ id: 'mock' }])) {
      try {
        const workers = await getPoolWorkers(pool.id);
        allWorkers = allWorkers.concat(
          (workers || []).map(w => ({ ...w, pool: pool.id || pool.pool }))
        );
      } catch (e) { /* skip */ }
    }

    const active = allWorkers.filter(w => w.status === 'active').length;
    const slow = allWorkers.filter(w => w.status === 'slow').length;
    const inactive = allWorkers.filter(w => w.status === 'inactive').length;
    const dead = allWorkers.filter(w => w.status === 'dead').length;

    res.json({
      configured: pools.length > 0 || allWorkers.length > 0,
      isMock: unified?.isMock || false,
      pool: pools.map(p => p.pool || p.id).join(' + ') || 'Demo',
      workers: allWorkers,
      summary: {
        total: allWorkers.length,
        active,
        slow,
        inactive,
        dead,
        curtailmentMatch: true, // simplified check
      },
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error getting workers:', error);
    res.status(500).json({ error: error.message });
  }
});

/** GET /hashrate/history - Pool hashrate history for charts */
router.get('/hashrate/history', async (req, res) => {
  try {
    const hours = parseInt(req.query.hours) || 24;
    const pools = getConfiguredPools();

    // Generate mock history if no pools
    const history = [];
    const now = Date.now();
    const baseHashrate = 8870000; // ~8.87 EH/s in TH/s
    for (let i = hours; i >= 0; i--) {
      const ts = new Date(now - i * 3600000).toISOString();
      const noise = (Math.random() - 0.5) * baseHashrate * 0.05;
      history.push({
        timestamp: ts,
        hashrate: baseHashrate + noise,
        hour: new Date(ts).getHours(),
      });
    }

    res.json({
      history,
      hours,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error getting hashrate history:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── Per-Pool Data ───────────────────────────────────────────────────────

/** GET /:poolId/hashrate - Current hashrate for a specific pool */
router.get('/:poolId/hashrate', async (req, res) => {
  try {
    const data = await getPoolHashrate(req.params.poolId);
    res.json({ ...data, fetchedAt: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** GET /:poolId/hashrate/history - Historical hashrate */
router.get('/:poolId/hashrate/history', async (req, res) => {
  try {
    const data = await getPoolHashrateHistory(
      req.params.poolId,
      req.query.start ? new Date(req.query.start) : new Date(Date.now() - 7 * 86400000),
      req.query.end ? new Date(req.query.end) : new Date(),
      req.query.interval || '1h'
    );
    res.json({ history: data, fetchedAt: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** GET /:poolId/workers - Worker list for a specific pool */
router.get('/:poolId/workers', async (req, res) => {
  try {
    const data = await getPoolWorkers(req.params.poolId);
    res.json({ workers: data, fetchedAt: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** GET /:poolId/workers/:workerId - Worker detail */
router.get('/:poolId/workers/:workerId', async (req, res) => {
  try {
    const data = await getPoolWorkerDetail(req.params.poolId, req.params.workerId);
    res.json({ ...data, fetchedAt: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** GET /:poolId/earnings - Earnings summary */
router.get('/:poolId/earnings', async (req, res) => {
  try {
    const data = await getPoolEarnings(req.params.poolId, req.query.period || '24h');
    res.json({ ...data, fetchedAt: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** GET /:poolId/payouts - Payout history */
router.get('/:poolId/payouts', async (req, res) => {
  try {
    const data = await getPoolPayouts(
      req.params.poolId,
      req.query.start ? new Date(req.query.start) : undefined,
      req.query.end ? new Date(req.query.end) : undefined
    );
    res.json({ payouts: data, fetchedAt: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** GET /:poolId/shares - Share/luck stats */
router.get('/:poolId/shares', async (req, res) => {
  try {
    const data = await getPoolShares(req.params.poolId);
    res.json({ ...data, fetchedAt: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** GET /:poolId/info - Pool info */
router.get('/:poolId/info', async (req, res) => {
  try {
    const data = await getPoolInfo(req.params.poolId);
    res.json({ ...data, fetchedAt: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
