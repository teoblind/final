/**
 * Activity Feed Routes
 *
 * GET  /api/v1/activity          — List recent activities (paginated, filterable by type)
 * GET  /api/v1/activity/summary  — Dashboard summary (stats + recent activity)
 * GET  /api/v1/activity/:id      — Get single activity with full detail_json
 */

import express from 'express';
import { getActivities, getActivityDetail, getActivityCount, getLeadStats, getFleetConfig, getPoolConfig } from '../cache/database.js';

const router = express.Router();

function formatRelativeTime(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr + 'Z').getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

/**
 * GET / — List activities
 * Query: limit (default 20), offset (default 0), type (optional filter)
 */
router.get('/', (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || 'default';
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;
    const type = req.query.type || undefined;

    const rows = getActivities(tenantId, { limit, offset, type });
    const total = getActivityCount(tenantId, type);

    const activities = rows.map(row => ({
      id: row.id,
      type: row.type,
      title: row.title,
      subtitle: row.subtitle,
      time: formatRelativeTime(row.created_at),
      createdAt: row.created_at,
      hasDetail: !!row.has_detail,
      sourceType: row.source_type,
      agentId: row.agent_id,
    }));

    res.json({ activities, total });
  } catch (error) {
    console.error('Activity list error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /summary — Dashboard summary (stats + recent activity)
 * Used by Command dashboard for live polling every 30s.
 */
router.get('/summary', (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || 'default';

    // Lead/outreach stats
    let leads = 0, outreach = 0, replies = 0;
    try {
      const stats = getLeadStats(tenantId);
      leads = stats?.totalLeads || 0;
      outreach = stats?.totalEmailsSent || 0;
      replies = stats?.responded || 0;
    } catch {}

    // Meeting count from activity log
    const meetings = getActivityCount(tenantId, 'meet');

    // Recent activity
    const recentRows = getActivities(tenantId, { limit: 20 });
    const recentActivity = recentRows.map(row => ({
      id: row.id,
      type: row.type,
      title: row.title,
      subtitle: row.subtitle,
      time: formatRelativeTime(row.created_at),
      agentId: row.agent_id,
    }));

    // Config status
    let fleetConnected = false, poolConnected = false;
    try { fleetConnected = !!getFleetConfig()?.config_json; } catch {}
    try { poolConnected = !!getPoolConfig()?.config_json; } catch {}

    res.json({
      leads,
      outreach,
      replies,
      meetings,
      recentActivity,
      fleetConnected,
      poolConnected,
    });
  } catch (error) {
    console.error('Dashboard summary error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /:id — Get single activity with full detail
 */
router.get('/:id', (req, res) => {
  try {
    const row = getActivityDetail(parseInt(req.params.id));
    if (!row) return res.status(404).json({ error: 'Activity not found' });

    // Verify tenant access
    const tenantId = req.resolvedTenant?.id || 'default';
    if (row.tenant_id !== tenantId) return res.status(404).json({ error: 'Activity not found' });

    let detail = null;
    if (row.detail_json) {
      try { detail = JSON.parse(row.detail_json); } catch {}
    }

    res.json({
      id: row.id,
      type: row.type,
      title: row.title,
      subtitle: row.subtitle,
      detail,
      sourceType: row.source_type,
      sourceId: row.source_id,
      agentId: row.agent_id,
      time: formatRelativeTime(row.created_at),
      createdAt: row.created_at,
    });
  } catch (error) {
    console.error('Activity detail error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
