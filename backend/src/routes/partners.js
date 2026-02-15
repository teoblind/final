/**
 * Partner Access Routes
 *
 * Manages partner access grants, allowing tenants to share
 * data with IPP partners, auditors, and insurance providers.
 * All routes require authentication.
 */

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authenticate, requirePermission } from '../middleware/auth.js';
import {
  getPartnerAccess,
  createPartnerAccess,
  updatePartnerAccess,
  getUserByEmail,
  insertAuditLog,
} from '../cache/database.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// ─── GET / — List Partner Access Grants ─────────────────────────────────────

router.get('/', (req, res) => {
  try {
    const grants = getPartnerAccess(req.user.tenantId);
    res.json({ partners: grants });
  } catch (error) {
    console.error('List partner access error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST / — Grant Partner Access ──────────────────────────────────────────

router.post('/', requirePermission('managePartnerAccess'), (req, res) => {
  try {
    const { partnerEmail, accessType, permissions } = req.body;

    if (!partnerEmail || !accessType) {
      return res.status(400).json({ error: 'partnerEmail and accessType are required' });
    }

    const validAccessTypes = ['ipp', 'auditor', 'insurance'];
    if (!validAccessTypes.includes(accessType)) {
      return res.status(400).json({ error: `accessType must be one of: ${validAccessTypes.join(', ')}` });
    }

    // Look up partner tenant by finding the user by email
    const partnerUser = getUserByEmail(partnerEmail);
    if (!partnerUser) {
      return res.status(404).json({ error: 'No user found with that email' });
    }

    if (partnerUser.tenant_id === req.user.tenantId) {
      return res.status(400).json({ error: 'Cannot grant partner access to your own tenant' });
    }

    const grantId = uuidv4();
    createPartnerAccess({
      id: grantId,
      tenantId: req.user.tenantId,
      partnerTenantId: partnerUser.tenant_id,
      grantedBy: req.user.id,
      accessType,
      permissions: permissions || {},
      expiresAt: null,
    });

    insertAuditLog({
      tenantId: req.user.tenantId,
      userId: req.user.id,
      action: 'partner.grant',
      resourceType: 'partner_access',
      resourceId: grantId,
      details: { partnerEmail, accessType, partnerTenantId: partnerUser.tenant_id },
      ipAddress: req.ip,
    });

    res.status(201).json({
      partnerAccess: {
        id: grantId,
        partnerTenantId: partnerUser.tenant_id,
        accessType,
        permissions: permissions || {},
        status: 'active',
      },
    });
  } catch (error) {
    console.error('Grant partner access error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /:id — Update Partner Permissions ──────────────────────────────────

router.put('/:id', requirePermission('managePartnerAccess'), (req, res) => {
  try {
    const { id } = req.params;
    const { permissions, expiresAt } = req.body;

    const updates = {};
    if (permissions !== undefined) updates.permissions = permissions;
    if (expiresAt !== undefined) updates.expiresAt = expiresAt;

    updatePartnerAccess(id, updates);

    insertAuditLog({
      tenantId: req.user.tenantId,
      userId: req.user.id,
      action: 'partner.update',
      resourceType: 'partner_access',
      resourceId: id,
      details: { fields: Object.keys(updates) },
      ipAddress: req.ip,
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Update partner access error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /:id — Revoke Partner Access ────────────────────────────────────

router.delete('/:id', requirePermission('managePartnerAccess'), (req, res) => {
  try {
    const { id } = req.params;

    updatePartnerAccess(id, { status: 'revoked' });

    insertAuditLog({
      tenantId: req.user.tenantId,
      userId: req.user.id,
      action: 'partner.revoke',
      resourceType: 'partner_access',
      resourceId: id,
      ipAddress: req.ip,
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Revoke partner access error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
