import { Router } from 'express';

const router = Router();

router.get('/pipeline', async (req, res) => {
  if (!process.env.HUBSPOT_API_KEY) {
    return res.json({ total_deals: 0, total_value: 0, by_stage: {}, configured: false });
  }
  try {
    const hs = await import('../services/hubspotService.js');
    const stats = await hs.getPipelineStats();
    res.json({ ...stats, configured: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/contacts/search', async (req, res) => {
  if (!process.env.HUBSPOT_API_KEY) return res.json({ results: [], configured: false });
  try {
    const hs = await import('../services/hubspotService.js');
    const results = await hs.searchContacts(req.query.q || '');
    res.json({ results, configured: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/companies/search', async (req, res) => {
  if (!process.env.HUBSPOT_API_KEY) return res.json({ results: [], configured: false });
  try {
    const hs = await import('../services/hubspotService.js');
    const results = await hs.searchCompanies(req.query.q || '');
    res.json({ results, configured: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/activity', async (req, res) => {
  if (!process.env.HUBSPOT_API_KEY) return res.json({ results: [], configured: false });
  try {
    const hs = await import('../services/hubspotService.js');
    const results = await hs.getRecentActivity(parseInt(req.query.limit) || 20);
    res.json({ results, configured: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
