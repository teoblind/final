import express from 'express';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import {
  getAllAgentEvents,
  createBotRegistration,
  getBotRegistrationsByTenant,
  getBotRegistrationsByUser,
  updateBotRegistration,
  deleteBotRegistration,
  addBotComment,
  getBotComments,
  getBotCommentCounts,
} from '../cache/database.js';
import { optionalAuth, authenticate } from '../middleware/auth.js';

const router = express.Router();

// External paths (defaults - can be overridden per-bot via registration config)
const LEADS_DB_PATH = join(homedir(), 'Charger-Bot/data/leads.db');
const MEETINGS_DIR = join(homedir(), 'Desktop/notes/Meetings');
const RECORDER_LOGS_DIR = join(homedir(), 'Desktop/notes/setup/logs');

// In-memory cache
let activityCache = { data: null, ts: 0 };
let statsCache = { data: null, ts: 0 };
const CACHE_TTL = 30_000; // 30s

// Open external DB read-only (returns null if missing)
function openExternalDb(path) {
  try {
    if (!existsSync(path)) return null;
    return new Database(path, { readonly: true, fileMustExist: true });
  } catch {
    return null;
  }
}

// Parse meeting markdown frontmatter
function parseMeetingFiles(dir = MEETINGS_DIR) {
  const events = [];
  try {
    if (!existsSync(dir)) return events;
    const files = readdirSync(dir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      const content = readFileSync(join(dir, file), 'utf-8');
      const lines = content.split('\n');

      const title = lines.find(l => l.startsWith('# '))?.replace('# ', '') || file.replace('.md', '');

      const dateLine = lines.find(l => l.startsWith('**Date:**'));
      let timestamp = null;
      if (dateLine) {
        const dateStr = dateLine.replace('**Date:**', '').trim();
        const parsed = new Date(dateStr);
        if (!isNaN(parsed)) timestamp = parsed.toISOString();
      }
      if (!timestamp) {
        const match = file.match(/^(\d{4}-\d{2}-\d{2})/);
        if (match) timestamp = new Date(match[1]).toISOString();
      }

      const durationLine = lines.find(l => l.startsWith('**Duration:**'));
      const duration = durationLine?.replace('**Duration:**', '').trim() || '';
      const attendeesLine = lines.find(l => l.startsWith('**Attendees:**'));
      const attendees = attendeesLine?.replace('**Attendees:**', '').trim() || '';

      const summaryIdx = lines.findIndex(l => l.startsWith('## Summary'));
      let summary = '';
      if (summaryIdx !== -1) {
        const summaryLines = [];
        for (let i = summaryIdx + 1; i < lines.length && !lines[i].startsWith('## '); i++) {
          const line = lines[i].replace(/^- \*\*.*?\*\*:?\s*/, '').trim();
          if (line) summaryLines.push(line);
        }
        summary = summaryLines.slice(0, 2).join(' | ');
      }

      if (timestamp) {
        events.push({
          id: `meeting-${file}`,
          timestamp,
          bot: 'meeting',
          action: 'meeting_recorded',
          summary: title,
          details: { duration, attendees, summary, file },
          status: 'completed',
        });
      }
    }
  } catch (err) {
    console.warn('Failed to parse meeting files:', err.message);
  }
  return events;
}

// Parse auto-recorder log lines
function parseRecorderLogs(dir = RECORDER_LOGS_DIR) {
  const events = [];
  try {
    if (!existsSync(dir)) return events;
    const logFiles = readdirSync(dir)
      .filter(f => f.startsWith('auto-recorder_') && f.endsWith('.log'))
      .sort()
      .slice(-7);

    for (const file of logFiles) {
      const dateMatch = file.match(/auto-recorder_(\d{4}-\d{2}-\d{2})\.log/);
      if (!dateMatch) continue;
      const dateStr = dateMatch[1];
      const content = readFileSync(join(dir, file), 'utf-8');

      for (const line of content.split('\n')) {
        const timeMatch = line.match(/^\[(\d{2}:\d{2}:\d{2})\]\s*(.+)$/);
        if (!timeMatch) continue;
        const [, time, message] = timeMatch;
        const timestamp = new Date(`${dateStr}T${time}`).toISOString();

        let action = 'log';
        let status = 'info';
        if (message.includes('Recording started') || message.includes('Started recording')) {
          action = 'recording_started'; status = 'active';
        } else if (message.includes('Recording stopped') || message.includes('saved')) {
          action = 'recording_completed'; status = 'completed';
        } else if (message.includes('skipped')) {
          action = 'recording_skipped'; status = 'skipped';
        } else if (message.includes('AUTO MEETING RECORDER')) {
          action = 'bot_started'; status = 'active';
        } else if (message.includes('Shutting down')) {
          action = 'bot_stopped'; status = 'stopped';
        } else if (message.includes('call') || message.includes('meeting') || message.includes('Detected')) {
          action = 'call_detected'; status = 'info';
        } else {
          continue;
        }

        events.push({
          id: `recorder-${dateStr}-${time}`,
          timestamp, bot: 'recorder', action, summary: message,
          details: { logFile: file }, status,
        });
      }
    }
  } catch (err) {
    console.warn('Failed to parse recorder logs:', err.message);
  }
  return events;
}

