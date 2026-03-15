/**
 * Sangha Admin Routes
 *
 * Cross-tenant administration endpoints for sangha_admin and
 * sangha_underwriter roles. Provides tenant overview, aggregate
 * metrics, underwriting pipeline, and cross-tenant audit log.
 */

import express from 'express';
import { execSync } from 'child_process';
import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { authenticate, requireRole } from '../middleware/auth.js';
import bcryptPkg from 'bcryptjs';
import {
  getAllTenants,
  getTenant,
  updateTenant,
  getUsersByTenant,
  getUserById,
  updateUser,
  deleteUser,
  getSites,
  getWorkloads,
  getAllWorkloadSnapshots,
  getCrosstenantAuditLog,
  getAuditLog,
  getUsageStats,
  getUsageByDay,
  getUsageAllTenants,
  getUsageByDayAllTenants,
  getRecentApiLogs,
  getPaginatedApiLogs,
  getUsageByDayByModel,
  getOpusUsageAllTenants,
  getOpusDailyCount,
  checkOpusLimit,
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

// ─── GET /tenants/:id/users — Users for a Tenant ────────────────────────────

router.get('/tenants/:id/users', (req, res) => {
  try {
    const users = getUsersByTenant(req.params.id);
    res.json({ users });
  } catch (error) {
    console.error('Get tenant users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /users/:id — Remove a User ───────────────────────────────────────

router.delete('/users/:id', (req, res) => {
  try {
    const { id } = req.params;
    const user = getUserById(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    // Prevent deleting yourself
    if (user.id === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }
    deleteUser(id);
    res.json({ success: true, message: `User ${user.email} deleted` });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /users/:id/reset-password — Reset a User's Password ───────────────

router.post('/users/:id/reset-password', (req, res) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;
    const user = getUserById(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const password = newPassword || 'coppice123';
    const passwordHash = bcryptPkg.hashSync(password, 10);
    updateUser(id, { passwordHash });
    res.json({ success: true, message: `Password reset for ${user.email}`, temporaryPassword: password });
  } catch (error) {
    console.error('Reset password error:', error);
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

// ─── Model Pricing (per million tokens) ─────────────────────────────────────

const MODEL_PRICING = {
  'claude-sonnet-4-20250514': { input: 3, output: 15 },
  'claude-haiku-4-20250414': { input: 0.80, output: 4 },
  'claude-opus-4-20250514': { input: 15, output: 75 },
};

function getModelPricing(model) {
  if (!model) return { input: 3, output: 15 };
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (model.includes(key) || model.includes('sonnet') && key.includes('sonnet') || model.includes('haiku') && key.includes('haiku') || model.includes('opus') && key.includes('opus')) {
      return pricing;
    }
  }
  return { input: 3, output: 15 }; // default to sonnet pricing
}

function calcCost(rows) {
  let total = 0;
  for (const row of rows) {
    const pricing = getModelPricing(row.model);
    total += ((row.input_tokens || 0) / 1_000_000) * pricing.input;
    total += ((row.output_tokens || 0) / 1_000_000) * pricing.output;
  }
  return total;
}

function parsePeriod(period) {
  const days = parseInt(period) || 7;
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10) + 'T23:59:59',
  };
}

// ─── GET /usage — Usage Stats (optionally filtered by tenant) ───────────────

router.get('/usage', (req, res) => {
  try {
    const { period = '7', tenant_id } = req.query;
    const { startDate, endDate } = parsePeriod(period);

    let byModel, byDay;

    if (tenant_id) {
      byModel = getUsageStats(tenant_id, startDate, endDate);
      byDay = getUsageByDay(tenant_id, startDate, endDate);
    } else {
      byModel = getUsageAllTenants(startDate, endDate);
      // Collapse tenant_id dimension for the summary
      const modelMap = {};
      for (const row of byModel) {
        const key = row.model || 'unknown';
        if (!modelMap[key]) modelMap[key] = { model: key, requests: 0, input_tokens: 0, output_tokens: 0 };
        modelMap[key].requests += row.requests;
        modelMap[key].input_tokens += row.input_tokens || 0;
        modelMap[key].output_tokens += row.output_tokens || 0;
      }
      byModel = Object.values(modelMap);
      byDay = getUsageByDayAllTenants(startDate, endDate);
    }

    const totalRequests = byModel.reduce((s, r) => s + r.requests, 0);
    const totalInputTokens = byModel.reduce((s, r) => s + (r.input_tokens || 0), 0);
    const totalOutputTokens = byModel.reduce((s, r) => s + (r.output_tokens || 0), 0);
    const totalCost = calcCost(byModel);

    res.json({
      summary: { totalRequests, totalInputTokens, totalOutputTokens, totalCost },
      byModel,
      byDay,
    });
  } catch (error) {
    console.error('Usage stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /usage/by-tenant — Per-Tenant Usage Breakdown ──────────────────────

router.get('/usage/by-tenant', (req, res) => {
  try {
    const { period = '7' } = req.query;
    const { startDate, endDate } = parsePeriod(period);

    const allTenants = getAllTenants();
    const tenantMap = {};
    for (const t of allTenants) tenantMap[t.id] = t.name;

    const rows = getUsageAllTenants(startDate, endDate);

    const grouped = {};
    for (const row of rows) {
      const tid = row.tenant_id;
      if (!grouped[tid]) {
        grouped[tid] = { tenantId: tid, tenantName: tenantMap[tid] || tid, requests: 0, inputTokens: 0, outputTokens: 0, cost: 0 };
      }
      grouped[tid].requests += row.requests;
      grouped[tid].inputTokens += row.input_tokens || 0;
      grouped[tid].outputTokens += row.output_tokens || 0;
      const pricing = getModelPricing(row.model);
      grouped[tid].cost += ((row.input_tokens || 0) / 1_000_000) * pricing.input;
      grouped[tid].cost += ((row.output_tokens || 0) / 1_000_000) * pricing.output;
    }

    const tenants = Object.values(grouped).sort((a, b) => b.cost - a.cost);
    res.json({ tenants });
  } catch (error) {
    console.error('Usage by-tenant error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /usage/recent-logs — Recent API Calls ─────────────────────────────

router.get('/usage/recent-logs', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const logs = getRecentApiLogs(limit);

    const enriched = logs.map((log) => {
      const pricing = getModelPricing(log.model);
      const cost = ((log.input_tokens || 0) / 1_000_000) * pricing.input + ((log.output_tokens || 0) / 1_000_000) * pricing.output;
      return { ...log, cost };
    });

    res.json({ logs: enriched });
  } catch (error) {
    console.error('Recent logs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /usage/logs — Paginated, Filtered API Logs ─────────────────────────

router.get('/usage/logs', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 25, 100);
    const page = parseInt(req.query.page) || 1;
    const offset = (page - 1) * limit;
    const { tenant_id, model, search } = req.query;

    const { rows, total } = getPaginatedApiLogs({ limit, offset, tenantId: tenant_id, model, search });

    const enriched = rows.map(log => {
      const pricing = getModelPricing(log.model);
      const cost = ((log.input_tokens || 0) / 1_000_000) * pricing.input + ((log.output_tokens || 0) / 1_000_000) * pricing.output;
      return { ...log, cost };
    });

    res.json({
      logs: enriched,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error('Paginated logs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /usage/spend — Enhanced Spend Analytics ────────────────────────────

router.get('/usage/spend', (req, res) => {
  try {
    const { period = '30' } = req.query;
    const { startDate, endDate } = parsePeriod(period);

    const byModel = getUsageAllTenants(startDate, endDate);
    const byDayByModel = getUsageByDayByModel(startDate, endDate);

    // Aggregate by model
    const modelMap = {};
    for (const row of byModel) {
      const key = row.model || 'unknown';
      if (!modelMap[key]) modelMap[key] = { model: key, requests: 0, input_tokens: 0, output_tokens: 0 };
      modelMap[key].requests += row.requests;
      modelMap[key].input_tokens += row.input_tokens || 0;
      modelMap[key].output_tokens += row.output_tokens || 0;
    }
    const models = Object.values(modelMap);
    const totalRequests = models.reduce((s, r) => s + r.requests, 0);
    const totalCost = calcCost(models);

    // By day with model breakdown
    const dayMap = {};
    for (const row of byDayByModel) {
      if (!dayMap[row.day]) dayMap[row.day] = { day: row.day, total: 0, models: {} };
      const pricing = getModelPricing(row.model);
      const cost = ((row.input_tokens || 0) / 1_000_000) * pricing.input + ((row.output_tokens || 0) / 1_000_000) * pricing.output;
      const mKey = (row.model || '').toLowerCase().includes('haiku') ? 'haiku'
        : (row.model || '').toLowerCase().includes('opus') ? 'opus'
        : (row.model || '').toLowerCase().includes('sonar') || (row.model || '').toLowerCase().includes('perplexity') ? 'perplexity'
        : 'sonnet';
      dayMap[row.day].models[mKey] = (dayMap[row.day].models[mKey] || 0) + cost;
      dayMap[row.day].total += cost;
    }

    // Per-tenant breakdown
    const tenantGroups = {};
    const allTenants = getAllTenants();
    const tenantNames = {};
    for (const t of allTenants) tenantNames[t.id] = t.name;
    for (const row of byModel) {
      const tid = row.tenant_id;
      if (!tenantGroups[tid]) tenantGroups[tid] = { tenantId: tid, tenantName: tenantNames[tid] || tid, requests: 0, inputTokens: 0, outputTokens: 0, cost: 0 };
      tenantGroups[tid].requests += row.requests;
      tenantGroups[tid].inputTokens += row.input_tokens || 0;
      tenantGroups[tid].outputTokens += row.output_tokens || 0;
      const pricing = getModelPricing(row.model);
      tenantGroups[tid].cost += ((row.input_tokens || 0) / 1_000_000) * pricing.input + ((row.output_tokens || 0) / 1_000_000) * pricing.output;
    }

    const days = parseInt(period) || 30;
    const daysElapsed = Object.keys(dayMap).length || 1;
    const avgPerDay = totalCost / daysElapsed;
    const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    const projectedMonthly = avgPerDay * daysInMonth;
    const costPerCall = totalRequests > 0 ? totalCost / totalRequests : 0;

    // Add model cost to each model entry
    for (const m of models) {
      m.cost = calcCost([m]);
    }

    res.json({
      summary: { totalRequests, totalCost, projectedMonthly, avgPerDay, costPerCall, daysElapsed },
      byModel: models.sort((a, b) => b.requests - a.requests),
      byDay: Object.values(dayMap).sort((a, b) => a.day.localeCompare(b.day)),
      byTenant: Object.values(tenantGroups).sort((a, b) => b.cost - a.cost),
    });
  } catch (error) {
    console.error('Spend analytics error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /system/health — Comprehensive System Health ────────────────────────

const __admin_filename = fileURLToPath(import.meta.url);
const __admin_dirname = dirname(__admin_filename);
const DATA_DIR = join(__admin_dirname, '../../data');
const DB_PATH = join(DATA_DIR, 'system.db'); // Primary DB for health checks

function safeExec(cmd, timeout = 5000) {
  try {
    return execSync(cmd, { timeout, encoding: 'utf-8' }).trim();
  } catch { return null; }
}

function getPm2Processes() {
  const raw = safeExec('pm2 jlist');
  if (!raw) return [];
  try {
    const procs = JSON.parse(raw);
    return procs.map(p => ({
      pm_id: p.pm_id,
      name: p.name,
      mode: p.pm2_env?.exec_mode || 'fork',
      pid: p.pid,
      status: p.pm2_env?.status || 'unknown',
      cpu: p.monit?.cpu || 0,
      memory: p.monit?.memory || 0,
      uptime: p.pm2_env?.pm_uptime ? Date.now() - p.pm2_env.pm_uptime : 0,
      restarts: p.pm2_env?.restart_time || 0,
      nodeVersion: p.pm2_env?.node_version || null,
    }));
  } catch { return []; }
}

function getDbStats() {
  try {
    const stat = fs.statSync(DB_PATH);
    return {
      fileSizeMB: (stat.size / (1024 * 1024)).toFixed(2),
      lastModified: stat.mtime.toISOString(),
    };
  } catch { return { fileSizeMB: '0', lastModified: null }; }
}

function getEnvVarStatus() {
  const keys = [
    'ANTHROPIC_API_KEY', 'PERPLEXITY_API_KEY', 'ELEVENLABS_API_KEY',
    'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'VULTR_API_KEY',
    'ERCOT_API_KEY', 'FRED_API_KEY', 'EIA_API_KEY',
    'JWT_SECRET', 'PORT', 'NODE_ENV',
  ];
  return keys.map(key => ({
    key,
    set: !!process.env[key],
    masked: process.env[key] ? `${process.env[key].slice(0, 4)}${'*'.repeat(Math.min(20, (process.env[key].length || 4) - 4))}` : null,
  }));
}

function getNginxStatus() {
  const running = safeExec('pgrep -x nginx');
  if (running) {
    const connections = safeExec("ss -s 2>/dev/null | head -2") || '';
    return { status: 'healthy', pid: running.split('\n')[0] };
  }
  return { status: 'unknown' };
}

router.get('/system/health', async (req, res) => {
  try {
    const mem = process.memoryUsage();
    const pm2Procs = getPm2Processes();
    const dbStats = getDbStats();
    const envVars = getEnvVarStatus();
    const nginx = getNginxStatus();
    const backendProc = pm2Procs.find(p => p.name === 'coppice-backend');

    const health = {
      // Overall status
      allOperational: true,
      timestamp: new Date().toISOString(),

      // Services
      services: {
        backend: {
          name: 'Backend API',
          type: 'Node.js',
          status: 'healthy',
          port: process.env.PORT || 3002,
          uptime: Math.floor(process.uptime()),
          nodeVersion: process.version,
          memoryMB: Math.round(mem.rss / (1024 * 1024)),
          heapUsedMB: Math.round(mem.heapUsed / (1024 * 1024)),
          heapTotalMB: Math.round(mem.heapTotal / (1024 * 1024)),
        },
        database: {
          name: 'Database',
          type: 'SQLite',
          status: 'healthy',
          engine: 'better-sqlite3',
          fileSizeMB: dbStats.fileSizeMB,
          lastModified: dbStats.lastModified,
          journalMode: 'WAL',
        },
        nginx: {
          name: 'Nginx',
          type: 'Reverse Proxy',
          status: nginx.status,
          pid: nginx.pid || null,
        },
        vps: {
          name: 'VPS',
          type: 'Vultr Cloud',
          status: 'healthy',
          ip: '104.238.162.227',
          location: 'Chicago',
        },
        cloudflare: {
          name: 'Cloudflare',
          type: 'DNS + SSL',
          status: 'healthy',
          domains: ['coppice.ai', 'sangha.coppice.ai', 'dacp.coppice.ai'],
        },
      },

      // PM2 processes
      pm2: pm2Procs,

      // Environment variables
      envVars,

      // System metrics
      system: {
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        pid: process.pid,
      },
    };

    // VPS details from Vultr API
    const vultrKey = process.env.VULTR_API_KEY;
    if (vultrKey) {
      try {
        const instanceResp = await fetch('https://api.vultr.com/v2/instances', {
          headers: { 'Authorization': `Bearer ${vultrKey}` },
        });
        if (instanceResp.ok) {
          const iData = await instanceResp.json();
          const instance = iData.instances?.find(i => i.main_ip === '104.238.162.227');
          if (instance) {
            health.services.vps.plan = instance.plan;
            health.services.vps.monthlyCost = instance.monthly_charge;
            health.services.vps.ram = instance.ram;
            health.services.vps.vcpus = instance.vcpu_count;
            health.services.vps.disk = instance.disk;
            health.services.vps.os = instance.os;
            health.services.vps.bandwidth = instance.allowed_bandwidth_gb;
            health.services.vps.currentBandwidthGB = instance.current_bandwidth_gb;
            health.services.vps.region = instance.region;
          }
        }

        // Get billing info
        const billResp = await fetch('https://api.vultr.com/v2/billing/invoices?per_page=1', {
          headers: { 'Authorization': `Bearer ${vultrKey}` },
        });
        if (billResp.ok) {
          const bData = await billResp.json();
          const latest = bData.billing_invoices?.[0];
          if (latest) {
            health.services.vps.lastInvoice = latest.amount;
            health.services.vps.billingPeriod = latest.description;
          }
        }
      } catch (e) {
        console.error('Vultr API error:', e.message);
      }
    }

    // Check if any service is down
    for (const svc of Object.values(health.services)) {
      if (svc.status === 'down' || svc.status === 'error') {
        health.allOperational = false;
        break;
      }
    }

    res.json(health);
  } catch (error) {
    console.error('System health error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /usage/opus — Opus Report Usage Per Tenant ─────────────────────────

router.get('/usage/opus', (req, res) => {
  try {
    const now = new Date();
    const yearMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const rows = getOpusUsageAllTenants(yearMonth);

    const allTenants = getAllTenants();
    const tenants = allTenants.map(t => {
      const usage = rows.find(r => r.tenant_id === t.id);
      const limits = t.limits || {};
      const limit = limits.maxOpusReportsPerDay ?? 1;
      const dailyCount = getOpusDailyCount(t.id);
      return {
        tenantId: t.id,
        tenantName: t.name,
        monthlyCount: usage?.monthly_count || 0,
        dailyCount,
        limitPerDay: limit,
      };
    });

    res.json({ yearMonth, tenants });
  } catch (error) {
    console.error('Opus usage error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET/PUT /tenants/:id/opus-limit — Per-Tenant Opus Limit ────────────────

router.get('/tenants/:id/opus-limit', (req, res) => {
  try {
    const tenant = getTenant(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    const limits = tenant.limits || {};
    const { allowed, count, limit, resetsAt } = checkOpusLimit(tenant.id);
    res.json({ maxOpusReportsPerDay: limits.maxOpusReportsPerDay ?? 1, todayCount: count, allowed, resetsAt });
  } catch (error) {
    console.error('Get opus limit error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/tenants/:id/opus-limit', (req, res) => {
  try {
    const tenant = getTenant(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    const { maxOpusReportsPerDay } = req.body;
    if (maxOpusReportsPerDay == null || typeof maxOpusReportsPerDay !== 'number' || maxOpusReportsPerDay < 0) {
      return res.status(400).json({ error: 'maxOpusReportsPerDay must be a non-negative number' });
    }

    const limits = tenant.limits || {};
    limits.maxOpusReportsPerDay = maxOpusReportsPerDay;
    updateTenant(tenant.id, { limits });

    res.json({ success: true, maxOpusReportsPerDay });
  } catch (error) {
    console.error('Update opus limit error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
