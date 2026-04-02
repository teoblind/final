/**
 * Sangha Admin Routes
 *
 * Cross-tenant administration endpoints for sangha_admin and
 * sangha_underwriter roles. Provides tenant overview, aggregate
 * metrics, underwriting pipeline, and cross-tenant audit log.
 */

import express from 'express';
import { execSync } from 'child_process';
import { randomBytes } from 'crypto';
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
  getTenantDb,
} from '../cache/database.js';
import { isTunnelHealthy } from '../services/claudeAgent.js';
import { checkAllTokenHealth, getTokenHealthStatus } from '../jobs/gmailPoll.js';
import { google } from 'googleapis';
import { verifyAccessToken } from '../services/authService.js';

const router = express.Router();

// ─── Re-Auth Routes (unauthenticated - OAuth redirects have no JWT header) ──

function getReauthRedirectUri(req) {
  const host = req.headers['x-forwarded-host'] || req.get('host');
  const proto = process.env.NODE_ENV === 'production' ? 'https' : (req.headers['x-forwarded-proto'] || req.protocol);
  return `${proto}://${host}/api/v1/admin/email/reauth/callback`;
}
const REAUTH_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/presentations',
  'openid',
  'email',
];

router.get('/email/reauth/start', (req, res) => {
  try {
    const { tenantId, token } = req.query;
    if (!token) return res.status(401).send('Authentication required');
    if (!tenantId) return res.status(400).send('tenantId is required');

    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch (err) {
      return res.status(401).send('Invalid or expired token');
    }

    // Look up login_hint - prefer user's personal email over agent email
    let loginHint = null;
    try {
      const tdb = getTenantDb(tenantId);
      // Use the requesting user's email (personal account) if available, otherwise fall back to agent
      const userRow = decoded?.userId ? tdb.prepare('SELECT email FROM users WHERE id = ?').get(decoded.userId) : null;
      if (userRow?.email) {
        loginHint = userRow.email;
      } else {
        const row = tdb.prepare('SELECT sender_email FROM tenant_email_config WHERE tenant_id = ?').get(tenantId);
        if (row) loginHint = row.sender_email;
      }
    } catch {}

    const originHost = req.headers['x-forwarded-host'] || req.get('host');
    const originProto = process.env.NODE_ENV === 'production' ? 'https' : (req.headers['x-forwarded-proto'] || req.protocol);
    const state = Buffer.from(JSON.stringify({
      tenantId,
      userId: decoded.userId,
      origin: `${originProto}://${originHost}`,
    })).toString('base64url');

    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.GMAIL_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.env.GMAIL_CLIENT_SECRET;
    const redirectUri = getReauthRedirectUri(req);
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: REAUTH_SCOPES,
      state,
      login_hint: loginHint,
    });

    res.redirect(authUrl);
  } catch (error) {
    console.error('[Re-Auth] Start error:', error);
    res.status(500).send('Failed to start re-auth flow');
  }
});

