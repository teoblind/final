import express from 'express';
import {
  getCache, setCache,
  getEnergyPrices, insertEnergyPrices,
  getSystemLoad, insertSystemLoad,
  getGridEvents, insertGridEvent,
  getEnergySettings, saveEnergySettings
} from '../cache/database.js';
import { fetchErcotData, fetchErcotDayAhead, fetchErcotSystemLoad, fetchErcotFuelMix } from '../services/ercotService.js';

const router = express.Router();

// =============================================================================
// ERCOT Settlement Points (key nodes for Bitcoin mining operations)
// =============================================================================
const ERCOT_NODES = [
  'HB_NORTH', 'HB_SOUTH', 'HB_WEST', 'HB_HOUSTON', 'HB_PAN', 'HB_BUSAVG',
  'LZ_NORTH', 'LZ_SOUTH', 'LZ_WEST', 'LZ_HOUSTON', 'LZ_AEN', 'LZ_CPS', 'LZ_RAYBN', 'LZ_LCRA'
];

// =============================================================================
// GET /api/energy/nodes - Available settlement points
// =============================================================================
router.get('/nodes', (req, res) => {
  const iso = req.query.iso || 'ERCOT';
  if (iso === 'ERCOT') {
    return res.json({ iso: 'ERCOT', nodes: ERCOT_NODES });
  }
  res.json({ iso, nodes: [], message: `${iso} connector not yet implemented` });
});

// =============================================================================
// GET /api/energy/realtime - Current real-time LMP
// =============================================================================
router.get('/realtime', async (req, res) => {
  const node = req.query.node || 'HB_NORTH';
  const iso = req.query.iso || 'ERCOT';
  const cacheKey = `energy-rt-${iso}-${node}`;

  try {
    const cached = getCache(cacheKey);
    if (cached && !cached.stale) {
      return res.json({ ...cached.data, cached: true, fetchedAt: cached.fetchedAt });
    }

    const data = await fetchErcotData(node);

    // Persist to historical storage
    if (data.realTimePrice && !data.isMock) {
      insertEnergyPrices([{
        iso, node,
        timestamp: data.timestamp,
        market_type: 'realtime',
        lmp: data.realTimePrice.lmp,
        energy_component: data.realTimePrice.energyComponent,
        congestion_component: data.realTimePrice.congestionComponent,
        loss_component: data.realTimePrice.lossComponent
      }]);
    }

    // Compute averages from historical data
    const now = new Date();
    const h24 = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const d7 = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const d30 = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

    const hist24 = getEnergyPrices(iso, node, h24, now.toISOString(), 'realtime');
    const hist7 = getEnergyPrices(iso, node, d7, now.toISOString(), 'realtime');
    const hist30 = getEnergyPrices(iso, node, d30, now.toISOString(), 'realtime');

    const avg = (arr) => arr.length > 0 ? arr.reduce((s, r) => s + r.lmp, 0) / arr.length : null;

    const result = {
      ...data,
      iso,
      node,
      averages: {
        avg24h: avg(hist24),
        avg7d: avg(hist7),
        avg30d: avg(hist30)
      },
      source: data.source || 'ERCOT',
      isMock: data.isMock || false
    };

    setCache(cacheKey, result, 5); // 5 min TTL

    res.json({ ...result, cached: false, fetchedAt: new Date().toISOString() });
  } catch (error) {
    console.error('Error fetching energy realtime:', error);
    const cached = getCache(cacheKey);
    if (cached) {
      return res.json({ ...cached.data, cached: true, stale: true, fetchedAt: cached.fetchedAt });
    }
    res.status(500).json({ error: error.message });
  }
});

