/**
 * Meetings Routes — Google Calendar integration + Live Meeting Rooms
 *
 * GET    /                        — List meetings from calendar
 * POST   /start                   — Create Google Meet + Recall bot + meeting room
 * GET    /room/:meetingId/live    — SSE stream for live transcript + agent responses
 * POST   /room/:meetingId/ask    — Ask agents a question during the meeting
 * POST   /room/:meetingId/end    — End meeting, save transcript
 * GET    /rooms                   — List active meeting rooms
 * POST   /:eventId/invite        — Invite agent to existing calendar event
 */
import express from 'express';
import { google } from 'googleapis';
import { authenticate } from '../middleware/auth.js';
import { getTenantEmailConfig, getTenantDb, insertActivity, getAllTenants } from '../cache/database.js';
import { createBot, removeBot } from '../services/recallService.js';
import {
  createMeetingRoom,
  getMeetingRoom,
  askAgents,
  endMeetingRoom,
  getFormattedTranscript,
  subscribe,
  listMeetingRooms,
} from '../services/meetingRoomService.js';

const router = express.Router();

// SSE endpoint needs to go before router.use(authenticate) because
// EventSource can't send Authorization headers — token comes via query param.
// We manually verify the JWT here.
import { verifyAccessToken } from '../services/authService.js';

/**
 * GET /room/:meetingId/live — SSE stream for live transcript + agent responses
 * Auth via ?token= query param (EventSource limitation)
 */
router.get('/room/:meetingId/live', (req, res) => {
  // Manual token verification
  const token = req.query.token;
  if (!token) return res.status(401).json({ error: 'token query param required' });
  try {
    verifyAccessToken(token);
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const { meetingId } = req.params;
  const room = getMeetingRoom(meetingId);

  if (!room) {
    return res.status(404).json({ error: 'Meeting room not found' });
  }

  // Set up SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Send existing transcript as initial data
  for (const segment of room.transcript) {
    res.write(`data: ${JSON.stringify({ type: 'transcript', ...segment })}\n\n`);
  }
  for (const response of room.agentResponses) {
    res.write(`data: ${JSON.stringify({ type: 'agent_response', ...response })}\n\n`);
  }

  // Subscribe to new events
  const unsubscribe = subscribe(meetingId, (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });

  // Heartbeat
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 15000);

  req.on('close', () => {
    unsubscribe();
    clearInterval(heartbeat);
  });
});

// All other routes require standard JWT auth
router.use(authenticate);

const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3002';

function makeCalendarClient(refreshToken) {
  if (!CLIENT_ID || !CLIENT_SECRET || !refreshToken) return null;
  const auth = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
  auth.setCredentials({ refresh_token: refreshToken });
  return google.calendar({ version: 'v3', auth });
}

// Agent system prompts for meeting participation
const AGENT_PROMPTS = {
  comms: 'You are the Communications Agent. You handle emails, follow-ups, and action items from meetings. When asked, identify who needs to be contacted and what messages should be sent.',
  chat: 'You are the Hivemind Agent. You organize and summarize meeting discussions. You track key decisions, open questions, and action items in real-time.',
  workflow: 'You are the Workflow Agent. You handle project management, estimating, scheduling, and pricing. When asked, provide estimates, identify project risks, and suggest timelines.',
  research: 'You are the Research Agent. You analyze information, find relevant data, and provide context from the knowledge base. When asked, research topics discussed in the meeting.',
};

/**
 * GET / — List meetings for the current tenant
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
    res.json({ meetings: [], error: error.message });
  }
});

/**
 * POST /start — Create a Google Meet + Recall.ai bot + meeting room
 *
 * Body: { title?, agents?: string[] }
 * agents = array of role keys to include (default: all tenant agents)
 */
