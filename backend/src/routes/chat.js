/**
 * Chat Routes — Agent conversation endpoints
 *
 * GET  /api/v1/chat/:agentId/messages  — Load conversation history
 * POST /api/v1/chat/:agentId/messages  — Send message, get AI response
 * DELETE /api/v1/chat/:agentId/messages — Clear conversation history
 */

import express from 'express';
import { getMessages, chat, saveMessage } from '../services/chatService.js';
import { sendEmail, sendEstimateEmail } from '../services/emailService.js';

const router = express.Router();

// Valid agent IDs
const VALID_AGENTS = new Set([
  'hivemind', 'estimating', 'documents', 'meetings', 'email',
  'sangha', 'curtailment', 'pools',
]);

function resolveIds(req) {
  const tenantId = req.resolvedTenant?.id || 'default';
  const userId = req.user?.id || 'anonymous';
  const agentId = req.params.agentId;
  return { tenantId, userId, agentId };
}

/**
 * GET /:agentId/messages — Load conversation history
 */
router.get('/:agentId/messages', async (req, res) => {
  try {
    const { tenantId, userId, agentId } = resolveIds(req);

    if (!VALID_AGENTS.has(agentId)) {
      return res.status(400).json({ error: `Unknown agent: ${agentId}` });
    }

    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const messages = getMessages(tenantId, agentId, userId, limit);

    res.json({
      agentId,
      count: messages.length,
      messages: messages.map(m => ({
        id: m.id,
        role: m.role,
        content: m.content,
        metadata: m.metadata_json ? JSON.parse(m.metadata_json) : null,
        createdAt: m.created_at,
      })),
    });
  } catch (error) {
    console.error('Chat GET error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /:agentId/messages — Send message and get AI response
 */
router.post('/:agentId/messages', async (req, res) => {
  try {
    const { tenantId, userId, agentId } = resolveIds(req);

    if (!VALID_AGENTS.has(agentId)) {
      return res.status(400).json({ error: `Unknown agent: ${agentId}` });
    }

    const { content } = req.body;
    if (!content || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: 'Message content is required' });
    }

    // Extend timeouts for Hivemind CLI requests (claude -p can take up to 90s)
    if (agentId === 'hivemind' && process.env.HIVEMIND_USE_CLI === 'true') {
      req.setTimeout(150_000);
      res.setTimeout(150_000);
    }

    const result = await chat(tenantId, agentId, userId, content.trim());

    // Map tool results to frontend format
    const response = { response: result.response, audio_url: result.audio_url || null };
    if (result.tool_used && result.tool_result) {
      const toolName = result.tool_used;
      const toolResult = result.tool_result;

      if (toolName.startsWith('workspace_create_')) {
        const typeMap = { workspace_create_doc: 'doc', workspace_create_sheet: 'sheet', workspace_create_slides: 'slides' };
        response.workspace = {
          action: 'created',
          type: typeMap[toolName] || 'doc',
          fileId: toolResult.file_id,
          url: toolResult.url,
          title: result.tool_input?.title || 'Untitled',
          folder: result.tool_input?.folder || '',
        };
      } else if (toolName === 'workspace_search_drive') {
        response.workspace = {
          action: 'search',
          results: Array.isArray(toolResult) ? toolResult : [],
        };
      } else if (toolName === 'workspace_read_file') {
        response.workspace = {
          action: 'read',
          name: toolResult.name,
          content: toolResult.content,
          url: toolResult.url,
        };
      } else if (toolName === 'generate_presentation') {
        response.workspace = {
          action: 'created',
          type: 'slides',
          fileId: toolResult.file_id,
          url: toolResult.url,
          title: result.tool_input?.topic || 'Presentation',
          folder: result.tool_input?.folder || '',
          slideCount: toolResult.slide_count,
          format: toolResult.format,
        };
      }
    }

    res.json(response);
  } catch (error) {
    console.error('Chat POST error:', error);
    res.status(500).json({
      error: 'Failed to generate response',
      details: error.message,
    });
  }
});

/**
 * DELETE /:agentId/messages — Clear conversation history
 */
router.delete('/:agentId/messages', async (req, res) => {
  try {
    const { tenantId, userId, agentId } = resolveIds(req);

    if (!VALID_AGENTS.has(agentId)) {
      return res.status(400).json({ error: `Unknown agent: ${agentId}` });
    }

    // We don't expose a delete function from the service, so do it inline
    const Database = (await import('better-sqlite3')).default;
    const { fileURLToPath } = await import('url');
    const { dirname, join } = await import('path');
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const db = new Database(join(__dirname, '../../data/cache.db'));

    const result = db.prepare(
      'DELETE FROM chat_messages WHERE tenant_id = ? AND agent_id = ? AND user_id = ?'
    ).run(tenantId, agentId, userId);

    res.json({ cleared: result.changes });
  } catch (error) {
    console.error('Chat DELETE error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /send-reminder — Send a follow-up reminder email (DACP demo)
 */
router.post('/send-reminder', async (req, res) => {
  const { type } = req.body;

  const reminders = {
    geotech_followup: {
      to: 'teo@zhan.capital',
      subject: 'Follow-up: Updated Boring Logs — Frisco Station Pier P-5',
      body: 'Hi,\n\nThis is a follow-up regarding the updated boring logs we requested for the Frisco Station project, specifically the pier P-5 area where our field team encountered rock at 28\'.\n\nWe sent the initial request 3 days ago and haven\'t received a response yet. Our crew is scheduling the next pier installation and we need the updated geotech data to confirm drilling parameters.\n\nCould you provide an ETA on the revised boring logs?\n\nBest,\nDACP Construction\nestimating@dacpconstruction.com',
    },
  };

  const reminder = reminders[type];
  if (!reminder) {
    return res.status(400).json({ error: `Unknown reminder type: ${type}` });
  }

  try {
    const result = await sendEmail(reminder);
    res.json({ sent: true, messageId: result.messageId });
  } catch (err) {
    console.error('Send reminder error:', err.message);
    res.json({ sent: true, note: 'Demo mode — email queued' });
  }
});

/**
 * POST /send-estimate — Send an estimate email from Estimating Bot chat (DACP demo)
 * Body: { to, subject, body, attachment }
 */
router.post('/send-estimate', async (req, res) => {
  const { to, subject, body, attachment } = req.body;

  if (!to || !subject || !body) {
    return res.status(400).json({ error: 'to, subject, and body are required' });
  }

  // For demo, always send to teo@zhan.capital
  const demoRecipient = 'teo@zhan.capital';

  try {
    let result;
    if (attachment) {
      result = await sendEstimateEmail({
        to: demoRecipient,
        subject,
        body,
        estimateFilename: attachment,
      });
    } else {
      result = await sendEmail({
        to: demoRecipient,
        subject,
        body,
      });
    }
    console.log(`Chat send-estimate: email sent to ${demoRecipient}, messageId=${result.messageId}`);

    // Log to audit trail
    try {
      const Database = (await import('better-sqlite3')).default;
      const { join } = await import('path');
      const { fileURLToPath } = await import('url');
      const { dirname } = await import('path');
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      const db = new Database(join(__dirname, '../../data/cache.db'));
      db.prepare(`
        INSERT INTO knowledge_entries (tenant_id, category, title, content, source, created_at)
        VALUES (?, 'audit', ?, ?, 'email-agent', datetime('now'))
      `).run(
        'dacp-construction-001',
        `Email sent: ${subject}`,
        `Sent to ${to} (demo: ${demoRecipient}) with attachment ${attachment || 'none'}. MessageId: ${result.messageId}`
      );
    } catch (auditErr) {
      console.warn('Audit log failed:', auditErr.message);
    }

    res.json({ sent: true, messageId: result.messageId });
  } catch (err) {
    console.error('Chat send-estimate error:', err.message);
    res.json({ sent: true, note: 'Demo mode — email queued' });
  }
});

export default router;
