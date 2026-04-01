/**
 * Model Router - selects the optimal Claude model for each request
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
 * @returns {string} Model ID
 */
export function selectModel(agentId, messageContent, conversationLength = 0, hasTools = false) {
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

  // Everything else → Sonnet (tool calls, long conversations, complex tasks)
  return SONNET;
}

/**
 * Estimate API cost for a request (for audit trail logging).
 * Cache-aware pricing based on Anthropic rates (per 1M tokens).
 * Adapted from Claude Code's cost-tracker pattern.
 */
const PRICING = {
  [HAIKU]: {
    input: 0.80, output: 4.0,
    cacheWrite: 1.0, cacheRead: 0.08,
  },
  [SONNET]: {
    input: 3.0, output: 15.0,
    cacheWrite: 3.75, cacheRead: 0.30,
  },
  [OPUS]: {
    input: 15.0, output: 75.0,
    cacheWrite: 18.75, cacheRead: 1.50,
  },
};

export function estimateCost(inputTokens, outputTokens, model, cacheReadTokens = 0, cacheWriteTokens = 0) {
  const rate = PRICING[model] || PRICING[SONNET];
  return (
    (inputTokens / 1_000_000) * rate.input +
    (outputTokens / 1_000_000) * rate.output +
    (cacheReadTokens / 1_000_000) * rate.cacheRead +
    (cacheWriteTokens / 1_000_000) * rate.cacheWrite
  );
}

export function getOpusModel() { return OPUS; }
