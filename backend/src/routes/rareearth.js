import express from 'express';
import { getCache, setCache, getManualData, addManualData } from '../cache/database.js';

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

    // Build result from manual data (primary source due to paywall issues)
    const elements = RARE_EARTHS.map(element => {
      const priceData = getManualData('rareearth', element.symbol);
      const latestPrice = priceData[0];

      // Calculate WoW change
      const weekAgo = priceData.find(d => {
        const daysDiff = (new Date() - new Date(d.date)) / (1000 * 60 * 60 * 24);
        return daysDiff >= 7;
      });

      // Calculate YoY change
      const yearAgo = priceData.find(d => {
        const daysDiff = (new Date() - new Date(d.date)) / (1000 * 60 * 60 * 24);
        return daysDiff >= 365;
      });

      return {
        ...element,
        current: latestPrice?.value || null,
        date: latestPrice?.date || null,
        weekChange: weekAgo && latestPrice
          ? ((latestPrice.value - weekAgo.value) / weekAgo.value) * 100
          : null,
        yearChange: yearAgo && latestPrice
          ? ((latestPrice.value - yearAgo.value) / yearAgo.value) * 100
          : null,
        history: priceData.map(d => ({
          date: d.date,
          value: d.value,
          notes: d.notes
        }))
      };
    });

    const result = {
      elements,
      primary: elements.find(e => e.symbol === 'NdPr'),
      sources: {
        canonical: ['Shanghai Metals Market (metal.com)', 'Asian Metal', 'Argus Rare Earths'],
        note: 'Most sources are paywalled. Manual entry is the primary data input method.',
        fallback: ['mineralprices.com', 'Trading Economics', 'Investing News Network']
      },
      marketContext: {
        chinaShare: '60%',
        note: 'China controls ~60% of rare earth mining and ~90% of processing'
      }
    };

    if (elements.some(e => e.current !== null)) {
      setCache(cacheKey, result, 60 * 24); // Cache for 24 hours
    }

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

// Add manual price entry
router.post('/manual', (req, res) => {
  const { symbol, value, date, notes } = req.body;

  if (!symbol || value === undefined || !date) {
    return res.status(400).json({ error: 'Symbol, value, and date are required' });
  }

  const validSymbols = RARE_EARTHS.map(e => e.symbol);
  if (!validSymbols.includes(symbol)) {
    return res.status(400).json({ error: `Symbol must be one of: ${validSymbols.join(', ')}` });
  }

  try {
    addManualData('rareearth', symbol, parseFloat(value), date, notes);
    setCache('rare-earth-prices', null, 0); // Invalidate cache
    res.json({ success: true });
  } catch (error) {
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

  try {
    const history = getManualData('rareearth', symbol);
    const element = RARE_EARTHS.find(e => e.symbol === symbol);

    res.json({
      ...element,
      history: history.map(d => ({
        date: d.date,
        value: d.value,
        notes: d.notes
      })),
      fetchedAt: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
