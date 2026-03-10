/**
 * Platform Notification Routes
 *
 * Multi-tenant notification system for agent events,
 * approvals, and operational alerts.
 *
 * GET  /                — List notifications for current tenant/user
 * POST /:id/read        — Mark notification as read
 * POST /read-all        — Mark all notifications as read
 * GET  /count           — Return unread count
 */
import express from 'express';
import db from '../cache/database.js';

const router = express.Router();

function resolveIds(req) {
  const tenantId = req.resolvedTenant?.id || 'default';
  const userId = req.user?.id || 'anonymous';
  return { tenantId, userId };
}

/**
 * Seed demo notifications if none exist for a given tenant.
 */
function seedDemoNotifications(tenantId) {
  const count = db.prepare('SELECT COUNT(*) as c FROM platform_notifications WHERE tenant_id = ?').get(tenantId);
  if (count.c > 0) return;

  const demos = {
    'default': [
      { agent_id: 'curtailment', title: 'Curtailment Agent recommends S19 shutdown', body: 'ERCOT prices negative for 4+ hours — S19 fleet idle saves $2,140/hr. Approve to execute.', type: 'action', link_tab: 'curtailment' },
      { agent_id: 'sangha', title: 'Weekly Executive Briefing ready for review', body: 'Fleet hashrate 42.1 EH/s, uptime 97.3%, revenue $1.24M. Full report attached.', type: 'info', link_tab: 'reports' },
      { agent_id: 'pools', title: 'Pool routing detected 3.2% yield improvement on Foundry', body: 'Switching 15 EH/s from F2Pool to Foundry USA increases daily yield by ~$4,800.', type: 'success', link_tab: 'pools' },
    ],
    'dacp-construction-001': [
      { agent_id: 'estimating', title: 'Turner Construction bid email ready to send', body: 'Estimate #EST-2026-041 for Midtown Tower foundations — $847K total. Review and approve.', type: 'action', link_tab: 'estimates' },
      { agent_id: 'meetings', title: 'Meeting summary ready — McCarthy 2PM call', body: 'Key items: rebar pricing locked at $0.89/lb, pour schedule moved to March 20.', type: 'info', link_tab: 'meetings' },
    ],
  };

  const rows = demos[tenantId];
  if (!rows) return;

  const insert = db.prepare(`
    INSERT INTO platform_notifications (tenant_id, user_id, agent_id, title, body, type, link_tab)
    VALUES (?, NULL, ?, ?, ?, ?, ?)
  `);

  for (const r of rows) {
    insert.run(tenantId, r.agent_id, r.title, r.body, r.type, r.link_tab);
  }
}

/** GET / — List notifications */
router.get('/', (req, res) => {
  try {
    const { tenantId, userId } = resolveIds(req);
    seedDemoNotifications(tenantId);

    const limit = parseInt(req.query.limit) || 20;
    const unreadOnly = req.query.unread === 'true';

    let sql = `SELECT * FROM platform_notifications WHERE tenant_id = ? AND (user_id IS NULL OR user_id = ?)`;
    if (unreadOnly) sql += ` AND read = 0`;
    sql += ` ORDER BY created_at DESC LIMIT ?`;

    const notifications = db.prepare(sql).all(tenantId, userId, limit);
    res.json({ notifications, fetchedAt: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** GET /count — Unread count */
router.get('/count', (req, res) => {
  try {
    const { tenantId, userId } = resolveIds(req);
    seedDemoNotifications(tenantId);

    const row = db.prepare(
      `SELECT COUNT(*) as count FROM platform_notifications WHERE tenant_id = ? AND (user_id IS NULL OR user_id = ?) AND read = 0`
    ).get(tenantId, userId);
    res.json({ unreadCount: row.count });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** POST /:id/read — Mark single notification as read */
router.post('/:id/read', (req, res) => {
  try {
    const { tenantId } = resolveIds(req);
    db.prepare('UPDATE platform_notifications SET read = 1 WHERE id = ? AND tenant_id = ?').run(
      parseInt(req.params.id), tenantId
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** POST /read-all — Mark all as read */
router.post('/read-all', (req, res) => {
  try {
    const { tenantId, userId } = resolveIds(req);
    db.prepare(
      'UPDATE platform_notifications SET read = 1 WHERE tenant_id = ? AND (user_id IS NULL OR user_id = ?) AND read = 0'
    ).run(tenantId, userId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
