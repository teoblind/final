/**
 * Chat Routes — Agent conversation endpoints
 *
 * GET  /api/v1/chat/:agentId/messages  — Load conversation history
 * POST /api/v1/chat/:agentId/messages  — Send message, get AI response
 * DELETE /api/v1/chat/:agentId/messages — Clear conversation history
 */

import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { unlinkSync } from 'fs';
import { getMessages, getThreadMessages, chat, saveMessage } from '../services/chatService.js';
import { sendEmail, sendEstimateEmail } from '../services/emailService.js';
import { getOpusModel } from '../services/modelRouter.js';
import {
  checkOpusLimit, incrementOpusUsage, insertAuditLog,
  createThread, getThread, updateThreadVisibility, updateThreadTitle,
  deleteThread, listThreads, getPinnedThreads,
  getOrphanMessageCount, backfillOrphanMessages,
} from '../cache/database.js';

const __filename_chat = fileURLToPath(import.meta.url);
const __dirname_chat = dirname(__filename_chat);

const upload = multer({
  dest: join(__dirname_chat, '../../data/uploads/'),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
});

const router = express.Router();

// Valid agent IDs
const VALID_AGENTS = new Set([
  'hivemind', 'estimating', 'documents', 'meetings', 'email',
  'sangha', 'curtailment', 'pools', 'lead-engine', 'sales',
]);

function resolveIds(req) {
  const tenantId = req.resolvedTenant?.id || 'default';
  const userId = req.user?.id || 'anonymous';
  const agentId = req.params.agentId;
  return { tenantId, userId, agentId };
}

// ─── Pinned Threads (cross-agent, for Command Dashboard) ────────────────────

/**
 * GET /pinned-threads — Get all pinned threads for the tenant
 */
