/**
 * Reads calendar events via coppice@zhan.capital OAuth token.
 * Users share their calendar with coppice@zhan.capital — no weird service account emails.
 */

import { google } from 'googleapis';

// Map tenant → calendar email to read (the user's calendar shared with coppice@)
const TENANT_CALENDARS = {
  'default': 'teo@sanghasystems.com',
  'sangha': 'teo@sanghasystems.com',
  'dacp-construction-001': 'estimating@dacpconstruction.com',
};

let calClient = null;

function getCalendar() {
  if (calClient) return calClient;

  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    console.warn('[CalendarReader] Missing Gmail OAuth credentials');
    return null;
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  calClient = google.calendar({ version: 'v3', auth: oauth2 });
  return calClient;
}

/**
 * Count meetings in the last N days for a tenant.
 */
export async function getMeetingCount(tenantId, days = 30) {
  const calendarId = TENANT_CALENDARS[tenantId];
  if (!calendarId) return null;

  const cal = getCalendar();
  if (!cal) return null;

  try {
    const now = new Date();
    const timeMin = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    const res = await cal.events.list({
      calendarId,
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
    console.error('[CalendarReader] Error:', err.message);
    return null;
  }
}