router.get('/email/reauth/callback', async (req, res) => {
  try {
    const { code, state, error: oauthError } = req.query;

    if (oauthError || !code || !state) {
      return res.status(400).send(`<html><body style="font-family:-apple-system,sans-serif;text-align:center;margin-top:40px;color:#c0392b;">
        <p>Re-auth failed: ${oauthError || 'missing code or state'}</p>
        <script>setTimeout(()=>window.close(),3000);</script>
      </body></html>`);
    }

    let stateData;
    try {
      stateData = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
    } catch {
      return res.status(400).send('Invalid state parameter');
    }

    const { tenantId, origin } = stateData;
    if (!tenantId) return res.status(400).send('Missing tenantId in state');

    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.GMAIL_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.env.GMAIL_CLIENT_SECRET;
    const redirectUri = getReauthRedirectUri(req);
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.refresh_token) {
      return res.status(400).send(`<html><body style="font-family:-apple-system,sans-serif;text-align:center;margin-top:40px;color:#c0392b;">
        <p>No refresh token received. Make sure to grant all permissions.</p>
        <script>setTimeout(()=>window.close(),3000);</script>
      </body></html>`);
    }

    // Get email from id_token
    let email = null;
    if (tokens.id_token) {
      try {
        const payload = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64').toString());
        email = payload.email;
      } catch {}
    }

    // Update the tenant's DB with new refresh token + timestamp
    try {
      const tdb = getTenantDb(tenantId);
      tdb.prepare(`
        UPDATE tenant_email_config
        SET gmail_refresh_token = ?, token_last_authed_at = datetime('now'), updated_at = datetime('now')
        WHERE tenant_id = ?
      `).run(tokens.refresh_token, tenantId);

      // Also update ALL key vault services so calendar, docs, drive, sheets all work
      const { upsertKeyVaultEntry, setTenantContext } = await import('../cache/database.js');

      // Detect if this is a personal account (different from the agent/sender email)
      const isPersonalAccount = email && !email.includes('agent@') && !email.includes('coppice.ai');

      await new Promise((resolve) => {
        setTenantContext(tenantId, () => {
          for (const service of ['google-gmail', 'google-calendar', 'google-docs']) {
            upsertKeyVaultEntry({ tenantId, service, keyName: 'refresh_token', keyValue: tokens.refresh_token, addedBy: 'reauth' });
            if (tokens.access_token) {
              upsertKeyVaultEntry({ tenantId, service, keyName: 'access_token', keyValue: tokens.access_token, addedBy: 'reauth' });
            }
          }
          // If this is a personal account, also store under 'google-calendar-user' so
          // the meetings route can query the user's personal calendar (not the agent's)
          if (isPersonalAccount) {
            upsertKeyVaultEntry({ tenantId, service: 'google-calendar-user', keyName: 'refresh_token', keyValue: tokens.refresh_token, addedBy: `reauth:${email}` });
            if (tokens.access_token) {
              upsertKeyVaultEntry({ tenantId, service: 'google-calendar-user', keyName: 'access_token', keyValue: tokens.access_token, addedBy: `reauth:${email}` });
            }
            console.log(`[Re-Auth] Stored personal calendar token for ${email} under google-calendar-user`);
          }
          resolve();
        });
      });

      console.log(`[Re-Auth] Token updated for tenant ${tenantId} (${email || 'unknown email'}) - email config + key vault (gmail, calendar, docs)`);
    } catch (dbErr) {
      console.error('[Re-Auth] DB update error:', dbErr);
      return res.status(500).send('Failed to save new token');
    }

    const postMessageOrigin = origin || '*';
    return res.send(`<!DOCTYPE html><html><head><title>Re-Auth Success</title></head><body>
      <p style="font-family:-apple-system,sans-serif;text-align:center;margin-top:40px;color:#1a6b3c;">
        Token refreshed for ${email || tenantId}. This window will close.
      </p>
      <script>
        if(window.opener){
          window.opener.postMessage({type:'email-reauth-success',tenantId:${JSON.stringify(tenantId)},email:${JSON.stringify(email)}},${JSON.stringify(postMessageOrigin)});
        }
        setTimeout(()=>window.close(),2000);
      </script>
    </body></html>`);
  } catch (error) {
    console.error('[Re-Auth] Callback error:', error);
    res.status(500).send(`<html><body style="font-family:-apple-system,sans-serif;text-align:center;margin-top:40px;color:#c0392b;">
      <p>Re-auth error: ${error.message}</p>
      <script>setTimeout(()=>window.close(),5000);</script>
    </body></html>`);
  }
});

// All remaining routes require authentication + sangha_admin or sangha_underwriter role
router.use(authenticate);
router.use(requireRole('sangha_admin', 'sangha_underwriter'));

// ─── GET /tenants - List All Tenants with Summary Data ──────────────────────

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

// ─── GET /tenants/:id - Detailed Tenant View ────────────────────────────────

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

// ─── GET /tenants/:id/users - Users for a Tenant ────────────────────────────

