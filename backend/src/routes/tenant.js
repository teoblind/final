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
} from '../cache/database.js';
import { generateApiKey } from '../services/authService.js';
import { sendHtmlEmail } from '../services/emailService.js';

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
    const proto = process.env.NODE_ENV === 'production' ? 'https' : (req.headers['x-forwarded-proto'] || req.protocol);
    const host = req.headers['x-forwarded-host'] || req.get('host');
    const origin = req.headers.origin || `${proto}://${host}`;
    const inviteUrl = `${origin}/login?invite=${token}&email=${encodeURIComponent(email)}`;
    const inviterName = req.user.name || 'Your team';
    const tenantName = tenant.name || 'Coppice';

    try {
      await sendHtmlEmail({
        to: email,
        subject: `${inviterName} invited you to ${tenantName} on Coppice`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
            <h2 style="color: #1a1a1a; margin-bottom: 8px;">You're invited</h2>
            <p style="color: #666; font-size: 14px; line-height: 1.5;">
              ${inviterName} has invited you to join <strong>${tenantName}</strong> on Coppice as a <strong>${role}</strong>.
            </p>
            <a href="${inviteUrl}" style="display: inline-block; margin: 24px 0; padding: 12px 32px; background: #1a6b3c; color: #fff; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: 600;">
              Accept Invitation
            </a>
            <p style="color: #999; font-size: 12px; line-height: 1.5;">
              This invitation expires in 7 days.<br>
              Link: <a href="${inviteUrl}" style="color: #999;">${inviteUrl}</a>
            </p>
          </div>
        `,
        tenantId: req.user.tenantId,
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

export default router;
