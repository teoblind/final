/**
 * Office Status Routes — OpenClaw Office Visualization
 *
 * Provides a unified endpoint that aggregates agent statuses,
 * recent activity, and meeting bot state across all tenants
 * for the isometric office frontend.
 */
import express from 'express';
import {
  getAllTenants,
  getTenantEmailConfig,
  getActivities,
} from '../cache/database.js';
import { getCalendarPollStatus } from '../jobs/calendarPoll.js';

const router = express.Router();

// Simple API key auth for office frontend (not full JWT — office runs standalone)
router.use((req, res, next) => {
  const key = req.headers['x-office-key'] || req.query.key;
  const expected = process.env.OFFICE_API_KEY || 'dev-office-key';
  if (key !== expected) {
    return res.status(401).json({ error: 'Invalid office API key' });
  }
  next();
});

// Lazy import runtime to avoid circular deps at module load time
let _runtime = null;
async function getRuntime() {
  if (!_runtime) {
    const mod = await import('../services/agentRuntime.js');
    _runtime = mod.default;
  }
  return _runtime;
}

/**
 * GET /status — Unified office status for all tenants
 *
 * Returns agents (Clawbot + per-tenant email agents), recent activities,
 * and active meeting bots in a single payload.
 */
router.get('/status', async (req, res) => {
  try {
    const agents = [];
    const activities = [];

    // ── 1. Clawbot agents from AgentRuntime ──────────────────────────────
    const runtime = await getRuntime();
    const runtimeAgents = runtime.getAgentList();

    for (const ra of runtimeAgents) {
      const state = typeof ra.status === 'string' ? ra.status : ra.status?.state || 'idle';
      agents.push({
        id: ra.id,
        name: ra.name,
        tenant: null, // Clawbot agents are system-wide
        role: ra.category || 'clawbot',
        status: state,
        lastActivityAt: ra.lastEvent?.created_at
          ? new Date(ra.lastEvent.created_at).getTime()
          : null,
        currentTask: state === 'running'
          ? { name: `Running ${ra.name}`, detail: ra.lastEvent?.title || null }
          : null,
      });
    }

    // ── 2. Per-tenant email agents ───────────────────────────────────────
    const tenants = getAllTenants();

    for (const tenant of tenants) {
      const emailConfig = getTenantEmailConfig(tenant.id);
      const agentId = `email-${tenant.slug || tenant.id}`;

      // Fetch recent activity for this tenant to derive status
      let tenantActivities = [];
      try {
        tenantActivities = getActivities(tenant.id, { limit: 20 });
      } catch {
        // Tenant DB may not have activity_log yet
      }

      // Determine email agent status from recent activity
      let emailStatus = 'idle';
      let lastActivityAt = null;
      let currentTask = null;

      if (tenantActivities.length > 0) {
        const latest = tenantActivities[0];
        lastActivityAt = new Date(latest.created_at).getTime();

        // If last activity was within 60 seconds, consider it processing
        const ageMs = Date.now() - lastActivityAt;
        if (ageMs < 60_000) {
          emailStatus = 'processing';
          currentTask = { name: latest.title, detail: latest.subtitle || null };
        }
      }

      agents.push({
        id: agentId,
        name: `${tenant.name || tenant.slug} Email Agent`,
        tenant: tenant.slug || tenant.id,
        role: 'email',
        status: emailStatus,
        lastActivityAt,
        currentTask,
        senderEmail: emailConfig?.senderEmail || null,
      });

      // Append this tenant's activities to the combined feed
      for (const act of tenantActivities) {
        activities.push({
          id: act.id,
          agentId: act.agent_id || agentId,
          type: act.type,
          title: act.title,
          subtitle: act.subtitle,
          tenant: tenant.slug || tenant.id,
          createdAt: act.created_at,
        });
      }
    }

    // Sort activities by createdAt descending, cap at 50
    activities.sort((a, b) => {
      const ta = new Date(a.createdAt).getTime();
      const tb = new Date(b.createdAt).getTime();
      return tb - ta;
    });
    const recentActivities = activities.slice(0, 50);

    // ── 3. Meeting bots from CalendarPoll ────────────────────────────────
    let meetings = [];
    try {
      const pollStatus = getCalendarPollStatus();
      meetings = (pollStatus.activeBots || []).map(bot => ({
        agentId: `meeting-${bot.tenantId || 'unknown'}`,
        meetingName: bot.meetingName,
        status: 'transcribing',
        startTime: bot.startTime,
        tenantId: bot.tenantId,
        agentEmail: bot.agentEmail,
      }));
    } catch {
      // CalendarPoll may not be running
    }

    res.json({
      agents,
      activities: recentActivities,
      meetings,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Office] Error fetching status:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
