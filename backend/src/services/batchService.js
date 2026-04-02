/**
 * Batch API Service
 *
 * Uses Anthropic's Message Batches API for long-form async generation.
 * Key advantage: 300K output tokens (vs 8K streaming) at 50% cost.
 *
 * Use cases:
 *  - Newsletter generation (full HTML in one shot)
 *  - Overnight analysis reports
 *  - Multi-section documents (estimates, proposals, reports)
 *  - Bulk content generation across tenants
 *
 * The batch API is async - requests are queued and results polled.
 * Most batches complete within 1 hour.
 */

import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'crypto';

const client = new Anthropic();

// Beta header for 300K output support
const BETA_300K = 'output-300k-2026-03-24';

// Default model for batch jobs
const BATCH_MODEL = process.env.BATCH_MODEL || 'claude-sonnet-4-6';

// ── Core Batch API ──────────────────────────────────────────────────────────

/**
 * Submit a batch of prompts for async processing.
 *
 * @param {Array<{id: string, system?: string, messages: Array, model?: string, maxTokens?: number}>} requests
 * @param {Object} [opts]
 * @param {boolean} [opts.longOutput=false] - Enable 300K output tokens (requires Opus 4.6 or Sonnet 4.6)
 * @returns {Promise<{batchId: string, requestCount: number}>}
 */
export async function submitBatch(requests, opts = {}) {
  const { longOutput = false } = opts;

  const batchRequests = requests.map(req => ({
    custom_id: req.id || randomUUID(),
    params: {
      model: req.model || BATCH_MODEL,
      max_tokens: longOutput ? 300000 : (req.maxTokens || 8192),
      ...(req.system ? { system: req.system } : {}),
      messages: req.messages,
    },
  }));

  const createParams = { requests: batchRequests };

  // Add beta header for 300K output
  if (longOutput) {
    createParams.betas = [BETA_300K];
  }

  const batch = await client.messages.batches.create(createParams);

  console.log(`[batchService] Batch created: ${batch.id} (${batchRequests.length} requests, longOutput=${longOutput})`);

  return {
    batchId: batch.id,
    requestCount: batchRequests.length,
    status: batch.processing_status,
  };
}

/**
 * Check batch status.
 * @param {string} batchId
 * @returns {Promise<{status: string, counts: Object}>}
 */
export async function getBatchStatus(batchId) {
  const batch = await client.messages.batches.retrieve(batchId);
  return {
    status: batch.processing_status,
    counts: batch.request_counts,
    createdAt: batch.created_at,
    endedAt: batch.ended_at,
  };
}

/**
 * Retrieve batch results. Only works after batch processing ends.
 * Returns a map of custom_id -> result.
 *
 * @param {string} batchId
 * @returns {Promise<Map<string, {type: string, text?: string, error?: string}>>}
 */
export async function getBatchResults(batchId) {
  const results = new Map();

  for await (const result of client.messages.batches.results(batchId)) {
    const id = result.custom_id;
    if (result.result.type === 'succeeded') {
      const msg = result.result.message;
      const text = msg.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('\n');
      results.set(id, {
        type: 'succeeded',
        text,
        inputTokens: msg.usage?.input_tokens,
        outputTokens: msg.usage?.output_tokens,
        stopReason: msg.stop_reason,
      });
    } else {
      results.set(id, {
        type: result.result.type,
        error: result.result.error?.message || 'Unknown error',
      });
    }
  }

  console.log(`[batchService] Retrieved ${results.size} results for batch ${batchId}`);
  return results;
}

/**
 * Poll batch until complete, then return results.
 * Polls every 30 seconds for up to maxWaitMs (default 1 hour).
 *
 * @param {string} batchId
 * @param {Object} [opts]
 * @param {number} [opts.pollIntervalMs=30000]
 * @param {number} [opts.maxWaitMs=3600000]
 * @param {function} [opts.onStatus] - callback(status, counts) called each poll
 * @returns {Promise<Map<string, Object>>}
 */
