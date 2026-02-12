import express from 'express';
import axios from 'axios';
import yahooFinance from '../services/yahooService.js';
import { getCache, setCache, getManualData, addManualData } from '../cache/database.js';
import db from '../cache/database.js';
import { fetchAllFredData, getDataFreshness, clearFredCache, FRED_SERIES } from '../services/fredService.js';
import { getSchedulerStatus } from '../jobs/liquidityRefresh.js';

const router = express.Router();

// Track data sources for each field
let lastSources = {};

// Initialize liquidity tables
function initLiquidityTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS liquidity_inputs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      move_index REAL,
      us10y REAL,
      dxy REAL,
      fed_bs REAL,
      btc_price REAL,
      btc_200dma REAL,
      btc_mvrv REAL,
      btc_funding_rate REAL,
      btc_etf_flow_weekly REAL,
      gold_price REAL,
      silver_price REAL,
      gold_silver_ratio REAL,
      cpi_yoy REAL,
      core_yoy REAL,
      us2y REAL,
      us30y REAL,
      fed_funds_rate TEXT,
      unemployment REAL,
      nfp REAL,
      initial_claims REAL,
      tga REAL,
      rrp REAL,
      spx REAL,
      vix REAL,
      hy_oas REAL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS liquidity_signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      composite INTEGER,
      overall_signal TEXT,
      btc_score INTEGER,
      btc_signal TEXT,
      gold_score INTEGER,
      gold_signal TEXT,
      silver_score INTEGER,
      silver_signal TEXT,
      inputs_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

initLiquidityTables();

