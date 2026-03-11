/**
 * Knowledge Routes — Ingestion, search, and entity queries
 *
 * POST   /api/v1/knowledge/ingest         — Ingest a transcript/document
 * GET    /api/v1/knowledge/search         — Search knowledge base
 * GET    /api/v1/knowledge/entity/:name   — Get everything linked to an entity
 * GET    /api/v1/knowledge/action-items   — Get open action items
 * GET    /api/v1/knowledge/recent         — Get recent entries
 */

import express from 'express';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  processKnowledgeEntry,
  searchKnowledge,
  getEntityKnowledge,
  getOpenActionItems,
} from '../services/knowledgeProcessor.js';
import { processMeetingComplete } from '../services/meetingProcessor.js';
import { insertActivity } from '../cache/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const db = new Database(join(__dirname, '../../data/cache.db'));

const router = express.Router();

function resolveIds(req) {
  const tenantId = req.resolvedTenant?.id || 'default';
  const userId = req.user?.id || 'anonymous';
  return { tenantId, userId };
}

/**
 * POST /ingest — Ingest a transcript, document, or call recording
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
      subtitle: `${type} — ${(content || transcript || '').slice(0, 80)}`,
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
 * GET /search — Search across all knowledge entries
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
 * GET /entity/:name — Get everything linked to a specific entity
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
 * GET /action-items — Get action items (open by default, or all)
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
 * PATCH /action-items/:id — Update action item status
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
 * GET /recent — Get most recent knowledge entries
 */
router.get('/recent', async (req, res) => {
  try {
    const { tenantId } = resolveIds(req);
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const entries = db.prepare(`
      SELECT id, type, title, summary, source, source_agent, duration_seconds, recorded_at, created_at, processed, drive_url
      FROM knowledge_entries
      WHERE tenant_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(tenantId, limit);

    res.json(entries);
  } catch (error) {
    console.error('Knowledge recent error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /meeting-complete — Process a completed meeting: extract per-person tasks + send emails
 *
 * Called by MeetingBot after transcription + summarization.
 * Body: { title, transcript, summary, attendees: string[] }
 */
router.post('/meeting-complete', async (req, res) => {
  try {
    const { tenantId } = resolveIds(req);
    const { title, transcript, summary, attendees } = req.body;

    if (!transcript || !attendees?.length) {
      return res.status(400).json({ error: 'transcript and attendees are required' });
    }

    // 1. Ingest into knowledge base
    const entryId = `KN-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    db.prepare(`
      INSERT INTO knowledge_entries (id, tenant_id, type, title, transcript, content, source, source_agent, recorded_at)
      VALUES (?, ?, 'meeting', ?, ?, ?, 'meetingbot', 'coppice', ?)
    `).run(
      entryId, tenantId,
      title || 'Untitled Meeting',
      transcript,
      summary || null,
      new Date().toISOString(),
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

    res.json({ id: entryId, status: 'processing', message: 'Meeting ingested — extracting tasks and sending emails' });
  } catch (error) {
    console.error('Meeting-complete error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
