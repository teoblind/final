/**
 * Lead Discovery Job
 *
 * Runs nightly lead discovery cycle for all tenants with enabled lead engine config.
 * Cycle: discover → enrich → generate outreach → generate follow-ups
 */

import {
  getAllTenants,
  getLeadDiscoveryConfig,
  runWithTenant,
} from '../cache/database.js';

let interval = null;
let scheduledTimeout = null;

async function runDiscoveryCycle() {
  try {
    const { runFullCycle } = await import('../services/leadEngine.js');
    const tenants = getAllTenants();

    for (const tenant of tenants) {
      const config = getLeadDiscoveryConfig(tenant.id);
      if (!config || !config.enabled) continue;

      console.log(`[LeadDiscovery] Running cycle for tenant: ${tenant.id}`);

      try {
        await runWithTenant(tenant.id, async () => {
          const result = await runFullCycle(tenant.id);
          console.log(`[LeadDiscovery] ${tenant.id} — discovered: ${result.discovery?.newLeads || 0}, enriched: ${result.enrichment?.enriched || 0}, outreach: ${result.outreach?.generated || 0}`);
        });
      } catch (err) {
        console.error(`[LeadDiscovery] Error for tenant ${tenant.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[LeadDiscovery] Cycle error:', err.message);
  }
}

function msUntilTime(hour, minute = 0) {
  const now = new Date();
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target - now;
}

export function startLeadDiscoveryJob({ runAtHour = 2, intervalHours = 24 } = {}) {
  if (interval || scheduledTimeout) {
    console.log('[LeadDiscovery] Job already running');
    return;
  }

  const msToFirstRun = msUntilTime(runAtHour);
  const hoursToFirst = (msToFirstRun / 3600000).toFixed(1);
  console.log(`[LeadDiscovery] Scheduled — first run in ${hoursToFirst}h (at ${runAtHour}:00), then every ${intervalHours}h`);

  scheduledTimeout = setTimeout(() => {
    runDiscoveryCycle().catch(err => console.error('[LeadDiscovery] Scheduled run failed:', err.message));
    interval = setInterval(() => {
      runDiscoveryCycle().catch(err => console.error('[LeadDiscovery] Interval run failed:', err.message));
    }, intervalHours * 60 * 60 * 1000);
  }, msToFirstRun);
}

export function stopLeadDiscoveryJob() {
  if (scheduledTimeout) { clearTimeout(scheduledTimeout); scheduledTimeout = null; }
  if (interval) { clearInterval(interval); interval = null; }
  console.log('[LeadDiscovery] Job stopped');
}

// Manual trigger for testing
export { runDiscoveryCycle };
