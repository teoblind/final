/**
 * Hashrate Distribution Service
 * Provides data on global Bitcoin hashrate distribution and government holdings
 * Data from: https://github.com/teoblind/real-bitcoin
 *
 * Fetches latest data from GitHub on refresh, falls back to local cache
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// GitHub raw URLs for data files
const GITHUB_BASE = 'https://raw.githubusercontent.com/teoblind/real-bitcoin/main/data';
const GITHUB_URLS = {
  hashrate: `${GITHUB_BASE}/hashrate_distribution.json`,
  holdings: `${GITHUB_BASE}/government_holdings.json`
};

// Local cache paths
const LOCAL_CACHE = {
  hashrate: join(__dirname, '../data/hashrate_distribution.json'),
  holdings: join(__dirname, '../data/government_holdings.json')
};

// In-memory cache
let hashrateData = null;
let holdingsData = null;
let lastFetchTime = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch data from GitHub and update local cache
 */
async function fetchFromGitHub() {
  console.log('[HashrateService] Fetching latest data from GitHub...');

  try {
    const [hashrateRes, holdingsRes] = await Promise.all([
      axios.get(GITHUB_URLS.hashrate, { timeout: 10000 }),
      axios.get(GITHUB_URLS.holdings, { timeout: 10000 })
    ]);

    hashrateData = hashrateRes.data;
    holdingsData = holdingsRes.data;
    lastFetchTime = Date.now();

    // Update local cache files
    try {
      writeFileSync(LOCAL_CACHE.hashrate, JSON.stringify(hashrateData, null, 2));
      writeFileSync(LOCAL_CACHE.holdings, JSON.stringify(holdingsData, null, 2));
      console.log('[HashrateService] Updated local cache files');
    } catch (e) {
      console.warn('[HashrateService] Could not update local cache:', e.message);
    }

    console.log('[HashrateService] Successfully fetched from GitHub');
    return true;
  } catch (error) {
    console.error('[HashrateService] GitHub fetch failed:', error.message);
    return false;
  }
}

/**
 * Load data from local cache files
 */
function loadFromLocalCache() {
  if (!hashrateData) {
    try {
      if (existsSync(LOCAL_CACHE.hashrate)) {
        hashrateData = JSON.parse(readFileSync(LOCAL_CACHE.hashrate, 'utf-8'));
      }
    } catch (e) {
      console.error('[HashrateService] Failed to load hashrate cache:', e.message);
      hashrateData = { error: 'Data not available' };
    }
  }

  if (!holdingsData) {
    try {
      if (existsSync(LOCAL_CACHE.holdings)) {
        holdingsData = JSON.parse(readFileSync(LOCAL_CACHE.holdings, 'utf-8'));
      }
    } catch (e) {
      console.error('[HashrateService] Failed to load holdings cache:', e.message);
      holdingsData = { error: 'Data not available' };
    }
  }
}

/**
 * Load data - tries GitHub first, falls back to local cache
 */
async function loadData(forceRefresh = false) {
  const cacheExpired = !lastFetchTime || (Date.now() - lastFetchTime > CACHE_TTL_MS);

  if (forceRefresh || cacheExpired) {
    const success = await fetchFromGitHub();
    if (!success) {
      // Fall back to local cache
      loadFromLocalCache();
    }
  } else if (!hashrateData || !holdingsData) {
    loadFromLocalCache();
  }
}

/**
 * Force refresh from GitHub
 */
export async function refreshFromGitHub() {
  hashrateData = null;
  holdingsData = null;
  lastFetchTime = null;
  await loadData(true);
  return {
    success: !!hashrateData && !hashrateData.error,
    lastUpdated: hashrateData?.metadata?.last_updated,
    fetchedAt: new Date().toISOString()
  };
}

// Initialize on module load (sync from local cache)
loadFromLocalCache();

// Initialize on module load
loadData();

/**
 * Get country hashrate distribution
 * @returns {Object} Disclosed and estimated hashrate by country
 */
export async function getCountryHashrate() {
  await loadData();
  if (!hashrateData?.country_distribution) {
    return { error: 'Data not available' };
  }

  const { disclosed, estimated_actual } = hashrateData.country_distribution;
  const metadata = hashrateData.metadata;

  return {
    metadata: {
      lastUpdated: metadata?.last_updated,
      totalHashrateEH: metadata?.total_network_hashrate_EH,
      sources: metadata?.sources
    },
    disclosed,
    estimated: estimated_actual,
    keyInsights: hashrateData.key_insights
  };
}

/**
 * Get Iran-specific hashrate and holdings data
 * @returns {Object} Iran mining and holdings estimates
 */
