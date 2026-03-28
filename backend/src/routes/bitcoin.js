import express from 'express';
import axios from 'axios';
import { getCache, setCache, getBtcWallets, addBtcWallet } from '../cache/database.js';

const router = express.Router();

// Known US Government Bitcoin wallets
const KNOWN_WALLETS = [
  {
    address: 'bc1qa5wkgaew2dkv56kfvj49j0av5nml45x9ek9hz6',
    label: 'US DOJ - Silk Road',
    seizure: 'Silk Road (2013-2022)',
    estimatedBTC: 69369
  },
  {
    address: 'bc1qmxjefnuy06v345v6vhwpwt05dztztmx4g3y7wp',
    label: 'US DOJ - Bitfinex',
    seizure: 'Bitfinex Hack Recovery (2022)',
    estimatedBTC: 94643
  },
  {
    address: '1FfmbHfnpaZjKFvyi1okTjJJusN455paPH',
    label: 'FBI - Silk Road',
    seizure: 'Silk Road Initial (2013)',
    estimatedBTC: 144336
  }
];

// Get US Strategic Bitcoin Reserve data
router.get('/reserve', async (req, res) => {
  const cacheKey = 'btc-reserve';

  try {
    const cached = getCache(cacheKey);
    if (cached && !cached.stale) {
      return res.json({
        ...cached.data,
        cached: true,
        fetchedAt: cached.fetchedAt
      });
    }

    // Get BTC price
    const priceRes = await axios.get(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
      { timeout: 10000 }
    );
    const btcPrice = priceRes.data.bitcoin.usd;

    // Get wallet balances from blockchain.info or blockchair
    const walletData = await Promise.all(
      KNOWN_WALLETS.map(async (wallet) => {
        try {
          const response = await axios.get(
            `https://blockchain.info/rawaddr/${wallet.address}?limit=0`,
            { timeout: 10000 }
          );
          const balanceBTC = response.data.final_balance / 1e8;
          return {
            ...wallet,
            balance: balanceBTC,
            balanceUSD: balanceBTC * btcPrice,
            lastUpdated: new Date().toISOString()
          };
        } catch (e) {
          // Return estimated balance if API fails
          return {
            ...wallet,
            balance: wallet.estimatedBTC,
            balanceUSD: wallet.estimatedBTC * btcPrice,
            estimated: true,
            lastUpdated: new Date().toISOString()
          };
        }
      })
    );

    // Combine with wallet entries from database
    const dbWallets = getBtcWallets();

    const totalBTC = walletData.reduce((sum, w) => sum + (w.balance || 0), 0);
    const totalUSD = totalBTC * btcPrice;

    // Historical data (simplified - would need proper on-chain analysis)
    const history = generateReserveHistory(btcPrice);

    const result = {
      wallets: walletData,
      totalBTC,
      totalUSD,
      btcPrice,
      history,
      sources: [
        'Blockchain.info',
        'DOJ Press Releases',
        'bitcointreasuries.net'
      ],
      disclaimer: 'Wallet balances may change due to sales, transfers, or newly identified wallets. Some addresses may be inactive or sold.'
    };

    setCache(cacheKey, result, 30);

    res.json({
      ...result,
      cached: false,
      fetchedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching BTC reserve:', error);
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

// Add a new wallet to track
router.post('/wallet', (req, res) => {
  const { address, label, description } = req.body;

  if (!address || !label) {
    return res.status(400).json({ error: 'Address and label are required' });
  }

  try {
    addBtcWallet(address, label, description);
    res.json({ success: true, message: 'Wallet added' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all tracked wallets
router.get('/wallets', (req, res) => {
  try {
    const wallets = getBtcWallets();
    res.json({ wallets });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get wallet balance
router.get('/wallet/:address', async (req, res) => {
  const { address } = req.params;
  const cacheKey = `wallet-${address}`;

  try {
    const cached = getCache(cacheKey);
    if (cached && !cached.stale) {
      return res.json({
        ...cached.data,
        cached: true,
        fetchedAt: cached.fetchedAt
      });
    }

    const [balanceRes, priceRes] = await Promise.all([
      axios.get(`https://blockchain.info/rawaddr/${address}?limit=5`, { timeout: 10000 }),
      axios.get('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd', { timeout: 10000 })
    ]);

    const balanceBTC = balanceRes.data.final_balance / 1e8;
    const btcPrice = priceRes.data.bitcoin.usd;

    const result = {
      address,
      balance: balanceBTC,
      balanceUSD: balanceBTC * btcPrice,
      btcPrice,
      txCount: balanceRes.data.n_tx,
      totalReceived: balanceRes.data.total_received / 1e8,
      totalSent: balanceRes.data.total_sent / 1e8,
      recentTxs: (balanceRes.data.txs || []).slice(0, 5).map(tx => ({
        hash: tx.hash,
        time: new Date(tx.time * 1000).toISOString(),
        result: tx.result / 1e8
      }))
    };

    setCache(cacheKey, result, 30);

    res.json({
      ...result,
      cached: false,
      fetchedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error(`Error fetching wallet ${address}:`, error);
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

// Generate simulated historical reserve data
function generateReserveHistory(currentBtcPrice) {
  const history = [];
  const now = new Date();

  // Key events in US BTC holdings
  const events = [
    { date: '2013-10-02', event: 'Silk Road Seizure', btc: 144000 },
    { date: '2017-01-01', event: 'Post Silk Road Sales', btc: 100000 },
    { date: '2020-11-05', event: 'Additional Silk Road Recovery', btc: 170000 },
    { date: '2022-02-08', event: 'Bitfinex Recovery', btc: 264000 },
    { date: '2023-03-01', event: 'Various Sales', btc: 200000 },
    { date: '2024-01-01', event: 'Current Holdings', btc: 210000 }
  ];

  // Generate monthly data points
  for (let i = 36; i >= 0; i--) {
    const date = new Date(now);
    date.setMonth(date.getMonth() - i);
    const dateStr = date.toISOString().split('T')[0];

    // Find applicable BTC amount
    let btc = 0;
    for (const event of events) {
      if (dateStr >= event.date) {
        btc = event.btc;
      }
    }

    // Estimate historical price (simplified)
    const priceMultiplier = 1 - (i * 0.02);
    const estimatedPrice = currentBtcPrice * Math.max(0.1, priceMultiplier);

    history.push({
      date: dateStr,
      btc,
      usd: btc * estimatedPrice,
      btcPrice: estimatedPrice
    });
  }

  return history;
}

export default router;
