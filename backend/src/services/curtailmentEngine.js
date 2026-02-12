/**
 * Curtailment Engine — Phase 4
 *
 * Decision engine that determines optimal mining/curtailment state per machine
 * class based on real-time and day-ahead energy prices, fleet hashprice data,
 * and operational constraints.
 *
 * Key principles:
 *   - "Copilot mode": recommends but never auto-executes
 *   - "Peeling" strategy: shut least-efficient machines first as prices rise
 *   - Hysteresis band: $2/MWh dead band to prevent flip-flopping
 *   - Transparent reasoning: every recommendation includes human-readable rationale
 */

import { getCache, getFleetConfig, getEnergySettings } from '../cache/database.js';
import {
  fetchNetworkData,
  calculateNetworkHashprice,
  calculateMachineHashprice,
  getBreakevenHashprice,
} from './hashpriceEngine.js';

const HYSTERESIS_BAND_MWH = 2; // $2/MWh dead band

// ─── Core Decision Engine ──────────────────────────────────────────────────

/**
 * Get the current curtailment recommendation for the fleet.
 * Returns per-machine-class recommendations with reasoning.
 *
 * @param {object} opts - Optional overrides
 * @param {number} opts.energyPriceMWh - Override current energy price ($/MWh)
 * @param {object} opts.constraints - Override operational constraints
 * @returns {object} Recommendation with per-model decisions
 */
export async function getCurrentRecommendation(opts = {}) {
  const config = getFleetConfig();
  if (!config || !config.entries || config.entries.length === 0) {
    return {
      hasFleet: false,
      message: 'No fleet configured. Go to Settings > Fleet Configuration to add your machines.',
      timestamp: new Date().toISOString(),
    };
  }

  // Fetch current energy price
  const energyPriceMWh = opts.energyPriceMWh ?? getCurrentEnergyPriceMWh();
  const energyPriceKWh = energyPriceMWh / 1000;

  // Fetch network data for hashprice
  const networkData = await fetchNetworkData();
  const networkHashprice = calculateNetworkHashprice(networkData);

  // Get constraints
  const constraints = opts.constraints ?? getCurtailmentConstraints(config);

  // Build merit order: sort machine classes by efficiency (worst first = first to curtail)
  const meritOrder = buildMeritOrder(config.entries, energyPriceKWh, networkHashprice);

  // Determine optimal state for each class
  const decisions = [];
  let totalMiningRevenue = 0;
  let totalMiningCost = 0;
  let curtailedPower = 0;
  let miningPower = 0;

  for (const entry of meritOrder) {
    const decision = evaluateMachineClass(entry, energyPriceMWh, constraints);
    decisions.push(decision);

    if (decision.action === 'MINE') {
      totalMiningRevenue += entry.machineResult.grossRevenue * entry.quantity;
      totalMiningCost += entry.machineResult.electricityCost * entry.quantity;
      miningPower += (entry.specs.powerConsumption / 1e6) * entry.quantity; // MW
    } else {
      curtailedPower += (entry.specs.powerConsumption / 1e6) * entry.quantity;
    }
  }

  // Overall fleet state
  const allMining = decisions.every(d => d.action === 'MINE');
  const allCurtailed = decisions.every(d => d.action === 'CURTAIL');
  const fleetState = allMining ? 'MINING' : allCurtailed ? 'CURTAILED' : 'PARTIAL';

  // Savings from curtailment
  const curtailmentSavings = decisions
    .filter(d => d.action === 'CURTAIL')
    .reduce((sum, d) => sum + Math.abs(d.avoidedLoss), 0);

  return {
    hasFleet: true,
    timestamp: new Date().toISOString(),
    fleetState,
    energyPrice: {
      current: energyPriceMWh,
      unit: '$/MWh',
      currentKWh: energyPriceKWh,
    },
    networkHashprice: {
      hashprice: networkHashprice.hashprice,
      btcPrice: networkData.btcPrice,
    },
    summary: {
      totalMachines: meritOrder.reduce((s, e) => s + e.quantity, 0),
      miningMachines: decisions.filter(d => d.action === 'MINE').reduce((s, d) => s + d.quantity, 0),
      curtailedMachines: decisions.filter(d => d.action === 'CURTAIL').reduce((s, d) => s + d.quantity, 0),
      miningPowerMW: miningPower,
      curtailedPowerMW: curtailedPower,
      netRevenue: totalMiningRevenue - totalMiningCost,
      curtailmentSavings,
    },
    decisions,
    constraints,
    source: networkData.source,
    isMock: networkData.isMock || false,
  };
}

