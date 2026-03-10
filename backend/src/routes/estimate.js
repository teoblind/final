/**
 * DACP Construction — Estimating Routes
 */

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authenticate } from '../middleware/auth.js';
import {
  getDacpBidRequests,
  getDacpBidRequest,
  getDacpEstimates,
  getDacpEstimate,
  updateDacpEstimate,
  getDacpJobs,
  getDacpJob,
  getDacpFieldReports,
  createDacpFieldReport,
  getDacpPricing,
  getDacpStats,
} from '../cache/database.js';
import {
  generateEstimate,
  processInboundRequest,
  draftClarificationEmail,
  draftQuoteEmail,
} from '../services/estimateBot.js';

const router = express.Router();
router.use(authenticate);

// ─── Inbox (Bid Requests) ───────────────────────────────────────────────────

router.get('/inbox', (req, res) => {
  try {
    const status = req.query.status || null;
    const bids = getDacpBidRequests(req.user.tenantId, status);
    const parsed = bids.map(b => ({
      ...b,
      attachments: b.attachments_json ? JSON.parse(b.attachments_json) : [],
      scope: b.scope_json ? JSON.parse(b.scope_json) : {},
      missing_info: b.missing_info_json ? JSON.parse(b.missing_info_json) : [],
    }));
    res.json({ bidRequests: parsed });
  } catch (error) {
    console.error('Get inbox error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/inbox/:id', (req, res) => {
  try {
    const bid = getDacpBidRequest(req.user.tenantId, req.params.id);
    if (!bid) return res.status(404).json({ error: 'Bid request not found' });
    const analysis = processInboundRequest(bid);
    res.json({ bidRequest: bid, analysis });
  } catch (error) {
    console.error('Get bid request error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/inbox/:id/estimate', (req, res) => {
  try {
    const bid = getDacpBidRequest(req.user.tenantId, req.params.id);
    if (!bid) return res.status(404).json({ error: 'Bid request not found' });
    const result = generateEstimate(bid, req.user.tenantId);
    res.json(result);
  } catch (error) {
    console.error('Generate estimate error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Estimates ──────────────────────────────────────────────────────────────

router.get('/estimates', (req, res) => {
  try {
    const estimates = getDacpEstimates(req.user.tenantId);
    const parsed = estimates.map(e => ({
      ...e,
      line_items: e.line_items_json ? JSON.parse(e.line_items_json) : [],
    }));
    res.json({ estimates: parsed });
  } catch (error) {
    console.error('Get estimates error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/estimates/:id', (req, res) => {
  try {
    const estimate = getDacpEstimate(req.user.tenantId, req.params.id);
    if (!estimate) return res.status(404).json({ error: 'Estimate not found' });
    const emailDraft = draftQuoteEmail(estimate);
    res.json({ estimate, emailDraft });
  } catch (error) {
    console.error('Get estimate error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/estimates/:id', (req, res) => {
  try {
    const updates = {};
    const allowed = ['status', 'subtotal', 'overhead_pct', 'profit_pct', 'mobilization', 'total_bid', 'notes'];
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (req.body.lineItems) updates.lineItems = req.body.lineItems;
    updateDacpEstimate(req.user.tenantId, req.params.id, updates);
    const estimate = getDacpEstimate(req.user.tenantId, req.params.id);
    res.json({ estimate });
  } catch (error) {
    console.error('Update estimate error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/estimates/:id/send', (req, res) => {
  try {
    updateDacpEstimate(req.user.tenantId, req.params.id, { status: 'sent' });
    const estimate = getDacpEstimate(req.user.tenantId, req.params.id);
    const emailDraft = draftQuoteEmail(estimate);
    res.json({ estimate, emailDraft, message: 'Estimate marked as sent' });
  } catch (error) {
    console.error('Send estimate error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Jobs ───────────────────────────────────────────────────────────────────

router.get('/jobs', (req, res) => {
  try {
    const status = req.query.status || null;
    const jobs = getDacpJobs(req.user.tenantId, status);
    res.json({ jobs });
  } catch (error) {
    console.error('Get jobs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/jobs/:id', (req, res) => {
  try {
    const job = getDacpJob(req.user.tenantId, req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const fieldReports = getDacpFieldReports(req.user.tenantId, req.params.id);
    const parsed = fieldReports.map(r => ({
      ...r,
      work: r.work_json ? JSON.parse(r.work_json) : [],
      materials: r.materials_json ? JSON.parse(r.materials_json) : [],
      labor: r.labor_json ? JSON.parse(r.labor_json) : {},
      equipment: r.equipment_json ? JSON.parse(r.equipment_json) : [],
      issues: r.issues_json ? JSON.parse(r.issues_json) : [],
    }));
    res.json({ job, fieldReports: parsed });
  } catch (error) {
    console.error('Get job error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Field Reports ──────────────────────────────────────────────────────────

router.get('/field-reports', (req, res) => {
  try {
    const jobId = req.query.jobId || null;
    const reports = getDacpFieldReports(req.user.tenantId, jobId);
    const parsed = reports.map(r => ({
      ...r,
      work: r.work_json ? JSON.parse(r.work_json) : [],
      materials: r.materials_json ? JSON.parse(r.materials_json) : [],
      labor: r.labor_json ? JSON.parse(r.labor_json) : {},
      equipment: r.equipment_json ? JSON.parse(r.equipment_json) : [],
      issues: r.issues_json ? JSON.parse(r.issues_json) : [],
    }));
    res.json({ fieldReports: parsed });
  } catch (error) {
    console.error('Get field reports error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/field-reports', (req, res) => {
  try {
    const { jobId, date, reportedBy, work, materials, labor, equipment, weather, notes, issues } = req.body;
    if (!jobId || !date) return res.status(400).json({ error: 'jobId and date are required' });
    const id = `FR-${uuidv4().slice(0, 8).toUpperCase()}`;
    createDacpFieldReport({
      id, tenantId: req.user.tenantId, jobId, date, reportedBy: reportedBy || req.user.name,
      work: work || [], materials: materials || [], labor: labor || {},
      equipment: equipment || [], weather: weather || '', notes: notes || '', issues: issues || [],
    });
    res.status(201).json({ id, message: 'Field report created' });
  } catch (error) {
    console.error('Create field report error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Pricing ────────────────────────────────────────────────────────────────

router.get('/pricing', (req, res) => {
  try {
    const category = req.query.category || null;
    const pricing = getDacpPricing(req.user.tenantId, category);
    res.json({ pricing });
  } catch (error) {
    console.error('Get pricing error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Stats ──────────────────────────────────────────────────────────────────

router.get('/stats', (req, res) => {
  try {
    const stats = getDacpStats(req.user.tenantId);
    res.json({ stats });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
