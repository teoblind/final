/**
 * Hivemind CLI Service — Routes Hivemind agent through Claude Code CLI
 *
 * Spawns `claude -p` as a child process with full filesystem/shell access.
 * Feature-flagged via HIVEMIND_USE_CLI=true env var.
 */

import { spawn } from 'child_process';

const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const TIMEOUT_MS = parseInt(process.env.CLAUDE_TIMEOUT_MS, 10) || 90_000;

const TENANT_CONTEXT = {
  default: `Tenant: Sangha Holdings (Bitcoin mining operator).
DB: /root/coppice/backend/data/cache.db (SQLite). Codebase: /root/coppice/
Tables: leads, contacts, outreach, tenant_files, messages, threads, audit_log
Domains: ERCOT energy, mining ops, pool routing, insurance`,

  'dacp-construction-001': `Tenant: DACP Construction (concrete subcontractor, Houston TX).
DB: /root/coppice/backend/data/cache.db (SQLite). Codebase: /root/coppice/
Tables: leads, contacts, outreach, tenant_files, messages, threads, audit_log
Domains: estimating, bid management, field ops, GC relationships`,
};

function buildSystemPrompt(tenantId) {
  const tenantCtx = TENANT_CONTEXT[tenantId] || TENANT_CONTEXT.default;
  return `You are Coppice Hivemind — AI ops agent with full system access.
Rules: Be concise. Include real data. Use markdown. SQLite: sqlite3 /root/coppice/backend/data/cache.db "SQL". Never expose secrets.
${tenantCtx}`;
}

function buildUserMessage(userMessage, history) {
  let msg = '';
  if (history && history.length > 0) {
    msg += 'Recent conversation for context:\n';
    const recent = history.slice(-10);
    for (const h of recent) {
      const role = h.role === 'assistant' ? 'Assistant' : 'User';
      const content = h.content.length > 300 ? h.content.slice(0, 300) + '...' : h.content;
      msg += `${role}: ${content}\n`;
    }
    msg += '\n---\nCurrent request:\n';
  }
  msg += userMessage;
  return msg;
}

/**
 * Query Hivemind via Claude Code CLI.
 */
export async function queryHivemindCli(userMessage, history, tenantId) {
  const systemPrompt = buildSystemPrompt(tenantId);
  const fullMessage = buildUserMessage(userMessage, history);
  const start = Date.now();

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;

    const proc = spawn(CLAUDE_BIN, [
      '-p', fullMessage,
      '--output-format', 'text',
      '--max-turns', '10',
      '--system-prompt', systemPrompt,
      '--allowedTools', 'Bash(*)', 'Read(*)', 'Write(*)', 'Edit(*)',
        'Glob(*)', 'Grep(*)', 'WebSearch(*)', 'WebFetch(*)',
    ], {
      env: { ...process.env, LANG: 'en_US.UTF-8' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Close stdin immediately — claude -p reads from args, not stdin
    proc.stdin.end();

    proc.stdout.on('data', (chunk) => { stdout += chunk; });
    proc.stderr.on('data', (chunk) => { stderr += chunk; });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill('SIGTERM');
        const durationMs = Date.now() - start;
        console.error(`Hivemind CLI timed out after ${durationMs}ms. stderr: ${stderr.slice(0, 200)}`);
        resolve({
          response: stdout.trim() || `Timed out after ${Math.round(TIMEOUT_MS / 1000)}s. Try a simpler request.`,
          durationMs,
          timedOut: true,
        });
      }
    }, TIMEOUT_MS);

    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const durationMs = Date.now() - start;

      if (code !== 0 && !stdout.trim()) {
        console.error(`Hivemind CLI exited ${code}. stderr: ${stderr.slice(0, 500)}`);
        reject(new Error(`CLI exited with code ${code}: ${stderr.slice(0, 200)}`));
        return;
      }

      resolve({
        response: stdout.trim() || 'No response from CLI.',
        durationMs,
      });
    });

    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`CLI spawn failed: ${err.message}`));
    });
  });
}
