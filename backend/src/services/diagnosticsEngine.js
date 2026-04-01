/**
 * Diagnostics Engine - Phase 5
 *
 * Cross-references pool data with fleet config and curtailment events to
 * detect anomalies, reconcile hashrates, and verify curtailment compliance.
 */

import { getFleetConfig, getCurtailmentEvents } from '../cache/database.js';
import { getUnifiedPoolData, getPoolWorkers, getConfiguredPools } from './poolConnectors.js';

const HASHRATE_HEALTHY_PCT = 0.05;            // <5% = healthy
const HASHRATE_DEGRADED_PCT = 0.15;           // 5-15% = degraded, >15% = critical
const CURTAIL_CONFIRMED_PCT = 0.10;           // within 10% of expected drop
const CURTAIL_PARTIAL_PCT = 0.50;             // 10-50% off = partial
const WORKER_UNDERPERFORM_PCT = 0.80;         // <80% of model hashrate
const WORKER_DEAD_HOURS = 24;
const WORKER_HIGH_REJECT_PCT = 0.02;          // >2% reject rate

// ─── Helpers ────────────────────────────────────────────────────────────────

function getFleetExpected(config) {
  let total = 0;
  const breakdown = [];
  if (config?.entries) {
    for (const e of config.entries) {
      const s = e.overclockProfile || e.asicModel;
      const hr = s.hashrate * e.quantity;
      total += hr;
      breakdown.push({ model: e.asicModel.model || e.asicModel.id, quantity: e.quantity, hashratePerUnit: s.hashrate, totalHashrate: hr });
    }
  }
  return { total, breakdown };
}

function parseMachineClasses(raw) {
  if (!raw) return [];
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return []; }
}

// ─── Hashrate Reconciliation ────────────────────────────────────────────────

/**
 * Compare pool-reported hashrate vs fleet config expected hashrate.
 * Status: healthy (<5%), degraded (5-15%), critical (>15%).
 */
export async function getHashrateReconciliation() {
  const config = getFleetConfig();
  const pools = await getConfiguredPools();
  if (!pools || pools.length === 0) return getMockHashrateReconciliation(config);

  const { total: expectedHashrate, breakdown: machineBreakdown } = getFleetExpected(config);

  let reportedHashrate = 0;
  let poolBreakdown = [];
  try {
    const poolData = await getUnifiedPoolData();
    reportedHashrate = poolData?.totalReportedHashrate || 0;
    poolBreakdown = (poolData?.pools || []).map(p => ({
      pool: p.name || p.pool, hashrate: p.reportedHashrate || 0, workers: p.workerCount || 0,
    }));
  } catch (err) {
    return { status: 'error', message: `Failed to fetch pool data: ${err.message}`, expectedHashrate, reportedHashrate: null, timestamp: new Date().toISOString() };
  }

  const delta = reportedHashrate - expectedHashrate;
  const deltaPercent = expectedHashrate > 0 ? Math.abs(delta) / expectedHashrate : 0;
  const status = deltaPercent < HASHRATE_HEALTHY_PCT ? 'healthy' : deltaPercent < HASHRATE_DEGRADED_PCT ? 'degraded' : 'critical';

  const possibleCauses = [];
  if (status !== 'healthy') {
    if (delta < 0) {
      if (deltaPercent > 0.30)
        possibleCauses.push({ cause: 'Significant machines offline', detail: `~${Math.abs(delta).toFixed(0)} TH/s missing. Check for downed units or network issues.`, severity: 'critical' });
      if (deltaPercent > 0.05 && deltaPercent <= 0.15)
        possibleCauses.push({ cause: 'Partial fleet underperformance', detail: `${(deltaPercent * 100).toFixed(1)}% below expected. Possible thermal throttling or firmware issues.`, severity: 'warning' });
      possibleCauses.push({ cause: 'Pool reporting lag', detail: 'Pool-side hashrate averaging may lag 15-30 min.', severity: 'info' });
      possibleCauses.push({ cause: 'Active curtailment', detail: 'Machines may be intentionally curtailed per Phase 4 schedule.', severity: 'info' });
    } else {
      possibleCauses.push({ cause: 'Overclock or stale config', detail: `Pool reports ${delta.toFixed(0)} TH/s more than config. Update if machines were overclocked or added.`, severity: 'warning' });
      possibleCauses.push({ cause: 'Hashrate variance', detail: 'Short-term pool hashrate can exceed nominal due to share luck. Monitor over 6+ hours.', severity: 'info' });
    }
  }

  return { status, expectedHashrate, reportedHashrate, delta, deltaPercent: deltaPercent * 100, machineBreakdown, poolBreakdown, possibleCauses, timestamp: new Date().toISOString() };
}

