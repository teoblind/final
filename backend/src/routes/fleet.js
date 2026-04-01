/**
 * Fleet Hashprice Routes - Phase 3
 *
 * Endpoints for fleet configuration, profitability calculations,
 * scenario simulation, snapshots, and hashprice alerts.
 */

import express from 'express';
import axios from 'axios';
import { getCache, setCache } from '../cache/database.js';
import {
  getFleetConfig, saveFleetConfig,
  insertFleetSnapshot, getFleetSnapshots,
} from '../cache/database.js';
import { ASIC_DATABASE, getAsicModel, getAsicsByManufacturer } from '../services/asicDatabase.js';
import {
  fetchNetworkData,
  calculateNetworkHashprice,
  calculateMachineHashprice,
  calculateFleetHashprice,
  getBreakevenHashprice,
  projectHashprice,
  simulateScenario,
} from '../services/hashpriceEngine.js';

const router = express.Router();

// ─── ASIC Database ──────────────────────────────────────────────────────────

/**
 * GET /asics - List all ASIC models from built-in database
 */
router.get('/asics', (req, res) => {
  const { groupBy } = req.query;
  if (groupBy === 'manufacturer') {
    return res.json({ models: getAsicsByManufacturer(), source: 'Built-in ASIC Database' });
  }
  res.json({ models: ASIC_DATABASE, source: 'Built-in ASIC Database' });
});

// ─── Fleet Configuration ────────────────────────────────────────────────────

/**
 * GET /config - Get saved fleet configuration
 */