/**
 * Build merit order: rank machine classes from most to least efficient.
 * Least efficient machines get curtailed first (peeling strategy).
 */
function buildMeritOrder(fleetEntries, energyCostPerKWh, networkHashprice) {
  return fleetEntries.map(entry => {
    const specs = entry.overclockProfile ? {
      ...entry.asicModel,
      hashrate: entry.overclockProfile.hashrate,
      powerConsumption: entry.overclockProfile.powerConsumption,
      efficiency: entry.overclockProfile.powerConsumption / entry.overclockProfile.hashrate,
    } : entry.asicModel;

    // Use entry-specific energy cost if linked to an ERCOT node
    let effectiveEnergyCostKWh = energyCostPerKWh;
    if (entry.energyNode) {
      const nodePrice = getNodePrice(entry.energyNode);
      if (nodePrice !== null) {
        effectiveEnergyCostKWh = nodePrice / 1000; // $/MWh → $/kWh
      }
    }

    const machineResult = calculateMachineHashprice(specs, effectiveEnergyCostKWh, networkHashprice);
    const breakevenKWh = machineResult.breakEvenElectricity;
    const breakevenMWh = breakevenKWh * 1000;

    return {
      model: specs.model || entry.asicModel.model,
      modelId: specs.id || entry.asicModel.id,
      manufacturer: specs.manufacturer || entry.asicModel.manufacturer,
      specs,
      quantity: entry.quantity,
      energyNode: entry.energyNode || null,
      location: entry.location || null,
      effectiveEnergyCostKWh,
      machineResult,
      breakevenKWh,
      breakevenMWh,
      efficiency: specs.efficiency,
    };
  }).sort((a, b) => b.efficiency - a.efficiency); // Worst efficiency first (highest J/TH)
}

/**
 * Evaluate a single machine class: should it mine or curtail?
 * Applies hysteresis band to prevent flip-flopping.
 */
