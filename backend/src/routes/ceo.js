/**
 * CEO Dashboard Routes
 *
 * Aggregates KPIs, red flags, and department reports for the executive view.
 * Used by DACP CEO (Danny) to monitor all department bots from one screen.
 */
import express from 'express';
import { randomUUID } from 'crypto';
import { authenticate } from '../middleware/auth.js';
import {
  getCeoDashboardStats,
  getCeoRedFlags,
  getPumpingEquipment,
  getPumpingJobs,
  getMarketingLeads,
  getMarketingCampaigns,
  getComplianceItems,
  getComplianceIncidents,
  getCeoDepartmentReports,
  getCurrentTenantId,
  getDacpRfis,
  getDacpBondProgram,
  getDacpSuppliers,
  getDacpBidRequests,
  getDacpEstimates,
  getDacpJobs,
  getAgentAssignments,
  getTenantDb,
  getDacpPrequalPackages,
  createDacpPrequalPackage,
  updateDacpPrequalPackage,
  getDacpGcOffices,
  getDacpGcOffice,
  createDacpGcOffice,
  updateDacpGcOffice,
  getDacpSalesTrips,
  getDacpSalesTrip,
  createDacpSalesTrip,
  updateDacpSalesTrip,
} from '../cache/database.js';

const router = express.Router();
router.use(authenticate);

// ─── Main Dashboard Endpoint ──────────────────────────────────────────────────