// =============================================================================
// GET /api/energy/dayahead - Day-ahead market prices
// =============================================================================
router.get('/dayahead', async (req, res) => {
  const node = req.query.node || 'HB_NORTH';
  const iso = req.query.iso || 'ERCOT';
  const date = req.query.date; // YYYY-MM-DD, defaults to tomorrow
  const cacheKey = `energy-da-${iso}-${node}-${date || 'tomorrow'}`;

  try {
    const cached = getCache(cacheKey);
    if (cached && !cached.stale) {
      return res.json({ ...cached.data, cached: true, fetchedAt: cached.fetchedAt });
    }

    const data = await fetchErcotDayAhead(node, date);

    // Persist DA prices
    if (data.dayAheadPrices && !data.isMock) {
      const targetDate = date || new Date(Date.now() + 86400000).toISOString().split('T')[0];
      const records = data.dayAheadPrices.map(h => ({
        iso, node,
        timestamp: `${targetDate}T${String(h.hour).padStart(2, '0')}:00:00.000Z`,
        market_type: 'dayahead',
        lmp: h.lmp,
        energy_component: h.energyComponent || null,
        congestion_component: h.congestionComponent || null,
        loss_component: h.lossComponent || null
      }));
      insertEnergyPrices(records);
    }

    const result = { ...data, iso, node };
    setCache(cacheKey, result, 60); // 1 hr TTL (DAM published once daily)

    res.json({ ...result, cached: false, fetchedAt: new Date().toISOString() });
  } catch (error) {
    console.error('Error fetching day-ahead:', error);
    const cached = getCache(cacheKey);
    if (cached) {
      return res.json({ ...cached.data, cached: true, stale: true, fetchedAt: cached.fetchedAt });
    }
    res.status(500).json({ error: error.message });
  }
});