// ─── Curtailment Reconciliation ─────────────────────────────────────────────

/**
 * For each recent curtailment event, verify the pool hashrate actually
 * dropped as expected. Status per event: confirmed/partial/failed.
 */
export async function getCurtailmentReconciliation(days = 7) {
  const config = getFleetConfig();
  const pools = await getConfiguredPools();
  if (!pools || pools.length === 0) return getMockCurtailmentReconciliation(days);

  const events = getCurtailmentEvents(days);
  if (!events || events.length === 0)
    return { status: 'no_events', message: `No curtailment events in the last ${days} days.`, events: [], complianceRate: null, timestamp: new Date().toISOString() };

  // Model hashrate lookup & total fleet baseline
  const modelMap = {};
  const { total: totalFleetHashrate } = getFleetExpected(config);
  if (config?.entries) {
    for (const e of config.entries) {
      const s = e.overclockProfile || e.asicModel;
      modelMap[e.asicModel.model || e.asicModel.id] = { hr: s.hashrate, qty: e.quantity };
    }
  }

  let confirmed = 0, partial = 0, failed = 0;
  const reconciled = events.map(ev => {
    const curtailedClasses = parseMachineClasses(ev.machine_classes);
    let expectedDrop = ev.hashrate_curtailed || 0;
    if (!expectedDrop && curtailedClasses.length > 0)
      for (const cls of curtailedClasses) { const m = modelMap[cls]; if (m) expectedDrop += m.hr * m.qty; }

    let actualDrop = 0, hasPool = false;
    if (ev.hashrate_online != null) { actualDrop = totalFleetHashrate - ev.hashrate_online; hasPool = true; }

    let deviation = 0, eventStatus = 'unknown';
    if (expectedDrop > 0 && hasPool) {
      deviation = Math.abs(actualDrop - expectedDrop) / expectedDrop;
      if (deviation <= CURTAIL_CONFIRMED_PCT) { eventStatus = 'confirmed'; confirmed++; }
      else if (deviation <= CURTAIL_PARTIAL_PCT) { eventStatus = 'partial'; partial++; }
      else { eventStatus = 'failed'; failed++; }
    } else { eventStatus = hasPool ? 'no_expected_drop' : 'no_pool_data'; }

    return {
      eventId: ev.id, startTime: ev.start_time, endTime: ev.end_time, triggerType: ev.trigger_type,
      reason: ev.reason, curtailedClasses, expectedDrop, actualDrop, deviation: deviation * 100,
      status: eventStatus, durationMinutes: ev.duration_minutes,
      machinesRunning: ev.machines_running, machinesCurtailed: ev.machines_curtailed,
    };
  });

  const totalEval = confirmed + partial + failed;
  const overallStatus = failed > 0 ? 'critical' : partial > 0 ? 'degraded' : 'healthy';

  return {
    status: overallStatus, totalEvents: events.length, confirmed, partial, failed,
    complianceRate: totalEval > 0 ? (confirmed / totalEval) * 100 : null,
    events: reconciled, totalFleetHashrate, timestamp: new Date().toISOString(),
  };
}

// ─── Worker Anomalies ───────────────────────────────────────────────────────

/**
 * Detect worker health issues: underperforming, dead, high_reject,
 * unexpected_offline, unexpected_online.
 */