export async function getIranData() {
  await loadData();

  const iranHashrate = hashrateData?.country_distribution?.estimated_actual?.Iran || {};
  const iranHoldings = holdingsData?.estimated_secret_holdings?.Iran || {};

  return {
    hashrate: {
      disclosedPercent: hashrateData?.country_distribution?.disclosed?.Iran?.share_percent || 4.2,
      estimatedLow: iranHashrate.share_percent_low || 3,
      estimatedHigh: iranHashrate.share_percent_high || 5,
      estimatedMid: iranHashrate.share_percent_mid || 4.2,
      confidence: iranHashrate.confidence || 'medium',
      evidence: iranHashrate.evidence || [],
      notes: iranHashrate.notes
    },
    holdings: {
      disclosedBTC: iranHoldings.disclosed_btc || 0,
      estimatedLow: iranHoldings.estimated_secret_btc_low || 40000,
      estimatedHigh: iranHoldings.estimated_secret_btc_high || 100000,
      estimatedMid: iranHoldings.estimated_secret_btc_mid || 60000,
      confidence: iranHoldings.confidence || 'medium',
      evidence: iranHoldings.evidence || []
    },
    lastUpdated: hashrateData?.metadata?.last_updated
  };
}

/**
 * Get China-specific hashrate and holdings data
 * @returns {Object} China mining and holdings estimates
 */
export async function getChinaData() {
  await loadData();

  const chinaHashrate = hashrateData?.country_distribution?.estimated_actual?.China || {};
  const chinaHoldings = holdingsData?.estimated_secret_holdings?.China || {};
  const chinaDisclosed = holdingsData?.disclosed_holdings?.China || {};

  return {
    hashrate: {
      disclosedPercent: hashrateData?.country_distribution?.disclosed?.China?.share_percent || 0,
      estimatedLow: chinaHashrate.share_percent_low || 15,
      estimatedHigh: chinaHashrate.share_percent_high || 25,
      estimatedMid: chinaHashrate.share_percent_mid || 21,
      confidence: chinaHashrate.confidence || 'medium',
      evidence: chinaHashrate.evidence || [],
      notes: chinaHashrate.notes
    },
    holdings: {
      disclosedBTC: chinaDisclosed.btc_held || 194000,
      disclosedStatus: chinaDisclosed.status,
      estimatedSecretLow: chinaHoldings.estimated_secret_btc_low || 30000,
      estimatedSecretHigh: chinaHoldings.estimated_secret_btc_high || 100000,
      estimatedSecretMid: chinaHoldings.estimated_secret_btc_mid || 60000,
      confidence: chinaHoldings.confidence || 'medium',
      evidence: chinaHoldings.evidence || []
    },
    lastUpdated: hashrateData?.metadata?.last_updated
  };
}

/**
 * Get all government holdings data
 * @returns {Object} Disclosed and estimated government BTC holdings
 */
export async function getGovernmentHoldings() {
  await loadData();
  if (!holdingsData) {
    return { error: 'Data not available' };
  }

  return {
    metadata: holdingsData.metadata,
    disclosed: holdingsData.disclosed_holdings,
    estimated: holdingsData.estimated_secret_holdings,
    aggregate: holdingsData.aggregate_analysis
  };
}

/**
 * Get mining pool distribution
 * @returns {Object} Mining pool market share data
 */
export async function getMiningPools() {
  await loadData();
  if (!hashrateData?.mining_pools) {
    return { error: 'Data not available' };
  }

  return {
    pools: hashrateData.mining_pools,
    totalHashrateEH: hashrateData.metadata?.total_network_hashrate_EH
  };
}

/**
 * Get summary for dashboard display
 * @returns {Object} Key metrics for quick display
 */
export async function getDashboardSummary() {
  await loadData();

  const iran = await getIranData();
  const china = await getChinaData();
  const holdings = holdingsData?.aggregate_analysis || {};

  return {
    globalHashrateEH: hashrateData?.metadata?.total_network_hashrate_EH || 827,
    countries: {
      usa: {
        hashratePercent: hashrateData?.country_distribution?.estimated_actual?.['United States']?.share_percent_mid || 37.5,
        confidence: 'high'
      },
      china: {
        hashratePercent: china.hashrate.estimatedMid,
        holdingsBTC: china.holdings.estimatedSecretMid,
        confidence: china.hashrate.confidence
      },
      iran: {
        hashratePercent: iran.hashrate.estimatedMid,
        holdingsBTC: iran.holdings.estimatedMid,
        confidence: iran.hashrate.confidence
      },
      russia: {
        hashratePercent: hashrateData?.country_distribution?.estimated_actual?.Russia?.share_percent_mid || 7,
        holdingsBTC: holdingsData?.estimated_secret_holdings?.Russia?.estimated_secret_btc_mid || 80000,
        confidence: 'low'
      },
      kazakhstan: {
        hashratePercent: hashrateData?.country_distribution?.estimated_actual?.Kazakhstan?.share_percent_mid || 12,
        confidence: 'medium'
      }
    },
    totalGovernmentBTC: {
      low: holdings.total_government_btc_low || 796500,
      mid: holdings.total_government_btc_mid || 903000,
      high: holdings.total_government_btc_high || 1138000,
      percentOfSupply: holdings.percent_of_supply_mid || 4.58
    },
    lastUpdated: hashrateData?.metadata?.last_updated
  };
}

export default {
  getCountryHashrate,
  getIranData,
  getChinaData,
  getGovernmentHoldings,
  getMiningPools,
  getDashboardSummary
};