function evaluateMachineClass(entry, currentPriceMWh, constraints) {
  const { breakevenMWh, machineResult, model, quantity, specs, efficiency } = entry;

  // Core decision: is current energy price above breakeven?
  // With hysteresis: only switch when price crosses breakeven +/- band
  const upperBand = breakevenMWh + HYSTERESIS_BAND_MWH;
  const lowerBand = breakevenMWh - HYSTERESIS_BAND_MWH;

  let action;
  let reason;
  let confidence;

  if (currentPriceMWh > upperBand) {
    // Clearly unprofitable — curtail
    action = 'CURTAIL';
    reason = `Energy price ($${currentPriceMWh.toFixed(2)}/MWh) exceeds breakeven ($${breakevenMWh.toFixed(2)}/MWh) by $${(currentPriceMWh - breakevenMWh).toFixed(2)}. Mining would lose $${Math.abs(machineResult.netRevenue).toFixed(2)}/unit/day.`;
    confidence = 'high';
  } else if (currentPriceMWh < lowerBand) {
    // Clearly profitable — mine
    action = 'MINE';
    reason = `Energy price ($${currentPriceMWh.toFixed(2)}/MWh) is $${(breakevenMWh - currentPriceMWh).toFixed(2)} below breakeven ($${breakevenMWh.toFixed(2)}/MWh). Earning $${machineResult.netRevenue.toFixed(2)}/unit/day.`;
    confidence = 'high';
  } else {
    // Inside hysteresis band — maintain current state (default: mine if profitable)
    if (machineResult.isProfitable) {
      action = 'MINE';
      reason = `Energy price ($${currentPriceMWh.toFixed(2)}/MWh) is near breakeven ($${breakevenMWh.toFixed(2)}/MWh) within hysteresis band. Currently profitable — recommend maintaining mining.`;
      confidence = 'medium';
    } else {
      action = 'CURTAIL';
      reason = `Energy price ($${currentPriceMWh.toFixed(2)}/MWh) is near breakeven ($${breakevenMWh.toFixed(2)}/MWh) within hysteresis band. Currently unprofitable — recommend curtailment.`;
      confidence = 'medium';
    }
  }

  // Check minimum take constraint
  if (action === 'CURTAIL' && constraints.minimumTakePercent > 0) {
    // This is checked at fleet level later, just flag it
  }

  // Calculate avoided loss (savings from curtailing)
  const avoidedLoss = action === 'CURTAIL'
    ? Math.abs(machineResult.netRevenue) * quantity
    : 0;

  return {
    model,
    modelId: entry.modelId,
    manufacturer: entry.manufacturer,
    quantity,
    efficiency,
    action,
    reason,
    confidence,
    breakevenMWh,
    currentPriceMWh: currentPriceMWh,
    margin: breakevenMWh - currentPriceMWh, // positive = profitable headroom
    netRevenuePerUnit: machineResult.netRevenue,
    grossRevenuePerUnit: machineResult.grossRevenue,
    electricityCostPerUnit: machineResult.electricityCost,
    avoidedLoss,
    powerMW: (specs.powerConsumption / 1e6) * quantity,
    hashrateTH: specs.hashrate * quantity,
    energyNode: entry.energyNode,
    location: entry.location,
  };
}

// ─── Schedule Generator ────────────────────────────────────────────────────

/**
 * Generate a 24-hour operating schedule from day-ahead prices.
 * For each hour, determines which machine classes should mine or curtail.
 *
 * @param {object} opts
 * @param {string} opts.node - ERCOT node (default: from settings)
 * @param {string} opts.date - Target date YYYY-MM-DD (default: tomorrow)
 * @returns {object} 24-hour schedule with per-hour decisions
 */
