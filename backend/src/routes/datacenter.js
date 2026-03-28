import express from 'express';
import axios from 'axios';
import { getCache, setCache, getDatacenterProjects, addDatacenterProject, getFiberDeals, addFiberDeal } from '../cache/database.js';

const router = express.Router();

// Regions we track
const REGIONS = [
  { code: 'PJM', name: 'Virginia/PJM', description: 'Data Center Alley - Largest concentration globally' },
  { code: 'ERCOT', name: 'Texas/ERCOT', description: 'Cheap power, growing AI/crypto infrastructure' },
  { code: 'IE', name: 'Ireland', description: 'EU data sovereignty, constrained grid' },
  { code: 'SG', name: 'Singapore', description: 'APAC hub, moratorium history' },
  { code: 'JP', name: 'Tokyo', description: 'Major financial hub' },
  { code: 'BR', name: 'Brazil', description: 'Emerging market, cheap hydro power' }
];

// Get data center power demand data
router.get('/', async (req, res) => {
  const cacheKey = 'datacenter-power';

  try {
    const cached = getCache(cacheKey);
    if (cached && !cached.stale) {
      return res.json({
        ...cached.data,
        cached: true,
        fetchedAt: cached.fetchedAt
      });
    }

    // Capacity data per region
    const capacityData = {};
    REGIONS.forEach(region => {
      capacityData[region.code] = {
        currentDemand: null,
        plannedAdditions: null,
        gridHeadroom: null
      };
    });

    // Get projects
    const projects = getDatacenterProjects();

    // Get fiber deals
    const fiberDeals = getFiberDeals();

    // Try to fetch EIA data for US regions
    let eiaData = null;
    try {
      eiaData = await fetchEIAData();
    } catch (e) {
      console.log('EIA data fetch failed:', e.message);
    }

    const result = {
      regions: REGIONS.map(region => ({
        ...region,
        ...capacityData[region.code],
        eiaData: eiaData?.[region.code] || null
      })),
      projects: projects.map(p => ({
        id: p.id,
        company: p.company,
        location: p.location,
        region: p.region,
        capacityMW: p.capacity_mw,
        status: p.status,
        expectedOnline: p.expected_online,
        notes: p.notes
      })),
      fiberDeals: fiberDeals.map(d => ({
        id: d.id,
        date: d.date,
        buyer: d.buyer,
        seller: d.seller,
        valueUSD: d.value_usd,
        capacity: d.capacity,
        description: d.description
      })),
      totals: {
        byRegion: calculateRegionTotals(projects),
        totalPlannedMW: projects.reduce((sum, p) => sum + (p.capacity_mw || 0), 0)
      },
      context: {
        bottleneck: 'Grid interconnection queues are 4-7 years in Virginia. Power is the new constraint for AI scaling.',
        trend: 'Hyperscalers increasingly looking at alternative regions (Texas, Brazil) for power availability.'
      },
      sources: ['EIA', 'PJM Interconnection Queue', 'ERCOT', 'Company Announcements']
    };

    setCache(cacheKey, result, 60 * 24);

    res.json({
      ...result,
      cached: false,
      fetchedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching datacenter data:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add data center project
router.post('/project', (req, res) => {
  const { company, location, region, capacity_mw, status, expected_online, notes } = req.body;

  if (!company || !location || !region) {
    return res.status(400).json({ error: 'Company, location, and region are required' });
  }

  try {
    addDatacenterProject({
      company,
      location,
      region,
      capacity_mw: capacity_mw ? parseFloat(capacity_mw) : null,
      status: status || 'announced',
      expected_online,
      notes
    });
    setCache('datacenter-power', null, 0);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add fiber deal
router.post('/fiber-deal', (req, res) => {
  const { date, buyer, seller, value_usd, capacity, description } = req.body;

  if (!date || !buyer || !seller) {
    return res.status(400).json({ error: 'Date, buyer, and seller are required' });
  }

  try {
    addFiberDeal({
      date,
      buyer,
      seller,
      value_usd: value_usd ? parseFloat(value_usd) : null,
      capacity,
      description
    });
    setCache('datacenter-power', null, 0);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get projects by region
router.get('/projects/:region', (req, res) => {
  const { region } = req.params;

  try {
    const projects = getDatacenterProjects(region);
    res.json({
      region,
      projects,
      totalMW: projects.reduce((sum, p) => sum + (p.capacity_mw || 0), 0),
      fetchedAt: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

async function fetchEIAData() {
  // EIA API requires API key
  const apiKey = process.env.EIA_API_KEY;
  if (!apiKey) {
    console.log('EIA API key not configured');
    return null;
  }

  try {
    // This would fetch actual EIA data
    // EIA integration not yet configured
    return null;
  } catch (e) {
    return null;
  }
}

function calculateRegionTotals(projects) {
  const totals = {};
  projects.forEach(p => {
    if (!totals[p.region]) {
      totals[p.region] = { count: 0, totalMW: 0 };
    }
    totals[p.region].count++;
    totals[p.region].totalMW += p.capacity_mw || 0;
  });
  return totals;
}

export default router;
