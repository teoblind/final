import express from 'express';
import { getCache, setCache, getImecMilestones, addImecMilestone, updateImecMilestone } from '../cache/database.js';

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

    // Get IMEC milestones
    const imecMilestones = getImecMilestones();

    const result = {
      suez: {
        transits: [],
        tonnage: [],
        currentMonth: null,
        yoyChange: null,
        context: 'Suez Canal handles ~12-15% of global trade. Disruptions (Houthi attacks, Ever Given) impact global shipping costs.',
        source: 'Suez Canal Authority'
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

export default router;
