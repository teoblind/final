/**
 * Claude Agent Service — Routes complex agent queries through Claude Code CLI
 *
 * Architecture (primary): VPS runs `claude -p` locally with OAuth credentials
 * stored at /root/.claude/.credentials.json (Claude Max subscription).
 * MCP bridge runs on same machine — no SSH needed.
 *
 * Architecture (legacy fallback): VPS → SSH tunnel (port 2222) → Mac → claude -p
 * Set CLAUDE_USE_TUNNEL=true to use the SSH tunnel path.
 *
 * Default: CLAUDE_USE_TUNNEL=false (local execution, ~10-20s faster)
 */

import { spawn } from 'child_process';
import { getTenantDb, getAgentMemory, setAgentMemory, getUserById } from '../cache/database.js';

// SSH tunnel configuration
const SSH_KEY = process.env.CLAUDE_SSH_KEY || '/root/.ssh/id_ed25519';
const SSH_USER = process.env.CLAUDE_SSH_USER || 'teoblind';
const SSH_HOST = '127.0.0.1';  // Tunnel endpoint (reverse tunnel on VPS)
const SSH_PORT = parseInt(process.env.CLAUDE_SSH_PORT, 10) || 2222;
const MAC_WRAPPER = process.env.CLAUDE_MAC_WRAPPER || '/Users/teoblind/claude-coppice.sh';

// Local fallback (if tunnel is down and VPS has its own claude auth)
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
// Lazy — dotenv may not have loaded yet at ESM import time
function useTunnelEnabled() {
  return process.env.CLAUDE_USE_TUNNEL !== 'false'; // default: true
}

const DEFAULT_TIMEOUT_MS = parseInt(process.env.CLAUDE_AGENT_TIMEOUT_MS, 10) || 180_000; // 3 min
const DEFAULT_MAX_TURNS = 25;

// ─── Per-Tenant System Prompts ──────────────────────────────────────────────
// Condensed versions — Claude Code adds its own base prompt, so we just
// inject domain knowledge + tool guidance.

