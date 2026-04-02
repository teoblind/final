/**
 * Knowledge Routes - Ingestion, search, and entity queries
 *
 * POST   /api/v1/knowledge/ingest         - Ingest a transcript/document
 * GET    /api/v1/knowledge/search         - Search knowledge base
 * GET    /api/v1/knowledge/entity/:name   - Get everything linked to an entity
 * GET    /api/v1/knowledge/action-items   - Get open action items
 * GET    /api/v1/knowledge/recent         - Get recent entries
 * GET    /api/v1/knowledge/entries/:id    - Get full entry detail (transcript, actions, entities)
 * GET    /api/v1/knowledge/entities       - List all entities for a tenant
 */

import express from 'express';
import crypto from 'crypto';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import {
  processKnowledgeEntry,
  searchKnowledge,
  getEntityKnowledge,
  getOpenActionItems,
} from '../services/knowledgeProcessor.js';
import { processMeetingComplete } from '../services/meetingProcessor.js';
import { insertActivity, getCurrentTenantId, getTenantDb, getAllTenantDbs, getAgentAssignment, getThread, SANGHA_TENANT_ID } from '../cache/database.js';
import { getThreadMessages } from '../services/chatService.js';
import { authenticate } from '../middleware/auth.js';

const __filename_knowledge = fileURLToPath(import.meta.url);
const __dirname_knowledge = dirname(__filename_knowledge);

// Ensure audio directory exists
const audioDir = join(__dirname_knowledge, '../../data/audio/meetings/');
if (!existsSync(audioDir)) mkdirSync(audioDir, { recursive: true });

// Multer for meeting audio uploads
const audioUpload = multer({
  dest: audioDir,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB
});

// Lazy DB accessor - resolves to the current tenant's DB via AsyncLocalStorage context
const db = new Proxy({}, {
  get(target, prop) {
    const tenantId = getCurrentTenantId() || SANGHA_TENANT_ID;
    const realDb = getTenantDb(tenantId);
    const val = realDb[prop];
    if (typeof val === 'function') return val.bind(realDb);
    return val;
  },
});

const router = express.Router();

// ─── Public routes (no auth) ─────────────────────────────────────────────────

/**
 * GET /shared/:token - Public share link for a meeting
 * Returns meeting data if share_enabled = 1
 */
