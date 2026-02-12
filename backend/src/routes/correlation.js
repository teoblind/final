import express from 'express';
import { getCache, setCache } from '../cache/database.js';

const router = express.Router();

// Correlation pairs to calculate
const CORRELATION_PAIRS = [
  { x: 'hashprice', y: 'btc_price', label: 'Hashprice vs BTC Price' },
  { x: 'hashprice', y: 'uranium_spot', label: 'Hashprice vs Uranium Spot' },
  { x: 'eu_us_ratio', y: 'jgb_10y', label: 'EU/US Tech Ratio vs JGB 10Y' },
  { x: 'uranium_spot', y: 'ndpr_price', label: 'Uranium Spot vs NdPr Price' },
  { x: 'suez_volume', y: 'shipping_etf', label: 'Suez Volume vs BDRY' },
  { x: 'glw_qqq_ratio', y: 'datacenter_demand', label: 'GLW/QQQ vs DC Power Demand' },
  { x: 'fiber_basket', y: 'uranium_spot', label: 'Fiber Basket vs Uranium (Physical AI)' },
  { x: 'ewz_spy_ratio', y: 'brazil_real_rate', label: 'EWZ/SPY vs Brazil Real Rate' },
  { x: 'ewz', y: 'hashprice', label: 'EWZ vs Hashprice (Energy Arbitrage)' },
  { x: 'brl_usd', y: 'selic_ipca', label: 'BRL/USD vs SELIC-IPCA Spread' }
];

