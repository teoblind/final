/**
 * Price Monitor Job
 *
 * 5-minute poll: fetch ERCOT + CAISO real-time prices, store in energy_prices,
 * check alert rules, and broadcast via WebSocket.
 */

import { insertEnergyPrices, getPriceAlertRules, updateAlertRuleLastTriggered, insertActivity, runWithTenant, getAllTenants, getTenantDb } from '../cache/database.js';
import { fetchErcotData } from '../services/ercotService.js';
import { fetchRealtimeLmp as fetchCaisoLmp, CAISO_NODES } from '../services/caisoService.js';

// Lazy import to avoid circular dependency with index.js
let _broadcast = null;
async function getBroadcast() {
  if (!_broadcast) {
    const mod = await import('../index.js');
    _broadcast = mod.broadcast;
  }
  return _broadcast;
}

// ERCOT nodes to monitor
const ERCOT_NODES = ['HB_NORTH', 'HB_SOUTH', 'HB_WEST', 'HB_HOUSTON'];

// In-memory latest prices for quick access
let latestPrices = {};

/**
 * Get the latest cached prices.
 */
export function getLatestPrices() {
  return latestPrices;
}

/**
 * Fetch prices from all ISOs and store in DB.
 */
async function fetchAndStorePrices() {
  const allRecords = [];

  // ─── ERCOT ──────────────────────────────────────────────────────────────
  for (const node of ERCOT_NODES) {
    try {
      const data = await fetchErcotData(node);
      if (data?.realTimePrice) {
        allRecords.push({
          iso: 'ERCOT',
          node,
          timestamp: data.timestamp || new Date().toISOString(),
          market_type: 'realtime',
          lmp: data.realTimePrice.lmp,
          energy_component: data.realTimePrice.energyComponent || null,
          congestion_component: data.realTimePrice.congestionComponent || null,
          loss_component: data.realTimePrice.lossComponent || null,
        });
      }
    } catch (err) {
      console.warn(`[PriceMonitor] ERCOT ${node} fetch error: ${err.message}`);
    }
  }

  // ─── CAISO ──────────────────────────────────────────────────────────────
  try {
    const caisoPrices = await fetchCaisoLmp(CAISO_NODES);
    if (Array.isArray(caisoPrices) && caisoPrices.length > 0) {
      allRecords.push(...caisoPrices);
    }
  } catch (err) {
    console.warn(`[PriceMonitor] CAISO fetch error: ${err.message}`);
  }

  // Store in DB
  if (allRecords.length > 0) {
    try {
      insertEnergyPrices(allRecords);
    } catch (err) {
      console.warn(`[PriceMonitor] DB insert error: ${err.message}`);
    }
  }

  // Update in-memory cache
  for (const record of allRecords) {
    const key = `${record.iso}:${record.node}`;
    latestPrices[key] = {
      iso: record.iso,
      node: record.node,
      lmp: record.lmp,
      energy: record.energy_component,
      congestion: record.congestion_component,
      loss: record.loss_component,
      timestamp: record.timestamp,
    };
  }

  return allRecords;
}

/**
 * Check alert rules against current prices.
 */
async function checkAlertRules(records) {
  // Group records by iso+node for quick lookup
  const priceMap = {};
  for (const r of records) {
    priceMap[`${r.iso}:${r.node}`] = r;
  }

  // Get all alert rules across tenants
  const rules = getPriceAlertRules();

  for (const rule of rules) {
    if (!rule.enabled) continue;

    const key = `${rule.iso}:${rule.node}`;
    const price = priceMap[key];
    if (!price) continue;

    // Check threshold
    const triggered = rule.direction === 'above'
      ? price.lmp >= rule.threshold
      : price.lmp <= rule.threshold;

    if (!triggered) continue;

    // Check cooldown
    if (rule.last_triggered_at) {
      const cooldownMs = (rule.cooldown_minutes || 30) * 60 * 1000;
      const elapsed = Date.now() - new Date(rule.last_triggered_at).getTime();
      if (elapsed < cooldownMs) continue;
    }

    // Fire alert
    console.log(`[PriceMonitor] Alert triggered: ${rule.iso} ${rule.node} ${price.lmp} ${rule.direction} ${rule.threshold}`);

    // Update last triggered
    updateAlertRuleLastTriggered(rule.id);

    // Log activity
    insertActivity({
      tenantId: rule.tenant_id,
      type: 'alert',
      title: `Price alert: ${rule.iso} ${rule.node}`,
      subtitle: `$${price.lmp.toFixed(2)}/MWh ${rule.direction} threshold $${rule.threshold}/MWh`,
      detailJson: JSON.stringify({
        iso: rule.iso,
        node: rule.node,
        price: price.lmp,
        threshold: rule.threshold,
        direction: rule.direction,
      }),
      sourceType: 'price-alert',
      sourceId: `price-alert-${rule.id}-${Date.now()}`,
      agentId: 'price-monitor',
    });

    // WebSocket broadcast
    const broadcast = await getBroadcast();
    if (rule.notify_websocket && broadcast) {
      broadcast('price-alert', {
        tenantId: rule.tenant_id,
        iso: rule.iso,
        node: rule.node,
        price: price.lmp,
        threshold: rule.threshold,
        direction: rule.direction,
        ruleId: rule.id,
      });
    }

    // Trigger curtailment agent if configured
    if (rule.trigger_curtailment && broadcast) {
      broadcast('curtailment-trigger', {
        tenantId: rule.tenant_id,
        reason: 'price-alert',
        iso: rule.iso,
        node: rule.node,
        price: price.lmp,
      });
    }
  }
}

/**
 * Main poll cycle.
 */
async function poll() {
  // Store prices in default tenant context (energy prices are Sangha-owned)
  const records = await runWithTenant('default', () => fetchAndStorePrices());

  if (records.length > 0) {
    // Broadcast latest prices to all clients
    const broadcast = await getBroadcast();
    if (broadcast) {
      broadcast('price-update', {
        prices: Object.values(latestPrices),
        timestamp: new Date().toISOString(),
      });
    }

    // Check alert rules across all tenants
    const allTenants = getAllTenants();
    for (const tenant of allTenants) {
      await runWithTenant(tenant.id, () => checkAlertRules(records));
    }
  }
}

/**
 * Start the price monitor scheduler.
 * @param {number} intervalMinutes - Poll interval (default 5 min)
 */
export function startPriceMonitorScheduler(intervalMinutes = 5) {
  console.log(`[PriceMonitor] Scheduler started (every ${intervalMinutes} min)`);

  // Initial poll after 8s
  setTimeout(() => poll().catch(err => console.error('[PriceMonitor] Initial poll error:', err.message)), 8000);

  // Recurring poll
  setInterval(
    () => poll().catch(err => console.error('[PriceMonitor] Poll error:', err.message)),
    intervalMinutes * 60 * 1000
  );
}