router.get('/shared/:token', async (req, res) => {
  try {
    const { token } = req.params;

    // Search across all tenant DBs for the shared entry
    // We need to check all tenants since shared links are public
    const tenantDbs = getAllTenantDbs();

    let entry = null;
    let actionItems = [];

    for (const [tenantId, tdb] of Object.entries(tenantDbs)) {
      try {
        entry = tdb.prepare(`
          SELECT id, title, summary, transcript, transcript_json, audio_url, duration_seconds, recorded_at
          FROM knowledge_entries
          WHERE share_token = ? AND share_enabled = 1
        `).get(token);

        if (entry) {
          actionItems = tdb.prepare(`
            SELECT id, description, assignee, due_date, status, priority
            FROM action_items WHERE entry_id = ?
            ORDER BY status ASC, due_date ASC
          `).all(entry.id);
          break;
        }
      } catch (e) { /* skip tenant if table doesn't exist */ }
    }

    if (!entry) {
      return res.status(404).json({ error: 'Shared meeting not found or sharing disabled' });
    }

    // Parse transcript_json if stored as string
    if (entry.transcript_json && typeof entry.transcript_json === 'string') {
      try { entry.transcript_json = JSON.parse(entry.transcript_json); } catch (e) { /* leave as string */ }
    }

    res.json({ ...entry, action_items: actionItems });
  } catch (error) {
    console.error('Shared meeting error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /audio/:id - Serve meeting audio file (public)
 */
router.get('/audio/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const filePath = join(audioDir, `${id}.mp3`);

    if (!existsSync(filePath)) {
      return res.status(404).json({ error: 'Audio file not found' });
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    res.sendFile(filePath);
  } catch (error) {
    console.error('Audio serve error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── Authenticated routes ────────────────────────────────────────────────────
router.use(authenticate);

function resolveIds(req) {
  const tenantId = req.resolvedTenant?.id || SANGHA_TENANT_ID;
  const userId = req.user?.id || 'anonymous';
  return { tenantId, userId };
}

/**
 * POST /ingest - Ingest a transcript, document, or call recording
 */
router.post('/ingest', async (req, res) => {
  try {
    const { tenantId } = resolveIds(req);
    const {
      type = 'note',
      title,
      transcript,
      content,
      source = 'manual',
      source_agent,
      duration_seconds,
      recorded_at,
    } = req.body;

    if (!title && !transcript && !content) {
      return res.status(400).json({ error: 'At least one of title, transcript, or content is required' });
    }

    const entryId = `KN-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    db.prepare(`
      INSERT INTO knowledge_entries (id, tenant_id, type, title, transcript, content, source, source_agent, duration_seconds, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entryId, tenantId, type,
      title || 'Untitled',
      transcript || null,
      content || null,
      source,
      source_agent || null,
      duration_seconds || null,
      recorded_at || new Date().toISOString(),
    );

    // Process asynchronously
    processKnowledgeEntry(entryId, tenantId).catch(err => {
      console.error(`Knowledge processing failed for ${entryId}:`, err.message);
    });

    insertActivity({
      tenantId, type: 'doc',
      title: `Ingested: ${title || 'Untitled'}`,
      subtitle: `${type} - ${(content || transcript || '').slice(0, 80)}`,
      detailJson: JSON.stringify({ type, source, title }),
      sourceType: 'knowledge', sourceId: entryId, agentId: 'knowledge',
    });

    res.json({ id: entryId, status: 'processing' });
  } catch (error) {
    console.error('Knowledge ingest error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /share-to-hivemind - Share a completed assignment or chat thread to the knowledge graph
 */
router.post('/share-to-hivemind', async (req, res) => {
  try {
    const { tenantId, userId } = resolveIds(req);
    const { source_type, source_id } = req.body;

    if (!source_type || !source_id) {
      return res.status(400).json({ error: 'source_type and source_id are required' });
    }
    if (!['assignment', 'thread'].includes(source_type)) {
      return res.status(400).json({ error: 'source_type must be "assignment" or "thread"' });
    }

    let title, content, type, source;

    if (source_type === 'assignment') {
      const assignment = getAgentAssignment(tenantId, source_id);
      if (!assignment) return res.status(404).json({ error: 'Assignment not found' });

      title = assignment.title;
      content = [
        `Task: ${assignment.title}`,
        `Description: ${assignment.description || ''}`,
        `Category: ${assignment.category || 'general'}`,
        '',
        'Result:',
        assignment.result_summary || '(no result)',
      ].join('\n');

      if (assignment.output_artifacts_json) {
        try {
          const artifacts = JSON.parse(assignment.output_artifacts_json);
          content += '\n\nArtifacts:\n' + artifacts.map(a => `- ${a.type}: ${a.url || a.title || ''}`).join('\n');
        } catch (e) { /* ignore */ }
      }
      type = 'agent-task';
      source = 'shared-assignment';
    } else {
      const thread = getThread(source_id);
      if (!thread) return res.status(404).json({ error: 'Thread not found' });

      const messages = getThreadMessages(source_id);
      title = thread.title || 'Shared Conversation';
      content = messages.map(m => `[${m.role}]: ${m.content || ''}`).join('\n\n');
      type = 'conversation';
      source = 'shared-thread';
    }

    const entryId = `KN-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    db.prepare(`
      INSERT INTO knowledge_entries (id, tenant_id, type, title, content, source, source_agent, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(entryId, tenantId, type, title, content, source, 'hivemind', new Date().toISOString());

    // Process asynchronously
    processKnowledgeEntry(entryId, tenantId).catch(err => {
      console.error(`Hivemind processing failed for ${entryId}:`, err.message);
    });

    insertActivity({
      tenantId, type: 'doc',
      title: `Shared to Hivemind: ${title}`,
      subtitle: `${source_type} shared by ${userId}`,
      detailJson: JSON.stringify({ source_type, source_id }),
      sourceType: 'knowledge', sourceId: entryId, agentId: 'knowledge',
    });

    res.json({ id: entryId, status: 'processing' });
  } catch (error) {
    console.error('Share to hivemind error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /search - Search across all knowledge entries
 */
router.get('/search', async (req, res) => {
  try {
    const { tenantId } = resolveIds(req);
    const { q, type, entity, limit } = req.query;

    const results = searchKnowledge(tenantId, q, {
      type,
      entity,
      limit: parseInt(limit) || 20,
    });

    res.json(results);
  } catch (error) {
    console.error('Knowledge search error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /entity/:name - Get everything linked to a specific entity
 */
router.get('/entity/:name', async (req, res) => {
  try {
    const { tenantId } = resolveIds(req);
    const result = getEntityKnowledge(tenantId, req.params.name);
    res.json(result);
  } catch (error) {
    console.error('Knowledge entity error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /action-items - Get action items (open by default, or all)
 */
router.get('/action-items', async (req, res) => {
  try {
    const { tenantId } = resolveIds(req);
    const limit = parseInt(req.query.limit) || 20;
    const status = req.query.status;

    if (status === 'all') {
      const items = db.prepare(`
        SELECT ai.*, ke.title as source_title, ke.type as source_type
        FROM action_items ai
        JOIN knowledge_entries ke ON ai.entry_id = ke.id
        WHERE ai.tenant_id = ?
        ORDER BY ai.due_date ASC
        LIMIT ?
      `).all(tenantId, limit);
      return res.json(items);
    }

    const items = getOpenActionItems(tenantId, limit);
    res.json(items);
  } catch (error) {
    console.error('Knowledge action-items error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /action-items/:id - Update action item status
 */
router.patch('/action-items/:id', async (req, res) => {
  try {
    const { tenantId, userId } = resolveIds(req);
    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'status is required' });
    }

    const now = new Date().toISOString();
    const completedAt = status === 'completed' ? now : null;
    const completedBy = status === 'completed' ? userId : null;

    const result = db.prepare(`
      UPDATE action_items SET status = ?, completed_at = ?, completed_by = ?
      WHERE id = ? AND tenant_id = ?
    `).run(status, completedAt, completedBy, id, tenantId);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Action item not found' });
    }

    const updated = db.prepare('SELECT * FROM action_items WHERE id = ?').get(id);
    res.json(updated);
  } catch (error) {
    console.error('Knowledge action-items patch error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /entries/:id/share - Generate a public share link for a meeting
 */
router.post('/entries/:id/share', async (req, res) => {
  try {
    const { tenantId } = resolveIds(req);
    const { id } = req.params;

    const entry = db.prepare('SELECT id FROM knowledge_entries WHERE id = ? AND tenant_id = ?').get(id, tenantId);
    if (!entry) return res.status(404).json({ error: 'Entry not found' });

    const shareToken = crypto.randomBytes(12).toString('hex');
    db.prepare('UPDATE knowledge_entries SET share_token = ?, share_enabled = 1 WHERE id = ? AND tenant_id = ?')
      .run(shareToken, id, tenantId);

    const baseUrl = process.env.APP_BASE_URL || 'https://app.coppice.ai';
    const shareUrl = `${baseUrl}/shared/meeting/${shareToken}`;

    res.json({ share_url: shareUrl, share_token: shareToken });
  } catch (error) {
    console.error('Share link error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /entries/:id/share - Disable sharing for a meeting
 */
router.delete('/entries/:id/share', async (req, res) => {
  try {
    const { tenantId } = resolveIds(req);
    const { id } = req.params;

    const result = db.prepare('UPDATE knowledge_entries SET share_enabled = 0 WHERE id = ? AND tenant_id = ?')
      .run(id, tenantId);

    if (result.changes === 0) return res.status(404).json({ error: 'Entry not found' });

    res.json({ success: true });
  } catch (error) {
    console.error('Disable share error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /entries/:id/audio - Upload audio file for a meeting
 * Accepts multipart form with 'audio' field
 */
router.post('/entries/:id/audio', audioUpload.single('audio'), async (req, res) => {
  try {
    const { tenantId } = resolveIds(req);
    const { id } = req.params;

    const entry = db.prepare('SELECT id FROM knowledge_entries WHERE id = ? AND tenant_id = ?').get(id, tenantId);
    if (!entry) return res.status(404).json({ error: 'Entry not found' });

    if (!req.file) return res.status(400).json({ error: 'No audio file uploaded' });

    // Rename uploaded file to <id>.mp3
    const { renameSync } = await import('fs');
    const destPath = join(audioDir, `${id}.mp3`);
    renameSync(req.file.path, destPath);

    const audioUrl = `/api/v1/knowledge/audio/${id}`;
    db.prepare('UPDATE knowledge_entries SET audio_url = ? WHERE id = ? AND tenant_id = ?')
      .run(audioUrl, id, tenantId);

    res.json({ audio_url: audioUrl });
  } catch (error) {
    console.error('Audio upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /recent - Get most recent knowledge entries
 */
router.get('/recent', async (req, res) => {
  try {
    const { tenantId } = resolveIds(req);
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const type = req.query.type || null;
    const entries = db.prepare(`
      SELECT id, type, title, summary, source, source_agent, duration_seconds, recorded_at, created_at, processed, drive_url, audio_url, share_token, share_enabled
      FROM knowledge_entries
      WHERE tenant_id = ? ${type ? "AND type = ?" : ""}
      ORDER BY created_at DESC
      LIMIT ?
    `).all(...(type ? [tenantId, type, limit] : [tenantId, limit]));

    res.json(entries);
  } catch (error) {
    console.error('Knowledge recent error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /entries/:id - Full entry detail with transcript, action items, and linked entities
 */
router.get('/entries/:id', async (req, res) => {
  try {
    const { tenantId } = resolveIds(req);
    const { id } = req.params;

    const entry = db.prepare(`
      SELECT * FROM knowledge_entries WHERE id = ? AND tenant_id = ?
    `).get(id, tenantId);

    if (!entry) {
      return res.status(404).json({ error: 'Entry not found' });
    }

    const actionItems = db.prepare(`
      SELECT * FROM action_items WHERE entry_id = ? AND tenant_id = ?
      ORDER BY status ASC, due_date ASC
    `).all(id, tenantId);

    const entities = db.prepare(`
      SELECT ke.* FROM knowledge_entities ke
      JOIN knowledge_links kl ON kl.entity_id = ke.id
      WHERE kl.entry_id = ?
    `).all(id);

    res.json({ ...entry, action_items: actionItems, entities });
  } catch (error) {
    console.error('Knowledge entry detail error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /entities - List all entities for the tenant (people, companies, projects)
 */
router.get('/entities', async (req, res) => {
  try {
    const { tenantId } = resolveIds(req);
    const type = req.query.type; // optional filter: person, company, project
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);

    let query = `
      SELECT ke.*, COUNT(kl.id) as mention_count
      FROM knowledge_entities ke
      LEFT JOIN knowledge_links kl ON kl.entity_id = ke.id
      WHERE ke.tenant_id = ?
    `;
    const params = [tenantId];

    if (type) {
      query += ' AND ke.entity_type = ?';
      params.push(type);
    }

    query += ' GROUP BY ke.id ORDER BY mention_count DESC LIMIT ?';
    params.push(limit);

    const entities = db.prepare(query).all(...params);
    res.json(entities);
  } catch (error) {
    console.error('Knowledge entities error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /entities/:id - Delete an entity
 */
router.delete('/entities/:id', async (req, res) => {
  try {
    const { tenantId } = resolveIds(req);
    const { id } = req.params;

    // Delete related links first
    db.prepare('DELETE FROM knowledge_links WHERE entity_id = ?').run(id);
    // Delete the entity
    const result = db.prepare('DELETE FROM knowledge_entities WHERE id = ? AND tenant_id = ?').run(id, tenantId);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Entity not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Delete entity error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /meeting-complete - Process a completed meeting: extract per-person tasks + send emails
 *
 * Called by MeetingBot after transcription + summarization.
 * Body: { title, transcript, summary, attendees: string[] }
 */
router.post('/meeting-complete', async (req, res) => {
  try {
    // Allow tenant override for machine-to-machine calls (local recorder)
    const { tenantId: defaultTenantId } = resolveIds(req);
    const tenantId = req.body.tenant_id || defaultTenantId;
    const { title, transcript, summary, attendees, duration_seconds, recorded_at } = req.body;

    if (!transcript || !attendees?.length) {
      return res.status(400).json({ error: 'transcript and attendees are required' });
    }

    // 1. Ingest into knowledge base
    const entryId = `KN-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    db.prepare(`
      INSERT INTO knowledge_entries (id, tenant_id, type, title, transcript, content, source, source_agent, duration_seconds, recorded_at)
      VALUES (?, ?, 'meeting', ?, ?, ?, 'local-recorder', 'coppice', ?, ?)
    `).run(
      entryId, tenantId,
      title || 'Untitled Meeting',
      transcript,
      summary || null,
      duration_seconds || null,
      recorded_at || new Date().toISOString(),
    );

    // 2. Run standard knowledge processing (entities, Drive upload, etc.)
    processKnowledgeEntry(entryId, tenantId).catch(err => {
      console.error(`Knowledge processing failed for ${entryId}:`, err.message);
    });

    // 3. Run meeting-specific processing (per-person tasks + emails) async
    processMeetingComplete({
      tenantId,
      entryId,
      meetingTitle: title || 'Untitled Meeting',
      transcript,
      summary: summary || '',
      attendees,
    }).then(result => {
      console.log(`[MeetingComplete] Done: ${result.actionItemsInserted} items, ${result.emailsSent.length} emails`);
    }).catch(err => {
      console.error(`[MeetingComplete] Failed:`, err.message);
    });

    res.json({ id: entryId, status: 'processing', message: 'Meeting ingested - extracting tasks and sending emails' });
  } catch (error) {
    console.error('Meeting-complete error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
