/**
 * Lead Engine Routes — Discovery, outreach, and pipeline management.
 */

import express from 'express';
import { authenticate } from '../middleware/auth.js';
import {
  getLeads,
  getLead,
  updateLead,
  getLeadContacts,
  getOutreachLog,
  getLeadDiscoveryConfig,
  upsertLeadDiscoveryConfig,
  getLeadStats,
  getTenantFiles,
  getAllContacts,
  getOutreachReplies,
  getFollowupQueue,
} from '../cache/database.js';
import {
  discoverLeads,
  enrichContacts,
  generateOutreach,
  approveOutreach,
  runFullCycle,
  getLeadDetail,
} from '../services/leadEngine.js';
import { getSheetLeads, getSheetLeadStats } from '../services/sheetsLeadReader.js';

const router = express.Router();
router.use(authenticate);

// ─── Leads ──────────────────────────────────────────────────────────────────

router.get('/leads', async (req, res) => {
  try {
    const { status, limit } = req.query;
    // Try Google Sheets first, fall back to SQLite
    const sheetLeads = await getSheetLeads(req.user.tenantId, status || null, parseInt(limit) || 100);
    if (sheetLeads && sheetLeads.length > 0) {
      return res.json({ leads: sheetLeads });
    }
    const leads = getLeads(req.user.tenantId, status || null, parseInt(limit) || 100);
    const enriched = leads.map(l => {
      const contacts = getLeadContacts(req.user.tenantId, l.id);
      return { ...l, contactCount: contacts.length };
    });
    res.json({ leads: enriched });
  } catch (error) {
    console.error('Get leads error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/leads/:id', (req, res) => {
  try {
    const detail = getLeadDetail(req.user.tenantId, req.params.id);
    if (!detail) return res.status(404).json({ error: 'Lead not found' });
    res.json(detail);
  } catch (error) {
    console.error('Get lead detail error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/leads/:id', (req, res) => {
  try {
    const allowed = ['status', 'notes', 'agentNotes', 'priorityScore'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    updateLead(req.user.tenantId, req.params.id, updates);
    const lead = getLead(req.user.tenantId, req.params.id);
    res.json({ lead });
  } catch (error) {
    console.error('Update lead error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Stats ──────────────────────────────────────────────────────────────────

router.get('/stats', async (req, res) => {
  try {
    // Try Google Sheets first, fall back to SQLite
    const sheetStats = await getSheetLeadStats(req.user.tenantId);
    const stats = sheetStats || getLeadStats(req.user.tenantId);
    // Find the lead pipeline Google Sheet for this tenant
    const files = getTenantFiles(req.user.tenantId, { category: 'Leads' });
    const sheet = files.find(f => f.file_type === 'google_sheet');
    if (sheet) stats.sheetUrl = sheet.drive_url;
    res.json(stats);
  } catch (error) {
    console.error('Get lead stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Outreach Log ───────────────────────────────────────────────────────────

router.get('/outreach', (req, res) => {
  try {
    const { status, limit } = req.query;
    const log = getOutreachLog(req.user.tenantId, status || null, parseInt(limit) || 100);
    res.json({ outreach: log });
  } catch (error) {
    console.error('Get outreach log error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Contacts ──────────────────────────────────────────────────────────────

router.get('/contacts', (req, res) => {
  try {
    const { search, limit, offset } = req.query;
    const contacts = getAllContacts(req.user.tenantId, {
      search: search || undefined,
      limit: parseInt(limit) || 100,
      offset: parseInt(offset) || 0,
    });
    res.json({ contacts });
  } catch (error) {
    console.error('Get contacts error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Replies ───────────────────────────────────────────────────────────────

router.get('/replies', (req, res) => {
  try {
    const { limit } = req.query;
    const replies = getOutreachReplies(req.user.tenantId, parseInt(limit) || 50);
    res.json({ replies });
  } catch (error) {
    console.error('Get replies error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Follow-ups ────────────────────────────────────────────────────────────

router.get('/followups', (req, res) => {
  try {
    const config = getLeadDiscoveryConfig(req.user.tenantId);
    const delayDays = config?.followup_delay_days || 5;
    const followups = getFollowupQueue(req.user.tenantId, delayDays);
    res.json({ followups });
  } catch (error) {
    console.error('Get followups error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Config ─────────────────────────────────────────────────────────────────

router.get('/config', (req, res) => {
  try {
    const config = getLeadDiscoveryConfig(req.user.tenantId);
    res.json({ config: config || null });
  } catch (error) {
    console.error('Get config error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/config', (req, res) => {
  try {
    const config = { tenantId: req.user.tenantId, ...req.body };
    upsertLeadDiscoveryConfig(config);
    const updated = getLeadDiscoveryConfig(req.user.tenantId);
    res.json({ config: updated });
  } catch (error) {
    console.error('Update config error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Actions ────────────────────────────────────────────────────────────────

router.post('/run-cycle', async (req, res) => {
  try {
    const result = await runFullCycle(req.user.tenantId);
    res.json(result);
  } catch (error) {
    console.error('Run cycle error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/discover', async (req, res) => {
  try {
    const result = await discoverLeads(req.user.tenantId);
    res.json(result);
  } catch (error) {
    console.error('Discover error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/enrich', async (req, res) => {
  try {
    const result = await enrichContacts(req.user.tenantId);
    res.json(result);
  } catch (error) {
    console.error('Enrich error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/generate-outreach', async (req, res) => {
  try {
    const result = await generateOutreach(req.user.tenantId);
    res.json(result);
  } catch (error) {
    console.error('Generate outreach error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/outreach/:id/approve', (req, res) => {
  try {
    const result = approveOutreach(req.user.tenantId, req.params.id, req.user.name || req.user.email);
    res.json(result);
  } catch (error) {
    console.error('Approve outreach error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
