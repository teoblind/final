/**
 * FRED API Service
 *
 * Fetches economic data from the Federal Reserve Economic Data API.
 * Base URL: https://api.stlouisfed.org/fred/series/observations
 *
 * Rate limit: 120 requests/minute (generous)
 */

import axios from 'axios';
import NodeCache from 'node-cache';

// Cache: 15 min for daily series, 60 min for weekly/monthly
const cache = new NodeCache({ stdTTL: 900, checkperiod: 120 });

const FRED_BASE_URL = 'https://api.stlouisfed.org/fred/series/observations';

/**
 * FRED Series ID to Dashboard Input mapping with metadata
 */
export const FRED_SERIES = {
  // Treasury Yields (Daily)
  DGS10: { field: 'us10y', unit: 'percent', frequency: 'daily', ttl: 900 },
  DGS2: { field: 'us2y', unit: 'percent', frequency: 'daily', ttl: 900 },
  DGS30: { field: 'us30y', unit: 'percent', frequency: 'daily', ttl: 900 },

  // Fed Balance Sheet (Weekly - Wednesday)
  WALCL: { field: 'fedBS', unit: 'millions_to_trillions', frequency: 'weekly', ttl: 3600, divisor: 1_000_000 },

  // Treasury General Account (Weekly - Wednesday)
  WTREGEN: { field: 'tga', unit: 'millions_to_billions', frequency: 'weekly', ttl: 3600, divisor: 1_000 },

  // Overnight Reverse Repo (Daily)
  RRPONTSYD: { field: 'rrp', unit: 'millions_to_billions', frequency: 'daily', ttl: 900, divisor: 1_000 },

  // VIX (Daily)
  VIXCLS: { field: 'vix', unit: 'index', frequency: 'daily', ttl: 900 },

  // Unemployment Rate (Monthly - First Friday)
  UNRATE: { field: 'unemployment', unit: 'percent', frequency: 'monthly', ttl: 3600 },

  // Initial Jobless Claims (Weekly - Thursday)
  ICSA: { field: 'initialClaims', unit: 'raw_to_thousands', frequency: 'weekly', ttl: 3600, divisor: 1_000 },

  // High Yield OAS (Daily) - comes as percentage points, need to multiply by 100 for bps
  BAMLH0A0HYM2: { field: 'hyOAS', unit: 'percent_to_bps', frequency: 'daily', ttl: 900, multiplier: 100 },

  // Fed Funds Rate (After FOMC meetings)
  DFEDTARU: { field: '_fedFundsUpper', unit: 'percent', frequency: 'irregular', ttl: 3600 },
  DFEDTARL: { field: '_fedFundsLower', unit: 'percent', frequency: 'irregular', ttl: 3600 },

  // CPI (Monthly) - need YoY calculation
  CPIAUCSL: { field: '_cpiRaw', unit: 'index', frequency: 'monthly', ttl: 3600, limit: 13 },
  CPILFESL: { field: '_coreCpiRaw', unit: 'index', frequency: 'monthly', ttl: 3600, limit: 13 },

  // Nonfarm Payrolls (Monthly - First Friday) - need MoM change
  PAYEMS: { field: '_payrollsRaw', unit: 'thousands', frequency: 'monthly', ttl: 3600, limit: 2 }
};

/**
 * Fetch a single FRED series
 *
 * @param {string} seriesId - FRED series ID (e.g., 'DGS10')
 * @param {number} limit - Number of observations to fetch (default 1)
 * @returns {Promise<{observations: Array, date: string, value: number|null}>}
 */
