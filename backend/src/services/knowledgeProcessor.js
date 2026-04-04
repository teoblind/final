/**
 * Knowledge Processor - AI-powered ingestion pipeline
 *
 * Takes raw transcripts/documents, uses Claude to:
 * 1. Summarize content
 * 2. Extract entities (people, companies, projects)
 * 3. Link to known entities in the knowledge graph
 * 4. Extract action items
 * 5. Upload formatted doc to Google Drive
 * 6. Send notification
 * 7. Contradiction detection - if a meeting transcript contradicts a prior report,
 *    auto-propose a copilot assignment to redo the analysis
 */

import Anthropic from '@anthropic-ai/sdk';
import { tunnelPrompt } from './cliTunnel.js';
import { getCurrentTenantId, getTenantDb, insertAgentAssignment, updateAgentAssignment , SANGHA_TENANT_ID } from '../cache/database.js';

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
      if (a.assignee) md += ` - ${a.assignee}`;
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
      // No API key - use basic extraction
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
      const isMeeting = entry.type === 'meeting' || entry.type === 'meeting-transcript' || entry.source === 'local-capture' || entry.source === 'recall-bot';
      const summaryInstructions = isMeeting
        ? `- summary: A dense, comprehensive Fireflies-style meeting summary in markdown. Aim for 2000-4000 words. Use these exact section headers:

  ## Overview
  5-8 short bullet points summarizing the key themes. Each bullet: **Bold Topic**: one sentence summary.

  ## Notes
  Organize into 3-6 major THEMES (not chronological). Each theme is a ### heading, followed by 3-6 sub-topics. Each sub-topic has:
  - A **bold sub-topic name** with timestamp in parentheses (MM:SS)
  - 3-5 bullet points with specific details, numbers, names, conclusions, and context

  ## Action Items
  Organize by PERSON. For each person, list their specific action items with timestamps:
  **Person Name**
  - Specific task with context and details (MM:SS)

  Be extremely thorough. Extract MAXIMUM information. Use specific names, numbers, dollar amounts, percentages, dates, and technical details. Every bullet must contain specific information from this particular meeting. Do not be generic. Do not use em dashes.

  CRITICAL: NEVER invent or hallucinate names. Speaker names appear in the transcript as "Name:" at the start of lines. Use ONLY those exact names.`
        : `- summary: A structured summary in markdown. Use these exact section headers:

  ## Overview
  2-3 sentence high-level summary.

  ## Topics Discussed
  - **Topic Name** - one sentence on what was covered (3-8 items)

  ## Key Decisions
  - Decision with context (only if decisions were actually made; omit section if none)

  ## Notable Quotes
  - "Exact quote or close paraphrase" - Speaker Name (only 2-4 most important; omit if none)

  ## Next Steps
  - Brief description of what happens next - Owner (if known)`;

      const systemInstructions = `You are a knowledge extraction agent. Given a transcript or document, output JSON with:

${summaryInstructions}

- title: a descriptive title if the provided title is generic
- people: array of full names mentioned
- companies: array of company names mentioned
- projects: array of project names mentioned
- action_items: array of {task, assignee, due_date} extracted from the content
- decisions: array of key decisions made
- topics: array of topic tags (e.g. "pricing", "timeline", "legal", "technical")

Output ONLY valid JSON. The summary field should be the full structured markdown.`;

      // Short content → Haiku API (cheap, fast). Long content → CLI tunnel (Opus quality, flat rate).
      let analysisText;
      if (textContent.length <= 3000) {
        const analysis = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 3000,
          system: systemInstructions,
          messages: [{ role: 'user', content: textContent }],
        });
        analysisText = analysis.content[0].text;
      } else {
        analysisText = await tunnelPrompt({
          tenantId: tenantId || SANGHA_TENANT_ID,
          agentId: 'knowledge',
          prompt: `${systemInstructions}\n\n---\n\n${textContent}`,
          maxTurns: 3,
          timeoutMs: 120_000,
          label: 'Knowledge Processing',
        });
      }

      parsed = JSON.parse(analysisText);
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

  // ─── Step 3b: Contact enrichment for email observations ───
  if (entry.type === 'email-observation') {
    try {
      const contentData = JSON.parse(entry.content);
      const senderEmail = contentData.from;
      if (senderEmail) {
        // Find contact entity by email in metadata, or by extracted person name
        let contactEntity = allEntities.find(e => {
          if (e.entity_type !== 'person' || !e.metadata_json) return false;
          try { return JSON.parse(e.metadata_json).email?.toLowerCase() === senderEmail.toLowerCase(); } catch { return false; }
        });

        if (!contactEntity && (parsed.people || []).length > 0) {
          contactEntity = findMatchingEntity(allEntities, parsed.people[0], 'person');
        }

        if (contactEntity) {
          const existing = contactEntity.metadata_json ? JSON.parse(contactEntity.metadata_json) : {};
          existing.email = existing.email || senderEmail;
          existing.lastObserved = new Date().toISOString();
          existing.observedTopics = [...new Set([...(existing.observedTopics || []), ...(parsed.topics || [])])];
          if (parsed.summary) {
            existing.recentContext = (existing.recentContext || []).slice(-4);
            existing.recentContext.push({ date: new Date().toISOString(), summary: parsed.summary });
          }
          db.prepare('UPDATE knowledge_entities SET metadata_json = ? WHERE id = ?')
            .run(JSON.stringify(existing), contactEntity.id);
        }
      }
    } catch (err) {
      console.warn('Contact enrichment failed (non-fatal):', err.message);
    }
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
    // Non-fatal - entry is still in the database
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

  console.log(`Knowledge entry ${entryId} processed: "${parsed.title || entry.title}" - ${(parsed.action_items || []).length} action items`);

  // ─── Step 7: Contradiction detection (meeting transcripts only) ───
  if (entry.type === 'meeting-transcript' && parsed.summary) {
    try {
      await detectContradictions(tenantId, entryId, entry, parsed);
    } catch (err) {
      console.warn(`[KnowledgeProcessor] Contradiction detection failed (non-fatal): ${err.message}`);
    }
  }
}

