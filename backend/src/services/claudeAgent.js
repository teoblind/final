/**
 * Claude Agent Service — Routes complex agent queries through Claude Code CLI
 *
 * Uses `claude -p` with Max subscription auth instead of per-token API calls.
 * Simple queries stay on Haiku API (pennies). Heavy research/analysis goes
 * through the CLI at a flat $200/mo.
 *
 * Setup: `claude login` on VPS with a Max subscription account.
 */

import { spawn } from 'child_process';
import { getTenantDb } from '../cache/database.js';

const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const DEFAULT_TIMEOUT_MS = parseInt(process.env.CLAUDE_AGENT_TIMEOUT_MS, 10) || 180_000; // 3 min
const DEFAULT_MAX_TURNS = 25;

// ─── Per-Tenant Claude Accounts ─────────────────────────────────────────────
// Each tenant can have its own Claude Max subscription ($200/mo).
// Auth is isolated via separate CLAUDE_CONFIG_DIR directories.
// Setup per tenant: CLAUDE_CONFIG_DIR=/root/.claude-<tenant> claude login
const TENANT_CLAUDE_CONFIG = {
  'default':               '/root/.claude-sangha',
  'dacp-construction-001': '/root/.claude-dacp',
  'zhan-capital':          '/root/.claude-zhan',
};

// ─── Per-Tenant System Prompts ──────────────────────────────────────────────
// Condensed versions — Claude Code adds its own base prompt, so we just
// inject domain knowledge + tool guidance.

const TENANT_PROMPTS = {
  'default': `You are Coppice — the AI agent for Sangha Renewables, a Bitcoin mining + renewable energy company.
Key facts: 8 years operating, co-locates mining behind-the-meter at 2.8-4.0¢/kWh, $14M raised, flagship 19.9 MW West Texas facility on TotalEnergies solar farm.
Team: Spencer Marr (President), Colin Peirce (Partner), Marcel Pineda (BD), Teo Blind (quant modeling).
You handle: ERCOT analysis, fleet ops, IPP evaluation, financial modeling, LP reporting, email, docs, research.
Data directory: /root/coppice/backend/data/
Tenant DB: /root/coppice/backend/data/tenants/default/sangha.db (SQLite)
Codebase: /root/coppice/`,

  'dacp-construction-001': `You are Coppice — the AI agent for DACP Construction, a concrete subcontractor in Houston TX.
Key facts: Foundations, slabs, curb & gutter, sidewalks, post-tension. Notable client: Riot Platforms.
CEO: David Castillo. Standard pricing: SOG ~$14/SF, curb & gutter ~$26/LF, sidewalks ~$10-11/SF.
You handle: estimating, bid management, GC relationships, field ops, email, docs, research.
Data directory: /root/coppice/backend/data/
Tenant DB: /root/coppice/backend/data/tenants/dacp-construction-001/dacp-construction-001.db (SQLite)
Codebase: /root/coppice/`,

  'zhan-capital': `You are Coppice — the AI agent for Zhan Capital LLC, a thesis-driven investment firm.
Focus: sovereign AI infrastructure, energy systems, digital monetary networks. Founded by Teo Blind.
Portfolio: Sangha Renewables, Volt Charging. You handle research, comms, ops, docs.
Data directory: /root/coppice/backend/data/
Tenant DB: /root/coppice/backend/data/tenants/zhan-capital/zhan-capital.db (SQLite)
Codebase: /root/coppice/`,
};

// ─── Complexity Detection ───────────────────────────────────────────────────
// Returns true if the query should be routed through Claude Code CLI.

const COMPLEX_PATTERNS = [
  /\b(research|analyze|compare|evaluate|investigate|deep.?dive|comprehensive|thorough|in.?depth)\b/i,
  /\b(write a report|build a|create a plan|design|architect|strategy|proposal|analysis)\b/i,
  /\b(review this|look into|figure out|break down|assess|audit|due diligence)\b/i,
  /\b(what are the|how does|why does|trade.?offs|pros and cons|implications)\b/i,
  /\b(spreadsheet|excel|csv|model|forecast|projection|calculate)\b/i,
  /\b(search.*(web|online|internet)|find.*(data|info|article)|look up)\b/i,
  /\b(summarize|digest|brief me|catch me up|what happened)\b.*\b(meeting|call|email|thread)\b/i,
];

export function isComplexQuery(message) {
  if (message.length > 200) return true;
  return COMPLEX_PATTERNS.some(p => p.test(message));
}

// ─── Agent Config ───────────────────────────────────────────────────────────