// ─── Public endpoints (work without auth for local dev) ─────────────────────

// GET /api/v1/bots/activity?limit=50&bot=all&member=all
router.get('/activity', optionalAuth, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const botFilter = req.query.bot || 'all';
    const memberFilter = req.query.member || 'all';

    // Check cache
    const now = Date.now();
    if (activityCache.data && (now - activityCache.ts) < CACHE_TTL) {
      let events = activityCache.data;
      if (botFilter !== 'all') events = events.filter(e => e.bot === botFilter);
      if (memberFilter !== 'all') events = events.filter(e => e.ownerId === memberFilter);

      // Attach comment counts if authenticated
      if (req.user?.tenantId) {
        const keys = events.slice(0, limit).map(e => e.id);
        const counts = getBotCommentCounts(keys, req.user.tenantId);
        events = events.map(e => ({ ...e, commentCount: counts[e.id] || 0 }));
      }

      return res.json({ events: events.slice(0, limit), cached: true });
    }

    const allEvents = [];

    // Gather events from all registered bots for the tenant, plus defaults
    // For now, always include default local sources; registered bots add more
    let registeredBots = [];
    if (req.user?.tenantId) {
      registeredBots = getBotRegistrationsByTenant(req.user.tenantId);
    }

    // Build owner map from registrations
    const ownerMap = {};
    for (const bot of registeredBots) {
      ownerMap[bot.bot_type] = { id: bot.user_id, name: bot.owner_name };
    }

    // 1. Charger-Bot: sent_log (email events)
    const leadsDb = openExternalDb(LEADS_DB_PATH);
    if (leadsDb) {
      try {
        const sentRows = leadsDb.prepare(
          `SELECT id, email_address, venue_name, first_sent_at, last_sent_at,
                  followup_count, status, subject, bounced
           FROM sent_log ORDER BY last_sent_at DESC LIMIT 100`
        ).all();

        for (const row of sentRows) {
          const owner = ownerMap['email'] || ownerMap['lead-gen'];
          allEvents.push({
            id: `email-${row.id}`,
            timestamp: row.last_sent_at || row.first_sent_at,
            bot: 'email',
            action: row.bounced ? 'email_bounced' : row.status === 'replied' ? 'email_replied' : 'email_sent',
            summary: `${row.venue_name}: ${row.subject || 'Outreach email'}`,
            details: { email: row.email_address, venue: row.venue_name, followups: row.followup_count, status: row.status },
            status: row.bounced ? 'error' : row.status === 'replied' ? 'success' : 'sent',
            ownerId: owner?.id || null,
            ownerName: owner?.name || null,
          });
        }

        const leadRows = leadsDb.prepare(
          `SELECT id, venue_name, region, industry, discovered_at, status, priority_score, source_query
           FROM leads ORDER BY discovered_at DESC LIMIT 100`
        ).all();

        for (const row of leadRows) {
          const owner = ownerMap['lead-gen'];
          allEvents.push({
            id: `lead-${row.id}`,
            timestamp: row.discovered_at,
            bot: 'lead-gen',
            action: 'lead_discovered',
            summary: `${row.venue_name} (${row.region || 'Unknown'})`,
            details: { industry: row.industry, priority: row.priority_score, status: row.status, query: row.source_query },
            status: row.status === 'contacted' ? 'contacted' : 'new',
            ownerId: owner?.id || null,
            ownerName: owner?.name || null,
          });
        }
      } finally {
        leadsDb.close();
      }
    }

    // 3. Meeting notes
    const meetingEvents = parseMeetingFiles();
    const meetingOwner = ownerMap['meeting'];
    for (const e of meetingEvents) {
      e.ownerId = meetingOwner?.id || null;
      e.ownerName = meetingOwner?.name || null;
    }
    allEvents.push(...meetingEvents);

    // 4. Auto-recorder logs
    const recorderEvents = parseRecorderLogs();
    const recorderOwner = ownerMap['recorder'];
    for (const e of recorderEvents) {
      e.ownerId = recorderOwner?.id || null;
      e.ownerName = recorderOwner?.name || null;
    }
    allEvents.push(...recorderEvents);

    // 5. Internal agent events
    try {
      const agentEvents = getAllAgentEvents(100);
      const agentOwner = ownerMap['agent'];
      for (const ae of agentEvents) {
        allEvents.push({
          id: `agent-${ae.id}`,
          timestamp: ae.timestamp,
          bot: 'agent',
          action: ae.event_type,
          summary: ae.summary || `${ae.agent_id}: ${ae.event_type}`,
          details: ae.details_json ? JSON.parse(ae.details_json) : {},
          status: ae.event_type === 'error' ? 'error' : 'completed',
          ownerId: agentOwner?.id || null,
          ownerName: agentOwner?.name || null,
        });
      }
    } catch { /* empty */ }

    allEvents.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    activityCache = { data: allEvents, ts: now };

    let events = allEvents;
    if (botFilter !== 'all') events = events.filter(e => e.bot === botFilter);
    if (memberFilter !== 'all') events = events.filter(e => e.ownerId === memberFilter);

    // Attach comment counts
    const sliced = events.slice(0, limit);
    if (req.user?.tenantId) {
      const keys = sliced.map(e => e.id);
      const counts = getBotCommentCounts(keys, req.user.tenantId);
      for (const e of sliced) e.commentCount = counts[e.id] || 0;
    }

    res.json({ events: sliced, cached: false });
  } catch (err) {
    console.error('Bots activity error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/v1/bots/status
router.get('/status', optionalAuth, (req, res) => {
  try {
    const now = new Date();
    const fiveMinAgo = new Date(now - 5 * 60 * 1000);
    const bots = [];

    // Include registered bot metadata if authenticated
    let registeredBots = [];
    if (req.user?.tenantId) {
      registeredBots = getBotRegistrationsByTenant(req.user.tenantId);
    }
    const regMap = {};
    for (const rb of registeredBots) {
      regMap[rb.bot_type] = rb;
    }

    // Charger-Bot
    try {
      if (existsSync(LEADS_DB_PATH)) {
        const stat = statSync(LEADS_DB_PATH);
        const lastMod = new Date(stat.mtime);
        const reg = regMap['lead-gen'] || regMap['email'];
        bots.push({
          id: 'charger-bot', name: 'Charger Bot',
          status: lastMod > fiveMinAgo ? 'active' : 'idle',
          lastActivity: lastMod.toISOString(), icon: 'zap',
          ownerName: reg?.owner_name || null, ownerId: reg?.user_id || null,
        });
      } else {
        bots.push({ id: 'charger-bot', name: 'Charger Bot', status: 'offline', lastActivity: null, icon: 'zap', ownerName: null, ownerId: null });
      }
    } catch {
      bots.push({ id: 'charger-bot', name: 'Charger Bot', status: 'unknown', lastActivity: null, icon: 'zap', ownerName: null, ownerId: null });
    }

    // MeetingBot
    try {
      if (existsSync(MEETINGS_DIR)) {
        const files = readdirSync(MEETINGS_DIR).filter(f => f.endsWith('.md')).sort();
        if (files.length > 0) {
          const lastFile = files[files.length - 1];
          const stat = statSync(join(MEETINGS_DIR, lastFile));
          const reg = regMap['meeting'];
          bots.push({
            id: 'meeting-bot', name: 'Meeting Bot',
            status: stat.mtime > fiveMinAgo ? 'active' : 'idle',
            lastActivity: stat.mtime.toISOString(), icon: 'mic',
            ownerName: reg?.owner_name || null, ownerId: reg?.user_id || null,
          });
        }
      } else {
        bots.push({ id: 'meeting-bot', name: 'Meeting Bot', status: 'offline', lastActivity: null, icon: 'mic', ownerName: null, ownerId: null });
      }
    } catch {
      bots.push({ id: 'meeting-bot', name: 'Meeting Bot', status: 'unknown', lastActivity: null, icon: 'mic', ownerName: null, ownerId: null });
    }

    // Auto-Recorder
    try {
      const today = now.toISOString().split('T')[0];
      const logPath = join(RECORDER_LOGS_DIR, `auto-recorder_${today}.log`);
      if (existsSync(logPath)) {
        const stat = statSync(logPath);
        const reg = regMap['recorder'];
        bots.push({
          id: 'auto-recorder', name: 'Auto Recorder',
          status: stat.mtime > fiveMinAgo ? 'active' : 'idle',
          lastActivity: stat.mtime.toISOString(), icon: 'video',
          ownerName: reg?.owner_name || null, ownerId: reg?.user_id || null,
        });
      } else {
        bots.push({ id: 'auto-recorder', name: 'Auto Recorder', status: 'offline', lastActivity: null, icon: 'video', ownerName: null, ownerId: null });
      }
    } catch {
      bots.push({ id: 'auto-recorder', name: 'Auto Recorder', status: 'unknown', lastActivity: null, icon: 'video', ownerName: null, ownerId: null });
    }

    res.json({ bots });
  } catch (err) {
    console.error('Bots status error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/v1/bots/stats
router.get('/stats', (req, res) => {
  try {
    const now = Date.now();
    if (statsCache.data && (now - statsCache.ts) < CACHE_TTL) {
      return res.json({ ...statsCache.data, cached: true });
    }

    let totalLeads = 0, emailsSentToday = 0, totalEmailsSent = 0, repliedCount = 0, bouncedCount = 0;

    const leadsDb = openExternalDb(LEADS_DB_PATH);
    if (leadsDb) {
      try {
        totalLeads = leadsDb.prepare('SELECT COUNT(*) as c FROM leads').get().c;
        totalEmailsSent = leadsDb.prepare('SELECT COUNT(*) as c FROM sent_log').get().c;
        repliedCount = leadsDb.prepare("SELECT COUNT(*) as c FROM sent_log WHERE status = 'replied'").get().c;
        bouncedCount = leadsDb.prepare('SELECT COUNT(*) as c FROM sent_log WHERE bounced = 1').get().c;
        const today = new Date().toISOString().split('T')[0];
        emailsSentToday = leadsDb.prepare("SELECT COUNT(*) as c FROM sent_log WHERE DATE(first_sent_at) = ?").get(today).c;
      } finally {
        leadsDb.close();
      }
    }

    let meetingsThisWeek = 0;
    try {
      if (existsSync(MEETINGS_DIR)) {
        const nowDate = new Date();
        const weekAgo = new Date(nowDate - 7 * 24 * 60 * 60 * 1000);
        const files = readdirSync(MEETINGS_DIR).filter(f => f.endsWith('.md'));
        for (const file of files) {
          const match = file.match(/^(\d{4}-\d{2}-\d{2})/);
          if (match && new Date(match[1]) >= weekAgo) meetingsThisWeek++;
        }
      }
    } catch { /* ignore */ }

    const responseRate = totalEmailsSent > 0
      ? ((repliedCount / (totalEmailsSent - bouncedCount)) * 100).toFixed(1) : '0.0';

    const stats = { totalLeads, emailsSentToday, totalEmailsSent, meetingsThisWeek, responseRate: `${responseRate}%`, repliedCount, bouncedCount };
    statsCache = { data: stats, ts: now };
    res.json({ ...stats, cached: false });
  } catch (err) {
    console.error('Bots stats error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Authenticated team endpoints ───────────────────────────────────────────

// GET /api/v1/bots/team - list all bots registered by team members
router.get('/team', authenticate, (req, res) => {
  try {
    const bots = getBotRegistrationsByTenant(req.user.tenantId);
    res.json({ bots });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/bots/register - register a bot for the current user
router.post('/register', authenticate, (req, res) => {
  try {
    const { name, botType, config } = req.body;
    if (!name || !botType) {
      return res.status(400).json({ error: 'name and botType are required' });
    }
    const id = randomUUID();
    createBotRegistration({
      id,
      tenantId: req.user.tenantId,
      userId: req.user.id,
      name,
      botType,
      configJson: config ? JSON.stringify(config) : null,
    });
    // Invalidate cache so new bot appears
    activityCache = { data: null, ts: 0 };
    res.json({ id, name, botType, status: 'active' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/v1/bots/register/:id - update a registered bot
router.put('/register/:id', authenticate, (req, res) => {
  try {
    const { name, config, status } = req.body;
    updateBotRegistration(req.params.id, req.user.id, {
      name,
      configJson: config ? JSON.stringify(config) : undefined,
      status,
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/v1/bots/register/:id - remove a registered bot (owner only)
router.delete('/register/:id', authenticate, (req, res) => {
  try {
    deleteBotRegistration(req.params.id, req.user.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/bots/events/:eventId/comments - add a comment on a bot event
router.post('/events/:eventId/comments', authenticate, (req, res) => {
  try {
    const { text } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'text is required' });
    addBotComment({
      tenantId: req.user.tenantId,
      userId: req.user.id,
      userName: req.user.name,
      eventKey: req.params.eventId,
      text: text.trim(),
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/v1/bots/events/:eventId/comments - get comments for a bot event
router.get('/events/:eventId/comments', authenticate, (req, res) => {
  try {
    const comments = getBotComments(req.params.eventId, req.user.tenantId);
    res.json({ comments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
