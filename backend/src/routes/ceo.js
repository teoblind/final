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
