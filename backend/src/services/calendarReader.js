/**
 * Reads calendar events via Google service account.
 * Requires the user to share their calendar with the service account.
 */

import { google } from 'googleapis';
import path from 'path';

const KEY_FILE = path.join(process.env.HOME || '/root', 'google-service-account.json');

// Map tenant → calendar email to read
const TENANT_CALENDARS = {
  'default': 'teo@sanghasystems.com',
  'sangha': 'teo@sanghasystems.com',
  'dacp-construction-001': 'estimating@dacpconstruction.com',
};

let calClient = null;

async function getCalendar() {
  if (calClient) return calClient;
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: KEY_FILE,
      scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
    });
    calClient = google.calendar({ version: 'v3', auth });
    return calClient;
  } catch (err) {
    console.error('[CalendarReader] Auth failed:', err.message);
    return null;
  }
}

/**
 * Count meetings in the last N days for a tenant.
 */
export async function getMeetingCount(tenantId, days = 30) {
  const calendarId = TENANT_CALENDARS[tenantId];
  if (!calendarId) return null;

  const cal = await getCalendar();
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