// =============================================================================
// GET /api/energy/history - Historical price data
// =============================================================================
router.get('/history', (req, res) => {
  const node = req.query.node || 'HB_NORTH';
  const iso = req.query.iso || 'ERCOT';
  const market = req.query.market || 'realtime';
  const days = parseInt(req.query.days) || 30;
  const end = new Date();
  const start = new Date(end - days * 24 * 60 * 60 * 1000);

  try {
    const rows = getEnergyPrices(iso, node, start.toISOString(), end.toISOString(), market);
    res.json({
      iso, node, market,
      start: start.toISOString(),
      end: end.toISOString(),
      count: rows.length,
      data: rows,
      fetchedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching energy history:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================================================
// GET /api/energy/heatmap - Hourly price heatmap data
// =============================================================================
router.get('/heatmap', (req, res) => {
  const node = req.query.node || 'HB_NORTH';
  const iso = req.query.iso || 'ERCOT';
  const days = parseInt(req.query.days) || 30;
  const end = new Date();
  const start = new Date(end - days * 24 * 60 * 60 * 1000);

  try {
    const rows = getEnergyPrices(iso, node, start.toISOString(), end.toISOString(), 'realtime');

    // Group by date and hour
    const heatmap = {};
    rows.forEach(r => {
      const d = new Date(r.timestamp);
      const dateStr = d.toISOString().split('T')[0];
      const hour = d.getUTCHours();
      if (!heatmap[dateStr]) heatmap[dateStr] = {};
      if (!heatmap[dateStr][hour]) heatmap[dateStr][hour] = [];
      heatmap[dateStr][hour].push(r.lmp);
    });

    // Average per date-hour cell
    const data = Object.entries(heatmap).map(([date, hours]) => ({
      date,
      hours: Object.entries(hours).map(([h, prices]) => ({
        hour: parseInt(h),
        avgPrice: prices.reduce((s, p) => s + p, 0) / prices.length,
        count: prices.length
      }))
    })).sort((a, b) => a.date.localeCompare(b.date));

    res.json({ iso, node, days, data, fetchedAt: new Date().toISOString() });
  } catch (error) {
    console.error('Error fetching heatmap:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================================================
// GET /api/energy/load - System load data
// =============================================================================
router.get('/load', async (req, res) => {
  const iso = req.query.iso || 'ERCOT';
  const cacheKey = `energy-load-${iso}`;

  try {
    const cached = getCache(cacheKey);
    if (cached && !cached.stale) {
      return res.json({ ...cached.data, cached: true, fetchedAt: cached.fetchedAt });
    }

    const data = await fetchErcotSystemLoad();
    setCache(cacheKey, data, 5);

    res.json({ ...data, cached: false, fetchedAt: new Date().toISOString() });
  } catch (error) {
    console.error('Error fetching system load:', error);
    const cached = getCache(cacheKey);
    if (cached) {
      return res.json({ ...cached.data, cached: true, stale: true, fetchedAt: cached.fetchedAt });
    }
    res.status(500).json({ error: error.message });
  }
});

// =============================================================================
// GET /api/energy/fuelmix - Generation fuel mix
// =============================================================================
router.get('/fuelmix', async (req, res) => {
  const iso = req.query.iso || 'ERCOT';
  const cacheKey = `energy-fuel-${iso}`;

  try {
    const cached = getCache(cacheKey);
    if (cached && !cached.stale) {
      return res.json({ ...cached.data, cached: true, fetchedAt: cached.fetchedAt });
    }

    const data = await fetchErcotFuelMix();
    setCache(cacheKey, data, 15);

    res.json({ ...data, cached: false, fetchedAt: new Date().toISOString() });
  } catch (error) {
    console.error('Error fetching fuel mix:', error);
    const cached = getCache(cacheKey);
    if (cached) {
      return res.json({ ...cached.data, cached: true, stale: true, fetchedAt: cached.fetchedAt });
    }
    res.status(500).json({ error: error.message });
  }
});

// =============================================================================
// GET /api/energy/grid-status - Grid condition / alerts
// =============================================================================
router.get('/grid-status', (req, res) => {
  const iso = req.query.iso || 'ERCOT';
  try {
    const events = getGridEvents(iso, 7);
    const activeEvents = events.filter(e => !e.resolved_at);
    const status = activeEvents.some(e => e.event_type.startsWith('eea'))
      ? 'emergency'
      : activeEvents.some(e => e.event_type === 'watch' || e.event_type === 'conservation_appeal')
        ? 'warning'
        : 'normal';

    res.json({
      iso, status,
      activeAlerts: activeEvents,
      recentEvents: events.slice(0, 20),
      fetchedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching grid status:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================================================
// GET /api/energy/alerts - Energy-specific alerts
// =============================================================================
router.get('/alerts', (req, res) => {
  const node = req.query.node || 'HB_NORTH';
  const iso = req.query.iso || 'ERCOT';

  try {
    // Check current price against thresholds
    const settings = getEnergySettings();
    const cached = getCache(`energy-rt-${iso}-${node}`);
    const currentPrice = cached?.data?.realTimePrice?.lmp;
    const alerts = [];

    if (currentPrice != null && settings) {
      const spikeThreshold = settings.spikeThreshold || 75;
      const dropThreshold = settings.dropThreshold || 10;

      if (currentPrice > spikeThreshold) {
        alerts.push({
          type: 'price_spike', severity: 'warning',
          iso, node,
          timestamp: new Date().toISOString(),
          message: `LMP at ${node} is $${currentPrice.toFixed(2)}/MWh (above $${spikeThreshold} threshold)`,
          currentValue: currentPrice, threshold: spikeThreshold,
          acknowledged: false
        });
      }
      if (currentPrice < dropThreshold) {
        alerts.push({
          type: 'price_drop', severity: 'info',
          iso, node,
          timestamp: new Date().toISOString(),
          message: `LMP at ${node} dropped to $${currentPrice.toFixed(2)}/MWh (below $${dropThreshold} threshold)`,
          currentValue: currentPrice, threshold: dropThreshold,
          acknowledged: false
        });
      }
      if (currentPrice < 0) {
        alerts.push({
          type: 'price_drop', severity: 'critical',
          iso, node,
          timestamp: new Date().toISOString(),
          message: `NEGATIVE pricing at ${node}: $${currentPrice.toFixed(2)}/MWh`,
          currentValue: currentPrice, threshold: 0,
          acknowledged: false
        });
      }
    }

    res.json({ iso, node, alerts, fetchedAt: new Date().toISOString() });
  } catch (error) {
    console.error('Error checking energy alerts:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================================================
// GET/POST /api/energy/settings - Energy configuration
// =============================================================================
router.get('/settings', (req, res) => {
  try {
    const settings = getEnergySettings() || {
      iso: 'ERCOT',
      defaultNode: 'HB_NORTH',
      trackedNodes: ['HB_NORTH', 'HB_SOUTH', 'HB_WEST', 'HB_HOUSTON'],
      refreshInterval: 300000,
      spikeThreshold: 75,
      dropThreshold: 10,
      priceUnit: 'MWh'
    };
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/settings', (req, res) => {
  try {
    saveEnergySettings(req.body);
    res.json({ success: true, settings: req.body });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =============================================================================
// POST /api/energy/backfill - Trigger historical data backfill
// =============================================================================
router.post('/backfill', async (req, res) => {
  const { node = 'HB_NORTH', days = 365 } = req.body;
  // Backfill is handled by generating mock historical data for now
  // When ERCOT API creds are configured, this would pull from their archives
  try {
    const { generateHistoricalMockData } = await import('../services/ercotService.js');
    const count = generateHistoricalMockData(node, days);
    res.json({ success: true, message: `Backfilled ${count} records for ${node} over ${days} days` });
  } catch (error) {
    console.error('Error during backfill:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
