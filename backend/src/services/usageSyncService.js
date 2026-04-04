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
 * Fetch character usage from ElevenLabs subscription endpoint.
 * Returns character_count (used this billing period) from user/subscription.
 */
export async function syncElevenLabsUsage(tenantId) {
  const apiKey = process.env.ELEVENLABS_API_KEY || '';
  if (!apiKey || apiKey === 'DISABLED') return null;

  const res = await fetch(
    'https://api.elevenlabs.io/v1/user/subscription',
    { headers: { 'xi-api-key': apiKey } }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`ElevenLabs subscription API error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const totalCharacters = data?.character_count || 0;
  const characterLimit = data?.character_limit || 0;

  setServiceUsage(tenantId, 'elevenlabs', totalCharacters);

  // Also update the allotment if it differs (in case plan changed)
  if (characterLimit > 0) {
    const tdb = getTenantDb(tenantId);
    tdb.prepare(
      'UPDATE service_quotas SET monthly_allotment = ? WHERE tenant_id = ? AND service = ?'
    ).run(characterLimit, tenantId, 'elevenlabs');
  }

  return totalCharacters;
}

// ─── Recall.ai ──────────────────────────────────────────────────────────────

/**
 * Fetch billing usage from Recall.ai for the current month.
 * Uses start/end params to get only this billing period.
 */
export async function syncRecallUsage(tenantId) {
  const apiKey = process.env.RECALL_API_KEY || '';
  if (!apiKey || apiKey === 'DISABLED') return null;

  const region = process.env.RECALL_REGION || 'us-west-2';
  const now = new Date();
  const monthStart = new Date(now.getUTCFullYear(), now.getUTCMonth(), 1).toISOString();
  const monthEnd = now.toISOString();

  const res = await fetch(
    `https://${region}.recall.ai/api/v1/billing/usage/?start=${monthStart}&end=${monthEnd}`,
    { headers: { 'Authorization': `Token ${apiKey}`, 'Content-Type': 'application/json' } }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Recall usage API error (${res.status}): ${errText}`);
  }

  const data = await res.json();

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

  // Store total spend in cents as the primary usage metric
  const spendCents = Math.round(totalUsd * 100);
  setServiceUsage(tenantId, 'apify', spendCents);
  return { scrapes: scrapeCount, spendCents, totalUsd: Math.round(totalUsd * 100) / 100 };
}

// ─── Fal AI ────────────────────────────────────────────────────────────────

/**
 * Fetch credit balance from Fal AI.
 * Only available with an admin key. Stores remaining credits (in cents).
 */
export async function syncFalAiUsage(tenantId) {
  const adminKey = process.env.FAL_AI_ADMIN_KEY || '';
  if (!adminKey || adminKey === 'DISABLED') return null;

  const res = await fetch(
    'https://api.fal.ai/v1/account/billing?expand=credits',
    { headers: { 'Authorization': `Key ${adminKey}` } }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Fal AI billing API error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const balance = data?.credits?.current_balance || 0;

  // Store spend in cents (total credits used = initial deposit - current balance)
  // We track balance for display, but usage is stored as spend
  const balanceCents = Math.round(balance * 100);
  setServiceUsage(tenantId, 'fal_ai', balanceCents);
  return { balance, balanceCents };
}

// ─── Apollo Credits ────────────────────────────────────────────────────────

/**
 * Fetch Apollo API usage stats for the current day.
 * Tracks daily API call consumption across all endpoints.
 */
export async function syncApolloUsage(tenantId) {
  const apiKey = process.env.APOLLO_API_KEY || '';
  if (!apiKey || apiKey === 'DISABLED') return null;

  const res = await fetch(
    'https://api.apollo.io/api/v1/usage_stats/api_usage_stats',
    {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Apollo usage API error (${res.status}): ${errText}`);
  }

  const data = await res.json();

  // Sum consumed calls across all endpoints for the day
  let totalConsumed = 0;
  for (const [, stats] of Object.entries(data || {})) {
    if (stats?.daily?.consumed) totalConsumed += stats.daily.consumed;
  }

  setServiceUsage(tenantId, 'apollo', totalConsumed);
  return totalConsumed;
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

  // Count distinct agent runs (conversations), not individual messages
  const result = tdb.prepare(`
    SELECT
      COUNT(DISTINCT json_extract(metadata_json, '$.conversation_id')) as agent_runs,
      COUNT(*) as total_messages
    FROM chat_messages
    WHERE tenant_id = ?
      AND role = 'assistant'
      AND metadata_json IS NOT NULL
      AND json_extract(metadata_json, '$.model') = 'claude-code-cli'
      AND created_at >= ?
  `).get(tenantId, monthStart);

  // Store agent run count (more meaningful than raw message count)
  const runs = result?.agent_runs || 0;
  setServiceUsage(tenantId, 'claude_max_1', runs);
  return { runs, messages: result?.total_messages || 0 };
}

