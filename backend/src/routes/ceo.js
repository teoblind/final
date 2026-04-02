/**
 * CEO Dashboard Routes
 *
 * Aggregates KPIs, red flags, and department reports for the executive view.
 * Used by DACP CEO (Danny) to monitor all department bots from one screen.
 */
import express from 'express';
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

export default router;
