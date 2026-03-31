/**
 * CLI Tunnel Helper — Routes prompts through Claude Max (SSH tunnel → Mac)
 * with automatic fallback to the Anthropic API.
 *
 * Usage:
 *   const response = await tunnelPrompt({ tenantId, agentId, prompt, timeoutMs });
 *   // response is the raw text string from Claude
 */

import { queryClaudeAgent } from './claudeAgent.js';

/**
 * Send a prompt through the CLI tunnel (Claude Max subscription).
 * Falls back to direct Anthropic API if tunnel is unavailable.
 *
 * @param {object} opts
 * @param {string} opts.tenantId
 * @param {string} opts.agentId - Agent ID for system prompt selection
 * @param {string} opts.prompt - The full prompt text
 * @param {number} [opts.maxTurns=5] - Max agentic turns (keep low for single-shot)
 * @param {number} [opts.timeoutMs=180000] - Timeout in ms
 * @param {string} [opts.label] - Log label (e.g. 'ITB Analysis')
 * @returns {Promise<string>} The response text
 */
export async function tunnelPrompt({ tenantId, agentId, prompt, maxTurns = 5, timeoutMs = 180_000, label = 'task' }) {
  try {
    const result = await queryClaudeAgent({
      tenantId,
      agentId,
      message: prompt,
      maxTurns,
      timeoutMs,
    });
    console.log(`[CLITunnel] ${label} completed via ${result.route || 'cli'} in ${(result.durationMs / 1000).toFixed(1)}s`);
    return result.response || '';
  } catch (err) {
    console.error(`[CLITunnel] ${label} tunnel failed: ${err.message}`);
    throw new Error(`CLI tunnel failed: ${err.message}`);
  }
}

/**
 * Send a prompt through the CLI tunnel, falling back to chat() service.
 * Use this when the caller expects the full chat() interface (tool use, context, etc.)
 *
 * @param {object} opts
 * @param {string} opts.tenantId
 * @param {string} opts.agentId
 * @param {string} opts.userId
 * @param {string} opts.prompt
 * @param {string|null} [opts.threadId]
 * @param {object} [opts.chatOptions]
 * @param {number} [opts.maxTurns=10]
 * @param {number} [opts.timeoutMs=180000]
 * @param {string} [opts.label]
 * @returns {Promise<{response: string, route: string}>}
 */
export async function tunnelOrChat({ tenantId, agentId, userId, prompt, threadId = null, chatOptions = {}, maxTurns = 10, timeoutMs = 180_000, label = 'task' }) {
  try {
    const result = await queryClaudeAgent({
      tenantId,
      agentId,
      message: prompt,
      maxTurns,
      timeoutMs,
    });
    console.log(`[CLITunnel] ${label} completed via ${result.route || 'cli'} in ${(result.durationMs / 1000).toFixed(1)}s`);
    return { response: result.response || '', route: result.route || 'tunnel' };
  } catch (err) {
    console.warn(`[CLITunnel] ${label} tunnel failed, falling back to chat(): ${err.message}`);
    const { chat } = await import('./chatService.js');
    const result = await chat(tenantId, agentId, userId, prompt, threadId, { ...chatOptions, accessTier: chatOptions.accessTier });
    return { response: result.response || '', route: 'api' };
  }
}