export async function waitForBatch(batchId, opts = {}) {
  const { pollIntervalMs = 30000, maxWaitMs = 3600000, onStatus } = opts;
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    const status = await getBatchStatus(batchId);

    if (onStatus) onStatus(status.status, status.counts);

    if (status.status === 'ended') {
      return getBatchResults(batchId);
    }

    await new Promise(r => setTimeout(r, pollIntervalMs));
  }

  throw new Error(`Batch ${batchId} did not complete within ${maxWaitMs / 1000}s`);
}

// ── Convenience: Single Long-Form Generation ────────────────────────────────

/**
 * Generate a single long-form document via batch API.
 * Submits one request, waits for completion, returns the text.
 *
 * @param {Object} opts
 * @param {string} opts.system - System prompt
 * @param {string} opts.prompt - User prompt
 * @param {string} [opts.model] - Model override
 * @param {number} [opts.maxTokens=300000] - Max output tokens
 * @returns {Promise<{text: string, inputTokens: number, outputTokens: number}>}
 */
export async function generateLongForm({ system, prompt, model, maxTokens = 300000 }) {
  const requestId = `longform-${randomUUID()}`;
  const isLongOutput = maxTokens > 8192;

  const { batchId } = await submitBatch([{
    id: requestId,
    system,
    model: model || BATCH_MODEL,
    maxTokens,
    messages: [{ role: 'user', content: prompt }],
  }], { longOutput: isLongOutput });

  const results = await waitForBatch(batchId, {
    pollIntervalMs: 15000, // check every 15s for single request
    onStatus: (status, counts) => {
      console.log(`[batchService] longform ${requestId}: ${status} (${JSON.stringify(counts)})`);
    },
  });

  const result = results.get(requestId);
  if (!result || result.type !== 'succeeded') {
    throw new Error(`Batch generation failed: ${result?.error || 'no result'}`);
  }

  return {
    text: result.text,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  };
}

// ── Newsletter Batch Generation ─────────────────────────────────────────────

/**
 * Generate newsletters for multiple tenants in a single batch.
 * Each tenant gets one batch request that produces the full HTML newsletter.
 *
 * @param {Array<{tenantId: string, tenantName: string, system: string, prompt: string}>} tenantRequests
 * @returns {Promise<Map<string, {html: string, inputTokens: number, outputTokens: number}>>}
 */
export async function batchGenerateNewsletters(tenantRequests) {
  const requests = tenantRequests.map(t => ({
    id: `newsletter-${t.tenantId}`,
    system: t.system,
    messages: [{ role: 'user', content: t.prompt }],
    maxTokens: 32000, // newsletters don't need 300K, but benefit from batch pricing
  }));

  const { batchId } = await submitBatch(requests, { longOutput: false });

  console.log(`[batchService] Newsletter batch submitted: ${batchId} for ${tenantRequests.length} tenants`);

  const results = await waitForBatch(batchId, {
    pollIntervalMs: 20000,
    onStatus: (status, counts) => {
      console.log(`[batchService] newsletter batch: ${status} (${JSON.stringify(counts)})`);
    },
  });

  const newsletters = new Map();
  for (const [id, result] of results) {
    const tenantId = id.replace('newsletter-', '');
    if (result.type === 'succeeded') {
      newsletters.set(tenantId, {
        html: result.text,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      });
    } else {
      console.error(`[batchService] Newsletter failed for ${tenantId}: ${result.error}`);
    }
  }

  return newsletters;
}

// ── Report Batch Generation ─────────────────────────────────────────────────

/**
 * Generate a full multi-section report in one shot using 300K output.
 * Ideal for: weekly reports, due diligence, market analysis, comprehensive estimates.
 *
 * @param {Object} opts
 * @param {string} opts.tenantId
 * @param {string} opts.reportType - 'weekly' | 'analysis' | 'estimate' | 'proposal'
 * @param {string} opts.system - System prompt with tenant context
 * @param {string} opts.prompt - Full report prompt with all data
 * @param {string} [opts.model] - Model override (defaults to Sonnet 4.6)
 * @returns {Promise<{text: string, inputTokens: number, outputTokens: number}>}
 */
export async function generateReport({ tenantId, reportType, system, prompt, model }) {
  console.log(`[batchService] Generating ${reportType} report for ${tenantId} via batch API`);

  return generateLongForm({
    system,
    prompt,
    model: model || BATCH_MODEL,
    maxTokens: 300000,
  });
}
