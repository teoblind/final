/**
 * Hivemind CLI Service — Routes Hivemind agent through Claude Code CLI
 *
 * Spawns `claude -p` as a child process with full filesystem/shell access.
 * Feature-flagged via HIVEMIND_USE_CLI=true env var.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const TIMEOUT_MS = parseInt(process.env.CLAUDE_TIMEOUT_MS, 10) || 90_000;

const TENANT_CONTEXT = {
  default: `## Tenant: Sangha Holdings (default)
You are operating for Sangha Holdings — a Bitcoin mining operator.
- Database: /root/coppice/backend/data/cache.db (SQLite)
- Key tables: leads, contacts, outreach, discovery_configs, tenant_files, messages, threads, audit_log
- Data files: /root/coppice/backend/data/
- Codebase: /root/coppice/
- Google Drive files are tracked in tenant_files table
- Relevant domains: ERCOT energy markets, mining operations, pool routing, insurance`,

  'dacp-construction-001': `## Tenant: DACP Construction
You are operating for DACP Construction — a concrete subcontractor in Houston, TX.
- Database: /root/coppice/backend/data/cache.db (SQLite)
- Key tables: leads, contacts, outreach, discovery_configs, tenant_files, messages, threads, audit_log
- Data files: /root/coppice/backend/data/
- Codebase: /root/coppice/
- Relevant domains: concrete estimating, bid management, field operations, GC relationships`,
};

function buildSystemPrompt(tenantId, history) {
  const tenantCtx = TENANT_CONTEXT[tenantId] || TENANT_CONTEXT.default;

  let prompt = `You are Coppice Hivemind — an AI operations agent with full system access. You can read files, run shell commands, query databases, search the web, and chain complex multi-step operations.

## Rules
- Be concise. Lead with the answer, not the reasoning.
- Include actual data — run queries, read files, check real state. Never guess.
- Use markdown formatting for readability.
- If a task requires multiple steps, just do them — don't ask for permission.
- When querying SQLite, use: sqlite3 /root/coppice/backend/data/cache.db "SQL HERE"
- When searching code, grep or read files directly.
- Never expose API keys, tokens, or secrets in responses.

${tenantCtx}

## Key Database Schema
- leads: id, tenant_id, company_name, status, industry, city, state, score, source
- contacts: id, tenant_id, lead_id, name, title, email, phone
- outreach: id, tenant_id, lead_id, contact_id, type, status, subject, body, sent_at
- messages: id, tenant_id, agent_id, user_id, role, content, metadata, thread_id, created_at
- threads: id, tenant_id, agent_id, user_id, title, visibility, pinned, created_at
- tenant_files: id, tenant_id, file_name, drive_url, folder, file_type, created_at
- audit_log: id, tenant_id, action, source_type, source_id, title, subtitle, metadata, created_at`;

  // Append conversation history
  if (history && history.length > 0) {
    prompt += '\n\n## Recent Conversation\n';
    const recent = history.slice(-15);
    for (const msg of recent) {
      const role = msg.role === 'assistant' ? 'Assistant' : 'User';
      const content = msg.content.length > 500
        ? msg.content.slice(0, 500) + '...'
        : msg.content;
      prompt += `**${role}:** ${content}\n\n`;
    }
  }

  return prompt;
}

/**
 * Query Hivemind via Claude Code CLI.
 * @param {string} userMessage - The user's message
 * @param {Array} history - Conversation history (role, content objects)
 * @param {string} tenantId - Tenant identifier
 * @returns {{ response: string, durationMs: number, timedOut?: boolean }}
 */
export async function queryHivemindCli(userMessage, history, tenantId) {
  const systemPrompt = buildSystemPrompt(tenantId, history);
  const start = Date.now();

  try {
    const { stdout } = await execFileAsync(CLAUDE_BIN, [
      '-p', userMessage,
      '--dangerously-skip-permissions',
      '--output-format', 'text',
      '--max-turns', '10',
      '--system-prompt', systemPrompt,
    ], {
      timeout: TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024, // 10MB
      env: { ...process.env, LANG: 'en_US.UTF-8' },
    });

    const durationMs = Date.now() - start;
    const response = stdout.trim() || 'No response from CLI.';

    return { response, durationMs };
  } catch (error) {
    const durationMs = Date.now() - start;

    if (error.killed || error.signal === 'SIGTERM') {
      console.error(`Hivemind CLI timed out after ${durationMs}ms`);
      return {
        response: `The operation timed out after ${Math.round(TIMEOUT_MS / 1000)} seconds. The task may be too complex for a single request — try breaking it into smaller steps.`,
        durationMs,
        timedOut: true,
      };
    }

    console.error(`Hivemind CLI error:`, error.message);

    // If there's partial stdout, return it
    if (error.stdout && error.stdout.trim()) {
      return {
        response: error.stdout.trim(),
        durationMs,
      };
    }

    throw new Error(`CLI execution failed: ${error.message}`);
  }
}
