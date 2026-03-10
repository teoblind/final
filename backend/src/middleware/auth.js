/**
 * Authentication & Authorization Middleware
 *
 * Provides JWT and API key authentication, role-based access control,
 * permission checks, tenant enforcement, and rate limiting.
 */

import { verifyAccessToken, hashToken, verifyApiKey } from '../services/authService.js';
import {
  getUserById,
  getTenant,
  getApiKeyByPrefix,
  updateApiKeyLastUsed,
  insertAuditLog,
} from '../cache/database.js';

// ─── Role Permissions Map ───────────────────────────────────────────────────

export const ROLE_PERMISSIONS = {
  owner: {
    viewOperations: true,
    viewMacroIntelligence: true,
    viewAlerts: true,
    viewNotes: true,
    viewSettings: true,
    viewEnergyData: true,
    viewFleetData: true,
    viewPoolData: true,
    viewFinancialData: true,
    viewHPCContracts: true,
    viewAgents: true,
    configureAgents: true,
    approveAgentActions: true,
    manageUsers: true,
    manageSettings: true,
    manageBilling: true,
    managePartnerAccess: true,
    viewAuditLog: true,
    createApiKeys: true,
    exportData: true,
  },
  admin: {
    viewOperations: true,
    viewMacroIntelligence: true,
    viewAlerts: true,
    viewNotes: true,
    viewSettings: true,
    viewEnergyData: true,
    viewFleetData: true,
    viewPoolData: true,
    viewFinancialData: true,
    viewHPCContracts: true,
    viewAgents: true,
    configureAgents: true,
    approveAgentActions: true,
    manageUsers: true,
    manageSettings: true,
    manageBilling: false,
    managePartnerAccess: true,
    viewAuditLog: true,
    createApiKeys: true,
    exportData: true,
  },
  member: {
    viewOperations: true,
    viewMacroIntelligence: true,
    viewAlerts: true,
    viewNotes: true,
    viewSettings: false,
    viewEnergyData: true,
    viewFleetData: true,
    viewPoolData: true,
    viewFinancialData: true,
    viewHPCContracts: true,
    viewAgents: true,
    configureAgents: false,
    approveAgentActions: false,
    manageUsers: false,
    manageSettings: false,
    manageBilling: false,
    managePartnerAccess: false,
    viewAuditLog: false,
    createApiKeys: false,
    exportData: true,
  },
  operator: {
    viewOperations: true,
    viewMacroIntelligence: true,
    viewAlerts: true,
    viewNotes: true,
    viewSettings: false,
    viewEnergyData: true,
    viewFleetData: true,
    viewPoolData: true,
    viewFinancialData: false,
    viewHPCContracts: true,
    viewAgents: true,
    configureAgents: true,
    approveAgentActions: false,
    manageUsers: false,
    manageSettings: false,
    manageBilling: false,
    managePartnerAccess: false,
    viewAuditLog: false,
    createApiKeys: false,
    exportData: true,
  },
  viewer: {
    viewOperations: true,
    viewMacroIntelligence: true,
    viewAlerts: true,
    viewNotes: true,
    viewSettings: false,
    viewEnergyData: true,
    viewFleetData: true,
    viewPoolData: true,
    viewFinancialData: false,
    viewHPCContracts: false,
    viewAgents: true,
    configureAgents: false,
    approveAgentActions: false,
    manageUsers: false,
    manageSettings: false,
    manageBilling: false,
    managePartnerAccess: false,
    viewAuditLog: false,
    createApiKeys: false,
    exportData: false,
  },
  ipp_partner: {
    viewOperations: true,
    viewMacroIntelligence: false,
    viewAlerts: true,
    viewNotes: false,
    viewSettings: false,
    viewEnergyData: true,
    viewFleetData: false,
    viewPoolData: false,
    viewFinancialData: false,
    viewHPCContracts: false,
    viewAgents: false,
    configureAgents: false,
    approveAgentActions: false,
    manageUsers: false,
    manageSettings: false,
    manageBilling: false,
    managePartnerAccess: false,
    viewAuditLog: false,
    createApiKeys: false,
    exportData: false,
  },
  sangha_admin: {
    viewOperations: true,
    viewMacroIntelligence: false,
    viewAlerts: false,
    viewNotes: false,
    viewSettings: false,
    viewEnergyData: true,
    viewFleetData: false,
    viewPoolData: false,
    viewFinancialData: false,
    viewHPCContracts: false,
    viewAgents: false,
    configureAgents: false,
    approveAgentActions: false,
    manageUsers: false,
    manageSettings: false,
    manageBilling: false,
    managePartnerAccess: false,
    viewAuditLog: false,
    createApiKeys: false,
    exportData: false,
  },
  sangha_underwriter: {
    viewOperations: true,
    viewMacroIntelligence: false,
    viewAlerts: false,
    viewNotes: false,
    viewSettings: false,
    viewEnergyData: true,
    viewFleetData: false,
    viewPoolData: false,
    viewFinancialData: false,
    viewHPCContracts: false,
    viewAgents: false,
    configureAgents: false,
    approveAgentActions: false,
    manageUsers: false,
    manageSettings: false,
    manageBilling: false,
    managePartnerAccess: false,
    viewAuditLog: false,
    createApiKeys: false,
    exportData: false,
  },
  balance_sheet_partner: {
    viewOperations: false,
    viewMacroIntelligence: false,
    viewAlerts: false,
    viewNotes: false,
    viewSettings: false,
    viewEnergyData: false,
    viewFleetData: false,
    viewPoolData: false,
    viewFinancialData: false,
    viewHPCContracts: false,
    viewAgents: false,
    configureAgents: false,
    approveAgentActions: false,
    manageUsers: false,
    manageSettings: false,
    manageBilling: false,
    managePartnerAccess: false,
    viewAuditLog: false,
    createApiKeys: false,
    exportData: true,
    // LP-specific permissions
    viewLPPortfolio: true,
    reviewLPAllocations: true,
    approveLPAllocations: true,
    viewLPClaims: true,
    viewLPSettlements: true,
    viewLPStressTest: true,
  },
};

