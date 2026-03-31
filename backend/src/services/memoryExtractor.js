import Anthropic from '@anthropic-ai/sdk';
import { getAgentMemory, getAgentMemoryValue, setAgentMemory } from '../cache/database.js';

const anthropic = new Anthropic();
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const MAX_MEMORIES = 200;
const RATE_LIMIT_MS = 10000; // 10 seconds

// Per-tenant rate limiting
const lastExtractionTime = new Map();

function isRateLimited(tenantId) {
  const last = lastExtractionTime.get(tenantId);
  if (last && Date.now() - last < RATE_LIMIT_MS) return true;
  lastExtractionTime.set(tenantId, Date.now());
  return false;
}

function parseJsonArray(text) {
  try {
    // Try direct parse first
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch {
    // Try extracting JSON array from markdown code block or surrounding text
    const match = text.match(/\[[\s\S]*?\]/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        return [];
      }
    }
    return [];
  }
}

/**
 * Regex pre-filter to detect feedback-like content before making an API call.
 */
export function hasFeedbackSignals(text) {
  if (!text || typeof text !== 'string') return false;
  const pattern = /\b(don'?t|stop|never|always|instead|wrong|correct|fix|change|prefer|should|shouldn'?t|update|remember|going forward|irrelevant|not relevant|too generic|more specific)\b/i;
  return pattern.test(text);
}

/**
 * After a task completes, extract 0-5 key facts worth remembering using Haiku,
 * then save them via setAgentMemory(). Fire-and-forget - never blocks main pipeline.
 */
export async function extractTaskMemories(tenantId, title, category, response) {
  try {
    if (!tenantId || !response) return;

    if (isRateLimited(tenantId)) {
      console.log(`[MemoryExtractor] Rate limited for tenant ${tenantId}, skipping`);
      return;
    }

    const existing = getAgentMemory(tenantId);
    if (existing.length > MAX_MEMORIES) {
      console.log(`[MemoryExtractor] Tenant ${tenantId} has ${existing.length} memories (>${MAX_MEMORIES}), skipping extraction`);
      return;
    }

    const truncatedResponse = String(response).slice(0, 3000);

    const msg = await anthropic.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `Given this completed task and its output, extract 0-5 key facts worth remembering for future interactions. Only extract facts that would be useful in future conversations (file IDs, URLs, contact details learned, preferences expressed, project statuses, key findings, deal specifics). Skip trivial info.

Task: ${title || 'Untitled'}
Category: ${category || 'general'}
Response (first 3000 chars): ${truncatedResponse}

Return a JSON array of {key, value} objects. Use namespaced keys (contact:, project:, file:, status:, pref:). Values must be under 200 chars. Return [] if nothing worth saving.`
        }
      ]
    });

    const responseText = msg.content?.[0]?.text || '[]';
    const memories = parseJsonArray(responseText);

    let savedCount = 0;
    for (const mem of memories) {
      if (!mem || typeof mem.key !== 'string' || typeof mem.value !== 'string') continue;

      const key = mem.key.trim();
      const value = mem.value.trim().slice(0, 200);
      if (!key || !value) continue;

      // Dedup: skip if existing value is essentially the same
      const existingValue = getAgentMemoryValue(tenantId, key);
      if (existingValue && existingValue.trim().toLowerCase() === value.toLowerCase()) continue;

      setAgentMemory(tenantId, key, value);
      savedCount++;
    }

    if (savedCount > 0) {
      console.log(`[MemoryExtractor] Saved ${savedCount} memories for tenant ${tenantId}`);
    }
  } catch (err) {
    console.error(`[MemoryExtractor] Task extraction failed for tenant ${tenantId}:`, err.message);
  }
}

/**
 * Extract feedback/corrections from trusted sender emails and save them.
 * Fire-and-forget - never blocks main pipeline.
 */
export async function extractEmailFeedback(tenantId, senderEmail, subject, body) {
  try {
    if (!tenantId || !body) return;

    // Quick pre-filter - skip if no feedback signals detected
    if (!hasFeedbackSignals(subject + ' ' + body)) return;

    if (isRateLimited(tenantId)) {
      console.log(`[MemoryExtractor] Rate limited for tenant ${tenantId}, skipping email feedback`);
      return;
    }

    const existing = getAgentMemory(tenantId);
    if (existing.length > MAX_MEMORIES) {
      console.log(`[MemoryExtractor] Tenant ${tenantId} has ${existing.length} memories (>${MAX_MEMORIES}), skipping extraction`);
      return;
    }

    const truncatedBody = String(body).slice(0, 2000);

    const msg = await anthropic.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content: `This email is from a trusted contact and may contain feedback about the AI agent's work. Extract 0-3 behavioral corrections or preferences. Only extract things the agent should do differently next time.

From: ${senderEmail || 'unknown'}
Subject: ${subject || '(no subject)'}
Body (first 2000 chars): ${truncatedBody}

Return a JSON array of {key, value} objects using feedback: prefix keys. Return [] if no actionable feedback.`
        }
      ]
    });

    const responseText = msg.content?.[0]?.text || '[]';
    const memories = parseJsonArray(responseText);

    let savedCount = 0;
    for (const mem of memories) {
      if (!mem || typeof mem.key !== 'string' || typeof mem.value !== 'string') continue;

      const key = mem.key.trim();
      const value = mem.value.trim().slice(0, 200);
      if (!key || !value) continue;
      if (!key.startsWith('feedback:')) continue;

      // Dedup: skip if existing value is essentially the same
      const existingValue = getAgentMemoryValue(tenantId, key);
      if (existingValue && existingValue.trim().toLowerCase() === value.toLowerCase()) continue;

      setAgentMemory(tenantId, key, value);
      savedCount++;
    }

    if (savedCount > 0) {
      console.log(`[MemoryExtractor] Saved ${savedCount} memories for tenant ${tenantId}`);
    }
  } catch (err) {
    console.error(`[MemoryExtractor] Email feedback extraction failed for tenant ${tenantId}:`, err.message);
  }
}