const TENANT_PROMPTS = {
  'default': `You are Coppice — the AI agent for Sangha Renewables, a Bitcoin mining + renewable energy company.
Key facts: 8 years operating, co-locates mining behind-the-meter at 2.8-4.0¢/kWh, $14M raised, flagship 19.9 MW West Texas facility on TotalEnergies solar farm.
Team: Spencer Marr (President), Colin Peirce (Partner), Marcel Pineda (BD), Teo Blind (quant modeling).
You handle: ERCOT analysis, fleet ops, IPP evaluation, financial modeling, LP reporting, email, docs, research.`,

  'dacp-construction-001': `You are Coppice — the AI agent for DACP Construction, a concrete subcontractor in Houston TX.
Key facts: Foundations, slabs, curb & gutter, sidewalks, post-tension. Notable client: Riot Platforms.
CEO: David Castillo. Standard pricing: SOG ~$14/SF, curb & gutter ~$26/LF, sidewalks ~$10-11/SF.
You handle: estimating, bid management, GC relationships, field ops, email, docs, research.

UPCOMING INTEGRATIONS (not yet available on current plan):
- PlanSwift: Direct takeoff integration - Coppice will read PlanSwift projects, auto-import quantities, and build estimates directly from takeoff data. Currently in development.
- Procore: Project management sync - jobs, RFIs, submittals, daily logs.
- HCSS HeavyBid: Heavy civil estimating import/export.
If a user asks about PlanSwift, Procore, or other desktop/field software integrations, tell them it is on the roadmap and they should contact their admin about upgrading their plan to get early access when it launches.`,

  'zhan-capital': `You are Coppice — the AI agent for Zhan Capital LLC, a thesis-driven investment firm.
Focus: sovereign AI infrastructure, energy systems, digital monetary networks. Founded by Teo Blind.
Portfolio: Sangha Renewables, Volt Charging. You handle research, comms, ops, docs.`,
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

export { isTunnelHealthy };

export function isComplexQuery(message) {
  // message can be a string or array of content blocks
  const text = Array.isArray(message)
    ? message.filter(b => b.type === 'text').map(b => b.text).join(' ')
    : String(message);
  if (text.length > 200) return true;
  return COMPLEX_PATTERNS.some(p => p.test(text));
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

// ─── Tunnel Health Check ────────────────────────────────────────────────────

let _tunnelHealthy = null;      // null = unknown, true/false = cached
let _tunnelCheckTime = 0;
const TUNNEL_CHECK_INTERVAL = 60_000; // Re-check every 60s

async function isTunnelHealthy() {
  const now = Date.now();
  if (_tunnelHealthy !== null && (now - _tunnelCheckTime) < TUNNEL_CHECK_INTERVAL) {
    return _tunnelHealthy;
  }

  return new Promise((resolve) => {
    const proc = spawn('ssh', [
      '-4',
      '-i', SSH_KEY,
      '-p', String(SSH_PORT),
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'ConnectTimeout=5',
      '-o', 'BatchMode=yes',
      `${SSH_USER}@${SSH_HOST}`,
      'echo', 'TUNNEL_OK',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    let out = '';
    proc.stdout.on('data', (d) => { out += d; });

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      _tunnelHealthy = false;
      _tunnelCheckTime = now;
      console.warn('[ClaudeAgent] Tunnel health check timed out');
      resolve(false);
    }, 8000);

    proc.on('close', (code) => {
      clearTimeout(timer);
      _tunnelHealthy = code === 0 && out.includes('TUNNEL_OK');
      _tunnelCheckTime = now;
      if (!_tunnelHealthy) {
        console.warn(`[ClaudeAgent] Tunnel health check failed (code=${code}, out=${out.trim()})`);
      }
      resolve(_tunnelHealthy);
    });

    proc.on('error', () => {
      clearTimeout(timer);
      _tunnelHealthy = false;
      _tunnelCheckTime = now;
      resolve(false);
    });
  });
}

// ─── Main Query Function ────────────────────────────────────────────────────

/**
 * Route a query through Claude Code CLI (Max subscription via SSH tunnel).
 *
 * Pipeline: VPS → SSH (port 2222) → Mac → claude-coppice.sh → claude -p
 * Fallback: VPS → local claude binary (if tunnel is down)
 *
 * @param {object} opts
 * @param {string} opts.tenantId - Tenant ID for system prompt
 * @param {string} opts.agentId - Agent ID for config lookup
 * @param {string} opts.message - User message
 * @param {Array} [opts.history] - Recent conversation history [{role, content}]
 * @param {number} [opts.maxTurns] - Override max turns
 * @param {number} [opts.timeoutMs] - Override timeout
 * @returns {Promise<{response: string, durationMs: number, timedOut?: boolean, route?: string}>}
 */
export async function queryClaudeAgent({ tenantId, agentId, message, history, maxTurns, timeoutMs }) {
  const config = getAgentCliConfig(agentId);
  const resolvedTenantId = tenantId || 'default';
  const systemPrompt = buildSystemPrompt(resolvedTenantId, agentId, config);
  const fullMessage = buildUserMessage(message, history);
  const turns = maxTurns || config.max_turns || DEFAULT_MAX_TURNS;
  const timeout = timeoutMs || config.cli_timeout_ms || DEFAULT_TIMEOUT_MS;

  // Try tunnel first, fall back to local
  let useTunnel = useTunnelEnabled();
  if (useTunnel) {
    useTunnel = await isTunnelHealthy();
    if (!useTunnel) {
      console.warn(`[ClaudeAgent] Tunnel down — falling back to local claude for ${agentId}@${resolvedTenantId}`);
    }
  }

  if (useTunnel) {
    return queryViaTunnel({ resolvedTenantId, agentId, systemPrompt, fullMessage, turns, timeout, config });
  } else {
    return queryLocal({ resolvedTenantId, agentId, systemPrompt, fullMessage, turns, timeout, config });
  }
}

// ─── SSH Tunnel Query ───────────────────────────────────────────────────────

function queryViaTunnel({ resolvedTenantId, agentId, systemPrompt, fullMessage, turns, timeout, config }) {
  const start = Date.now();

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;

    // Build the remote claude command arguments
    // We pass everything through the wrapper script on the Mac.
    // The prompt and system prompt are passed via stdin/args.
    // Shell-escape the arguments for remote execution.
    const claudeArgs = [
      '-p', fullMessage,
      '--output-format', 'text',
      '--max-turns', String(turns),
      '--system-prompt', systemPrompt,
      '--allowedTools', ...ALLOWED_TOOLS,
    ];

    if (config.cli_model) {
      claudeArgs.push('--model', config.cli_model);
    }

    // Build the remote command: invoke the wrapper with all claude args
    // Set MCP_BRIDGE_TENANT so the MCP bridge knows which tenant to use
    const escapedArgs = claudeArgs.map(arg => shellEscape(arg));
    const remoteCmd = `MCP_BRIDGE_TENANT=${shellEscape(resolvedTenantId)} ${MAC_WRAPPER} ${escapedArgs.join(' ')}`;

    const sshArgs = [
      '-4',
      '-i', SSH_KEY,
      '-p', String(SSH_PORT),
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'ConnectTimeout=10',
      '-o', 'BatchMode=yes',
      '-o', 'ServerAliveInterval=30',
      '-o', 'ServerAliveCountMax=3',
      `${SSH_USER}@${SSH_HOST}`,
      remoteCmd,
    ];

    console.log(`[ClaudeAgent] Tunneling ${agentId}@${resolvedTenantId} via SSH (port ${SSH_PORT})`);

    const proc = spawn('ssh', sshArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, LANG: 'en_US.UTF-8', ANTHROPIC_API_KEY: '' },
    });

    proc.stdin.end();
    proc.stdout.on('data', (chunk) => { stdout += chunk; });
    proc.stderr.on('data', (chunk) => { stderr += chunk; });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill('SIGTERM');
        const durationMs = Date.now() - start;
        console.error(`[ClaudeAgent] ${agentId}@${resolvedTenantId} timed out via tunnel after ${durationMs}ms`);
        resolve({
          response: stdout.trim() || `The task timed out after ${Math.round(timeout / 1000)}s. The research may be partially complete — try breaking it into smaller steps.`,
          durationMs,
          timedOut: true,
          route: 'tunnel',
        });
      }
    }, timeout);

    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const durationMs = Date.now() - start;

      if (code !== 0 && !stdout.trim()) {
        const errMsg = stderr.slice(0, 500);
        console.error(`[ClaudeAgent] ${agentId} tunnel exited ${code}. stderr: ${errMsg}`);

        // If SSH itself failed (not claude), mark tunnel as unhealthy
        if (errMsg.includes('Connection refused') || errMsg.includes('Connection timed out') || errMsg.includes('No route to host')) {
          _tunnelHealthy = false;
          _tunnelCheckTime = Date.now();
        }

        reject(new Error(`Claude agent (tunnel) exited with code ${code}: ${stderr.slice(0, 200)}`));
        return;
      }

      console.log(`[ClaudeAgent] ${agentId}@${resolvedTenantId} completed via tunnel in ${(durationMs / 1000).toFixed(1)}s`);
      resolve({ response: stdout.trim() || 'No response generated.', durationMs, route: 'tunnel' });
    });

    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Claude agent SSH spawn failed: ${err.message}`));
    });
  });
}

// ─── SSH Tunnel Streaming Query ─────────────────────────────────────────────

/**
 * Stream a query through Claude Code CLI via SSH tunnel.
 * Uses --output-format stream-json to get real-time token streaming.
 * SSH forwards stdout in real-time, so tokens appear as they're generated.
 *
 * @param {object} opts - Same as queryViaTunnel
 * @param {function} opts.onText - Callback for each text chunk: onText(textDelta)
 * @returns {Promise<{response: string, durationMs: number, timedOut?: boolean, route: string}>}
 */
function streamViaTunnel({ resolvedTenantId, agentId, systemPrompt, fullMessage, turns, timeout, config, onText }) {
  const start = Date.now();

  return new Promise((resolve, reject) => {
    let fullResponse = '';
    let stderr = '';
    let settled = false;

    // Use --output-format stream-json --verbose --include-partial-messages for
    // real-time per-token streaming. The --include-partial-messages flag makes the
    // CLI emit content_block_delta events (wrapped in stream_event) as tokens arrive.
    // SSH -tt forces a pseudo-TTY to prevent pipe buffering.
    const claudeArgs = [
      '-p', fullMessage,
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--max-turns', String(turns),
      '--system-prompt', systemPrompt,
      '--allowedTools', ...ALLOWED_TOOLS,
    ];

    if (config.cli_model) {
      claudeArgs.push('--model', config.cli_model);
    }

    const escapedArgs = claudeArgs.map(arg => shellEscape(arg));
    const remoteCmd = `MCP_BRIDGE_TENANT=${shellEscape(resolvedTenantId)} ${MAC_WRAPPER} ${escapedArgs.join(' ')}`;

    const sshArgs = [
      '-4',
      '-tt',  // Force pseudo-TTY so output streams in real-time
      '-i', SSH_KEY,
      '-p', String(SSH_PORT),
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'ConnectTimeout=10',
      '-o', 'BatchMode=yes',
      '-o', 'ServerAliveInterval=30',
      '-o', 'ServerAliveCountMax=3',
      `${SSH_USER}@${SSH_HOST}`,
      remoteCmd,
    ];

    console.log(`[ClaudeAgent] Streaming ${agentId}@${resolvedTenantId} via SSH tunnel`);

    const proc = spawn('ssh', sshArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, LANG: 'en_US.UTF-8', ANTHROPIC_API_KEY: '' },
    });

    proc.stdin.end();

    let buffer = '';
    let streamedViaDeltas = false;
    let hasEmittedText = false; // Track if we've sent any text to add separators between turns
    let turnCount = 0; // Track agentic turns for progress indicator
    let currentTools = []; // Tools being used in current turn

    // Emit progress event (flows through to SSE as typing indicator status)
    function emitProgress(tools, label) {
      onText(JSON.stringify({ _type: 'progress', iteration: turnCount, maxTurns: turns, tools: tools || [label || 'Thinking...'] }));
    }

    // Initial progress - agent is connecting/thinking
    emitProgress(null, 'Thinking...');

    // Parse stream-json events from claude CLI with --include-partial-messages.
    // Events come as: {"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"..."}}}
    // We extract text_delta events for per-token streaming.
    // Between agentic turns (text -> tool use -> text), we add newline separators.
    proc.stdout.on('data', (chunk) => {
      let raw = chunk.toString();
      // Strip ANSI escape sequences and normalize line endings from TTY
      raw = raw.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
      raw = raw.replace(/\r\n/g, '\n').replace(/\r/g, '');
      buffer += raw;

      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep incomplete last line

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);

          // Detect new content block start
          if (event.type === 'stream_event' && event.event?.type === 'content_block_start') {
            const block = event.event.content_block;
            if (block?.type === 'tool_use') {
              // Agent is calling a tool - show it in the progress indicator
              const toolName = block.name || 'tool';
              currentTools.push(toolName);
              emitProgress(currentTools);
            } else if (block?.type === 'text') {
              if (hasEmittedText) {
                // New text block after previous text - agent did a tool call between turns
                turnCount++;
                currentTools = [];
                fullResponse += '\n\n';
                onText('\n\n');
              }
            }
          }

          // Per-token streaming: stream_event wrapping content_block_delta
          if (event.type === 'stream_event' && event.event?.type === 'content_block_delta') {
            const delta = event.event.delta;
            if (delta?.type === 'text_delta' && delta.text) {
              fullResponse += delta.text;
              onText(delta.text);
              streamedViaDeltas = true;
              hasEmittedText = true;
            }
          }

          // Final result - use to set fullResponse if deltas didn't capture everything
          if (event.type === 'result' && event.result) {
            const resultText = typeof event.result === 'string' ? event.result : '';
            if (resultText && !streamedViaDeltas) {
              fullResponse = resultText;
              onText(resultText);
            } else if (resultText) {
              // Deltas streamed, but use result as authoritative fullResponse
              fullResponse = resultText;
            }
          }
        } catch {
          // Not valid JSON - skip
        }
      }
    });

    proc.stderr.on('data', (chunk) => { stderr += chunk; });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill('SIGTERM');
        const durationMs = Date.now() - start;
        console.error(`[ClaudeAgent] ${agentId}@${resolvedTenantId} stream timed out after ${durationMs}ms`);
        resolve({
          response: fullResponse.trim() || `The task timed out after ${Math.round(timeout / 1000)}s.`,
          durationMs,
          timedOut: true,
          route: 'tunnel-stream',
        });
      }
    }, timeout);

    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const durationMs = Date.now() - start;

      // Process remaining buffer
      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer);
          if (event.type === 'stream_event' && event.event?.type === 'content_block_delta') {
            const delta = event.event.delta;
            if (delta?.type === 'text_delta' && delta.text) {
              fullResponse += delta.text;
              onText(delta.text);
              streamedViaDeltas = true;
            }
          }
          if (event.type === 'result' && event.result) {
            const resultText = typeof event.result === 'string' ? event.result : '';
            if (resultText && !streamedViaDeltas) {
              fullResponse = resultText;
              onText(resultText);
            } else if (resultText) {
              fullResponse = resultText;
            }
          }
        } catch {}
      }

      if (code !== 0 && !fullResponse.trim()) {
        const errMsg = stderr.slice(0, 500);
        console.error(`[ClaudeAgent] ${agentId} stream tunnel exited ${code}. stderr: ${errMsg}`);
        if (errMsg.includes('Connection refused') || errMsg.includes('Connection timed out') || errMsg.includes('No route to host')) {
          _tunnelHealthy = false;
          _tunnelCheckTime = Date.now();
        }
        reject(new Error(`Claude agent stream (tunnel) exited with code ${code}: ${stderr.slice(0, 200)}`));
        return;
      }

      console.log(`[ClaudeAgent] ${agentId}@${resolvedTenantId} stream completed via tunnel in ${(durationMs / 1000).toFixed(1)}s`);
      resolve({ response: fullResponse.trim() || 'No response generated.', durationMs, route: 'tunnel-stream' });
    });

    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Claude agent SSH stream spawn failed: ${err.message}`));
    });
  });
}

