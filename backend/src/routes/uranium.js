import express from 'express';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { getCache, setCache, getManualData, addManualData } from '../cache/database.js';

const router = express.Router();

// Get uranium prices
router.get('/', async (req, res) => {
  const cacheKey = 'uranium-prices';

  try {
    const cached = getCache(cacheKey);
    if (cached && !cached.stale) {
      return res.json({
        ...cached.data,
        cached: true,
        fetchedAt: cached.fetchedAt
      });
    }

    // Try to scrape from Trading Economics or other sources
    let uraniumData = null;

    try {
      uraniumData = await scrapeUraniumPrices();
    } catch (e) {
      console.log('Scraping failed, using manual data:', e.message);
    }

    // Get manual data entries
    const manualSpot = getManualData('uranium', 'spot');
    const manualTerm = getManualData('uranium', 'term');

    // Merge data sources
    const spotHistory = mergeDataSources(uraniumData?.spotHistory || [], manualSpot);
    const termHistory = mergeDataSources(uraniumData?.termHistory || [], manualTerm);

    const result = {
      spot: {
        current: manualSpot[0]?.value || uraniumData?.spot || null,
        history: spotHistory
      },
      term: {
        current: manualTerm[0]?.value || uraniumData?.term || null,
        history: termHistory
      },
      spread: calculateSpread(manualSpot[0]?.value || uraniumData?.spot, manualTerm[0]?.value || uraniumData?.term),
      keyEvents: [
        { date: '2022-02-24', event: 'Russia-Ukraine War Begins', impact: 'Supply concerns' },
        { date: '2023-07-26', event: 'Niger Coup', impact: 'Major supply disruption risk' },
        { date: '2024-01-08', event: 'Kazatomprom Production Cut', impact: '10% reduction announced' },
        { date: '2024-08-12', event: 'US Russian Uranium Ban', impact: 'Import restrictions' }
      ],
      sources: {
        primary: ['UxC', 'TradeTech', 'Numerco'],
        fallback: ['Trading Economics', 'nuclear-economics.com'],
        note: 'Canonical sources (UxC, TradeTech) are paywalled. Use manual entry for accurate data.'
      },
      manualEntryRequired: true
    };

    // Only cache if we have some data
    if (result.spot.current || result.term.current) {
      setCache(cacheKey, result, 60 * 24); // Cache for 24 hours (weekly data)
    }

    res.json({
      ...result,
      cached: false,
      fetchedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching uranium prices:', error);
    const cached = getCache(cacheKey);
    if (cached) {
      return res.json({
        ...cached.data,
        cached: true,
        stale: true,
        fetchedAt: cached.fetchedAt
      });
    }

    // Return structure for manual entry
    res.json({
      spot: { current: null, history: [] },
      term: { current: null, history: [] },
      spread: null,
      keyEvents: [],
      sources: { note: 'Data unavailable. Please use manual entry.' },
      manualEntryRequired: true,
      error: error.message,
      fetchedAt: new Date().toISOString()
    });
  }
});

// Add manual uranium price entry
router.post('/manual', (req, res) => {
  const { type, value, date, notes } = req.body;

  if (!type || !value || !date) {
    return res.status(400).json({ error: 'Type, value, and date are required' });
  }

  if (!['spot', 'term'].includes(type)) {
    return res.status(400).json({ error: 'Type must be "spot" or "term"' });
  }

  try {
    addManualData('uranium', type, parseFloat(value), date, notes);
    // Invalidate cache
    setCache('uranium-prices', null, 0);
    res.json({ success: true, message: 'Data added successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add event annotation
router.post('/annotation', (req, res) => {
  const { date, event, impact } = req.body;

  if (!date || !event) {
    return res.status(400).json({ error: 'Date and event are required' });
  }

  try {
    addManualData('uranium_events', 'annotation', 0, date, JSON.stringify({ event, impact }));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

async function scrapeUraniumPrices() {
  // Try Trading Economics
  try {
    const response = await axios.get('https://tradingeconomics.com/commodity/uranium', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000
    });

    const $ = cheerio.load(response.data);

    // Extract current price
    const priceText = $('[id="p"]').first().text().trim();
    const price = parseFloat(priceText);

    if (!isNaN(price)) {
      return {
        spot: price,
        term: null, // Term price not usually available from this source
        spotHistory: [],
        termHistory: [],
        source: 'Trading Economics'
      };
    }
  } catch (e) {
    console.log('Trading Economics scrape failed:', e.message);
  }

  return null;
}

function mergeDataSources(scraped, manual) {
  const combined = new Map();

  // Add scraped data
  scraped.forEach(item => {
    combined.set(item.date, { date: item.date, value: item.value, source: 'scraped' });
  });

  // Override with manual data (more reliable)
  manual.forEach(item => {
    combined.set(item.date, { date: item.date, value: item.value, source: 'manual', notes: item.notes });
  });

  return Array.from(combined.values()).sort((a, b) => new Date(b.date) - new Date(a.date));
}

function calculateSpread(spot, term) {
  if (!spot || !term) return null;
  return {
    absolute: term - spot,
    percentage: ((term - spot) / spot) * 100
  };
}

export default router;
