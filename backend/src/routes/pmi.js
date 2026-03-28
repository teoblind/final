import express from 'express';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { getCache, setCache } from '../cache/database.js';

const router = express.Router();

// PMI data structure
const PMI_COUNTRIES = [
  { code: 'US', name: 'United States', source: 'ISM', id: 'united-states' },
  { code: 'EU', name: 'Eurozone', source: 'S&P Global/HCOB', id: 'euro-area' },
  { code: 'CN', name: 'China', source: 'Caixin', id: 'china' },
  { code: 'JP', name: 'Japan', source: 'Jibun Bank', id: 'japan' },
  { code: 'IN', name: 'India', source: 'S&P Global', id: 'india' },
  { code: 'KR', name: 'South Korea', source: 'S&P Global', id: 'south-korea' },
  { code: 'TW', name: 'Taiwan', source: 'S&P Global', id: 'taiwan' },
  { code: 'VN', name: 'Vietnam', source: 'S&P Global', id: 'vietnam' }
];

// Get all PMI data
router.get('/', async (req, res) => {
  const cacheKey = 'pmi-data';

  try {
    const cached = getCache(cacheKey);
    if (cached && !cached.stale) {
      return res.json({
        ...cached.data,
        cached: true,
        fetchedAt: cached.fetchedAt
      });
    }

    // Try to fetch PMI data
    const pmiData = await fetchPMIData();

    const result = {
      countries: pmiData,
      lastUpdated: new Date().toISOString(),
      sources: PMI_COUNTRIES.map(c => ({ country: c.name, source: c.source })),
      legend: {
        green: '> 52 (Expansion)',
        yellow: '48-52 (Neutral)',
        red: '< 48 (Contraction)'
      },
      note: 'PMI data updates monthly.'
    };

    setCache(cacheKey, result, 60 * 24); // Cache for 24 hours

    res.json({
      ...result,
      cached: false,
      fetchedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching PMI data:', error);
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

// Get historical PMI for a country
router.get('/history/:country', async (req, res) => {
  const { country } = req.params;
  const cacheKey = `pmi-history-${country}`;

  try {
    const cached = getCache(cacheKey);
    if (cached && !cached.stale) {
      return res.json({
        ...cached.data,
        cached: true,
        fetchedAt: cached.fetchedAt
      });
    }

    const result = {
      country,
      history: [],
      source: 'Scraped data'
    };

    setCache(cacheKey, result, 60 * 24);

    res.json({
      ...result,
      cached: false,
      fetchedAt: new Date().toISOString()
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

async function fetchPMIData() {
  const results = [];

  for (const country of PMI_COUNTRIES) {
    try {
      // Try to scrape Trading Economics
      const response = await axios.get(
        `https://tradingeconomics.com/${country.id}/manufacturing-pmi`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          },
          timeout: 10000
        }
      );

      const $ = cheerio.load(response.data);
      const pmiValue = parseFloat($('[id="p"]').first().text().trim());

      results.push({
        code: country.code,
        name: country.name,
        source: country.source,
        headline: isNaN(pmiValue) ? null : pmiValue,
        newOrders: null,
        employment: null,
        pricesPaid: null,
        supplierDeliveries: null,
        date: null,
        scraped: true,
        dataSource: 'scraped'
      });

      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (e) {
      console.log(`Failed to fetch PMI for ${country.name}:`, e.message);
      results.push({
        code: country.code,
        name: country.name,
        source: country.source,
        headline: null,
        newOrders: null,
        employment: null,
        pricesPaid: null,
        supplierDeliveries: null,
        date: null,
        scraped: false,
        dataSource: 'scraped'
      });
    }
  }

  return results;
}

// Helper to determine PMI color
function getPMIColor(value) {
  if (value === null) return 'gray';
  if (value > 52) return 'green';
  if (value >= 48) return 'yellow';
  return 'red';
}

export default router;
