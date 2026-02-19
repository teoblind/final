/**
 * SanghaModel Client — Phase 9
 *
 * HTTP client for the SanghaModel FastAPI service (Python simulator).
 * The simulator runs on port 8100 and provides:
 *   - Monte Carlo risk assessments for hashprice insurance
 *   - Network state estimates and scenario analysis
 *   - Calibration data ingestion from fleet telemetry
 *
 * Authentication: Bearer token via SANGHAMODEL_API_KEY env var.
 * Caching: Quick assessments are cached per tenant for 5 minutes.
 * Logging: All calls are logged with tenant_id, endpoint, and response time.
 */

import axios from 'axios';

const SANGHA_MODEL_URL = process.env.SANGHAMODEL_BASE_URL || process.env.SANGHAMODEL_API_URL || 'http://localhost:8100';
const SANGHA_MODEL_KEY = process.env.SANGHAMODEL_API_KEY || 'sm_dev_key_12345';

// Per-endpoint timeouts (ms)
const TIMEOUT_QUICK = 5_000;
const TIMEOUT_FULL = 90_000;
const TIMEOUT_DEFAULT = 10_000;
const TIMEOUT_CALIBRATION = 15_000;
const TIMEOUT_SCENARIO = 30_000;

const client = axios.create({
  baseURL: SANGHA_MODEL_URL,
  timeout: TIMEOUT_DEFAULT,
  headers: {
    'Authorization': `Bearer ${SANGHA_MODEL_KEY}`,
    'Content-Type': 'application/json',
  },
});

// ─── Retry Logic ─────────────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000; // 1s, 2s, 4s

/**
 * Determine whether an error is transient and worth retrying.
 */
function isTransientError(error) {
  if (!error.response) return true; // network error, timeout
  const status = error.response.status;
  return status >= 500 || status === 429;
}

/**
 * Format error message — user-friendly for 503.
 */
function formatError(error, endpoint) {
  if (error.response?.status === 503) {
    return 'Risk model temporarily unavailable, try again shortly';
  }
  return error.response?.data?.detail || error.message || `${endpoint} request failed`;
}

/**
 * Execute an async function with exponential backoff retry.
 * Delays: 1s, 2s, 4s (BASE_DELAY_MS * 2^attempt)
 */
