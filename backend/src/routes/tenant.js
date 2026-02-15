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
} from '../cache/database.js';
import { generateApiKey } from '../services/authService.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// ─── GET / — Get Current Tenant Info ────────────────────────────────────────

router.get('/', (req, res) => {
  try {
    const tenant = getTenant(req.user.tenantId);
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }
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

router.post('/users/invite', requirePermission('manageUsers'), (req, res) => {
  try {
    const { email, role } = req.body;

    if (!email || !role) {
      return res.status(400).json({ error: 'Email and role are required' });
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

export default router;