router.post('/start', async (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || 'default';
    const tenantSlug = req.resolvedTenant?.slug || tenantId;
    const emailConfig = getTenantEmailConfig(tenantId);

    if (!emailConfig?.gmailRefreshToken) {
      return res.status(400).json({ error: 'No email/calendar connected for this tenant' });
    }

    const cal = makeCalendarClient(emailConfig.gmailRefreshToken);
    if (!cal) {
      return res.status(400).json({ error: 'Calendar client unavailable' });
    }

    const title = req.body.title || 'Team Meeting';
    const requestedRoles = req.body.agents || ['comms', 'chat', 'workflow', 'research'];

    // 1. Create Google Calendar event with Meet link
    const now = new Date();
    const endTime = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour

    const event = await cal.events.insert({
      calendarId: 'primary',
      conferenceDataVersion: 1,
      requestBody: {
        summary: title,
        description: 'Meeting started from Coppice Office with AI agents participating.',
        start: { dateTime: now.toISOString() },
        end: { dateTime: endTime.toISOString() },
        conferenceData: {
          createRequest: {
            requestId: `coppice-meet-${Date.now()}`,
            conferenceSolutionKey: { type: 'hangoutsMeet' },
          },
        },
      },
    });

    const meetLink = event.data.hangoutLink;
    if (!meetLink) {
      return res.status(500).json({ error: 'Failed to create Google Meet link' });
    }

    console.log(`[Meetings] Created Google Meet: ${meetLink} for tenant ${tenantId}`);

    // 2. Create Recall.ai bot to join the meeting
    const botName = `${emailConfig.senderName || 'Coppice'} (Meeting Bot)`;
    const bot = await createBot(meetLink, {
      botName,
      tenantId,
      enableVoice: true, // enables real-time transcript webhook
    });

    // 3. Build agent list for the meeting room
    const TENANT_DISPLAY = {
      'default': 'Sangha', 'sangha': 'Sangha',
      'dacp-construction-001': 'DACP', 'dacp': 'DACP',
      'zhan-capital': 'Zhan Capital', 'zhan': 'Zhan Capital',
    };
    const tenantName = TENANT_DISPLAY[tenantSlug] || TENANT_DISPLAY[tenantId] || tenantSlug;

    const agents = requestedRoles.map(role => ({
      id: `${role}-${tenantSlug}`,
      name: `${tenantName} ${role.charAt(0).toUpperCase() + role.slice(1)} Agent`,
      role,
      systemPrompt: AGENT_PROMPTS[role] || `You are the ${role} agent for ${tenantName}.`,
    }));

    // 4. Create meeting room
    const meetingId = `meet-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const room = createMeetingRoom(meetingId, {
      botId: bot.id,
      meetLink,
      tenantId,
      agents,
      title,
    });

    // Log activity
    try {
      insertActivity({
        tenantId,
        type: 'meeting',
        title: `Meeting started: ${title}`,
        subtitle: `${agents.length} agents participating — ${meetLink}`,
        sourceType: 'meeting-room',
        sourceId: meetingId,
      });
    } catch (e) {
      console.warn('[Meetings] Activity insert error:', e.message);
    }

    console.log(`[Meetings] Meeting room ${meetingId} created with ${agents.length} agents`);

    res.json({
      meetingId,
      meetLink,
      botId: bot.id,
      title,
      agents: agents.map(a => ({ id: a.id, name: a.name, role: a.role })),
      calendarEventId: event.data.id,
    });
  } catch (error) {
    console.error('[Meetings] Start meeting error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /room/:meetingId/ask — Ask agents a question during the meeting
 *
 * Body: { question: string }
 */
router.post('/room/:meetingId/ask', async (req, res) => {
  try {
    const { meetingId } = req.params;
    const { question } = req.body;

    if (!question) {
      return res.status(400).json({ error: 'question is required' });
    }

    const room = getMeetingRoom(meetingId);
    if (!room) {
      return res.status(404).json({ error: 'Meeting room not found' });
    }

    const responses = await askAgents(meetingId, question);
    res.json({ responses });
  } catch (error) {
    console.error('[Meetings] Ask agents error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /room/:meetingId/end — End the meeting, save transcript to knowledge
 */
router.post('/room/:meetingId/end', async (req, res) => {
  try {
    const { meetingId } = req.params;
    const room = getMeetingRoom(meetingId);

    if (!room) {
      return res.status(404).json({ error: 'Meeting room not found' });
    }

    // Remove the Recall bot from the meeting
    try {
      await removeBot(room.botId);
    } catch (e) {
      console.warn('[Meetings] Bot removal error:', e.message);
    }

    // Save transcript to knowledge entries
    const transcript = getFormattedTranscript(meetingId);
    if (transcript && room.tenantId) {
      try {
        const tdb = getTenantDb(room.tenantId);
        const entryId = `meeting-${meetingId}`;
        tdb.prepare(`
          INSERT OR REPLACE INTO knowledge_entries (id, tenant_id, type, title, transcript, content, source, source_agent, recorded_at, processed)
          VALUES (?, ?, 'meeting', ?, ?, ?, 'meeting-room', 'hivemind', datetime('now'), 0)
        `).run(entryId, room.tenantId, room.title, transcript, transcript);

        console.log(`[Meetings] Saved transcript (${room.transcript.length} segments) to knowledge for tenant ${room.tenantId}`);

        insertActivity({
          tenantId: room.tenantId,
          type: 'meeting',
          title: `Meeting ended: ${room.title}`,
          subtitle: `${room.transcript.length} transcript segments saved`,
          sourceType: 'meeting-room',
          sourceId: meetingId,
        });
      } catch (e) {
        console.error('[Meetings] Save transcript error:', e.message);
      }
    }

    // End the room
    endMeetingRoom(meetingId);

    res.json({
      meetingId,
      status: 'ended',
      transcriptSegments: room.transcript.length,
      saved: !!transcript,
    });
  } catch (error) {
    console.error('[Meetings] End meeting error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /rooms — List active meeting rooms
 */
router.get('/rooms', (req, res) => {
  res.json({ rooms: listMeetingRooms() });
});

/**
 * POST /:eventId/invite — Invite Coppice to an existing calendar event
 */
router.post('/:eventId/invite', async (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || 'default';
    const emailConfig = getTenantEmailConfig(tenantId);

    if (!emailConfig?.gmailRefreshToken) {
      return res.status(400).json({ error: 'No email connected' });
    }

    const cal = makeCalendarClient(emailConfig.gmailRefreshToken);
    if (!cal) {
      return res.status(400).json({ error: 'Calendar client unavailable' });
    }

    const { eventId } = req.params;
    const agentEmail = emailConfig.senderEmail;

    const event = await cal.events.get({ calendarId: 'primary', eventId });
    const existingAttendees = event.data.attendees || [];

    if (existingAttendees.some(a => a.email === agentEmail)) {
      return res.json({ success: true, message: 'Coppice is already invited' });
    }

    await cal.events.patch({
      calendarId: 'primary',
      eventId,
      sendUpdates: 'none',
      requestBody: {
        attendees: [...existingAttendees, { email: agentEmail, responseStatus: 'accepted' }],
      },
    });

    console.log(`[Meetings] Invited ${agentEmail} to event ${eventId} for tenant ${tenantId}`);
    res.json({ success: true, agentEmail });
  } catch (error) {
    console.error('[Meetings] Error inviting to meeting:', error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;
