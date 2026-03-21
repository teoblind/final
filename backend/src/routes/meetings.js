/**
 * Meetings Routes — Google Calendar integration for dashboard
 *
 * Queries the tenant's connected Google Calendar to show upcoming meetings.
 */
import express from 'express';
import { google } from 'googleapis';
import { authenticate } from '../middleware/auth.js';
import { getTenantEmailConfig } from '../cache/database.js';

const router = express.Router();
router.use(authenticate);

const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;

function makeCalendarClient(refreshToken) {
  if (!CLIENT_ID || !CLIENT_SECRET || !refreshToken) return null;
  const auth = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
  auth.setCredentials({ refresh_token: refreshToken });
  return google.calendar({ version: 'v3', auth });
}

/**
 * GET / — List meetings for the current tenant
 *
 * Query params:
 *   range=week  → this week (Mon–Sun)
 *   range=day   → today only
 *   range=month → this month
 */
router.get('/', async (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || 'default';
    const emailConfig = getTenantEmailConfig(tenantId);

    if (!emailConfig?.gmailRefreshToken) {
      return res.json({ meetings: [], note: 'No email connected' });
    }

    const cal = makeCalendarClient(emailConfig.gmailRefreshToken);
    if (!cal) {
      return res.json({ meetings: [], note: 'Calendar client unavailable' });
    }

    // Determine time range
    const range = req.query.range || 'week';
    const now = new Date();
    let timeMin, timeMax;

    if (range === 'day') {
      timeMin = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      timeMax = new Date(timeMin);
      timeMax.setDate(timeMax.getDate() + 1);
    } else if (range === 'month') {
      timeMin = new Date(now.getFullYear(), now.getMonth(), 1);
      timeMax = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    } else {
      // week — Monday to Sunday
      const day = now.getDay();
      const mondayOffset = day === 0 ? -6 : 1 - day;
      timeMin = new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOffset);
      timeMax = new Date(timeMin);
      timeMax.setDate(timeMax.getDate() + 7);
    }

    const response = await cal.events.list({
      calendarId: 'primary',
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 50,
    });

    const items = response.data.items || [];
    const meetings = items
      .filter(e => e.status !== 'cancelled')
      .map(e => ({
        id: e.id,
        title: e.summary || '(No title)',
        start: e.start?.dateTime || e.start?.date,
        end: e.end?.dateTime || e.end?.date,
        location: e.location || null,
        meetLink: e.hangoutLink || e.conferenceData?.entryPoints?.find(ep => ep.entryPointType === 'video')?.uri || null,
        attendees: (e.attendees || []).map(a => ({ email: a.email, name: a.displayName, status: a.responseStatus })),
        organizer: e.organizer?.email || null,
      }));

    res.json({ meetings });
  } catch (error) {
    console.error('[Meetings] Error fetching calendar:', error.message);
    // Don't fail the dashboard — return empty
    res.json({ meetings: [], error: error.message });
  }
});

export default router;