router.get('/pinned-threads', async (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || 'default';
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const threads = getPinnedThreads(tenantId, { limit });
    res.json({ threads });
  } catch (error) {
    console.error('Pinned threads GET error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── Thread CRUD Endpoints ──────────────────────────────────────────────────

/**
 * GET /:agentId/threads — List threads (visibility-filtered)
 */
router.get('/:agentId/threads', async (req, res) => {
  try {
    const { tenantId, userId, agentId } = resolveIds(req);
    if (!VALID_AGENTS.has(agentId)) {
      return res.status(400).json({ error: `Unknown agent: ${agentId}` });
    }

    const isAdmin = ['owner', 'admin'].includes(req.user?.role);
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;

    // Lazy migration: check for orphan messages and backfill
    const orphanCount = getOrphanMessageCount(tenantId, agentId, userId);
    if (orphanCount > 0) {
      const threadId = `thread_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      createThread(threadId, tenantId, agentId, userId, 'Previous conversation', 'private');
      backfillOrphanMessages(tenantId, agentId, userId, threadId);
    }

    const threads = listThreads(tenantId, agentId, userId, { isAdmin, limit, offset });
    res.json({
      agentId,
      count: threads.length,
      threads: threads.map(t => ({
        id: t.id,
        title: t.title,
        visibility: t.visibility,
        userId: t.user_id,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
      })),
    });
  } catch (error) {
    console.error('Threads GET error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /:agentId/threads — Create a new thread
 */
router.post('/:agentId/threads', async (req, res) => {
  try {
    const { tenantId, userId, agentId } = resolveIds(req);
    if (!VALID_AGENTS.has(agentId)) {
      return res.status(400).json({ error: `Unknown agent: ${agentId}` });
    }

    const { title, visibility } = req.body;
    const threadId = `thread_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const vis = ['private', 'team', 'pinned'].includes(visibility) ? visibility : 'private';

    createThread(threadId, tenantId, agentId, userId, title || null, vis);

    res.status(201).json({
      id: threadId,
      title: title || null,
      visibility: vis,
      userId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Thread POST error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /:agentId/threads/:threadId/messages — Get thread messages
 */
router.get('/:agentId/threads/:threadId/messages', async (req, res) => {
  try {
    const { tenantId, userId } = resolveIds(req);
    const { threadId } = req.params;
    const isAdmin = ['owner', 'admin'].includes(req.user?.role);

    const thread = getThread(threadId);
    if (!thread) return res.status(404).json({ error: 'Thread not found' });
    if (thread.tenant_id !== tenantId) return res.status(404).json({ error: 'Thread not found' });

    // Visibility check
    if (thread.visibility === 'private' && thread.user_id !== userId && !isAdmin) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const limit = Math.min(parseInt(req.query.limit) || 200, 500);
    const messages = getThreadMessages(threadId, limit);

    res.json({
      threadId,
      thread: {
        id: thread.id,
        title: thread.title,
        visibility: thread.visibility,
        userId: thread.user_id,
      },
      count: messages.length,
      messages: messages.map(m => ({
        id: m.id,
        role: m.role,
        content: m.content,
        userId: m.user_id,
        metadata: m.metadata_json ? JSON.parse(m.metadata_json) : null,
        createdAt: m.created_at,
      })),
    });
  } catch (error) {
    console.error('Thread messages GET error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /:agentId/threads/:threadId/messages — Send message in thread
 */
router.post('/:agentId/threads/:threadId/messages', async (req, res) => {
  try {
    const { tenantId, userId, agentId } = resolveIds(req);
    const { threadId } = req.params;
    const isAdmin = ['owner', 'admin'].includes(req.user?.role);

    if (!VALID_AGENTS.has(agentId)) {
      return res.status(400).json({ error: `Unknown agent: ${agentId}` });
    }

    const thread = getThread(threadId);
    if (!thread) return res.status(404).json({ error: 'Thread not found' });
    if (thread.tenant_id !== tenantId) return res.status(404).json({ error: 'Thread not found' });

    // Visibility check — private threads only writable by owner or admin
    if (thread.visibility === 'private' && thread.user_id !== userId && !isAdmin) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { content } = req.body;
    if (!content || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: 'Message content is required' });
    }

    // Auto-title: use first ~60 chars of first user message
    if (!thread.title) {
      updateThreadTitle(threadId, content.trim().slice(0, 60));
    }

    const result = await chat(tenantId, agentId, userId, content.trim(), threadId);

    const response = { response: result.response, audio_url: result.audio_url || null };
    if (result.tool_used && result.tool_result) {
      const toolName = result.tool_used;
      const toolResult = result.tool_result;
      if (toolName.startsWith('workspace_create_')) {
        const typeMap = { workspace_create_doc: 'doc', workspace_create_sheet: 'sheet', workspace_create_slides: 'slides' };
        response.workspace = {
          action: 'created', type: typeMap[toolName] || 'doc',
          fileId: toolResult.file_id, url: toolResult.url,
          title: result.tool_input?.title || 'Untitled', folder: result.tool_input?.folder || '',
        };
      } else if (toolName === 'workspace_search_drive') {
        response.workspace = { action: 'search', results: Array.isArray(toolResult) ? toolResult : [] };
      } else if (toolName === 'workspace_read_file') {
        response.workspace = { action: 'read', name: toolResult.name, content: toolResult.content, url: toolResult.url };
      } else if (toolName === 'generate_presentation') {
        response.workspace = {
          action: 'created', type: 'slides', fileId: toolResult.file_id, url: toolResult.url,
          title: result.tool_input?.topic || 'Presentation', folder: result.tool_input?.folder || '',
          slideCount: toolResult.slide_count, format: toolResult.format,
        };
      }
    }

    res.json(response);
  } catch (error) {
    console.error('Thread message POST error:', error);
    res.status(500).json({ error: 'Failed to generate response', details: error.message });
  }
});

/**
 * POST /:agentId/threads/:threadId/messages/upload — Send message with file attachment
 */
router.post('/:agentId/threads/:threadId/messages/upload', upload.single('file'), async (req, res) => {
  try {
    const { tenantId, userId, agentId } = resolveIds(req);
    const { threadId } = req.params;
    const isAdmin = ['owner', 'admin'].includes(req.user?.role);

    if (!VALID_AGENTS.has(agentId)) {
      return res.status(400).json({ error: `Unknown agent: ${agentId}` });
    }

    const thread = getThread(threadId);
    if (!thread) return res.status(404).json({ error: 'Thread not found' });
    if (thread.tenant_id !== tenantId) return res.status(404).json({ error: 'Thread not found' });
    if (thread.visibility === 'private' && thread.user_id !== userId && !isAdmin) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const userText = req.body.content || '';

    // Parse the uploaded file
    const { parseFile } = await import('../services/fileParserService.js');
    const parsed = await parseFile(req.file.path, req.file.mimetype, req.file.originalname);

    let content;
    if (parsed.isImage) {
      // For images, prefix with metadata and let the user message be the prompt
      content = userText
        ? `[Uploaded image: ${req.file.originalname}]\n\n${userText}`
        : `[Uploaded image: ${req.file.originalname}]\nPlease describe and analyze this image.`;
    } else {
      // For documents, inject extracted text as context
      const fileContext = `[Uploaded file: ${req.file.originalname} (${parsed.type}${parsed.pageCount ? `, ${parsed.pageCount} pages` : ''})]\n\n--- FILE CONTENT ---\n${parsed.text}\n--- END FILE CONTENT ---`;
      content = userText
        ? `${fileContext}\n\n${userText}`
        : `${fileContext}\n\nPlease summarize this document.`;
    }

    // Auto-title with filename if first message
    if (!thread.title) {
      updateThreadTitle(threadId, `${req.file.originalname} — ${(userText || 'File upload').slice(0, 40)}`);
    }

    const result = await chat(tenantId, agentId, userId, content, threadId);

    const response = { response: result.response, audio_url: result.audio_url || null, file: { name: req.file.originalname, type: parsed.type, pageCount: parsed.pageCount } };
    if (result.tool_used && result.tool_result) {
      const toolName = result.tool_used;
      const toolResult = result.tool_result;
      if (toolName.startsWith('workspace_create_')) {
        const typeMap = { workspace_create_doc: 'doc', workspace_create_sheet: 'sheet', workspace_create_slides: 'slides' };
        response.workspace = {
          action: 'created', type: typeMap[toolName] || 'doc',
          fileId: toolResult.file_id, url: toolResult.url,
          title: result.tool_input?.title || 'Untitled', folder: result.tool_input?.folder || '',
        };
      }
    }

    res.json(response);
  } catch (error) {
    console.error('File upload POST error:', error);
    res.status(500).json({ error: 'Failed to process uploaded file', details: error.message });
  } finally {
    // Clean up uploaded file
    if (req.file?.path) {
      try { unlinkSync(req.file.path); } catch { /* ignore */ }
    }
  }
});

/**
 * PATCH /:agentId/threads/:threadId — Update title/visibility
 */
router.patch('/:agentId/threads/:threadId', async (req, res) => {
  try {
    const { tenantId, userId } = resolveIds(req);
    const { threadId } = req.params;
    const isAdmin = ['owner', 'admin'].includes(req.user?.role);

    const thread = getThread(threadId);
    if (!thread) return res.status(404).json({ error: 'Thread not found' });
    if (thread.tenant_id !== tenantId) return res.status(404).json({ error: 'Thread not found' });

    // Only creator or admin can update
    if (thread.user_id !== userId && !isAdmin) {
      return res.status(403).json({ error: 'Only thread creator or admin can modify' });
    }

    const { title, visibility } = req.body;

    if (title !== undefined) {
      updateThreadTitle(threadId, title);
    }

    if (visibility !== undefined) {
      if (!['private', 'team', 'pinned'].includes(visibility)) {
        return res.status(400).json({ error: 'Invalid visibility. Must be private, team, or pinned' });
      }
      const oldVisibility = thread.visibility;
      updateThreadVisibility(threadId, visibility);

      // Audit log visibility changes
      insertAuditLog({
        tenantId, userId,
        action: 'thread_visibility_changed',
        resourceType: 'chat_thread',
        resourceId: threadId,
        details: { from: oldVisibility, to: visibility, title: thread.title },
      });
    }

    const updated = getThread(threadId);
    res.json({
      id: updated.id,
      title: updated.title,
      visibility: updated.visibility,
      userId: updated.user_id,
      createdAt: updated.created_at,
      updatedAt: updated.updated_at,
    });
  } catch (error) {
    console.error('Thread PATCH error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /:agentId/threads/:threadId — Delete thread + messages
 */
router.delete('/:agentId/threads/:threadId', async (req, res) => {
  try {
    const { tenantId, userId } = resolveIds(req);
    const { threadId } = req.params;
    const isAdmin = ['owner', 'admin'].includes(req.user?.role);

    const thread = getThread(threadId);
    if (!thread) return res.status(404).json({ error: 'Thread not found' });
    if (thread.tenant_id !== tenantId) return res.status(404).json({ error: 'Thread not found' });

    // Only creator or admin can delete
    if (thread.user_id !== userId && !isAdmin) {
      return res.status(403).json({ error: 'Only thread creator or admin can delete' });
    }

    insertAuditLog({
      tenantId, userId,
      action: 'thread_deleted',
      resourceType: 'chat_thread',
      resourceId: threadId,
      details: { title: thread.title, visibility: thread.visibility },
    });

    deleteThread(threadId);
    res.json({ deleted: true });
  } catch (error) {
    console.error('Thread DELETE error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── Legacy Endpoints (backward compat) ─────────────────────────────────────

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
 * POST /generate-report — Generate a report using Opus (rate-limited)
 */
router.post('/generate-report', async (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || 'default';
    const userId = req.user?.id || 'anonymous';

    // Check rate limit
    const limit = checkOpusLimit(tenantId);
    if (!limit.allowed) {
      return res.status(429).json({
        error: 'Daily report limit reached — resets at midnight UTC',
        usage: { count: limit.count, limit: limit.limit, resetsAt: limit.resetsAt },
      });
    }

    const { prompt, context, reportType } = req.body;
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({ error: 'prompt is required' });
    }

    const systemPrompt = `You are an expert report writer for a business intelligence platform called Coppice. Generate professional, detailed reports based on the user's request. Use structured headings, clear data presentation, and actionable insights. Format output as Markdown.${context ? `\n\nContext:\n${context}` : ''}${reportType ? `\n\nReport type: ${reportType}` : ''}`;

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const completion = await anthropic.messages.create({
      model: getOpusModel(),
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt.trim() }],
    });

    const reportContent = completion.content?.[0]?.text || '';
    const inputTokens = completion.usage?.input_tokens || 0;
    const outputTokens = completion.usage?.output_tokens || 0;

    // Increment usage counter
    incrementOpusUsage(tenantId);

    // Save to chat_messages for audit trail
    const Database = (await import('better-sqlite3')).default;
    const { fileURLToPath } = await import('url');
    const { dirname, join } = await import('path');
    const __fn = fileURLToPath(import.meta.url);
    const __dn = dirname(__fn);
    const db = new Database(join(__dn, '../../data/cache.db'));

    db.prepare(`
      INSERT INTO chat_messages (tenant_id, agent_id, user_id, role, content, metadata_json, created_at)
      VALUES (?, 'report', ?, 'assistant', ?, ?, datetime('now'))
    `).run(tenantId, userId, reportContent, JSON.stringify({
      model: getOpusModel(),
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      report_type: reportType || 'general',
    }));

    const updated = checkOpusLimit(tenantId);
    res.json({
      report: reportContent,
      usage: { count: updated.count, limit: updated.limit, resetsAt: updated.resetsAt },
      tokens: { input: inputTokens, output: outputTokens },
    });
  } catch (error) {
    console.error('Generate report error:', error);
    res.status(500).json({ error: 'Failed to generate report', details: error.message });
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
    const tenantId = req.resolvedTenant?.id || 'default';
    const result = await sendEmail({ ...reminder, tenantId });
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
    const tenantId = req.resolvedTenant?.id || 'default';
    let result;
    if (attachment) {
      result = await sendEstimateEmail({
        to: demoRecipient,
        subject,
        body,
        estimateFilename: attachment,
        tenantId,
      });
    } else {
      result = await sendEmail({
        to: demoRecipient,
        subject,
        body,
        tenantId,
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
