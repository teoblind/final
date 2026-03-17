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
import { authenticate } from '../middleware/auth.js';
import db from '../cache/database.js';
import { insertActivity } from '../cache/database.js';
import { sendEstimateEmail, sendEmail } from '../services/emailService.js';

const router = express.Router();

// All approval routes require authentication
router.use(authenticate);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveIds(req) {
  const tenantId = req.resolvedTenant?.id || 'default';
  const userId = req.user.id; // auth middleware guarantees req.user exists
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

    // Log to activity feed
    try {
      insertActivity({
        tenantId, type: item.type === 'email_draft' ? 'out' : 'alert',
        title: `Approved: ${item.title}`,
        subtitle: item.description?.slice(0, 100),
        detailJson: item.payload_json,
        sourceType: 'approval', sourceId: String(item.id), agentId: item.agent_id,
      });
    } catch (actErr) {
      console.error('Activity log error:', actErr.message);
    }

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
            tenantId,
          });
        } else {
          await sendEmail({
            to: recipient,
            subject: payload.subject,
            body: payload.body,
            tenantId,
          });
        }
        console.log(`Approval ${item.id}: email sent to ${recipient}`);
      } catch (emailErr) {
        console.error(`Approval ${item.id}: email send failed:`, emailErr.message);
        // Don't fail the approval — email is best-effort
      }
    }

    // If this is a tool_action (copilot mode), execute the tool now
    if ((item.type === 'tool_action' || item.type === 'meeting_instruction') && item.payload_json) {
      try {
        const payload = JSON.parse(item.payload_json);
        const { chat } = await import('../services/chatService.js');
        let prompt;

        if (item.type === 'meeting_instruction' && payload.instruction) {
          // Meeting instruction — re-send the full instruction prompt
          const instr = payload.instruction;
          prompt = `You are processing a post-meeting instruction that has been APPROVED by the user. During the meeting "${payload.meetingTitle}", someone directed you to do the following:

INSTRUCTION: ${instr.task}
CONTEXT: ${instr.context || ''}
REQUESTED BY: ${instr.requestedBy || 'a meeting participant'}
MEETING ATTENDEES: ${(payload.attendees || []).join(', ')}

MEETING SUMMARY:
${payload.summary || ''}

Execute this instruction now. This action has been explicitly approved.`;
        } else {
          // Tool action — re-invoke with tool parameters
          prompt = `The user has APPROVED your previous request to use the "${payload.toolName}" tool. Execute it now with exactly these parameters:\n\nTool: ${payload.toolName}\nInput: ${JSON.stringify(payload.toolInput, null, 2)}\n\nProceed immediately — this action has been explicitly approved.`;
        }

        const result = await chat(
          payload.tenantId || tenantId,
          payload.agentId || item.agent_id,
          payload.userId || userId,
          prompt,
        );

        console.log(`Approval ${item.id}: ${item.type} executed`);

        insertActivity({
          tenantId,
          type: 'out',
          title: `Executed: ${item.title}`,
          subtitle: result.response?.slice(0, 100),
          detailJson: JSON.stringify({ type: item.type, response: result.response?.slice(0, 2000) }),
          sourceType: 'approval', sourceId: String(item.id), agentId: item.agent_id,
        });
      } catch (toolErr) {
        console.error(`Approval ${item.id}: ${item.type} execution failed:`, toolErr.message);
        insertActivity({
          tenantId,
          type: 'alert',
          title: `Failed to execute: ${item.title}`,
          subtitle: toolErr.message,
          detailJson: item.payload_json,
          sourceType: 'approval', sourceId: String(item.id), agentId: item.agent_id,
        });
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

    try {
      insertActivity({
        tenantId, type: 'alert',
        title: `Rejected: ${item.title}`,
        subtitle: item.description?.slice(0, 100),
        sourceType: 'approval', sourceId: String(item.id), agentId: item.agent_id,
      });
    } catch (actErr) {
      console.error('Activity log error:', actErr.message);
    }

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
  // Clear stale pending items for default tenant so we always get fresh seed data
  db.prepare("DELETE FROM approval_items WHERE tenant_id = 'default' AND status = 'pending'").run();

  const sanghaItems = [
    {
      agent_id: 'outreach',
      title: 'Outreach draft: Sarah Chen — Meridian Renewables',
      description: 'Personalized cold email referencing behind-the-meter mining opportunity at their Crane County solar site.',
      type: 'email_draft',
      payload_json: JSON.stringify({
        demo_to: 'teo@zhan.capital',
        to: 'sarah.chen@meridianrenewables.com',
        subject: 'Behind-the-meter mining at Crane County',
        body: `Hi Sarah,\n\nI noticed Meridian's 120 MW solar farm in Crane County is averaging 34% curtailment during off-peak hours. We've been helping operators like you convert that wasted energy into Bitcoin mining revenue — without any capex.\n\nOur co-location model at a similar ERCOT site generated $18K/month in incremental revenue last quarter while the panels were curtailed.\n\nWould you have 15 minutes this week to discuss how this could work at Crane County?\n\nBest,\nCoppice`,
      }),
    },
    {
      agent_id: 'outreach',
      title: 'Follow-up draft: Mark Liu — GridScale Partners',
      description: '5 days since initial outreach — gentle check-in with updated hashrate economics attached.',
      type: 'email_draft',
      payload_json: JSON.stringify({
        demo_to: 'teo@zhan.capital',
        to: 'mark.liu@gridscalepartners.com',
        subject: 'Re: Co-location opportunity — updated economics',
        body: `Hi Mark,\n\nFollowing up on my note last week about co-locating miners at your West Texas facilities. Since then, network difficulty dropped 3.2% which improves unit economics meaningfully.\n\nAt current BTC prices and your $0.038/kWh rate, we're projecting $0.12/kWh effective revenue — a 3.2x spread.\n\nHappy to walk through the model if you have 15 minutes.\n\nBest,\nCoppice`,
      }),
    },
    {
      agent_id: 'reporting',
      title: 'Weekly briefing ready for review',
      description: 'Week 10 operations report — revenue, curtailment savings, pipeline summary.',
      type: 'report',
      payload_json: JSON.stringify({
        reportType: 'weekly_briefing',
        period: '2026-03-03 to 2026-03-09',
        sections: ['Revenue Summary', 'Curtailment Events', 'Pipeline Update', 'Action Items'],
      }),
    },
    {
      agent_id: 'curtailment',
      title: 'Curtailment recommendation: Pecos County',
      description: 'ERCOT price forecast shows $92/MWh window 14:00–16:30 — recommends pre-curtailment at 13:45.',
      type: 'curtailment',
      payload_json: JSON.stringify({
        site: 'Pecos County',
        projectedPrice: 92.0,
        window: '14:00–16:30',
        recommendedAction: 'Pre-curtail at 13:45',
        estimatedSavings: 4850,
      }),
    },
    {
      agent_id: 'meetings',
      title: 'Post-meeting summary: Reassurity strategy call',
      description: 'Recap email for the Reassurity product strategy call — 4 action items, 2 assigned to you.',
      type: 'email_draft',
      payload_json: JSON.stringify({
        demo_to: 'teo@zhan.capital',
        to: 'team@sanghasystems.com',
        subject: 'Reassurity Strategy Call — Summary & Action Items',
        body: `Hi team,\n\nQuick recap from today's Reassurity call:\n\n1. Insurance product MVP scope confirmed — parametric trigger on ERCOT node prices\n2. Spencer to send Hanwha KMZ files to Kishan by EOD Wednesday\n3. Teo to draft the energy pricing assumptions for section 4.2 of the deal memo\n4. Next check-in scheduled for March 14\n\nLet me know if I missed anything.\n\nBest,\nCoppice`,
      }),
    },
  ];

  const insert = db.prepare(`
    INSERT INTO approval_items (tenant_id, agent_id, title, description, type, payload_json, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
  `);
  for (const item of sanghaItems) {
    insert.run('default', item.agent_id, item.title, item.description, item.type, item.payload_json);
  }
  console.log(`Seeded ${sanghaItems.length} approval items for tenant default`);

  // DACP seeds (only if none exist)
  const dacpCount = db.prepare("SELECT COUNT(*) as c FROM approval_items WHERE tenant_id = 'dacp-construction-001'").get();
  if (dacpCount.c === 0) {
    const dacpItems = [
      {
        agent_id: 'estimating',
        title: 'Turner Construction bid email draft',
        description: 'Outreach email to Turner Construction regarding the Frisco Station Phase 2 bid opportunity.',
        type: 'email_draft',
        payload_json: JSON.stringify({ to: 'bids@turnerconstruction.com', subject: 'Frisco Station Phase 2 — Bid Submission', body: 'Hi,\n\nPlease find attached our bid for Frisco Station Phase 2.\n\nBest,\nDACP Construction', projectValue: 4200000 }),
      },
      {
        agent_id: 'meetings',
        title: 'Frisco Station field report',
        description: 'Auto-generated field report from site visit on March 5.',
        type: 'report',
        payload_json: JSON.stringify({ project: 'Frisco Station', visitDate: '2026-03-05', completionPct: 34, issues: ['2-day weather delay', 'rebar delivery pending'] }),
      },
    ];
    for (const item of dacpItems) {
      insert.run('dacp-construction-001', item.agent_id, item.title, item.description, item.type, item.payload_json);
    }
    console.log('Seeded 2 approval items for tenant dacp-construction-001');
  }
}

// ---------------------------------------------------------------------------
// Seed agent insights
// ---------------------------------------------------------------------------
function seedDemoInsights() {
  const existing = db.prepare("SELECT COUNT(*) as c FROM agent_insights WHERE tenant_id = 'default'").get();
  if (existing.c > 0) return;

  const insights = [
    {
      id: 'ins-001',
      agent_id: 'pool',
      type: 'Recommendation',
      category: 'cost_optimization',
      title: 'Foundry fee increase detected',
      description: 'Foundry raised fees from <b>2.0% to 2.5%</b> effective next block. Switching 15 PH/s to <b>Luxor (1.8%)</b> would save ~$340/month.',
      priority: 'high',
      actions_json: JSON.stringify(['Switch Now', 'Dismiss']),
    },
    {
      id: 'ins-002',
      agent_id: 'outreach',
      type: 'Pattern',
      category: 'outreach_performance',
      title: 'Outreach reply rate trending up',
      description: 'Reply rate increased from <b>5.1% to 7.3%</b> after switching to ERCOT-data-personalized templates. Recommend expanding to all PJM leads.',
      priority: 'medium',
      actions_json: JSON.stringify(['Apply to PJM', 'Dismiss']),
    },
    {
      id: 'ins-003',
      agent_id: 'curtailment',
      type: 'Analysis',
      category: 'revenue',
      title: 'Curtailment revenue opportunity',
      description: 'Yesterday\'s curtailment at Crane County netted <b>$1,247</b> in 45 minutes. Pattern suggests <b>3–4 similar windows</b> this week.',
      priority: 'medium',
      actions_json: JSON.stringify(['View Forecast']),
    },
    {
      id: 'ins-004',
      agent_id: 'meetings',
      type: 'Follow-up',
      category: 'action_items',
      title: 'Overdue action item: Oberon deal memo',
      description: 'Action item from March 3 call: "<b>Revise energy pricing assumptions in section 4.2</b>" — assigned to you, 4 days overdue.',
      priority: 'high',
      actions_json: JSON.stringify(['Mark Done', 'Snooze']),
    },
    {
      id: 'ins-005',
      agent_id: 'hivemind',
      type: 'Question',
      category: 'knowledge',
      title: 'PPA pricing question from operator',
      description: 'Operator asked: "What\'s the break-even electricity price for our S19 fleet?" Answer computed: <b>$0.068/kWh</b> at current difficulty.',
      priority: 'low',
      actions_json: JSON.stringify(['View Thread']),
    },
  ];

  const insertInsight = db.prepare(`
    INSERT INTO agent_insights (id, tenant_id, agent_id, type, category, title, description, priority, actions_json, status)
    VALUES (?, 'default', ?, ?, ?, ?, ?, ?, ?, 'active')
  `);
  for (const i of insights) {
    insertInsight.run(i.id, i.agent_id, i.type, i.category, i.title, i.description, i.priority, i.actions_json);
  }
  console.log(`Seeded ${insights.length} agent insights for tenant default`);
}

// Run seeds on import
try {
  seedDemoApprovals();
  seedDemoInsights();
} catch (err) {
  // Table may not exist yet if initDatabase hasn't run — safe to ignore
  console.warn('Approval/insight seed skipped:', err.message);
}

export default router;
