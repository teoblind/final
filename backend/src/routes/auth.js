/**
 * Authentication Routes
 *
 * Handles login, registration, token refresh, logout,
 * session management, and current-user info.
 */

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  hashPassword,
  verifyPassword,
  generateTokens,
  verifyRefreshToken,
  hashToken,
} from '../services/authService.js';
import {
  getUserByEmail,
  getUsersByEmail,
  getUserByEmailAndTenant,
  getUserById,
  createUser,
  updateUser,
  createSession,
  getSessionByRefreshHash,
  revokeSession,
  revokeUserSessions,
  getUserSessions,
  createTenant,
  getTenant,
  getTenantBySlug,
  insertAuditLog,
  getInvitationByToken,
  acceptInvitation,
} from '../cache/database.js';
import { authenticate, ROLE_PERMISSIONS } from '../middleware/auth.js';

const router = express.Router();

// ─── POST /login ────────────────────────────────────────────────────────────

router.post('/login', async (req, res) => {
  try {
    const { email, password, tenant_id } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    let user;

    if (tenant_id) {
      // Multi-tenant: find user by email + tenant
      user = getUserByEmailAndTenant(email, tenant_id);
    } else {
      // Check if user exists in multiple tenants
      const users = getUsersByEmail(email);
      if (users.length > 1) {
        // Return tenant picker — don't verify password yet
        const tenants = users.map(u => {
          const t = getTenant(u.tenant_id);
          return { id: u.tenant_id, slug: t?.slug, name: t?.name };
        });
        return res.json({ tenant_required: true, tenants });
      }
      user = users[0] || null;
    }

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (user.status !== 'active') {
      return res.status(403).json({ error: 'Account is not active' });
    }

    const passwordValid = await verifyPassword(password, user.password_hash);
    if (!passwordValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Generate token pair
    const tokens = generateTokens(user);

    // Create session with hashed refresh token
    const sessionId = uuidv4();
    const refreshTokenHash = hashToken(tokens.refreshToken);
    createSession({
      id: sessionId,
      userId: user.id,
      refreshTokenHash,
      device: req.headers['user-agent'] || null,
      ipAddress: req.ip,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });

    // Update last login timestamp
    updateUser(user.id, { lastLogin: new Date().toISOString() });

    // Audit log
    insertAuditLog({
      tenantId: user.tenant_id,
      userId: user.id,
      action: 'user.login',
      resourceType: 'user',
      resourceId: user.id,
      ipAddress: req.ip,
    });

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        tenantId: user.tenant_id,
        permissions: ROLE_PERMISSIONS[user.role] || {},
        mustChangePassword: !!user.must_change_password,
      },
      tokens: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /register ─────────────────────────────────────────────────────────

router.post('/register', async (req, res) => {
  try {
    const { name, email, password, companyName, invitationToken } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    // Check if user already exists
    const existingUser = getUserByEmail(email);
    if (existingUser) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    let tenantId;
    let userRole = 'owner';

    // Check for invitation token
    if (invitationToken) {
      const invitation = getInvitationByToken(invitationToken);
      if (!invitation) {
        return res.status(400).json({ error: 'Invalid or expired invitation token' });
      }

      if (new Date(invitation.expires_at) < new Date()) {
        return res.status(400).json({ error: 'Invitation has expired' });
      }

      tenantId = invitation.tenant_id;
      userRole = invitation.role;

      // Accept the invitation
      acceptInvitation(invitationToken);
    } else {
      // Create new tenant
      if (!companyName) {
        return res.status(400).json({ error: 'Company name is required for registration' });
      }

      tenantId = uuidv4();
      const slug = companyName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

      // Ensure slug uniqueness
      let finalSlug = slug;
      let counter = 1;
      while (getTenantBySlug(finalSlug)) {
        finalSlug = `${slug}-${counter}`;
        counter++;
      }

      createTenant({
        id: tenantId,
        name: companyName,
        slug: finalSlug,
        plan: 'trial',
        status: 'trial',
      });
    }

    // Hash password and create user
    const passwordHash = await hashPassword(password);
    const userId = uuidv4();

    createUser({
      id: userId,
      email,
      name,
      passwordHash,
      tenantId,
      role: userRole,
      status: 'active',
    });

    // Build user object for token generation
    const user = { id: userId, email, tenant_id: tenantId, role: userRole };
    const tokens = generateTokens(user);

    // Create session
    const sessionId = uuidv4();
    const refreshTokenHash = hashToken(tokens.refreshToken);
    createSession({
      id: sessionId,
      userId,
      refreshTokenHash,
      device: req.headers['user-agent'] || null,
      ipAddress: req.ip,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });

    // Audit log
    insertAuditLog({
      tenantId,
      userId,
      action: 'user.register',
      resourceType: 'user',
      resourceId: userId,
      details: { invitationUsed: !!invitationToken },
      ipAddress: req.ip,
    });

    res.status(201).json({
      user: {
        id: userId,
        email,
        name,
        role: userRole,
        tenantId,
        permissions: ROLE_PERMISSIONS[userRole] || {},
      },
      tokens: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
      },
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /refresh ──────────────────────────────────────────────────────────

router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token is required' });
    }

    // Verify the refresh token JWT
    let decoded;
    try {
      decoded = verifyRefreshToken(refreshToken);
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    // Look up the session by hashed refresh token
    const tokenHash = hashToken(refreshToken);
    const session = getSessionByRefreshHash(tokenHash);

    if (!session) {
      return res.status(401).json({ error: 'Session not found or already revoked' });
    }

    if (new Date(session.expires_at) < new Date()) {
      revokeSession(session.id);
      return res.status(401).json({ error: 'Session expired' });
    }

    // Look up user
    const user = getUserById(decoded.userId);
    if (!user || user.status !== 'active') {
      return res.status(401).json({ error: 'User not found or inactive' });
    }

    // Revoke old session
    revokeSession(session.id);

    // Generate new tokens
    const newTokens = generateTokens(user);

    // Create new session
    const newSessionId = uuidv4();
    const newRefreshTokenHash = hashToken(newTokens.refreshToken);
    createSession({
      id: newSessionId,
      userId: user.id,
      refreshTokenHash: newRefreshTokenHash,
      device: req.headers['user-agent'] || null,
      ipAddress: req.ip,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });

    res.json({
      tokens: {
        accessToken: newTokens.accessToken,
        refreshToken: newTokens.refreshToken,
        expiresAt: newTokens.expiresAt,
      },
    });
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /logout ───────────────────────────────────────────────────────────

router.post('/logout', authenticate, (req, res) => {
  try {
    // Revoke all sessions for the current user
    revokeUserSessions(req.user.id);

    insertAuditLog({
      tenantId: req.user.tenantId,
      userId: req.user.id,
      action: 'user.logout',
      resourceType: 'user',
      resourceId: req.user.id,
      ipAddress: req.ip,
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /me ────────────────────────────────────────────────────────────────

router.get('/me', authenticate, (req, res) => {
  try {
    const user = getUserById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { password_hash, mfa_secret, ...safeUser } = user;
    safeUser.permissions = ROLE_PERMISSIONS[user.role] || {};
    safeUser.mustChangePassword = !!user.must_change_password;

    res.json({ user: safeUser });
  } catch (error) {
    console.error('Get current user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /sessions ──────────────────────────────────────────────────────────

router.get('/sessions', authenticate, (req, res) => {
  try {
    const sessions = getUserSessions(req.user.id);
    res.json({ sessions });
  } catch (error) {
    console.error('Get sessions error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /sessions/:id ───────────────────────────────────────────────────

router.delete('/sessions/:id', authenticate, (req, res) => {
  try {
    const { id } = req.params;
    revokeSession(id);

    insertAuditLog({
      tenantId: req.user.tenantId,
      userId: req.user.id,
      action: 'session.revoke',
      resourceType: 'session',
      resourceId: id,
      ipAddress: req.ip,
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Revoke session error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /change-password ───────────────────────────────────────────────────

router.post('/change-password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new passwords are required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }

    const user = getUserById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const passwordValid = await verifyPassword(currentPassword, user.password_hash);
    if (!passwordValid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const newHash = await hashPassword(newPassword);
    updateUser(user.id, { passwordHash: newHash, mustChangePassword: false });

    insertAuditLog({
      tenantId: user.tenant_id,
      userId: user.id,
      action: 'user.changePassword',
      resourceType: 'user',
      resourceId: user.id,
      ipAddress: req.ip,
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
