/**
 * Curtailment Routes — Phase 4
 *
 * API endpoints for the curtailment optimization engine.
 * Provides real-time recommendations, schedule generation,
 * performance tracking, backtesting, and event logging.
 */

import express from 'express';
import {
  getCurrentRecommendation,
  generateSchedule,
  analyzePerformance,
  runBacktest,
} from '../services/curtailmentEngine.js';
import {
  getCache,
  getFleetConfig, saveFleetConfig,
  getEnergyPrices,
  getCurtailmentEvents, insertCurtailmentEvent,
  acknowledgeCurtailmentEvent,
  getCurtailmentSettings, saveCurtailmentSettings,
  getCurtailmentPerformance, insertCurtailmentPerformance,
} from '../cache/database.js';

const router = express.Router();

// ─── Real-Time Recommendation ──────────────────────────────────────────────

/**
 * GET /recommendation — Get current curtailment recommendation
 * Query params: ?energyPrice=50 (optional override in $/MWh)
 */
router.get('/recommendation', async (req, res) => {
  try {
    const opts = {};
    if (req.query.energyPrice) {
      opts.energyPriceMWh = parseFloat(req.query.energyPrice);
    }

    const recommendation = await getCurrentRecommendation(opts);
    res.json(recommendation);
  } catch (error) {
    console.error('Error getting curtailment recommendation:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /schedule/generate — Force-regenerate the operating schedule
 * Same as /schedule but signals explicit regeneration intent
 */
router.get('/schedule/generate', async (req, res) => {
  try {
    const opts = {};
    if (req.query.node) opts.node = req.query.node;
    if (req.query.date) opts.date = req.query.date;

    const schedule = await generateSchedule(opts);
    res.json({ ...schedule, regenerated: true });
  } catch (error) {
    console.error('Error regenerating schedule:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── 24-Hour Schedule ──────────────────────────────────────────────────────

/**
 * GET /schedule — Generate 24-hour operating schedule
 * Query params: ?node=HB_NORTH&date=2025-01-15
 */
router.get('/schedule', async (req, res) => {
  try {
    const opts = {};
    if (req.query.node) opts.node = req.query.node;
    if (req.query.date) opts.date = req.query.date;

    const schedule = await generateSchedule(opts);
    res.json(schedule);
  } catch (error) {
    console.error('Error generating schedule:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── Performance Analytics ─────────────────────────────────────────────────

/**
 * GET /performance — Get curtailment performance metrics
 * Query params: ?days=30
 */
router.get('/performance', (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const events = getCurtailmentEvents(days);
    const performance = analyzePerformance(events, days);

    // Also get stored daily performance data
    const dailyPerf = getCurtailmentPerformance(days);

    res.json({
      ...performance,
      storedPerformance: dailyPerf,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error getting performance:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /savings — Cumulative savings breakdown
 * Query params: ?days=90
 */
router.get('/savings', (req, res) => {
  try {
    const days = parseInt(req.query.days) || 90;
    const events = getCurtailmentEvents(days);

    // Calculate cumulative savings
    let cumulative = 0;
    const savingsTimeline = [];
    const byType = {};

    const sorted = [...events].sort((a, b) =>
      (a.start_time || '').localeCompare(b.start_time || '')
    );

    for (const event of sorted) {
      const savings = event.estimated_savings || 0;
      cumulative += savings;

      const type = event.trigger_type || 'manual';
      byType[type] = (byType[type] || 0) + savings;

      savingsTimeline.push({
        date: event.start_time?.split('T')[0],
        savings,
        cumulative,
        type,
      });
    }

    // Group by day for chart
    const dailySavings = {};
    for (const item of savingsTimeline) {
      if (!dailySavings[item.date]) {
        dailySavings[item.date] = { date: item.date, savings: 0, events: 0 };
      }
      dailySavings[item.date].savings += item.savings;
      dailySavings[item.date].events += 1;
    }

    // Compute savings by source type
    const bySourceType = { avoided_losses: 0, demand_response: 0, spike_avoidance: 0 };
    for (const event of sorted) {
      const savings = event.estimated_savings || 0;
      const st = event.savings_type;
      if (st && bySourceType[st] !== undefined) {
        bySourceType[st] += savings;
      } else if ((event.energy_price_mwh || 0) > 100) {
        bySourceType.spike_avoidance += savings;
      } else if (event.trigger_type === 'demand_response') {
        bySourceType.demand_response += savings;
      } else {
        bySourceType.avoided_losses += savings;
      }
    }

    res.json({
      totalSavings: cumulative,
      totalEvents: events.length,
      byType,
      bySourceType,
      timeline: savingsTimeline,
      dailySavings: Object.values(dailySavings).sort((a, b) => a.date.localeCompare(b.date)),
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error getting savings:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── Backtesting ───────────────────────────────────────────────────────────

/**
 * POST /backtest — Run a curtailment backtest
 * Body: { startDate, endDate, strategy, params, node }
 */
router.post('/backtest', async (req, res) => {
  try {
    const { startDate, endDate, strategy, params, node } = req.body;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required' });
    }

    const config = getFleetConfig();
    if (!config || !config.entries || config.entries.length === 0) {
      return res.status(400).json({ error: 'No fleet configured for backtesting' });
    }

    // Get historical prices from DB
    const iso = 'ERCOT';
    const targetNode = node || 'HB_NORTH';
    const historicalPrices = getEnergyPrices(
      iso, targetNode,
      `${startDate}T00:00:00.000Z`,
      `${endDate}T23:59:59.999Z`,
      'realtime'
    );

    const result = await runBacktest(
      { startDate, endDate, strategy, params, node: targetNode },
      historicalPrices,
      config
    );

    res.json(result);
  } catch (error) {
    console.error('Error running backtest:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── Event Logging ─────────────────────────────────────────────────────────

/**
 * GET /events — Get curtailment event history
 * Query params: ?days=30&type=price_spike
 */
router.get('/events', (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const events = getCurtailmentEvents(days);

    // Optional type filter
    const typeFilter = req.query.type;
    const filtered = typeFilter
      ? events.filter(e => e.trigger_type === typeFilter)
      : events;

    res.json({
      events: filtered,
      total: filtered.length,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching events:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /events — Log a new curtailment event
 * Body: { triggerType, startTime, endTime, machineClasses, energyPriceMWh,
 *         estimatedSavings, reason, acknowledged }
 */
router.post('/events', (req, res) => {
  try {
    const {
      triggerType, startTime, endTime, machineClasses,
      energyPriceMWh, estimatedSavings, reason, acknowledged,
      hashrateOnline, hashrateCurtailed, machinesRunning,
      machinesCurtailed, powerOnlineMW, powerCurtailedMW, savingsType,
    } = req.body;

    if (!triggerType || !startTime) {
      return res.status(400).json({ error: 'triggerType and startTime are required' });
    }

    // Calculate duration
    let durationMinutes = null;
    if (startTime && endTime) {
      durationMinutes = Math.round(
        (new Date(endTime) - new Date(startTime)) / 60000
      );
    }

    const eventId = insertCurtailmentEvent({
      triggerType,
      startTime,
      endTime: endTime || null,
      durationMinutes,
      machineClasses: machineClasses ? JSON.stringify(machineClasses) : null,
      energyPriceMWh: energyPriceMWh || null,
      estimatedSavings: estimatedSavings || 0,
      reason: reason || null,
      acknowledged: acknowledged ? 1 : 0,
      hashrateOnline: hashrateOnline || null,
      hashrateCurtailed: hashrateCurtailed || null,
      machinesRunning: machinesRunning || null,
      machinesCurtailed: machinesCurtailed || null,
      powerOnlineMW: powerOnlineMW || null,
      powerCurtailedMW: powerCurtailedMW || null,
      savingsType: savingsType || null,
    });

    res.json({ success: true, eventId });
  } catch (error) {
    console.error('Error logging event:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /events/:id/acknowledge — Acknowledge a curtailment event
 */
router.put('/events/:id/acknowledge', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    acknowledgeCurtailmentEvent(id);
    res.json({ success: true, id });
  } catch (error) {
    console.error('Error acknowledging event:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── Constraints / Settings ────────────────────────────────────────────────

/**
 * GET /constraints — Get curtailment constraints
 */
router.get('/constraints', (req, res) => {
  try {
    const settings = getCurtailmentSettings() || getDefaultConstraints();
    res.json(settings);
  } catch (error) {
    console.error('Error getting constraints:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /constraints — Save curtailment constraints
 */
router.post('/constraints', (req, res) => {
  try {
    const constraints = req.body;
    saveCurtailmentSettings(constraints);

    // Also update fleet config with curtailment constraints
    const config = getFleetConfig();
    if (config) {
      config.curtailmentConstraints = constraints;
      saveFleetConfig(config);
    }

    res.json({ success: true, constraints });
  } catch (error) {
    console.error('Error saving constraints:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /constraints — Update curtailment constraints (same as POST)
 */
router.put('/constraints', (req, res) => {
  try {
    const constraints = req.body;
    saveCurtailmentSettings(constraints);

    const config = getFleetConfig();
    if (config) {
      config.curtailmentConstraints = constraints;
      saveFleetConfig(config);
    }

    res.json({ success: true, constraints });
  } catch (error) {
    console.error('Error saving constraints:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /alerts — Curtailment-specific alerts
 */
router.get('/alerts', async (req, res) => {
  try {
    const alerts = [];

    // Get current recommendation
    const rec = await getCurrentRecommendation();
    if (!rec.hasFleet) {
      return res.json({ alerts: [], fetchedAt: new Date().toISOString() });
    }

    // Alert: fleet in curtailment state
    if (rec.fleetState === 'CURTAILED') {
      alerts.push({
        type: 'full_curtailment',
        severity: 'critical',
        message: `Full fleet curtailment recommended — energy at $${rec.energyPrice.current.toFixed(2)}/MWh exceeds all machine breakevens`,
        fleetState: rec.fleetState,
      });
    } else if (rec.fleetState === 'PARTIAL') {
      const curtailed = rec.summary.curtailedMachines;
      alerts.push({
        type: 'partial_curtailment',
        severity: 'warning',
        message: `Partial curtailment recommended — ${curtailed} machines should be curtailed at current energy price`,
        curtailedMachines: curtailed,
        fleetState: rec.fleetState,
      });
    }

    // Alert: high savings opportunity (check per-day projection)
    const savingsPerDay = rec.summary.curtailmentSavingsPerDay || (rec.summary.curtailmentSavingsPerHr * 24) || 0;
    if (savingsPerDay > 100) {
      alerts.push({
        type: 'savings_opportunity',
        severity: 'info',
        message: `Curtailment could save $${savingsPerDay.toFixed(0)}/day at current conditions`,
        savings: savingsPerDay,
      });
    }

    res.json({
      alerts,
      totalAlerts: alerts.length,
      fetchedAt: rec.timestamp,
    });
  } catch (error) {
    console.error('Error checking curtailment alerts:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /efficiency — Fleet efficiency waterfall data
 * Returns machine classes ordered by efficiency with breakeven markers.
 */
router.get('/efficiency', async (req, res) => {
  try {
    const rec = await getCurrentRecommendation();
    if (!rec.hasFleet) {
      return res.json({ hasFleet: false });
    }

    // Sort decisions by efficiency (best to worst)
    const waterfall = rec.decisions
      .sort((a, b) => a.efficiency - b.efficiency) // best (lowest J/TH) first
      .map(d => ({
        model: d.model,
        efficiency: d.efficiency,
        quantity: d.quantity,
        powerMW: d.powerMW,
        hashrateTH: d.hashrateTH,
        action: d.action,
        breakevenMWh: d.breakevenMWh,
        margin: d.margin,
        netRevenuePerUnit: d.netRevenuePerUnit,
        currentPriceMWh: d.currentPriceMWh,
      }));

    res.json({
      hasFleet: true,
      waterfall,
      currentPriceMWh: rec.energyPrice.current,
      fleetState: rec.fleetState,
      fetchedAt: rec.timestamp,
    });
  } catch (error) {
    console.error('Error getting efficiency data:', error);
    res.status(500).json({ error: error.message });
  }
});

function getDefaultConstraints() {
  return {
    minCurtailmentMinutes: 30,
    minRunDurationMinutes: 30,
    rampUpMinutes: 15,
    demandResponseEnabled: false,
    demandResponsePaymentRate: 0,
    demandResponsePrograms: [],
    minimumTakePercent: 0,
    maxCurtailmentPercent: 100,
    hysteresisBandMWh: 2,
    curtailmentMode: 'copilot',
    alwaysMineBelow: null,
    alwaysCurtailAbove: null,
    poolMinHashrateTH: null,
    autoSchedule: false,
  };
}

export default router;