export async function getWorkerAnomalies() {
  const config = getFleetConfig();
  const pools = await getConfiguredPools();
  if (!pools || pools.length === 0) return getMockWorkerAnomalies();

  let workers = [];
  try { workers = await getPoolWorkers() || []; }
  catch (err) { return { status: 'error', message: `Failed to fetch workers: ${err.message}`, anomalies: [], timestamp: new Date().toISOString() }; }

  // Expected hashrate by model
  const modelExpected = {};
  if (config?.entries)
    for (const e of config.entries) { const s = e.overclockProfile || e.asicModel; modelExpected[(e.asicModel.model || e.asicModel.id).toLowerCase()] = s.hashrate; }

  // Active curtailment state
  const recent = getCurtailmentEvents(1);
  const active = recent.find(e => !e.end_time || new Date(e.end_time) > new Date());
  const curtailedClasses = active ? parseMachineClasses(active.machine_classes) : [];

  const anomalies = [];
  const now = Date.now();

  for (const w of workers) {
    const name = w.name || w.worker || 'unknown';
    const hr = w.hashrate || w.hashrate1h || 0;
    const lastShare = w.lastShareTime ? new Date(w.lastShareTime).getTime() : null;
    const reject = typeof (w.rejectRate ?? w.rejected) === 'number' ? (w.rejectRate ?? w.rejected) : 0;
    const model = w.model || '';
    const online = w.status === 'online' || w.status === 'active' || hr > 0;
    const modelKey = model.toLowerCase();

    // Match to fleet model
    let expected = null;
    for (const [k, v] of Object.entries(modelExpected))
      if (modelKey.includes(k) || k.includes(modelKey)) { expected = v; break; }

    // Dead: no shares > 24h
    if (lastShare && (now - lastShare) > WORKER_DEAD_HOURS * 3.6e6) {
      anomalies.push({ type: 'dead', severity: 'critical', worker: name, model, detail: `No shares in ${((now - lastShare) / 3.6e6).toFixed(1)} hours.`, lastShareTime: w.lastShareTime, hashrate: hr });
      continue;
    }
    // Underperforming
    if (expected && online && hr < expected * WORKER_UNDERPERFORM_PCT)
      anomalies.push({ type: 'underperforming', severity: 'warning', worker: name, model, detail: `Hashrate ${hr.toFixed(1)} TH/s is ${((hr / expected) * 100).toFixed(1)}% of expected ${expected} TH/s.`, expected, actual: hr });
    // High reject
    if (reject > WORKER_HIGH_REJECT_PCT)
      anomalies.push({ type: 'high_reject', severity: 'warning', worker: name, model, detail: `Reject rate ${(reject * 100).toFixed(2)}% exceeds ${WORKER_HIGH_REJECT_PCT * 100}% threshold.`, rejectRate: reject });
    // Unexpected online (should be curtailed)
    const isCurtailed = curtailedClasses.some(c => modelKey.includes((c || '').toLowerCase()) || (c || '').toLowerCase().includes(modelKey));
    if (isCurtailed && online)
      anomalies.push({ type: 'unexpected_online', severity: 'warning', worker: name, model, detail: 'Worker online but model class is curtailed. Verify shutdown command.', curtailmentEvent: active?.id });
    // Unexpected offline (should be mining)
    if (!isCurtailed && active && !online && hr === 0 && lastShare) {
      const hSince = (now - lastShare) / 3.6e6;
      if (hSince > 1 && hSince < 48)
        anomalies.push({ type: 'unexpected_offline', severity: 'warning', worker: name, model, detail: `Offline but should be mining. Last share ${hSince.toFixed(1)}h ago.`, lastShareTime: w.lastShareTime });
    }
  }

  const counts = { dead: 0, underperforming: 0, high_reject: 0, unexpected_online: 0, unexpected_offline: 0 };
  for (const a of anomalies) counts[a.type]++;
  const hasCrit = anomalies.some(a => a.severity === 'critical');
  const hasWarn = anomalies.some(a => a.severity === 'warning');

  return {
    status: hasCrit ? 'critical' : hasWarn ? 'degraded' : 'healthy',
    totalWorkers: workers.length, totalAnomalies: anomalies.length, counts, anomalies,
    activeCurtailment: active ? { id: active.id, startTime: active.start_time, curtailedClasses } : null,
    timestamp: new Date().toISOString(),
  };
}

