import crypto from 'crypto';
import {
  getWebhooksByEvent,
  insertWebhookDelivery,
  getWebhook,
  updateWebhook,
  getPendingWebhookDeliveries
} from '../cache/database.js';

// ─── Supported Webhook Event Types ──────────────────────────────────────────

export const WEBHOOK_EVENT_TYPES = [
  'curtailment.recommendation',
  'curtailment.executed',
  'agent.approval_required',
  'agent.action_executed',
  'alert.critical',
  'alert.warning',
  'pool.hashrate_deviation',
  'pool.worker_dead',
  'energy.price_spike',
  'energy.grid_emergency',
  'report.generated',
  'hpc.sla_warning'
];

// ─── Payload Signing ────────────────────────────────────────────────────────

/**
 * HMAC-SHA256 sign a JSON payload string with the given secret.
 * Returns the hex digest.
 */
export function signPayload(payload, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
}

// ─── Single Webhook Delivery ────────────────────────────────────────────────

/**
 * Deliver a webhook event to a single registered endpoint.
 *
 * - Looks up the webhook config by id
 * - Builds and signs the payload
 * - POSTs to the webhook URL with a 10-second timeout
 * - Logs the delivery result and updates webhook health counters
 */
export async function deliverWebhook(webhookId, eventType, data) {
  const webhook = getWebhook(webhookId);
  if (!webhook) {
    console.error(`[webhook] Webhook ${webhookId} not found`);
    return;
  }

  // Build the payload
  const payload = {
    id: crypto.randomUUID(),
    type: eventType,
    timestamp: new Date().toISOString(),
    tenantId: webhook.tenant_id,
    data
  };

  const payloadString = JSON.stringify(payload);
  const signature = signPayload(payloadString, webhook.secret);

  // 10-second timeout via AbortController
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-MineOS-Signature': `sha256=${signature}`,
        'X-MineOS-Event': eventType
      },
      body: payloadString,
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (response.ok) {
      // ── Success ──────────────────────────────────────────────────────────
      insertWebhookDelivery({
        webhookId,
        eventType,
        payload,
        status: 'delivered',
        statusCode: response.status,
        responseBody: await response.text(),
        attempts: 1,
        nextRetry: null
      });

      updateWebhook(webhookId, {
        lastSuccess: new Date().toISOString(),
        failureCount: 0
      });
    } else {
      // ── Non-2xx response ─────────────────────────────────────────────────
      const body = await response.text();
      handleDeliveryFailure(webhookId, eventType, payload, response.status, body);
    }
  } catch (err) {
    clearTimeout(timeout);

    // ── Network / timeout error ──────────────────────────────────────────
    handleDeliveryFailure(
      webhookId,
      eventType,
      payload,
      null,
      err.name === 'AbortError' ? 'Request timed out (10s)' : err.message
    );
  }
}

/**
 * Shared failure handler — logs the delivery and bumps the failure counter.
 * If the webhook has failed >= 10 consecutive times it is paused.
 */
function handleDeliveryFailure(webhookId, eventType, payload, statusCode, responseBody) {
  const webhook = getWebhook(webhookId);
  const newFailureCount = (webhook?.failure_count ?? 0) + 1;

  insertWebhookDelivery({
    webhookId,
    eventType,
    payload,
    status: 'failed',
    statusCode,
    responseBody,
    attempts: 1,
    nextRetry: null
  });

  const updates = {
    failureCount: newFailureCount,
    lastFailure: new Date().toISOString()
  };

  if (newFailureCount >= 10) {
    updates.status = 'paused';
    console.warn(`[webhook] Webhook ${webhookId} paused after ${newFailureCount} consecutive failures`);
  }

  updateWebhook(webhookId, updates);
}

// ─── Event Emitter (main entry point) ───────────────────────────────────────

/**
 * Emit a webhook event to every active webhook that subscribes to `eventType`
 * for the given tenant.  Deliveries are fire-and-forget so they never block
 * the caller.
 */
export async function emitEvent(tenantId, eventType, data) {
  const webhooks = getWebhooksByEvent(tenantId, eventType);

  for (const webhook of webhooks) {
    deliverWebhook(webhook.id, eventType, data).catch(err => {
      console.error(`[webhook] Delivery failed for webhook ${webhook.id}:`, err.message);
    });
  }
}

// ─── Retry Logic ────────────────────────────────────────────────────────────

/**
 * Process all pending webhook deliveries that are due for a retry.
 *
 * - Attempts <= 3  → re-deliver
 * - Attempts >= 3  → mark as 'abandoned'
 * - Retry backoff  → attempts * 5 minutes
 */
export async function retryFailedDeliveries() {
  const pending = getPendingWebhookDeliveries();

  for (const delivery of pending) {
    if (delivery.attempts >= 3) {
      // Give up — mark abandoned
      insertWebhookDelivery({
        webhookId: delivery.webhook_id,
        eventType: delivery.event_type,
        payload: JSON.parse(delivery.payload_json),
        status: 'abandoned',
        statusCode: delivery.status_code,
        responseBody: delivery.response_body,
        attempts: delivery.attempts,
        nextRetry: null
      });
      continue;
    }

    // Attempt re-delivery
    const webhook = getWebhook(delivery.webhook_id);
    if (!webhook || webhook.status !== 'active') continue;

    const payload = JSON.parse(delivery.payload_json);
    const payloadString = JSON.stringify(payload);
    const signature = signPayload(payloadString, webhook.secret);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-MineOS-Signature': `sha256=${signature}`,
          'X-MineOS-Event': delivery.event_type
        },
        body: payloadString,
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (response.ok) {
        insertWebhookDelivery({
          webhookId: delivery.webhook_id,
          eventType: delivery.event_type,
          payload,
          status: 'delivered',
          statusCode: response.status,
          responseBody: await response.text(),
          attempts: delivery.attempts + 1,
          nextRetry: null
        });

        updateWebhook(delivery.webhook_id, {
          lastSuccess: new Date().toISOString(),
          failureCount: 0
        });
      } else {
        const nextRetry = new Date(Date.now() + (delivery.attempts + 1) * 5 * 60_000).toISOString();

        insertWebhookDelivery({
          webhookId: delivery.webhook_id,
          eventType: delivery.event_type,
          payload,
          status: 'pending',
          statusCode: response.status,
          responseBody: await response.text(),
          attempts: delivery.attempts + 1,
          nextRetry
        });
      }
    } catch (err) {
      clearTimeout(timeout);

      const nextRetry = new Date(Date.now() + (delivery.attempts + 1) * 5 * 60_000).toISOString();

      insertWebhookDelivery({
        webhookId: delivery.webhook_id,
        eventType: delivery.event_type,
        payload,
        status: 'pending',
        statusCode: null,
        responseBody: err.name === 'AbortError' ? 'Request timed out (10s)' : err.message,
        attempts: delivery.attempts + 1,
        nextRetry
      });
    }
  }
}

// ─── Scheduler ──────────────────────────────────────────────────────────────

/**
 * Start a recurring interval that retries failed webhook deliveries.
 *
 * @param {number} intervalMinutes - How often to check, defaults to 2 minutes.
 * @returns {NodeJS.Timeout} The interval handle (for clearing later).
 */
export function startWebhookRetryScheduler(intervalMinutes = 2) {
  const intervalMs = intervalMinutes * 60_000;

  return setInterval(() => {
    retryFailedDeliveries().catch(err => {
      console.error('[webhook] Retry scheduler error:', err.message);
    });
  }, intervalMs);
}