// Get liquidity data
router.get('/', async (req, res) => {
  const cacheKey = 'liquidity-data';
  const forceRefresh = req.query.refresh === 'true';

  try {
    if (!forceRefresh) {
      const cached = getCache(cacheKey);
      if (cached && !cached.stale) {
        return res.json({
          ...cached.data,
          cached: true,
          fetchedAt: cached.fetchedAt
        });
      }
    }

    // Fetch latest data from various sources
    const { inputs, sources } = await fetchLiquidityInputs();

    // Store sources for the /sources endpoint
    lastSources = sources;

    // Get signal history
    const history = getSignalHistory();

    const result = {
      inputs,
      sources,
      history,
      sourcesSummary: {
        fred: Object.values(sources).filter(s => s.source === 'fred').length,
        yahoo: Object.values(sources).filter(s => s.source === 'yahoo').length,
        manual: Object.values(sources).filter(s => s.source === 'manual').length,
        computed: Object.values(sources).filter(s => s.source === 'computed').length
      }
    };

    setCache(cacheKey, result, 5); // Cache for 5 minutes

    res.json({
      ...result,
      cached: false,
      fetchedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching liquidity data:', error);
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

// Get data sources metadata
router.get('/sources', (req, res) => {
  const sources = lastSources;

  // Add freshness status to each source
  const sourcesWithFreshness = {};
  for (const [field, source] of Object.entries(sources)) {
    sourcesWithFreshness[field] = {
      ...source,
      freshness: getDataFreshness(source.fetchedAt, source.frequency || 'daily')
    };
  }

  // List of all expected fields
  const allFields = [
    'moveIndex', 'us10y', 'us2y', 'us30y', 'dxy', 'fedBS',
    'btcPrice', 'btc200dma', 'btcMvrv', 'btcFundingRate', 'btcEtfFlowWeekly',
    'goldPrice', 'silverPrice', 'goldSilverRatio',
    'cpiYoy', 'coreYoy', 'fedFundsRate', 'unemployment', 'nfp', 'initialClaims',
    'tga', 'rrp', 'spx', 'vix', 'hyOAS'
  ];

  // Add missing fields as 'unknown'
  for (const field of allFields) {
    if (!sourcesWithFreshness[field]) {
      sourcesWithFreshness[field] = {
        source: 'unknown',
        freshness: 'very_stale'
      };
    }
  }

  const summary = {
    fred: Object.values(sourcesWithFreshness).filter(s => s.source === 'fred').length,
    yahoo: Object.values(sourcesWithFreshness).filter(s => s.source === 'yahoo').length,
    manual: Object.values(sourcesWithFreshness).filter(s => s.source === 'manual').length,
    computed: Object.values(sourcesWithFreshness).filter(s => s.source === 'computed').length,
    unknown: Object.values(sourcesWithFreshness).filter(s => s.source === 'unknown').length
  };

  // Determine primary source based on counts
  const primarySource = summary.fred >= summary.yahoo ? 'fred' : summary.yahoo > 0 ? 'yahoo' : 'manual';

  res.json({
    sources: sourcesWithFreshness,
    summary,
    primarySource,
    fredSeriesAvailable: Object.keys(FRED_SERIES),
    fetchedAt: new Date().toISOString()
  });
});

// Get scheduler status
router.get('/status', (req, res) => {
  try {
    const status = getSchedulerStatus();
    res.json({
      scheduler: status,
      api: {
        fredConfigured: !!process.env.FRED_API_KEY && process.env.FRED_API_KEY !== 'demo',
        fredSeriesCount: Object.keys(FRED_SERIES).length
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Force refresh from all sources
router.post('/refresh', async (req, res) => {
  try {
    clearFredCache();
    setCache('liquidity-data', null, 0);

    const { inputs, sources } = await fetchLiquidityInputs();
    lastSources = sources;

    res.json({
      success: true,
      inputs,
      sources,
      fetchedAt: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Save manual inputs
router.post('/inputs', (req, res) => {
  const { date, ...inputs } = req.body;

  try {
    const stmt = db.prepare(`
      INSERT INTO liquidity_inputs (
        date, move_index, us10y, dxy, fed_bs, btc_price, btc_200dma, btc_mvrv,
        btc_funding_rate, btc_etf_flow_weekly, gold_price, silver_price,
        gold_silver_ratio, cpi_yoy, core_yoy, us2y, us30y, fed_funds_rate,
        unemployment, nfp, initial_claims, tga, rrp, spx, vix, hy_oas
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      date || new Date().toISOString().split('T')[0],
      inputs.moveIndex, inputs.us10y, inputs.dxy, inputs.fedBS,
      inputs.btcPrice, inputs.btc200dma, inputs.btcMvrv,
      inputs.btcFundingRate, inputs.btcEtfFlowWeekly,
      inputs.goldPrice, inputs.silverPrice, inputs.goldSilverRatio,
      inputs.cpiYoy, inputs.coreYoy, inputs.us2y, inputs.us30y,
      inputs.fedFundsRate, inputs.unemployment, inputs.nfp,
      inputs.initialClaims, inputs.tga, inputs.rrp, inputs.spx, inputs.vix, inputs.hyOAS
    );

    setCache('liquidity-data', null, 0); // Invalidate cache

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Log a signal
router.post('/signal', (req, res) => {
  const { inputs, result } = req.body;

  try {
    const stmt = db.prepare(`
      INSERT INTO liquidity_signals (
        timestamp, composite, overall_signal, btc_score, btc_signal,
        gold_score, gold_signal, silver_score, silver_signal, inputs_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      new Date().toISOString(),
      result.composite,
      result.overallSignal,
      result.btcScore,
      result.btcSignal,
      result.goldScore,
      result.goldSignal,
      result.silverScore,
      result.silverSignal,
      JSON.stringify(inputs)
    );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get signal history
router.get('/history', (req, res) => {
  try {
    const history = getSignalHistory();
    res.json({ history });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

function getSignalHistory() {
  return db.prepare(`
    SELECT * FROM liquidity_signals ORDER BY timestamp DESC LIMIT 50
  `).all().map(row => ({
    timestamp: row.timestamp,
    composite: row.composite,
    overallSignal: row.overall_signal,
    btc: { score: row.btc_score, signal: row.btc_signal },
    gold: { score: row.gold_score, signal: row.gold_signal },
    silver: { score: row.silver_score, signal: row.silver_signal }
  }));
}

async function fetchLiquidityInputs() {
  const inputs = {
    moveIndex: null,
    us10y: null,
    dxy: null,
    fedBS: null,
    btcPrice: null,
    btc200dma: null,
    btcMvrv: null,
    btcFundingRate: null,
    btcEtfFlowWeekly: null,
    goldPrice: null,
    silverPrice: null,
    goldSilverRatio: null,
    cpiYoy: null,
    coreYoy: null,
    us2y: null,
    us30y: null,
    fedFundsRate: null,
    unemployment: null,
    nfp: null,
    initialClaims: null,
    tga: null,
    rrp: null,
    spx: null,
    vix: null,
    hyOAS: null
  };

  const sources = {};

  // Fetch from multiple sources in parallel
  // Priority: FRED > Yahoo > Manual
  const [fredResult, yahooResult, btcResult] = await Promise.all([
    fetchFredDataWrapped(),
    fetchYahooData(),
    fetchBtcData()
  ]);

  // Apply FRED data first (highest priority for macro data)
  if (fredResult.inputs) {
    for (const [field, value] of Object.entries(fredResult.inputs)) {
      if (value !== null && value !== undefined) {
        inputs[field] = value;
      }
    }
    Object.assign(sources, fredResult.sources || {});
  }

  // Apply Yahoo data (fills gaps, especially DXY, MOVE, prices)
  if (yahooResult.inputs) {
    for (const [field, value] of Object.entries(yahooResult.inputs)) {
      if (value !== null && value !== undefined && inputs[field] === null) {
        inputs[field] = value;
        sources[field] = yahooResult.sources[field];
      }
    }
  }

  // Apply BTC data
  if (btcResult.inputs) {
    for (const [field, value] of Object.entries(btcResult.inputs)) {
      if (value !== null && value !== undefined && inputs[field] === null) {
        inputs[field] = value;
        sources[field] = btcResult.sources[field];
      }
    }
  }

  // Fill remaining gaps from manual inputs
  const manualData = loadLatestManualInputs();
  if (manualData.inputs) {
    for (const [field, value] of Object.entries(manualData.inputs)) {
      if (value !== null && value !== undefined && inputs[field] === null) {
        inputs[field] = value;
        sources[field] = { source: 'manual', fetchedAt: manualData.date };
      }
    }
  }

  // Compute derived fields
  if (inputs.goldPrice && inputs.silverPrice && !inputs.goldSilverRatio) {
    inputs.goldSilverRatio = inputs.goldPrice / inputs.silverPrice;
    sources.goldSilverRatio = { source: 'computed', fetchedAt: new Date().toISOString() };
  }

  return { inputs, sources };
}

async function fetchFredDataWrapped() {
  try {
    const result = await fetchAllFredData();
    return {
      inputs: result.inputs,
      sources: result.sources,
      status: result.status
    };
  } catch (error) {
    console.error('[Liquidity] FRED fetch error:', error.message);
    return { inputs: {}, sources: {}, status: 'error' };
  }
}

async function fetchYahooData() {
  const inputs = {};
  const sources = {};
  const now = new Date().toISOString();

  try {
    // Fetch quotes for DXY, MOVE, gold, silver, VIX, SPX
    // Note: MOVE Index (^MOVE) may not be available on Yahoo Finance
    const symbols = ['DX-Y.NYB', 'GC=F', 'SI=F', '^VIX', '^GSPC'];

    const quotes = await Promise.all(
      symbols.map(sym => yahooFinance.quote(sym).catch(() => null))
    );

    // DXY (critical - not on FRED)
    if (quotes[0]?.regularMarketPrice) {
      inputs.dxy = quotes[0].regularMarketPrice;
      sources.dxy = { source: 'yahoo', symbol: 'DX-Y.NYB', fetchedAt: now, frequency: 'daily' };
    }

    // Gold
    if (quotes[1]?.regularMarketPrice) {
      inputs.goldPrice = quotes[1].regularMarketPrice;
      sources.goldPrice = { source: 'yahoo', symbol: 'GC=F', fetchedAt: now, frequency: 'daily' };
    }

    // Silver
    if (quotes[2]?.regularMarketPrice) {
      inputs.silverPrice = quotes[2].regularMarketPrice;
      sources.silverPrice = { source: 'yahoo', symbol: 'SI=F', fetchedAt: now, frequency: 'daily' };
    }

    // VIX (backup if FRED fails)
    if (quotes[3]?.regularMarketPrice) {
      inputs.vix = quotes[3].regularMarketPrice;
      sources.vix = { source: 'yahoo', symbol: '^VIX', fetchedAt: now, frequency: 'daily' };
    }

    // SPX
    if (quotes[4]?.regularMarketPrice) {
      inputs.spx = quotes[4].regularMarketPrice;
      sources.spx = { source: 'yahoo', symbol: '^GSPC', fetchedAt: now, frequency: 'daily' };
    }

    // Try to get MOVE Index (may not be available)
    try {
      const moveQuote = await yahooFinance.quote('^MOVE');
      if (moveQuote?.regularMarketPrice) {
        inputs.moveIndex = moveQuote.regularMarketPrice;
        sources.moveIndex = { source: 'yahoo', symbol: '^MOVE', fetchedAt: now, frequency: 'daily' };
      }
    } catch (e) {
      // MOVE not available on Yahoo, will need manual input
    }

  } catch (error) {
    console.error('[Liquidity] Yahoo data fetch error:', error.message);
  }

  return { inputs, sources };
}

async function fetchBtcData() {
  const inputs = {};
  const sources = {};
  const now = new Date().toISOString();

  try {
    // CoinGecko for BTC price
    const cgResponse = await axios.get(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
      { timeout: 10000 }
    );
    if (cgResponse.data?.bitcoin?.usd) {
      inputs.btcPrice = cgResponse.data.bitcoin.usd;
      sources.btcPrice = { source: 'coingecko', fetchedAt: now, frequency: 'realtime' };
    }

    // Try to get 200DMA from Yahoo Finance historical data
    try {
      const btcHistory = await yahooFinance.chart('BTC-USD', {
        period1: new Date(Date.now() - 220 * 24 * 60 * 60 * 1000),
        interval: '1d'
      });

      if (btcHistory?.quotes?.length >= 200) {
        const last200 = btcHistory.quotes.slice(-200);
        const validQuotes = last200.filter(q => q.close);
        if (validQuotes.length >= 200) {
          const sum = validQuotes.reduce((acc, q) => acc + q.close, 0);
          inputs.btc200dma = sum / validQuotes.length;
          sources.btc200dma = { source: 'computed', method: '200DMA from Yahoo', fetchedAt: now, frequency: 'daily' };
        }
      }
    } catch (e) {
      console.log('[Liquidity] BTC 200DMA calculation failed:', e.message);
    }

  } catch (error) {
    console.error('[Liquidity] BTC data fetch error:', error.message);
  }

  return { inputs, sources };
}

function loadLatestManualInputs() {
  try {
    const latest = db.prepare(`
      SELECT * FROM liquidity_inputs ORDER BY date DESC LIMIT 1
    `).get();

    if (!latest) return { inputs: {}, date: null };

    const inputs = {
      moveIndex: latest.move_index,
      us10y: latest.us10y,
      dxy: latest.dxy,
      fedBS: latest.fed_bs,
      btcPrice: latest.btc_price,
      btc200dma: latest.btc_200dma,
      btcMvrv: latest.btc_mvrv,
      btcFundingRate: latest.btc_funding_rate,
      btcEtfFlowWeekly: latest.btc_etf_flow_weekly,
      goldPrice: latest.gold_price,
      silverPrice: latest.silver_price,
      goldSilverRatio: latest.gold_silver_ratio,
      cpiYoy: latest.cpi_yoy,
      coreYoy: latest.core_yoy,
      us2y: latest.us2y,
      us30y: latest.us30y,
      fedFundsRate: latest.fed_funds_rate,
      unemployment: latest.unemployment,
      nfp: latest.nfp,
      initialClaims: latest.initial_claims,
      tga: latest.tga,
      rrp: latest.rrp,
      spx: latest.spx,
      vix: latest.vix,
      hyOAS: latest.hy_oas
    };

    return { inputs, date: latest.date };
  } catch (error) {
    console.error('[Liquidity] Error loading manual inputs:', error);
    return { inputs: {}, date: null };
  }
}

export default router;