export async function generateSchedule(opts = {}) {
  const config = getFleetConfig();
  if (!config || !config.entries || config.entries.length === 0) {
    return { hasFleet: false, message: 'No fleet configured.' };
  }

  const constraints = getCurtailmentConstraints(config);

  // Get day-ahead prices
  const node = opts.node || getDefaultNode();
  const dayAheadData = getDayAheadPrices(node);

  if (!dayAheadData || !dayAheadData.dayAheadPrices) {
    return {
      hasFleet: true,
      error: 'Day-ahead prices not available. They are typically published by 1PM for the next day.',
      timestamp: new Date().toISOString(),
    };
  }

  // Get network hashprice
  const networkData = await fetchNetworkData();
  const networkHashprice = calculateNetworkHashprice(networkData);

  // Generate hourly schedule
  const hourlySchedule = [];
  let totalMiningHours = 0;
  let totalCurtailedHours = 0;
  let estimatedRevenue = 0;
  let estimatedSavings = 0;
  let estimatedCost = 0;

  for (const hourData of dayAheadData.dayAheadPrices) {
    const hour = hourData.hour;
    const priceMWh = hourData.lmp;
    const priceKWh = priceMWh / 1000;

    // Build merit order for this hour's price
    const meritOrder = buildMeritOrder(config.entries, priceKWh, networkHashprice);

    const hourDecisions = [];
    let hourMiningPower = 0;
    let hourCurtailedPower = 0;

    for (const entry of meritOrder) {
      const decision = evaluateMachineClass(entry, priceMWh, constraints);
      hourDecisions.push({
        model: decision.model,
        action: decision.action,
        quantity: decision.quantity,
        powerMW: decision.powerMW,
        netRevenuePerUnit: decision.netRevenuePerUnit,
      });

      if (decision.action === 'MINE') {
        hourMiningPower += decision.powerMW;
        // Revenue per hour = daily / 24
        estimatedRevenue += (decision.grossRevenuePerUnit * decision.quantity) / 24;
        estimatedCost += (decision.electricityCostPerUnit * decision.quantity) / 24;
      } else {
        hourCurtailedPower += decision.powerMW;
        estimatedSavings += decision.avoidedLoss / 24;
      }
    }

    const allMining = hourDecisions.every(d => d.action === 'MINE');
    const allCurtailed = hourDecisions.every(d => d.action === 'CURTAIL');
    const hourState = allMining ? 'MINING' : allCurtailed ? 'CURTAILED' : 'PARTIAL';

    if (hourState === 'MINING') totalMiningHours++;
    else totalCurtailedHours++;

    hourlySchedule.push({
      hour,
      priceMWh,
      state: hourState,
      miningPowerMW: hourMiningPower,
      curtailedPowerMW: hourCurtailedPower,
      decisions: hourDecisions,
    });
  }

  // Apply minimum duration constraint — merge short curtailment windows
  const smoothedSchedule = applyMinDurationConstraint(hourlySchedule, constraints);

  // Identify mining windows (contiguous mining blocks)
  const miningWindows = identifyWindows(smoothedSchedule, 'MINING');
  const curtailmentWindows = identifyWindows(smoothedSchedule, 'CURTAILED');

  return {
    hasFleet: true,
    timestamp: new Date().toISOString(),
    date: opts.date || getNextDay(),
    node,
    schedule: smoothedSchedule,
    summary: {
      miningHours: totalMiningHours,
      curtailedHours: 24 - totalMiningHours,
      estimatedRevenue,
      estimatedCost,
      estimatedNetRevenue: estimatedRevenue - estimatedCost,
      estimatedSavings,
      avgPriceMWh: dayAheadData.dailyAvg || (dayAheadData.dayAheadPrices.reduce((s, h) => s + h.lmp, 0) / dayAheadData.dayAheadPrices.length),
      minPriceMWh: Math.min(...dayAheadData.dayAheadPrices.map(h => h.lmp)),
      maxPriceMWh: Math.max(...dayAheadData.dayAheadPrices.map(h => h.lmp)),
    },
    miningWindows,
    curtailmentWindows,
    constraints,
    networkHashprice: networkHashprice.hashprice,
    btcPrice: networkData.btcPrice,
    source: networkData.source,
    isMock: networkData.isMock || false,
  };
}

/**
 * Apply minimum duration constraint: if a curtailment window is shorter
 * than minCurtailmentMinutes, extend or collapse it.
 */
function applyMinDurationConstraint(schedule, constraints) {
  const minHours = Math.ceil((constraints.minCurtailmentMinutes || 0) / 60);
  if (minHours <= 1) return schedule;

  const result = [...schedule];

  // Find short curtailment windows and extend them
  let i = 0;
  while (i < result.length) {
    if (result[i].state !== 'MINING') {
      // Count consecutive non-mining hours
      let j = i;
      while (j < result.length && result[j].state !== 'MINING') j++;
      const windowLength = j - i;

      if (windowLength < minHours && windowLength > 0) {
        // Window too short — convert back to mining if savings are marginal
        for (let k = i; k < j; k++) {
          result[k] = { ...result[k], state: 'MINING', note: 'Below minimum duration — mining maintained' };
        }
      }
      i = j;
    } else {
      i++;
    }
  }

  return result;
}

/**
 * Identify contiguous windows of a given state.
 */
function identifyWindows(schedule, targetState) {
  const windows = [];
  let start = null;

  for (let i = 0; i < schedule.length; i++) {
    const isTarget = schedule[i].state === targetState ||
      (targetState === 'CURTAILED' && schedule[i].state === 'PARTIAL');

    if (isTarget && start === null) {
      start = i;
    } else if (!isTarget && start !== null) {
      windows.push({
        startHour: start,
        endHour: i - 1,
        duration: i - start,
        avgPrice: schedule.slice(start, i).reduce((s, h) => s + h.priceMWh, 0) / (i - start),
      });
      start = null;
    }
  }

  if (start !== null) {
    windows.push({
      startHour: start,
      endHour: schedule.length - 1,
      duration: schedule.length - start,
      avgPrice: schedule.slice(start).reduce((s, h) => s + h.priceMWh, 0) / (schedule.length - start),
    });
  }

  return windows;
}

