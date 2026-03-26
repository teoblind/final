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
import { unlinkSync, mkdirSync, copyFileSync, existsSync } from 'fs';
import { authenticate } from '../middleware/auth.js';
import { getMessages, getThreadMessages, chat, chatStream, saveMessage } from '../services/chatService.js';
import { chatStreamSdk, isSdkEnabled } from '../services/agentSdkService.js';
import { sendEmail, sendEstimateEmail } from '../services/emailService.js';
import { getOpusModel } from '../services/modelRouter.js';
import {
  checkOpusLimit, incrementOpusUsage, insertAuditLog,
  createThread, getThread, updateThreadVisibility, updateThreadTitle,
  deleteThread, listThreads, getPinnedThreads, pinThread, unpinThread,
  getOrphanMessageCount, backfillOrphanMessages,
  getContextPins, addContextPin, removeContextPin,
  getGcProfile, getRelatedThreads, getThreadEntities, upsertKnowledgeEntity,
} from '../cache/database.js';

const __filename_chat = fileURLToPath(import.meta.url);
const __dirname_chat = dirname(__filename_chat);

const UPLOADS_DIR = join(__dirname_chat, '../../data/uploads/');
const upload = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
});

const router = express.Router();

// ─── Public Help Chat (no auth required) ──────────────────────────────────
// This must be defined BEFORE router.use(authenticate) so unauthenticated
// visitors on the landing page can use the help widget.

const HELP_AGENTS = new Set(['hivemind', 'sangha', 'zhan']);

// Simple per-IP rate limiter for public help chat (10 req/min)
const helpRateLimit = new Map();
function checkHelpRateLimit(ip) {
  const now = Date.now();
  let entry = helpRateLimit.get(ip);
  if (!entry || now - entry.windowStart >= 60000) {
    entry = { count: 0, windowStart: now };
    helpRateLimit.set(ip, entry);
  }
  entry.count += 1;
  return entry.count <= 10;
}

