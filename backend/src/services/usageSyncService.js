/**
 * Usage Sync Service - Periodically fetches real usage data from external API
 * providers and syncs it to the service_quotas table.
 *
 * Syncs: ElevenLabs, Recall.ai, Apify, Anthropic API (internal), Claude Max (internal)
 * Runs every 15 minutes for all tenants.
 */

import { getTenantDb, getAllTenants, runWithTenant } from '../cache/database.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Get the Unix timestamp for the start of the current month (UTC).
 */
function getMonthStartUnix() {
  const now = new Date();
  return Math.floor(new Date(now.getUTCFullYear(), now.getUTCMonth(), 1).getTime() / 1000);
}

/**
 * Get an ISO date string for the start of the current month.
 */
function getMonthStartISO() {
  const now = new Date();
  return new Date(now.getUTCFullYear(), now.getUTCMonth(), 1).toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * Directly set used_this_month for a service in a tenant's DB.
 */
function setServiceUsage(tenantId, service, usedAmount) {
  const tdb = getTenantDb(tenantId);
  tdb.prepare(
    'UPDATE service_quotas SET used_this_month = ?, updated_at = datetime(\'now\') WHERE tenant_id = ? AND service = ?'
  ).run(usedAmount, tenantId, service);
}

// ─── ElevenLabs ─────────────────────────────────────────────────────────────

/**
 * Fetch character usage from ElevenLabs character-stats endpoint.
 * Sums the "All" usage array for total characters consumed this month.
 */
export async function syncElevenLabsUsage(tenantId) {
  const apiKey = process.env.ELEVENLABS_API_KEY || '';
  if (!apiKey || apiKey === 'DISABLED') return null;

  const monthStart = getMonthStartUnix();
  const now = Math.floor(Date.now() / 1000);

  const res = await fetch(
    `https://api.elevenlabs.io/v1/usage/character-stats?start_unix=${monthStart}&end_unix=${now}`,
    { headers: { 'xi-api-key': apiKey } }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`ElevenLabs usage API error (${res.status}): ${errText}`);
  }

  const data = await res.json();

  // Response shape: { usage: { All: [number, ...], ... } }
  // Sum all values in the "All" array for total characters this billing period
  const allUsage = data?.usage?.All || [];
  const totalCharacters = allUsage.reduce((sum, val) => sum + (val || 0), 0);

  setServiceUsage(tenantId, 'elevenlabs', totalCharacters);
  return totalCharacters;
}

// ─── Recall.ai ──────────────────────────────────────────────────────────────

/**
 * Fetch billing usage from Recall.ai.
 * Returns total seconds all-time; we convert to minutes and store as total.
 */
export async function syncRecallUsage(tenantId) {
  const apiKey = process.env.RECALL_API_KEY || '';
  if (!apiKey || apiKey === 'DISABLED') return null;

  const region = process.env.RECALL_REGION || 'us-west-2';

  const res = await fetch(
    `https://${region}.recall.ai/api/v1/billing/usage/`,
    { headers: { 'Authorization': `Token ${apiKey}`, 'Content-Type': 'application/json' } }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Recall usage API error (${res.status}): ${errText}`);
  }

  const data = await res.json();

  // Response: { bot_total: 60311.105705 } (total seconds all-time)
  const totalSeconds = data?.bot_total || 0;
  const totalMinutes = Math.round(totalSeconds / 60);

  setServiceUsage(tenantId, 'recall', totalMinutes);
  return totalMinutes;
}

// ─── Apify ──────────────────────────────────────────────────────────────────

/**
 * Fetch monthly usage from Apify.
 * Sums amountAfterVolumeDiscountUsd across all service types for total USD spend.
 */
export async function syncApifyUsage(tenantId) {
  const apiToken = process.env.APIFY_API_TOKEN || '';
  if (!apiToken || apiToken === 'DISABLED') return null;

  const res = await fetch(
    'https://api.apify.com/v2/users/me/usage/monthly',
    { headers: { 'Authorization': `Bearer ${apiToken}` } }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Apify usage API error (${res.status}): ${errText}`);
  }

  const data = await res.json();

  // Response: { data: { monthlyServiceUsage: { serviceType: { amountAfterVolumeDiscountUsd, ... }, ... } } }
  const serviceUsage = data?.data?.monthlyServiceUsage || {};
  let totalUsd = 0;
  let scrapeCount = 0;

  for (const [serviceType, usage] of Object.entries(serviceUsage)) {
    totalUsd += usage?.amountAfterVolumeDiscountUsd || 0;
    // Count dataset reads as scrapes
    if (serviceType.toLowerCase().includes('dataset') || serviceType.toLowerCase().includes('read')) {
      scrapeCount += usage?.quantity || 0;
    }
  }

  // Store scrape count as the primary usage metric (matches 'scrapes' unit in service_quotas)
  const usageValue = scrapeCount || Math.round(totalUsd * 100); // fallback to cents if no scrape count
  setServiceUsage(tenantId, 'apify', usageValue);
  return { scrapes: scrapeCount, totalUsd: Math.round(totalUsd * 100) / 100 };
}

// ─── Anthropic API (Internal) ───────────────────────────────────────────────

/**
 * Count Anthropic API usage from chat_messages this month.
 * Filters for non-CLI models (API calls only, not Claude Max/CLI).
 */
