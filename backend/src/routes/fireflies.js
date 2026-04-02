/**
 * Fireflies.ai Integration Routes
 *
 * Lets users connect their Fireflies account via API key and import
 * past meeting transcripts into the Coppice knowledge base.
 *
 * POST /api/v1/fireflies/connect     - Save API key
 * GET  /api/v1/fireflies/status      - Check connection status
 * DELETE /api/v1/fireflies/disconnect - Remove API key
 * GET  /api/v1/fireflies/transcripts - List transcripts from Fireflies
 * POST /api/v1/fireflies/import      - Import all transcripts into knowledge base
 */

import express from 'express';
import crypto from 'crypto';
import {
  getKeyVaultValue,
  upsertKeyVaultEntry,
  getTenantDb,
} from '../cache/database.js';
import { processMeetingComplete } from '../services/meetingProcessor.js';

const router = express.Router();

const FIREFLIES_API = 'https://api.fireflies.ai/graphql';

// ---- Helpers ----------------------------------------------------------------

async function firefliesQuery(apiKey, query, variables = {}) {
  const res = await fetch(FIREFLIES_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Fireflies API ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  if (data.errors?.length) {
    throw new Error(data.errors[0].message || 'Fireflies GraphQL error');
  }
  return data.data;
}

function getApiKey(tenantId) {
  return getKeyVaultValue(tenantId, 'fireflies', 'api_key');
}

// ---- Routes -----------------------------------------------------------------

/** POST /connect - Save Fireflies API key */
router.post('/connect', async (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || req.user.tenantId;
    const { api_key } = req.body;
    if (!api_key) return res.status(400).json({ error: 'api_key is required' });

    // Validate the key by fetching user info
    const data = await firefliesQuery(api_key, '{ user { name email } }');
    if (!data?.user) throw new Error('Invalid API key - could not fetch user');

    // Save to key vault
    upsertKeyVaultEntry({
      tenantId,
      service: 'fireflies',
      keyName: 'api_key',
      keyValue: api_key,
      addedBy: req.user?.id || 'user',
    });

    console.log(`[Fireflies] Connected for tenant ${tenantId} (user: ${data.user.email})`);
    res.json({ connected: true, user: data.user });
  } catch (err) {
    console.error('[Fireflies] Connect error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

/** GET /status - Check connection status */
router.get('/status', async (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || req.user.tenantId;
    const apiKey = getApiKey(tenantId);
    if (!apiKey) return res.json({ connected: false });

    const data = await firefliesQuery(apiKey, '{ user { name email } }');
    res.json({ connected: true, user: data.user });
  } catch (err) {
    res.json({ connected: false, error: err.message });
  }
});

/** DELETE /disconnect - Remove API key */
router.delete('/disconnect', (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || req.user.tenantId;
    const db = getTenantDb(tenantId);
    db.prepare("DELETE FROM key_vault WHERE tenant_id = ? AND service = 'fireflies'").run(tenantId);
    res.json({ disconnected: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /transcripts - List transcripts from Fireflies */
router.get('/transcripts', async (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || req.user.tenantId;
    const apiKey = getApiKey(tenantId);
    if (!apiKey) return res.status(400).json({ error: 'Fireflies not connected' });

    const limit = parseInt(req.query.limit) || 50;
    const skip = parseInt(req.query.skip) || 0;

    const data = await firefliesQuery(apiKey, `
      query ($limit: Int, $skip: Int) {
        transcripts(limit: $limit, skip: $skip) {
          id
          title
          date
          duration
          meeting_attendees { displayName email }
        }
      }
    `, { limit, skip });

    res.json({ transcripts: data.transcripts || [] });
  } catch (err) {
    console.error('[Fireflies] List error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** POST /import - Import transcripts into knowledge base */
router.post('/import', async (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || req.user.tenantId;
    const apiKey = getApiKey(tenantId);
    if (!apiKey) return res.status(400).json({ error: 'Fireflies not connected' });

    const db = getTenantDb(tenantId);

    // Get existing fireflies IDs to avoid duplicates
    const existing = new Set(
      db.prepare("SELECT source FROM knowledge_entries WHERE tenant_id = ? AND source LIKE 'fireflies-%'")
        .all(tenantId)
        .map(r => r.source)
    );

    // Fetch all transcripts (paginate)
    let allTranscripts = [];
    let skip = 0;
    const pageSize = 50;
    while (true) {
      const data = await firefliesQuery(apiKey, `
        query ($limit: Int, $skip: Int) {
          transcripts(limit: $limit, skip: $skip) {
            id
            title
            date
            duration
          }
        }
      `, { limit: pageSize, skip });

      const page = data.transcripts || [];
      allTranscripts.push(...page);
      if (page.length < pageSize) break;
      skip += pageSize;
    }

    // Filter out already-imported
    const toImport = allTranscripts.filter(t => !existing.has(`fireflies-${t.id}`));
    console.log(`[Fireflies] tenant=${tenantId}: ${allTranscripts.length} total, ${toImport.length} new to import`);

    if (toImport.length === 0) {
      return res.json({ imported: 0, total: allTranscripts.length, skipped: allTranscripts.length });
    }

    // Import each transcript with full details
    let imported = 0;
    let errors = 0;

    for (const t of toImport) {
      try {
        const detail = await firefliesQuery(apiKey, `
          query ($id: String!) {
            transcript(id: $id) {
              id
              title
              date
              duration
              transcript_url
              summary {
                gist
                action_items
                overview
                shorthand_bullet
              }
              meeting_attendees { displayName email name }
              sentences {
                text
                speaker_name
                start_time
                end_time
              }
            }
          }
        `, { id: t.id });

        const tx = detail.transcript;
        if (!tx) continue;

        // Build plain transcript from sentences
        const sentences = tx.sentences || [];
        const plainTranscript = sentences.map(s =>
          `${s.speaker_name || 'Unknown'}: ${s.text}`
        ).join('\n');

        // Build transcript_json for diarized viewer
        const transcriptJson = sentences.map(s => ({
          speaker: s.speaker_name || 'Unknown',
          text: s.text,
          start: s.start_time,
          end: s.end_time,
        }));

        // Build summary from Fireflies summary fields
        const summaryParts = [];
        if (tx.summary?.overview) summaryParts.push(`## Overview\n${tx.summary.overview}`);
        if (tx.summary?.gist) summaryParts.push(`## Summary\n${tx.summary.gist}`);
        if (tx.summary?.shorthand_bullet) summaryParts.push(`## Key Points\n${tx.summary.shorthand_bullet}`);
        if (tx.summary?.action_items) summaryParts.push(`## Action Items\n${tx.summary.action_items}`);
        const summary = summaryParts.join('\n\n') || null;

        // Attendees string
        const attendees = (tx.meeting_attendees || [])
          .map(a => a.displayName || a.name || a.email || 'Unknown')
          .join(', ');

        const id = `ff-${tx.id}`;
        const recordedAt = tx.date ? new Date(parseInt(tx.date)).toISOString() : new Date().toISOString();

        db.prepare(`
          INSERT OR IGNORE INTO knowledge_entries
            (id, tenant_id, type, title, transcript, content, summary, source, source_agent, duration_seconds, recorded_at, processed, transcript_json)
          VALUES (?, ?, 'meeting', ?, ?, ?, ?, ?, 'fireflies', ?, ?, 0, ?)
        `).run(
          id, tenantId,
          tx.title || 'Untitled Meeting',
          plainTranscript || '',
          attendees ? `Attendees: ${attendees}\n\n${plainTranscript}` : plainTranscript,
          summary,
          `fireflies-${tx.id}`,
          tx.duration ? Math.round(tx.duration * 60) : null, // Fireflies returns minutes, store as seconds
          recordedAt,
          transcriptJson.length > 0 ? JSON.stringify(transcriptJson) : null,
        );

        // Trigger AI processing if we got content
        if (plainTranscript && plainTranscript.length > 50) {
          try {
            processMeetingComplete(tenantId, id, tx.title, plainTranscript, summary).catch(() => {});
          } catch {}
        }

        imported++;

        // Rate limit - 50 req/day on free, 60/min on business
        if (imported % 5 === 0) await new Promise(r => setTimeout(r, 1000));
      } catch (err) {
        console.error(`[Fireflies] Failed to import ${t.id}: ${err.message}`);
        errors++;
      }
    }

    console.log(`[Fireflies] Import complete: ${imported} imported, ${errors} errors, ${existing.size} already existed`);
    res.json({
      imported,
      errors,
      total: allTranscripts.length,
      skipped: existing.size,
    });
  } catch (err) {
    console.error('[Fireflies] Import error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
