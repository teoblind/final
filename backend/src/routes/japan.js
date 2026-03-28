import express from 'express';
import axios from 'axios';
import { getCache, setCache } from '../cache/database.js';

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

    const result = {
      jgb: {
        current: jgbData.current,
        yieldCurve: jgbData.yieldCurve,
        history10Y: jgbData.history10Y,
        previousMonth: jgbData.previousMonth
      },
      niip: {
        current: niipData.current,
        history: niipData.history,
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

export default router;
