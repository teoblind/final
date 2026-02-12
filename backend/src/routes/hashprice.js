import express from 'express';
import axios from 'axios';
import { getCache, setCache, getManualData } from '../cache/database.js';

const router = express.Router();

// Calculate moving average
function calculateMA(data, period) {
  if (data.length < period) return null;
  const slice = data.slice(-period);
  return slice.reduce((sum, val) => sum + val, 0) / period;
}

// Get hashprice data
router.get('/', async (req, res) => {
  const cacheKey = 'hashprice';

  try {
    const cached = getCache(cacheKey);
    if (cached && !cached.stale) {
      return res.json({
        ...cached.data,
        cached: true,
        fetchedAt: cached.fetchedAt
      });
    }

    // Try to fetch from multiple sources
    let hashpriceData = null;

    // Method 1: Try Luxor Hashrate Index (if they have public API)
    try {
      // This would be the Hashrate Index API if available
      // For now, we'll use the fallback calculation method
      throw new Error('Using fallback');
    } catch (e) {
      // Fallback: Calculate from components
      hashpriceData = await calculateHashprice();
    }

    // Merge with manual data if available
    const manualData = getManualData('hashprice', 'hashprice');
    if (manualData.length > 0) {
      hashpriceData.manualEntries = manualData;
    }

    const hashpriceValues = hashpriceData.history.map(d => d.hashprice);
    const ma30 = calculateMA(hashpriceValues, 30);
    const ma90 = calculateMA(hashpriceValues, 90);

    const result = {
      current: hashpriceData.current,
      history: hashpriceData.history,
      ma30,
      ma90,
      minerBreakeven: {
        low: 0.03, // $/TH/s/day at $0.04/kWh with S21
        high: 0.05 // $/TH/s/day at $0.07/kWh with S21
      },
      btcPrice: hashpriceData.btcPrice,
      networkHashrate: hashpriceData.networkHashrate,
      blockReward: 3.125, // Post April 2024 halving
      halvings: [
        { date: '2012-11-28', block: 210000, reward: 25 },
        { date: '2016-07-09', block: 420000, reward: 12.5 },
        { date: '2020-05-11', block: 630000, reward: 6.25 },
        { date: '2024-04-20', block: 840000, reward: 3.125 }
      ],
      source: hashpriceData.source,
      methodology: 'hashprice = (block_reward × BTC_price + avg_fees) / network_hashrate'
    };

    setCache(cacheKey, result, 15);

    res.json({
      ...result,
      cached: false,
      fetchedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching hashprice:', error);
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

async function calculateHashprice() {
  // Fetch BTC price from CoinGecko
  const priceResponse = await axios.get(
    'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
    { timeout: 10000 }
  );
  const btcPrice = priceResponse.data.bitcoin.usd;

  // Fetch network hashrate from blockchain.info
  const hashrateResponse = await axios.get(
    'https://blockchain.info/q/hashrate',
    { timeout: 10000 }
  );
  // blockchain.info returns in GH/s, convert to TH/s
  const networkHashrateTH = hashrateResponse.data / 1000;

  // Fetch historical hashrate for chart
  const hashHistory = await axios.get(
    'https://api.blockchain.info/charts/hash-rate?timespan=1year&format=json',
    { timeout: 15000 }
  );

  // Fetch historical BTC price
  const priceHistory = await axios.get(
    'https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=365',
    { timeout: 15000 }
  );

  // Calculate historical hashprice
  const blockReward = 3.125;
  const blocksPerDay = 144;
  const avgFeesPerBlock = 0.5; // Approximate average fees in BTC

  // Create price lookup map
  const priceMap = new Map();
  priceHistory.data.prices.forEach(([timestamp, price]) => {
    const date = new Date(timestamp).toISOString().split('T')[0];
    priceMap.set(date, price);
  });

  const history = hashHistory.data.values.map(point => {
    const date = new Date(point.x * 1000).toISOString().split('T')[0];
    const hashrateEH = point.y / 1e9; // Convert to EH/s
    const hashrateTH = point.y / 1e3; // Convert to TH/s

    const price = priceMap.get(date) || btcPrice;

    // Daily revenue per TH/s
    // Formula: (blocks_per_day × (block_reward + avg_fees) × btc_price) / network_hashrate_TH
    const dailyRevenue = (blocksPerDay * (blockReward + avgFeesPerBlock) * price) / hashrateTH;

    return {
      date,
      hashprice: dailyRevenue,
      hashrate: hashrateEH,
      btcPrice: price
    };
  }).filter(d => d.hashprice && !isNaN(d.hashprice) && d.hashprice < 1); // Filter outliers

  // Calculate current hashprice
  const currentHashprice = (blocksPerDay * (blockReward + avgFeesPerBlock) * btcPrice) / networkHashrateTH;

  return {
    current: currentHashprice,
    history,
    btcPrice,
    networkHashrate: networkHashrateTH,
    source: 'Calculated from CoinGecko + Blockchain.info'
  };
}

// Get hashprice with BTC overlay
router.get('/with-btc', async (req, res) => {
  const cacheKey = 'hashprice-with-btc';

  try {
    const cached = getCache(cacheKey);
    if (cached && !cached.stale) {
      return res.json({
        ...cached.data,
        cached: true,
        fetchedAt: cached.fetchedAt
      });
    }

    const hashpriceData = await calculateHashprice();

    const result = {
      data: hashpriceData.history.map(d => ({
        date: d.date,
        hashprice: d.hashprice,
        btcPrice: d.btcPrice,
        hashrate: d.hashrate
      })),
      current: {
        hashprice: hashpriceData.current,
        btcPrice: hashpriceData.btcPrice,
        hashrate: hashpriceData.networkHashrate / 1e9 // Convert to EH/s
      },
      source: hashpriceData.source
    };

    setCache(cacheKey, result, 15);

    res.json({
      ...result,
      cached: false,
      fetchedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching hashprice with BTC:', error);
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

export default router;
