/**
 * GPU Model Database & Fleet Config Routes - Phase 7
 *
 * API endpoints for querying the GPU accelerator database,
 * managing GPU fleet configurations, and retrieving GPU spot pricing.
 */

import express from 'express';
import {
  getGpuModels,
  getGpuModel,
  getGpuModelsByManufacturer,
  calculateGpuFleetMetrics,
} from '../services/gpuDatabase.js';
import {
  getGpuFleetConfig,
  saveGpuFleetConfig,
  getLatestGpuSpotPrices,
  getGpuSpotPrices,
} from '../cache/database.js';

const router = express.Router();

// ─── GPU Model Database ─────────────────────────────────────────────────────

/**
 * GET /models - List all GPU models in the database
 */
router.get('/models', (req, res) => {
  try {
    const { manufacturer } = req.query;
    if (manufacturer) {
      const models = getGpuModelsByManufacturer(manufacturer);
      return res.json({ models });
    }
    const models = getGpuModels();
    res.json({ models });
  } catch (error) {
    console.error('Error fetching GPU models:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /models/:id - Get a single GPU model by ID
 */
router.get('/models/:id', (req, res) => {
  try {
    const model = getGpuModel(req.params.id);
    if (!model) {
      return res.status(404).json({ error: `GPU model not found: ${req.params.id}` });
    }
    res.json({ model });
  } catch (error) {
    console.error('Error fetching GPU model:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── GPU Fleet Configuration ────────────────────────────────────────────────

/**
 * GET /fleet - Get saved GPU fleet configuration
 */
router.get('/fleet', (req, res) => {
  try {
    const config = getGpuFleetConfig();
    if (!config) {
      return res.json({
        entries: [],
        totalGPUs: 0,
        totalPowerMW: 0,
        totalMemoryTB: 0,
      });
    }
    res.json(config);
  } catch (error) {
    console.error('Error fetching GPU fleet config:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /fleet - Save GPU fleet configuration
 * Body: { entries: [{ gpuModelId, quantity, gpusPerServer, serverOverheadWatts, pue }] }
 */
router.post('/fleet', (req, res) => {
  try {
    const { entries } = req.body;

    if (!entries || !Array.isArray(entries)) {
      return res.status(400).json({ error: 'entries array is required' });
    }

    // Validate each entry references a known GPU model
    for (const entry of entries) {
      if (!entry.gpuModelId) {
        return res.status(400).json({ error: 'Each entry requires a gpuModelId' });
      }
      const model = getGpuModel(entry.gpuModelId);
      if (!model) {
        return res.status(400).json({ error: `Unknown GPU model: ${entry.gpuModelId}` });
      }
    }

    // Calculate fleet metrics
    const metrics = calculateGpuFleetMetrics(entries);

    // Build config object and save
    const config = {
      entries,
      ...metrics,
      updatedAt: new Date().toISOString(),
    };
    saveGpuFleetConfig(config);

    res.json({ success: true, metrics });
  } catch (error) {
    console.error('Error saving GPU fleet config:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── GPU Spot Pricing ───────────────────────────────────────────────────────

/**
 * GET /pricing/:model - Get latest spot prices for a GPU model
 */
router.get('/pricing/:model', (req, res) => {
  try {
    const model = req.params.model;
    const latestPrices = getLatestGpuSpotPrices();

    // Filter to the requested model
    const prices = latestPrices.filter(p => p.gpu_model === model);

    res.json({
      model,
      prices,
    });
  } catch (error) {
    console.error('Error fetching GPU spot prices:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /pricing/:model/history - Get historical spot prices for a GPU model
 * Query params: ?days=7
 */
router.get('/pricing/:model/history', (req, res) => {
  try {
    const model = req.params.model;
    const days = parseInt(req.query.days) || 7;

    const history = getGpuSpotPrices(model, days);

    res.json({
      model,
      history,
    });
  } catch (error) {
    console.error('Error fetching GPU price history:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
