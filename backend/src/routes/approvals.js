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
import { insertActivity, setTenantContext } from '../cache/database.js';
import { sendEstimateEmail, sendEmail, sendEmailWithAttachments } from '../services/emailService.js';

const router = express.Router();

// All approval routes require authentication
router.use(authenticate);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveIds(req) {
  const tenantId = req.tenantId || req.resolvedTenant?.id || 'default';
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

    const validTypes = ['email_draft', 'curtailment', 'estimate', 'report', 'config_change', 'document', 'tool_action', 'meeting_instruction'];
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
// GET /:id/attachment/:index — preview attachment content (Excel → JSON)
// ---------------------------------------------------------------------------
router.get('/:id/attachment/:index', async (req, res) => {
  try {
    const { tenantId } = resolveIds(req);
    const item = db.prepare('SELECT * FROM approval_items WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId);
    if (!item) return res.status(404).json({ error: 'Approval item not found' });

    const payload = item.payload_json ? JSON.parse(item.payload_json) : {};
    const attachments = payload.attachments || [];
    const idx = parseInt(req.params.index);
    if (idx < 0 || idx >= attachments.length) return res.status(404).json({ error: 'Attachment not found' });

    const att = attachments[idx];
    const filePath = att.path;
    if (!filePath) return res.status(404).json({ error: 'No file path for attachment' });

    const fs = await import('fs');
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found on disk' });

    // Parse Excel with exceljs
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const sheets = [];
    workbook.eachSheet((worksheet) => {
      const rows = [];
      worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        const cells = [];
        row.eachCell({ includeEmpty: true }, (cell) => {
          cells.push(cell.text || cell.value?.toString() || '');
        });
        rows.push(cells);
      });
      sheets.push({ name: worksheet.name, rows });
    });

    res.json({ filename: att.filename || att.name, sheets });
  } catch (error) {
    console.error('Attachment preview error:', error);
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
        const recipient = payload.demo_to || payload.to;

        if (payload.attachments && payload.html) {
          // Estimate pipeline format — HTML body + file attachments
          await sendEmailWithAttachments({
            to: recipient,
            subject: payload.subject,
            html: payload.html,
            attachments: payload.attachments,
            tenantId: payload.tenantId || tenantId,
            threadId: payload.threadId,
            inReplyTo: payload.inReplyTo,
            references: payload.references,
          });
          // Update bid request status from 'draft' to 'estimated'
          if (payload.bidId && !payload.awardConfirmation) {
            const { updateDacpBidRequest } = await import('../cache/database.js');
            updateDacpBidRequest(payload.tenantId || tenantId, payload.bidId, { status: 'estimated' });
          }
          // If this is an award confirmation, activate the job
          if (payload.jobId) {
            const { updateDacpJob } = await import('../cache/database.js');
            updateDacpJob(payload.tenantId || tenantId, payload.jobId, { status: 'active' });
          }
        } else if (payload.attachment) {
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

  // DACP seeds (only if none exist) — must run inside DACP tenant context
  // so the db proxy routes to the correct SQLite file
  setTenantContext('dacp-construction-001', () => {
  const dacpCount = db.prepare("SELECT COUNT(*) as c FROM approval_items WHERE tenant_id = 'dacp-construction-001'").get();
  if (dacpCount.c === 0) {
    const dacpItems = [
      {
        agent_id: 'estimating',
        title: 'Send estimate reply to Turner Construction: $595,000',
        description: 'Reply to "RFQ: Parking Garage Foundation — Frisco Station Phase 2" with estimate EST-20260312 ($595,000) + Excel attachment',
        type: 'email_draft',
        payload_json: JSON.stringify({
          to: 'bids@turnerconstruction.com',
          subject: 'Re: RFQ: Parking Garage Foundation — Frisco Station Phase 2',
          body: 'Hey Mike,\n\nThanks for sending over the Frisco Station Phase 2 parking garage foundation package. We reviewed the drawings and specs — here\'s our number.\n\nTotal Bid: $595,000\n\nBreakdown attached as an Excel file. Includes mobilization, concrete foundations, rebar, formwork, and backfill. We excluded dewatering and any structural steel above grade.\n\nA few things we noticed:\n- The geotech report shows high water table at 8\' — might need dewatering depending on your schedule\n- Specs call for 5000 PSI concrete but the structural drawings note 4000 PSI in a couple spots — which one governs?\n\nWhen are you looking to start? We could mobilize within 2 weeks of NTP.\n\nMarcel\nDACP Construction',
          html: '<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;line-height:1.6"><p>Hey Mike,</p><p>Thanks for sending over the Frisco Station Phase 2 parking garage foundation package. We reviewed the drawings and specs — here\'s our number.</p><p><strong>Total Bid: $595,000</strong></p><p>Breakdown attached as an Excel file. Includes mobilization, concrete foundations, rebar, formwork, and backfill. We excluded dewatering and any structural steel above grade.</p><p>A few things we noticed:</p><ul><li>The geotech report shows high water table at 8\' — might need dewatering depending on your schedule</li><li>Specs call for 5000 PSI concrete but the structural drawings note 4000 PSI in a couple spots — which one governs?</li></ul><p>When are you looking to start? We could mobilize within 2 weeks of NTP.</p><p>Marcel<br/>DACP Construction</p></div>',
          attachments: [{ filename: 'DACP_Estimate_EST-20260312_Parking_Garage_Foundation.xlsx', path: '', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }],
          estimateId: 'EST-20260312',
          bidId: 'BID-FRISCO-001',
          totalBid: 595000,
        }),
      },
      {
        agent_id: 'estimating',
        title: 'Send estimate reply to Hensel Phelps: $1,250,000',
        description: 'Reply to "RFQ: Site Work & Utilities — Legacy West Phase 3" with estimate EST-20260315 ($1,250,000) + Excel attachment',
        type: 'email_draft',
        payload_json: JSON.stringify({
          to: 'preconstruction@henselphelps.com',
          subject: 'Re: RFQ: Site Work & Utilities — Legacy West Phase 3',
          body: 'Hey Rachel,\n\nAppreciate you including us on Legacy West Phase 3. We went through the civil drawings and utility plans — here\'s where we landed.\n\nTotal Bid: $1,250,000\n\nCovers earthwork, storm drainage, water/sewer, paving, and site concrete. Excel breakdown attached. We excluded any landscaping and irrigation.\n\nOne question — the civil plans show a 24" storm line crossing the existing water main at Station 4+50. Has that conflict been resolved or should we carry a contingency for rerouting?\n\nHappy to walk through the numbers if helpful.\n\nMarcel\nDACP Construction',
          html: '<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;line-height:1.6"><p>Hey Rachel,</p><p>Appreciate you including us on Legacy West Phase 3. We went through the civil drawings and utility plans — here\'s where we landed.</p><p><strong>Total Bid: $1,250,000</strong></p><p>Covers earthwork, storm drainage, water/sewer, paving, and site concrete. Excel breakdown attached. We excluded any landscaping and irrigation.</p><p>One question — the civil plans show a 24" storm line crossing the existing water main at Station 4+50. Has that conflict been resolved or should we carry a contingency for rerouting?</p><p>Happy to walk through the numbers if helpful.</p><p>Marcel<br/>DACP Construction</p></div>',
          attachments: [{ filename: 'DACP_Estimate_EST-20260315_Site_Work_Utilities.xlsx', path: '', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }],
          estimateId: 'EST-20260315',
          bidId: 'BID-LEGACY-001',
          totalBid: 1250000,
        }),
      },
    ];
    const dacpInsert = db.prepare(`
      INSERT INTO approval_items (tenant_id, agent_id, title, description, type, payload_json, status)
      VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `);
    for (const item of dacpItems) {
      dacpInsert.run('dacp-construction-001', item.agent_id, item.title, item.description, item.type, item.payload_json);
    }
    console.log('Seeded 2 approval items for tenant dacp-construction-001');
  }
  }); // end setTenantContext
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

/**
 * POST /:id/update-draft — Update the email body of a pending approval
 */
router.post('/:id/update-draft', async (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || 'default';
    const { id } = req.params;
    const { body } = req.body;
    if (!body) return res.status(400).json({ error: 'body is required' });

    const { getApprovalItem, updateApprovalPayload } = await import('../cache/database.js');
    const { markdownToEmailHtml } = await import('../services/emailService.js');
    const item = getApprovalItem(tenantId, parseInt(id));
    if (!item) return res.status(404).json({ error: 'Not found' });
    if (item.status !== 'pending') return res.status(400).json({ error: 'Already processed' });

    const payload = JSON.parse(item.payload_json || '{}');
    payload.body = body;
    payload.html = markdownToEmailHtml(body);

    updateApprovalPayload(tenantId, parseInt(id), JSON.stringify(payload));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /:id/rewrite — Rewrite the email body for a different sender
 */
router.post('/:id/rewrite', async (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || 'default';
    const { id } = req.params;
    const { senderName, currentBody } = req.body;
    if (!senderName || !currentBody) return res.status(400).json({ error: 'senderName and currentBody required' });

    const { chat } = await import('../services/chatService.js');
    const isCoppice = senderName === 'Coppice';
    const prompt = isCoppice
      ? `Remove any personal sign-off or signature from this email (like "Best regards, [Name]" or "Sincerely, [Name]"). The email system will automatically append the correct Coppice signature. Keep the same content, tone, and structure — just remove the closing name/signature. Return ONLY the email body, no explanation.\n\nCurrent email:\n---\n${currentBody}\n---`
      : `Rewrite this email so it is signed by ${senderName} instead of whoever currently signs it. Keep the same content, tone, and structure — only change the signature/sign-off and any first-person references to match ${senderName}. Return ONLY the rewritten email body, no explanation.\n\nCurrent email:\n---\n${currentBody}\n---`;
    const result = await chat(tenantId, 'estimating', 'system', prompt, null, { helpMode: false });

    const { markdownToEmailHtml } = await import('../services/emailService.js');
    const newBody = result.response || currentBody;
    const { getApprovalItem, updateApprovalPayload } = await import('../cache/database.js');
    const item = getApprovalItem(tenantId, parseInt(id));
    if (item && item.status === 'pending') {
      const payload = JSON.parse(item.payload_json || '{}');
      payload.body = newBody;
      payload.html = markdownToEmailHtml(newBody);
      updateApprovalPayload(tenantId, parseInt(id), JSON.stringify(payload));
    }

    res.json({ body: newBody });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Run seeds on import
try {
  seedDemoApprovals();
  // seedDemoInsights(); — removed, was fake demo data
} catch (err) {
  // Table may not exist yet if initDatabase hasn't run — safe to ignore
  console.warn('Approval/insight seed skipped:', err.message);
}

export default router;
