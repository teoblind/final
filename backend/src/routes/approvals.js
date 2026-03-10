/**
 * Approval Queue Routes
 *
 * GET    /api/v1/approvals        — List approval items (query: status, limit)
 * POST   /api/v1/approvals        — Create new approval item
 * GET    /api/v1/approvals/:id    — Get single approval item
 * POST   /api/v1/approvals/:id/approve — Approve item
 * POST   /api/v1/approvals/:id/reject  — Reject item
 */

import express from 'express';
import db from '../cache/database.js';
import { sendEstimateEmail, sendEmail } from '../services/emailService.js';

const router = express.Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveIds(req) {
  const tenantId = req.resolvedTenant?.id || 'default';
  const userId = req.user?.id || 'anonymous';
  return { tenantId, userId };
}

// ---------------------------------------------------------------------------
// GET / — list approval items
// ---------------------------------------------------------------------------
router.get('/', (req, res) => {
  try {
    const { tenantId } = resolveIds(req);
    const status = req.query.status || 'pending';
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    const rows = db.prepare(`
      SELECT * FROM approval_items
      WHERE tenant_id = ? AND status = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(tenantId, status, limit);

    res.json({
      count: rows.length,
      status,
      items: rows.map(formatItem),
    });
  } catch (error) {
    console.error('Approvals GET error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// POST / — create new approval item
// ---------------------------------------------------------------------------
router.post('/', (req, res) => {
  try {
    const { tenantId } = resolveIds(req);
    const { title, description, type, agent_id, payload, required_role } = req.body;

    if (!title || !type || !agent_id) {
      return res.status(400).json({ error: 'title, type, and agent_id are required' });
    }

    const validTypes = ['email_draft', 'curtailment', 'estimate', 'report', 'config_change', 'document'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: `Invalid type. Must be one of: ${validTypes.join(', ')}` });
    }

    const result = db.prepare(`
      INSERT INTO approval_items (tenant_id, agent_id, title, description, type, payload_json, required_role)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      tenantId,
      agent_id,
      title,
      description || null,
      type,
      payload ? JSON.stringify(payload) : null,
      required_role || 'admin',
    );

    const item = db.prepare('SELECT * FROM approval_items WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(formatItem(item));
  } catch (error) {
    console.error('Approvals POST error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// GET /insights — list agent insights for Command dashboard
// ---------------------------------------------------------------------------
router.get('/insights', (req, res) => {
  const { tenantId } = resolveIds(req);
  const status = req.query.status || 'active';
  const limit = parseInt(req.query.limit) || 20;

  try {
    const rows = db.prepare(`
      SELECT * FROM agent_insights
      WHERE tenant_id = ? AND status = ?
      ORDER BY
        CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
        created_at DESC
      LIMIT ?
    `).all(tenantId, status, limit);

    const items = rows.map(r => ({
      id: r.id,
      agent_id: r.agent_id,
      type: r.type,
      category: r.category,
      title: r.title,
      description: r.description,
      priority: r.priority,
      actions: r.actions_json ? JSON.parse(r.actions_json) : [],
      created_at: r.created_at,
    }));

    res.json({ items, count: items.length });
  } catch (err) {
    console.error('Insights fetch error:', err);
    res.json({ items: [], count: 0 });
  }
});

// POST /insights/:id/dismiss
router.post('/insights/:id/dismiss', (req, res) => {
  const { tenantId } = resolveIds(req);
  try {
    db.prepare('UPDATE agent_insights SET status = ? WHERE id = ? AND tenant_id = ?').run('dismissed', req.params.id, tenantId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /:id — get single item
// ---------------------------------------------------------------------------
router.get('/:id', (req, res) => {
  try {
    const { tenantId } = resolveIds(req);
    const item = db.prepare('SELECT * FROM approval_items WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId);

    if (!item) {
      return res.status(404).json({ error: 'Approval item not found' });
    }

    res.json(formatItem(item));
  } catch (error) {
    console.error('Approvals GET/:id error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// POST /:id/approve — approve item
// ---------------------------------------------------------------------------
router.post('/:id/approve', async (req, res) => {
  try {
    const { tenantId, userId } = resolveIds(req);
    const item = db.prepare('SELECT * FROM approval_items WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId);

    if (!item) {
      return res.status(404).json({ error: 'Approval item not found' });
    }
    if (item.status !== 'pending') {
      return res.status(400).json({ error: `Item already ${item.status}` });
    }

    db.prepare(`
      UPDATE approval_items SET status = 'approved', reviewed_by = ?, reviewed_at = datetime('now')
      WHERE id = ?
    `).run(userId, item.id);

    const updated = db.prepare('SELECT * FROM approval_items WHERE id = ?').get(item.id);

    // If this is an email_draft, send the email
    if (item.type === 'email_draft' && item.payload_json) {
      try {
        const payload = JSON.parse(item.payload_json);
        // Use demo_to (teo@zhan.capital) for demo, real 'to' in production
        const recipient = payload.demo_to || payload.to;
        if (payload.attachment) {
          await sendEstimateEmail({
            to: recipient,
            subject: payload.subject,
            body: payload.body,
            estimateFilename: payload.attachment,
          });
        } else {
          await sendEmail({
            to: recipient,
            subject: payload.subject,
            body: payload.body,
          });
        }
        console.log(`Approval ${item.id}: email sent to ${recipient}`);
      } catch (emailErr) {
        console.error(`Approval ${item.id}: email send failed:`, emailErr.message);
        // Don't fail the approval — email is best-effort
      }
    }

    res.json(formatItem(updated));
  } catch (error) {
    console.error('Approvals approve error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// POST /:id/reject — reject item
// ---------------------------------------------------------------------------
router.post('/:id/reject', (req, res) => {
  try {
    const { tenantId, userId } = resolveIds(req);
    const item = db.prepare('SELECT * FROM approval_items WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId);

    if (!item) {
      return res.status(404).json({ error: 'Approval item not found' });
    }
    if (item.status !== 'pending') {
      return res.status(400).json({ error: `Item already ${item.status}` });
    }

    db.prepare(`
      UPDATE approval_items SET status = 'rejected', reviewed_by = ?, reviewed_at = datetime('now')
      WHERE id = ?
    `).run(userId, item.id);

    const updated = db.prepare('SELECT * FROM approval_items WHERE id = ?').get(item.id);
    res.json(formatItem(updated));
  } catch (error) {
    console.error('Approvals reject error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// Format helper
// ---------------------------------------------------------------------------
function formatItem(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    agentId: row.agent_id,
    title: row.title,
    description: row.description,
    type: row.type,
    payload: row.payload_json ? JSON.parse(row.payload_json) : null,
    status: row.status,
    requiredRole: row.required_role,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Seed demo data on import
// ---------------------------------------------------------------------------
function seedDemoApprovals() {
  const seeds = [
    {
      tenant_id: 'default',
      items: [
        {
          agent_id: 'sangha',
          title: 'Weekly Executive Briefing ready',
          description: 'Auto-generated weekly briefing covering hashrate performance, energy costs, and market outlook for the past 7 days.',
          type: 'document',
          status: 'pending',
          payload_json: JSON.stringify({ reportType: 'weekly_briefing', period: '2026-02-24 to 2026-03-02', pages: 4 }),
        },
        {
          agent_id: 'curtailment',
          title: 'S19j Pro curtailment recommendation',
          description: 'ERCOT real-time prices projected above $85/MWh for the next 3 hours. Recommending curtailment of S19j Pro fleet (142 units) to reduce exposure.',
          type: 'curtailment',
          status: 'pending',
          payload_json: JSON.stringify({ machineModel: 'S19j Pro', unitCount: 142, projectedPrice: 85.40, durationHours: 3, estimatedSavings: 12400 }),
        },
        {
          agent_id: 'sangha',
          title: 'GridScale Partners — Term Sheet Draft',
          description: 'Draft email to GridScale Partners with proposed term sheet for 50 MW co-location agreement at the Midland facility.',
          type: 'email_draft',
          status: 'pending',
          payload_json: JSON.stringify({ to: 'deals@gridscalepartners.com', subject: 'Proposed Term Sheet — 50 MW Co-Location', facility: 'Midland, TX' }),
        },
      ],
    },
    {
      tenant_id: 'dacp-construction-001',
      items: [
        {
          agent_id: 'estimating',
          title: 'Turner Construction bid email draft',
          description: 'Outreach email to Turner Construction regarding the Frisco Station Phase 2 bid opportunity. Includes preliminary scope summary and proposed timeline.',
          type: 'email_draft',
          status: 'pending',
          payload_json: JSON.stringify({ to: 'bids@turnerconstruction.com', subject: 'Frisco Station Phase 2 — Bid Submission', projectValue: 4200000 }),
        },
        {
          agent_id: 'meetings',
          title: 'Frisco Station field report',
          description: 'Auto-generated field report from site visit on March 5. Covers foundation progress, material deliveries, and weather delays.',
          type: 'report',
          status: 'pending',
          payload_json: JSON.stringify({ project: 'Frisco Station', visitDate: '2026-03-05', completionPct: 34, issues: ['2-day weather delay', 'rebar delivery pending'] }),
        },
      ],
    },
  ];

  for (const group of seeds) {
    const existing = db.prepare('SELECT COUNT(*) as c FROM approval_items WHERE tenant_id = ?').get(group.tenant_id);
    if (existing.c === 0) {
      const insert = db.prepare(`
        INSERT INTO approval_items (tenant_id, agent_id, title, description, type, payload_json, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const item of group.items) {
        insert.run(group.tenant_id, item.agent_id, item.title, item.description, item.type, item.payload_json, item.status);
      }
      console.log(`Seeded ${group.items.length} approval items for tenant ${group.tenant_id}`);
    }
  }
}

// Run seed on import
try {
  seedDemoApprovals();
} catch (err) {
  // Table may not exist yet if initDatabase hasn't run — safe to ignore
  console.warn('Approval seed skipped:', err.message);
}

export default router;