// Get correlation matrix
router.get('/', async (req, res) => {
  const { period = '90d' } = req.query;
  const cacheKey = `correlation-${period}`;

  try {
    const cached = getCache(cacheKey);
    if (cached && !cached.stale) {
      return res.json({
        ...cached.data,
        cached: true,
        fetchedAt: cached.fetchedAt
      });
    }

    // Calculate correlations
    const correlations = await calculateCorrelations(period);

    const result = {
      period,
      pairs: CORRELATION_PAIRS,
      matrix: correlations.matrix,
      pairResults: correlations.pairs,
      methodology: {
        formula: 'Pearson correlation coefficient',
        window: period === '30d' ? '30-day rolling' : '90-day rolling',
        note: 'Correlations are calculated using available cached data. Some pairs may have insufficient data.'
      },
      legend: {
        strong_positive: '>0.7',
        moderate_positive: '0.3 to 0.7',
        weak: '-0.3 to 0.3',
        moderate_negative: '-0.7 to -0.3',
        strong_negative: '<-0.7'
      }
    };

    setCache(cacheKey, result, 60 * 24); // Cache for 24 hours

    res.json({
      ...result,
      cached: false,
      fetchedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error calculating correlations:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get specific pair correlation
router.get('/pair/:x/:y', async (req, res) => {
  const { x, y } = req.params;
  const { period = '90d' } = req.query;

  try {
    const xData = await getTimeSeriesData(x);
    const yData = await getTimeSeriesData(y);

    if (!xData.length || !yData.length) {
      return res.json({
        x, y, period,
        correlation: null,
        error: 'Insufficient data for one or both metrics'
      });
    }

    const aligned = alignTimeSeries(xData, yData, period);
    const correlation = calculatePearsonCorrelation(aligned.x, aligned.y);

    res.json({
      x, y, period,
      correlation,
      dataPoints: aligned.x.length,
      xMetric: x,
      yMetric: y,
      strength: getCorrelationStrength(correlation),
      fetchedAt: new Date().toISOString()
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

async function calculateCorrelations(period) {
  const results = {
    matrix: {},
    pairs: []
  };

  // Get all unique metrics
  const metrics = [...new Set(CORRELATION_PAIRS.flatMap(p => [p.x, p.y]))];

  // Get data for all metrics
  const dataMap = {};
  for (const metric of metrics) {
    dataMap[metric] = await getTimeSeriesData(metric);
  }

  // Calculate correlations for each pair
  for (const pair of CORRELATION_PAIRS) {
    const xData = dataMap[pair.x] || [];
    const yData = dataMap[pair.y] || [];

    if (xData.length < 10 || yData.length < 10) {
      results.pairs.push({
        ...pair,
        correlation: null,
        error: 'Insufficient data'
      });
      continue;
    }

    const aligned = alignTimeSeries(xData, yData, period);
    const correlation = calculatePearsonCorrelation(aligned.x, aligned.y);

    results.pairs.push({
      ...pair,
      correlation,
      dataPoints: aligned.x.length,
      strength: getCorrelationStrength(correlation)
    });

    // Add to matrix
    if (!results.matrix[pair.x]) results.matrix[pair.x] = {};
    if (!results.matrix[pair.y]) results.matrix[pair.y] = {};
    results.matrix[pair.x][pair.y] = correlation;
    results.matrix[pair.y][pair.x] = correlation;
  }

  // Self-correlations
  for (const metric of metrics) {
    if (!results.matrix[metric]) results.matrix[metric] = {};
    results.matrix[metric][metric] = 1;
  }

  return results;
}

async function getTimeSeriesData(metric) {
  const cached = getCache(getMetricCacheKey(metric));
  if (!cached?.data) return [];

  switch (metric) {
    case 'hashprice':
      return (cached.data.history || []).map(d => ({ date: d.date, value: d.hashprice }));
    case 'btc_price':
      return (cached.data.history || cached.data.data || []).map(d => ({ date: d.date, value: d.btcPrice || d.close }));
    case 'eu_us_ratio':
      return (cached.data.data || []).map(d => ({ date: d.date, value: d.ratio }));
    case 'jgb_10y':
      return (cached.data.jgb?.history10Y || []).map(d => ({ date: d.date, value: d.value }));
    case 'uranium_spot':
      return (cached.data.spot?.history || []).map(d => ({ date: d.date, value: d.value }));
    case 'ndpr_price':
      return (cached.data.primary?.history || []).map(d => ({ date: d.date, value: d.value }));
    case 'glw_qqq_ratio':
      return (cached.data.glwQqqRatio || []).map(d => ({ date: d.date, value: d.ratio }));
    case 'ewz_spy_ratio':
      return (cached.data.equities?.ewzSpyRatio || []).map(d => ({ date: d.date, value: d.ratio }));
    case 'ewz':
      return (cached.data.equities?.normalized?.EWZ || []).map(d => ({ date: d.date, value: d.value }));
    case 'brazil_real_rate':
      return [{ date: new Date().toISOString().split('T')[0], value: cached.data.macro?.realRate?.current }].filter(d => d.value);
    default:
      return [];
  }
}

function getMetricCacheKey(metric) {
  const keyMap = {
    hashprice: 'hashprice',
    btc_price: 'hashprice-with-btc',
    eu_us_ratio: 'eu-us-ratio-1y',
    jgb_10y: 'japan-macro',
    uranium_spot: 'uranium-prices',
    ndpr_price: 'rare-earth-prices',
    glw_qqq_ratio: 'fiber-basket-1y',
    ewz_spy_ratio: 'brazil-compute',
    ewz: 'brazil-compute',
    brazil_real_rate: 'brazil-compute',
    fiber_basket: 'fiber-basket-1y'
  };
  return keyMap[metric] || metric;
}

function alignTimeSeries(xData, yData, period) {
  const days = period === '30d' ? 30 : 90;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  // Create lookup maps
  const xMap = new Map(xData.filter(d => d.date >= cutoffStr).map(d => [d.date, d.value]));
  const yMap = new Map(yData.filter(d => d.date >= cutoffStr).map(d => [d.date, d.value]));

  // Find common dates
  const commonDates = [...xMap.keys()].filter(date => yMap.has(date)).sort();

  return {
    x: commonDates.map(date => xMap.get(date)),
    y: commonDates.map(date => yMap.get(date)),
    dates: commonDates
  };
}

function calculatePearsonCorrelation(x, y) {
  if (x.length !== y.length || x.length < 2) return null;

  const n = x.length;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((total, xi, i) => total + xi * y[i], 0);
  const sumX2 = x.reduce((total, xi) => total + xi * xi, 0);
  const sumY2 = y.reduce((total, yi) => total + yi * yi, 0);

  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

  if (denominator === 0) return null;

  const correlation = numerator / denominator;
  return Math.round(correlation * 1000) / 1000;
}

function getCorrelationStrength(r) {
  if (r === null) return 'unknown';
  const absR = Math.abs(r);
  if (absR > 0.7) return r > 0 ? 'strong_positive' : 'strong_negative';
  if (absR > 0.3) return r > 0 ? 'moderate_positive' : 'moderate_negative';
  return 'weak';
}

export default router;
