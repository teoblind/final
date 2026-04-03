/**
 * Approval Queue Routes
 *
 * GET    /api/v1/approvals        - List approval items (query: status, limit)
 * POST   /api/v1/approvals        - Create new approval item
 * GET    /api/v1/approvals/:id    - Get single approval item
 * POST   /api/v1/approvals/:id/approve - Approve item
 * POST   /api/v1/approvals/:id/reject  - Reject item
 */

import express from 'express';
import { authenticate } from '../middleware/auth.js';
import db from '../cache/database.js';
import { insertActivity, setTenantContext, getAllTenantEmailConfigs, getTenantEmailConfig, SANGHA_TENANT_ID } from '../cache/database.js';
import { sendEstimateEmail, sendEmail, sendEmailWithAttachments } from '../services/emailService.js';

const router = express.Router();

// All approval routes require authentication
router.use(authenticate);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findFileRecursive(fs, path, dir, filename, depth = 0) {
  if (depth > 3 || !fs.existsSync(dir)) return null;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name === filename) return path.join(dir, entry.name);
      if (entry.isDirectory() && depth < 3) {
        const found = findFileRecursive(fs, path, path.join(dir, entry.name), filename, depth + 1);
        if (found) return found;
      }
    }
  } catch {}
  return null;
}

function resolveIds(req) {
  const tenantId = req.tenantId || req.resolvedTenant?.id || SANGHA_TENANT_ID;
  const userId = req.user.id; // auth middleware guarantees req.user exists
  return { tenantId, userId };
}