// ─── Diagnostics Summary ────────────────────────────────────────────────────

/** Aggregate all diagnostics into a single health summary. */
export async function getDiagnosticsSummary() {
  const [hrR, crR, waR] = await Promise.allSettled([
    getHashrateReconciliation(), getCurtailmentReconciliation(7), getWorkerAnomalies(),
  ]);
  const hr = hrR.status === 'fulfilled' ? hrR.value : { status: 'error', message: hrR.reason?.message };
  const cr = crR.status === 'fulfilled' ? crR.value : { status: 'error', message: crR.reason?.message };
  const wa = waR.status === 'fulfilled' ? waR.value : { status: 'error', message: waR.reason?.message };

  const statuses = [hr.status, cr.status, wa.status];
  const overallStatus = statuses.includes('critical') || statuses.includes('error')
    ? 'critical' : statuses.includes('degraded') ? 'degraded' : 'healthy';
  const totalIssues = (hr.possibleCauses?.length || 0) + (cr.failed || 0) + (cr.partial || 0) + (wa.totalAnomalies || 0);

  return {
    overallStatus, totalIssues,
    subsystems: {
      hashrateReconciliation: { status: hr.status, expectedHashrate: hr.expectedHashrate, reportedHashrate: hr.reportedHashrate, deltaPercent: hr.deltaPercent, issueCount: hr.possibleCauses?.length || 0 },
      curtailmentReconciliation: { status: cr.status, totalEvents: cr.totalEvents || 0, complianceRate: cr.complianceRate, confirmed: cr.confirmed || 0, partial: cr.partial || 0, failed: cr.failed || 0 },
      workerHealth: { status: wa.status, totalWorkers: wa.totalWorkers || 0, totalAnomalies: wa.totalAnomalies || 0, counts: wa.counts || {} },
    },
    details: { hashrateReconciliation: hr, curtailmentReconciliation: cr, workerAnomalies: wa },
    timestamp: new Date().toISOString(),
  };
}

// ─── Mock Data (no pools configured) ────────────────────────────────────────

function getMockHashrateReconciliation(config) {
  const { total, breakdown } = getFleetExpected(config);
  const expected = total || 5000;
  const variance = -0.023;
  const reported = Math.round(expected * (1 + variance) * 100) / 100;
  return {
    status: 'healthy', expectedHashrate: expected, reportedHashrate: reported,
    delta: Math.round((reported - expected) * 100) / 100, deltaPercent: Math.abs(variance) * 100,
    machineBreakdown: breakdown, poolBreakdown: [{ pool: 'Mock Pool (no pools configured)', hashrate: reported, workers: 0 }],
    possibleCauses: [], isMock: true, timestamp: new Date().toISOString(),
  };
}

function getMockCurtailmentReconciliation(days) {
  return {
    status: 'no_events', message: `No pools configured. No curtailment events in the last ${days} days.`,
    totalEvents: 0, confirmed: 0, partial: 0, failed: 0, complianceRate: null,
    events: [], isMock: true, timestamp: new Date().toISOString(),
  };
}

function getMockWorkerAnomalies() {
  return {
    status: 'degraded', totalWorkers: 48, totalAnomalies: 2,
    counts: { dead: 0, underperforming: 1, high_reject: 1, unexpected_online: 0, unexpected_offline: 0 },
    anomalies: [
      { type: 'underperforming', severity: 'warning', worker: 'miner-rack01-s21-001', model: 'Antminer S21', detail: 'Hashrate 155.2 TH/s is 77.6% of expected 200 TH/s.', expected: 200, actual: 155.2 },
      { type: 'high_reject', severity: 'warning', worker: 'miner-rack03-s19xp-012', model: 'Antminer S19 XP', detail: 'Reject rate 3.10% exceeds 2% threshold.', rejectRate: 0.031 },
    ],
    activeCurtailment: null, isMock: true, timestamp: new Date().toISOString(),
  };
}

export default { getHashrateReconciliation, getCurtailmentReconciliation, getWorkerAnomalies, getDiagnosticsSummary };