// ─── Authentication Middleware ──────────────────────────────────────────────

/**
 * Authenticate requests via JWT Bearer token or API key.
 * Sets req.user and req.tenantId on success.
 * Returns 401 on failure.
 */
export async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // ── JWT Bearer Token ──────────────────────────────────────────────
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const decoded = verifyAccessToken(token);

      const user = getUserById(decoded.userId);
      if (!user || user.status !== 'active') {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const tenant = getTenant(user.tenant_id);
      if (!tenant) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const permissions = ROLE_PERMISSIONS[user.role] || {};

      req.user = {
        id: user.id,
        email: user.email,
        name: user.name,
        tenantId: user.tenant_id,
        role: user.role,
        permissions,
      };
      req.tenantId = user.tenant_id;

      return next();
    }

    // ── API Key ───────────────────────────────────────────────────────
    if (authHeader.startsWith('ApiKey ')) {
      const key = authHeader.slice(7);
      const prefix = key.substring(0, 12);

      const matchingKeys = getApiKeyByPrefix(prefix);
      if (!matchingKeys || matchingKeys.length === 0) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      let validKey = null;
      for (const candidate of matchingKeys) {
        try {
          if (verifyApiKey(key, candidate.key_hash)) {
            validKey = candidate;
            break;
          }
        } catch {
          // Hash comparison failed, try next key
          continue;
        }
      }

      if (!validKey) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Check expiration
      if (validKey.expires_at && new Date(validKey.expires_at) < new Date()) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Update last_used timestamp
      updateApiKeyLastUsed(validKey.id);

      const user = getUserById(validKey.user_id);
      if (!user || user.status !== 'active') {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const permissions = ROLE_PERMISSIONS[user.role] || {};

      req.user = {
        id: user.id,
        email: user.email,
        name: user.name,
        tenantId: user.tenant_id,
        role: user.role,
        permissions,
      };
      req.tenantId = user.tenant_id;

      return next();
    }

    // Unrecognised auth scheme
    return res.status(401).json({ error: 'Unauthorized' });
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

// ─── Optional Authentication ────────────────────────────────────────────────

/**
 * Same as authenticate but does not reject unauthenticated requests.
 * Sets req.user = null when no auth header is present.
 */
export async function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    req.user = null;
    return next();
  }

  // Delegate to authenticate; if it would return 401, swallow the error
  // and proceed with req.user = null.
  return authenticate(req, res, next);
}

// ─── Role Guard ─────────────────────────────────────────────────────────────

/**
 * Returns middleware that checks the authenticated user has one of the
 * specified roles.
 * @param  {...string} roles - Allowed roles
 * @returns {Function} Express middleware
 */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    return next();
  };
}

// ─── Permission Guard ───────────────────────────────────────────────────────

/**
 * Returns middleware that checks the authenticated user has a specific
 * permission set to true.
 * @param {string} permission - Permission key to check
 * @returns {Function} Express middleware
 */
export function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user || !req.user.permissions || req.user.permissions[permission] !== true) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    return next();
  };
}

// ─── Tenant Guard ───────────────────────────────────────────────────────────

/**
 * Middleware that ensures req.tenantId is set.
 * Returns 401 if no tenant context is available.
 */
export function requireTenant(req, res, next) {
  if (!req.tenantId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
}

// ─── Rate Limiter ───────────────────────────────────────────────────────────

const DEFAULT_RATE_LIMIT = 60; // requests per minute

// In-memory store: Map<tenantId, { count, windowStart }>
const rateLimitStore = new Map();

/**
 * Simple in-memory rate limiter.
 * Tracks request counts per tenant within one-minute sliding windows.
 * Uses tenant-specific limits when available, otherwise defaults to 60/min.
 * Returns 429 when the limit is exceeded.
 */
export function rateLimiter(req, res, next) {
  const tenantId = req.tenantId || 'anonymous';
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute

  let entry = rateLimitStore.get(tenantId);

  // Reset window if expired or first request
  if (!entry || now - entry.windowStart >= windowMs) {
    entry = { count: 0, windowStart: now };
    rateLimitStore.set(tenantId, entry);
  }

  entry.count += 1;

  // Determine limit: use tenant-specific limit if available
  let limit = DEFAULT_RATE_LIMIT;
  if (req.tenantId) {
    try {
      const tenant = getTenant(req.tenantId);
      if (tenant && tenant.limits && tenant.limits.rateLimit) {
        limit = tenant.limits.rateLimit;
      }
    } catch {
      // Fall back to default on any error
    }
  }

  if (entry.count > limit) {
    return res.status(429).json({ error: 'Too Many Requests' });
  }

  // Set informational rate-limit headers
  res.setHeader('X-RateLimit-Limit', limit);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, limit - entry.count));
  res.setHeader('X-RateLimit-Reset', Math.ceil((entry.windowStart + windowMs) / 1000));

  return next();
}
