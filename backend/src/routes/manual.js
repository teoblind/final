import express from 'express';
import { getManualData, addManualData } from '../cache/database.js';
import db from '../cache/database.js';

const router = express.Router();

// Categories for manual data entry
const CATEGORIES = {
  uranium: {
    metrics: ['spot', 'term'],
    description: 'Uranium U3O8 prices (USD/lb)'
  },
  rareearth: {
    metrics: ['NdPr', 'Dy', 'Tb', 'Ce'],
    description: 'Rare earth oxide prices (USD/kg)'
  },
  pmi: {
    metrics: ['US_headline', 'EU_headline', 'CN_headline', 'JP_headline', 'IN_headline', 'KR_headline', 'TW_headline', 'VN_headline'],
    description: 'Manufacturing PMI readings'
  },
  japan: {
    metrics: ['jgb_2y', 'jgb_5y', 'jgb_10y', 'jgb_30y', 'niip'],
    description: 'Japan macro data'
  },
  trade: {
    metrics: ['suez_transits', 'suez_tonnage'],
    description: 'Trade route metrics'
  },
  hashrate_share: {
    metrics: ['US', 'CN', 'RU', 'KZ', 'IR'],
    description: 'Global hashrate distribution (%)'
  },
  brazil_macro: {
    metrics: ['selic', 'ipca'],
    description: 'Brazil macro data'
  },
  brazil_energy: {
    metrics: ['installed_capacity', 'peak_demand', 'reservoir_level'],
    description: 'Brazil energy grid data'
  },
  brazil_minerals: {
    metrics: ['niobium_production', 'rare_earth_reserves', 'lithium_reserves'],
    description: 'Brazil mineral production/reserves'
  },
  datacenter: {
    metrics: ['PJM_demand', 'PJM_planned', 'PJM_headroom', 'ERCOT_demand', 'ERCOT_planned', 'ERCOT_headroom'],
    description: 'Data center power capacity (MW)'
  },
  btc_reserve: {
    metrics: ['total_btc', 'wallet_balance'],
    description: 'US Government BTC holdings'
  }
};

// Get all categories
router.get('/categories', (req, res) => {
  res.json({ categories: CATEGORIES });
});

// Get data for a category
router.get('/:category', (req, res) => {
  const { category } = req.params;
  const { metric, startDate, endDate } = req.query;

  if (!CATEGORIES[category]) {
    return res.status(400).json({
      error: `Invalid category. Valid categories: ${Object.keys(CATEGORIES).join(', ')}`
    });
  }

  try {
    const data = getManualData(category, metric, startDate, endDate);
    res.json({
      category,
      description: CATEGORIES[category].description,
      availableMetrics: CATEGORIES[category].metrics,
      data,
      fetchedAt: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add manual data entry
router.post('/', (req, res) => {
  const { category, metric, value, date, notes } = req.body;

  if (!category || !metric || value === undefined || !date) {
    return res.status(400).json({
      error: 'Category, metric, value, and date are required',
      example: {
        category: 'uranium',
        metric: 'spot',
        value: 85.50,
        date: '2024-01-15',
        notes: 'From UxC weekly report'
      }
    });
  }

  if (!CATEGORIES[category]) {
    return res.status(400).json({
      error: `Invalid category. Valid categories: ${Object.keys(CATEGORIES).join(', ')}`
    });
  }

  // Validate date format
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(date)) {
    return res.status(400).json({ error: 'Date must be in YYYY-MM-DD format' });
  }

  try {
    const result = addManualData(category, metric, parseFloat(value), date, notes);
    res.json({
      success: true,
      id: result.lastInsertRowid,
      message: `Added ${category}/${metric} = ${value} for ${date}`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Bulk add manual data
router.post('/bulk', (req, res) => {
  const { entries } = req.body;

  if (!entries || !Array.isArray(entries)) {
    return res.status(400).json({
      error: 'Entries array is required',
      example: {
        entries: [
          { category: 'uranium', metric: 'spot', value: 85.50, date: '2024-01-15' },
          { category: 'uranium', metric: 'spot', value: 84.75, date: '2024-01-08' }
        ]
      }
    });
  }

  const results = { success: 0, failed: 0, errors: [] };

  for (const entry of entries) {
    try {
      if (!entry.category || !entry.metric || entry.value === undefined || !entry.date) {
        results.failed++;
        results.errors.push({ entry, error: 'Missing required fields' });
        continue;
      }

      addManualData(entry.category, entry.metric, parseFloat(entry.value), entry.date, entry.notes);
      results.success++;
    } catch (error) {
      results.failed++;
      results.errors.push({ entry, error: error.message });
    }
  }

  res.json(results);
});

// Delete manual data entry
router.delete('/:id', (req, res) => {
  const { id } = req.params;

  try {
    db.prepare('DELETE FROM manual_data WHERE id = ?').run(parseInt(id));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Export all manual data
router.get('/export/all', (req, res) => {
  try {
    const data = db.prepare('SELECT * FROM manual_data ORDER BY category, metric, date DESC').all();

    // Group by category
    const grouped = {};
    data.forEach(row => {
      if (!grouped[row.category]) {
        grouped[row.category] = {};
      }
      if (!grouped[row.category][row.metric]) {
        grouped[row.category][row.metric] = [];
      }
      grouped[row.category][row.metric].push({
        date: row.date,
        value: row.value,
        notes: row.notes
      });
    });

    res.json({
      exportedAt: new Date().toISOString(),
      totalEntries: data.length,
      data: grouped
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Import data from backup
router.post('/import', (req, res) => {
  const { data } = req.body;

  if (!data || typeof data !== 'object') {
    return res.status(400).json({ error: 'Data object is required' });
  }

  let imported = 0;
  let errors = [];

  try {
    for (const [category, metrics] of Object.entries(data)) {
      for (const [metric, entries] of Object.entries(metrics)) {
        for (const entry of entries) {
          try {
            addManualData(category, metric, entry.value, entry.date, entry.notes);
            imported++;
          } catch (e) {
            errors.push({ category, metric, entry, error: e.message });
          }
        }
      }
    }

    res.json({
      success: true,
      imported,
      errors: errors.length,
      errorDetails: errors.slice(0, 10)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
