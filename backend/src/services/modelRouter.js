/**
 * Model Router — selects the optimal Claude model for each request
 *
 * Routes cheap/simple tasks to Haiku, complex tasks to Sonnet.
 * Reduces API cost by ~60% for routine operations.
 */

const HAIKU = 'claude-haiku-4-5-20251001';
const SONNET = process.env.CHAT_MODEL || 'claude-sonnet-4-20250514';
const OPUS = 'claude-opus-4-20250514';

// Patterns that indicate simple classification/extraction tasks → Haiku
const HAIKU_PATTERNS = [
  /^(yes|no|true|false|classify|categorize|extract|parse)\b/i,
  /\bis this a\b/i,
  /\bsummarize in (one|1|two|2) sentence/i,
  /\blist (the|all)\b.*\b(names|items|files)\b/i,
];

// Agents whose background/proactive checks always use Haiku
const HAIKU_AGENTS = new Set(['proactive_check', 'classifier']);

/**
 * Select the optimal model for a given request.
 *
 * @param {string} agentId - The agent handling the request
 * @param {string} messageContent - The user's message
 * @param {number} conversationLength - Number of messages in context
 * @param {boolean} hasTools - Whether tools are being passed
 * @param {Object} [opts] - Additional options
 * @param {boolean} [opts.isAutoReply] - If true, use Sonnet instead of Opus (cost control)
 * @returns {string} Model ID
 */
export function selectModel(agentId, messageContent, conversationLength = 0, hasTools = false, opts = {}) {
  // Background agents always use Haiku
  if (HAIKU_AGENTS.has(agentId)) {
    return HAIKU;
  }

  // Short messages with no history → likely simple query → Haiku
  if (messageContent.length < 80 && conversationLength < 3 && !hasTools) {
    return HAIKU;
  }

  // Pattern-matched simple tasks → Haiku
  if (HAIKU_PATTERNS.some(p => p.test(messageContent))) {
    return HAIKU;
  }

  // Primary tenant agents → Opus for interactive dashboard chat
  // Auto-replies stay on Sonnet for cost control
  const opusAgents = new Set(['sangha', 'hivemind', 'zhan']);
  if (opusAgents.has(agentId) && !opts.isAutoReply) {
    return OPUS;
  }

  // Everything else → Sonnet (tool calls, auto-replies, sub-agents)
  return SONNET;
}

/**
 * Estimate API cost for a request (for audit trail logging).
 * Rough estimates based on Anthropic pricing.
 */
export function estimateCost(inputTokens, outputTokens, model) {
  const pricing = {
    [HAIKU]: { input: 0.001, output: 0.005 },    // per 1K tokens
    [SONNET]: { input: 0.003, output: 0.015 },
    [OPUS]: { input: 0.015, output: 0.075 },
  };
  const rate = pricing[model] || pricing[SONNET];
  return (inputTokens / 1000 * rate.input) + (outputTokens / 1000 * rate.output);
}

export function getOpusModel() { return OPUS; }