router.get('/config', (req, res) => {
  try {
    const config = getFleetConfig();
    res.json({
      config: config || { entries: [], defaultEnergyCostKWh: 0.05 },
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error getting fleet config:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /config - Save fleet configuration
 */
router.post('/config', (req, res) => {
  try {
    const config = req.body;

    // Validate fleet entries
    if (config.entries && Array.isArray(config.entries)) {
      for (const entry of config.entries) {
        if (!entry.asicModel || !entry.quantity || entry.quantity < 0) {
          return res.status(400).json({ error: 'Each fleet entry requires asicModel and a positive quantity' });
        }
        // Resolve model from database if only ID provided
        if (typeof entry.asicModel === 'string') {
          const model = getAsicModel(entry.asicModel);
          if (!model) {
            return res.status(400).json({ error: `Unknown ASIC model ID: ${entry.asicModel}` });
          }
          entry.asicModel = model;
        }
        // Compute derived efficiency if not present
        if (!entry.asicModel.efficiency && entry.asicModel.powerConsumption && entry.asicModel.hashrate) {
          entry.asicModel.efficiency = entry.asicModel.powerConsumption / entry.asicModel.hashrate;
        }
      }
    }

    saveFleetConfig(config);
    res.json({ success: true, config });
  } catch (error) {
    console.error('Error saving fleet config:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── Network Data ───────────────────────────────────────────────────────────

/**
 * GET /network - Get current network data (hashrate, difficulty, fees, mempool)
 */
router.get('/network', async (req, res) => {
  try {
    const networkData = await fetchNetworkData();
    const networkHashprice = calculateNetworkHashprice(networkData);

    res.json({
      network: networkData,
      hashprice: networkHashprice,
      fetchedAt: networkData.timestamp,
      cached: networkData.cached || false,
      stale: networkData.stale || false,
      source: networkData.source,
      isMock: networkData.isMock || false,
    });
  } catch (error) {
    console.error('Error fetching network data:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── Fleet Profitability ────────────────────────────────────────────────────

/**
 * GET /profitability - Calculate current fleet profitability
 * Query params: ?node=HB_NORTH (optional, for live ERCOT pricing)
 */
router.get('/profitability', async (req, res) => {
  const cacheKey = 'fleet-profitability';

  try {
    const config = getFleetConfig();
    if (!config || !config.entries || config.entries.length === 0) {
      return res.json({
        hasFleet: false,
        message: 'No fleet configured. Go to Settings > Fleet Configuration to add your machines.',
        fetchedAt: new Date().toISOString(),
      });
    }

    // Fetch network data and ERCOT prices
    const networkData = await fetchNetworkData();
    const networkHashprice = calculateNetworkHashprice(networkData);

    // Get live ERCOT node prices if available
    let nodePrices = {};
    try {
      const energyCache = getCache('energy-realtime-prices');
      if (energyCache && energyCache.data) {
        nodePrices = energyCache.data;
      }
    } catch (e) { /* No energy data available - that's fine */ }

    const defaultEnergyCost = config.defaultEnergyCostKWh || 0.05;
    const fleetResult = calculateFleetHashprice(config.entries, defaultEnergyCost, networkHashprice, nodePrices);

    // Compute fleet-level breakeven hashprice (weighted)
    let totalBreakevenWeighted = 0;
    let totalHashrateForBE = 0;
    for (const entry of config.entries) {
      const specs = entry.overclockProfile ? {
        ...entry.asicModel,
        hashrate: entry.overclockProfile.hashrate,
        powerConsumption: entry.overclockProfile.powerConsumption,
      } : entry.asicModel;
      let energyCost = defaultEnergyCost;
      if (entry.energyNode && nodePrices[entry.energyNode] !== undefined) {
        energyCost = nodePrices[entry.energyNode] / 1000;
      }
      const beHP = getBreakevenHashprice(specs, energyCost);
      totalBreakevenWeighted += beHP * specs.hashrate * entry.quantity;
      totalHashrateForBE += specs.hashrate * entry.quantity;
    }
    const fleetBreakevenHashprice = totalHashrateForBE > 0 ? totalBreakevenWeighted / totalHashrateForBE : 0;

    const result = {
      hasFleet: true,
      networkHashprice,
      fleet: fleetResult,
      fleetBreakevenHashprice,
      defaultEnergyCostKWh: defaultEnergyCost,
      nodePricesUsed: nodePrices,
      fetchedAt: networkData.timestamp,
      cached: networkData.cached || false,
      source: networkData.source,
      isMock: networkData.isMock || false,
    };

    res.json(result);

  } catch (error) {
    console.error('Error calculating fleet profitability:', error);
    const cached = getCache(cacheKey);
    if (cached) {
      return res.json({ ...cached.data, cached: true, stale: true });
    }
    res.status(500).json({ error: error.message });
  }
});

// ─── Machine-Level Breakeven ────────────────────────────────────────────────

/**
 * GET /breakeven - Calculate breakeven electricity for all fleet models
 */
router.get('/breakeven', async (req, res) => {
  try {
    const config = getFleetConfig();
    const networkData = await fetchNetworkData();
    const networkHashprice = calculateNetworkHashprice(networkData);

    const defaultEnergyCost = config?.defaultEnergyCostKWh || 0.05;

    // Calculate breakeven for fleet models, or all models if no fleet
    const models = (config && config.entries && config.entries.length > 0)
      ? config.entries.map(e => e.asicModel)
      : ASIC_DATABASE;

    // Deduplicate by model id
    const seen = new Set();
    const uniqueModels = models.filter(m => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });

    const breakevens = uniqueModels.map(model => ({
      model: { id: model.id, model: model.model, manufacturer: model.manufacturer, efficiency: model.efficiency, hashrate: model.hashrate, powerConsumption: model.powerConsumption },
      breakEvenElectricity: calculateMachineHashprice(model, 0, networkHashprice).breakEvenElectricity,
      breakEvenHashprice: getBreakevenHashprice(model, defaultEnergyCost),
      currentEnergyCost: defaultEnergyCost,
      isProfitableAtCurrentCost: calculateMachineHashprice(model, defaultEnergyCost, networkHashprice).isProfitable,
    })).sort((a, b) => b.breakEvenElectricity - a.breakEvenElectricity);

    res.json({
      breakevens,
      currentEnergyCostKWh: defaultEnergyCost,
      networkHashprice,
      fetchedAt: networkData.timestamp,
      source: networkData.source,
      isMock: networkData.isMock || false,
    });
  } catch (error) {
    console.error('Error calculating breakeven:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── Difficulty Adjustment ──────────────────────────────────────────────────

/**
 * GET /difficulty - Get difficulty adjustment info with fleet impact
 */
router.get('/difficulty', async (req, res) => {
  try {
    const networkData = await fetchNetworkData();
    const networkHashprice = calculateNetworkHashprice(networkData);
    const config = getFleetConfig();
    const defaultEnergyCost = config?.defaultEnergyCostKWh || 0.05;

    // Estimate difficulty adjustment from block timing
    // More sophisticated: compare actual block interval vs expected 10 min
    const currentHP = networkHashprice.hashprice;

    // Project post-adjustment hashprice at estimated new difficulty
    const estAdjPct = networkData.estimatedAdjustmentPercent || 3.2; // fallback to mock
    const postAdjHP = projectHashprice(networkData, { difficultyMultiplier: 1 + (estAdjPct / 100) });

    // Fleet impact analysis
    let fleetImpact = null;
    if (config && config.entries && config.entries.length > 0) {
      const currentFleet = calculateFleetHashprice(config.entries, defaultEnergyCost, networkHashprice);
      const postAdjFleet = calculateFleetHashprice(config.entries, defaultEnergyCost, postAdjHP);

      // Find machines at risk (profitable now, unprofitable after adjustment)
      const atRiskModels = [];
      for (let i = 0; i < currentFleet.revenueByModel.length; i++) {
        const current = currentFleet.revenueByModel[i];
        const projected = postAdjFleet.revenueByModel[i];
        if (current.isProfitable && !projected.isProfitable) {
          atRiskModels.push({
            model: current.model.model,
            quantity: current.quantity,
            currentNet: current.netRevenue,
            projectedNet: projected.netRevenue,
          });
        }
      }

      fleetImpact = {
        currentNetRevenue: currentFleet.totalNetRevenue,
        projectedNetRevenue: postAdjFleet.totalNetRevenue,
        revenueChange: postAdjFleet.totalNetRevenue - currentFleet.totalNetRevenue,
        revenueChangePct: currentFleet.totalNetRevenue !== 0
          ? ((postAdjFleet.totalNetRevenue - currentFleet.totalNetRevenue) / Math.abs(currentFleet.totalNetRevenue)) * 100
          : 0,
        atRiskModels,
        currentProfitable: currentFleet.profitableMachines,
        projectedProfitable: postAdjFleet.profitableMachines,
      };
    }

    res.json({
      currentDifficulty: networkData.difficulty,
      estimatedNextDifficulty: networkData.estimatedNextDifficulty || networkData.difficulty * (1 + estAdjPct / 100),
      estimatedAdjustmentPercent: estAdjPct,
      blocksUntilAdjustment: networkData.blocksUntilAdjustment,
      estimatedDaysUntilAdjustment: networkData.estimatedDaysUntilAdjustment,
      blockHeight: networkData.blockHeight,
      currentHashprice: currentHP,
      projectedHashprice: postAdjHP.hashprice,
      hashpriceChange: postAdjHP.hashprice - currentHP,
      hashpriceChangePct: currentHP > 0 ? ((postAdjHP.hashprice - currentHP) / currentHP) * 100 : 0,
      fleetImpact,
      fetchedAt: networkData.timestamp,
      source: networkData.source,
      isMock: networkData.isMock || false,
    });
  } catch (error) {
    console.error('Error fetching difficulty data:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── Scenario Simulation ────────────────────────────────────────────────────

/**
 * POST /simulate - Run a scenario simulation
 */
router.post('/simulate', async (req, res) => {
  try {
    const scenarioParams = req.body;
    const config = getFleetConfig();
    if (!config || !config.entries || config.entries.length === 0) {
      return res.status(400).json({ error: 'No fleet configured' });
    }

    const networkData = await fetchNetworkData();
    const defaultEnergyCost = config.defaultEnergyCostKWh || 0.05;

    const result = simulateScenario(config.entries, defaultEnergyCost, networkData, scenarioParams);

    res.json({
      ...result,
      fetchedAt: new Date().toISOString(),
      source: networkData.source,
    });
  } catch (error) {
    console.error('Error running simulation:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── Hashprice History / Trend ──────────────────────────────────────────────

/**
 * GET /history - Get hashprice history with projections
 * Query params: ?period=30d (default 90d)
 */
router.get('/history', async (req, res) => {
  const cacheKey = 'fleet-hashprice-history';

  try {
    const cached = getCache(cacheKey);
    if (cached && !cached.stale) {
      return res.json({ ...cached.data, cached: true, fetchedAt: cached.fetchedAt });
    }

    // Fetch from CoinGecko + Blockchain.info (same sources as existing hashprice route)
    const [priceHistory, hashHistory] = await Promise.all([
      axios.get('https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=365', { timeout: 15000 }),
      axios.get('https://api.blockchain.info/charts/hash-rate?timespan=1year&format=json', { timeout: 15000 }),
    ]);

    const priceMap = new Map();
    priceHistory.data.prices.forEach(([timestamp, price]) => {
      const date = new Date(timestamp).toISOString().split('T')[0];
      priceMap.set(date, price);
    });

    const history = hashHistory.data.values.map(point => {
      const date = new Date(point.x * 1000).toISOString().split('T')[0];
      const hashrateTH = point.y / 1e3; // GH/s → TH/s
      const hashrateEH = point.y / 1e9;
      const price = priceMap.get(date);
      if (!price || !hashrateTH) return null;

      const hashprice = (144 * (3.125 + 0.5) * price) / hashrateTH;
      if (!hashprice || isNaN(hashprice) || hashprice > 1) return null;

      return { date, hashprice, hashrate: hashrateEH, btcPrice: price };
    }).filter(Boolean);

    const result = {
      history,
      source: 'CoinGecko + Blockchain.info',
      isMock: false,
    };

    setCache(cacheKey, result, 30);
    res.json({ ...result, cached: false, fetchedAt: new Date().toISOString() });

  } catch (error) {
    console.error('Error fetching hashprice history:', error);
    const cached = getCache(cacheKey);
    if (cached) {
      return res.json({ ...cached.data, cached: true, stale: true, fetchedAt: cached.fetchedAt });
    }
    res.status(500).json({ error: error.message });
  }
});

// ─── Fleet Snapshots ────────────────────────────────────────────────────────

/**
 * POST /snapshot - Save a fleet profitability snapshot
 */
router.post('/snapshot', async (req, res) => {
  try {
    const config = getFleetConfig();
    if (!config || !config.entries || config.entries.length === 0) {
      return res.status(400).json({ error: 'No fleet configured' });
    }

    const networkData = await fetchNetworkData();
    const networkHashprice = calculateNetworkHashprice(networkData);
    const defaultEnergyCost = config.defaultEnergyCostKWh || 0.05;
    const fleetResult = calculateFleetHashprice(config.entries, defaultEnergyCost, networkHashprice);

    const snapshotId = insertFleetSnapshot({
      timestamp: new Date().toISOString(),
      btcPrice: networkData.btcPrice,
      networkHashrate: networkData.networkHashrateEH,
      difficulty: networkData.difficulty,
      hashprice: networkHashprice.hashprice,
      fleetGrossRevenue: fleetResult.totalGrossRevenue,
      fleetElectricityCost: fleetResult.totalElectricityCost,
      fleetNetRevenue: fleetResult.totalNetRevenue,
      fleetProfitMargin: fleetResult.profitMargin,
      profitableMachines: fleetResult.profitableMachines,
      unprofitableMachines: fleetResult.unprofitableMachines,
      totalHashrate: fleetResult.totalHashrate,
      energyCostKwh: defaultEnergyCost,
      snapshotJson: JSON.stringify(fleetResult),
    }, fleetResult.revenueByModel);

    res.json({ success: true, snapshotId, fetchedAt: new Date().toISOString() });
  } catch (error) {
    console.error('Error saving snapshot:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /snapshots - Get historical fleet snapshots
 * Query params: ?days=30 (default 30)
 */
router.get('/snapshots', (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const snapshots = getFleetSnapshots(days);
    res.json({ snapshots, fetchedAt: new Date().toISOString() });
  } catch (error) {
    console.error('Error fetching snapshots:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── Export ─────────────────────────────────────────────────────────────────

/**
 * GET /export - Export fleet profitability data
 * Query params: ?format=csv|json (default json)
 */
router.get('/export', async (req, res) => {
  try {
    const format = req.query.format || 'json';
    const config = getFleetConfig();
    if (!config || !config.entries || config.entries.length === 0) {
      return res.status(400).json({ error: 'No fleet configured' });
    }

    const networkData = await fetchNetworkData();
    const networkHashprice = calculateNetworkHashprice(networkData);
    const defaultEnergyCost = config.defaultEnergyCostKWh || 0.05;
    const fleetResult = calculateFleetHashprice(config.entries, defaultEnergyCost, networkHashprice);

    if (format === 'csv') {
      const headers = 'Model,Manufacturer,Quantity,Hashrate (TH/s),Power (W),Efficiency (J/TH),Gross Revenue ($/day),Electricity Cost ($/day),Net Revenue ($/day),Profit Margin (%),Breakeven ($/kWh),Profitable';
      const rows = fleetResult.revenueByModel.map(r => [
        r.model.model,
        r.model.manufacturer,
        r.quantity,
        r.model.hashrate,
        r.model.powerConsumption,
        r.model.efficiency.toFixed(1),
        (r.grossRevenue * r.quantity).toFixed(2),
        (r.electricityCost * r.quantity).toFixed(2),
        (r.netRevenue * r.quantity).toFixed(2),
        r.profitMargin.toFixed(1),
        r.breakEvenElectricity.toFixed(4),
        r.isProfitable ? 'Yes' : 'No',
      ].join(','));

      const csv = [headers, ...rows].join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=fleet-profitability-${new Date().toISOString().split('T')[0]}.csv`);
      return res.send(csv);
    }

    // JSON export
    res.json({
      exportedAt: new Date().toISOString(),
      btcPrice: networkData.btcPrice,
      networkHashprice: networkHashprice.hashprice,
      defaultEnergyCostKWh: defaultEnergyCost,
      fleet: fleetResult,
    });
  } catch (error) {
    console.error('Error exporting fleet data:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── Hashprice Alerts ───────────────────────────────────────────────────────

/**
 * GET /alerts - Evaluate hashprice-specific alert conditions
 */
router.get('/alerts', async (req, res) => {
  try {
    const config = getFleetConfig();
    const networkData = await fetchNetworkData();
    const networkHashprice = calculateNetworkHashprice(networkData);
    const defaultEnergyCost = config?.defaultEnergyCostKWh || 0.05;

    const alerts = [];

    // Alert: low hashprice
    const thresholds = config?.alertThresholds || {};
    if (thresholds.hashpriceMin && networkHashprice.hashprice < thresholds.hashpriceMin) {
      alerts.push({
        type: 'hashprice_drop',
        severity: 'warning',
        message: `Network hashprice ($${networkHashprice.hashprice.toFixed(4)}/TH/s/day) is below threshold ($${thresholds.hashpriceMin.toFixed(4)})`,
        value: networkHashprice.hashprice,
        threshold: thresholds.hashpriceMin,
      });
    }

    // Alert: fleet margin
    if (config && config.entries && config.entries.length > 0) {
      const fleetResult = calculateFleetHashprice(config.entries, defaultEnergyCost, networkHashprice);

      if (thresholds.fleetMarginMin && fleetResult.profitMargin < thresholds.fleetMarginMin) {
        alerts.push({
          type: 'fleet_margin',
          severity: 'warning',
          message: `Fleet profit margin (${fleetResult.profitMargin.toFixed(1)}%) is below threshold (${thresholds.fleetMarginMin}%)`,
          value: fleetResult.profitMargin,
          threshold: thresholds.fleetMarginMin,
        });
      }

      // Alert: unprofitable machines
      const unprofitableModels = fleetResult.revenueByModel.filter(r => !r.isProfitable);
      if (unprofitableModels.length > 0) {
        for (const m of unprofitableModels) {
          alerts.push({
            type: 'machine_unprofitable',
            severity: 'critical',
            message: `${m.model.model} (${m.quantity} units) is unprofitable at current conditions`,
            model: m.model.model,
            netRevenue: m.netRevenue,
            quantity: m.quantity,
          });
        }
      }

      // Alert: breakeven proximity
      if (thresholds.breakevenProximityPct) {
        for (const entry of config.entries) {
          const beElec = calculateMachineHashprice(entry.asicModel, 0, networkHashprice).breakEvenElectricity;
          const proximity = ((beElec - defaultEnergyCost) / beElec) * 100;
          if (proximity < thresholds.breakevenProximityPct && proximity > 0) {
            alerts.push({
              type: 'breakeven_proximity',
              severity: 'warning',
              message: `${entry.asicModel.model} is within ${proximity.toFixed(1)}% of breakeven electricity ($${beElec.toFixed(4)}/kWh)`,
              model: entry.asicModel.model,
              breakEvenElectricity: beElec,
              currentElectricity: defaultEnergyCost,
            });
          }
        }
      }
    }

    // Alert: difficulty adjustment approaching
    if (networkData.blocksUntilAdjustment < 500) {
      alerts.push({
        type: 'difficulty_adjustment',
        severity: 'info',
        message: `Difficulty adjustment in ~${networkData.estimatedDaysUntilAdjustment.toFixed(1)} days (${networkData.blocksUntilAdjustment} blocks), estimated ${networkData.estimatedAdjustmentPercent > 0 ? '+' : ''}${networkData.estimatedAdjustmentPercent.toFixed(1)}%`,
        blocksRemaining: networkData.blocksUntilAdjustment,
        estimatedChange: networkData.estimatedAdjustmentPercent,
      });
    }

    res.json({
      alerts,
      totalAlerts: alerts.length,
      fetchedAt: networkData.timestamp,
      source: networkData.source,
    });
  } catch (error) {
    console.error('Error evaluating fleet alerts:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