// ─── Streaming Entry Point ─────────────────────────────────────────────────

/**
 * Stream a query through Claude Code CLI (Max subscription via SSH tunnel).
 * Same as queryClaudeAgent but streams text chunks via onText callback.
 *
 * @param {object} opts - Same as queryClaudeAgent plus onText
 * @param {function} opts.onText - Called with each text delta as it arrives
 * @returns {Promise<{response: string, durationMs: number, timedOut?: boolean, route: string}>}
 */
export async function streamClaudeAgent({ tenantId, agentId, userId, message, history, maxTurns, timeoutMs, onText }) {
  const config = getAgentCliConfig(agentId);
  const resolvedTenantId = tenantId || 'default';
  const systemPrompt = buildSystemPrompt(resolvedTenantId, agentId, config, userId);
  const fullMessage = buildUserMessage(message, history);
  const turns = maxTurns || config.max_turns || DEFAULT_MAX_TURNS;
  const timeout = timeoutMs || config.cli_timeout_ms || DEFAULT_TIMEOUT_MS;

  let useTunnel = useTunnelEnabled();
  if (useTunnel) {
    useTunnel = await isTunnelHealthy();
    if (!useTunnel) {
      console.warn(`[ClaudeAgent] Tunnel down for stream - falling back to local for ${agentId}@${resolvedTenantId}`);
    }
  }

  if (useTunnel) {
    return streamViaTunnel({ resolvedTenantId, agentId, systemPrompt, fullMessage, turns, timeout, config, onText });
  } else {
    return streamLocal({ resolvedTenantId, agentId, systemPrompt, fullMessage, turns, timeout, config, onText });
  }
}