router.post('/help/:agentId/messages/stream', async (req, res) => {
  try {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    if (!checkHelpRateLimit(ip)) {
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }

    const agentId = req.params.agentId;
    if (!HELP_AGENTS.has(agentId)) {
      return res.status(400).json({ error: `Unknown agent: ${agentId}` });
    }

    const { content } = req.body;
    if (!content || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: 'Message content is required' });
    }

    // Cap message length for public endpoint
    const text = content.trim().slice(0, 1000);

    const tenantId = req.resolvedTenant?.id || 'default';
    const visitorId = `visitor_${ip.replace(/[^a-zA-Z0-9]/g, '_')}`;
    // Help chat is ephemeral — no thread or message persistence
    const threadId = `help_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    await chatStream(tenantId, agentId, visitorId, text, threadId, { helpMode: true }, (chunk) => {
      res.write(`data: ${JSON.stringify({ type: 'text', text: chunk })}\n\n`);
    });

    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
  } catch (error) {
    console.error('[HelpChat] Stream error:', error);
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ error: 'Failed to stream response' });
    }
  }
});

// All other chat routes require authentication
router.use(authenticate);

// Valid agent IDs
const VALID_AGENTS = new Set([
  'hivemind', 'estimating', 'documents', 'meetings', 'email',
  'sangha', 'zhan', 'curtailment', 'pools', 'lead-engine', 'sales', 'pitch-deck',
  'workflow', 'comms',
]);

function resolveIds(req) {
  const tenantId = req.resolvedTenant?.id || 'default';
  const userId = req.user.id; // auth middleware guarantees req.user exists
  const agentId = req.params.agentId;
  return { tenantId, userId, agentId };
}

// Generate a short thread title from the first user message using Claude Haiku
async function generateShortTitle(content) {
  try {
    const client = new Anthropic();
    const res = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 30,
      messages: [{ role: 'user', content: `Generate a 2-5 word title for this chat message. Return ONLY the title, no quotes or punctuation. Examples: "Email Draft Edit", "Concrete Pricing Lookup", "Turner Bid Review", "Capabilities Overview".\n\nMessage: ${content.slice(0, 300)}` }],
    });
    const title = (res.content[0]?.text || '').trim().replace(/^["']|["']$/g, '');
    if (title && title.length <= 50) return title;
  } catch {}
  // Fallback: truncate
  const raw = content.trim().replace(/\s+/g, ' ');
  return raw.length > 25 ? raw.slice(0, 25).replace(/\s\S*$/, '...') : raw;
}

// Generate title and emit SSE event if res is provided (streaming endpoints)
function generateAndEmitTitle(content, threadId, res) {
  generateShortTitle(content).then(title => {
    updateThreadTitle(threadId, title);
    if (res && !res.writableEnded) {
      try { res.write(`data: ${JSON.stringify({ type: 'title', title })}\n\n`); } catch {}
    }
  }).catch(() => {});
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
        isPinned: !!t.is_pinned,
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

    const { title, visibility, pinned } = req.body;
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
        isPinned: !!thread.is_pinned,
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

    const { content, helpMode } = req.body;
    if (!content || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: 'Message content is required' });
    }

    // Auto-title: generate short title from first user message
    if (!thread.title) {
      generateShortTitle(content).then(t => updateThreadTitle(threadId, t)).catch(() => {});
    }

    const result = await chat(tenantId, agentId, userId, content.trim(), threadId, { helpMode: !!helpMode });

    const response = { response: result.response, audio_url: result.audio_url || null };
    if (result.approval_pending) {
      response.approval_pending = true;
      response.approval_id = result.approval_id;
      response.tool_proposed = result.tool_proposed;
      response.tool_input = result.tool_input;
      response.action_description = result.action_description;
    }
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
 * POST /:agentId/threads/:threadId/messages/upload — Send message with file attachments
 * Supports single or multiple files. Files persist on disk for RC agent access.
 */
router.post('/:agentId/threads/:threadId/messages/upload', upload.array('files', 20), async (req, res) => {
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

    // Support both single 'file' and multiple 'files' field names
    const files = req.files || (req.file ? [req.file] : []);
    if (files.length === 0) {
      return res.status(400).json({ error: 'No files provided' });
    }

    const userText = req.body.content || '';

    // Persist files to tenant-specific directory for RC agent access
    const persistDir = join(UPLOADS_DIR, tenantId, threadId);
    mkdirSync(persistDir, { recursive: true });

    const { parseFile } = await import('../services/fileParserService.js');
    const contentBlocks = [];
    const savedFiles = [];

    for (const file of files) {
      const safeName = file.originalname.replace(/[^a-zA-Z0-9._\-() ]/g, '_');
      const persistPath = join(persistDir, safeName);
      copyFileSync(file.path, persistPath);
      try { unlinkSync(file.path); } catch {}

      savedFiles.push({ name: file.originalname, path: persistPath, size: file.size });

      const parsed = await parseFile(persistPath, file.mimetype, file.originalname);

      if (parsed.isImage && parsed.base64 && !parsed.imageTooLarge) {
        // Send image as vision block for Claude to see
        contentBlocks.push({
          type: 'image',
          source: { type: 'base64', media_type: parsed.mediaType, data: parsed.base64 },
          _fileName: file.originalname,
        });
      } else {
        const preview = (parsed.text || '').length > 8000
          ? parsed.text.slice(0, 8000) + '\n[... truncated — full file available on disk]'
          : (parsed.text || `[Uploaded file: ${file.originalname}]`);
        contentBlocks.push({
          type: 'text',
          text: `[File: ${file.originalname} (${parsed.type || 'unknown'}${parsed.pageCount ? `, ${parsed.pageCount} pages` : ''})]\n${preview}`,
        });
      }
    }

    // Add user text or default prompt
    if (userText) {
      contentBlocks.push({ type: 'text', text: userText });
    } else if (!contentBlocks.some(b => b.type === 'text')) {
      contentBlocks.push({ type: 'text', text: `Analyze the uploaded file${savedFiles.length > 1 ? 's' : ''}.` });
    }

    if (!thread.title) {
      const fileNames = savedFiles.map(f => f.name).join(', ');
      const titleContext = userText ? `${fileNames}: ${userText}` : `Analyze ${fileNames}`;
      generateShortTitle(titleContext).then(t => updateThreadTitle(threadId, t)).catch(() => {});
    }

    // Pass content blocks (multimodal) — chat() handles both string and array
    const result = await chat(tenantId, agentId, userId, contentBlocks, threadId);

    const response = {
      response: result.response,
      audio_url: result.audio_url || null,
      files: savedFiles.map(f => ({ name: f.name, size: f.size })),
    };
    if (result.approval_pending) {
      response.approval_pending = true;
      response.approval_id = result.approval_id;
      response.tool_proposed = result.tool_proposed;
      response.tool_input = result.tool_input;
      response.action_description = result.action_description;
    }
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

    const { title, visibility, pinned } = req.body;

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


    if (typeof pinned === 'boolean') {
      if (pinned) pinThread(threadId);
      else unpinThread(threadId);
    }
    const updated = getThread(threadId);
    res.json({
      id: updated.id,
      title: updated.title,
      visibility: updated.visibility,
      userId: updated.user_id,
      createdAt: updated.created_at,
      updatedAt: updated.updated_at,
      isPinned: !!updated.is_pinned,
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

// ─── Streaming Endpoints (SSE) ───────────────────────────────────────────────

/**
 * POST /:agentId/threads/:threadId/messages/stream — Stream response via SSE
 */
router.post('/:agentId/threads/:threadId/messages/stream', async (req, res) => {
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

    const { content, helpMode } = req.body;
    if (!content || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: 'Message content is required' });
    }

    // helpMode on existing thread — lightweight path
    if (helpMode && HELP_AGENTS.has(agentId)) {
      const text = content.trim().slice(0, 1000);
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
      await chatStream(tenantId, agentId, userId, text, threadId, { helpMode: true }, (chunk) => {
        res.write(`data: ${JSON.stringify({ type: 'text', text: chunk })}\n\n`);
      });
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
      return;
    }

    if (!thread.title) {
      // Title will be emitted as SSE event once generated
      generateAndEmitTitle(content, threadId, res);
    }

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Route through SDK or legacy engine based on feature flag
    const useSdk = isSdkEnabled(tenantId, agentId);
    const streamFn = useSdk ? chatStreamSdk : chatStream;

    if (useSdk) {
      res.write(`data: ${JSON.stringify({ type: 'text', text: '' })}\n\n`); // SDK init signal
    }

    await streamFn(tenantId, agentId, userId, content.trim(), threadId, { helpMode: !!helpMode }, (chunk) => {
      // Detect special events from the tool loop
      try {
        if (chunk.startsWith('{') && (chunk.includes('"_type":"progress"') || chunk.includes('"_type":"context_update"') || chunk.includes('"_type":"task_proposal"'))) {
          const parsed = JSON.parse(chunk);
          if (parsed._type === 'progress') {
            res.write(`data: ${JSON.stringify({ type: 'progress', iteration: parsed.iteration, maxTurns: parsed.maxTurns, tools: parsed.tools })}\n\n`);
            return;
          }
          if (parsed._type === 'context_update') {
            res.write(`data: ${JSON.stringify({ type: 'context_update', update: parsed })}\n\n`);
            return;
          }
          if (parsed._type === 'task_proposal') {
            res.write(`data: ${JSON.stringify({ type: 'task_proposal', ...parsed })}\n\n`);
            return;
          }
        }
      } catch {}
      res.write(`data: ${JSON.stringify({ type: 'text', text: chunk })}\n\n`);
    });

    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
  } catch (error) {
    console.error('Stream POST error:', error);
    // If headers already sent, try writing error as SSE
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ error: 'Failed to stream response', details: error.message });
    }
  }
});

/**
 * POST /:agentId/messages/stream — Stream response via SSE (auto-creates thread)
 */
router.post('/:agentId/messages/stream', async (req, res) => {
  try {
    const { tenantId, userId, agentId } = resolveIds(req);

    if (!VALID_AGENTS.has(agentId)) {
      return res.status(400).json({ error: `Unknown agent: ${agentId}` });
    }

    const { content, helpMode } = req.body;
    if (!content || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: 'Message content is required' });
    }

    // helpMode requests use the lightweight path (Haiku, no tools) — same as public help endpoint
    if (helpMode && HELP_AGENTS.has(agentId)) {
      const text = content.trim().slice(0, 1000);
      const threadId = `help_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      // Help chat is ephemeral — no thread or message persistence
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
      await chatStream(tenantId, agentId, userId, text, threadId, { helpMode: true }, (chunk) => {
        res.write(`data: ${JSON.stringify({ type: 'text', text: chunk })}\n\n`);
      });
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
      return;
    }

    const threadId = `thread_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    createThread(threadId, tenantId, agentId, userId, null, 'private');
    generateAndEmitTitle(content, threadId, res);

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Send threadId first so frontend can track it
    res.write(`data: ${JSON.stringify({ type: 'thread', threadId })}\n\n`);

    const useSdk = isSdkEnabled(tenantId, agentId);
    const streamFn = useSdk ? chatStreamSdk : chatStream;

    await streamFn(tenantId, agentId, userId, content.trim(), threadId, { helpMode: !!helpMode }, (chunk) => {
      // Detect special events from the tool loop
      try {
        if (chunk.startsWith('{') && (chunk.includes('"_type":"progress"') || chunk.includes('"_type":"context_update"') || chunk.includes('"_type":"task_proposal"'))) {
          const parsed = JSON.parse(chunk);
          if (parsed._type === 'progress') {
            res.write(`data: ${JSON.stringify({ type: 'progress', iteration: parsed.iteration, maxTurns: parsed.maxTurns, tools: parsed.tools })}\n\n`);
            return;
          }
          if (parsed._type === 'context_update') {
            res.write(`data: ${JSON.stringify({ type: 'context_update', update: parsed })}\n\n`);
            return;
          }
          if (parsed._type === 'task_proposal') {
            res.write(`data: ${JSON.stringify({ type: 'task_proposal', ...parsed })}\n\n`);
            return;
          }
        }
      } catch {}
      res.write(`data: ${JSON.stringify({ type: 'text', text: chunk })}\n\n`);
    });

    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
  } catch (error) {
    console.error('Stream POST error:', error);
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ error: 'Failed to stream response', details: error.message });
    }
  }
});

// ─── Streaming File Upload ──────────────────────────────────────────────────
/**
 * POST /:agentId/threads/:threadId/messages/upload-stream — Upload files with SSE streaming response
 */
router.post('/:agentId/threads/:threadId/messages/upload-stream', upload.array('files', 5), async (req, res) => {
  const uploadedFiles = req.files || [];
  try {
    const { tenantId, userId, agentId } = resolveIds(req);
    const { threadId } = req.params;
    const isAdmin = ['owner', 'admin'].includes(req.user?.role);

    if (!VALID_AGENTS.has(agentId)) {
      for (const f of uploadedFiles) { try { unlinkSync(f.path); } catch {} }
      return res.status(400).json({ error: `Unknown agent: ${agentId}` });
    }
    const thread = getThread(threadId);
    if (!thread || thread.tenant_id !== tenantId) {
      for (const f of uploadedFiles) { try { unlinkSync(f.path); } catch {} }
      return res.status(404).json({ error: 'Thread not found' });
    }
    if (thread.visibility === 'private' && thread.user_id !== userId && !isAdmin) {
      for (const f of uploadedFiles) { try { unlinkSync(f.path); } catch {} }
      return res.status(403).json({ error: 'Access denied' });
    }

    const textContent = (req.body.content || '').trim();
    const { parseFile } = await import('../services/fileParserService.js');
    const contentBlocks = [];

    for (const file of uploadedFiles) {
      try {
        const parsed = await parseFile(file.path, file.mimetype, file.originalname);
        if (parsed.isImage && parsed.base64 && !parsed.imageTooLarge) {
          contentBlocks.push({
            type: 'image',
            source: { type: 'base64', media_type: parsed.mediaType, data: parsed.base64 },
            _fileName: file.originalname,
          });
        } else {
          contentBlocks.push({ type: 'text', text: `[File: ${file.originalname}]\n${parsed.text || '[could not parse]'}` });
        }
      } catch (e) {
        contentBlocks.push({ type: 'text', text: `[File: ${file.originalname}] (parse error: ${e.message})` });
      }
    }

    if (textContent) {
      contentBlocks.push({ type: 'text', text: textContent });
    } else if (!contentBlocks.some(b => b.type === 'text')) {
      contentBlocks.push({ type: 'text', text: `Analyze the uploaded file${uploadedFiles.length > 1 ? 's' : ''}.` });
    }

    // Cleanup temp files (base64 already extracted)
    for (const f of uploadedFiles) { try { unlinkSync(f.path); } catch {} }

    if (!thread.title) {
      const titleContext = textContent || `Analyze ${uploadedFiles.map(f => f.originalname).join(', ')}`;
      generateAndEmitTitle(titleContext, threadId, res);
    }

    // SSE stream
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const useSdk = isSdkEnabled(tenantId, agentId);
    const streamFn = useSdk ? chatStreamSdk : chatStream;

    await streamFn(tenantId, agentId, userId, contentBlocks, threadId, {}, (chunk) => {
      try {
        if (chunk.startsWith('{') && chunk.includes('"_type":"progress"')) {
          const parsed = JSON.parse(chunk);
          if (parsed._type === 'progress') {
            res.write(`data: ${JSON.stringify({ type: 'progress', iteration: parsed.iteration, maxTurns: parsed.maxTurns, tools: parsed.tools })}\n\n`);
            return;
          }
        }
      } catch {}
      res.write(`data: ${JSON.stringify({ type: 'text', text: chunk })}\n\n`);
    });

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    console.error('Upload stream error:', error);
    for (const f of uploadedFiles) { try { unlinkSync(f.path); } catch {} }
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ error: error.message });
    }
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

    const { content, helpMode } = req.body;
    if (!content || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: 'Message content is required' });
    }

    // Extend timeouts for Hivemind CLI requests (claude -p can take up to 90s)
    if (agentId === 'hivemind' && process.env.HIVEMIND_USE_CLI === 'true') {
      req.setTimeout(150_000);
      res.setTimeout(150_000);
    }

    // Auto-create a thread for threadless messages so they persist
    const threadId = `thread_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    createThread(threadId, tenantId, agentId, userId, null, 'private');
    generateShortTitle(content).then(t => updateThreadTitle(threadId, t)).catch(() => {});

    const result = await chat(tenantId, agentId, userId, content.trim(), threadId, { helpMode: !!helpMode });

    // Map tool results to frontend format
    const response = { response: result.response, audio_url: result.audio_url || null, threadId };
    if (result.approval_pending) {
      response.approval_pending = true;
      response.approval_id = result.approval_id;
      response.tool_proposed = result.tool_proposed;
      response.tool_input = result.tool_input;
      response.action_description = result.action_description;
    }
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
    const { getTenantDb: getDb } = await import('../cache/database.js');
    const db = getDb(tenantId);

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
    const { getTenantDb: getDb2 } = await import('../cache/database.js');
    const db = getDb2(tenantId);

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
      const { getTenantDb: getDb3 } = await import('../cache/database.js');
      const db = getDb3('dacp-construction-001');
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