export async function syncAnthropicUsage(tenantId) {
  const tdb = getTenantDb(tenantId);
  const monthStart = getMonthStartISO();

  const result = tdb.prepare(`
    SELECT
      COUNT(*) as requests,
      SUM(json_extract(metadata_json, '$.input_tokens')) as input_tokens,
      SUM(json_extract(metadata_json, '$.output_tokens')) as output_tokens
    FROM chat_messages
    WHERE tenant_id = ?
      AND role = 'assistant'
      AND metadata_json IS NOT NULL
      AND json_extract(metadata_json, '$.model') IS NOT NULL
      AND json_extract(metadata_json, '$.model') != 'claude-code-cli'
      AND created_at >= ?
  `).get(tenantId, monthStart);

  const requests = result?.requests || 0;
  setServiceUsage(tenantId, 'anthropic_api', requests);
  return {
    requests,
    input_tokens: result?.input_tokens || 0,
    output_tokens: result?.output_tokens || 0,
  };
}

// ─── Claude Max (Internal) ──────────────────────────────────────────────────

/**
 * Count Claude Max (CLI) usage from chat_messages this month.
 * Filters for model = 'claude-code-cli'.
 */
export async function syncClaudeMaxUsage(tenantId) {
  const tdb = getTenantDb(tenantId);
  const monthStart = getMonthStartISO();

  const result = tdb.prepare(`
    SELECT COUNT(*) as sessions
    FROM chat_messages
    WHERE tenant_id = ?
      AND role = 'assistant'
      AND metadata_json IS NOT NULL
      AND json_extract(metadata_json, '$.model') = 'claude-code-cli'
      AND created_at >= ?
  `).get(tenantId, monthStart);

  const sessions = result?.sessions || 0;
  setServiceUsage(tenantId, 'claude_max', sessions);
  return sessions;
}

// ─── Main Sync ──────────────────────────────────────────────────────────────

/**
 * Sync all usage data for a single tenant.
 * Each sync is independent - one failure does not block others.
 */
export async function syncAllUsage(tenantId) {
  const results = {};
  const errors = [];

  // ElevenLabs
  try {
    results.elevenlabs = await syncElevenLabsUsage(tenantId);
  } catch (e) {
    errors.push(`ElevenLabs: ${e.message}`);
  }

  // Recall.ai
  try {
    results.recall = await syncRecallUsage(tenantId);
  } catch (e) {
    errors.push(`Recall: ${e.message}`);
  }

  // Apify
  try {
    results.apify = await syncApifyUsage(tenantId);
  } catch (e) {
    errors.push(`Apify: ${e.message}`);
  }

  // Anthropic API (internal query)
  try {
    results.anthropic = await syncAnthropicUsage(tenantId);
  } catch (e) {
    errors.push(`Anthropic: ${e.message}`);
  }

  // Claude Max (internal query)
  try {
    results.claudeMax = await syncClaudeMaxUsage(tenantId);
  } catch (e) {
    errors.push(`ClaudeMax: ${e.message}`);
  }

  // Log summary
  const parts = [];
  if (results.elevenlabs != null) parts.push(`ElevenLabs: ${results.elevenlabs} characters`);
  if (results.recall != null) parts.push(`Recall: ${results.recall} minutes`);
  if (results.apify != null) parts.push(`Apify: ${results.apify.scrapes} scrapes ($${results.apify.totalUsd})`);
  if (results.anthropic != null) parts.push(`Anthropic: ${results.anthropic.requests} requests (${results.anthropic.input_tokens || 0} in / ${results.anthropic.output_tokens || 0} out tokens)`);
  if (results.claudeMax != null) parts.push(`ClaudeMax: ${results.claudeMax} sessions`);

  if (parts.length > 0) {
    console.log(`[UsageSync] ${tenantId}: ${parts.join(', ')}`);
  }

  if (errors.length > 0) {
    console.warn(`[UsageSync] ${tenantId} errors: ${errors.join('; ')}`);
  }

  return { results, errors };
}

// ─── Scheduled Job ──────────────────────────────────────────────────────────

let syncInterval = null;

/**
 * Start the usage sync job. Runs syncAllUsage for ALL tenants every 15 minutes.
 * First run occurs 30 seconds after startup to avoid blocking initialization.
 */
export function startUsageSyncJob() {
  if (syncInterval) {
    console.warn('[UsageSync] Job already running, skipping duplicate start');
    return;
  }

  console.log('[UsageSync] Scheduling usage sync job (every 15 minutes)');

  // Run once after 30-second startup delay
  setTimeout(async () => {
    await runSyncForAllTenants();

    // Then repeat every 15 minutes
    syncInterval = setInterval(runSyncForAllTenants, 15 * 60 * 1000);
  }, 30 * 1000);
}

/**
 * Stop the usage sync job.
 */
export function stopUsageSyncJob() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    console.log('[UsageSync] Job stopped');
  }
}

/**
 * Run sync for all tenants. Used internally by the scheduled job.
 */
async function runSyncForAllTenants() {
  try {
    const tenants = getAllTenants();
    console.log(`[UsageSync] Starting sync for ${tenants.length} tenants`);

    for (const tenant of tenants) {
      try {
        await runWithTenant(tenant.id, () => syncAllUsage(tenant.id));
      } catch (e) {
        console.error(`[UsageSync] Failed for tenant ${tenant.id}:`, e.message);
      }
    }

    console.log('[UsageSync] Sync complete');
  } catch (e) {
    console.error('[UsageSync] Fatal error during sync:', e.message);
  }
}