// ─── Local Fallback Streaming Query ────────────────────────────────────────

function streamLocal({ resolvedTenantId, agentId, systemPrompt, fullMessage, turns, timeout, config, onText }) {
  const start = Date.now();

  return new Promise((resolve, reject) => {
    let fullResponse = '';
    let stderr = '';
    let settled = false;

    const args = [
      '-p', fullMessage,
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--max-turns', String(turns),
      '--system-prompt', systemPrompt,
      '--allowedTools', ...ALLOWED_TOOLS,
    ];

    if (config.cli_model) {
      args.push('--model', config.cli_model);
    }

    console.log(`[ClaudeAgent] Streaming ${agentId}@${resolvedTenantId} locally`);

    const proc = spawn(CLAUDE_BIN, args, {
      env: { ...process.env, LANG: 'en_US.UTF-8', ANTHROPIC_API_KEY: '' },
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: '/root/coppice',
    });

    proc.stdin.end();

    let buffer = '';
    let streamedViaDeltas = false;
    let hasEmittedText = false;
    let turnCount = 0;
    let currentTools = [];

    function emitProgress(tools, label) {
      onText(JSON.stringify({ _type: 'progress', iteration: turnCount, maxTurns: turns, tools: tools || [label || 'Thinking...'] }));
    }

    emitProgress(null, 'Thinking...');

    proc.stdout.on('data', (chunk) => {
      buffer += chunk.toString();

      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);

          if (event.type === 'stream_event' && event.event?.type === 'content_block_start') {
            const block = event.event.content_block;
            if (block?.type === 'tool_use') {
              const toolName = block.name || 'tool';
              currentTools.push(toolName);
              emitProgress(currentTools);
            } else if (block?.type === 'text') {
              if (hasEmittedText) {
                turnCount++;
                currentTools = [];
                fullResponse += '\n\n';
                onText('\n\n');
              }
            }
          }

          if (event.type === 'stream_event' && event.event?.type === 'content_block_delta') {
            const delta = event.event.delta;
            if (delta?.type === 'text_delta' && delta.text) {
              fullResponse += delta.text;
              onText(delta.text);
              streamedViaDeltas = true;
              hasEmittedText = true;
            }
          }

          if (event.type === 'result' && event.result) {
            const resultText = typeof event.result === 'string' ? event.result : '';
            if (resultText && !streamedViaDeltas) {
              fullResponse = resultText;
              onText(resultText);
            } else if (resultText) {
              fullResponse = resultText;
            }
          }
        } catch {
          // Not valid JSON - skip
        }
      }
    });

    proc.stderr.on('data', (chunk) => { stderr += chunk; });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill('SIGTERM');
        const durationMs = Date.now() - start;
        resolve({
          response: fullResponse.trim() || `The task timed out after ${Math.round(timeout / 1000)}s.`,
          durationMs,
          timedOut: true,
          route: 'local-stream',
        });
      }
    }, timeout);

    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const durationMs = Date.now() - start;

      // Process remaining buffer
      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer);
          if (event.type === 'stream_event' && event.event?.type === 'content_block_delta') {
            const delta = event.event.delta;
            if (delta?.type === 'text_delta' && delta.text) {
              fullResponse += delta.text;
              onText(delta.text);
              streamedViaDeltas = true;
            }
          }
          if (event.type === 'result' && event.result) {
            const resultText = typeof event.result === 'string' ? event.result : '';
            if (resultText && !streamedViaDeltas) {
              fullResponse = resultText;
              onText(resultText);
            } else if (resultText) {
              fullResponse = resultText;
            }
          }
        } catch {}
      }

      if (code !== 0 && !fullResponse.trim()) {
        reject(new Error(`Claude agent stream exited with code ${code}: ${stderr.slice(0, 200)}`));
        return;
      }

      console.log(`[ClaudeAgent] ${agentId}@${resolvedTenantId} stream completed locally in ${(durationMs / 1000).toFixed(1)}s`);
      resolve({ response: fullResponse.trim() || 'No response generated.', durationMs, route: 'local-stream' });
    });

    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Claude agent stream spawn failed: ${err.message}`));
    });
  });
}

// ─── Local Fallback Query ───────────────────────────────────────────────────

function queryLocal({ resolvedTenantId, agentId, systemPrompt, fullMessage, turns, timeout, config }) {
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
      '--allowedTools', ...ALLOWED_TOOLS,
    ];

    if (config.cli_model) {
      args.push('--model', config.cli_model);
    }

    console.log(`[ClaudeAgent] Running ${agentId}@${resolvedTenantId} locally (fallback)`);

    const proc = spawn(CLAUDE_BIN, args, {
      env: {
        ...process.env,
        LANG: 'en_US.UTF-8',
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
        console.error(`[ClaudeAgent] ${agentId}@${resolvedTenantId} timed out locally after ${durationMs}ms`);
        resolve({
          response: stdout.trim() || `The task timed out after ${Math.round(timeout / 1000)}s. The research may be partially complete — try breaking it into smaller steps.`,
          durationMs,
          timedOut: true,
          route: 'local',
        });
      }
    }, timeout);

    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const durationMs = Date.now() - start;

      if (code !== 0 && !stdout.trim()) {
        console.error(`[ClaudeAgent] ${agentId} local exited ${code}. stderr: ${stderr.slice(0, 500)}`);
        reject(new Error(`Claude agent exited with code ${code}: ${stderr.slice(0, 200)}`));
        return;
      }

      console.log(`[ClaudeAgent] ${agentId}@${resolvedTenantId} completed locally in ${(durationMs / 1000).toFixed(1)}s`);
      resolve({ response: stdout.trim() || 'No response generated.', durationMs, route: 'local' });
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

// Standard allowed tools for CLI agent — includes built-in tools + MCP bridge
// The MCP bridge tools are auto-discovered from .mcp.json in the project dir
// (claude-coppice.sh cds to /Users/teoblind/final before launching claude)
const ALLOWED_TOOLS = [
  'Bash(*)', 'Read(*)', 'Write(*)', 'Edit(*)',
  'Glob(*)', 'Grep(*)', 'WebSearch(*)', 'WebFetch(*)',
  'mcp__coppice-tools__*',
];

/**
 * Shell-escape a string for safe inclusion in a remote SSH command.
 * Wraps in single quotes, escaping any internal single quotes.
 */
function shellEscape(str) {
  // Replace single quotes with '\'' (end quote, escaped quote, start quote)
  return "'" + str.replace(/'/g, "'\\''") + "'";
}

function buildSystemPrompt(tenantId, agentId, config, userId) {
  const base = TENANT_PROMPTS[tenantId] || TENANT_PROMPTS.default;
  const custom = config.system_prompt_addon || '';

  // Look up the current user's name
  let userBlock = '';
  if (userId) {
    try {
      const user = getUserById(userId);
      if (user?.name) {
        userBlock = `\nCURRENT USER: ${user.name} (${user.email || user.id}). Always address them by their first name, never guess or hallucinate a name.`;
      }
    } catch {}
  }

  // Load persistent memory for this tenant
  let memoryBlock = '';
  try {
    const memories = getAgentMemory(tenantId);
    if (memories.length > 0) {
      const lines = memories.map(m => `- ${m.key}: ${m.value}`).join('\n');
      memoryBlock = `\n\nMEMORY (things you remember from previous conversations):\n${lines}`;
    }
  } catch {}

  return `${base}