export async function fetchFredSeries(seriesId, limit = 1) {
  const apiKey = process.env.FRED_API_KEY;

  if (!apiKey || apiKey === 'demo') {
    console.log(`[FRED] No API key configured, skipping ${seriesId}`);
    return { observations: [], date: null, value: null, error: 'No API key' };
  }

  // Check cache
  const cacheKey = `fred:${seriesId}:${limit}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const url = `${FRED_BASE_URL}?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=${limit}`;
    const response = await axios.get(url, { timeout: 10000 });

    const observations = response.data.observations || [];

    // Filter out observations where value is "." (FRED's missing data indicator)
    const validObservations = observations.filter(obs => obs.value !== '.');

    if (validObservations.length === 0) {
      console.log(`[FRED] No valid data for ${seriesId}`);
      return { observations: [], date: null, value: null };
    }

    const result = {
      observations: validObservations,
      date: validObservations[0].date,
      value: parseFloat(validObservations[0].value),
      seriesId,
      fetchedAt: new Date().toISOString()
    };

    // Cache with appropriate TTL
    const seriesConfig = FRED_SERIES[seriesId];
    const ttl = seriesConfig?.ttl || 900;
    cache.set(cacheKey, result, ttl);

    console.log(`[FRED] Fetched ${seriesId}: ${result.value} (${result.date})`);
    return result;

  } catch (error) {
    console.error(`[FRED] Error fetching ${seriesId}:`, error.message);
    return { observations: [], date: null, value: null, error: error.message };
  }
}

/**
 * Compute YoY percentage change from 13 monthly observations
 * Formula: ((latest - 12moAgo) / 12moAgo) * 100
 *
 * @param {Array} observations - Array of observations (newest first)
 * @returns {number|null}
 */
function computeYoYChange(observations) {
  if (!observations || observations.length < 13) return null;

  const latest = parseFloat(observations[0].value);
  const yearAgo = parseFloat(observations[12].value);

  if (isNaN(latest) || isNaN(yearAgo) || yearAgo === 0) return null;

  return ((latest - yearAgo) / yearAgo) * 100;
}

/**
 * Compute MoM change for NFP (difference in thousands)
 * Formula: latest - previous
 *
 * @param {Array} observations - Array of observations (newest first)
 * @returns {number|null}
 */
function computeMoMChange(observations) {
  if (!observations || observations.length < 2) return null;

  const latest = parseFloat(observations[0].value);
  const previous = parseFloat(observations[1].value);

  if (isNaN(latest) || isNaN(previous)) return null;

  return latest - previous;
}

/**
 * Fetch all FRED data in parallel and return partial LiquidityInputs
 *
 * @returns {Promise<{inputs: Object, sources: Object}>}
 */
export async function fetchAllFredData() {
  const apiKey = process.env.FRED_API_KEY;

  if (!apiKey || apiKey === 'demo') {
    console.log('[FRED] No API key configured, returning empty data');
    return { inputs: {}, sources: {}, status: 'no_api_key' };
  }

  const results = {};
  const sources = {};
  const errors = [];

  // Fetch all series in parallel
  const seriesIds = Object.keys(FRED_SERIES);
  const fetchPromises = seriesIds.map(async (seriesId) => {
    const config = FRED_SERIES[seriesId];
    const limit = config.limit || 1;

    try {
      const data = await fetchFredSeries(seriesId, limit);
      return { seriesId, config, data };
    } catch (error) {
      errors.push({ seriesId, error: error.message });
      return { seriesId, config, data: { value: null, error: error.message } };
    }
  });

  const fetchResults = await Promise.all(fetchPromises);

  // Process results
  for (const { seriesId, config, data } of fetchResults) {
    if (data.error) {
      errors.push({ seriesId, error: data.error });
      continue;
    }

    // Skip internal fields that need further processing
    if (config.field.startsWith('_')) continue;

    let value = data.value;

    // Apply unit conversions
    if (config.divisor && value !== null) {
      value = value / config.divisor;
    }
    if (config.multiplier && value !== null) {
      value = value * config.multiplier;
    }

    results[config.field] = value;
    sources[config.field] = {
      source: 'fred',
      seriesId,
      date: data.date,
      fetchedAt: data.fetchedAt,
      frequency: config.frequency
    };
  }

  // Process computed fields

  // Fed Funds Rate range (combine upper and lower)
  const upperResult = fetchResults.find(r => r.seriesId === 'DFEDTARU');
  const lowerResult = fetchResults.find(r => r.seriesId === 'DFEDTARL');
  if (upperResult?.data?.value !== null && lowerResult?.data?.value !== null) {
    const lower = lowerResult.data.value;
    const upper = upperResult.data.value;
    results.fedFundsRate = `${lower.toFixed(2)}-${upper.toFixed(2)}`;
    sources.fedFundsRate = {
      source: 'fred',
      seriesId: 'DFEDTARU+DFEDTARL',
      date: upperResult.data.date,
      fetchedAt: new Date().toISOString(),
      frequency: 'irregular'
    };
  }

  // CPI YoY calculation
  const cpiResult = fetchResults.find(r => r.seriesId === 'CPIAUCSL');
  if (cpiResult?.data?.observations?.length >= 13) {
    const yoyChange = computeYoYChange(cpiResult.data.observations);
    if (yoyChange !== null) {
      results.cpiYoy = Math.round(yoyChange * 100) / 100;
      sources.cpiYoy = {
        source: 'fred',
        seriesId: 'CPIAUCSL',
        date: cpiResult.data.date,
        fetchedAt: new Date().toISOString(),
        frequency: 'monthly',
        computed: 'yoy_change'
      };
    }
  }

  // Core CPI YoY calculation
  const coreCpiResult = fetchResults.find(r => r.seriesId === 'CPILFESL');
  if (coreCpiResult?.data?.observations?.length >= 13) {
    const yoyChange = computeYoYChange(coreCpiResult.data.observations);
    if (yoyChange !== null) {
      results.coreYoy = Math.round(yoyChange * 100) / 100;
      sources.coreYoy = {
        source: 'fred',
        seriesId: 'CPILFESL',
        date: coreCpiResult.data.date,
        fetchedAt: new Date().toISOString(),
        frequency: 'monthly',
        computed: 'yoy_change'
      };
    }
  }

  // NFP MoM change
  const nfpResult = fetchResults.find(r => r.seriesId === 'PAYEMS');
  if (nfpResult?.data?.observations?.length >= 2) {
    const momChange = computeMoMChange(nfpResult.data.observations);
    if (momChange !== null) {
      results.nfp = Math.round(momChange);
      sources.nfp = {
        source: 'fred',
        seriesId: 'PAYEMS',
        date: nfpResult.data.date,
        fetchedAt: new Date().toISOString(),
        frequency: 'monthly',
        computed: 'mom_change'
      };
    }
  }

  // Log summary
  const successCount = Object.keys(results).length;
  const failCount = errors.length;
  console.log(`[FRED] Fetched ${successCount} fields successfully, ${failCount} errors`);
  if (errors.length > 0) {
    console.log('[FRED] Errors:', errors.map(e => `${e.seriesId}: ${e.error}`).join(', '));
  }

  return {
    inputs: results,
    sources,
    status: 'ok',
    successCount,
    errorCount: failCount,
    errors: errors.length > 0 ? errors : undefined
  };
}

/**
 * Check if a data point is stale based on expected update frequency
 *
 * @param {string} fetchedAt - ISO timestamp of when data was fetched
 * @param {string} frequency - Expected update frequency: 'daily', 'weekly', 'monthly'
 * @returns {'fresh'|'stale'|'very_stale'}
 */
export function getDataFreshness(fetchedAt, frequency) {
  if (!fetchedAt) return 'very_stale';

  const now = new Date();
  const fetched = new Date(fetchedAt);
  const ageMs = now - fetched;
  const ageHours = ageMs / (1000 * 60 * 60);

  const thresholds = {
    daily: { fresh: 24, stale: 48 },
    weekly: { fresh: 168, stale: 336 }, // 7 days, 14 days
    monthly: { fresh: 720, stale: 1440 }, // 30 days, 60 days
    irregular: { fresh: 168, stale: 336 }
  };

  const threshold = thresholds[frequency] || thresholds.daily;

  if (ageHours <= threshold.fresh) return 'fresh';
  if (ageHours <= threshold.stale) return 'stale';
  return 'very_stale';
}

/**
 * Clear FRED cache (useful for forcing a refresh)
 */
export function clearFredCache() {
  cache.flushAll();
  console.log('[FRED] Cache cleared');
}

export default {
  fetchFredSeries,
  fetchAllFredData,
  getDataFreshness,
  clearFredCache,
  FRED_SERIES
};
