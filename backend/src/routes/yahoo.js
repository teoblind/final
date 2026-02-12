import express from 'express';
import yahooFinance from '../services/yahooService.js';
import { getCache, setCache } from '../cache/database.js';

const router = express.Router();

// Calculate moving average
function calculateMA(data, period) {
  if (data.length < period) return null;
  const slice = data.slice(-period);
  return slice.reduce((sum, val) => sum + val, 0) / period;
}

// Get EU vs US Tech ratio (SX8P/NDX)
router.get('/eu-us-ratio', async (req, res) => {
  const { period = '1y' } = req.query;
  const cacheKey = `eu-us-ratio-${period}`;

  try {
    // Check cache first
    const cached = getCache(cacheKey);
    if (cached && !cached.stale) {
      return res.json({
        ...cached.data,
        cached: true,
        fetchedAt: cached.fetchedAt
      });
    }

    // Map period to Yahoo Finance range
    const rangeMap = {
      '1d': '1d',
      '1w': '5d',
      '1m': '1mo',
      '3m': '3mo',
      '1y': '1y'
    };

    const range = rangeMap[period] || '1y';
    const interval = period === '1d' ? '5m' : '1d';

    // Fetch both indexes
    const [sx8pData, ndxData] = await Promise.all([
      yahooFinance.chart('^STOXX', { period1: getStartDate(period), interval }),
      yahooFinance.chart('^NDX', { period1: getStartDate(period), interval })
    ]);

    // Calculate ratio
    const sx8pQuotes = sx8pData.quotes || [];
    const ndxQuotes = ndxData.quotes || [];

    // Align data by date
    const ratioData = [];
    const ndxByDate = new Map();

    ndxQuotes.forEach(q => {
      if (q.date && q.close) {
        ndxByDate.set(q.date.toISOString().split('T')[0], q.close);
      }
    });

    sx8pQuotes.forEach(q => {
      if (q.date && q.close) {
        const dateKey = q.date.toISOString().split('T')[0];
        const ndxClose = ndxByDate.get(dateKey);
        if (ndxClose) {
          ratioData.push({
            date: dateKey,
            ratio: (q.close / ndxClose) * 100, // Normalized ratio
            sx8p: q.close,
            ndx: ndxClose
          });
        }
      }
    });

    // Calculate MAs
    const ratioValues = ratioData.map(d => d.ratio);
    const ma50 = calculateMA(ratioValues, 50);
    const ma200 = calculateMA(ratioValues, 200);

    // Determine trend
    const recentRatios = ratioValues.slice(-5);
    const trend = recentRatios.length >= 2
      ? recentRatios[recentRatios.length - 1] > recentRatios[0] ? 'rising' : 'falling'
      : 'neutral';

    const result = {
      data: ratioData,
      current: ratioData[ratioData.length - 1]?.ratio || 0,
      ma50,
      ma200,
      trend,
      period,
      source: 'Yahoo Finance'
    };

    // Cache for 5 minutes during market hours
    setCache(cacheKey, result, 5);

    res.json({
      ...result,
      cached: false,
      fetchedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching EU/US ratio:', error);

    // Return cached data if available, even if stale
    const cached = getCache(cacheKey);
    if (cached) {
      return res.json({
        ...cached.data,
        cached: true,
        stale: true,
        error: error.message,
        fetchedAt: cached.fetchedAt
      });
    }

    res.status(500).json({ error: error.message });
  }
});

// Get stock/ETF quote
router.get('/quote/:symbol', async (req, res) => {
  const { symbol } = req.params;
  const cacheKey = `quote-${symbol}`;

  try {
    const cached = getCache(cacheKey);
    if (cached && !cached.stale) {
      return res.json({
        ...cached.data,
        cached: true,
        fetchedAt: cached.fetchedAt
      });
    }

    const quote = await yahooFinance.quote(symbol);

    const result = {
      symbol: quote.symbol,
      name: quote.shortName || quote.longName,
      price: quote.regularMarketPrice,
      change: quote.regularMarketChange,
      changePercent: quote.regularMarketChangePercent,
      volume: quote.regularMarketVolume,
      marketCap: quote.marketCap,
      high: quote.regularMarketDayHigh,
      low: quote.regularMarketDayLow,
      open: quote.regularMarketOpen,
      previousClose: quote.regularMarketPreviousClose,
      source: 'Yahoo Finance'
    };

    setCache(cacheKey, result, 5);

    res.json({
      ...result,
      cached: false,
      fetchedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error(`Error fetching quote for ${symbol}:`, error);
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

// Get historical data for a symbol
router.get('/history/:symbol', async (req, res) => {
  const { symbol } = req.params;
  const { period = '1y' } = req.query;
  const cacheKey = `history-${symbol}-${period}`;

  try {
    const cached = getCache(cacheKey);
    if (cached && !cached.stale) {
      return res.json({
        ...cached.data,
        cached: true,
        fetchedAt: cached.fetchedAt
      });
    }

    const startDate = getStartDate(period);
    const data = await yahooFinance.chart(symbol, {
      period1: startDate,
      interval: period === '1d' ? '5m' : '1d'
    });

    const quotes = (data.quotes || []).map(q => ({
      date: q.date?.toISOString(),
      open: q.open,
      high: q.high,
      low: q.low,
      close: q.close,
      volume: q.volume
    })).filter(q => q.close);

    const result = {
      symbol,
      period,
      data: quotes,
      source: 'Yahoo Finance'
    };

    setCache(cacheKey, result, period === '1d' ? 5 : 60);

    res.json({
      ...result,
      cached: false,
      fetchedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error(`Error fetching history for ${symbol}:`, error);
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

// Get fiber basket relative performance
router.get('/fiber-basket', async (req, res) => {
  const { period = '1y' } = req.query;
  const cacheKey = `fiber-basket-${period}`;

  try {
    const cached = getCache(cacheKey);
    if (cached && !cached.stale) {
      return res.json({
        ...cached.data,
        cached: true,
        fetchedAt: cached.fetchedAt
      });
    }

    const symbols = ['GLW', 'COHR', 'CIEN', 'LITE', 'COMM', 'QQQ'];
    const startDate = getStartDate(period);

    const allData = await Promise.all(
      symbols.map(sym =>
        yahooFinance.chart(sym, { period1: startDate, interval: '1d' })
          .then(d => ({ symbol: sym, quotes: d.quotes || [] }))
          .catch(() => ({ symbol: sym, quotes: [] }))
      )
    );

    // Normalize to 100 at start
    const normalized = {};
    allData.forEach(({ symbol, quotes }) => {
      if (quotes.length > 0) {
        const startPrice = quotes[0].close;
        normalized[symbol] = quotes.map(q => ({
          date: q.date?.toISOString().split('T')[0],
          value: startPrice ? (q.close / startPrice) * 100 : null
        })).filter(d => d.value);
      }
    });

    // Calculate basket average (excluding QQQ)
    const basketSymbols = ['GLW', 'COHR', 'CIEN', 'LITE', 'COMM'];
    const dates = normalized['GLW']?.map(d => d.date) || [];

    const basketData = dates.map(date => {
      const values = basketSymbols
        .map(sym => normalized[sym]?.find(d => d.date === date)?.value)
        .filter(v => v !== undefined);

      return {
        date,
        basket: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
        qqq: normalized['QQQ']?.find(d => d.date === date)?.value || null
      };
    }).filter(d => d.basket && d.qqq);

    // GLW/QQQ ratio
    const glwQqqRatio = dates.map(date => {
      const glw = normalized['GLW']?.find(d => d.date === date)?.value;
      const qqq = normalized['QQQ']?.find(d => d.date === date)?.value;
      return glw && qqq ? { date, ratio: glw / qqq } : null;
    }).filter(Boolean);

    const result = {
      individual: normalized,
      basket: basketData,
      glwQqqRatio,
      symbols: basketSymbols,
      period,
      source: 'Yahoo Finance'
    };

    setCache(cacheKey, result, 15);

    res.json({
      ...result,
      cached: false,
      fetchedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching fiber basket:', error);
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

function getStartDate(period) {
  const now = new Date();
  switch (period) {
    case '1d': return new Date(now.setDate(now.getDate() - 1));
    case '1w': return new Date(now.setDate(now.getDate() - 7));
    case '1m': return new Date(now.setMonth(now.getMonth() - 1));
    case '3m': return new Date(now.setMonth(now.getMonth() - 3));
    case '1y': return new Date(now.setFullYear(now.getFullYear() - 1));
    default: return new Date(now.setFullYear(now.getFullYear() - 1));
  }
}

export default router;