// ─── Mercury Banking ────────────────────────────────────────────────────────

/**
 * Fetch Mercury bank account balances and recent transactions.
 * Returns account summaries and this month's transaction totals by category.
 * This is global (not per-tenant) - stored in the first tenant's DB.
 */
export async function syncMercuryData() {
  const apiKey = process.env.MERCURY_API_KEY || '';
  if (!apiKey || apiKey === 'DISABLED') return null;

  const headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

  // Fetch accounts
  const accountsRes = await fetch('https://api.mercury.com/api/v1/accounts', { headers });
  if (!accountsRes.ok) {
    const errText = await accountsRes.text();
    throw new Error(`Mercury accounts API error (${accountsRes.status}): ${errText}`);
  }
  const accountsData = await accountsRes.json();
  const accounts = accountsData?.accounts || [];

  // Fetch this month's transactions for each account
  const now = new Date();
  const monthStart = new Date(now.getUTCFullYear(), now.getUTCMonth(), 1).toISOString().slice(0, 10);
  const monthEnd = now.toISOString().slice(0, 10);

  let allTransactions = [];
  for (const acct of accounts) {
    try {
      const txRes = await fetch(
        `https://api.mercury.com/api/v1/account/${acct.id}/transactions?start=${monthStart}&end=${monthEnd}&limit=500`,
        { headers }
      );
      if (txRes.ok) {
        const txData = await txRes.json();
        const txns = txData?.transactions || [];
        allTransactions.push(...txns.map(t => ({ ...t, accountName: acct.name, accountKind: acct.kind })));
      }
    } catch (e) {
      console.warn(`[UsageSync] Mercury txn fetch failed for ${acct.name}:`, e.message);
    }
  }

  // Summarize
  const totalBalance = accounts.reduce((s, a) => s + (a.currentBalance || 0), 0);
  const totalSpend = allTransactions
    .filter(t => t.amount < 0 && t.status !== 'cancelled')
    .reduce((s, t) => s + Math.abs(t.amount), 0);
  const totalIncome = allTransactions
    .filter(t => t.amount > 0 && t.status !== 'cancelled')
    .reduce((s, t) => s + t.amount, 0);

  return {
    accounts: accounts.map(a => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      currentBalance: a.currentBalance,
      availableBalance: a.availableBalance,
      status: a.status,
    })),
    totalBalance,
    totalSpendThisMonth: totalSpend,
    totalIncomeThisMonth: totalIncome,
    transactionCount: allTransactions.length,
    transactions: allTransactions.slice(0, 50).map(t => ({
      id: t.id,
      amount: t.amount,
      counterpartyName: t.counterpartyName || t.counterpartyNickname || 'Unknown',
      note: t.note || '',
      status: t.status,
      postedDate: t.postedDate,
      kind: t.kind,
      accountName: t.accountName,
    })),
  };
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

  // Fal AI
  try {
    results.falAi = await syncFalAiUsage(tenantId);
  } catch (e) {
    errors.push(`FalAI: ${e.message}`);
  }

  // Apollo
  try {
    results.apollo = await syncApolloUsage(tenantId);
  } catch (e) {
    errors.push(`Apollo: ${e.message}`);
  }

  // Log summary
  const parts = [];
  if (results.elevenlabs != null) parts.push(`ElevenLabs: ${results.elevenlabs} characters`);
  if (results.recall != null) parts.push(`Recall: ${results.recall} minutes`);
  if (results.apify != null) parts.push(`Apify: $${results.apify.totalUsd} (${results.apify.scrapes} scrapes)`);
  if (results.anthropic != null) parts.push(`Anthropic: ${results.anthropic.requests} requests (${results.anthropic.input_tokens || 0} in / ${results.anthropic.output_tokens || 0} out tokens)`);
  if (results.claudeMax != null) parts.push(`ClaudeMax: ${results.claudeMax.runs} runs (${results.claudeMax.messages} msgs)`);
  if (results.falAi != null) parts.push(`FalAI: $${results.falAi.balance} remaining`);
  if (results.apollo != null) parts.push(`Apollo: ${results.apollo} API calls today`);

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
