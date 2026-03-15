/**
 * Knowledge Processor — AI-powered ingestion pipeline
 *
 * Takes raw transcripts/documents, uses Claude to:
 * 1. Summarize content
 * 2. Extract entities (people, companies, projects)
 * 3. Link to known entities in the knowledge graph
 * 4. Extract action items
 * 5. Upload formatted doc to Google Drive
 * 6. Send notification
 */

import Anthropic from '@anthropic-ai/sdk';
import { getCurrentTenantId, getTenantDb } from '../cache/database.js';

// Lazy DB accessor — resolves to the current tenant's DB via AsyncLocalStorage context
const db = new Proxy({}, {
  get(target, prop) {
    const tenantId = getCurrentTenantId() || 'default';
    const realDb = getTenantDb(tenantId);
    const val = realDb[prop];
    if (typeof val === 'function') return val.bind(realDb);
    return val;
  },
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const WORKSPACE_AGENT_URL = process.env.WORKSPACE_AGENT_URL || 'http://localhost:3010';

// ─── Prepared Statements ────────────────────────────────────────────────────

let _stmts;
function getStmts() {
  if (!_stmts) {
    _stmts = {
      getEntry: db.prepare('SELECT * FROM knowledge_entries WHERE id = ?'),
      updateSummary: db.prepare('UPDATE knowledge_entries SET summary = ?, title = ?, processed = 1 WHERE id = ?'),
      updateDrive: db.prepare('UPDATE knowledge_entries SET drive_file_id = ?, drive_url = ? WHERE id = ?'),
      getEntities: db.prepare('SELECT * FROM knowledge_entities WHERE tenant_id = ?'),
      insertEntity: db.prepare('INSERT OR IGNORE INTO knowledge_entities (id, tenant_id, entity_type, name, metadata_json) VALUES (?, ?, ?, ?, ?)'),
      insertLink: db.prepare('INSERT OR IGNORE INTO knowledge_links (id, entry_id, entity_id, relationship) VALUES (?, ?, ?, ?)'),
      insertActionItem: db.prepare('INSERT INTO action_items (id, tenant_id, entry_id, title, assignee, due_date) VALUES (?, ?, ?, ?, ?, ?)'),
      insertNotification: db.prepare(`
        INSERT INTO platform_notifications (id, tenant_id, user_id, agent_id, title, body, type, link_tab)
        VALUES (?, ?, ?, 'workspace', ?, ?, 'info', 'audit-trail')
      `),
      getAdmins: db.prepare("SELECT id FROM users WHERE tenant_id = ? AND role IN ('admin', 'owner')"),
    };
  }
  return _stmts;
}

// ─── Fuzzy Entity Matching ──────────────────────────────────────────────────

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function findMatchingEntity(entities, name, type) {
  const normalized = name.toLowerCase().trim();
  return entities.find(e => {
    if (e.entity_type !== type) return false;
    const eName = e.name.toLowerCase();
    return eName === normalized
      || eName.includes(normalized)
      || normalized.includes(eName)
      || levenshtein(eName, normalized) < 3;
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function getFolderForType(type) {
  const folders = {
    call_recording: '/Call Notes/',
    meeting: '/Meeting Notes/',
    email: '/Email Archive/',
    note: '/Notes/',
    document: '/Documents/',
    decision: '/Decisions/',
  };
  return folders[type] || '/Knowledge/';
}

function formatForDrive(entry, parsed) {
  let md = `# ${parsed.title || entry.title}\n\n`;
  md += `**Date:** ${entry.recorded_at || entry.created_at}\n`;
  md += `**Source:** ${entry.source}\n`;
  if (entry.duration_seconds) {
    md += `**Duration:** ${Math.round(entry.duration_seconds / 60)} minutes\n`;
  }
  md += `\n## Summary\n\n${parsed.summary}\n`;

  if (parsed.decisions?.length > 0) {
    md += `\n## Key Decisions\n\n`;
    parsed.decisions.forEach(d => { md += `- ${d}\n`; });
  }

  if (parsed.action_items?.length > 0) {
    md += `\n## Action Items\n\n`;
    parsed.action_items.forEach(a => {
      md += `- ${a.task}`;
      if (a.assignee) md += ` — ${a.assignee}`;
      if (a.due_date) md += ` (${a.due_date})`;
      md += `\n`;
    });
  }

  if (entry.transcript) {
    md += `\n## Full Transcript\n\n${entry.transcript}\n`;
  }

  return md;
}

// ─── Main Processing Pipeline ───────────────────────────────────────────────

export async function processKnowledgeEntry(entryId, tenantId) {
  const entry = getStmts().getEntry.get(entryId);
  if (!entry) {
    console.error(`Knowledge entry ${entryId} not found`);
    return;
  }

  const textContent = entry.transcript || entry.content;
  if (!textContent) {
    getStmts().updateSummary.run(entry.title, entry.title, entryId);
    return;
  }

  // ─── Step 1: AI Analysis ───
  let parsed;
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      // No API key — use basic extraction
      parsed = {
        summary: textContent.slice(0, 200) + '...',
        title: entry.title,
        people: [],
        companies: [],
        projects: [],
        action_items: [],
        decisions: [],
        topics: [],
      };
    } else {
      const model = textContent.length > 3000 ? 'claude-sonnet-4-20250514' : 'claude-haiku-4-5-20251001';

      const analysis = await anthropic.messages.create({
        model,
        max_tokens: 2000,
        system: `You are a knowledge extraction agent. Given a transcript or document, output JSON with:
- summary: 2-3 sentence summary
- title: a descriptive title if the provided title is generic
- people: array of full names mentioned
- companies: array of company names mentioned
- projects: array of project names mentioned
- action_items: array of {task, assignee, due_date} extracted from the content
- decisions: array of key decisions made
- topics: array of topic tags (e.g. "pricing", "timeline", "legal", "technical")

Output ONLY valid JSON.`,
        messages: [{ role: 'user', content: textContent }],
      });

      parsed = JSON.parse(analysis.content[0].text);
    }
  } catch (err) {
    console.error(`Knowledge processing AI error for ${entryId}:`, err.message);
    parsed = {
      summary: textContent.slice(0, 200) + '...',
      title: entry.title,
      people: [], companies: [], projects: [],
      action_items: [], decisions: [], topics: [],
    };
  }

  // ─── Step 2: Update entry ───
  getStmts().updateSummary.run(
    parsed.summary || '',
    parsed.title || entry.title,
    entryId,
  );

  // ─── Step 3: Link entities ───
  const allEntities = getStmts().getEntities.all(tenantId);

  const linkEntity = (name, type, relationship) => {
    const entity = findMatchingEntity(allEntities, name, type);
    if (entity) {
      getStmts().insertLink.run(`KL-${uid()}`, entryId, entity.id, relationship);
    } else {
      // Create new entity
      const newId = `ENT-${uid()}`;
      getStmts().insertEntity.run(newId, tenantId, type, name, null);
      getStmts().insertLink.run(`KL-${uid()}`, entryId, newId, relationship);
      allEntities.push({ id: newId, tenant_id: tenantId, entity_type: type, name });
    }
  };

  for (const person of parsed.people || []) {
    linkEntity(person, 'person', 'mentions');
  }
  for (const company of parsed.companies || []) {
    linkEntity(company, 'company', 'mentions');
  }
  for (const project of parsed.projects || []) {
    linkEntity(project, 'project', 'about');
  }

  // ─── Step 4: Action items ───
  for (const item of parsed.action_items || []) {
    getStmts().insertActionItem.run(
      `AI-${uid()}`, tenantId, entryId,
      item.task, item.assignee || null, item.due_date || null,
    );
  }

  // ─── Step 5: Upload to Google Drive ───
  const docContent = formatForDrive(entry, parsed);
  try {
    const res = await fetch(`${WORKSPACE_AGENT_URL}/tools/workspace_create_doc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id': tenantId,
        'X-Internal-Secret': process.env.WORKSPACE_INTERNAL_SECRET || 'dev-secret',
      },
      body: JSON.stringify({
        title: parsed.title || entry.title,
        folder: getFolderForType(entry.type),
        content: docContent,
      }),
    });

    if (res.ok) {
      const driveResult = await res.json();
      getStmts().updateDrive.run(driveResult.file_id, driveResult.url, entryId);
    }
  } catch (err) {
    // Non-fatal — entry is still in the database
    console.warn('Drive upload failed (non-fatal):', err.message);
  }

  // ─── Step 6: Notification ───
  try {
    const admins = getStmts().getAdmins.all(tenantId);
    const notifTitle = entry.type === 'call_recording'
      ? `Call transcribed: ${parsed.title || entry.title}`
      : `New ${entry.type}: ${parsed.title || entry.title}`;
    const notifBody = `${parsed.summary || ''}\n\n${(parsed.action_items || []).length} action items extracted.`;

    for (const admin of admins) {
      getStmts().insertNotification.run(
        `NOTIF-${uid()}`, tenantId, admin.id,
        notifTitle, notifBody,
      );
    }
  } catch (err) {
    console.warn('Notification failed (non-fatal):', err.message);
  }

  console.log(`Knowledge entry ${entryId} processed: "${parsed.title || entry.title}" — ${(parsed.action_items || []).length} action items`);
}

// ─── Knowledge Search (used by chat context injection) ──────────────────────

export function searchKnowledge(tenantId, query, { type, entity, limit = 20 } = {}) {
  let sql = `
    SELECT ke.*, GROUP_CONCAT(DISTINCT ent.name) as linked_entities
    FROM knowledge_entries ke
    LEFT JOIN knowledge_links kl ON ke.id = kl.entry_id
    LEFT JOIN knowledge_entities ent ON kl.entity_id = ent.id
    WHERE ke.tenant_id = ?
  `;
  const params = [tenantId];

  if (query) {
    sql += ` AND (ke.title LIKE ? OR ke.summary LIKE ? OR ke.transcript LIKE ?)`;
    params.push(`%${query}%`, `%${query}%`, `%${query}%`);
  }
  if (type) {
    sql += ` AND ke.type = ?`;
    params.push(type);
  }
  if (entity) {
    sql += ` AND ent.name LIKE ?`;
    params.push(`%${entity}%`);
  }

  sql += ` GROUP BY ke.id ORDER BY ke.created_at DESC LIMIT ?`;
  params.push(limit);

  return db.prepare(sql).all(...params);
}

export function getOpenActionItems(tenantId, limit = 10) {
  return db.prepare(`
    SELECT ai.*, ke.title as source_title, ke.type as source_type
    FROM action_items ai
    JOIN knowledge_entries ke ON ai.entry_id = ke.id
    WHERE ai.tenant_id = ? AND ai.status = 'open'
    ORDER BY ai.due_date ASC
    LIMIT ?
  `).all(tenantId, limit);
}

export function getEntityKnowledge(tenantId, entityName) {
  const entity = db.prepare(
    'SELECT * FROM knowledge_entities WHERE tenant_id = ? AND name LIKE ?'
  ).get(tenantId, `%${entityName}%`);

  if (!entity) return { entity: null, entries: [] };

  const entries = db.prepare(`
    SELECT ke.* FROM knowledge_entries ke
    JOIN knowledge_links kl ON ke.id = kl.entry_id
    WHERE kl.entity_id = ?
    ORDER BY ke.created_at DESC
  `).all(entity.id);

  return { entity, entries };
}
