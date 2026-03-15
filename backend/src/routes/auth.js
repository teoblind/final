/**
 * Authentication Routes
 *
 * Handles login, registration, token refresh, logout,
 * session management, and current-user info.
 */

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { google } from 'googleapis';
import {
  hashPassword,
  verifyPassword,
  generateTokens,
  verifyAccessToken,
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
  createPasswordReset,
  getPasswordResetByHash,
  markPasswordResetUsed,
  upsertKeyVaultEntry,
  getKeyVaultEntries,
} from '../cache/database.js';
import { authenticate, ROLE_PERMISSIONS } from '../middleware/auth.js';
import { getSubdomainForSlug } from '../middleware/tenantResolver.js';
import { sendHtmlEmail } from '../services/emailService.js';

// ─── Google OAuth Config ─────────────────────────────────────────────────────
const GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_OAUTH_REDIRECT_URI || '/api/v1/auth/google/callback';

function getGoogleOAuth2Client(req) {
  // Build absolute redirect URI from request if relative
  let redirectUri = GOOGLE_REDIRECT_URI;
  if (redirectUri.startsWith('/')) {
    // Always use https in production (Nginx terminates SSL)
    const proto = process.env.NODE_ENV === 'production' ? 'https' : (req.headers['x-forwarded-proto'] || req.protocol);
    const host = req.headers['x-forwarded-host'] || req.get('host');
    redirectUri = `${proto}://${host}${redirectUri}`;
  }
  return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, redirectUri);
}

const router = express.Router();

// ─── Per-IP Rate Limiter for Auth Endpoints ─────────────────────────────────
// Prevents brute-force password guessing and credential stuffing.
const authRateLimitStore = new Map();

function authRateLimiter(maxAttempts, windowMs = 60_000) {
  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    let entry = authRateLimitStore.get(ip);

    if (!entry || now - entry.windowStart >= windowMs) {
      entry = { count: 0, windowStart: now };
      authRateLimitStore.set(ip, entry);
    }

    entry.count++;

    if (entry.count > maxAttempts) {
      const retryAfter = Math.ceil((entry.windowStart + windowMs - now) / 1000);
      res.setHeader('Retry-After', retryAfter);
      return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
    }

    return next();
  };
}

// Clean up expired entries every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - 300_000;
  for (const [ip, entry] of authRateLimitStore) {
    if (entry.windowStart < cutoff) authRateLimitStore.delete(ip);
  }
}, 300_000);

// ─── POST /login ────────────────────────────────────────────────────────────

