/**
 * SanghaModel Client — Phase 9
 *
 * HTTP client for the SanghaModel FastAPI service (Python simulator).
 * The simulator runs on port 8100 and provides:
 *   - Monte Carlo risk assessments for hashprice insurance
 *   - Network state estimates and scenario analysis
 *   - Calibration data ingestion from fleet telemetry
 *
 * All methods handle errors gracefully and include retry logic with
 * exponential backoff for transient failures (5xx, network errors).
 */

import axios from 'axios';

const SANGHA_MODEL_URL = process.env.SANGHAMODEL_API_URL || 'http://localhost:8100';
const SANGHA_MODEL_KEY = process.env.SANGHAMODEL_API_KEY || 'sm_dev_key_12345';

const client = axios.create({
  baseURL: SANGHA_MODEL_URL,
  timeout: 5000,
  headers: { 'X-API-Key': SANGHA_MODEL_KEY }
});

// ─── Retry Logic ─────────────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

/**
 * Determine whether an error is transient and worth retrying.
 */
function isTransientError(error) {
  if (!error.response) return true; // network error, timeout
  const status = error.response.status;
  return status >= 500 || status === 429;
}

/**
 * Execute an async function with exponential backoff retry.
 * @param {Function} fn - Async function to execute
 * @param {number} maxRetries - Maximum number of retries
 * @returns {Promise<*>}
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

// ─── Health & Availability ───────────────────────────────────────────────────

/**
 * Check SanghaModel health.
 * @returns {Promise<object|null>} Health response or null if unavailable
 */
export async function checkHealth() {
  try {
    const res = await client.get('/v1/health');
    return res.data;
  } catch (error) {
    console.warn('[SanghaModel] Health check failed:', error.message);
    return null;
  }
}

/**
 * Check whether the SanghaModel service is reachable.
 * @returns {Promise<boolean>}
 */
export async function isAvailable() {
  const health = await checkHealth();
  return health !== null;
}

// ─── Risk Assessments ────────────────────────────────────────────────────────

/**
 * Request a full Monte Carlo risk assessment (async job).
 * This is a long-running operation; the service returns a job ID immediately.
 *
 * @param {object} minerProfile - Miner fleet profile (hashrate, efficiency, energy, etc.)
 * @param {object} params - Additional simulation parameters (scenarios, horizon, etc.)
 * @returns {Promise<{jobId: string, status: string}>}
 */
export async function requestFullAssessment(minerProfile, params = {}) {
  try {
    const res = await withRetry(() =>
      client.post('/v1/risk-assessment', {
        miner_profile: minerProfile,
        ...params,
      }, { timeout: 120_000 })
    );
    return {
      jobId: res.data.job_id || res.data.jobId,
      status: res.data.status || 'accepted',
      ...res.data,
    };
  } catch (error) {
    const msg = error.response?.data?.detail || error.message;
    throw new Error(`[SanghaModel] Full assessment request failed: ${msg}`);
  }
}

/**
 * Request a quick (synchronous) risk assessment.
 * Returns the assessment inline without a background job.
 *
 * @param {object} minerProfile - Miner fleet profile
 * @returns {Promise<object>} RiskAssessment object
 */
export async function requestQuickAssessment(minerProfile) {
  try {
    const res = await withRetry(() =>
      client.post('/v1/risk-assessment/quick', {
        miner_profile: minerProfile,
      }, { timeout: 10_000 })
    );
    return res.data;
  } catch (error) {
    const msg = error.response?.data?.detail || error.message;
    throw new Error(`[SanghaModel] Quick assessment failed: ${msg}`);
  }
}

/**
 * Poll the status of a full assessment job.
 *
 * @param {string} jobId - Job ID returned from requestFullAssessment
 * @returns {Promise<object>} Assessment result or status object
 */
export async function getJobStatus(jobId) {
  try {
    const res = await withRetry(() =>
      client.get(`/v1/risk-assessment/${jobId}`)
    );
    return res.data;
  } catch (error) {
    if (error.response?.status === 404) {
      return { status: 'not_found', jobId };
    }
    const msg = error.response?.data?.detail || error.message;
    throw new Error(`[SanghaModel] Job status check failed: ${msg}`);
  }
}

// ─── Calibration ─────────────────────────────────────────────────────────────

/**
 * Send anonymized calibration telemetry to the simulator.
 *
 * @param {object} payload - Aggregated fleet telemetry (no tenant identifiers)
 * @returns {Promise<object|null>} Response data or null on failure
 */
export async function sendCalibrationData(payload) {
  try {
    const res = await withRetry(() =>
      client.post('/v1/calibration/ingest', payload, { timeout: 15_000 })
    );
    return res.data;
  } catch (error) {
    console.error('[SanghaModel] Calibration data send failed:', error.message);
    return null;
  }
}

// ─── Network & Scenario ──────────────────────────────────────────────────────

/**
 * Get the simulator's view of the current Bitcoin network state.
 *
 * @returns {Promise<object|null>} Network state or null if unavailable
 */
export async function getNetworkState() {
  try {
    const res = await withRetry(() =>
      client.get('/v1/network/current-state')
    );
    return res.data;
  } catch (error) {
    console.warn('[SanghaModel] Network state fetch failed:', error.message);
    return null;
  }
}

/**
 * Run a what-if scenario through the simulator.
 *
 * @param {object} scenario - Scenario definition (hashrate change, price shock, etc.)
 * @returns {Promise<object>} Scenario results
 */
export async function runScenario(scenario) {
  try {
    const res = await withRetry(() =>
      client.post('/v1/scenario', scenario, { timeout: 30_000 })
    );
    return res.data;
  } catch (error) {
    const msg = error.response?.data?.detail || error.message;
    throw new Error(`[SanghaModel] Scenario analysis failed: ${msg}`);
  }
}

// ─── Indicative Premium ──────────────────────────────────────────────────────

/**
 * Calculate an indicative premium by running a quick assessment with a minimal
 * miner profile and extracting premium information from the result.
 *
 * @param {number} floor - Floor hashprice ($/TH/day)
 * @param {number} hashrate - Covered hashrate (TH/s)
 * @param {number} riskScore - Pre-computed risk score (0-100)
 * @param {number} termMonths - Policy term in months
 * @returns {Promise<object|null>} Premium info or null if unavailable
 */
export async function calculateIndicativePremium(floor, hashrate, riskScore, termMonths) {
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
      }, { timeout: 10_000 })
    );

    const data = res.data;
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
    console.warn('[SanghaModel] Indicative premium calculation failed:', error.message);
    return null;
  }
}

export default {
  checkHealth,
  isAvailable,
  requestFullAssessment,
  requestQuickAssessment,
  getJobStatus,
  sendCalibrationData,
  getNetworkState,
  runScenario,
  calculateIndicativePremium,
};