// ─── Performance Analysis ──────────────────────────────────────────────────

/**
 * Analyze curtailment performance over a given period.
 * Compares actual vs optimal curtailment decisions.
 *
 * @param {number} days - Number of days to analyze
 * @returns {object} Performance metrics
 */
export function analyzePerformance(events, days = 30) {
  if (!events || events.length === 0) {
    return {
      totalEvents: 0,
      totalSavings: 0,
      avgSavingsPerEvent: 0,
      totalCurtailedHours: 0,
      totalMiningHours: days * 24,
      curtailmentRate: 0,
      savingsByType: {},
      dailySavings: [],
    };
  }

  let totalSavings = 0;
  let totalCurtailedMinutes = 0;
  const savingsByType = {};
  const dailyMap = {};

  for (const event of events) {
    const savings = event.estimated_savings || 0;
    totalSavings += savings;

    const durationMin = event.duration_minutes || 0;
    totalCurtailedMinutes += durationMin;

    const type = event.trigger_type || 'manual';
    savingsByType[type] = (savingsByType[type] || 0) + savings;

    const date = event.start_time?.split('T')[0];
    if (date) {
      if (!dailyMap[date]) dailyMap[date] = { date, savings: 0, events: 0, curtailedMinutes: 0 };
      dailyMap[date].savings += savings;
      dailyMap[date].events += 1;
      dailyMap[date].curtailedMinutes += durationMin;
    }
  }

  const totalHours = days * 24;
  const curtailedHours = totalCurtailedMinutes / 60;

  return {
    totalEvents: events.length,
    totalSavings,
    avgSavingsPerEvent: events.length > 0 ? totalSavings / events.length : 0,
    totalCurtailedHours: curtailedHours,
    totalMiningHours: totalHours - curtailedHours,
    curtailmentRate: totalHours > 0 ? (curtailedHours / totalHours) * 100 : 0,
    savingsByType,
    dailySavings: Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date)),
  };
}

// ─── Backtesting Engine ────────────────────────────────────────────────────

/**
 * Backtest a curtailment strategy against historical data.
 *
 * @param {object} opts
 * @param {string} opts.startDate - Start of backtest period (YYYY-MM-DD)
 * @param {string} opts.endDate - End of backtest period (YYYY-MM-DD)
 * @param {string} opts.strategy - Strategy name: 'peeling' | 'all_or_nothing' | 'threshold'
 * @param {object} opts.params - Strategy-specific parameters
 * @param {string} opts.node - ERCOT node
 * @returns {object} Backtest results
 */