// ─── Context Panel API ────────────────────────────────────────────────────────

/**
 * GET /context/:threadId — Get aggregated context for a thread
 */
router.get('/context/:threadId', async (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || 'default';
    const { threadId } = req.params;

    const thread = getThread(threadId);
    if (!thread) return res.status(404).json({ error: 'Thread not found' });
    if (thread.tenant_id !== tenantId) return res.status(404).json({ error: 'Thread not found' });

    // 1. Get entities mentioned in this thread
    const entities = getThreadEntities(tenantId, threadId, 10);

    // 2. Parse entity metadata
    const parsedEntities = entities.map(e => {
      let metadata = {};
      try { metadata = e.metadata_json ? JSON.parse(e.metadata_json) : {}; } catch {}
      return { ...e, metadata };
    });

    // 3. For GC-type entities, get aggregated profile
    let gcProfile = null;
    const gcEntity = parsedEntities.find(e =>
      e.entity_type === 'company' || e.entity_type === 'gc'
    );
    if (gcEntity) {
      gcProfile = getGcProfile(tenantId, gcEntity.name);
    }

    // 4. Get pinned items
    const allPins = getContextPins(tenantId, threadId).map(pin => {
      let metadata = null;
      try { metadata = pin.metadata_json ? JSON.parse(pin.metadata_json) : null; } catch {}
      return { ...pin, metadata };
    });

    // Separate entity pins from other pins, and attach _pinId to matching entities
    const entityPinMap = {};
    const pinnedItems = [];
    for (const pin of allPins) {
      if (pin.pin_type === 'entity' && pin.ref_id) {
        entityPinMap[pin.ref_id] = pin.id;
      } else {
        pinnedItems.push(pin);
      }
    }
    for (const e of parsedEntities) {
      if (entityPinMap[e.id]) e._pinId = entityPinMap[e.id];
    }

    // Also add pinned entities not already in the auto-detected list
    for (const pin of allPins) {
      if (pin.pin_type === 'entity' && pin.ref_id && !parsedEntities.find(e => e.id === pin.ref_id)) {
        parsedEntities.push({ id: pin.ref_id, name: pin.label, entity_type: 'unknown', metadata: pin.metadata || {}, _pinId: pin.id });
      }
    }

    // 5. Get related threads (based on entity names)
    const entityNames = parsedEntities.map(e => e.name);
    const relatedThreads = getRelatedThreads(tenantId, entityNames, threadId, 5);

    // 6. Get referenced files from Drive
    let recentFiles = [];
    try {
      const { searchDriveContents } = await import('../cache/database.js');
      if (thread.title) {
        recentFiles = searchDriveContents(tenantId, thread.title, 5);
      }
    } catch {}

    res.json({
      entities: parsedEntities,
      gcProfile,
      pinnedItems,
      relatedThreads,
      recentFiles,
    });
  } catch (error) {
    console.error('Context GET error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /context/:threadId/pin — Pin an item to a thread
 */
router.post('/context/:threadId/pin', async (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || 'default';
    const { threadId } = req.params;
    const { pinType, refId, label, metadata } = req.body;

    if (!pinType || !label) {
      return res.status(400).json({ error: 'pinType and label are required' });
    }

    const thread = getThread(threadId);
    if (!thread) return res.status(404).json({ error: 'Thread not found' });
    if (thread.tenant_id !== tenantId) return res.status(404).json({ error: 'Thread not found' });

    const pin = addContextPin(tenantId, threadId, pinType, refId || '', label, metadata || null, 'user');
    res.json(pin);
  } catch (error) {
    console.error('Context pin POST error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /context/pin/:pinId — Remove a pin
 */
router.delete('/context/pin/:pinId', async (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || 'default';
    const { pinId } = req.params;
    removeContextPin(tenantId, pinId);
    res.json({ deleted: true });
  } catch (error) {
    console.error('Context pin DELETE error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
