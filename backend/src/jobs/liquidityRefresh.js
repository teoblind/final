/**
 * Liquidity Data Background Refresh Job
 *
 * Periodically refreshes FRED and Yahoo data to keep liquidity inputs fresh.
 * Runs on startup and then at configurable intervals.
 *
 * Schedule:
 * - FRED data: Every 15 minutes (respects API caching)
 * - Yahoo data: Every 5 minutes during market hours
 */

import { fetchAllFredData, clearFredCache } from '../services/fredService.js';

// Track last refresh times
let lastFredRefresh = null;
let lastYahooRefresh = null;
let refreshInterval = null;

// Cached data store
const dataStore = {
  fred: { inputs: {}, sources: {}, status: 'pending' },
  yahoo: { inputs: {}, sources: {}, status: 'pending' },
  lastUpdate: null
};

/**
 * Check if US markets are open (roughly 9:30 AM - 4:00 PM ET on weekdays)
 * @returns {boolean}
 */
function isMarketHours() {
  const now = new Date();
  const etOffset = -5; // EST (adjust for DST if needed)
  const utcHours = now.getUTCHours();
  const etHours = (utcHours + etOffset + 24) % 24;
  const day = now.getUTCDay();

  // Weekdays only
  if (day === 0 || day === 6) return false;

  // 9:30 AM to 4:00 PM ET
  return etHours >= 9 && etHours < 16;
}

/**
 * Refresh FRED data
 * @returns {Promise<Object>}
 */
async function refreshFredData() {
  console.log('[LiquidityRefresh] Refreshing FRED data...');
  try {
    const result = await fetchAllFredData();
    dataStore.fred = {
      inputs: result.inputs || {},
      sources: result.sources || {},
      status: result.status || 'ok',
      errorCount: result.errorCount || 0
    };
    lastFredRefresh = new Date();
    console.log(`[LiquidityRefresh] FRED refresh complete: ${Object.keys(result.inputs || {}).length} fields`);
    return result;
  } catch (error) {
    console.error('[LiquidityRefresh] FRED refresh failed:', error.message);
    dataStore.fred.status = 'error';
    return { inputs: {}, sources: {}, error: error.message };
  }
}

/**
 * Refresh Yahoo Finance data (prices)
 * This is a placeholder - actual Yahoo fetching is done in the liquidity route
 * @returns {Promise<Object>}
 */
async function refreshYahooData() {
  // Yahoo data is fetched on-demand in the liquidity route
  // This function just marks the timestamp for tracking
  lastYahooRefresh = new Date();
  console.log('[LiquidityRefresh] Yahoo refresh timestamp updated');
  return { status: 'delegated' };
}

/**
 * Run a full refresh cycle
 */
async function runRefreshCycle() {
  console.log('[LiquidityRefresh] Running refresh cycle...');

  const tasks = [];

  // Always refresh FRED if it's been more than 10 minutes
  const fredAge = lastFredRefresh ? (Date.now() - lastFredRefresh.getTime()) / 1000 / 60 : Infinity;
  if (fredAge >= 10) {
    tasks.push(refreshFredData());
  }

  // Update Yahoo more frequently during market hours
  const yahooAge = lastYahooRefresh ? (Date.now() - lastYahooRefresh.getTime()) / 1000 / 60 : Infinity;
  const yahooThreshold = isMarketHours() ? 2 : 10;
  if (yahooAge >= yahooThreshold) {
    tasks.push(refreshYahooData());
  }

  if (tasks.length > 0) {
    await Promise.all(tasks);
    dataStore.lastUpdate = new Date().toISOString();
  }
}

/**
 * Get current cached data
 * @returns {Object}
 */
export function getCachedLiquidityData() {
  return {
    ...dataStore,
    lastFredRefresh: lastFredRefresh?.toISOString() || null,
    lastYahooRefresh: lastYahooRefresh?.toISOString() || null
  };
}

/**
 * Force a refresh of all data
 */
export async function forceRefresh() {
  console.log('[LiquidityRefresh] Force refresh requested');
  clearFredCache();
  lastFredRefresh = null;
  lastYahooRefresh = null;
  await runRefreshCycle();
}

/**
 * Start the background refresh scheduler
 * @param {number} intervalMinutes - How often to check for refresh (default: 5 minutes)
 */
export function startRefreshScheduler(intervalMinutes = 5) {
  if (refreshInterval) {
    console.log('[LiquidityRefresh] Scheduler already running');
    return;
  }

  const intervalMs = intervalMinutes * 60 * 1000;

  console.log(`[LiquidityRefresh] Starting scheduler (interval: ${intervalMinutes} min)`);

  // Run immediately on startup
  runRefreshCycle().catch(err => {
    console.error('[LiquidityRefresh] Initial refresh failed:', err.message);
  });

  // Then run periodically
  refreshInterval = setInterval(() => {
    runRefreshCycle().catch(err => {
      console.error('[LiquidityRefresh] Scheduled refresh failed:', err.message);
    });
  }, intervalMs);

  return refreshInterval;
}

/**
 * Stop the background refresh scheduler
 */
export function stopRefreshScheduler() {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
    console.log('[LiquidityRefresh] Scheduler stopped');
  }
}

/**
 * Get scheduler status
 * @returns {Object}
 */
export function getSchedulerStatus() {
  return {
    running: refreshInterval !== null,
    lastFredRefresh: lastFredRefresh?.toISOString() || null,
    lastYahooRefresh: lastYahooRefresh?.toISOString() || null,
    isMarketHours: isMarketHours(),
    fredDataFields: Object.keys(dataStore.fred.inputs).length,
    fredStatus: dataStore.fred.status
  };
}

export default {
  startRefreshScheduler,
  stopRefreshScheduler,
  forceRefresh,
  getCachedLiquidityData,
  getSchedulerStatus
};
