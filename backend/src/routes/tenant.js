/**
 * Tenant & User Management Routes
 *
 * Handles tenant settings, user management, invitations,
 * API keys, audit log, and site configuration.
 * All routes require authentication.
 */

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authenticate, requireRole, requirePermission } from '../middleware/auth.js';
import {
  getTenant,
  updateTenant,
  getUsersByTenant,
  updateUser,
  deleteUser,
  createInvitation,
  getInvitationsByTenant,
  revokeInvitation,
  getApiKeys,
  createApiKey,
  revokeApiKey,
  getAuditLog,
  getSites,
  createSite,
  updateSite,
  deleteSite,
  insertAuditLog,
  getUserById,
  getTrustedSenders,
  addTrustedSender,
  removeTrustedSender,
  getEmailSecurityLog,
  getFleetConfig,
  saveFleetConfig,
  getPoolConfig,
  savePoolConfig,
} from '../cache/database.js';
import { generateApiKey } from '../services/authService.js';
import { sendHtmlEmail } from '../services/emailService.js';
import { getTenantEmailConfig } from '../cache/database.js';

const router = express.Router();

// ─── GET /public — Public Tenant Branding (no auth) ─────────────────────────

router.get('/public', (req, res) => {
  const tenant = req.resolvedTenant;
  if (!tenant) {
    return res.json({ name: 'AMPERA', slug: 'default', branding: {} });
  }
  const { companyName, primaryColor, logo, hideSanghaBranding } = tenant.branding || {};
  const settings = tenant.settings || {};
  res.json({
    name: tenant.name,
    slug: tenant.slug,
    branding: { companyName, primaryColor, logo, hideSanghaBranding },
    settings: {
      industry: settings.industry || null,
      macro_intelligence: !!settings.macro_intelligence,
      correlations: !!settings.correlations,
      liquidity: !!settings.liquidity,
      hpc_enabled: !!settings.hpc_enabled,
      thread_privacy: !!settings.thread_privacy,
    },
  });
});

// All routes below require authentication
router.use(authenticate);

// ─── GET / — Get Current Tenant Info ────────────────────────────────────────

