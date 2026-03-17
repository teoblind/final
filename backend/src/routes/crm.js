/**
 * CRM Routes — Lightweight deal pipeline via Google Sheets
 *
 * GET  /api/v1/crm/pipeline    — Read pipeline stages from connected sheet
 * POST /api/v1/crm/setup-sheet — Create a CRM Google Sheet and share with user
 */

import express from 'express';
import { google } from 'googleapis';
import { getKeyVaultValue, upsertKeyVaultEntry, getTenantEmailConfig } from '../cache/database.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();
router.use(authenticate);

const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.env.GMAIL_CLIENT_SECRET;

const STAGES = ['Discovery', 'Qualification', 'Proposal', 'Negotiation', 'Contract Sent', 'Closed Won'];

function getRefreshToken(tenantId) {
  // Try key vault first (onboarding wizard stores here)
  const token = getKeyVaultValue(tenantId, 'google-docs', 'refresh_token');
  if (token) return token;
  // Fallback to tenant email config
  const config = getTenantEmailConfig(tenantId);
  return config?.gmail_refresh_token || null;
}

function makeAuth(refreshToken) {
  if (!CLIENT_ID || !CLIENT_SECRET || !refreshToken) return null;
  const client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, 'http://localhost:8099');
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

// ─── GET /pipeline ──────────────────────────────────────────────────────────

router.get('/pipeline', async (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || 'default';

    // Check for connected sheet
    const sheetId = getKeyVaultValue(tenantId, 'crm', 'sheet_id');
    if (!sheetId) {
      return res.json({ configured: false, source: null });
    }

    const refreshToken = getRefreshToken(tenantId);
    if (!refreshToken) {
      return res.json({ configured: false, error: 'No OAuth token' });
    }

    const auth = makeAuth(refreshToken);
    if (!auth) {
      return res.json({ configured: false, error: 'OAuth client error' });
    }

    const sheets = google.sheets({ version: 'v4', auth });

    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'Pipeline!A2:H1000',
    });

    const rows = result.data.values || [];

    // Group by stage
    const byStage = {};
    for (const stage of STAGES) {
      byStage[stage] = { count: 0, value: 0 };
    }

    for (const row of rows) {
      const [name, , stage, valueStr] = row;
      if (!name || !stage) continue;
      const normalizedStage = STAGES.find(s => s.toLowerCase() === stage.toLowerCase()) || stage;
      if (!byStage[normalizedStage]) byStage[normalizedStage] = { count: 0, value: 0 };
      byStage[normalizedStage].count++;
      byStage[normalizedStage].value += parseFloat((valueStr || '0').replace(/[$,]/g, '')) || 0;
    }

    res.json({
      configured: true,
      source: 'sheets',
      sheetId,
      sheetUrl: `https://docs.google.com/spreadsheets/d/${sheetId}/edit`,
      total_deals: rows.filter(r => r[0]).length,
      by_stage: byStage,
    });
  } catch (error) {
    console.error('CRM pipeline error:', error);
    res.status(500).json({ error: 'Failed to read pipeline' });
  }
});

// ─── POST /setup-sheet ──────────────────────────────────────────────────────

router.post('/setup-sheet', async (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || 'default';
    const tenant = req.resolvedTenant;
    const userEmail = req.user?.email;

    const refreshToken = getRefreshToken(tenantId);
    if (!refreshToken) {
      return res.status(400).json({ error: 'No Google account connected. Connect Google Docs & Drive in Settings first.' });
    }

    const auth = makeAuth(refreshToken);
    if (!auth) {
      return res.status(500).json({ error: 'Could not create OAuth client' });
    }

    const sheets = google.sheets({ version: 'v4', auth });
    const drive = google.drive({ version: 'v3', auth });

    const companyName = tenant?.branding?.companyName || tenant?.name || 'Company';

    // Create the spreadsheet
    const createRes = await sheets.spreadsheets.create({
      requestBody: {
        properties: { title: `${companyName} — Deal Pipeline` },
        sheets: [{
          properties: {
            title: 'Pipeline',
            gridProperties: { frozenRowCount: 1 },
          },
          data: [{
            startRow: 0,
            startColumn: 0,
            rowData: [{
              values: ['Deal Name', 'Company', 'Stage', 'Value ($)', 'Contact', 'Email', 'Notes', 'Updated'].map(h => ({
                userEnteredValue: { stringValue: h },
                userEnteredFormat: {
                  textFormat: { bold: true, fontSize: 10 },
                  backgroundColor: { red: 0.95, green: 0.95, blue: 0.93 },
                },
              })),
            }],
          }],
        }],
      },
    });

    const sheetId = createRes.data.spreadsheetId;
    const sheetUrl = createRes.data.spreadsheetUrl;

    // Format: column widths + stage dropdown
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        requests: [
          { updateDimensionProperties: { range: { sheetId: 0, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 200 }, fields: 'pixelSize' } },
          { updateDimensionProperties: { range: { sheetId: 0, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 160 }, fields: 'pixelSize' } },
          { updateDimensionProperties: { range: { sheetId: 0, dimension: 'COLUMNS', startIndex: 2, endIndex: 3 }, properties: { pixelSize: 130 }, fields: 'pixelSize' } },
          { updateDimensionProperties: { range: { sheetId: 0, dimension: 'COLUMNS', startIndex: 3, endIndex: 4 }, properties: { pixelSize: 100 }, fields: 'pixelSize' } },
          { updateDimensionProperties: { range: { sheetId: 0, dimension: 'COLUMNS', startIndex: 6, endIndex: 7 }, properties: { pixelSize: 250 }, fields: 'pixelSize' } },
          {
            setDataValidation: {
              range: { sheetId: 0, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 2, endColumnIndex: 3 },
              rule: {
                condition: { type: 'ONE_OF_LIST', values: STAGES.map(s => ({ userEnteredValue: s })) },
                showCustomUi: true,
                strict: false,
              },
            },
          },
        ],
      },
    });

    // Share with the user
    if (userEmail) {
      try {
        await drive.permissions.create({
          fileId: sheetId,
          requestBody: { type: 'user', role: 'writer', emailAddress: userEmail },
          sendNotificationEmail: false,
        });
      } catch (shareErr) {
        console.error('CRM sheet share error (non-fatal):', shareErr.message);
      }
    }

    // Store sheet ID in key vault
    upsertKeyVaultEntry({
      tenantId,
      service: 'crm',
      keyName: 'sheet_id',
      keyValue: sheetId,
      addedBy: req.user?.id || 'system',
    });

    res.json({ success: true, sheetId, sheetUrl });
  } catch (error) {
    console.error('CRM setup-sheet error:', error);
    res.status(500).json({ error: error.message || 'Failed to create CRM sheet' });
  }
});