// ---------------------------------------------------------------------------
// GET /senders - list available sender email accounts
// ---------------------------------------------------------------------------
router.get('/senders', async (req, res) => {
  try {
    const { tenantId } = resolveIds(req);
    const allConfigs = getAllTenantEmailConfigs();
    // Current tenant's config first, then others
    const current = getTenantEmailConfig(tenantId);
    const seen = new Set();
    const senders = [];
    if (current) {
      senders.push({ email: current.senderEmail, name: current.senderName, current: true });
      seen.add(current.senderEmail);
    }
    // Check key vault for user's personal OAuth email (stored during setup wizard)
    try {
      const { getKeyVaultValue, upsertKeyVaultEntry } = await import('../cache/database.js');
      // getKeyVaultValue handles decryption and checks both main + tenant DB
      let personalEmail = getKeyVaultValue(tenantId, 'google-gmail-user', 'email');
      // If no stored email, discover it from the personal OAuth token at runtime
      if (!personalEmail) {
        try {
          // Use google-gmail-user token (personal), NOT google-gmail (agent)
          const refreshToken = getKeyVaultValue(tenantId, 'google-gmail-user', 'refresh_token');
          if (refreshToken) {
            const clients = [
              { id: process.env.GMAIL_CLIENT_ID, secret: process.env.GMAIL_CLIENT_SECRET },
              { id: process.env.GOOGLE_OAUTH_CLIENT_ID, secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET },
            ].filter(c => c.id && c.secret);
            for (const client of clients) {
              try {
                const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                  body: new URLSearchParams({
                    client_id: client.id, client_secret: client.secret,
                    refresh_token: refreshToken, grant_type: 'refresh_token',
                  }),
                });
                const tokens = await tokenResp.json();
                if (!tokens.access_token) continue;
                const userResp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                  headers: { Authorization: `Bearer ${tokens.access_token}` },
                });
                const userInfo = await userResp.json();
                if (userInfo.email) {
                  personalEmail = userInfo.email;
                  // Cache it so we don't call Google every time
                  setTenantContext(tenantId, () => {
                    upsertKeyVaultEntry({
                      tenantId, service: 'google-gmail-user',
                      keyName: 'email', keyValue: personalEmail,
                      addedBy: `oauth:${personalEmail}`,
                    });
                  });
                  console.log(`[Senders] Discovered and cached personal email for ${tenantId}: ${personalEmail}`);
                  break;
                }
              } catch {}
            }
          }
        } catch (e) {
          console.error('[Senders] Email discovery error:', e.message);
        }
      }
      if (personalEmail && !seen.has(personalEmail)) {
        const name = personalEmail.split('@')[0].split('.').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        senders.push({ email: personalEmail, name, current: false, personal: true });
        seen.add(personalEmail);
      }
    } catch {}
    for (const c of allConfigs) {
      if (!seen.has(c.senderEmail)) {
        senders.push({ email: c.senderEmail, name: c.senderName, current: false });
        seen.add(c.senderEmail);
      }
    }
    res.json({ senders });
  } catch (error) {
    console.error('Senders GET error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// GET / - list approval items
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
// POST / - create new approval item
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
// GET /insights - list agent insights for Command dashboard
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
// GET /:id - get single item
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
// GET /:id/attachment/:index - preview attachment content (Excel → JSON)
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
    const fs = await import('fs');
    const path = await import('path');

    // Resolve the file - try the stored path first, then search by filename in estimates dir
    let filePath = att.path;
    if (!filePath || !fs.existsSync(filePath)) {
      const { fileURLToPath } = await import('url');
      const routeDir = path.dirname(fileURLToPath(import.meta.url));
      const estimatesDir = path.join(routeDir, '../../data/estimates');
      const fname = att.filename || att.name || '';
      if (fname && fs.existsSync(estimatesDir)) {
        const candidate = path.join(estimatesDir, fname);
        if (fs.existsSync(candidate)) {
          filePath = candidate;
        } else {
          // Search recursively in data directory
          const dataDir = path.join(routeDir, '../../data');
          const found = findFileRecursive(fs, path, dataDir, fname);
          if (found) filePath = found;
        }
      }
    }

    // If file still not found, try to regenerate from estimate data
    if (!filePath || !fs.existsSync(filePath)) {
      if (payload.estimateId) {
        try {
          // First try loading from DB
          const { getDacpEstimate } = await import('../cache/database.js');
          const estimate = getDacpEstimate(tenantId, payload.estimateId);
          if (estimate) {
            const { generateEstimateExcelFromData } = await import('../services/estimatePipeline.js');
            const result = await generateEstimateExcelFromData(estimate);
            filePath = result.filepath;
          }
        } catch (genErr) {
          console.error('Failed to regenerate estimate Excel from DB:', genErr.message);
        }
      }
    }

    // Last resort: generate a summary Excel from the payload data itself
    if (!filePath || !fs.existsSync(filePath)) {
      if (att.contentType?.includes('spreadsheet') || att.filename?.endsWith('.xlsx')) {
        try {
          const ExcelJS = (await import('exceljs')).default;
          const { fileURLToPath: ftu } = await import('url');
          const routeDir2 = path.dirname(ftu(import.meta.url));
          const estDir = path.join(routeDir2, '../../data/estimates');
          if (!fs.existsSync(estDir)) fs.mkdirSync(estDir, { recursive: true });

          const wb = new ExcelJS.Workbook();
          wb.creator = 'Coppice AI';
          const ws = wb.addWorksheet('Estimate Summary');
          const hFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
          const hFont = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };

          ws.columns = [
            { header: 'Field', key: 'field', width: 25 },
            { header: 'Value', key: 'value', width: 45 },
          ];
          const hr = ws.getRow(1);
          hr.getCell(1).fill = hFill; hr.getCell(1).font = hFont;
          hr.getCell(2).fill = hFill; hr.getCell(2).font = hFont;

          const rows = [
            ['Estimate ID', payload.estimateId || 'N/A'],
            ['Bid ID', payload.bidId || 'N/A'],
            ['To', payload.to || ''],
            ['Subject', payload.subject || ''],
            ['Total Bid', payload.totalBid ? `$${Number(payload.totalBid).toLocaleString()}` : 'N/A'],
          ];
          for (const [f, v] of rows) ws.addRow({ field: f, value: v });

          const outPath = path.join(estDir, att.filename || `estimate_${payload.estimateId || 'unknown'}.xlsx`);
          await wb.xlsx.writeFile(outPath);
          filePath = outPath;
        } catch (fallbackErr) {
          console.error('Failed to generate fallback Excel:', fallbackErr.message);
        }
      }
    }

    if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found on disk' });

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
// POST /:id/approve - approve item
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
          // Estimate pipeline format - HTML body + file attachments
          await sendEmailWithAttachments({
            to: recipient,
            subject: payload.subject,
            html: payload.html,
            attachments: payload.attachments,
            tenantId: payload.tenantId || tenantId,
            threadId: payload.threadId,
            inReplyTo: payload.inReplyTo,
            references: payload.references,
            senderEmail: payload.senderEmail,
            senderName: payload.senderName,
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
            tenantId: payload.tenantId || tenantId,
            threadId: payload.threadId,
            inReplyTo: payload.inReplyTo,
            references: payload.references,
            senderEmail: payload.senderEmail,
            senderName: payload.senderName,
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
          // Meeting instruction - re-send the full instruction prompt
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
          // Tool action - re-invoke with tool parameters
          prompt = `The user has APPROVED your previous request to use the "${payload.toolName}" tool. Execute it now with exactly these parameters:\n\nTool: ${payload.toolName}\nInput: ${JSON.stringify(payload.toolInput, null, 2)}\n\nProceed immediately - this action has been explicitly approved.`;
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

    // If this is an inbox_ingest (user inbox email approved for knowledge ingestion)
    if (item.type === 'inbox_ingest' && item.payload_json) {
      try {
        const payload = JSON.parse(item.payload_json);
        const { getTenantDb } = await import('../cache/database.js');
        const { processKnowledgeEntry } = await import('../services/knowledgeProcessor.js');
        const tdb = getTenantDb(tenantId);

        // Create knowledge entry from the email data
        const knId = `KN-uinbox-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const knContent = JSON.stringify({
          from: payload.from,
          fromName: payload.fromName,
          to: payload.to,
          subject: payload.subject,
          date: payload.date,
          body: (payload.body || '').slice(0, 10000),
          threadId: payload.threadId,
          messageId: payload.messageId,
        });

        tdb.prepare(`INSERT OR IGNORE INTO knowledge_entries (id, tenant_id, type, title, content, source, source_agent, recorded_at)
          VALUES (?, ?, 'email-observation', ?, ?, ?, 'user-inbox-poll', datetime('now'))`)
          .run(knId, tenantId, `${payload.subject} (from ${payload.fromName || payload.from})`, knContent, `user-inbox:${payload.from}`);

        // Process knowledge entry async (extract entities, summaries)
        processKnowledgeEntry(knId, tenantId).catch(err => {
          console.warn(`[Approvals] Knowledge processing failed for ${knId}: ${err.message}`);
        });

        // Update user_inbox_processed status to 'ingested'
        try {
          tdb.prepare(`UPDATE user_inbox_processed SET status = 'ingested', knowledge_entry_id = ? WHERE message_id = ? AND tenant_id = ?`)
            .run(knId, payload.messageId, tenantId);
        } catch (uipErr) {
          console.warn(`[Approvals] user_inbox_processed update failed: ${uipErr.message}`);
        }

        console.log(`Approval ${item.id}: inbox email ingested as ${knId}`);
      } catch (ingestErr) {
        console.error(`Approval ${item.id}: inbox ingest failed:`, ingestErr.message);
      }
    }

    res.json(formatItem(updated));
  } catch (error) {
    console.error('Approvals approve error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// POST /:id/reject - reject item
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
  db.prepare("DELETE FROM approval_items WHERE tenant_id = ? AND status = 'pending'").run(SANGHA_TENANT_ID);

  const sanghaItems = [
    {
      agent_id: 'outreach',
      title: 'Outreach draft: Sarah Chen - Meridian Renewables',
      description: 'Personalized cold email referencing behind-the-meter mining opportunity at their Crane County solar site.',
      type: 'email_draft',
      payload_json: JSON.stringify({
        demo_to: 'teo@zhan.capital',
        to: 'sarah.chen@meridianrenewables.com',
        subject: 'Behind-the-meter mining at Crane County',
        body: `Hi Sarah,\n\nI noticed Meridian's 120 MW solar farm in Crane County is averaging 34% curtailment during off-peak hours. We've been helping operators like you convert that wasted energy into Bitcoin mining revenue - without any capex.\n\nOur co-location model at a similar ERCOT site generated $18K/month in incremental revenue last quarter while the panels were curtailed.\n\nWould you have 15 minutes this week to discuss how this could work at Crane County?\n\nBest,\nCoppice`,
      }),
    },
    {
      agent_id: 'outreach',
      title: 'Follow-up draft: Mark Liu - GridScale Partners',
      description: '5 days since initial outreach - gentle check-in with updated hashrate economics attached.',
      type: 'email_draft',
      payload_json: JSON.stringify({
        demo_to: 'teo@zhan.capital',
        to: 'mark.liu@gridscalepartners.com',
        subject: 'Re: Co-location opportunity - updated economics',
        body: `Hi Mark,\n\nFollowing up on my note last week about co-locating miners at your West Texas facilities. Since then, network difficulty dropped 3.2% which improves unit economics meaningfully.\n\nAt current BTC prices and your $0.038/kWh rate, we're projecting $0.12/kWh effective revenue - a 3.2x spread.\n\nHappy to walk through the model if you have 15 minutes.\n\nBest,\nCoppice`,
      }),
    },
    {
      agent_id: 'reporting',
      title: 'Weekly briefing ready for review',
      description: 'Week 10 operations report - revenue, curtailment savings, pipeline summary.',
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
      description: 'ERCOT price forecast shows $92/MWh window 14:00–16:30 - recommends pre-curtailment at 13:45.',
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
      description: 'Recap email for the Reassurity product strategy call - 4 action items, 2 assigned to you.',
      type: 'email_draft',
      payload_json: JSON.stringify({
        demo_to: 'teo@zhan.capital',
        to: 'team@sanghasystems.com',
        subject: 'Reassurity Strategy Call - Summary & Action Items',
        body: `Hi team,\n\nQuick recap from today's Reassurity call:\n\n1. Insurance product MVP scope confirmed - parametric trigger on ERCOT node prices\n2. Spencer to send Hanwha KMZ files to Kishan by EOD Wednesday\n3. Teo to draft the energy pricing assumptions for section 4.2 of the deal memo\n4. Next check-in scheduled for March 14\n\nLet me know if I missed anything.\n\nBest,\nCoppice`,
      }),
    },
  ];

  const insert = db.prepare(`
    INSERT INTO approval_items (tenant_id, agent_id, title, description, type, payload_json, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
  `);
  for (const item of sanghaItems) {
    insert.run(SANGHA_TENANT_ID, item.agent_id, item.title, item.description, item.type, item.payload_json);
  }
  console.log(`Seeded ${sanghaItems.length} approval items for tenant ${SANGHA_TENANT_ID}`);

  // DACP seeds (only if none exist) - must run inside DACP tenant context
  // so the db proxy routes to the correct SQLite file
  setTenantContext('dacp-construction-001', () => {
  const dacpCount = db.prepare("SELECT COUNT(*) as c FROM approval_items WHERE tenant_id = 'dacp-construction-001'").get();
  if (dacpCount.c === 0) {
    const dacpItems = [
      {
        agent_id: 'estimating',
        title: 'Send estimate reply to Turner Construction: $595,000',
        description: 'Reply to "RFQ: Parking Garage Foundation - Frisco Station Phase 2" with estimate EST-20260312 ($595,000) + Excel attachment',
        type: 'email_draft',
        payload_json: JSON.stringify({
          to: 'bids@turnerconstruction.com',
          subject: 'Re: RFQ: Parking Garage Foundation - Frisco Station Phase 2',
          body: 'Hey Mike,\n\nThanks for sending over the Frisco Station Phase 2 parking garage foundation package. We reviewed the drawings and specs - here\'s our number.\n\nTotal Bid: $595,000\n\nBreakdown attached as an Excel file. Includes mobilization, concrete foundations, rebar, formwork, and backfill. We excluded dewatering and any structural steel above grade.\n\nA few things we noticed:\n- The geotech report shows high water table at 8\' - might need dewatering depending on your schedule\n- Specs call for 5000 PSI concrete but the structural drawings note 4000 PSI in a couple spots - which one governs?\n\nWhen are you looking to start? We could mobilize within 2 weeks of NTP.\n\nMarcel\nDACP Construction',
          html: '<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;line-height:1.6"><p>Hey Mike,</p><p>Thanks for sending over the Frisco Station Phase 2 parking garage foundation package. We reviewed the drawings and specs - here\'s our number.</p><p><strong>Total Bid: $595,000</strong></p><p>Breakdown attached as an Excel file. Includes mobilization, concrete foundations, rebar, formwork, and backfill. We excluded dewatering and any structural steel above grade.</p><p>A few things we noticed:</p><ul><li>The geotech report shows high water table at 8\' - might need dewatering depending on your schedule</li><li>Specs call for 5000 PSI concrete but the structural drawings note 4000 PSI in a couple spots - which one governs?</li></ul><p>When are you looking to start? We could mobilize within 2 weeks of NTP.</p><p>Marcel<br/>DACP Construction</p></div>',
          attachments: [{ filename: 'DACP_Estimate_EST-20260312_Parking_Garage_Foundation.xlsx', path: '', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }],
          estimateId: 'EST-20260312',
          bidId: 'BID-FRISCO-001',
          totalBid: 595000,
        }),
      },
      {
        agent_id: 'estimating',
        title: 'Send estimate reply to Hensel Phelps: $1,250,000',
        description: 'Reply to "RFQ: Site Work & Utilities - Legacy West Phase 3" with estimate EST-20260315 ($1,250,000) + Excel attachment',
        type: 'email_draft',
        payload_json: JSON.stringify({
          to: 'preconstruction@henselphelps.com',
          subject: 'Re: RFQ: Site Work & Utilities - Legacy West Phase 3',
          body: 'Hey Rachel,\n\nAppreciate you including us on Legacy West Phase 3. We went through the civil drawings and utility plans - here\'s where we landed.\n\nTotal Bid: $1,250,000\n\nCovers earthwork, storm drainage, water/sewer, paving, and site concrete. Excel breakdown attached. We excluded any landscaping and irrigation.\n\nOne question - the civil plans show a 24" storm line crossing the existing water main at Station 4+50. Has that conflict been resolved or should we carry a contingency for rerouting?\n\nHappy to walk through the numbers if helpful.\n\nMarcel\nDACP Construction',
          html: '<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;line-height:1.6"><p>Hey Rachel,</p><p>Appreciate you including us on Legacy West Phase 3. We went through the civil drawings and utility plans - here\'s where we landed.</p><p><strong>Total Bid: $1,250,000</strong></p><p>Covers earthwork, storm drainage, water/sewer, paving, and site concrete. Excel breakdown attached. We excluded any landscaping and irrigation.</p><p>One question - the civil plans show a 24" storm line crossing the existing water main at Station 4+50. Has that conflict been resolved or should we carry a contingency for rerouting?</p><p>Happy to walk through the numbers if helpful.</p><p>Marcel<br/>DACP Construction</p></div>',
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
  const existing = db.prepare("SELECT COUNT(*) as c FROM agent_insights WHERE tenant_id = ?").get(SANGHA_TENANT_ID);
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
      description: 'Action item from March 3 call: "<b>Revise energy pricing assumptions in section 4.2</b>" - assigned to you, 4 days overdue.',
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
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
  `);
  for (const i of insights) {
    insertInsight.run(i.id, SANGHA_TENANT_ID, i.agent_id, i.type, i.category, i.title, i.description, i.priority, i.actions_json);
  }
  console.log(`Seeded ${insights.length} agent insights for tenant ${SANGHA_TENANT_ID}`);
}

/**
 * POST /:id/update-draft - Update the email body of a pending approval
 */
router.post('/:id/update-draft', async (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || SANGHA_TENANT_ID;
    const { id } = req.params;
    const { body, senderEmail, senderName, to, subject } = req.body;
    if (!body && !senderEmail && !to && !subject) return res.status(400).json({ error: 'body, senderEmail, to, or subject is required' });

    const { getApprovalItem, updateApprovalPayload } = await import('../cache/database.js');
    const { markdownToEmailHtml } = await import('../services/emailService.js');
    const item = getApprovalItem(tenantId, parseInt(id));
    if (!item) return res.status(404).json({ error: 'Not found' });
    if (item.status !== 'pending') return res.status(400).json({ error: 'Already processed' });

    const payload = JSON.parse(item.payload_json || '{}');
    if (body) {
      payload.body = body;
      payload.html = markdownToEmailHtml(body);
    }
    if (to !== undefined) payload.to = to;
    if (subject !== undefined) payload.subject = subject;
    if (senderEmail !== undefined) payload.senderEmail = senderEmail;
    if (senderName !== undefined) payload.senderName = senderName;

    updateApprovalPayload(tenantId, parseInt(id), JSON.stringify(payload));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /:id/rewrite - Rewrite the email body for a different sender
 */
router.post('/:id/rewrite', async (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || SANGHA_TENANT_ID;
    const { id } = req.params;
    const { senderName, currentBody } = req.body;
    if (!senderName || !currentBody) return res.status(400).json({ error: 'senderName and currentBody required' });

    const { chat } = await import('../services/chatService.js');
    const isCoppice = senderName === 'Coppice';
    const prompt = isCoppice
      ? `Remove any personal sign-off or signature from this email (like "Best regards, [Name]" or "Sincerely, [Name]"). The email system will automatically append the correct Coppice signature. Keep the same content, tone, and structure - just remove the closing name/signature. Return ONLY the email body, no explanation.\n\nCurrent email:\n---\n${currentBody}\n---`
      : `Rewrite this email so it is signed by ${senderName} instead of whoever currently signs it. Keep the same content, tone, and structure - only change the signature/sign-off and any first-person references to match ${senderName}. Return ONLY the rewritten email body, no explanation.\n\nCurrent email:\n---\n${currentBody}\n---`;
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

// ---------------------------------------------------------------------------
// POST /newsletter-action - Create email draft from newsletter recommended action
// Extracts company/contact info, does Apollo lookup, generates draft via Claude
// ---------------------------------------------------------------------------
router.post('/newsletter-action', async (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || req.user?.tenantId;
    if (!tenantId) return res.status(400).json({ error: 'tenantId required' });

    const { actionTitle, actionText } = req.body;
    if (!actionText) return res.status(400).json({ error: 'actionText required' });

    // Step 1: Use Claude to extract company name + generate email draft
    const { chat } = await import('../services/chatService.js');
    const extractPrompt = `From this newsletter recommended action, extract the target company and generate a cold outreach email.

ACTION:
${actionTitle ? actionTitle + '\n' : ''}${actionText}

CONTEXT: DACP Construction is a commercial concrete subcontractor based in Dallas-Fort Worth, specializing in foundations, flatwork, structural concrete, and site work for data centers, infrastructure, municipal, and commercial projects across Texas, Louisiana, and Florida.

WRITING STYLE: Direct, no fluff. Short paragraphs. Reference the specific project/opportunity by name and dollar value. Don't pitch generically - connect DACP's concrete capabilities to the specific scope of the project. Do NOT use em dashes (use hyphens instead). No emojis.

Return ONLY a JSON object:
{
  "companyName": "target company name",
  "contactRole": "ideal role (e.g. VP Preconstruction, Estimating Director)",
  "subject": "short, specific subject line referencing the project",
  "body": "email body - Hey [first name or team],\\n\\n[2-3 short paragraphs: reference the project, explain DACP's relevant experience, ask for a conversation]\\n\\nBest regards"
}

Return ONLY valid JSON, no commentary or markdown.`;

    const extractResult = await chat(tenantId, 'hivemind', 'system', extractPrompt, null, { helpMode: false });
    const responseText = extractResult.response || '';

    let parsed;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch { parsed = null; }

    if (!parsed) {
      // Fallback: create draft with raw action text
      parsed = {
        companyName: '',
        contactRole: '',
        subject: actionTitle || 'Following up on opportunity',
        body: `Hi,\n\nI came across your project and wanted to reach out.\n\n${actionText}\n\nWould you be open to a brief conversation about how DACP Construction can support this project?\n\nBest regards`,
      };
    }

    // Step 2: Apollo contact lookup (if we have credits and a company name)
    let contactEmail = '';
    let contactName = '';
    let contactInfo = null;
    if (parsed.companyName) {
      try {
        const { apolloBulkMatch } = await import('../services/leadEngine.js');
        // Try to find someone at the company via Apollo organization search
        const apolloKey = process.env.APOLLO_API_KEY;
        if (apolloKey) {
          // Search Apollo for people at this company
          const searchRes = await fetch('https://api.apollo.io/api/v1/mixed_people/search', {
            method: 'POST',
            headers: { 'x-api-key': apolloKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              organization_name: parsed.companyName,
              person_titles: [parsed.contactRole || 'VP Preconstruction', 'Director of Estimating', 'Preconstruction Manager', 'VP Operations', 'Business Development'],
              per_page: 3,
            }),
          });
          if (searchRes.ok) {
            const searchData = await searchRes.json();
            const people = searchData.people || [];
            if (people.length > 0) {
              const best = people[0];
              contactEmail = best.email || '';
              contactName = [best.first_name, best.last_name].filter(Boolean).join(' ');
              contactInfo = {
                name: contactName,
                email: contactEmail,
                title: best.title || '',
                phone: best.phone_number || '',
                linkedin: best.linkedin_url || '',
                org: best.organization?.name || parsed.companyName,
              };
            }
          }
        }
      } catch (err) {
        console.warn('[Newsletter Action] Apollo lookup failed:', err.message);
        // Continue without contact - user can fill in manually
      }
    }

    // Step 3: If we found a contact, personalize the email
    if (contactName && parsed.body) {
      parsed.body = parsed.body.replace(/^Hi,?\s*/i, `Hi ${contactName.split(' ')[0]},\n`);
    }

    // Step 4: Create approval item
    const { markdownToEmailHtml } = await import('../services/emailService.js');
    const { getTenantEmailConfig } = await import('../cache/database.js');
    const emailConfig = getTenantEmailConfig(tenantId);

    const payload = {
      to: contactEmail || '',
      subject: parsed.subject,
      body: parsed.body,
      html: markdownToEmailHtml(parsed.body),
      senderEmail: emailConfig?.senderEmail || '',
      senderName: emailConfig?.senderName || '',
      source: 'newsletter',
      apolloContact: contactInfo,
    };

    const result = db.prepare(`
      INSERT INTO approval_items (tenant_id, agent_id, title, description, type, payload_json, status, required_role)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', 'admin')
    `).run(
      tenantId,
      'newsletter',
      actionTitle || 'Newsletter Outreach Draft',
      contactEmail ? `Email to ${contactName} at ${parsed.companyName}` : `Outreach to ${parsed.companyName || 'contact'}`,
      'email_draft',
      JSON.stringify(payload),
    );

    res.json({
      success: true,
      approvalId: result.lastInsertRowid,
      contactFound: !!contactEmail,
      contact: contactInfo,
    });
  } catch (err) {
    console.error('[Newsletter Action] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Run seeds on import
try {
  seedDemoApprovals();
  // seedDemoInsights(); - removed, was fake demo data
} catch (err) {
  // Table may not exist yet if initDatabase hasn't run - safe to ignore
  console.warn('Approval/insight seed skipped:', err.message);
}

export default router;