router.get('/', (req, res) => {
  try {
    const tenant = getTenant(req.user.tenantId);
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }
    // Add seat info
    const users = getUsersByTenant(req.user.tenantId);
    const activeUsers = users.filter(u => u.status === 'active');
    tenant.seatCount = activeUsers.length;
    tenant.seatLimit = (tenant.limits && tenant.limits.maxUsers) || 999;
    res.json({ tenant });
  } catch (error) {
    console.error('Get tenant error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT / — Update Tenant ──────────────────────────────────────────────────

router.put('/', requirePermission('manageSettings'), (req, res) => {
  try {
    const { name, branding, settings, limits } = req.body;

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (branding !== undefined) updates.branding = branding;
    if (settings !== undefined) updates.settings = settings;
    if (limits !== undefined) updates.limits = limits;

    updateTenant(req.user.tenantId, updates);

    insertAuditLog({
      tenantId: req.user.tenantId,
      userId: req.user.id,
      action: 'tenant.update',
      resourceType: 'tenant',
      resourceId: req.user.tenantId,
      details: { fields: Object.keys(updates) },
      ipAddress: req.ip,
    });

    const tenant = getTenant(req.user.tenantId);
    res.json({ tenant });
  } catch (error) {
    console.error('Update tenant error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /users — List Tenant Users ─────────────────────────────────────────

router.get('/users', requirePermission('manageUsers'), (req, res) => {
  try {
    const users = getUsersByTenant(req.user.tenantId);
    res.json({ users });
  } catch (error) {
    console.error('List users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /users/invite — Invite User ───────────────────────────────────────

router.post('/users/invite', requirePermission('manageUsers'), async (req, res) => {
  try {
    const { email, role } = req.body;

    if (!email || !role) {
      return res.status(400).json({ error: 'Email and role are required' });
    }

    // Seat limit check
    const tenant = getTenant(req.user.tenantId);
    const seatLimit = (tenant?.limits && tenant.limits.maxUsers) || 999;
    const users = getUsersByTenant(req.user.tenantId);
    const activeCount = users.filter(u => u.status === 'active').length;
    if (activeCount >= seatLimit) {
      return res.status(403).json({
        error: 'seat_limit_reached',
        message: `Seat limit reached (${activeCount}/${seatLimit}). Upgrade to add more users.`,
        limit: seatLimit,
        current: activeCount,
      });
    }

    const invitationId = uuidv4();
    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    createInvitation({
      id: invitationId,
      tenantId: req.user.tenantId,
      email,
      role,
      invitedBy: req.user.id,
      token,
      expiresAt,
    });

    insertAuditLog({
      tenantId: req.user.tenantId,
      userId: req.user.id,
      action: 'user.invite',
      resourceType: 'invitation',
      resourceId: invitationId,
      details: { email, role },
      ipAddress: req.ip,
    });

    // Auto-send invitation email
    const tenantId = req.user.tenantId;
    const slug = tenant.slug || 'app';
    const subdomain = slug === 'default' ? 'sangha' : slug;
    const domain = `${subdomain}.coppice.ai`;
    const inviteUrl = `https://${domain}/login?invite=${token}&email=${encodeURIComponent(email)}`;
    const inviterName = req.user.name || 'Your team';
    const tenantName = tenant.name || 'Coppice';
    const branding = tenant.branding || {};
    const primaryColor = branding.primaryColor || '#1a6b3c';
    const agentConfig = getTenantEmailConfig(tenantId);
    const agentEmail = agentConfig?.senderEmail || 'agent@coppice.ai';
    const agentName = agentConfig?.senderName || 'Coppice Agent';

    // Tenant-specific theming
    const isVenture = branding.hideSanghaBranding || slug === 'zhan';
    const accentColor = isVenture ? '#4a8a5a' : primaryColor;
    const accentBg = isVenture ? '#1a2a1a' : `${primaryColor}15`;
    const accentBorder = isVenture ? '#2a3a2a' : `${primaryColor}30`;
    const brandInitials = tenantName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const tagline = branding.tagline || (isVenture ? 'Family Office Intelligence' : 'Powered by Coppice');

    // Role display
    const roleColors = {
      viewer: { color: '#3a5a7a', bg: '#141e26', border: '#1e2a36' },
      operator: { color: '#4a7a5a', bg: '#141e18', border: '#1e2a20' },
      admin: { color: '#7a6a4a', bg: '#1e1a14', border: '#2a2620' },
      owner: { color: '#7a4a4a', bg: '#1e1414', border: '#2a2020' },
    };
    const rc = roleColors[role] || roleColors.viewer;

    try {
      await sendHtmlEmail({
        to: email,
        subject: `You've been invited to ${tenantName}`,
        html: buildInviteEmailHtml({
          inviterName, tenantName, role, email, inviteUrl, domain,
          agentEmail, agentName, brandInitials, tagline, accentColor,
          accentBg, accentBorder, rc, isVenture,
        }),
        tenantId,
        skipSignature: true,
      });
    } catch (emailErr) {
      console.warn('Failed to send invitation email:', emailErr.message);
      // Non-blocking — invitation still created, link still works
    }

    res.status(201).json({
      invitation: {
        id: invitationId,
        email,
        role,
        token,
        expiresAt,
      },
    });
  } catch (error) {
    console.error('Invite user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /users/:id — Update User Role ──────────────────────────────────────

router.put('/users/:id', requirePermission('manageUsers'), (req, res) => {
  try {
    const { id } = req.params;

    if (id === req.user.id) {
      return res.status(400).json({ error: 'Cannot change your own role' });
    }

    const { role } = req.body;
    if (!role) {
      return res.status(400).json({ error: 'Role is required' });
    }

    updateUser(id, { role });

    insertAuditLog({
      tenantId: req.user.tenantId,
      userId: req.user.id,
      action: 'user.updateRole',
      resourceType: 'user',
      resourceId: id,
      details: { newRole: role },
      ipAddress: req.ip,
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /users/:id — Remove User ────────────────────────────────────────

router.delete('/users/:id', requirePermission('manageUsers'), (req, res) => {
  try {
    const { id } = req.params;

    if (id === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete yourself' });
    }

    deleteUser(id);

    insertAuditLog({
      tenantId: req.user.tenantId,
      userId: req.user.id,
      action: 'user.delete',
      resourceType: 'user',
      resourceId: id,
      ipAddress: req.ip,
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /invitations — List Invitations ────────────────────────────────────

router.get('/invitations', (req, res) => {
  try {
    const invitations = getInvitationsByTenant(req.user.tenantId);
    res.json({ invitations });
  } catch (error) {
    console.error('List invitations error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /invitations/:id — Revoke Invitation ────────────────────────────

router.delete('/invitations/:id', (req, res) => {
  try {
    const { id } = req.params;
    revokeInvitation(id);
    res.json({ success: true });
  } catch (error) {
    console.error('Revoke invitation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api-keys — List API Keys ──────────────────────────────────────────

router.get('/api-keys', requirePermission('createApiKeys'), (req, res) => {
  try {
    const keys = getApiKeys(req.user.tenantId);
    res.json({ apiKeys: keys });
  } catch (error) {
    console.error('List API keys error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api-keys — Create API Key ────────────────────────────────────────

router.post('/api-keys', requirePermission('createApiKeys'), (req, res) => {
  try {
    const { name, permissions, rateLimit, expiresAt } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const keyId = uuidv4();
    const { key, prefix, hash } = generateApiKey();

    createApiKey({
      id: keyId,
      tenantId: req.user.tenantId,
      userId: req.user.id,
      name,
      keyHash: hash,
      keyPrefix: prefix,
      permissions: permissions || null,
      rateLimit: rateLimit || null,
      expiresAt: expiresAt || null,
    });

    insertAuditLog({
      tenantId: req.user.tenantId,
      userId: req.user.id,
      action: 'apiKey.create',
      resourceType: 'api_key',
      resourceId: keyId,
      details: { name, prefix },
      ipAddress: req.ip,
    });

    // Return the full key only this one time
    res.status(201).json({
      apiKey: {
        id: keyId,
        name,
        key,
        prefix,
        createdAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Create API key error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /api-keys/:id — Revoke API Key ──────────────────────────────────

router.delete('/api-keys/:id', requirePermission('createApiKeys'), (req, res) => {
  try {
    const { id } = req.params;
    revokeApiKey(id);

    insertAuditLog({
      tenantId: req.user.tenantId,
      userId: req.user.id,
      action: 'apiKey.revoke',
      resourceType: 'api_key',
      resourceId: id,
      ipAddress: req.ip,
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Revoke API key error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /audit-log — View Audit Log ────────────────────────────────────────

router.get('/audit-log', requirePermission('viewAuditLog'), (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;
    const entries = getAuditLog(req.user.tenantId, limit, offset);
    res.json({ auditLog: entries, limit, offset });
  } catch (error) {
    console.error('Get audit log error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /sites — List Sites ────────────────────────────────────────────────

router.get('/sites', (req, res) => {
  try {
    const sites = getSites(req.user.tenantId);
    res.json({ sites });
  } catch (error) {
    console.error('List sites error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /sites — Create Site ──────────────────────────────────────────────

router.post('/sites', requirePermission('manageSettings'), (req, res) => {
  try {
    const { name, location, iso, energyNode, totalCapacityMW, workloadIds, status } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const siteId = uuidv4();
    createSite({
      id: siteId,
      tenantId: req.user.tenantId,
      name,
      location: location || null,
      iso: iso || 'ERCOT',
      energyNode: energyNode || null,
      totalCapacityMW: totalCapacityMW || 0,
      workloadIds: workloadIds || [],
      status: status || 'operational',
    });

    insertAuditLog({
      tenantId: req.user.tenantId,
      userId: req.user.id,
      action: 'site.create',
      resourceType: 'site',
      resourceId: siteId,
      details: { name },
      ipAddress: req.ip,
    });

    res.status(201).json({ success: true, id: siteId });
  } catch (error) {
    console.error('Create site error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /sites/:id — Update Site ───────────────────────────────────────────

router.put('/sites/:id', requirePermission('manageSettings'), (req, res) => {
  try {
    const { id } = req.params;
    updateSite(id, req.body);

    insertAuditLog({
      tenantId: req.user.tenantId,
      userId: req.user.id,
      action: 'site.update',
      resourceType: 'site',
      resourceId: id,
      details: { fields: Object.keys(req.body) },
      ipAddress: req.ip,
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Update site error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /sites/:id — Delete Site ────────────────────────────────────────

router.delete('/sites/:id', requirePermission('manageSettings'), (req, res) => {
  try {
    const { id } = req.params;
    deleteSite(id);

    insertAuditLog({
      tenantId: req.user.tenantId,
      userId: req.user.id,
      action: 'site.delete',
      resourceType: 'site',
      resourceId: id,
      ipAddress: req.ip,
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete site error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /email-security/trusted-senders — List Trusted Senders ─────────────

router.get('/email-security/trusted-senders', requirePermission('manageSettings'), (req, res) => {
  try {
    const senders = getTrustedSenders(req.user.tenantId);
    res.json({ trustedSenders: senders });
  } catch (error) {
    console.error('List trusted senders error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /email-security/trusted-senders — Add Trusted Sender ──────────────

router.post('/email-security/trusted-senders', requirePermission('manageSettings'), (req, res) => {
  try {
    const { email, domain, displayName, trustLevel, notes } = req.body;

    if (!email && !domain) {
      return res.status(400).json({ error: 'Either email or domain is required' });
    }

    const result = addTrustedSender({
      tenantId: req.user.tenantId,
      email: email || null,
      domain: domain || null,
      displayName: displayName || null,
      trustLevel: trustLevel || 'trusted',
      notes: notes || null,
    });

    insertAuditLog({
      tenantId: req.user.tenantId,
      userId: req.user.id,
      action: 'emailSecurity.addTrustedSender',
      resourceType: 'email_trusted_sender',
      resourceId: String(result.lastInsertRowid),
      details: { email, domain, displayName, trustLevel },
      ipAddress: req.ip,
    });

    res.status(201).json({ success: true, id: result.lastInsertRowid });
  } catch (error) {
    console.error('Add trusted sender error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /email-security/trusted-senders/:id — Remove Trusted Sender ─────

router.delete('/email-security/trusted-senders/:id', requirePermission('manageSettings'), (req, res) => {
  try {
    const { id } = req.params;
    removeTrustedSender(parseInt(id, 10));

    insertAuditLog({
      tenantId: req.user.tenantId,
      userId: req.user.id,
      action: 'emailSecurity.removeTrustedSender',
      resourceType: 'email_trusted_sender',
      resourceId: id,
      ipAddress: req.ip,
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Remove trusted sender error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /email-security/log — View Email Security Log ──────────────────────

router.get('/email-security/log', requirePermission('viewAuditLog'), (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    const log = getEmailSecurityLog(req.user.tenantId, { limit, offset });
    res.json({ securityLog: log, limit, offset });
  } catch (error) {
    console.error('Get email security log error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Fleet Config ─────────────────────────────────────────────────────────

router.get('/fleet-config', authenticate, (req, res) => {
  try {
    const config = getFleetConfig();
    res.json({ configured: !!config, config: config || null });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/fleet-config', authenticate, requireRole('owner', 'sangha_admin', 'admin'), (req, res) => {
  try {
    saveFleetConfig(req.body);
    insertAuditLog({
      tenantId: req.user.tenantId,
      userId: req.user.id,
      action: 'fleet_config_updated',
      details: 'Fleet configuration saved',
    });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Pool Config ──────────────────────────────────────────────────────────

router.get('/pool-config', authenticate, (req, res) => {
  try {
    const config = getPoolConfig();
    const hasConfig = config && (config.pools?.length > 0 || config.provider);
    res.json({ configured: !!hasConfig, config });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/pool-config', authenticate, requireRole('owner', 'sangha_admin', 'admin'), (req, res) => {
  try {
    savePoolConfig(req.body);
    insertAuditLog({
      tenantId: req.user.tenantId,
      userId: req.user.id,
      action: 'pool_config_updated',
      details: 'Pool configuration saved',
    });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Invite Email Template ───────────────────────────────────────────────────

function buildInviteEmailHtml({ inviterName, tenantName, role, email, inviteUrl, domain, agentEmail, agentName, brandInitials, tagline, accentColor, accentBg, accentBorder, rc, isVenture }) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#0e0e0e;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif;">
<div style="max-width:520px;margin:0 auto;padding:40px 20px;">

  <!-- Top bar -->
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;padding:0 2px;">
    <div style="display:flex;align-items:center;gap:8px;">
      <div style="width:26px;height:26px;border-radius:6px;background:#1a1a1a;border:1px solid #2a2a2a;text-align:center;line-height:26px;font-size:10px;font-weight:600;color:#666;letter-spacing:0.04em;">${brandInitials}</div>
      <span style="font-size:13px;font-weight:500;color:#555;letter-spacing:0.02em;">${tenantName}</span>
    </div>
    <span style="font-size:10px;color:#2a2a2a;letter-spacing:0.04em;">Sent by ${agentEmail}</span>
  </div>

  <!-- Card -->
  <div style="background:#141414;border:1px solid #222;border-radius:12px;overflow:hidden;">
    <div style="height:2px;background:linear-gradient(90deg,${accentBorder} 0%,${accentBg} 50%,#111 100%);"></div>
    <div style="padding:36px 40px 32px;">

      <!-- Agent row -->
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:28px;">
        <div style="width:36px;height:36px;border-radius:50%;background:${accentBg};border:1px solid ${accentBorder};text-align:center;line-height:36px;font-size:14px;">&#10022;</div>
        <div>
          <div style="font-size:12px;color:${accentColor};font-weight:500;">${agentName}</div>
          <div style="font-size:10px;color:#2a3a2a;margin-top:1px;">${tagline}</div>
        </div>
      </div>

      <div style="height:1px;background:#1e1e1e;margin-bottom:28px;"></div>

      <!-- Invite content -->
      <div style="font-size:9px;font-weight:500;color:#2e2e2e;letter-spacing:0.14em;text-transform:uppercase;margin-bottom:10px;">Access invitation</div>
      <div style="font-size:22px;font-weight:400;color:#c8c4bc;line-height:1.3;letter-spacing:-0.02em;margin-bottom:14px;">
        You've been invited to<br/><strong style="font-weight:500;color:#d8d4cc;">${tenantName}</strong>
      </div>
      <div style="font-size:13px;color:#3a3a3a;line-height:1.7;margin-bottom:28px;">
        ${inviterName} has given you access to the ${tenantName} intelligence platform &mdash;
        a live view of operations, deal flow, and agent actions.
      </div>

      <!-- Access details -->
      <div style="background:#111;border:1px solid #1e1e1e;border-radius:8px;padding:16px 18px;margin-bottom:24px;">
        <div style="font-size:9px;color:#2a2a2a;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:12px;">Your access</div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #181818;">
          <span style="font-size:11px;color:#2e2e2e;">Workspace</span>
          <span style="font-size:11px;color:#666;font-family:'SF Mono','Fira Code',monospace;">${domain}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #181818;">
          <span style="font-size:11px;color:#2e2e2e;">Role</span>
          <span style="font-size:10px;color:${rc.color};background:${rc.bg};border:1px solid ${rc.border};padding:1px 8px;border-radius:4px;text-transform:capitalize;">${role}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #181818;">
          <span style="font-size:11px;color:#2e2e2e;">Access</span>
          <span style="font-size:11px;color:#666;">Dashboard, agents, reports</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;">
          <span style="font-size:11px;color:#2e2e2e;">Expires</span>
          <span style="font-size:11px;color:#666;">7 days</span>
        </div>
      </div>

      <!-- CTA -->
      <div style="margin-bottom:20px;">
        <a href="${inviteUrl}" style="display:block;width:100%;background:${accentBg};border:1px solid ${accentBorder};border-radius:7px;padding:13px 20px;text-align:center;font-size:13px;font-weight:500;color:${accentColor};text-decoration:none;letter-spacing:0.01em;box-sizing:border-box;">
          Accept invitation &amp; sign in &rarr;
        </a>
      </div>

      <!-- Link fallback -->
      <div style="background:#0e0e0e;border:1px solid #1a1a1a;border-radius:6px;padding:10px 14px;margin-bottom:28px;overflow:hidden;">
        <span style="font-size:9px;color:#2a2a2a;letter-spacing:0.06em;text-transform:uppercase;">Link: </span>
        <span style="font-size:10px;color:#333;font-family:'SF Mono','Fira Code',monospace;">${inviteUrl}</span>
      </div>

      <!-- Expiry -->
      <div style="font-size:10px;color:#2a2a2a;margin-bottom:28px;">
        &#128339; This link expires in 7 days. If it expires, ask ${inviterName.split(' ')[0]} to resend.
      </div>

      <div style="height:1px;background:#1a1a1a;margin-bottom:20px;"></div>

      <!-- Footer -->
      <div style="display:flex;justify-content:space-between;">
        <div style="font-size:10px;color:#1e1e1e;line-height:1.6;">${tenantName}<br/>Powered by Coppice</div>
        <div style="font-size:10px;color:#1e1e1e;text-align:right;">Not expecting this?<br/>Ignore this message.</div>
      </div>

    </div>
  </div>

  <div style="text-align:center;margin-top:20px;font-size:10px;color:#1e1e1e;letter-spacing:0.04em;">&copy; 2026 ${tenantName} &middot; ${domain}</div>

</div>
</body></html>`;
}

export default router;