/** GET /api/v1/ceo/dashboard - Full CEO dashboard data */
router.get('/dashboard', (req, res) => {
  try {
    const tenantId = getCurrentTenantId() || req.resolvedTenant?.id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });

    const stats = getCeoDashboardStats(tenantId);
    const redFlags = getCeoRedFlags(tenantId);
    const recentReports = getCeoDepartmentReports(tenantId, null, 5);

    // Department health scores (0-100)
    const health = {
      estimating: computeEstimatingHealth(stats.estimating),
      pumping: computePumpingHealth(stats.pumping),
      marketing: computeMarketingHealth(stats.marketing),
      compliance: computeComplianceHealth(stats.compliance),
    };

    // Overall score is weighted average
    health.overall = Math.round(
      (health.estimating * 0.35 + health.pumping * 0.25 + health.marketing * 0.20 + health.compliance * 0.20)
    );

    res.json({
      stats,
      redFlags,
      health,
      recentReports: recentReports.map(r => ({
        ...r,
        kpi_data: r.kpi_data_json ? JSON.parse(r.kpi_data_json) : null,
        red_flags: r.red_flags_json ? JSON.parse(r.red_flags_json) : null,
      })),
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('CEO dashboard error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── Department Detail Endpoints ──────────────────────────────────────────────

/** GET /api/v1/ceo/estimating - Estimating department detail */
router.get('/estimating', (req, res) => {
  try {
    const tenantId = getCurrentTenantId() || req.resolvedTenant?.id;
    const rfis = getDacpRfis(tenantId);
    const bondPrograms = getDacpBondProgram(tenantId);
    const suppliers = getDacpSuppliers(tenantId);

    res.json({
      rfis: { total: rfis.length, draft: rfis.filter(r => r.status === 'draft').length, sent: rfis.filter(r => r.status === 'sent').length, responded: rfis.filter(r => r.status === 'responded').length, items: rfis.slice(0, 20) },
      bondPrograms: bondPrograms.map(bp => ({ ...bp, tiers: bp.tiers_json ? JSON.parse(bp.tiers_json) : null })),
      suppliers: { total: suppliers.length, byType: suppliers.reduce((acc, s) => { acc[s.supplier_type] = (acc[s.supplier_type] || 0) + 1; return acc; }, {}) },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** GET /api/v1/ceo/pumping - Pumping department detail */
router.get('/pumping', (req, res) => {
  try {
    const tenantId = getCurrentTenantId() || req.resolvedTenant?.id;
    const equipment = getPumpingEquipment(tenantId);
    const upcomingJobs = getPumpingJobs(tenantId, 'scheduled', 20);
    const confirmedJobs = getPumpingJobs(tenantId, 'confirmed', 20);
    const completedJobs = getPumpingJobs(tenantId, 'completed', 20);
    res.json({ equipment, upcomingJobs, confirmedJobs, completedJobs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** GET /api/v1/ceo/marketing - Marketing department detail */
router.get('/marketing', (req, res) => {
  try {
    const tenantId = getCurrentTenantId() || req.resolvedTenant?.id;
    const leads = getMarketingLeads(tenantId, null, 50);
    const campaigns = getMarketingCampaigns(tenantId);
    res.json({ leads, campaigns });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** GET /api/v1/ceo/compliance - Compliance department detail */
router.get('/compliance', (req, res) => {
  try {
    const tenantId = getCurrentTenantId() || req.resolvedTenant?.id;
    const items = getComplianceItems(tenantId);
    const incidents = getComplianceIncidents(tenantId);
    res.json({ items, incidents });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Bid Funnel Endpoint ──────────────────────────────────────────────────────

/** GET /api/v1/ceo/bid-funnel - Bid funnel with size buckets and status breakdown */
router.get('/bid-funnel', (req, res) => {
  try {
    const tenantId = getCurrentTenantId() || req.resolvedTenant?.id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });

    const bids = getDacpBidRequests(tenantId);
    const estimates = getDacpEstimates(tenantId);
    const jobs = getDacpJobs(tenantId);

    // Size buckets based on estimate total_bid or job bid_amount
    const sizeBuckets = [
      { label: 'Under $100K', min: 0, max: 100000 },
      { label: '$100K - $500K', min: 100000, max: 500000 },
      { label: '$500K - $1M', min: 500000, max: 1000000 },
      { label: '$1M - $5M', min: 1000000, max: 5000000 },
      { label: '$5M - $50M', min: 5000000, max: 50000000 },
      { label: '$50M+', min: 50000000, max: Infinity },
    ];

    // Map estimates to bid requests for value lookup
    const estimateByBid = {};
    for (const est of estimates) {
      if (est.bid_request_id) estimateByBid[est.bid_request_id] = est;
    }

    // Build funnel data
    const funnel = {
      total: bids.length,
      byStatus: {},
      bySizeBucket: sizeBuckets.map(b => ({ ...b, count: 0, bidOn: 0 })),
      byMonth: {},
      recentBids: bids.slice(0, 20).map(b => ({
        id: b.id,
        gcName: b.gc_name,
        subject: b.subject,
        status: b.status,
        dueDate: b.due_date,
        receivedAt: b.received_at,
        estimateValue: estimateByBid[b.id]?.total_bid || null,
        urgency: b.urgency,
      })),
    };

    // Count by status
    for (const bid of bids) {
      funnel.byStatus[bid.status] = (funnel.byStatus[bid.status] || 0) + 1;

      // Determine value from estimate or job
      const est = estimateByBid[bid.id];
      const value = est?.total_bid || 0;

      // Place in size bucket
      for (const bucket of funnel.bySizeBucket) {
        if (value >= bucket.min && value < bucket.max) {
          bucket.count++;
          if (['estimated', 'sent', 'awarded'].includes(bid.status)) bucket.bidOn++;
          break;
        }
      }

      // Count by month
      const month = (bid.received_at || bid.due_date || '').slice(0, 7);
      if (month) {
        if (!funnel.byMonth[month]) funnel.byMonth[month] = { total: 0, bidOn: 0, awarded: 0 };
        funnel.byMonth[month].total++;
        if (['estimated', 'sent', 'awarded'].includes(bid.status)) funnel.byMonth[month].bidOn++;
        if (bid.status === 'awarded') funnel.byMonth[month].awarded++;
      }
    }

    // Active jobs summary
    funnel.activeJobs = jobs.filter(j => j.status === 'active').length;
    funnel.totalPipeline = estimates.reduce((sum, e) => sum + (e.total_bid || 0), 0);

    res.json(funnel);
  } catch (error) {
    console.error('CEO bid funnel error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── Newsletter Lead Tracker ─────────────────────────────────────────────────

/** GET /api/v1/ceo/newsletter-leads - Tasks generated from newsletters with aging */
router.get('/newsletter-leads', (req, res) => {
  try {
    const tenantId = getCurrentTenantId() || req.resolvedTenant?.id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });

    // Get all newsletter-sourced tasks
    const allTasks = getAgentAssignments(tenantId);
    const newsletterTasks = allTasks.filter(t => {
      try {
        const ctx = t.context_json ? JSON.parse(t.context_json) : {};
        return ctx.source === 'newsletter';
      } catch { return false; }
    });

    const now = new Date();
    const leads = newsletterTasks.map(t => {
      const ctx = t.context_json ? JSON.parse(t.context_json) : {};
      const createdAt = new Date(t.created_at);
      const ageMs = now - createdAt;
      const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));

      // Parse email draft from artifacts
      let emailDraft = null;
      try {
        const artifacts = t.output_artifacts_json ? JSON.parse(t.output_artifacts_json) : [];
        emailDraft = artifacts.find(a => a.type === 'email_draft') || null;
      } catch {}

      return {
        id: t.id,
        title: t.title,
        description: t.description,
        category: t.category,
        priority: t.priority,
        status: t.status,
        ageDays,
        createdAt: t.created_at,
        newsletterDate: ctx.date || null,
        hasEmailDraft: !!emailDraft,
        emailDraftTo: emailDraft?.to || null,
        emailDraftStatus: emailDraft?.status || null,
      };
    });

    // Sort by age (newest first) then by priority
    leads.sort((a, b) => {
      if (a.status === 'proposed' && b.status !== 'proposed') return -1;
      if (b.status === 'proposed' && a.status !== 'proposed') return 1;
      return a.ageDays - b.ageDays;
    });

    // Summary stats
    const summary = {
      total: leads.length,
      pending: leads.filter(l => l.status === 'proposed').length,
      inProgress: leads.filter(l => l.status === 'in_progress').length,
      completed: leads.filter(l => l.status === 'completed').length,
      stale: leads.filter(l => l.ageDays > 7 && l.status === 'proposed').length,
      withEmailDrafts: leads.filter(l => l.hasEmailDraft).length,
    };

    res.json({ summary, leads });
  } catch (error) {
    console.error('CEO newsletter leads error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── Newsletter History ──────────────────────────────────────────────────────

/** GET /api/v1/ceo/newsletters - Recent newsletters stored in knowledge_entries */
router.get('/newsletters', (req, res) => {
  try {
    const tenantId = getCurrentTenantId() || req.resolvedTenant?.id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });

    const db = getTenantDb(tenantId);
    const newsletters = db.prepare(
      "SELECT id, title, summary, content, created_at FROM knowledge_entries WHERE tenant_id = ? AND type = 'newsletter' ORDER BY created_at DESC LIMIT 30"
    ).all(tenantId);

    res.json(newsletters.map(n => ({
      id: n.id,
      title: n.title,
      summary: n.summary?.substring(0, 300),
      hasContent: !!n.content,
      createdAt: n.created_at,
    })));
  } catch (error) {
    console.error('CEO newsletters error:', error);
    res.status(500).json({ error: error.message });
  }
});

/** GET /api/v1/ceo/newsletters/:id - Full newsletter HTML */
router.get('/newsletters/:id', (req, res) => {
  try {
    const tenantId = getCurrentTenantId() || req.resolvedTenant?.id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });

    const db = getTenantDb(tenantId);
    const newsletter = db.prepare(
      "SELECT * FROM knowledge_entries WHERE tenant_id = ? AND id = ? AND type = 'newsletter'"
    ).get(tenantId, req.params.id);

    if (!newsletter) return res.status(404).json({ error: 'Newsletter not found' });
    res.json(newsletter);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Follow-Up Drafts Endpoint ────────────────────────────────────────────────

/** GET /api/v1/ceo/follow-ups - Tasks with follow-up email drafts pending approval */
router.get('/follow-ups', (req, res) => {
  try {
    const tenantId = getCurrentTenantId() || req.resolvedTenant?.id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });

    // Get tasks in follow_up_pending status, plus any task that has a follow_up_email_draft artifact
    const allTasks = getAgentAssignments(tenantId);
    const followUpTasks = allTasks.filter(t => {
      // Include if status is follow_up_pending
      if (t.status === 'follow_up_pending') return true;

      // Also include if any artifact is a follow_up_email_draft (regardless of status)
      try {
        const artifacts = t.output_artifacts_json ? JSON.parse(t.output_artifacts_json) : [];
        return artifacts.some(a => a.type === 'follow_up_email_draft');
      } catch {
        return false;
      }
    });

    const now = new Date();
    const results = followUpTasks.map(t => {
      const ctx = t.context_json ? JSON.parse(t.context_json) : {};
      const createdAt = new Date(t.created_at);
      const ageDays = Math.floor((now - createdAt) / (1000 * 60 * 60 * 24));

      let artifacts = [];
      try {
        artifacts = t.output_artifacts_json ? JSON.parse(t.output_artifacts_json) : [];
      } catch {}

      const originalDraft = artifacts.find(a => a.type === 'email_draft') || null;
      const followUpDraft = artifacts.find(a => a.type === 'follow_up_email_draft') || null;

      return {
        id: t.id,
        title: t.title,
        description: t.description,
        category: t.category,
        priority: t.priority,
        status: t.status,
        ageDays,
        createdAt: t.created_at,
        newsletterDate: ctx.date || null,
        originalDraft: originalDraft ? {
          to: originalDraft.to,
          subject: originalDraft.subject,
          body: originalDraft.body,
          status: originalDraft.status,
        } : null,
        followUpDraft: followUpDraft ? {
          to: followUpDraft.to,
          subject: followUpDraft.subject,
          body: followUpDraft.body,
          status: followUpDraft.status,
          generatedAt: followUpDraft.generated_at,
          originalTaskAgeDays: followUpDraft.original_task_age_days,
        } : null,
      };
    });

    // Sort by age descending (oldest first - most urgent)
    results.sort((a, b) => b.ageDays - a.ageDays);

    res.json({
      total: results.length,
      pendingApproval: results.filter(r => r.followUpDraft?.status === 'pending_approval').length,
      tasks: results,
    });
  } catch (error) {
    console.error('CEO follow-ups error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── Pre-Qualification Package Tracking ──────────────────────────────────────

/** GET /api/v1/ceo/prequal - List all pre-qualification packages with summary stats */
router.get('/prequal', (req, res) => {
  try {
    const tenantId = getCurrentTenantId() || req.resolvedTenant?.id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });

    const packages = getDacpPrequalPackages(tenantId);

    const summary = {
      total: packages.length,
      not_sent: packages.filter(p => p.status === 'not_sent').length,
      sent: packages.filter(p => p.status === 'sent').length,
      received: packages.filter(p => p.status === 'received').length,
      approved: packages.filter(p => p.status === 'approved').length,
      expired: packages.filter(p => p.status === 'expired').length,
      rejected: packages.filter(p => p.status === 'rejected').length,
    };
    summary.pending = summary.sent + summary.received;

    res.json({ summary, packages });
  } catch (error) {
    console.error('CEO prequal list error:', error);
    res.status(500).json({ error: error.message });
  }
});

/** POST /api/v1/ceo/prequal - Create a new pre-qualification entry */
router.post('/prequal', (req, res) => {
  try {
    const tenantId = getCurrentTenantId() || req.resolvedTenant?.id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });

    const { gc_name, gc_contact_name, gc_contact_email, status, notes } = req.body;
    if (!gc_name) return res.status(400).json({ error: 'gc_name is required' });

    const id = `PQ-${randomUUID().slice(0, 8).toUpperCase()}`;
    createDacpPrequalPackage({
      id,
      tenant_id: tenantId,
      gc_name,
      gc_contact_name: gc_contact_name || null,
      gc_contact_email: gc_contact_email || null,
      status: status || 'not_sent',
      notes: notes || null,
    });

    res.status(201).json({ id, gc_name, status: status || 'not_sent' });
  } catch (error) {
    console.error('CEO prequal create error:', error);
    res.status(500).json({ error: error.message });
  }
});

/** PUT /api/v1/ceo/prequal/:id - Update status, dates, notes */
router.put('/prequal/:id', (req, res) => {
  try {
    const tenantId = getCurrentTenantId() || req.resolvedTenant?.id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });

    const allowedFields = ['gc_name', 'gc_contact_name', 'gc_contact_email', 'status', 'sent_date', 'received_date', 'expiry_date', 'notes'];
    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const result = updateDacpPrequalPackage(tenantId, req.params.id, updates);
    if (!result || result.changes === 0) {
      return res.status(404).json({ error: 'Pre-qualification package not found' });
    }

    res.json({ id: req.params.id, updated: updates });
  } catch (error) {
    console.error('CEO prequal update error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── Health Score Computation ─────────────────────────────────────────────────

function computeEstimatingHealth(stats) {
  let score = 100;
  // Overdue bids: -15 per overdue
  score -= Math.min(stats.overdueItems * 15, 45);
  // Unreviewed bids: -5 per pending
  score -= Math.min(stats.pendingBids * 5, 20);
  // No active jobs is a concern
  if (stats.activeJobs === 0) score -= 10;
  // Low margin
  if (stats.avgMargin < 8) score -= 15;
  // Bond rate above market: -10 per flagged program
  score -= Math.min((stats.aboveMarketBondRate || 0) * 10, 20);
  // Unsent distributions sitting in draft: -5 per batch
  score -= Math.min((stats.pendingDistributions || 0) * 5, 15);
  return Math.max(0, Math.min(100, score));
}

function computePumpingHealth(stats) {
  let score = 100;
  // Overdue invoices: -15 each
  score -= Math.min(stats.overdueInvoices * 15, 45);
  // Pending invoices (completed but not invoiced): -10 each
  score -= Math.min(stats.pendingInvoices * 10, 30);
  // Equipment in maintenance: -10 each
  score -= Math.min(stats.maintenanceEquipment * 10, 20);
  return Math.max(0, Math.min(100, score));
}

function computeMarketingHealth(stats) {
  let score = 100;
  // Stale leads: -10 each
  score -= Math.min(stats.staleLeads * 10, 30);
  // Low response rate
  if (stats.responseRate < 20) score -= 20;
  else if (stats.responseRate < 35) score -= 10;
  // No active campaigns
  if (stats.activeCampaigns === 0) score -= 15;
  // No new leads
  if (stats.newLeads === 0 && stats.totalLeads > 0) score -= 10;
  return Math.max(0, Math.min(100, score));
}

function computeComplianceHealth(stats) {
  let score = 100;
  // Expired items: -25 each (critical)
  score -= Math.min(stats.expired * 25, 50);
  // Expiring soon: -10 each
  score -= Math.min(stats.expiringSoon * 10, 30);
  // Open high-severity incidents: -15 each
  score -= Math.min(stats.highSeverityOpen * 15, 30);
  return Math.max(0, Math.min(100, score));
}

// ─── GC Profile Endpoints ─────────────────────────────────────────────────────

const KNOWN_GC_LIST = [
  'Turner Construction', 'Renegade', 'JE Dunn', 'Hensel Phelps',
  'McCarthy Building Companies', 'Skanska', 'Balfour Beatty',
  'Rogers-O\'Brien', 'Manhattan Construction', 'Austin Commercial',
  'Whiting-Turner', 'Brasfield & Gorrie', 'Granite Construction',
  'DPR Construction', 'Primoris', 'Zachry Group',
];

/** Normalize GC name for matching (lowercase, trimmed) */
function normalizeGcName(name) {
  return (name || '').trim().toLowerCase();
}

/** Check if a gc_name matches the known GC watchlist */
function isKnownGc(gcName) {
  const normalized = normalizeGcName(gcName);
  return KNOWN_GC_LIST.some(known => normalizeGcName(known) === normalized);
}

/** GET /api/v1/ceo/gc-profiles - All GCs with aggregated stats */
router.get('/gc-profiles', (req, res) => {
  try {
    const tenantId = getCurrentTenantId() || req.resolvedTenant?.id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });

    const bids = getDacpBidRequests(tenantId);
    const estimates = getDacpEstimates(tenantId);
    const jobs = getDacpJobs(tenantId);

    // Build estimate lookup by bid_request_id
    const estimateByBid = {};
    for (const est of estimates) {
      if (est.bid_request_id) estimateByBid[est.bid_request_id] = est;
    }

    // Aggregate by GC name
    const gcMap = {};

    for (const bid of bids) {
      const name = (bid.gc_name || 'Unknown').trim();
      if (!gcMap[name]) {
        gcMap[name] = {
          gc_name: name,
          total_bids: 0,
          bids_responded: 0,
          bids_awarded: 0,
          total_value: 0,
          last_bid_date: null,
          gc_email: null,
          is_known_gc: isKnownGc(name),
        };
      }

      const gc = gcMap[name];
      gc.total_bids++;

      // Track contact email (use most recent non-null)
      if (bid.from_email) gc.gc_email = bid.from_email;

      // Track responded bids (estimated, sent, awarded)
      if (['estimated', 'sent', 'awarded'].includes(bid.status)) {
        gc.bids_responded++;
      }

      if (bid.status === 'awarded') {
        gc.bids_awarded++;
      }

      // Add estimate value
      const est = estimateByBid[bid.id];
      if (est?.total_bid) gc.total_value += est.total_bid;

      // Track last bid date
      const bidDate = bid.received_at || bid.due_date;
      if (bidDate && (!gc.last_bid_date || bidDate > gc.last_bid_date)) {
        gc.last_bid_date = bidDate;
      }
    }

    // Also add job values for awarded work
    for (const job of jobs) {
      const name = (job.gc_name || 'Unknown').trim();
      if (!gcMap[name]) {
        gcMap[name] = {
          gc_name: name,
          total_bids: 0,
          bids_responded: 0,
          bids_awarded: 0,
          total_value: 0,
          last_bid_date: null,
          gc_email: null,
          is_known_gc: isKnownGc(name),
        };
      }
      // Add job bid_amount to total value if not already counted from estimates
      if (job.bid_amount && !bids.some(b => b.gc_name?.trim() === name && b.status === 'awarded')) {
        gcMap[name].total_value += job.bid_amount;
      }
    }

    // Sort by total_bids descending, then by name
    const profiles = Object.values(gcMap).sort((a, b) => {
      if (b.total_bids !== a.total_bids) return b.total_bids - a.total_bids;
      return a.gc_name.localeCompare(b.gc_name);
    });

    res.json({ profiles, total: profiles.length });
  } catch (error) {
    console.error('CEO gc-profiles error:', error);
    res.status(500).json({ error: error.message });
  }
});

/** GET /api/v1/ceo/gc-profiles/:gcName - Detailed profile for one GC */
router.get('/gc-profiles/:gcName', (req, res) => {
  try {
    const tenantId = getCurrentTenantId() || req.resolvedTenant?.id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });

    const gcName = decodeURIComponent(req.params.gcName);

    const allBids = getDacpBidRequests(tenantId);
    const allEstimates = getDacpEstimates(tenantId);
    const allJobs = getDacpJobs(tenantId);

    // Filter to this GC (case-insensitive match)
    const normalizedTarget = normalizeGcName(gcName);
    const gcBids = allBids.filter(b => normalizeGcName(b.gc_name) === normalizedTarget);
    const gcJobs = allJobs.filter(j => normalizeGcName(j.gc_name) === normalizedTarget);

    // Build estimate lookup
    const estimateByBid = {};
    for (const est of allEstimates) {
      if (est.bid_request_id) estimateByBid[est.bid_request_id] = est;
    }

    // Collect contact emails
    const emails = new Set();
    for (const bid of gcBids) {
      if (bid.from_email) emails.add(bid.from_email);
    }

    // Build bid history
    const bidHistory = gcBids.map(bid => {
      const est = estimateByBid[bid.id];
      return {
        id: bid.id,
        subject: bid.subject,
        project_name: est?.project_name || bid.subject,
        status: bid.status,
        due_date: bid.due_date,
        received_at: bid.received_at,
        urgency: bid.urgency,
        estimate_value: est?.total_bid || null,
        from_email: bid.from_email,
        from_name: bid.from_name,
      };
    });

    // Build jobs list
    const jobsList = gcJobs.map(job => ({
      id: job.id,
      project_name: job.project_name,
      project_type: job.project_type,
      location: job.location,
      status: job.status,
      bid_amount: job.bid_amount,
      estimated_cost: job.estimated_cost,
      actual_cost: job.actual_cost,
      margin_pct: job.margin_pct,
      start_date: job.start_date,
      end_date: job.end_date,
    }));

    // Summary stats
    const totalBids = gcBids.length;
    const respondedBids = gcBids.filter(b => ['estimated', 'sent', 'awarded'].includes(b.status)).length;
    const awardedBids = gcBids.filter(b => b.status === 'awarded').length;
    const totalEstimateValue = gcBids.reduce((sum, b) => {
      const est = estimateByBid[b.id];
      return sum + (est?.total_bid || 0);
    }, 0);
    const totalJobValue = gcJobs.reduce((sum, j) => sum + (j.bid_amount || 0), 0);
    const avgBidSize = respondedBids > 0
      ? gcBids.filter(b => ['estimated', 'sent', 'awarded'].includes(b.status)).reduce((sum, b) => {
          const est = estimateByBid[b.id];
          return sum + (est?.total_bid || 0);
        }, 0) / respondedBids
      : 0;
    const winRate = respondedBids > 0 ? Math.round((awardedBids / respondedBids) * 100) : 0;
    const avgMargin = gcJobs.length > 0
      ? gcJobs.reduce((sum, j) => sum + (j.margin_pct || 0), 0) / gcJobs.length
      : 0;

    res.json({
      gc_name: gcName,
      is_known_gc: isKnownGc(gcName),
      contact_emails: [...emails],
      summary: {
        total_bids: totalBids,
        bids_responded: respondedBids,
        bids_awarded: awardedBids,
        win_rate: winRate,
        avg_bid_size: avgBidSize,
        total_estimate_value: totalEstimateValue,
        total_job_value: totalJobValue,
        avg_margin: avgMargin,
        active_jobs: gcJobs.filter(j => j.status === 'active').length,
        completed_jobs: gcJobs.filter(j => j.status === 'completed').length,
      },
      bid_history: bidHistory,
      jobs: jobsList,
    });
  } catch (error) {
    console.error('CEO gc-profile detail error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── GC Office Management (Sales Trip Planner) ──────────────────────────────

/** GET /api/v1/ceo/gc-offices - List all GC offices with geocoded status */
router.get('/gc-offices', (req, res) => {
  try {
    const tenantId = getCurrentTenantId() || req.resolvedTenant?.id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });

    const offices = getDacpGcOffices(tenantId);
    const summary = {
      total: offices.length,
      geocoded: offices.filter(o => o.lat != null && o.lng != null).length,
      notGeocoded: offices.filter(o => o.lat == null || o.lng == null).length,
      byType: offices.reduce((acc, o) => { acc[o.office_type || 'main'] = (acc[o.office_type || 'main'] || 0) + 1; return acc; }, {}),
    };

    res.json({ summary, offices });
  } catch (error) {
    console.error('CEO gc-offices list error:', error);
    res.status(500).json({ error: error.message });
  }
});

/** POST /api/v1/ceo/gc-offices - Add a GC office */
router.post('/gc-offices', (req, res) => {
  try {
    const tenantId = getCurrentTenantId() || req.resolvedTenant?.id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });

    const { gc_name, address, city, state, zip, phone, website, office_type, notes } = req.body;
    if (!gc_name) return res.status(400).json({ error: 'gc_name is required' });

    const id = `GCO-${randomUUID().slice(0, 8).toUpperCase()}`;
    createDacpGcOffice({
      id,
      tenant_id: tenantId,
      gc_name,
      address: address || null,
      city: city || null,
      state: state || null,
      zip: zip || null,
      phone: phone || null,
      website: website || null,
      office_type: office_type || 'main',
      notes: notes || null,
    });

    res.status(201).json({ id, gc_name, address, city, state });
  } catch (error) {
    console.error('CEO gc-offices create error:', error);
    res.status(500).json({ error: error.message });
  }
});

/** PUT /api/v1/ceo/gc-offices/:id - Update office info */
router.put('/gc-offices/:id', (req, res) => {
  try {
    const tenantId = getCurrentTenantId() || req.resolvedTenant?.id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });

    const allowedFields = ['gc_name', 'address', 'city', 'state', 'zip', 'lat', 'lng', 'phone', 'website', 'office_type', 'notes', 'geocoded_at'];
    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const result = updateDacpGcOffice(tenantId, req.params.id, updates);
    if (!result || result.changes === 0) {
      return res.status(404).json({ error: 'GC office not found' });
    }

    res.json({ id: req.params.id, updated: updates });
  } catch (error) {
    console.error('CEO gc-offices update error:', error);
    res.status(500).json({ error: error.message });
  }
});

/** POST /api/v1/ceo/gc-offices/:id/geocode - Geocode an office address */
router.post('/gc-offices/:id/geocode', async (req, res) => {
  try {
    const tenantId = getCurrentTenantId() || req.resolvedTenant?.id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });

    const office = getDacpGcOffice(tenantId, req.params.id);
    if (!office) return res.status(404).json({ error: 'GC office not found' });

    const addressParts = [office.address, office.city, office.state, office.zip].filter(Boolean);
    if (addressParts.length === 0) {
      return res.status(400).json({ error: 'Office has no address to geocode' });
    }
    const fullAddress = addressParts.join(', ');

    let lat = null;
    let lng = null;
    let geocodeSource = null;

    // Try Google Places API first if key available
    const googleKey = process.env.GOOGLE_PLACES_API_KEY;
    if (googleKey) {
      try {
        const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(fullAddress)}&key=${googleKey}`;
        const response = await fetch(url);
        const data = await response.json();
        if (data.status === 'OK' && data.results?.length > 0) {
          lat = data.results[0].geometry.location.lat;
          lng = data.results[0].geometry.location.lng;
          geocodeSource = 'google';
        }
      } catch (googleErr) {
        console.warn('Google geocode failed, falling back to Nominatim:', googleErr.message);
      }
    }

    // Fallback to Nominatim (free, no key needed)
    if (lat == null) {
      try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(fullAddress)}&limit=1`;
        const response = await fetch(url, {
          headers: { 'User-Agent': 'DACP-CEO-Dashboard/1.0' },
        });
        const data = await response.json();
        if (data?.length > 0) {
          lat = parseFloat(data[0].lat);
          lng = parseFloat(data[0].lon);
          geocodeSource = 'nominatim';
        }
      } catch (nomErr) {
        console.warn('Nominatim geocode failed:', nomErr.message);
      }
    }

    if (lat == null || lng == null) {
      return res.status(422).json({ error: 'Could not geocode address', address: fullAddress });
    }

    updateDacpGcOffice(tenantId, req.params.id, {
      lat,
      lng,
      geocoded_at: new Date().toISOString(),
    });

    res.json({ id: req.params.id, lat, lng, source: geocodeSource, address: fullAddress });
  } catch (error) {
    console.error('CEO gc-offices geocode error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── Sales Trip Planner ─────────────────────────────────────────────────────

/** Helper: Build talking points for a GC stop */
function buildTalkingPoints(tenantId, gcName) {
  const points = [];
  const normalizedTarget = normalizeGcName(gcName);

  // Recent bids from this GC
  const allBids = getDacpBidRequests(tenantId);
  const gcBids = allBids.filter(b => normalizeGcName(b.gc_name) === normalizedTarget);
  if (gcBids.length > 0) {
    const recentBids = gcBids.slice(0, 5);
    const statusCounts = gcBids.reduce((acc, b) => { acc[b.status] = (acc[b.status] || 0) + 1; return acc; }, {});
    points.push({
      category: 'bids',
      summary: `${gcBids.length} total bid(s) - ${Object.entries(statusCounts).map(([s, c]) => `${c} ${s}`).join(', ')}`,
      items: recentBids.map(b => `${b.subject || 'Untitled'} (${b.status}, due ${b.due_date || 'TBD'})`),
    });
  }

  // Active jobs with this GC
  const allJobs = getDacpJobs(tenantId);
  const gcJobs = allJobs.filter(j => normalizeGcName(j.gc_name) === normalizedTarget);
  if (gcJobs.length > 0) {
    const activeJobs = gcJobs.filter(j => j.status === 'active');
    const completedJobs = gcJobs.filter(j => j.status === 'completed');
    points.push({
      category: 'jobs',
      summary: `${gcJobs.length} job(s) - ${activeJobs.length} active, ${completedJobs.length} completed`,
      items: gcJobs.slice(0, 5).map(j => `${j.project_name || 'Unnamed'} (${j.status}, $${(j.bid_amount || 0).toLocaleString()})`),
    });
  }

  // Prequal package status
  const prequalPkgs = getDacpPrequalPackages(tenantId);
  const gcPrequal = prequalPkgs.filter(p => normalizeGcName(p.gc_name) === normalizedTarget);
  if (gcPrequal.length > 0) {
    const pkg = gcPrequal[0];
    points.push({
      category: 'prequal',
      summary: `Pre-qualification: ${pkg.status}${pkg.sent_date ? ' (sent ' + pkg.sent_date + ')' : ''}`,
      items: [],
    });
  } else {
    points.push({
      category: 'prequal',
      summary: 'No pre-qualification package on file - opportunity to introduce DACP',
      items: [],
    });
  }

  // Newsletter mentions
  try {
    const allTasks = getAgentAssignments(tenantId);
    const newsletterMentions = allTasks.filter(t => {
      try {
        const ctx = t.context_json ? JSON.parse(t.context_json) : {};
        if (ctx.source !== 'newsletter') return false;
        const text = `${t.title || ''} ${t.description || ''}`.toLowerCase();
        return text.includes(normalizedTarget) || text.includes(gcName.toLowerCase());
      } catch { return false; }
    });
    if (newsletterMentions.length > 0) {
      points.push({
        category: 'newsletter',
        summary: `${newsletterMentions.length} newsletter mention(s)`,
        items: newsletterMentions.slice(0, 3).map(t => t.title || t.description?.substring(0, 80)),
      });
    }
  } catch {}

  return points;
}

/** Helper: Build Google Maps multi-stop directions URL */
function buildRouteUrl(stops) {
  const addresses = stops
    .sort((a, b) => a.order - b.order)
    .map(s => {
      if (s.address) return s.address;
      if (s.city && s.state) return `${s.gc_name}, ${s.city}, ${s.state}`;
      return s.gc_name;
    })
    .map(a => encodeURIComponent(a));

  if (addresses.length === 0) return null;
  return `https://www.google.com/maps/dir/${addresses.join('/')}`;
}

/** Helper: Estimate distance between two lat/lng points (Haversine in miles) */
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 3959; // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** Helper: Estimate route distance/duration from stops with lat/lng */
function estimateRoute(stops) {
  const ordered = stops.filter(s => s.lat != null && s.lng != null).sort((a, b) => a.order - b.order);
  if (ordered.length < 2) return { total_distance_mi: null, total_duration_min: null };

  let totalStraightLine = 0;
  for (let i = 1; i < ordered.length; i++) {
    totalStraightLine += haversineDistance(ordered[i - 1].lat, ordered[i - 1].lng, ordered[i].lat, ordered[i].lng);
  }

  // Multiply by 1.3 for driving estimate (roads aren't straight)
  const drivingDistance = Math.round(totalStraightLine * 1.3 * 10) / 10;
  // Assume avg 30 mph in metro area
  const drivingMinutes = Math.round(drivingDistance / 30 * 60);

  return { total_distance_mi: drivingDistance, total_duration_min: drivingMinutes };
}

/** GET /api/v1/ceo/sales-trips - List all trips */
router.get('/sales-trips', (req, res) => {
  try {
    const tenantId = getCurrentTenantId() || req.resolvedTenant?.id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });

    const trips = getDacpSalesTrips(tenantId);
    const result = trips.map(t => ({
      ...t,
      stops: t.stops_json ? JSON.parse(t.stops_json) : [],
    }));

    // Remove raw JSON field
    for (const t of result) delete t.stops_json;

    res.json({
      total: result.length,
      planned: result.filter(t => t.status === 'planned').length,
      in_progress: result.filter(t => t.status === 'in_progress').length,
      completed: result.filter(t => t.status === 'completed').length,
      trips: result,
    });
  } catch (error) {
    console.error('CEO sales-trips list error:', error);
    res.status(500).json({ error: error.message });
  }
});

/** GET /api/v1/ceo/sales-trips/suggestions - Smart suggestions for GCs to visit */
router.get('/sales-trips/suggestions', (req, res) => {
  try {
    const tenantId = getCurrentTenantId() || req.resolvedTenant?.id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });

    const suggestions = [];
    const allBids = getDacpBidRequests(tenantId);
    const allJobs = getDacpJobs(tenantId);
    const prequalPkgs = getDacpPrequalPackages(tenantId);
    const offices = getDacpGcOffices(tenantId);

    // Build office lookup by normalized GC name
    const officeByGc = {};
    for (const o of offices) {
      const key = normalizeGcName(o.gc_name);
      if (!officeByGc[key]) officeByGc[key] = o;
    }

    // Track which GCs we've already added
    const seen = new Set();

    // 1. GCs with prequal status 'not_sent' - highest priority (haven't introduced ourselves)
    for (const pkg of prequalPkgs) {
      if (pkg.status === 'not_sent') {
        const key = normalizeGcName(pkg.gc_name);
        if (seen.has(key)) continue;
        seen.add(key);
        const office = officeByGc[key];
        suggestions.push({
          gc_name: pkg.gc_name,
          reason: 'Pre-qualification not yet sent - introduce DACP and deliver prequal package',
          priority: 'high',
          office_address: office ? [office.address, office.city, office.state, office.zip].filter(Boolean).join(', ') : null,
          office_id: office?.id || null,
          recent_activity: 'No prior engagement',
        });
      }
    }

    // 2. Newsletter leads not contacted
    try {
      const allTasks = getAgentAssignments(tenantId);
      const newsletterTasks = allTasks.filter(t => {
        try {
          const ctx = t.context_json ? JSON.parse(t.context_json) : {};
          return ctx.source === 'newsletter' && t.status === 'proposed';
        } catch { return false; }
      });
      for (const task of newsletterTasks) {
        // Try to extract GC name from task title/description
        for (const knownGc of KNOWN_GC_LIST) {
          const key = normalizeGcName(knownGc);
          if (seen.has(key)) continue;
          const text = `${task.title || ''} ${task.description || ''}`.toLowerCase();
          if (text.includes(key)) {
            seen.add(key);
            const office = officeByGc[key];
            suggestions.push({
              gc_name: knownGc,
              reason: `Newsletter lead - ${task.title || 'recent mention'}`,
              priority: 'high',
              office_address: office ? [office.address, office.city, office.state, office.zip].filter(Boolean).join(', ') : null,
              office_id: office?.id || null,
              recent_activity: task.description?.substring(0, 120) || 'Newsletter mention',
            });
          }
        }
      }
    } catch {}

    // 3. GCs with recent bid activity but no awarded jobs (relationship building)
    const gcBidMap = {};
    for (const bid of allBids) {
      const key = normalizeGcName(bid.gc_name);
      if (!gcBidMap[key]) gcBidMap[key] = { gc_name: bid.gc_name, bids: [], hasAwarded: false };
      gcBidMap[key].bids.push(bid);
      if (bid.status === 'awarded') gcBidMap[key].hasAwarded = true;
    }
    for (const [key, data] of Object.entries(gcBidMap)) {
      if (seen.has(key)) continue;
      if (!data.hasAwarded && data.bids.length > 0) {
        seen.add(key);
        const office = officeByGc[key];
        suggestions.push({
          gc_name: data.gc_name,
          reason: `${data.bids.length} bid(s) submitted but none awarded yet - strengthen relationship`,
          priority: 'medium',
          office_address: office ? [office.address, office.city, office.state, office.zip].filter(Boolean).join(', ') : null,
          office_id: office?.id || null,
          recent_activity: `Last bid: ${data.bids[0].subject || 'N/A'} (${data.bids[0].status})`,
        });
      }
    }

    // 4. GCs with awarded jobs (relationship maintenance)
    const gcJobMap = {};
    for (const job of allJobs) {
      const key = normalizeGcName(job.gc_name);
      if (!gcJobMap[key]) gcJobMap[key] = { gc_name: job.gc_name, jobs: [] };
      gcJobMap[key].jobs.push(job);
    }
    for (const [key, data] of Object.entries(gcJobMap)) {
      if (seen.has(key)) continue;
      seen.add(key);
      const office = officeByGc[key];
      const activeCount = data.jobs.filter(j => j.status === 'active').length;
      const completedCount = data.jobs.filter(j => j.status === 'completed').length;
      suggestions.push({
        gc_name: data.gc_name,
        reason: `${activeCount} active, ${completedCount} completed job(s) - maintain relationship and seek referrals`,
        priority: 'low',
        office_address: office ? [office.address, office.city, office.state, office.zip].filter(Boolean).join(', ') : null,
        office_id: office?.id || null,
        recent_activity: `Active: ${data.jobs.filter(j => j.status === 'active').map(j => j.project_name).join(', ') || 'none'}`,
      });
    }

    // Sort by priority
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    suggestions.sort((a, b) => (priorityOrder[a.priority] || 3) - (priorityOrder[b.priority] || 3));

    res.json({ total: suggestions.length, suggestions });
  } catch (error) {
    console.error('CEO sales-trips suggestions error:', error);
    res.status(500).json({ error: error.message });
  }
});

/** POST /api/v1/ceo/sales-trips - Create a new trip with auto-generated talking points */
router.post('/sales-trips', (req, res) => {
  try {
    const tenantId = getCurrentTenantId() || req.resolvedTenant?.id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });

    const { name, date, stops, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!stops || !Array.isArray(stops) || stops.length === 0) {
      return res.status(400).json({ error: 'At least one stop is required' });
    }

    const offices = getDacpGcOffices(tenantId);
    const officeMap = {};
    for (const o of offices) {
      officeMap[o.id] = o;
      // Also index by normalized gc_name for lookup
      const key = normalizeGcName(o.gc_name);
      if (!officeMap[`name:${key}`]) officeMap[`name:${key}`] = o;
    }

    // Build enriched stops
    const enrichedStops = stops.map((stop, idx) => {
      // Resolve office - by office_id or by gc_name lookup
      let office = null;
      if (stop.office_id) {
        office = officeMap[stop.office_id] || null;
      }
      if (!office && stop.gc_name) {
        office = officeMap[`name:${normalizeGcName(stop.gc_name)}`] || null;
      }

      const gcName = stop.gc_name || office?.gc_name || 'Unknown GC';
      const talkingPoints = buildTalkingPoints(tenantId, gcName);

      return {
        gc_name: gcName,
        office_id: office?.id || stop.office_id || null,
        order: idx + 1,
        talking_points: talkingPoints,
        duration_min: stop.duration_min || 30,
        notes: stop.notes || null,
        visited: false,
        // Include address info for route building
        address: office ? [office.address, office.city, office.state, office.zip].filter(Boolean).join(', ') : null,
        lat: office?.lat || null,
        lng: office?.lng || null,
        city: office?.city || null,
        state: office?.state || null,
      };
    });

    // Build Google Maps route URL
    const routeUrl = buildRouteUrl(enrichedStops);

    // Estimate route distance/duration
    const routeEstimate = estimateRoute(enrichedStops);

    const id = `TRIP-${randomUUID().slice(0, 8).toUpperCase()}`;
    createDacpSalesTrip({
      id,
      tenant_id: tenantId,
      name,
      date: date || null,
      status: 'planned',
      stops_json: JSON.stringify(enrichedStops),
      route_url: routeUrl,
      total_distance_mi: routeEstimate.total_distance_mi,
      total_duration_min: routeEstimate.total_duration_min,
      notes: notes || null,
      created_by: req.user?.email || req.user?.id || null,
    });

    res.status(201).json({
      id,
      name,
      date,
      status: 'planned',
      stops: enrichedStops,
      route_url: routeUrl,
      total_distance_mi: routeEstimate.total_distance_mi,
      total_duration_min: routeEstimate.total_duration_min,
    });
  } catch (error) {
    console.error('CEO sales-trips create error:', error);
    res.status(500).json({ error: error.message });
  }
});

/** GET /api/v1/ceo/sales-trips/:id - Get full trip detail */
router.get('/sales-trips/:id', (req, res) => {
  try {
    const tenantId = getCurrentTenantId() || req.resolvedTenant?.id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });

    const trip = getDacpSalesTrip(tenantId, req.params.id);
    if (!trip) return res.status(404).json({ error: 'Sales trip not found' });

    const stops = trip.stops_json ? JSON.parse(trip.stops_json) : [];
    delete trip.stops_json;

    res.json({ ...trip, stops });
  } catch (error) {
    console.error('CEO sales-trips detail error:', error);
    res.status(500).json({ error: error.message });
  }
});

/** PUT /api/v1/ceo/sales-trips/:id - Update trip (reorder stops, add notes, mark visited, change status) */
router.put('/sales-trips/:id', (req, res) => {
  try {
    const tenantId = getCurrentTenantId() || req.resolvedTenant?.id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });

    const existing = getDacpSalesTrip(tenantId, req.params.id);
    if (!existing) return res.status(404).json({ error: 'Sales trip not found' });

    const updates = {};
    const allowedScalars = ['name', 'date', 'status', 'notes', 'route_url', 'total_distance_mi', 'total_duration_min'];
    for (const field of allowedScalars) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    // Handle stops update (full replacement of stops array)
    if (req.body.stops !== undefined) {
      const newStops = req.body.stops;
      if (!Array.isArray(newStops)) {
        return res.status(400).json({ error: 'stops must be an array' });
      }
      updates.stops_json = JSON.stringify(newStops);

      // Recalculate route URL and estimates
      const routeUrl = buildRouteUrl(newStops);
      const routeEstimate = estimateRoute(newStops);
      updates.route_url = routeUrl;
      updates.total_distance_mi = routeEstimate.total_distance_mi;
      updates.total_duration_min = routeEstimate.total_duration_min;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const result = updateDacpSalesTrip(tenantId, req.params.id, updates);
    if (!result || result.changes === 0) {
      return res.status(404).json({ error: 'Sales trip not found' });
    }

    // Return updated trip
    const updated = getDacpSalesTrip(tenantId, req.params.id);
    const stops = updated.stops_json ? JSON.parse(updated.stops_json) : [];
    delete updated.stops_json;

    res.json({ ...updated, stops });
  } catch (error) {
    console.error('CEO sales-trips update error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