async function withRetry(fn, maxRetries = MAX_RETRIES) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries && isTransientError(error)) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 200;
        console.warn(`[SanghaModel] Transient error on attempt ${attempt + 1}/${maxRetries + 1}, retrying in ${Math.round(delay)}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        break;
      }
    }
  }
  throw lastError;
}

// ─── Quick Assessment Cache (5-min TTL per tenant) ──────────────────────────

const quickCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCachedQuick(tenantId) {
  const key = tenantId || '__default';
  const entry = quickCache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
    return entry.data;
  }
  if (entry) quickCache.delete(key);
  return null;
}

function setCachedQuick(tenantId, data) {
  const key = tenantId || '__default';
  quickCache.set(key, { data, timestamp: Date.now() });
}

// Periodic cache cleanup (every 10 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of quickCache) {
    if (now - entry.timestamp > CACHE_TTL_MS) {
      quickCache.delete(key);
    }
  }
}, 10 * 60 * 1000).unref();

// ─── Audit Logging ──────────────────────────────────────────────────────────

/**
 * Log a SanghaModel API call for audit trail.
 */
function logApiCall(endpoint, tenantId, durationMs, status, error = null) {
  const entry = {
    service: 'sangha_model',
    endpoint,
    tenantId: tenantId || 'system',
    durationMs: Math.round(durationMs),
    status: status || (error ? 'error' : 'ok'),
    timestamp: new Date().toISOString(),
  };
  if (error) {
    entry.error = typeof error === 'string' ? error : error.message;
  }
  console.log(`[SanghaModel] ${endpoint} tenant=${entry.tenantId} ${entry.durationMs}ms status=${entry.status}${error ? ` err=${entry.error}` : ''}`);
}

// ─── Health & Availability ───────────────────────────────────────────────────

let _lastHealthCheck = null;
let _isHealthy = false;

/**
 * Check SanghaModel health. No auth required per spec.
 * @returns {Promise<object|null>} Health response or null if unavailable
 */
export async function checkHealth() {
  const start = Date.now();
  try {
    const res = await axios.get(`${SANGHA_MODEL_URL}/v1/health`, { timeout: 5000 });
    _isHealthy = res.data?.status === 'healthy' || res.data?.status === 'degraded';
    _lastHealthCheck = { ...res.data, checkedAt: new Date().toISOString() };
    logApiCall('/v1/health', 'system', Date.now() - start, res.data?.status);
    return res.data;
  } catch (error) {
    _isHealthy = false;
    _lastHealthCheck = { status: 'unreachable', checkedAt: new Date().toISOString() };
    logApiCall('/v1/health', 'system', Date.now() - start, 'unreachable', error);
    return null;
  }
}

/**
 * Check whether the SanghaModel service is reachable.
 * @returns {Promise<boolean>}
 */
export async function isAvailable() {
  const health = await checkHealth();
  return health !== null && (health.status === 'healthy' || health.status === 'degraded');
}

/**
 * Get the last known health status without making a new request.
 * @returns {{ isHealthy: boolean, lastCheck: object|null }}
 */
export function getHealthStatus() {
  return { isHealthy: _isHealthy, lastCheck: _lastHealthCheck };
}

// ─── Risk Assessments ────────────────────────────────────────────────────────

/**
 * Request a quick (synchronous) risk assessment (< 2 seconds).
 * Results are cached per tenant_id for 5 minutes.
 *
 * Use for: Coverage Explorer real-time slider, initial tenant risk view
 *
 * @param {object} minerProfile - Miner fleet profile (MinerProfile schema)
 * @returns {Promise<object>} RiskAssessment object
 */
export async function requestQuickAssessment(minerProfile) {
  const tenantId = minerProfile.tenant_id || minerProfile.tenantId;

  // Check cache first
  const cached = getCachedQuick(tenantId);
  if (cached) {
    logApiCall('/v1/risk-assessment/quick', tenantId, 0, 'cache_hit');
    return cached;
  }

  const start = Date.now();
  try {
    const res = await withRetry(() =>
      client.post('/v1/risk-assessment/quick', minerProfile, { timeout: TIMEOUT_QUICK })
    );
    setCachedQuick(tenantId, res.data);
    logApiCall('/v1/risk-assessment/quick', tenantId, Date.now() - start, 'ok');
    return res.data;
  } catch (error) {
    logApiCall('/v1/risk-assessment/quick', tenantId, Date.now() - start, 'error', error);
    const msg = formatError(error, 'Quick assessment');
    throw new Error(msg);
  }
}

/**
 * Request a full Monte Carlo risk assessment (10-60 seconds).
 * Tries the async endpoint first, falls back to synchronous.
 *
 * Use for: Formal underwriting, underwriting queue processing
 *
 * @param {object} minerProfile - Miner fleet profile (MinerProfile schema)
 * @param {object} params - Additional simulation parameters
 * @returns {Promise<object>} Full assessment result or job reference { jobId, status }
 */
export async function requestFullAssessment(minerProfile, params = {}) {
  const tenantId = minerProfile.tenant_id || minerProfile.tenantId;
  const start = Date.now();
  try {
    // Try async endpoint first
    const res = await withRetry(() =>
      client.post('/v1/risk-assessment/async', minerProfile, { timeout: TIMEOUT_DEFAULT })
    );
    logApiCall('/v1/risk-assessment/async', tenantId, Date.now() - start, 'ok');
    return {
      jobId: res.data.job_id || res.data.jobId,
      status: res.data.status || 'running',
      ...res.data,
    };
  } catch (asyncError) {
    // Fall back to synchronous full assessment
    try {
      const res = await withRetry(() =>
        client.post('/v1/risk-assessment', minerProfile, { timeout: TIMEOUT_FULL })
      );
      logApiCall('/v1/risk-assessment', tenantId, Date.now() - start, 'ok');
      return {
        status: 'completed',
        ...res.data,
      };
    } catch (error) {
      logApiCall('/v1/risk-assessment', tenantId, Date.now() - start, 'error', error);
      const msg = formatError(error, 'Full assessment');
      throw new Error(msg);
    }
  }
}

/**
 * Poll the status of a full assessment job.
 *
 * @param {string} jobId - Job ID returned from requestFullAssessment
 * @returns {Promise<object>} { status: 'completed'|'running'|'failed', result?: RiskAssessment }
 */
export async function getJobStatus(jobId) {
  const start = Date.now();
  try {
    const res = await withRetry(() =>
      client.get(`/v1/risk-assessment/jobs/${jobId}`, { timeout: TIMEOUT_DEFAULT })
    );
    logApiCall(`/v1/risk-assessment/jobs/${jobId}`, 'system', Date.now() - start, res.data?.status || 'ok');
    return res.data;
  } catch (error) {
    if (error.response?.status === 404) {
      return { status: 'not_found', jobId };
    }
    logApiCall(`/v1/risk-assessment/jobs/${jobId}`, 'system', Date.now() - start, 'error', error);
    const msg = formatError(error, 'Job status');
    throw new Error(msg);
  }
}

/**
 * Poll a job until completion or timeout.
 *
 * @param {string} jobId - Job ID to poll
 * @param {number} maxWaitMs - Maximum wait time (default 120s)
 * @param {number} intervalMs - Poll interval (default 3s)
 * @returns {Promise<object>} Completed assessment result
 */
export async function pollJobUntilDone(jobId, maxWaitMs = 120_000, intervalMs = 3_000) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const status = await getJobStatus(jobId);
    if (status.status === 'completed') return status.result || status;
    if (status.status === 'failed') throw new Error(status.error || 'Assessment job failed');
    if (status.status === 'not_found') throw new Error(`Job ${jobId} not found`);
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`Job ${jobId} timed out after ${maxWaitMs / 1000}s`);
}

// ─── Calibration ─────────────────────────────────────────────────────────────

/**
 * Send anonymized calibration telemetry to the simulator.
 *
 * Use for: Nightly/weekly batch job sending anonymized aggregate telemetry
 *
 * @param {object} payload - Aggregated fleet telemetry (no tenant identifiers)
 * @returns {Promise<object|null>} Response data or null on failure
 */
export async function sendCalibrationData(payload) {
  const start = Date.now();
  try {
    const res = await withRetry(() =>
      client.post('/v1/calibration/ingest', payload, { timeout: TIMEOUT_CALIBRATION })
    );
    logApiCall('/v1/calibration/ingest', 'system', Date.now() - start, res.data?.status || 'ok');
    return res.data;
  } catch (error) {
    logApiCall('/v1/calibration/ingest', 'system', Date.now() - start, 'error', error);
    console.error('[SanghaModel] Calibration data send failed:', error.message);
    return null;
  }
}

// ─── Network & Scenario ──────────────────────────────────────────────────────

/**
 * Get the simulator's view of the current Bitcoin network state.
 *
 * Use for: Dashboard context displays, baseline comparisons
 *
 * @returns {Promise<object|null>} Network state or null if unavailable
 */
export async function getNetworkState() {
  const start = Date.now();
  try {
    const res = await withRetry(() =>
      client.get('/v1/network/current-state', { timeout: TIMEOUT_DEFAULT })
    );
    logApiCall('/v1/network/current-state', 'system', Date.now() - start, 'ok');
    return res.data;
  } catch (error) {
    logApiCall('/v1/network/current-state', 'system', Date.now() - start, 'error', error);
    console.warn('[SanghaModel] Network state fetch failed:', error.message);
    return null;
  }
}

/**
 * Run a what-if scenario through the simulator.
 *
 * Use for: Sangha admin "Run Stress Test", LP dashboard, Coverage Explorer
 *
 * @param {object} scenario - Scenario definition per POST /v1/scenario spec:
 *   { btc_price_change_percent, difficulty_change_percent, energy_price_change_percent,
 *     halving_event, horizon_months, miner_profile }
 * @returns {Promise<object>} Scenario results
 */
export async function runScenario(scenario) {
  const tenantId = scenario.miner_profile?.tenant_id || 'system';
  const start = Date.now();
  try {
    const res = await withRetry(() =>
      client.post('/v1/scenario', scenario, { timeout: TIMEOUT_SCENARIO })
    );
    logApiCall('/v1/scenario', tenantId, Date.now() - start, 'ok');
    return res.data;
  } catch (error) {
    logApiCall('/v1/scenario', tenantId, Date.now() - start, 'error', error);
    const msg = formatError(error, 'Scenario analysis');
    throw new Error(msg);
  }
}

// ─── Indicative Premium ──────────────────────────────────────────────────────

/**
 * Calculate an indicative premium by running a quick assessment.
 *
 * @param {number} floor - Floor hashprice ($/TH/day)
 * @param {number} hashrate - Covered hashrate (TH/s)
 * @param {number} riskScore - Pre-computed risk score (0-100)
 * @param {number} termMonths - Policy term in months
 * @returns {Promise<object|null>} Premium info or null if unavailable
 */
export async function calculateIndicativePremium(floor, hashrate, riskScore, termMonths) {
  const start = Date.now();
  try {
    const minimalProfile = {
      total_hashrate_th: hashrate,
      floor_price: floor,
      risk_score: riskScore,
      term_months: termMonths,
      assessment_type: 'premium_indicative',
    };

    const res = await withRetry(() =>
      client.post('/v1/risk-assessment/quick', {
        miner_profile: minimalProfile,
      }, { timeout: TIMEOUT_QUICK })
    );

    const data = res.data;
    logApiCall('/v1/risk-assessment/quick (premium)', 'system', Date.now() - start, 'ok');
    return {
      monthlyPremiumPerTH: data.monthly_premium_per_th ?? data.premium?.monthly_per_th ?? null,
      totalMonthlyPremium: data.total_monthly_premium ?? data.premium?.total_monthly ?? null,
      annualizedRate: data.annualized_rate ?? data.premium?.annualized_rate ?? null,
      riskScore: data.risk_score ?? riskScore,
      floor,
      hashrate,
      termMonths,
      modelVersion: data.model_version || null,
    };
  } catch (error) {
    logApiCall('/v1/risk-assessment/quick (premium)', 'system', Date.now() - start, 'error', error);
    console.warn('[SanghaModel] Indicative premium calculation failed:', error.message);
    return null;
  }
}

// ─── Startup Health Check ────────────────────────────────────────────────────

/**
 * Verify the SanghaModel simulator is reachable on startup.
 * Logs a warning but does not block startup if unreachable.
 *
 * @returns {Promise<boolean>} true if reachable
 */
export async function verifyOnStartup() {
  console.log(`[SanghaModel] Checking simulator at ${SANGHA_MODEL_URL}...`);
  const health = await checkHealth();
  if (health) {
    console.log(`[SanghaModel] Simulator is ${health.status} (version: ${health.model_version || 'unknown'})`);
    return true;
  } else {
    console.warn(`[SanghaModel] Simulator unreachable at ${SANGHA_MODEL_URL} — insurance features will use mock data until it comes online.`);
    return false;
  }
}

export default {
  checkHealth,
  isAvailable,
  getHealthStatus,
  requestQuickAssessment,
  requestFullAssessment,
  getJobStatus,
  pollJobUntilDone,
  sendCalibrationData,
  getNetworkState,
  runScenario,
  calculateIndicativePremium,
  verifyOnStartup,
};