// ─── GET /calendar/events — Upcoming calendar events ────────────────────────

router.get('/calendar/events', async (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || 'default';

    // Try calendar-specific token first, then fall back to docs token
    let refreshToken = getKeyVaultValue(tenantId, 'google-calendar', 'refresh_token');
    if (!refreshToken) refreshToken = getKeyVaultValue(tenantId, 'google-docs', 'refresh_token');
    if (!refreshToken) {
      return res.json({ events: [], configured: false });
    }

    const auth = makeAuth(refreshToken);
    if (!auth) {
      return res.json({ events: [], configured: false });
    }

    const calendar = google.calendar({ version: 'v3', auth });

    const now = new Date();
    const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const result = await calendar.events.list({
      calendarId: 'primary',
      timeMin: now.toISOString(),
      timeMax: weekFromNow.toISOString(),
      maxResults: 15,
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = (result.data.items || []).map(e => ({
      id: e.id,
      title: e.summary || '(No title)',
      start: e.start?.dateTime || e.start?.date,
      end: e.end?.dateTime || e.end?.date,
      location: e.location || null,
      meetLink: e.hangoutLink || null,
      attendees: (e.attendees || []).length,
      allDay: !e.start?.dateTime,
    }));

    res.json({ events, configured: true });
  } catch (error) {
    console.error('Calendar events error:', error);
    res.json({ events: [], configured: false, error: error.message });
  }
});

// ─── POST /calendar/events/:id/invite — Invite Coppice agent to a meeting ───

router.post('/calendar/events/:id/invite', async (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || 'default';

    let refreshToken = getKeyVaultValue(tenantId, 'google-calendar', 'refresh_token');
    if (!refreshToken) refreshToken = getKeyVaultValue(tenantId, 'google-docs', 'refresh_token');
    if (!refreshToken) {
      return res.status(400).json({ error: 'No calendar token' });
    }

    const auth = makeAuth(refreshToken);
    if (!auth) return res.status(500).json({ error: 'OAuth client error' });

    // Get the tenant agent email
    const emailConfig = getTenantEmailConfig(tenantId);
    const agentEmail = emailConfig?.senderEmail;
    if (!agentEmail) {
      return res.status(400).json({ error: 'No agent email configured for this tenant' });
    }

    const calendar = google.calendar({ version: 'v3', auth });

    // Fetch current event to get existing attendees
    const event = await calendar.events.get({
      calendarId: 'primary',
      eventId: req.params.id,
    });

    const existingAttendees = event.data.attendees || [];
    const alreadyInvited = existingAttendees.some(a => a.email === agentEmail);
    if (alreadyInvited) {
      return res.json({ success: true, alreadyInvited: true });
    }

    // Add agent as attendee
    existingAttendees.push({ email: agentEmail, responseStatus: 'accepted' });

    await calendar.events.patch({
      calendarId: 'primary',
      eventId: req.params.id,
      sendUpdates: 'none',
      requestBody: { attendees: existingAttendees },
    });

    res.json({ success: true, agentEmail });
  } catch (error) {
    console.error('Calendar invite error:', error);
    res.status(500).json({ error: error.message || 'Failed to invite Coppice' });
  }
});

export default router;
