import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { upsertKeyVaultEntry, getKeyVaultValue, deleteKeyVaultEntry, getKeyVaultEntries } from '../cache/database.js';

const router = Router();
router.use(authenticate);

// Check if HubSpot is configured for this tenant
router.get('/status', async (req, res) => {
  const tenantId = req.tenantId;
  const hs = await import('../services/hubspotService.js');
  const configured = hs.isConfigured(tenantId);
  res.json({ configured });
});

// Save HubSpot API key to vault
router.post('/connect', async (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey?.trim()) return res.status(400).json({ error: 'API key required' });

  const tenantId = req.tenantId;

  // Validate the key by making a test call
  try {
    const testRes = await fetch('https://api.hubapi.com/crm/v3/objects/contacts?limit=1', {
      headers: { 'Authorization': `Bearer ${apiKey.trim()}`, 'Content-Type': 'application/json' },
    });
    if (!testRes.ok) {
      const err = await testRes.text();
      return res.status(400).json({ error: `Invalid API key: HubSpot returned ${testRes.status}` });
    }
  } catch (e) {
    return res.status(400).json({ error: `Could not reach HubSpot: ${e.message}` });
  }

  upsertKeyVaultEntry({
    tenantId,
    service: 'hubspot',
    keyName: 'api_key',
    keyValue: apiKey.trim(),
    addedBy: req.user?.id || 'user',
  });

  res.json({ ok: true, configured: true });
});

// Disconnect HubSpot
router.post('/disconnect', async (req, res) => {
  const tenantId = req.tenantId;
  const entries = getKeyVaultEntries(tenantId);
  const hsEntry = entries.find(e => e.service === 'hubspot' && e.key_name === 'api_key');
  if (hsEntry) deleteKeyVaultEntry(hsEntry.id, tenantId);
  res.json({ ok: true, configured: false });
});

router.get('/pipeline', async (req, res) => {
  const tenantId = req.tenantId;
  const hs = await import('../services/hubspotService.js');
  if (!hs.isConfigured(tenantId)) {
    return res.json({ total_deals: 0, total_value: 0, by_stage: {}, configured: false });
  }
  try {
    const stats = await hs.getPipelineStats(tenantId);
    res.json({ ...stats, configured: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/contacts/search', async (req, res) => {
  const tenantId = req.tenantId;
  const hs = await import('../services/hubspotService.js');
  if (!hs.isConfigured(tenantId)) return res.json({ results: [], configured: false });
  try {
    const results = await hs.searchContacts(req.query.q || '', tenantId);
    res.json({ results, configured: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/companies/search', async (req, res) => {
  const tenantId = req.tenantId;
  const hs = await import('../services/hubspotService.js');
  if (!hs.isConfigured(tenantId)) return res.json({ results: [], configured: false });
  try {
    const results = await hs.searchCompanies(req.query.q || '', tenantId);
    res.json({ results, configured: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/activity', async (req, res) => {
  const tenantId = req.tenantId;
  const hs = await import('../services/hubspotService.js');
  if (!hs.isConfigured(tenantId)) return res.json({ results: [], configured: false });
  try {
    const results = await hs.getRecentActivity(parseInt(req.query.limit) || 20, tenantId);
    res.json({ results, configured: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
