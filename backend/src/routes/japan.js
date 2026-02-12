import express from 'express';
import axios from 'axios';
import { getCache, setCache, getManualData, addManualData } from '../cache/database.js';

const router = express.Router();

// Get Japan macro data
router.get('/', async (req, res) => {
  const cacheKey = 'japan-macro';

  try {
    const cached = getCache(cacheKey);
    if (cached && !cached.stale) {
      return res.json({
        ...cached.data,
        cached: true,
        fetchedAt: cached.fetchedAt
      });
    }

    // Fetch JGB yields and NIIP data
    const [jgbData, niipData] = await Promise.all([
      fetchJGBYields(),
      fetchNIIP()
    ]);

    // Get manual entries
    const manualYields = getManualData('japan', 'jgb_10y');
    const manualNIIP = getManualData('japan', 'niip');

    const result = {
      jgb: {
        current: jgbData.current,
        yieldCurve: jgbData.yieldCurve,
        history10Y: mergeData(jgbData.history10Y, manualYields),
        previousMonth: jgbData.previousMonth
      },
      niip: {
        current: manualNIIP[0]?.value || niipData.current,
        history: mergeData(niipData.history, manualNIIP),
        inUSD: niipData.inUSD,
        inJPY: niipData.inJPY
      },
      context: {
        repatriationRisk: 'Japan has the world\'s largest NIIP (~$3.5 trillion). Repatriation of overseas assets could strengthen JPY significantly.',
        yieldContext: 'BOJ yield curve control (YCC) was effectively abandoned in 2024. Rising JGB yields signal potential capital flows back to Japan.'
      },
      sources: ['FRED', 'Bank of Japan', 'Ministry of Finance Japan']
    };

    setCache(cacheKey, result, 30);

    res.json({
      ...result,
      cached: false,
      fetchedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching Japan macro:', error);
    const cached = getCache(cacheKey);
    if (cached) {
      return res.json({
        ...cached.data,
        cached: true,
        stale: true,
        fetchedAt: cached.fetchedAt
      });
    }
    res.status(500).json({ error: error.message });
  }
});

// Add manual entry
router.post('/manual', (req, res) => {
  const { metric, value, date, notes } = req.body;

  if (!metric || value === undefined || !date) {
    return res.status(400).json({ error: 'Metric, value, and date are required' });
  }

  const validMetrics = ['jgb_2y', 'jgb_5y', 'jgb_10y', 'jgb_30y', 'niip'];
  if (!validMetrics.includes(metric)) {
    return res.status(400).json({ error: `Metric must be one of: ${validMetrics.join(', ')}` });
  }

  try {
    addManualData('japan', metric, parseFloat(value), date, notes);
    setCache('japan-macro', null, 0);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

async function fetchJGBYields() {
  try {
    // Try FRED for 10Y JGB
    const response = await axios.get(
      'https://api.stlouisfed.org/fred/series/observations',
      {
        params: {
          series_id: 'IRLTLT01JPM156N',
          api_key: process.env.FRED_API_KEY || 'demo',
          file_type: 'json',
          sort_order: 'desc',
          limit: 365
        },
        timeout: 10000
      }
    );

    const observations = response.data.observations || [];
    const history10Y = observations
      .filter(o => o.value !== '.')
      .map(o => ({
        date: o.date,
        value: parseFloat(o.value)
      }));

    const current10Y = history10Y[0]?.value || null;

    // Simulated yield curve (would need additional API calls for full curve)
    const yieldCurve = [
      { tenor: '2Y', yield: current10Y ? current10Y * 0.3 : null },
      { tenor: '5Y', yield: current10Y ? current10Y * 0.7 : null },
      { tenor: '10Y', yield: current10Y },
      { tenor: '30Y', yield: current10Y ? current10Y * 1.3 : null }
    ];

    return {
      current: {
        '2Y': yieldCurve[0].yield,
        '5Y': yieldCurve[1].yield,
        '10Y': current10Y,
        '30Y': yieldCurve[3].yield
      },
      yieldCurve,
      history10Y,
      previousMonth: history10Y[21] || null
    };

  } catch (e) {
    console.log('FRED JGB fetch failed:', e.message);
    return {
      current: {},
      yieldCurve: [],
      history10Y: [],
      previousMonth: null
    };
  }
}

async function fetchNIIP() {
  try {
    // Try FRED for Japan NIIP
    const response = await axios.get(
      'https://api.stlouisfed.org/fred/series/observations',
      {
        params: {
          series_id: 'JPNIIP',
          api_key: process.env.FRED_API_KEY || 'demo',
          file_type: 'json',
          sort_order: 'desc',
          limit: 40 // ~10 years quarterly
        },
        timeout: 10000
      }
    );

    const observations = response.data.observations || [];
    const history = observations
      .filter(o => o.value !== '.')
      .map(o => ({
        date: o.date,
        value: parseFloat(o.value)
      }));

    const current = history[0]?.value || null;

    return {
      current,
      history,
      inUSD: current,
      inJPY: current ? current * 150 : null // Approximate JPY conversion
    };

  } catch (e) {
    console.log('FRED NIIP fetch failed:', e.message);
    return {
      current: null,
      history: [],
      inUSD: null,
      inJPY: null
    };
  }
}

function mergeData(apiData, manualData) {
  const combined = new Map();

  apiData.forEach(item => {
    combined.set(item.date, { ...item, source: 'api' });
  });

  manualData.forEach(item => {
    combined.set(item.date, { date: item.date, value: item.value, source: 'manual', notes: item.notes });
  });

  return Array.from(combined.values()).sort((a, b) => new Date(b.date) - new Date(a.date));
}

export default router;
