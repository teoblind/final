/**
 * Chat Health Check - BBB Heartbeat Monitor
 *
 * Sends test messages through the full chat pipeline every 5 minutes
 * to catch errors before users do. Tests both chat() and chatStream()
 * for every active tenant.
 *
 * If a failure is detected, logs prominently and retries once after 30s.
 * Consecutive failures are tracked per-tenant.
 */

import { chat, chatStream } from '../services/chatService.js';
import { getAllTenants } from '../cache/database.js';

let timer = null;
const HEALTH_PROMPT = 'Health check. Respond with exactly: OK';
const HEALTH_USER = 'health-check';
const HEALTH_AGENT = 'hivemind';
const MAX_RESPONSE_MS = 30000;

// Track consecutive failures per tenant
const failureCounts = {};

function log(msg) {
  console.log(`[HealthCheck] ${msg}`);
}

function logError(msg) {
  console.error(`[HealthCheck] [FAILURE] ${msg}`);
}

async function testChat(tenantId, tenantName) {
  const start = Date.now();
  try {
    const result = await Promise.race([
      chat(tenantId, HEALTH_AGENT, HEALTH_USER, HEALTH_PROMPT, null, {}),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout after 30s')), MAX_RESPONSE_MS)),
    ]);
    const ms = Date.now() - start;
    if (!result?.response) {
      throw new Error('Empty response from chat()');
    }
    return { ok: true, ms, mode: 'chat' };
  } catch (err) {
    return { ok: false, ms: Date.now() - start, mode: 'chat', error: err.message };
  }
}

async function testChatStream(tenantId, tenantName) {
  const start = Date.now();
  try {
    let chunks = 0;
    let fullResponse = '';
    const result = await Promise.race([
      chatStream(tenantId, HEALTH_AGENT, HEALTH_USER, HEALTH_PROMPT, null, {}, (chunk) => {
        chunks++;
        if (chunk.type === 'text') fullResponse += chunk.text;
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout after 30s')), MAX_RESPONSE_MS)),
    ]);
    const ms = Date.now() - start;
    if (chunks === 0) {
      throw new Error('No chunks received from chatStream()');
    }
    return { ok: true, ms, mode: 'stream', chunks };
  } catch (err) {
    return { ok: false, ms: Date.now() - start, mode: 'stream', error: err.message };
  }
}

async function runHealthCheck() {
  const tenants = getAllTenants().filter(t => t.status === 'active');
  log(`Running health check across ${tenants.length} tenants...`);

  const results = [];

  for (const tenant of tenants) {
    const key = tenant.id;

    // Test non-streaming chat() first
    const chatResult = await testChat(tenant.id, tenant.name);

    if (chatResult.ok) {
      // Also test streaming path (this is what users actually hit)
      const streamResult = await testChatStream(tenant.id, tenant.name);

      if (streamResult.ok) {
        failureCounts[key] = 0;
        log(`${tenant.name}: OK (chat: ${chatResult.ms}ms, stream: ${streamResult.ms}ms, ${streamResult.chunks} chunks)`);
        results.push({ tenant: tenant.name, ok: true });
      } else {
        failureCounts[key] = (failureCounts[key] || 0) + 1;
        logError(`${tenant.name} chatStream() FAILED (attempt ${failureCounts[key]}): ${streamResult.error}`);
        results.push({ tenant: tenant.name, ok: false, mode: 'stream', error: streamResult.error });
      }
    } else {
      failureCounts[key] = (failureCounts[key] || 0) + 1;
      logError(`${tenant.name} chat() FAILED (attempt ${failureCounts[key]}): ${chatResult.error}`);
      results.push({ tenant: tenant.name, ok: false, mode: 'chat', error: chatResult.error });

      // Retry once after 10s on first failure
      if (failureCounts[key] === 1) {
        log(`${tenant.name}: Retrying in 10s...`);
        await new Promise(r => setTimeout(r, 10000));
        const retry = await testChat(tenant.id, tenant.name);
        if (retry.ok) {
          failureCounts[key] = 0;
          log(`${tenant.name}: Retry succeeded (${retry.ms}ms)`);
          results[results.length - 1] = { tenant: tenant.name, ok: true, retried: true };
        } else {
          logError(`${tenant.name}: Retry also FAILED: ${retry.error}`);
        }
      }
    }
  }

  const failed = results.filter(r => !r.ok);
  if (failed.length > 0) {
    logError(`${failed.length}/${results.length} tenant(s) failing: ${failed.map(f => `${f.tenant} (${f.error})`).join(', ')}`);
  } else {
    log(`All ${results.length} tenants healthy.`);
  }

  return results;
}

export function startChatHealthCheck(intervalMs = 5 * 60 * 1000) {
  if (timer) return;
  log(`Starting - will check every ${Math.round(intervalMs / 60000)} minutes`);

  // First check 60s after boot (let everything initialize)
  setTimeout(() => {
    runHealthCheck().catch(err => logError(`Unhandled: ${err.message}`));
    timer = setInterval(() => {
      runHealthCheck().catch(err => logError(`Unhandled: ${err.message}`));
    }, intervalMs);
  }, 60000);
}

export function stopChatHealthCheck() {
  if (timer) { clearInterval(timer); timer = null; }
  log('Stopped');
}

export { runHealthCheck };