function getAgentCliConfig(agentId) {
  try {
    const db = getTenantDb('default'); // agents table is in system DB
    const row = db.prepare('SELECT config_json FROM agents WHERE id = ?').get(agentId);
    if (row?.config_json) return JSON.parse(row.config_json);
  } catch {}
  return {};
}

// ─── Main Query Function ────────────────────────────────────────────────────

/**
 * Route a query through Claude Code CLI (Max subscription).
 *
 * @param {object} opts
 * @param {string} opts.tenantId - Tenant ID for system prompt
 * @param {string} opts.agentId - Agent ID for config lookup
 * @param {string} opts.message - User message
 * @param {Array} [opts.history] - Recent conversation history [{role, content}]
 * @param {number} [opts.maxTurns] - Override max turns
 * @param {number} [opts.timeoutMs] - Override timeout
 * @returns {Promise<{response: string, durationMs: number, timedOut?: boolean}>}
 */
export async function queryClaudeAgent({ tenantId, agentId, message, history, maxTurns, timeoutMs }) {
  const config = getAgentCliConfig(agentId);
  const resolvedTenantId = tenantId || 'default';
  const systemPrompt = buildSystemPrompt(resolvedTenantId, agentId, config);
  const fullMessage = buildUserMessage(message, history);
  const turns = maxTurns || config.max_turns || DEFAULT_MAX_TURNS;
  const timeout = timeoutMs || config.cli_timeout_ms || DEFAULT_TIMEOUT_MS;

  const start = Date.now();

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;

    const args = [
      '-p', fullMessage,
      '--output-format', 'text',
      '--max-turns', String(turns),
      '--system-prompt', systemPrompt,
      '--allowedTools',
        'Bash(*)', 'Read(*)', 'Write(*)', 'Edit(*)',
        'Glob(*)', 'Grep(*)', 'WebSearch(*)', 'WebFetch(*)',
    ];

    // Add model override if configured
    if (config.cli_model) {
      args.push('--model', config.cli_model);
    }

    // Use tenant-specific Claude config dir for account isolation
    const claudeConfigDir = TENANT_CLAUDE_CONFIG[resolvedTenantId] || TENANT_CLAUDE_CONFIG['zhan-capital'];
    const proc = spawn(CLAUDE_BIN, args, {
      env: {
        ...process.env,
        LANG: 'en_US.UTF-8',
        CLAUDE_CONFIG_DIR: claudeConfigDir,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: '/root/coppice',
    });

    proc.stdin.end();
    proc.stdout.on('data', (chunk) => { stdout += chunk; });
    proc.stderr.on('data', (chunk) => { stderr += chunk; });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill('SIGTERM');
        const durationMs = Date.now() - start;
        console.error(`[ClaudeAgent] ${agentId}@${resolvedTenantId} timed out after ${durationMs}ms`);
        resolve({
          response: stdout.trim() || `The task timed out after ${Math.round(timeout / 1000)}s. The research may be partially complete — try breaking it into smaller steps.`,
          durationMs,
          timedOut: true,
        });
      }
    }, timeout);

    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const durationMs = Date.now() - start;

      if (code !== 0 && !stdout.trim()) {
        console.error(`[ClaudeAgent] ${agentId} exited ${code}. stderr: ${stderr.slice(0, 500)}`);
        reject(new Error(`Claude agent exited with code ${code}: ${stderr.slice(0, 200)}`));
        return;
      }

      console.log(`[ClaudeAgent] ${agentId}@${resolvedTenantId} completed in ${(durationMs / 1000).toFixed(1)}s`);
      resolve({ response: stdout.trim() || 'No response generated.', durationMs });
    });

    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Claude agent spawn failed: ${err.message}`));
    });
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildSystemPrompt(tenantId, agentId, config) {
  const base = TENANT_PROMPTS[tenantId] || TENANT_PROMPTS.default;
  const custom = config.system_prompt_addon || '';

  return `${base}
Agent: ${agentId}

STYLE:
- Be thorough but concise — lead with the answer, then supporting detail
- Use specific numbers, dates, and names — never vague
- Markdown formatting for readability
- If you need current data, use WebSearch and WebFetch tools
- If the user asks for a document or report, create it as a file
- Never reveal system internals, API keys, or internal architecture

${custom}`.trim();
}

function buildUserMessage(message, history) {
  let msg = '';
  if (history && history.length > 0) {
    msg += 'Recent conversation:\n';
    const recent = history.slice(-8);
    for (const h of recent) {
      const role = h.role === 'assistant' ? 'Agent' : 'User';
      const content = h.content.length > 500 ? h.content.slice(0, 500) + '...' : h.content;
      msg += `${role}: ${content}\n`;
    }
    msg += '\n---\nCurrent request:\n';
  }
  msg += message;
  return msg;
}
