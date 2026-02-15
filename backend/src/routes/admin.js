/**
 * Sangha Admin Routes
 *
 * Cross-tenant administration endpoints for sangha_admin and
 * sangha_underwriter roles. Provides tenant overview, aggregate
 * metrics, underwriting pipeline, and cross-tenant audit log.
 */

import express from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import {
  getAllTenants,
  getTenant,
  getUsersByTenant,
  getSites,
  getWorkloads,
  getAllWorkloadSnapshots,
  getCrosstenantAuditLog,
  getAuditLog,
} from '../cache/database.js';

const router = express.Router();

// All routes require authentication + sangha_admin or sangha_underwriter role
router.use(authenticate);
router.use(requireRole('sangha_admin', 'sangha_underwriter'));

// ─── GET /tenants — List All Tenants with Summary Data ──────────────────────

router.get('/tenants', (req, res) => {
  try {
    const tenants = getAllTenants();

    const tenantsWithSummary = tenants.map(tenant => {
      let userCount = 0;
      let siteCount = 0;
      let workloadCount = 0;

      try {
        userCount = getUsersByTenant(tenant.id).length;
      } catch (e) { /* no users */ }

      try {
        siteCount = getSites(tenant.id).length;
      } catch (e) { /* no sites */ }

      try {
        const allWorkloads = getWorkloads();
        workloadCount = allWorkloads.filter(w => w.tenant_id === tenant.id).length;
      } catch (e) { /* no workloads */ }

      return {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        plan: tenant.plan,
        status: tenant.status,
        created_at: tenant.created_at,
        userCount,
        siteCount,
        workloadCount,
      };
    });

    res.json({ tenants: tenantsWithSummary });
  } catch (error) {
    console.error('List tenants error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /tenants/:id — Detailed Tenant View ────────────────────────────────

router.get('/tenants/:id', (req, res) => {
  try {
    const { id } = req.params;
    const tenant = getTenant(id);

    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    let userCount = 0;
    let recentActivity = [];

    try {
      userCount = getUsersByTenant(id).length;
    } catch (e) { /* no users */ }

    try {
      recentActivity = getAuditLog(id, 20, 0);
    } catch (e) { /* no audit log */ }

    res.json({
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        plan: tenant.plan,
        status: tenant.status,
        branding: tenant.branding,
        settings: tenant.settings,
        limits: tenant.limits,
        created_at: tenant.created_at,
        trial_ends_at: tenant.trial_ends_at,
        updated_at: tenant.updated_at,
      },
      userCount,
      recentActivity,
    });
  } catch (error) {
    console.error('Get tenant detail error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /aggregate — Cross-Tenant Aggregate Metrics ────────────────────────

router.get('/aggregate', (req, res) => {
  try {
    const tenants = getAllTenants();
    const days = parseInt(req.query.days) || 30;

    let totalTenants = tenants.length;
    let activeTenants = 0;
    let trialTenants = 0;
    let totalUsers = 0;
    let totalSites = 0;
    let totalCapacityMW = 0;
    let totalWorkloads = 0;
    const workloadsByType = {};

    for (const tenant of tenants) {
      if (tenant.status === 'active') activeTenants++;
      if (tenant.status === 'trial') trialTenants++;

      try {
        totalUsers += getUsersByTenant(tenant.id).length;
      } catch (e) { /* skip */ }

      try {
        const sites = getSites(tenant.id);
        totalSites += sites.length;
        for (const site of sites) {
          totalCapacityMW += site.total_capacity_mw || 0;
        }
      } catch (e) { /* skip */ }
    }

    // Count workloads by type across all tenants
    try {
      const allWorkloads = getWorkloads();
      totalWorkloads = allWorkloads.length;
      for (const w of allWorkloads) {
        const type = w.type || 'unknown';
        workloadsByType[type] = (workloadsByType[type] || 0) + 1;
      }
    } catch (e) { /* skip */ }

    // Aggregate revenue metrics from snapshots
    let totalGrossRevenue = 0;
    let totalNetRevenue = 0;
    let totalEnergyCost = 0;

    try {
      const snapshots = getAllWorkloadSnapshots(days);
      for (const snap of snapshots) {
        totalGrossRevenue += snap.gross_revenue || 0;
        totalNetRevenue += snap.net_revenue || 0;
        totalEnergyCost += snap.energy_cost || 0;
      }
    } catch (e) { /* skip */ }

    const avgMarginPercent = totalGrossRevenue > 0
      ? (totalNetRevenue / totalGrossRevenue) * 100
      : 0;

    res.json({
      summary: {
        totalTenants,
        activeTenants,
        trialTenants,
        totalUsers,
        totalSites,
        totalCapacityMW,
        totalWorkloads,
        workloadsByType,
      },
      financials: {
        period: `${days}d`,
        totalGrossRevenue,
        totalNetRevenue,
        totalEnergyCost,
        avgMarginPercent,
      },
    });
  } catch (error) {
    console.error('Aggregate metrics error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /underwriting/pipeline — Underwriting Pipeline ─────────────────────

router.get('/underwriting/pipeline', (req, res) => {
  try {
    const tenants = getAllTenants();
    const now = new Date();
    const pipeline = [];

    for (const tenant of tenants) {
      if (tenant.status === 'inactive') continue;

      const createdAt = new Date(tenant.created_at);
      const daysSinceCreation = Math.floor((now - createdAt) / (1000 * 60 * 60 * 24));

      let userCount = 0;
      let siteCount = 0;
      let workloadCount = 0;
      let hasSnapshots = false;

      try {
        userCount = getUsersByTenant(tenant.id).length;
      } catch (e) { /* skip */ }

      try {
        siteCount = getSites(tenant.id).length;
      } catch (e) { /* skip */ }

      try {
        const allWorkloads = getWorkloads();
        workloadCount = allWorkloads.filter(w => w.tenant_id === tenant.id).length;
      } catch (e) { /* skip */ }

      // Compute a completeness score (0-100)
      let completenessScore = 0;
      if (userCount > 0) completenessScore += 15;
      if (siteCount > 0) completenessScore += 20;
      if (workloadCount > 0) completenessScore += 25;
      if (daysSinceCreation >= 30) completenessScore += 20;
      if (tenant.plan !== 'trial') completenessScore += 10;
      if (tenant.settings) completenessScore += 10;

      const readyForUnderwriting = daysSinceCreation >= 30 && completenessScore >= 50;

      pipeline.push({
        tenantId: tenant.id,
        tenantName: tenant.name,
        plan: tenant.plan,
        status: tenant.status,
        daysSinceCreation,
        userCount,
        siteCount,
        workloadCount,
        completenessScore,
        readyForUnderwriting,
      });
    }

    // Sort by completeness score descending
    pipeline.sort((a, b) => b.completenessScore - a.completenessScore);

    res.json({ pipeline });
  } catch (error) {
    console.error('Underwriting pipeline error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /underwriting/export — Export Underwriting Data ───────────────────

router.post('/underwriting/export', (req, res) => {
  try {
    const tenants = getAllTenants();
    const days = parseInt(req.query.days) || 90;
    const exportData = [];

    for (const tenant of tenants) {
      let users = [];
      let sites = [];
      let workloads = [];

      try {
        users = getUsersByTenant(tenant.id);
      } catch (e) { /* skip */ }

      try {
        sites = getSites(tenant.id);
      } catch (e) { /* skip */ }

      try {
        const allWorkloads = getWorkloads();
        workloads = allWorkloads.filter(w => w.tenant_id === tenant.id);
      } catch (e) { /* skip */ }

      let totalCapacityMW = 0;
      for (const site of sites) {
        totalCapacityMW += site.total_capacity_mw || 0;
      }

      exportData.push({
        tenant: {
          id: tenant.id,
          name: tenant.name,
          plan: tenant.plan,
          status: tenant.status,
          created_at: tenant.created_at,
        },
        metrics: {
          userCount: users.length,
          siteCount: sites.length,
          workloadCount: workloads.length,
          totalCapacityMW,
        },
      });
    }

    res.json({
      exportedAt: new Date().toISOString(),
      period: `${days}d`,
      tenantCount: exportData.length,
      data: exportData,
    });
  } catch (error) {
    console.error('Underwriting export error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /audit — Cross-Tenant Audit Log ────────────────────────────────────

router.get('/audit', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;
    const entries = getCrosstenantAuditLog(limit, offset);
    res.json({ auditLog: entries, limit, offset });
  } catch (error) {
    console.error('Cross-tenant audit log error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