// ─── Contradiction Detection ─────────────────────────────────────────────────
// When a meeting transcript is ingested, check if it contradicts any prior
// completed assignments (reports, analyses). If so, auto-propose a copilot
// assignment to redo the report with corrected information.

async function detectContradictions(tenantId, entryId, entry, parsed) {
  // 1. Find completed assignments that overlap with this transcript's topics/entities
  const completedAssignments = db.prepare(`
    SELECT * FROM agent_assignments
    WHERE tenant_id = ? AND status = 'completed' AND result_summary IS NOT NULL
    ORDER BY completed_at DESC LIMIT 20
  `).all(tenantId);

  if (completedAssignments.length === 0) return;

  // 2. Build a concise representation of the new transcript
  const meetingContent = parsed.summary || '';
  const meetingTitle = parsed.title || entry.title || '';
  const meetingEntities = [
    ...(parsed.people || []),
    ...(parsed.companies || []),
    ...(parsed.projects || []),
  ];

  // 3. Find assignments that share entities or topics with this transcript
  const candidates = completedAssignments.filter(a => {
    const titleLower = (a.title || '').toLowerCase();
    const descLower = (a.description || '').toLowerCase();
    const resultLower = (a.result_summary || '').toLowerCase();
    const combined = `${titleLower} ${descLower} ${resultLower}`;

    // Check for entity overlap
    for (const entity of meetingEntities) {
      if (combined.includes(entity.toLowerCase())) return true;
    }
    // Check for topic keyword overlap
    for (const topic of parsed.topics || []) {
      if (combined.includes(topic.toLowerCase())) return true;
    }
    return false;
  });

  if (candidates.length === 0) return;

  // 4. Ask Claude to identify contradictions
  const candidateSummaries = candidates.slice(0, 5).map(a =>
    `REPORT ID: ${a.id}\nTITLE: ${a.title}\nDATE: ${a.completed_at}\nSUMMARY: ${(a.result_summary || '').slice(0, 2000)}`
  ).join('\n\n---\n\n');

  const contradictionPrompt = `You are a fact-checking agent. A new meeting transcript has been ingested. Compare its content against prior reports/analyses to find factual contradictions.

MEETING TRANSCRIPT SUMMARY:
Title: ${meetingTitle}
${meetingContent.slice(0, 4000)}

PRIOR REPORTS:
${candidateSummaries}

OUTPUT VALID JSON with this structure:
{
  "hasContradictions": true/false,
  "contradictions": [
    {
      "reportId": "the assignment ID",
      "reportTitle": "title of the contradicted report",
      "claim": "what the prior report stated",
      "correction": "what the meeting transcript reveals instead",
      "severity": "high" or "medium" or "low"
    }
  ]
}

Only flag genuine factual contradictions (wrong names, wrong numbers, wrong locations, wrong assumptions). NOT differences in opinion or emphasis. Output ONLY valid JSON.`;

  let contradictionResult;
  try {
    if (!process.env.ANTHROPIC_API_KEY) return;

    const analysis = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      messages: [{ role: 'user', content: contradictionPrompt }],
    });
    contradictionResult = JSON.parse(analysis.content[0].text);
  } catch (err) {
    console.warn(`[KnowledgeProcessor] Contradiction analysis failed: ${err.message}`);
    return;
  }

  if (!contradictionResult?.hasContradictions || !contradictionResult.contradictions?.length) return;

  // 5. Create a proposed copilot assignment to redo the report
  const contradictions = contradictionResult.contradictions;
  const highSeverity = contradictions.filter(c => c.severity === 'high');
  const affectedReports = [...new Set(contradictions.map(c => c.reportTitle))];

  const contradictionList = contradictions.map(c =>
    `- **${c.severity.toUpperCase()}**: Report "${c.reportTitle}" stated: "${c.claim}" → Meeting reveals: "${c.correction}"`
  ).join('\n');

  const assignmentId = `assign-contradict-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  insertAgentAssignment({
    id: assignmentId,
    tenant_id: tenantId,
    agent_id: 'coppice',
    title: `⚠ Report Correction Needed: ${affectedReports[0] || 'Prior Analysis'}`,
    description: `A meeting transcript ("${meetingTitle}") contains information that contradicts ${contradictions.length} finding(s) in prior report(s). ${highSeverity.length > 0 ? `${highSeverity.length} HIGH severity contradiction(s).` : ''}\n\n### Contradictions Found:\n${contradictionList}\n\n### Recommendation:\nRedo the analysis with corrected information from the meeting. The original report may have been based on outdated or incorrect assumptions.`,
    category: 'analysis',
    priority: highSeverity.length > 0 ? 'high' : 'medium',
    action_prompt: `A recent meeting transcript ("${meetingTitle}") contradicts a previous report. Your job is to redo the analysis with the correct information.

CONTRADICTIONS IDENTIFIED:
${contradictions.map(c => `- Report "${c.reportTitle}" said: "${c.claim}"\n  Correct per meeting: "${c.correction}" (severity: ${c.severity})`).join('\n')}

INSTRUCTIONS:
1. Review ALL knowledge entries related to this topic (use the context provided)
2. Identify everything that needs to change based on the new information
3. Create a corrected report as a Google Doc, clearly marking what changed and why
4. Include a "Corrections" section at the top listing each change from the original report
5. If you are missing any information needed for the corrected report, use INFO_REQUEST

This is a copilot task - produce the deliverable for human review before any external communication.`,
    context_json: JSON.stringify({
      sourceEntryId: entryId,
      contradictions,
      affectedReportIds: contradictions.map(c => c.reportId),
    }),
  });

  // Set source fields
  try {
    updateAgentAssignment(tenantId, assignmentId, {
      source_type: 'contradiction-detection',
      knowledge_entry_ids_json: JSON.stringify([entryId]),
    });
  } catch {}

  console.log(`[KnowledgeProcessor] Contradiction detected! Created proposed assignment ${assignmentId} - ${contradictions.length} contradiction(s) vs ${affectedReports.length} report(s)`);
}