router.post('/login', authRateLimiter(10), async (req, res) => {
  try {
    const { email, password, tenant_id } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    let user;

    // Resolve tenant: explicit tenant_id > hostname-resolved tenant > multi-tenant picker
    const resolvedTenantId = tenant_id || req.resolvedTenant?.id;

    if (resolvedTenantId) {
      // Single tenant context (subdomain or explicit selection)
      user = getUserByEmailAndTenant(email, resolvedTenantId);
    } else {
      // No tenant context — check if user exists in multiple tenants
      const users = getUsersByEmail(email);
      if (users.length > 1) {
        // Return tenant picker — don't verify password yet
        const tenants = users.map(u => {
          const t = getTenant(u.tenant_id);
          const isAdmin = u.role && (u.role.includes('admin') || u.role === 'owner' || u.role === 'super_admin');
          const displayName = (isAdmin && u.tenant_id === 'default') ? 'Platform Admin' : t?.name;
          return { id: u.tenant_id, slug: t?.slug, name: displayName, role: u.role };
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

    // OAuth-only users have no password hash
    if (!user.password_hash) {
      return res.status(401).json({ error: 'This account uses Google sign-in. Please use the Google login button.' });
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

    // Include tenant slug for subdomain redirect
    const tenantRow = getTenant(user.tenant_id);
    const tenantSlug = tenantRow?.slug || user.tenant_id;
    const subdomain = getSubdomainForSlug(tenantSlug);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        tenantId: user.tenant_id,
        tenantSlug: subdomain,
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

router.post('/register', authRateLimiter(5), async (req, res) => {
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
    safeUser.mustSetPassword = !password_hash;

    res.json({ user: safeUser });
  } catch (error) {
    console.error('Get current user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /my-tenants ─────────────────────────────────────────────────────────

router.get('/my-tenants', authenticate, (req, res) => {
  try {
    const user = getUserById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Find all tenant memberships for this email
    const users = getUsersByEmail(user.email);
    const tenants = users.map(u => {
      const t = getTenant(u.tenant_id);
      const isAdmin = u.role && (u.role.includes('admin') || u.role === 'owner' || u.role === 'super_admin');
      const displayName = (isAdmin && u.tenant_id === 'default') ? 'Platform Admin' : t?.name;
      return {
        id: u.tenant_id,
        slug: t?.slug,
        name: displayName,
        subdomain: getSubdomainForSlug(t?.slug || u.tenant_id),
        role: u.role,
        status: u.status,
      };
    }).filter(t => t.status === 'active');

    res.json({ tenants });
  } catch (error) {
    console.error('Get my tenants error:', error);
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

// ─── POST /set-password ─────────────────────────────────────────────────────

router.post('/set-password', authenticate, async (req, res) => {
  try {
    const { newPassword } = req.body;

    if (!newPassword) {
      return res.status(400).json({ error: 'New password is required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const user = getUserById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Only allow if user has no password set (OAuth-only users)
    if (user.password_hash) {
      return res.status(400).json({ error: 'Password already set. Use change-password instead.' });
    }

    const newHash = await hashPassword(newPassword);
    updateUser(user.id, { passwordHash: newHash, mustChangePassword: false });

    insertAuditLog({
      tenantId: user.tenant_id,
      userId: user.id,
      action: 'user.setPassword',
      resourceType: 'user',
      resourceId: user.id,
      ipAddress: req.ip,
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Set password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /forgot-password ───────────────────────────────────────────────────

router.post('/forgot-password', authRateLimiter(5), async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Always return success to avoid email enumeration
    const successResponse = { success: true, message: 'If that email exists, a reset link has been sent.' };

    const user = getUserByEmail(email);
    if (!user) {
      return res.json(successResponse);
    }

    // Generate reset token (raw + hashed)
    const crypto = await import('crypto');
    const resetToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
    const resetId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

    createPasswordReset({ id: resetId, userId: user.id, tokenHash, expiresAt });

    // Build reset URL from request origin
    const proto = process.env.NODE_ENV === 'production' ? 'https' : (req.headers['x-forwarded-proto'] || req.protocol);
    const host = req.headers['x-forwarded-host'] || req.get('host');
    const origin = req.headers.origin || `${proto}://${host}`;
    const resetUrl = `${origin}/login?reset_token=${resetToken}&email=${encodeURIComponent(email)}`;

    // Send reset email
    try {
      await sendHtmlEmail({
        to: email,
        subject: 'Reset your Coppice password',
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
            <h2 style="color: #1a1a1a; margin-bottom: 8px;">Password Reset</h2>
            <p style="color: #666; font-size: 14px; line-height: 1.5;">
              Hi ${user.name},<br><br>
              Someone requested a password reset for your Coppice account. Click the button below to set a new password. This link expires in 1 hour.
            </p>
            <a href="${resetUrl}" style="display: inline-block; margin: 24px 0; padding: 12px 32px; background: #1a6b3c; color: #fff; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: 600;">
              Reset Password
            </a>
            <p style="color: #999; font-size: 12px; line-height: 1.5;">
              If you didn't request this, you can safely ignore this email.<br>
              Link: <a href="${resetUrl}" style="color: #999;">${resetUrl}</a>
            </p>
          </div>
        `,
        tenantId: user.tenant_id,
      });
    } catch (emailErr) {
      console.error('Failed to send password reset email:', emailErr.message);
      // Still return success — don't leak whether email sending works
    }

    insertAuditLog({
      tenantId: user.tenant_id,
      userId: user.id,
      action: 'user.forgotPassword',
      resourceType: 'user',
      resourceId: user.id,
      ipAddress: req.ip,
    });

    res.json(successResponse);
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /reset-password ───────────────────────────────────────────────────

router.post('/reset-password', authRateLimiter(5), async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ error: 'Token and new password are required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const crypto = await import('crypto');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const resetRecord = getPasswordResetByHash(tokenHash);

    if (!resetRecord) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    const user = getUserById(resetRecord.user_id);
    if (!user) {
      return res.status(400).json({ error: 'User not found' });
    }

    // Update password
    const newHash = await hashPassword(newPassword);
    updateUser(user.id, { passwordHash: newHash, mustChangePassword: false });

    // Mark token as used
    markPasswordResetUsed(resetRecord.id);

    // Revoke all existing sessions (force re-login)
    revokeUserSessions(user.id);

    insertAuditLog({
      tenantId: user.tenant_id,
      userId: user.id,
      action: 'user.resetPassword',
      resourceType: 'user',
      resourceId: user.id,
      ipAddress: req.ip,
    });

    res.json({ success: true, message: 'Password has been reset. Please log in.' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /google — Start Google OAuth flow ──────────────────────────────────

router.get('/google', (req, res) => {
  if (!GOOGLE_CLIENT_ID) {
    return res.status(501).json({ error: 'Google OAuth not configured' });
  }

  const oauth2Client = getGoogleOAuth2Client(req);
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'select_account',
    scope: [
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ],
  });

  res.redirect(authUrl);
});

// ─── GET /google/callback — Handle Google OAuth callback ─────────────────────

router.get('/google/callback', async (req, res) => {
  try {
    const { code, error: oauthError } = req.query;

    if (oauthError || !code) {
      return res.redirect('/?error=oauth_cancelled');
    }

    const oauth2Client = getGoogleOAuth2Client(req);
    const { tokens: googleTokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(googleTokens);

    // Get user info from Google
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: profile } = await oauth2.userinfo.get();

    if (!profile.email) {
      return res.redirect('/?error=no_email');
    }

    // Resolve tenant from hostname
    const tenantId = req.resolvedTenant?.id || 'default';

    // Find or create user
    let user = getUserByEmailAndTenant(profile.email, tenantId);

    if (!user) {
      // Check if user exists in any tenant
      const existingUsers = getUsersByEmail(profile.email);

      if (existingUsers.length > 0) {
        // User exists in another tenant — use the first one
        user = existingUsers[0];
      } else {
        // Create new user
        const userId = uuidv4();
        createUser({
          id: userId,
          email: profile.email,
          name: profile.name || profile.email.split('@')[0],
          passwordHash: null,  // OAuth users don't have passwords
          tenantId,
          role: 'member',
          status: 'active',
        });
        user = getUserById(userId);

        insertAuditLog({
          tenantId,
          userId,
          action: 'user.register.google',
          resourceType: 'user',
          resourceId: userId,
          details: { provider: 'google', googleId: profile.id },
          ipAddress: req.ip,
        });
      }
    }

    if (user.status !== 'active') {
      return res.redirect('/?error=account_inactive');
    }

    // Generate JWT tokens
    const jwtTokens = generateTokens(user);

    // Create session
    const sessionId = uuidv4();
    const refreshTokenHash = hashToken(jwtTokens.refreshToken);
    createSession({
      id: sessionId,
      userId: user.id,
      refreshTokenHash,
      device: req.headers['user-agent'] || null,
      ipAddress: req.ip,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });

    updateUser(user.id, { lastLogin: new Date().toISOString() });

    insertAuditLog({
      tenantId: user.tenant_id,
      userId: user.id,
      action: 'user.login.google',
      resourceType: 'user',
      resourceId: user.id,
      ipAddress: req.ip,
    });

    // Redirect to the correct tenant subdomain with tokens
    const params = new URLSearchParams({
      access_token: jwtTokens.accessToken,
      refresh_token: jwtTokens.refreshToken,
      expires_at: jwtTokens.expiresAt,
    });

    // Compute canonical subdomain for the user's tenant
    const tenantRow = getTenant(user.tenant_id);
    const tenantSlug = tenantRow?.slug || user.tenant_id;
    const correctSubdomain = getSubdomainForSlug(tenantSlug);
    const baseDomain = process.env.APP_BASE_DOMAIN || 'coppice.ai';
    const proto = process.env.NODE_ENV === 'production' ? 'https' : (req.headers['x-forwarded-proto'] || req.protocol);

    res.redirect(`${proto}://${correctSubdomain}.${baseDomain}/?oauth=success&${params.toString()}`);
  } catch (error) {
    console.error('Google OAuth callback error:', error);
    res.redirect('/?error=oauth_failed');
  }
});

// ─── Google Integration OAuth Config ────────────────────────────────────────
// Reuse the same "Coppice Web" OAuth client for integrations
const INTEGRATE_REDIRECT_URI = '/api/v1/auth/google/integrate/callback';

function getIntegrationOAuth2Client(req) {
  let redirectUri = INTEGRATE_REDIRECT_URI;
  if (redirectUri.startsWith('/')) {
    const proto = process.env.NODE_ENV === 'production' ? 'https' : (req.headers['x-forwarded-proto'] || req.protocol);
    const host = req.headers['x-forwarded-host'] || req.get('host');
    redirectUri = `${proto}://${host}${redirectUri}`;
  }
  return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, redirectUri);
}

// ─── GET /google/integrate — Start integration OAuth flow ────────────────────

router.get('/google/integrate', (req, res) => {
  try {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      return res.status(501).json({ error: 'Google integration OAuth not configured' });
    }

    const { scopes, source, token } = req.query;

    if (!token) {
      return res.status(401).json({ error: 'Authentication token is required' });
    }

    if (!scopes || !source) {
      return res.status(400).json({ error: 'scopes and source query parameters are required' });
    }

    // Verify JWT from query param (popup flow — no Authorization header)
    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const tenantId = decoded.tenantId;
    const userId = decoded.userId;

    // Build state payload
    const state = Buffer.from(JSON.stringify({ tenantId, userId, source })).toString('base64url');

    // Build full scope URLs
    const scopeList = scopes.split(',').map(s => `https://www.googleapis.com/auth/${s.trim()}`);

    const oauth2Client = getIntegrationOAuth2Client(req);
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: true,
      scope: scopeList,
      state,
    });

    res.redirect(authUrl);
  } catch (error) {
    console.error('Google integrate start error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /google/integrate/callback — Handle integration OAuth callback ──────

router.get('/google/integrate/callback', async (req, res) => {
  try {
    const { code, state, error: oauthError } = req.query;

    if (oauthError || !code || !state) {
      return res.status(400).send(renderIntegrationErrorPage(
        'OAuth flow was cancelled or failed.',
        oauthError || 'missing_code_or_state'
      ));
    }

    // Decode state
    let stateData;
    try {
      stateData = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
    } catch (err) {
      return res.status(400).send(renderIntegrationErrorPage(
        'Invalid state parameter.',
        'invalid_state'
      ));
    }

    const { tenantId, userId, source } = stateData;

    if (!tenantId || !userId || !source) {
      return res.status(400).send(renderIntegrationErrorPage(
        'Missing required state fields.',
        'incomplete_state'
      ));
    }

    // Exchange code for tokens
    const oauth2Client = getIntegrationOAuth2Client(req);
    const { tokens } = await oauth2Client.getToken(code);

    // Store refresh_token in key_vault
    if (tokens.refresh_token) {
      upsertKeyVaultEntry({
        tenantId,
        service: source,
        keyName: 'refresh_token',
        keyValue: tokens.refresh_token,
        addedBy: userId,
      });
    }

    // Store access_token with expiry if available
    if (tokens.access_token) {
      upsertKeyVaultEntry({
        tenantId,
        service: source,
        keyName: 'access_token',
        keyValue: tokens.access_token,
        addedBy: userId,
        expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
      });
    }

    // Audit log
    insertAuditLog({
      tenantId,
      userId,
      action: 'integration.connected',
      resourceType: 'integration',
      resourceId: source,
      details: { source, hasRefreshToken: !!tokens.refresh_token },
      ipAddress: req.ip,
    });

    // Send success message to opener and close popup
    res.send(`<!DOCTYPE html>
<html>
<head><title>Integration Connected</title></head>
<body>
  <p style="font-family: -apple-system, sans-serif; text-align: center; margin-top: 40px; color: #1a6b3c;">
    Integration connected successfully. This window will close automatically.
  </p>
  <script>
    if (window.opener) {
      window.opener.postMessage({ type: 'oauth-integration-success', source: ${JSON.stringify(source)} }, '*');
    }
    window.close();
  </script>
</body>
</html>`);
  } catch (error) {
    console.error('Google integrate callback error:', error);
    res.status(500).send(renderIntegrationErrorPage(
      'Something went wrong connecting your account. Please try again.',
      error.message
    ));
  }
});

function renderIntegrationErrorPage(message, detail) {
  return `<!DOCTYPE html>
<html>
<head><title>Integration Error</title></head>
<body>
  <div style="font-family: -apple-system, sans-serif; text-align: center; margin-top: 40px; max-width: 480px; margin-left: auto; margin-right: auto;">
    <h2 style="color: #c0392b;">Connection Failed</h2>
    <p style="color: #333;">${message}</p>
    <p style="color: #999; font-size: 12px;">Error: ${detail}</p>
    <button onclick="window.close()" style="margin-top: 16px; padding: 8px 24px; background: #333; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 14px;">
      Close Window
    </button>
  </div>
</body>
</html>`;
}

// ─── GET /google/integrations — Check connected integrations ─────────────────

router.get('/google/integrations', authenticate, (req, res) => {
  try {
    const entries = getKeyVaultEntries(req.user.tenantId);
    const connected = entries
      .filter(e => e.service.startsWith('google-') && e.key_name === 'refresh_token')
      .map(e => e.service);

    res.json({ connected });
  } catch (error) {
    console.error('Get integrations error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