export async function runBacktest(opts, historicalPrices, config) {
  if (!config || !config.entries || config.entries.length === 0) {
    return { error: 'No fleet configured for backtesting.' };
  }

  const {
    strategy = 'peeling',
    params = {},
    node = 'HB_NORTH',
  } = opts;

  // Get current network data for hashprice (constant for backtest simplicity)
  const networkData = await fetchNetworkData();
  const networkHashprice = calculateNetworkHashprice(networkData);

  if (!historicalPrices || historicalPrices.length === 0) {
    return { error: 'No historical price data available for this period and node.' };
  }

  // Group prices by date
  const pricesByDate = {};
  for (const row of historicalPrices) {
    const date = row.timestamp.split('T')[0];
    if (!pricesByDate[date]) pricesByDate[date] = [];
    pricesByDate[date].push(row);
  }

  const dailyResults = [];
  let totalAlwaysMineRevenue = 0;
  let totalStrategyRevenue = 0;
  let totalCurtailedHours = 0;
  let totalMiningHours = 0;

  for (const [date, prices] of Object.entries(pricesByDate)) {
    // Sort by timestamp
    prices.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    let dayAlwaysMineRev = 0;
    let dayStrategyRev = 0;
    let dayCurtailedHours = 0;
    let dayMiningHours = 0;

    for (const priceRow of prices) {
      const priceMWh = priceRow.lmp;
      const priceKWh = priceMWh / 1000;

      // "Always mine" baseline
      for (const entry of config.entries) {
        const specs = entry.asicModel;
        const machResult = calculateMachineHashprice(specs, priceKWh, networkHashprice);
        // Revenue per data point (approximate hourly)
        dayAlwaysMineRev += (machResult.netRevenue * entry.quantity) / 24;
      }

      // Strategy evaluation
      const meritOrder = buildMeritOrder(config.entries, priceKWh, networkHashprice);

      for (const entry of meritOrder) {
        const shouldMine = evaluateStrategy(strategy, entry, priceMWh, params);

        if (shouldMine) {
          dayStrategyRev += (entry.machineResult.netRevenue * entry.quantity) / 24;
          dayMiningHours += 1 / config.entries.length; // approximate
        } else {
          // Curtailed — zero revenue but also zero cost
          dayCurtailedHours += 1 / config.entries.length;
        }
      }
    }

    dailyResults.push({
      date,
      alwaysMineRevenue: dayAlwaysMineRev,
      strategyRevenue: dayStrategyRev,
      improvement: dayStrategyRev - dayAlwaysMineRev,
      curtailedHours: dayCurtailedHours,
      miningHours: dayMiningHours,
      dataPoints: prices.length,
    });

    totalAlwaysMineRevenue += dayAlwaysMineRev;
    totalStrategyRevenue += dayStrategyRev;
    totalCurtailedHours += dayCurtailedHours;
    totalMiningHours += dayMiningHours;
  }

  const improvement = totalStrategyRevenue - totalAlwaysMineRevenue;

  return {
    strategy,
    params,
    node,
    startDate: opts.startDate,
    endDate: opts.endDate,
    totalDays: Object.keys(pricesByDate).length,
    dataPoints: historicalPrices.length,
    results: {
      alwaysMineRevenue: totalAlwaysMineRevenue,
      strategyRevenue: totalStrategyRevenue,
      improvement,
      improvementPct: totalAlwaysMineRevenue !== 0
        ? (improvement / Math.abs(totalAlwaysMineRevenue)) * 100 : 0,
      totalCurtailedHours,
      totalMiningHours,
      curtailmentRate: (totalCurtailedHours + totalMiningHours) > 0
        ? (totalCurtailedHours / (totalCurtailedHours + totalMiningHours)) * 100 : 0,
    },
    dailyResults,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Evaluate whether a machine class should mine under a given strategy.
 */
function evaluateStrategy(strategy, entry, priceMWh, params) {
  switch (strategy) {
    case 'peeling':
      // Default: mine if energy price < breakeven (with hysteresis)
      return priceMWh < (entry.breakevenMWh - HYSTERESIS_BAND_MWH);

    case 'all_or_nothing':
      // All machines on or all off based on fleet-average breakeven
      return priceMWh < (entry.breakevenMWh);

    case 'threshold':
      // Fixed price threshold: mine below threshold, curtail above
      const threshold = params.thresholdMWh ?? 50;
      return priceMWh < threshold;

    case 'aggressive':
      // More aggressive: curtail even marginally profitable machines
      return priceMWh < (entry.breakevenMWh - HYSTERESIS_BAND_MWH * 2);

    default:
      return entry.machineResult.isProfitable;
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Get current real-time energy price in $/MWh from Phase 2 cache.
 */
function getCurrentEnergyPriceMWh() {
  const defaultNode = getDefaultNode();
  const iso = 'ERCOT';

  // Try node-specific cache first
  const cacheKey = `energy-rt-${iso}-${defaultNode}`;
  const cached = getCache(cacheKey);
  if (cached?.data?.realTimePrice?.lmp !== undefined) {
    return cached.data.realTimePrice.lmp;
  }

  // Try the general realtime prices cache
  const rtCache = getCache('energy-realtime-prices');
  if (rtCache?.data?.[defaultNode] !== undefined) {
    return rtCache.data[defaultNode];
  }

  // Fallback: use fleet default energy cost converted to $/MWh
  const config = getFleetConfig();
  const defaultKWh = config?.defaultEnergyCostKWh || 0.05;
  return defaultKWh * 1000; // $/kWh → $/MWh
}

/**
 * Get energy price for a specific ERCOT node.
 */
function getNodePrice(node) {
  const iso = 'ERCOT';
  const cacheKey = `energy-rt-${iso}-${node}`;
  const cached = getCache(cacheKey);
  if (cached?.data?.realTimePrice?.lmp !== undefined) {
    return cached.data.realTimePrice.lmp;
  }

  const rtCache = getCache('energy-realtime-prices');
  if (rtCache?.data?.[node] !== undefined) {
    return rtCache.data[node];
  }

  return null;
}

/**
 * Get the default ERCOT node from energy settings or fleet config.
 */
function getDefaultNode() {
  try {
    const settings = getEnergySettings();
    if (settings?.primaryNode) return settings.primaryNode;
    if (settings?.defaultNode) return settings.defaultNode;
  } catch (e) { /* ignore */ }

  return 'HB_NORTH';
}

/**
 * Get day-ahead prices from cache.
 */
function getDayAheadPrices(node) {
  const iso = 'ERCOT';
  const cacheKey = `energy-da-${iso}-${node}-tomorrow`;
  const cached = getCache(cacheKey);
  if (cached?.data) return cached.data;

  // Try today's date
  const today = new Date().toISOString().split('T')[0];
  const todayCache = getCache(`energy-da-${iso}-${node}-${today}`);
  if (todayCache?.data) return todayCache.data;

  // Generate mock data if nothing available
  return generateMockDayAheadPrices();
}

/**
 * Generate mock day-ahead prices for when real data isn't available.
 */
function generateMockDayAheadPrices() {
  const prices = [];
  // Typical ERCOT pattern: low at night, high in afternoon
  const basePattern = [
    22, 20, 18, 17, 18, 22, 30, 42,  // 00-07 (night/early morning)
    52, 58, 55, 50, 48, 55, 65, 80,  // 08-15 (daytime peak builds)
    95, 85, 60, 45, 35, 30, 28, 25,  // 16-23 (peak then decline)
  ];

  for (let h = 0; h < 24; h++) {
    const noise = (Math.random() - 0.5) * 10;
    prices.push({
      hour: h,
      lmp: Math.max(0, basePattern[h] + noise),
    });
  }

  return {
    dayAheadPrices: prices,
    dailyAvg: prices.reduce((s, p) => s + p.lmp, 0) / 24,
    isMock: true,
    source: 'Mock DAM Data',
  };
}

/**
 * Get operational constraints from fleet config or defaults.
 */
function getCurtailmentConstraints(config) {
  const userConstraints = config?.curtailmentConstraints || {};
  return {
    minCurtailmentMinutes: userConstraints.minCurtailmentMinutes ?? 30,
    rampUpMinutes: userConstraints.rampUpMinutes ?? 15,
    demandResponseEnabled: userConstraints.demandResponseEnabled ?? false,
    demandResponsePrograms: userConstraints.demandResponsePrograms ?? [],
    minimumTakePercent: userConstraints.minimumTakePercent ?? 0,
    maxCurtailmentPercent: userConstraints.maxCurtailmentPercent ?? 100,
    hysteresisBandMWh: userConstraints.hysteresisBandMWh ?? HYSTERESIS_BAND_MWH,
    curtailmentMode: userConstraints.curtailmentMode ?? 'copilot', // copilot | auto
  };
}

function getNextDay() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

export default {
  getCurrentRecommendation,
  generateSchedule,
  analyzePerformance,
  runBacktest,
};
