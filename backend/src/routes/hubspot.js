import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { upsertKeyVaultEntry, getKeyVaultValue, deleteKeyVaultEntry, getKeyVaultEntries, getHubspotClassifications, getHubspotClassificationStats, upsertHubspotClassification, bulkUpsertHubspotClassifications } from '../cache/database.js';

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

// ─── Local Classification Routes (stored in Coppice DB, NOT pushed to HubSpot) ───

// List locally classified contacts with search + filters
router.get('/local-contacts', (req, res) => {
  const tenantId = req.tenantId;
  try {
    const { limit, offset, industry, reason, materials, classified, q } = req.query;
    const result = getHubspotClassifications(tenantId, {
      limit: parseInt(limit) || 50,
      offset: parseInt(offset) || 0,
      industry: industry || undefined,
      reason: reason || undefined,
      materials: materials || undefined,
      classified: classified === 'true' ? true : classified === 'false' ? false : undefined,
      search: q || undefined,
    });
    res.json({ ...result, configured: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Local classification stats
router.get('/local-stats', (req, res) => {
  const tenantId = req.tenantId;
  try {
    const stats = getHubspotClassificationStats(tenantId);
    res.json({ ...stats, configured: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update single contact classification locally
router.patch('/local-contacts/:id/classify', (req, res) => {
  const tenantId = req.tenantId;
  try {
    const { industry, reason, materials, reasoning } = req.body;
    upsertHubspotClassification(tenantId, {
      hubspot_id: req.params.id,
      name: req.body.name || null,
      email: req.body.email || null,
      company: req.body.company || null,
      title: req.body.title || null,
      domain: req.body.domain || null,
      industry, reason, materials,
      reasoning: reasoning || null,
      confidence: req.body.confidence || 50,
    });
    res.json({ ok: true, id: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk upsert local classifications
router.post('/local-contacts/bulk-classify', (req, res) => {
  const tenantId = req.tenantId;
  try {
    const { contacts } = req.body;
    if (!contacts?.length) return res.status(400).json({ error: 'No contacts provided' });
    const result = bulkUpsertHubspotClassifications(tenantId, contacts);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── HubSpot API-backed routes (kept for search + pipeline) ───

// Search contacts with classification filters (still reads from HubSpot API)
router.get('/contacts/search-classified', async (req, res) => {
  const tenantId = req.tenantId;
  const hs = await import('../services/hubspotService.js');
  if (!hs.isConfigured(tenantId)) return res.json({ contacts: [], configured: false });
  try {
    const { q, industry, reason, materials, classified, limit } = req.query;
    const result = await hs.searchContactsWithClassification(q || '', {
      industry: industry || undefined,
      reason: reason || undefined,
      materials: materials || undefined,
      classified: classified === 'true' ? true : classified === 'false' ? false : undefined,
      limit: parseInt(limit) || 50,
    }, tenantId);
    res.json({ ...result, configured: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List contacts with classification data (HubSpot API)
router.get('/contacts', async (req, res) => {
  const tenantId = req.tenantId;
  const hs = await import('../services/hubspotService.js');
  if (!hs.isConfigured(tenantId)) return res.json({ contacts: [], configured: false });
  try {
    const { limit, after, classified } = req.query;
    const result = await hs.listContacts({
      limit: parseInt(limit) || 50,
      after: after || undefined,
      classified: classified === 'true' ? true : classified === 'false' ? false : undefined,
      tenantId,
    });
    res.json({ ...result, configured: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Classification stats (HubSpot API - kept for comparison)
router.get('/classification-stats', async (req, res) => {
  const tenantId = req.tenantId;
  const hs = await import('../services/hubspotService.js');
  if (!hs.isConfigured(tenantId)) return res.json({ classified: 0, unclassified: 0, total: 0, configured: false });
  try {
    const stats = await hs.getClassificationStats(tenantId);
    res.json({ ...stats, configured: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update single contact classification (HubSpot API)
router.patch('/contacts/:id/classify', async (req, res) => {
  const tenantId = req.tenantId;
  const hs = await import('../services/hubspotService.js');
  if (!hs.isConfigured(tenantId)) return res.status(400).json({ error: 'HubSpot not configured' });
  try {
    const result = await hs.updateContactClassification(req.params.id, req.body, tenantId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk classify contacts (HubSpot API)
router.post('/contacts/bulk-classify', async (req, res) => {
  const tenantId = req.tenantId;
  const hs = await import('../services/hubspotService.js');
  if (!hs.isConfigured(tenantId)) return res.status(400).json({ error: 'HubSpot not configured' });
  try {
    const { updates } = req.body; // [{ id, industry, reason, materials }]
    if (!updates?.length) return res.status(400).json({ error: 'No updates provided' });
    const result = await hs.bulkUpdateClassifications(updates, tenantId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
