import { getTenantBySlug, getTenantByDomain, setTenantContext } from '../cache/database.js';

const BASE_DOMAIN = process.env.APP_BASE_DOMAIN || 'coppice.ai';

// Slug aliases — map subdomain to DB slug if they differ
const SLUG_ALIASES = { sangha: 'default', admin: 'default' };

// Reverse alias — map DB slug back to subdomain
const REVERSE_ALIASES = { default: 'sangha' };

/** Get the canonical subdomain for a tenant slug */
export function getSubdomainForSlug(slug) {
  return REVERSE_ALIASES[slug] || slug;
}

/**
 * Tenant resolver middleware — runs before auth.
 * Extracts tenant from hostname (subdomain or custom domain)
 * and sets req.resolvedTenant for downstream use.
 *
 * Supports:
 *   dacp.coppice.ai     → slug 'dacp'
 *   sangha.coppice.ai   → slug 'default' (via alias)
 *   dacp.localhost:5173  → slug 'dacp' (dev mode)
 *   localhost:5173       → slug 'default' (dev fallback)
 */
export default function tenantResolver(req, res, next) {
  const hostname = req.hostname; // e.g. "dacp.coppice.ai", "localhost"

  let tenant = null;
  let subdomain = null;

  // 1. Try custom domain match first (e.g. dashboard.acme.com)
  tenant = getTenantByDomain(hostname);

  // 2. Extract subdomain from coppice.ai or localhost
  if (!tenant) {
    if (hostname.endsWith(`.${BASE_DOMAIN}`)) {
      // Production: dacp.coppice.ai → 'dacp'
      subdomain = hostname.slice(0, -(BASE_DOMAIN.length + 1));
    } else if (hostname.includes('localhost')) {
      // Dev: dacp.localhost → 'dacp'
      const parts = hostname.split('.');
      if (parts.length >= 2 && parts[parts.length - 1] === 'localhost') {
        subdomain = parts[0];
      }
    } else {
      // Generic: acme.ampera.io → 'acme'
      const parts = hostname.split('.');
      if (parts.length >= 3) {
        subdomain = parts[0];
      }
    }

    if (subdomain && subdomain !== 'www' && subdomain !== 'api') {
      // Apply alias (sangha → default)
      const resolvedSlug = SLUG_ALIASES[subdomain] || subdomain;
      tenant = getTenantBySlug(resolvedSlug);
    }
  }

  // 3. Fallback: no subdomain → Sangha tenant
  if (!tenant) {
    tenant = getTenantBySlug('default');
  }

  if (tenant) {
    req.resolvedTenant = {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      branding: tenant.branding || {},
      settings: tenant.settings || {},
    };
  } else {
    req.resolvedTenant = null;
  }

  // Wrap downstream handlers in tenant context so the DB proxy routes correctly
  const tenantId = req.resolvedTenant?.id || 'default';
  setTenantContext(tenantId, () => next());
}
