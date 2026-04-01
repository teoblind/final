/**
 * Calendar Reader - Per-tenant calendar access via tenant_email_config tokens.
 *
 * Each tenant's agent has its own Google Workspace account with calendar access.
 * This reads the agent's own calendar (primary) using the token stored in
 * tenant_email_config. No more hardcoded calendar map.
 */

import { google } from 'googleapis';
import { getTenantDb } from '../cache/database.js';

// OAuth app credentials - try GMAIL_CLIENT first, fall back to GOOGLE_OAUTH
const CLIENT_PAIRS = [
  { id: process.env.GMAIL_CLIENT_ID, secret: process.env.GMAIL_CLIENT_SECRET },
  { id: process.env.GOOGLE_OAUTH_CLIENT_ID, secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET },
].filter(p => p.id && p.secret);

const CLIENT_ID = CLIENT_PAIRS[0]?.id;
const CLIENT_SECRET = CLIENT_PAIRS[0]?.secret;
const FALLBACK_REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN;

// Cache calendar clients per tenant to avoid re-creating OAuth on every call
const calClientCache = new Map();

/**
 * Get a Calendar API client for a tenant.
 * Uses the tenant's agent OAuth token from tenant_email_config,
 * falling back to the default agent token from env vars.
 * Tries both OAuth client pairs in case the token was issued by the other client.
 */
async function getCalendarForTenant(tenantId) {
  if (calClientCache.has(tenantId)) return calClientCache.get(tenantId);

  let refreshToken = FALLBACK_REFRESH_TOKEN;

  // Try tenant-specific token
  try {
    const tdb = getTenantDb(tenantId);
    const row = tdb.prepare('SELECT gmail_refresh_token FROM tenant_email_config WHERE tenant_id = ?').get(tenantId);
    if (row?.gmail_refresh_token) {
      refreshToken = row.gmail_refresh_token;
    }
  } catch {
    // tenant_email_config may not exist - use fallback
  }

  if (!refreshToken || CLIENT_PAIRS.length === 0) {
    return null;
  }

  // Try each OAuth client pair - token may have been issued by either
  for (const pair of CLIENT_PAIRS) {
    try {
      const oauth2 = new google.auth.OAuth2(pair.id, pair.secret);
      oauth2.setCredentials({ refresh_token: refreshToken });
      const cal = google.calendar({ version: 'v3', auth: oauth2 });
      // Verify the token works
      await cal.calendarList.list({ maxResults: 1 });
      calClientCache.set(tenantId, cal);
      return cal;
    } catch (err) {
      const isAuthError = err.code === 401 || err.message?.includes('invalid_grant') ||
        err.message?.includes('Invalid Credentials') || err.message?.includes('unauthorized_client');
      if (isAuthError && CLIENT_PAIRS.indexOf(pair) < CLIENT_PAIRS.length - 1) {
        console.log(`[CalendarReader] Primary OAuth client failed for ${tenantId}, trying fallback...`);
        continue;
      }
      // Last pair or non-auth error
      console.warn(`[CalendarReader] Calendar auth failed for ${tenantId}: ${err.message}`);
      return null;
    }
  }
  return null;
}

/**
 * Count meetings in the last N days for a tenant.
 * Reads the tenant agent's own calendar (primary).
 */
export async function getMeetingCount(tenantId, days = 30) {
  const cal = await getCalendarForTenant(tenantId);
  if (!cal) return null;

  try {
    const now = new Date();
    const timeMin = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    const res = await cal.events.list({
      calendarId: 'primary',
      timeMin: timeMin.toISOString(),
      timeMax: now.toISOString(),
      maxResults: 250,
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = res.data.items || [];
    // Filter to actual meetings (have attendees or conference data)
    const meetings = events.filter(e =>
      (e.attendees && e.attendees.length > 1) ||
      e.conferenceData ||
      e.hangoutLink
    );

    return {
      total: meetings.length,
      thisWeek: meetings.filter(e => {
        const start = new Date(e.start?.dateTime || e.start?.date);
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        return start >= weekAgo;
      }).length,
    };
  } catch (err) {
    console.error(`[CalendarReader] Error for tenant ${tenantId}:`, err.message);
    return null;
  }
}