router.get('/tenants/:id/users', (req, res) => {
  try {
    const users = getUsersByTenant(req.params.id);
    res.json({ users });
  } catch (error) {
    console.error('Get tenant users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /users/:id - Remove a User ───────────────────────────────────────

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
    // Prevent cross-tenant deletion
    if (user.tenant_id !== req.user.tenantId) {
      return res.status(403).json({ error: 'Cannot delete users from other tenants' });
    }
    deleteUser(id);
    res.json({ success: true, message: `User ${user.email} deleted` });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /users/:id/reset-password - Reset a User's Password ───────────────

router.post('/users/:id/reset-password', (req, res) => {
  try {
    const { id } = req.params;
    const user = getUserById(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    // Prevent cross-tenant password reset
    if (user.tenant_id !== req.user.tenantId) {
      return res.status(403).json({ error: 'Cannot reset passwords for users in other tenants' });
    }
    // Generate cryptographically strong temporary password
    const tempPassword = randomBytes(12).toString('base64url'); // 16 chars, URL-safe
    const passwordHash = bcryptPkg.hashSync(tempPassword, 12);
    updateUser(id, { passwordHash, mustChangePassword: 1 });
    // Return password only this once - admin must relay it securely
    res.json({ success: true, message: `Password reset for ${user.email}`, temporaryPassword: tempPassword, mustChangePassword: true });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /aggregate - Cross-Tenant Aggregate Metrics ────────────────────────

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

// ─── GET /underwriting/pipeline - Underwriting Pipeline ─────────────────────

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

// ─── POST /underwriting/export - Export Underwriting Data ───────────────────

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

// ─── GET /audit - Cross-Tenant Audit Log ────────────────────────────────────

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

// ─── GET /usage - Usage Stats (optionally filtered by tenant) ───────────────

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

// ─── GET /usage/by-tenant - Per-Tenant Usage Breakdown ──────────────────────

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

// ─── GET /usage/recent-logs - Recent API Calls ─────────────────────────────

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

// ─── GET /usage/logs - Paginated, Filtered API Logs ─────────────────────────

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

// ─── GET /usage/spend - Enhanced Spend Analytics ────────────────────────────

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

// ─── GET /system/health - Comprehensive System Health ────────────────────────

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

    // Tunnel health check (SSH reverse tunnel to Mac for Claude CLI)
    try {
      const tunnelUp = await isTunnelHealthy();
      health.services.tunnel = {
        name: 'CLI Tunnel',
        type: 'SSH Reverse Tunnel',
        status: tunnelUp ? 'healthy' : 'down',
        host: '127.0.0.1',
        port: 2222,
        target: 'Mac (claude CLI)',
        cliEnabled: process.env.CLAUDE_CLI_ENABLED === 'true',
      };

      // Check OAuth token expiry on Mac (via SSH)
      if (tunnelUp) {
        try {
          const oauthStatus = await new Promise((resolve) => {
            const { spawn } = require('child_process');
            const sshKey = process.env.CLAUDE_SSH_KEY || '/root/.ssh/id_ed25519';
            const sshUser = process.env.CLAUDE_SSH_USER || 'teoblind';
            const proc = spawn('ssh', [
              '-4', '-i', sshKey, '-p', '2222',
              '-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=5', '-o', 'BatchMode=yes',
              `${sshUser}@127.0.0.1`,
              '/usr/bin/python3', '-c',
              'import json,time; d=json.load(open("/Users/teoblind/.claude-oauth-token")); exp=d.get("expiresAt",0); now=int(time.time()*1000); print(json.dumps({"expiresAt":exp,"remainingMs":exp-now,"valid":exp>now}))',
            ], { stdio: ['pipe', 'pipe', 'pipe'] });

            let out = '';
            proc.stdout.on('data', (d) => { out += d; });
            const timer = setTimeout(() => { proc.kill('SIGTERM'); resolve(null); }, 6000);
            proc.on('close', () => {
              clearTimeout(timer);
              try { resolve(JSON.parse(out.trim())); } catch { resolve(null); }
            });
          });

          if (oauthStatus) {
            const remainingHrs = oauthStatus.remainingMs / 3600000;
            health.services.tunnel.oauth = {
              valid: oauthStatus.valid,
              expiresAt: new Date(oauthStatus.expiresAt).toISOString(),
              remainingHours: Math.round(remainingHrs * 10) / 10,
            };
            // Mark tunnel as warning if token expires within 2 hours
            if (!oauthStatus.valid) {
              health.services.tunnel.status = 'down';
              health.services.tunnel.oauth.message = 'OAuth token expired - tasks will fail';
            } else if (remainingHrs < 2) {
              health.services.tunnel.status = 'warning';
              health.services.tunnel.oauth.message = `Token expires in ${Math.round(remainingHrs * 10) / 10}h`;
            }
          }
        } catch (oauthErr) {
          health.services.tunnel.oauth = { valid: false, error: oauthErr.message };
        }
      }
    } catch (e) {
      health.services.tunnel = {
        name: 'CLI Tunnel',
        type: 'SSH Reverse Tunnel',
        status: 'down',
        host: '127.0.0.1',
        port: 2222,
        target: 'Mac (claude CLI)',
        cliEnabled: process.env.CLAUDE_CLI_ENABLED === 'true',
        error: e.message,
      };
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

// ─── POST /overnight-analysis - Manually trigger overnight analysis ──────────

router.post('/overnight-analysis', async (req, res) => {
  try {
    const { runOvernightAnalysis } = await import('../jobs/overnightAnalysis.js');
    runOvernightAnalysis().catch(err => console.error('[Admin] Manual overnight analysis error:', err.message));
    res.json({ success: true, message: 'Overnight analysis triggered' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── POST /daily-newsletter - Manually trigger daily newsletter ──────────────

router.post('/daily-newsletter', async (req, res) => {
  try {
    const { runDailyNewsletter } = await import('../jobs/dailyNewsletter.js');
    const { tenant_id, recipient } = req.body || {};
    runDailyNewsletter({ tenantFilter: tenant_id, recipientOverride: recipient }).catch(err => console.error('[Admin] Manual newsletter error:', err.message));
    res.json({ success: true, message: `Daily newsletter triggered${tenant_id ? ` for ${tenant_id}` : ''}${recipient ? ` -> ${recipient}` : ''}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── GET /newsletters - List stored newsletters ─────────────────────────────

router.get('/newsletters', (req, res) => {
  try {
    const tenantId = req.tenantId || req.query.tenantId;
    if (!tenantId) return res.status(400).json({ error: 'tenantId required' });
    const { getTenantDb } = require('../cache/database.js');
    const db = getTenantDb(tenantId);
    const newsletters = db.prepare(`
      SELECT id, title, content, created_at FROM knowledge_entries
      WHERE tenant_id = ? AND type = 'newsletter'
      ORDER BY created_at DESC LIMIT 30
    `).all(tenantId);
    res.json({ newsletters });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── GET /usage/opus - Opus Report Usage Per Tenant ─────────────────────────

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

// ─── GET/PUT /tenants/:id/opus-limit - Per-Tenant Opus Limit ────────────────

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

// ─── GET /email/health - Token Health for All Tenant Inboxes ────────────────

router.get('/email/health', async (req, res) => {
  try {
    // If we have cached results less than 5 minutes old, return those
    const cached = getTokenHealthStatus();
    const cacheAge = cached.lastChecked ? (Date.now() - new Date(cached.lastChecked).getTime()) : Infinity;
    if (cacheAge < 5 * 60 * 1000 && cached.tokens.length > 0) {
      return res.json(cached);
    }
    // Otherwise run a fresh check
    const tokens = await checkAllTokenHealth();
    res.json({ lastChecked: new Date().toISOString(), tokens });
  } catch (error) {
    console.error('Token health check error:', error);
    res.status(500).json({ error: 'Failed to check token health' });
  }
});

// ─── POST /email/health/refresh - Force fresh token health check ────────────

router.post('/email/health/refresh', async (req, res) => {
  try {
    const tokens = await checkAllTokenHealth();
    res.json({ lastChecked: new Date().toISOString(), tokens });
  } catch (error) {
    console.error('Token health refresh error:', error);
    res.status(500).json({ error: 'Failed to check token health' });
  }
});

export default router;
