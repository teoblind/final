/**
 * On-Chain Data Routes - Phase 5
 *
 * Mempool, blocks, fees, fee history, and network health endpoints.
 * Data sourced from Mempool.space API with fallback to mock data.
 */
import express from 'express';
import {
  getMempool,
  getMempoolHistory,
  getLatestBlocks,
  getBlockByHeight,
  getFeeEstimates,
  getFeeHistory,
  getNetworkHealth,
  getFeeRevenuePercent,
} from '../services/chainConnector.js';

const router = express.Router();

/** GET /mempool - Current mempool state */
router.get('/mempool', async (req, res) => {
  try {
    const mempool = await getMempool();
    res.json({ mempool, fetchedAt: new Date().toISOString() });
  } catch (error) {
    console.error('Error getting mempool:', error);
    res.status(500).json({ error: error.message });
  }
});

/** GET /mempool/history - Mempool history */
router.get('/mempool/history', async (req, res) => {
  try {
    const hours = parseInt(req.query.hours) || 24;
    const history = await getMempoolHistory(hours);
    res.json({ history, hours, fetchedAt: new Date().toISOString() });
  } catch (error) {
    console.error('Error getting mempool history:', error);
    res.status(500).json({ error: error.message });
  }
});

/** GET /blocks - Recent blocks */
router.get('/blocks', async (req, res) => {
  try {
    const count = parseInt(req.query.count) || 10;
    const blocks = await getLatestBlocks(count);
    res.json({ blocks, fetchedAt: new Date().toISOString() });
  } catch (error) {
    console.error('Error getting blocks:', error);
    res.status(500).json({ error: error.message });
  }
});

/** GET /blocks/:height - Block detail */
router.get('/blocks/:height', async (req, res) => {
  try {
    const height = parseInt(req.params.height);
    if (isNaN(height)) {
      return res.status(400).json({ error: 'Invalid block height' });
    }
    const block = await getBlockByHeight(height);
    res.json({ block, fetchedAt: new Date().toISOString() });
  } catch (error) {
    console.error('Error getting block:', error);
    res.status(500).json({ error: error.message });
  }
});

/** GET /fees - Current fee estimates */
router.get('/fees', async (req, res) => {
  try {
    const fees = await getFeeEstimates();
    // Add fee revenue % of block reward
    const feeRevenue = await getFeeRevenuePercent();
    res.json({
      fees: {
        ...fees,
        feeRevenuePercent: feeRevenue.feeRevenuePercent,
        feeRevenueTrend: feeRevenue.trend,
      },
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error getting fees:', error);
    res.status(500).json({ error: error.message });
  }
});

/** GET /fees/history - Fee history */
router.get('/fees/history', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const history = await getFeeHistory(days);
    res.json({ history, days, fetchedAt: new Date().toISOString() });
  } catch (error) {
    console.error('Error getting fee history:', error);
    res.status(500).json({ error: error.message });
  }
});

/** GET /health - Network health metrics */
router.get('/health', async (req, res) => {
  try {
    const health = await getNetworkHealth();
    res.json({ health, fetchedAt: new Date().toISOString() });
  } catch (error) {
    console.error('Error getting network health:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