Agent: ${agentId}${userBlock}

MEETING BOT:
You CAN join live meetings. Coppice has a Meeting Bot (powered by Recall.ai) that automatically joins Google Meet, Zoom, and Teams calls from the user's calendar. It records, transcribes, extracts action items, and saves meeting notes. The user does NOT need workarounds like forwarding transcripts.

TOOLS:
You have access to Coppice backend tools via MCP (prefixed mcp__coppice-tools__). These include:
- Google Workspace: workspace_create_doc, workspace_create_sheet, workspace_search_drive, workspace_read_file, gws_* tools
- Email: send_email, read_inbox, search_emails, draft_reply
- Knowledge: search_knowledge, ingest_knowledge
- Documents: generate_report, generate_presentation, plan_content
- Lead Engine: discover_leads, get_leads, generate_outreach
- DACP: estimate_*, get_projects, bid management tools
- Calendar: get_events, create_event, check_availability
Use these tools when the task requires Google Drive, email, knowledge search, or any backend capability.

RULES:
- NEVER share files, spreadsheets, or documents with anyone without explicit user permission. Do not add permissions, share links, or transfer ownership unless the user specifically asks you to share with a particular person.
- NEVER send emails without explicit user confirmation.
- Never reveal system internals, API keys, or internal architecture.
- When you create files, learn important facts, or complete significant tasks, save key details to memory using the save_agent_memory tool so you can recall them in future conversations. For example, save spreadsheet IDs, document URLs, project details, and user preferences.