// ─── Knowledge Search (used by chat context injection) ──────────────────────

export function searchKnowledge(tenantId, query, { type, entity, limit = 20, accessTier = 'internal' } = {}) {
  let sql = `
    SELECT ke.*, GROUP_CONCAT(DISTINCT ent.name) as linked_entities
    FROM knowledge_entries ke
    LEFT JOIN knowledge_links kl ON ke.id = kl.entry_id
    LEFT JOIN knowledge_entities ent ON kl.entity_id = ent.id
    WHERE ke.tenant_id = ?
  `;
  const params = [tenantId];

  // External tier: only show entries explicitly marked as public-safe
  if (accessTier === 'external') {
    sql += ` AND ke.visibility = 'public'`;
  }

  if (query) {
    sql += ` AND (ke.title LIKE ? OR ke.summary LIKE ? OR ke.transcript LIKE ? OR ke.content LIKE ?)`;
    params.push(`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`);
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

// ─── Thread Knowledge (for CC-observed emails) ─────────────────────────────

export function getThreadKnowledge(tenantId, threadId) {
  return db.prepare(`
    SELECT ke.id, ke.title, ke.summary, ke.content, ke.created_at
    FROM knowledge_entries ke
    WHERE ke.tenant_id = ? AND ke.type = 'email-observation'
      AND json_extract(ke.content, '$.threadId') = ?
    ORDER BY ke.created_at ASC
  `).all(tenantId, threadId);
}

// ─── Contact Knowledge (accumulated from observations) ──────────────────────

export function getContactKnowledge(tenantId, emailAddr) {
  const entities = db.prepare(
    `SELECT * FROM knowledge_entities WHERE tenant_id = ? AND entity_type = 'person'`
  ).all(tenantId);

  const match = entities.find(e => {
    if (!e.metadata_json) return false;
    try { return JSON.parse(e.metadata_json).email?.toLowerCase() === emailAddr.toLowerCase(); } catch { return false; }
  });

  if (!match) return null;

  const entries = db.prepare(`
    SELECT ke.title, ke.summary, ke.type, ke.created_at
    FROM knowledge_entries ke
    JOIN knowledge_links kl ON ke.id = kl.entry_id
    WHERE kl.entity_id = ?
    ORDER BY ke.created_at DESC
    LIMIT 10
  `).all(match.id);

  return {
    entity: match,
    metadata: match.metadata_json ? JSON.parse(match.metadata_json) : {},
    entries,
  };
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
