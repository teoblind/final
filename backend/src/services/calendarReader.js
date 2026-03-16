/**
 * Calendar Reader — Per-tenant calendar access via tenant_email_config tokens.
 *
 * Each tenant's agent has its own Google Workspace account with calendar access.
 * This reads the agent's own calendar (primary) using the token stored in
 * tenant_email_config. No more hardcoded calendar map.
 */

import { google } from 'googleapis';
import { getTenantDb } from '../cache/database.js';

const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const FALLBACK_REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN;

// Cache calendar clients per tenant to avoid re-creating OAuth on every call
const calClientCache = new Map();

/**
 * Get a Calendar API client for a tenant.
 * Uses the tenant's agent OAuth token from tenant_email_config,
 * falling back to the default agent token from env vars.
 */
function getCalendarForTenant(tenantId) {
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
    // tenant_email_config may not exist — use fallback
  }

  if (!CLIENT_ID || !CLIENT_SECRET || !refreshToken) {
    return null;
  }

  const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
  oauth2.setCredentials({ refresh_token: refreshToken });
  const cal = google.calendar({ version: 'v3', auth: oauth2 });

  calClientCache.set(tenantId, cal);
  return cal;
}

/**
 * Count meetings in the last N days for a tenant.
 * Reads the tenant agent's own calendar (primary).
 */
export async function getMeetingCount(tenantId, days = 30) {
  const cal = getCalendarForTenant(tenantId);
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
