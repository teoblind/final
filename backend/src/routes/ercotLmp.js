/**
 * ERCOT LMP Routes - Real Parquet Data
 *
 * Serves ERCOT settlement point price data from local Parquet files
 * via DuckDB. Replaces mock data with 200M+ rows of real 5-min data.
 */

import express from 'express';
import {
  getCurrentLmp,
  getIntraday,
  getHeatmap,
  getStats,
  getNodes,
  getDataRange,
  getHistoricalIntraday,
} from '../services/ercotLmpService.js';

const router = express.Router();

/**
 * GET /current - Most recent 5-min LMP for a node
 * Query: ?node=HB_NORTH
 */
router.get('/current', async (req, res) => {
  try {
    const node = req.query.node || 'HB_NORTH';
    const data = await getCurrentLmp(node);
    if (!data) {
      return res.status(404).json({ error: `No data found for node: ${node}` });
    }
    res.json({ ...data, source: 'ERCOT Parquet (DuckDB)', isMock: false });
  } catch (error) {
    console.error('ERCOT LMP /current error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /intraday - All 5-min intervals for a date
 * Query: ?node=HB_NORTH&date=2026-03-05
 */
router.get('/intraday', async (req, res) => {
  try {
    const node = req.query.node || 'HB_NORTH';
    const date = req.query.date || null;
    const days = parseInt(req.query.days) || 0;

    let data, actualDate;
    if (days > 1) {
      data = await getHistoricalIntraday(node, days);
      actualDate = date || new Date().toISOString().split('T')[0];
    } else {
      const result = await getIntraday(node, date);
      data = result.intervals;
      actualDate = result.date;
    }

    res.json({
      node,
      date: actualDate,
      intervals: data.length,
      data,
      source: 'ERCOT Parquet (DuckDB)',
      isMock: false,
    });
  } catch (error) {
    console.error('ERCOT LMP /intraday error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /heatmap - Hourly average LMPs for heatmap
 * Query: ?node=HB_NORTH&days=7
 */
router.get('/heatmap', async (req, res) => {
  try {
    const node = req.query.node || 'HB_NORTH';
    const days = parseInt(req.query.days) || 7;
    const data = await getHeatmap(node, days);
    res.json({
      node,
      days,
      cells: data.length,
      data,
      source: 'ERCOT Parquet (DuckDB)',
      isMock: false,
    });
  } catch (error) {
    console.error('ERCOT LMP /heatmap error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /stats - Summary statistics for a node
 * Query: ?node=HB_NORTH&days=30
 */
router.get('/stats', async (req, res) => {
  try {
    const node = req.query.node || 'HB_NORTH';
    const days = parseInt(req.query.days) || 30;
    const data = await getStats(node, days);
    res.json({
      node,
      days,
      ...data,
      source: 'ERCOT Parquet (DuckDB)',
      isMock: false,
    });
  } catch (error) {
    console.error('ERCOT LMP /stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /nodes - List settlement points with current LMP
 * Query: ?filter=hubs|load_zones
 */
router.get('/nodes', async (req, res) => {
  try {
    const filter = req.query.filter || null;
    const data = await getNodes(filter);
    res.json({
      count: data.length,
      filter,
      data,
      source: 'ERCOT Parquet (DuckDB)',
      isMock: false,
    });
  } catch (error) {
    console.error('ERCOT LMP /nodes error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /range - Available data range
 */
router.get('/range', async (req, res) => {
  try {
    const data = await getDataRange();
    res.json({ ...data, source: 'ERCOT Parquet (DuckDB)' });
  } catch (error) {
    console.error('ERCOT LMP /range error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
