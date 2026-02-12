import express from 'express';
import { getCache, setCache, getManualData, addManualData, getImecMilestones, addImecMilestone, updateImecMilestone } from '../cache/database.js';

const router = express.Router();

// Get trade route data
router.get('/', async (req, res) => {
  const cacheKey = 'trade-routes';

  try {
    const cached = getCache(cacheKey);
    if (cached && !cached.stale) {
      return res.json({
        ...cached.data,
        cached: true,
        fetchedAt: cached.fetchedAt
      });
    }

    // Get manual Suez data
    const suezData = getManualData('trade', 'suez_transits');
    const suezTonnage = getManualData('trade', 'suez_tonnage');

    // Get IMEC milestones
    const imecMilestones = getImecMilestones();

    const result = {
      suez: {
        transits: suezData.map(d => ({
          date: d.date,
          value: d.value,
          notes: d.notes
        })),
        tonnage: suezTonnage.map(d => ({
          date: d.date,
          value: d.value,
          notes: d.notes
        })),
        currentMonth: suezData[0] || null,
        yoyChange: calculateYoY(suezData),
        context: 'Suez Canal handles ~12-15% of global trade. Disruptions (Houthi attacks, Ever Given) impact global shipping costs.',
        source: 'Suez Canal Authority (manual entry)'
      },
      imec: {
        milestones: imecMilestones.map(m => ({
          id: m.id,
          title: m.title,
          description: m.description,
          date: m.date,
          status: m.status
        })),
        description: 'India-Middle East-Europe Economic Corridor - Alternative to China\'s Belt and Road Initiative',
        partners: ['India', 'UAE', 'Saudi Arabia', 'Jordan', 'Israel', 'EU'],
        components: ['Rail links', 'Shipping lanes', 'Fiber optic cables', 'Energy pipelines']
      },
      alternatives: {
        capeOfGoodHope: 'Alternative route when Suez is disrupted (+7-10 days)',
        northSeaRoute: 'Arctic passage, increasingly viable due to climate change',
        imec: 'Future rail/shipping alternative through Middle East'
      }
    };

    setCache(cacheKey, result, 60 * 24);

    res.json({
      ...result,
      cached: false,
      fetchedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching trade routes:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add Suez Canal data
router.post('/suez', (req, res) => {
  const { metric, value, date, notes } = req.body;

  if (!metric || value === undefined || !date) {
    return res.status(400).json({ error: 'Metric, value, and date are required' });
  }

  const validMetrics = ['suez_transits', 'suez_tonnage'];
  if (!validMetrics.includes(metric)) {
    return res.status(400).json({ error: `Metric must be one of: ${validMetrics.join(', ')}` });
  }

  try {
    addManualData('trade', metric, parseFloat(value), date, notes);
    setCache('trade-routes', null, 0);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add IMEC milestone
router.post('/imec', (req, res) => {
  const { title, description, date, status } = req.body;

  if (!title || !date) {
    return res.status(400).json({ error: 'Title and date are required' });
  }

  const validStatuses = ['planned', 'in-progress', 'completed'];
  if (status && !validStatuses.includes(status)) {
    return res.status(400).json({ error: `Status must be one of: ${validStatuses.join(', ')}` });
  }

  try {
    addImecMilestone(title, description, date, status || 'planned');
    setCache('trade-routes', null, 0);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update IMEC milestone
router.put('/imec/:id', (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  try {
    updateImecMilestone(parseInt(id), updates);
    setCache('trade-routes', null, 0);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

function calculateYoY(data) {
  if (data.length < 2) return null;

  const current = data[0];
  const yearAgo = data.find(d => {
    const daysDiff = (new Date(current.date) - new Date(d.date)) / (1000 * 60 * 60 * 24);
    return daysDiff >= 365;
  });

  if (!yearAgo) return null;

  return {
    change: current.value - yearAgo.value,
    percentage: ((current.value - yearAgo.value) / yearAgo.value) * 100
  };
}

export default router;