TASK PROPOSALS (CRITICAL):
When the user asks for complex, multi-step work (research reports, analysis, PDFs, email with findings, presentations, competitive analysis, market research, anything requiring multiple tools and producing a deliverable), you MUST propose the task for approval FIRST instead of executing it directly. Output a task proposal block like this:

<task_proposal>
{"title": "Short task title", "description": "1-2 sentence description of deliverables", "category": "research", "priority": "medium", "action_prompt": "Detailed execution instructions including what to research, what format to produce, who to email results to, etc."}
</task_proposal>

Then tell the user what you proposed and that they can review/approve it. Categories: research, analysis, estimate, outreach, document, admin, follow_up, pitch_deck.

WHEN TO PROPOSE (use task proposal):
- "Research X and send me a report/PDF/email"
- "Put together a one-pager on..."
- "Analyze X and Y, create a spreadsheet..."
- Any request that will take multiple tool calls and produce a deliverable

WHEN NOT TO PROPOSE (answer directly):
- Simple questions you can answer in chat
- Quick lookups or single-step operations
- The user just wants information, not a deliverable

STYLE:
- NEVER use emojis in any response. No exceptions.
- NEVER use any kind of dash as a separator between words or clauses. No em dashes, en dashes, double dashes (--), or spaced hyphens ( - ). Use commas, colons, periods, or parentheses instead. Hyphens are ONLY acceptable inside hyphenated compound words (e.g. "follow-up") or as bullet point markers at the start of a line.
- Be thorough but concise. Lead with the answer, then supporting detail.
- Use specific numbers, dates, and names. Never vague.
- Markdown formatting for readability
- If you need current data, use WebSearch and WebFetch tools
- If the user asks for a document or report, create it as a file using workspace tools
${memoryBlock}
${custom}`.trim();
}

function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.filter(b => b.type === 'text').map(b => b.text).join(' ');
  }
  return String(content);
}

function buildUserMessage(message, history) {
  let msg = '';
  if (history && history.length > 0) {
    msg += 'Recent conversation:\n';
    const recent = history.slice(-8);
    for (const h of recent) {
      const role = h.role === 'assistant' ? 'Agent' : 'User';
      const text = extractText(h.content);
      const content = text.length > 500 ? text.slice(0, 500) + '...' : text;
      msg += `${role}: ${content}\n`;
    }
    msg += '\n---\nCurrent request:\n';
  }
  msg += extractText(message);
  return msg;
}
