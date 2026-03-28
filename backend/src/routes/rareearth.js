import express from 'express';
import { getCache, setCache } from '../cache/database.js';

const router = express.Router();

// Rare earth elements we track
const RARE_EARTHS = [
  { symbol: 'NdPr', name: 'Neodymium-Praseodymium Oxide', unit: 'USD/kg', importance: 'Critical for permanent magnets, EV motors, wind turbines' },
  { symbol: 'Dy', name: 'Dysprosium Oxide', unit: 'USD/kg', importance: 'Heat resistance in magnets' },
  { symbol: 'Tb', name: 'Terbium Oxide', unit: 'USD/kg', importance: 'High-performance magnets' },
  { symbol: 'Ce', name: 'Cerium Oxide', unit: 'USD/kg', importance: 'Catalysts, polishing compounds' }
];

// Get rare earth prices
router.get('/', async (req, res) => {
  const cacheKey = 'rare-earth-prices';

  try {
    const cached = getCache(cacheKey);
    if (cached && !cached.stale) {
      return res.json({
        ...cached.data,
        cached: true,
        fetchedAt: cached.fetchedAt
      });
    }

    const elements = RARE_EARTHS.map(element => ({
      ...element,
      current: null,
      date: null,
      weekChange: null,
      yearChange: null,
      history: []
    }));

    const result = {
      elements,
      primary: elements.find(e => e.symbol === 'NdPr'),
      sources: {
        canonical: ['Shanghai Metals Market (metal.com)', 'Asian Metal', 'Argus Rare Earths'],
        note: 'Most sources are paywalled.',
        fallback: ['mineralprices.com', 'Trading Economics', 'Investing News Network']
      },
      marketContext: {
        chinaShare: '60%',
        note: 'China controls ~60% of rare earth mining and ~90% of processing'
      }
    };

    res.json({
      ...result,
      cached: false,
      fetchedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching rare earth prices:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get history for specific element
router.get('/history/:symbol', (req, res) => {
  const { symbol } = req.params;

  const validSymbols = RARE_EARTHS.map(e => e.symbol);
  if (!validSymbols.includes(symbol)) {
    return res.status(400).json({ error: `Symbol must be one of: ${validSymbols.join(', ')}` });
  }

  const element = RARE_EARTHS.find(e => e.symbol === symbol);

  res.json({
    ...element,
    history: [],
    fetchedAt: new Date().toISOString()
  });
});

export default router;
