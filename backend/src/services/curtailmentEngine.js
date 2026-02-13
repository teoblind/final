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
 *   - Hysteresis band: configurable dead band (default $2/MWh) to prevent flip-flopping
 *   - Transparent reasoning: every recommendation includes human-readable rationale
 *   - Look-ahead: uses DAM prices to avoid myopic real-time decisions
 */

import { getCache, getFleetConfig, getEnergySettings, getGridEvents } from '../cache/database.js';
import {
  fetchNetworkData,
  calculateNetworkHashprice,
  calculateMachineHashprice,
  getBreakevenHashprice,
} from './hashpriceEngine.js';

const DEFAULT_HYSTERESIS_BAND_MWH = 2; // $2/MWh dead band

// ─── Core Decision Engine ──────────────────────────────────────────────────

/**
 * Get the current curtailment recommendation for the fleet.
 * Returns per-machine-class recommendations with reasoning.
 * All revenue/cost figures are PER HOUR for operational clarity.
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
  const hysteresis = constraints.hysteresisBandMWh ?? DEFAULT_HYSTERESIS_BAND_MWH;

  // Check demand response: is the grid in stress?
  const drPremium = getDemandResponsePremium(constraints);

  // Build merit order: sort machine classes by efficiency (worst first = first to curtail)
  const meritOrder = buildMeritOrder(config.entries, energyPriceKWh, networkHashprice);

  // Determine optimal state for each class — all values per HOUR
  const decisions = [];
  let miningRevenuePerHr = 0;
  let miningCostPerHr = 0;
  let curtailmentSavingsPerHr = 0;
  let curtailedPowerMW = 0;
  let miningPowerMW = 0;
  let miningHashrateTH = 0;
  let curtailedHashrateTH = 0;
  let miningMachines = 0;
  let curtailedMachines = 0;

  for (const entry of meritOrder) {
    const decision = evaluateMachineClass(entry, energyPriceMWh, constraints, hysteresis, drPremium);
    decisions.push(decision);

    if (decision.action === 'MINE') {
      miningRevenuePerHr += decision.grossRevenuePerHr;
      miningCostPerHr += decision.electricityCostPerHr;
      miningPowerMW += decision.powerMW;
      miningHashrateTH += decision.hashrateTH;
      miningMachines += decision.quantity;
    } else {
      curtailedPowerMW += decision.powerMW;
      curtailedHashrateTH += decision.hashrateTH;
      curtailedMachines += decision.quantity;
      curtailmentSavingsPerHr += decision.avoidedLossPerHr;
      // Add demand response payment as additional savings
      if (drPremium > 0) {
        curtailmentSavingsPerHr += decision.drPaymentPerHr;
      }
    }
  }

  // Overall fleet state
  const totalMachines = miningMachines + curtailedMachines;
  const allMining = curtailedMachines === 0;
  const allCurtailed = miningMachines === 0;
  const fleetState = allMining ? 'MINING' : allCurtailed ? 'CURTAILED' : 'PARTIAL';

  // Next state change prediction from DAM data
  const nextStateChange = predictNextStateChange(decisions, constraints, hysteresis);

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
      totalMachines,
      miningMachines,
      curtailedMachines,
      fleetOnlinePercent: totalMachines > 0 ? (miningMachines / totalMachines) * 100 : 0,
      miningPowerMW,
      curtailedPowerMW,
      miningHashrateTH,
      curtailedHashrateTH,
      // All revenue figures are PER HOUR
      revenuePerHr: miningRevenuePerHr,
      costPerHr: miningCostPerHr,
      netRevenuePerHr: miningRevenuePerHr - miningCostPerHr,
      curtailmentSavingsPerHr,
      drPaymentPerHr: drPremium > 0 ? curtailedPowerMW * drPremium : 0,
      // Daily projections for convenience
      netRevenuePerDay: (miningRevenuePerHr - miningCostPerHr) * 24,
      curtailmentSavingsPerDay: curtailmentSavingsPerHr * 24,
    },
    nextStateChange,
    decisions,
    constraints,
    demandResponse: {
      active: drPremium > 0,
      premiumMWh: drPremium,
      gridStatus: getGridStatus(),
    },
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
 * Applies asymmetric hysteresis band to prevent flip-flopping.
 * Band/2 on each side: currently mining → curtail at breakeven + band/2,
 *                       currently curtailed → mine at breakeven - band/2.
 * Since we don't track persistent state, use profitability as proxy.
 * Also factors in demand response premium and price thresholds.
 */
function evaluateMachineClass(entry, currentPriceMWh, constraints, hysteresis, drPremium) {
  const { breakevenMWh, machineResult, model, quantity, specs, efficiency } = entry;
  const halfBand = hysteresis / 2;

  // Check absolute price thresholds first
  const alwaysMineBelow = constraints.alwaysMineBelow ?? null;
  const alwaysCurtailAbove = constraints.alwaysCurtailAbove ?? null;

  let action;
  let reason;
  let confidence;

  if (alwaysCurtailAbove !== null && currentPriceMWh > alwaysCurtailAbove) {
    action = 'CURTAIL';
    reason = `Energy price ($${currentPriceMWh.toFixed(2)}/MWh) exceeds always-curtail threshold ($${alwaysCurtailAbove}/MWh). Mandatory curtailment.`;
    confidence = 'high';
  } else if (alwaysMineBelow !== null && currentPriceMWh < alwaysMineBelow) {
    action = 'MINE';
    reason = `Energy price ($${currentPriceMWh.toFixed(2)}/MWh) is below always-mine threshold ($${alwaysMineBelow}/MWh). Mining regardless.`;
    confidence = 'high';
  } else {
    // Effective breakeven: adjust for DR premium (curtailing earns DR payment)
    const effectiveBreakevenMWh = drPremium > 0
      ? breakevenMWh - drPremium  // DR payment makes curtailing more attractive
      : breakevenMWh;

    // Asymmetric hysteresis: use profitability as proxy for current state
    const upperBand = effectiveBreakevenMWh + halfBand;  // curtail threshold
    const lowerBand = effectiveBreakevenMWh - halfBand;  // mine threshold

    if (currentPriceMWh > upperBand) {
      // Clearly unprofitable — curtail
      action = 'CURTAIL';
      const hourlyLoss = Math.abs(machineResult.netRevenue) / 24;
      reason = `Energy price ($${currentPriceMWh.toFixed(2)}/MWh) exceeds breakeven ($${breakevenMWh.toFixed(2)}/MWh) + hysteresis. Mining would lose $${hourlyLoss.toFixed(2)}/unit/hr.`;
      if (drPremium > 0) {
        reason += ` Demand response active: +$${drPremium.toFixed(2)}/MWh curtailment premium.`;
      }
      confidence = 'high';
    } else if (currentPriceMWh < lowerBand) {
      // Clearly profitable — mine
      action = 'MINE';
      const hourlyProfit = machineResult.netRevenue / 24;
      reason = `Energy price ($${currentPriceMWh.toFixed(2)}/MWh) is $${(breakevenMWh - currentPriceMWh).toFixed(2)} below breakeven ($${breakevenMWh.toFixed(2)}/MWh). Earning $${hourlyProfit.toFixed(2)}/unit/hr.`;
      confidence = 'high';
    } else {
      // Inside hysteresis band — maintain current state (proxy: use profitability)
      if (machineResult.isProfitable) {
        action = 'MINE';
        reason = `Energy price ($${currentPriceMWh.toFixed(2)}/MWh) is near breakeven ($${breakevenMWh.toFixed(2)}/MWh) within hysteresis band (±$${halfBand.toFixed(1)}). Currently profitable — maintain mining.`;
        confidence = 'medium';
      } else {
        action = 'CURTAIL';
        reason = `Energy price ($${currentPriceMWh.toFixed(2)}/MWh) is near breakeven ($${breakevenMWh.toFixed(2)}/MWh) within hysteresis band (±$${halfBand.toFixed(1)}). Currently unprofitable — recommend curtailment.`;
        confidence = 'medium';
      }
    }
  }

  // Per-hour calculations (all values /hr for operational clarity)
  const grossRevenuePerHr = (machineResult.grossRevenue * quantity) / 24;
  const electricityCostPerHr = (machineResult.electricityCost * quantity) / 24;
  const netRevenuePerHr = grossRevenuePerHr - electricityCostPerHr;

  // Avoided loss: what we save by not running unprofitable machines (per hour)
  const avoidedLossPerHr = action === 'CURTAIL' && netRevenuePerHr < 0
    ? Math.abs(netRevenuePerHr)
    : 0;

  // Opportunity cost: revenue foregone by curtailing profitable machines (per hour)
  const opportunityCostPerHr = action === 'CURTAIL' && netRevenuePerHr > 0
    ? netRevenuePerHr
    : 0;

  // Demand response payment for curtailed power
  const powerMW = (specs.powerConsumption / 1e6) * quantity;
  const drPaymentPerHr = action === 'CURTAIL' && drPremium > 0
    ? powerMW * drPremium
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
    currentPriceMWh,
    margin: breakevenMWh - currentPriceMWh, // positive = profitable headroom ($/MWh)
    // Per-unit per-day (from hashprice engine, for reference)
    netRevenuePerUnitPerDay: machineResult.netRevenue,
    grossRevenuePerUnitPerDay: machineResult.grossRevenue,
    electricityCostPerUnitPerDay: machineResult.electricityCost,
    // Fleet-wide per-hour (operational)
    grossRevenuePerHr,
    electricityCostPerHr,
    netRevenuePerHr,
    avoidedLossPerHr,
    opportunityCostPerHr,
    drPaymentPerHr,
    powerMW,
    hashrateTH: specs.hashrate * quantity,
    energyNode: entry.energyNode,
    location: entry.location,
  };
}

// ─── Schedule Generator ────────────────────────────────────────────────────

/**
 * Generate a 24-hour operating schedule from day-ahead prices.
 * For each hour, determines which machine classes should mine or curtail.
 * Includes always-on comparison and per-class Gantt data.
 */
export async function generateSchedule(opts = {}) {
  const config = getFleetConfig();
  if (!config || !config.entries || config.entries.length === 0) {
    return { hasFleet: false, message: 'No fleet configured.' };
  }

  const constraints = getCurtailmentConstraints(config);
  const hysteresis = constraints.hysteresisBandMWh ?? DEFAULT_HYSTERESIS_BAND_MWH;
  const drPremium = getDemandResponsePremium(constraints);

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

  // Collect unique model IDs for per-class Gantt
  const modelIds = [...new Set(config.entries.map(e => e.asicModel.id || e.asicModel.model))];

  // Generate hourly schedule with per-class decisions
  const hourlySchedule = [];
  let totalMiningHours = 0;
  let optimizedRevenue = 0;
  let optimizedCost = 0;
  let alwaysOnRevenue = 0;
  let alwaysOnCost = 0;
  let curtailmentSavings = 0;

  // Per-model Gantt data: model → array of 24 hours with action
  const modelGantt = {};
  for (const id of modelIds) modelGantt[id] = [];

  for (const hourData of dayAheadData.dayAheadPrices) {
    const hour = hourData.hour;
    const priceMWh = hourData.lmp;
    const priceKWh = priceMWh / 1000;

    // Build merit order for this hour's price
    const meritOrder = buildMeritOrder(config.entries, priceKWh, networkHashprice);

    const hourDecisions = [];
    let hourMiningPower = 0;
    let hourCurtailedPower = 0;
    let hourMiningHashrate = 0;
    let hourCurtailedHashrate = 0;

    for (const entry of meritOrder) {
      const decision = evaluateMachineClass(entry, priceMWh, constraints, hysteresis, drPremium);
      hourDecisions.push({
        model: decision.model,
        modelId: decision.modelId,
        action: decision.action,
        quantity: decision.quantity,
        powerMW: decision.powerMW,
        hashrateTH: decision.hashrateTH,
        netRevenuePerHr: decision.netRevenuePerHr,
        breakevenMWh: decision.breakevenMWh,
      });

      // Per-class Gantt
      const gantKey = entry.modelId || entry.model;
      if (modelGantt[gantKey]) {
        modelGantt[gantKey].push({ hour, action: decision.action });
      }

      if (decision.action === 'MINE') {
        hourMiningPower += decision.powerMW;
        hourMiningHashrate += decision.hashrateTH;
        optimizedRevenue += decision.grossRevenuePerHr;
        optimizedCost += decision.electricityCostPerHr;
      } else {
        hourCurtailedPower += decision.powerMW;
        hourCurtailedHashrate += decision.hashrateTH;
        curtailmentSavings += decision.avoidedLossPerHr + decision.drPaymentPerHr;
      }

      // Always-on baseline: what if every machine ran this hour?
      alwaysOnRevenue += decision.grossRevenuePerHr;
      alwaysOnCost += decision.electricityCostPerHr;
    }

    const allMining = hourDecisions.every(d => d.action === 'MINE');
    const allCurtailed = hourDecisions.every(d => d.action === 'CURTAIL');
    const hourState = allMining ? 'MINING' : allCurtailed ? 'CURTAILED' : 'PARTIAL';
    if (hourState === 'MINING') totalMiningHours++;

    hourlySchedule.push({
      hour,
      priceMWh,
      state: hourState,
      miningPowerMW: hourMiningPower,
      curtailedPowerMW: hourCurtailedPower,
      miningHashrateTH: hourMiningHashrate,
      curtailedHashrateTH: hourCurtailedHashrate,
      decisions: hourDecisions,
    });
  }

  // Apply minimum duration constraints (both curtailment and run)
  const smoothedSchedule = applyDurationConstraints(hourlySchedule, constraints);

  // Identify windows
  const miningWindows = identifyWindows(smoothedSchedule, 'MINING');
  const curtailmentWindows = identifyWindows(smoothedSchedule, 'CURTAILED');

  // Always-on comparison
  const alwaysOnNet = alwaysOnRevenue - alwaysOnCost;
  const optimizedNet = optimizedRevenue - optimizedCost;
  const comparedToAlwaysOn = {
    alwaysOnNetRevenue: alwaysOnNet,
    optimizedNetRevenue: optimizedNet,
    savings: optimizedNet - alwaysOnNet,
    savingsPercent: alwaysOnNet !== 0 ? ((optimizedNet - alwaysOnNet) / Math.abs(alwaysOnNet)) * 100 : 0,
  };

  // Build per-model Gantt summary: how many hours each model mines
  const modelSchedule = Object.entries(modelGantt).map(([modelId, hours]) => {
    const miningH = hours.filter(h => h.action === 'MINE').length;
    const entry = config.entries.find(e => (e.asicModel.id || e.asicModel.model) === modelId);
    return {
      modelId,
      model: entry?.asicModel?.model || modelId,
      efficiency: entry?.asicModel?.efficiency || 0,
      quantity: entry?.quantity || 0,
      miningHours: miningH,
      curtailedHours: 24 - miningH,
      schedule: hours,
    };
  }).sort((a, b) => a.efficiency - b.efficiency); // Best efficiency first for Gantt

  return {
    hasFleet: true,
    timestamp: new Date().toISOString(),
    date: opts.date || getNextDay(),
    node,
    schedule: smoothedSchedule,
    modelSchedule,
    summary: {
      miningHours: totalMiningHours,
      curtailedHours: 24 - totalMiningHours,
      estimatedRevenue: optimizedRevenue,
      estimatedCost: optimizedCost,
      estimatedNetRevenue: optimizedNet,
      estimatedSavings: curtailmentSavings,
      avgPriceMWh: dayAheadData.dailyAvg || (dayAheadData.dayAheadPrices.reduce((s, h) => s + h.lmp, 0) / dayAheadData.dayAheadPrices.length),
      minPriceMWh: Math.min(...dayAheadData.dayAheadPrices.map(h => h.lmp)),
      maxPriceMWh: Math.max(...dayAheadData.dayAheadPrices.map(h => h.lmp)),
    },
    comparedToAlwaysOn,
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
 * Apply minimum duration constraints for both curtailment and mining windows.
 * Accounts for ramp-up time by requiring mining windows >= rampUpMinutes.
 */
function applyDurationConstraints(schedule, constraints) {
  const minCurtailHours = Math.ceil((constraints.minCurtailmentMinutes || 0) / 60);
  const minRunHours = Math.ceil((constraints.minRunDurationMinutes || 0) / 60);
  const rampUpHours = Math.ceil((constraints.rampUpMinutes || 0) / 60);
  // Mining windows must be at least rampUpHours + minRunHours
  const effectiveMinRunHours = Math.max(minRunHours, rampUpHours);

  if (minCurtailHours <= 1 && effectiveMinRunHours <= 1) return schedule;

  const result = schedule.map(h => ({ ...h }));

  // Pass 1: collapse short curtailment windows
  if (minCurtailHours > 1) {
    let i = 0;
    while (i < result.length) {
      if (result[i].state !== 'MINING') {
        let j = i;
        while (j < result.length && result[j].state !== 'MINING') j++;
        if (j - i < minCurtailHours && j - i > 0) {
          for (let k = i; k < j; k++) {
            result[k].state = 'MINING';
            result[k].note = `Below min curtailment duration (${constraints.minCurtailmentMinutes}min) — mining maintained`;
          }
        }
        i = j;
      } else {
        i++;
      }
    }
  }

  // Pass 2: collapse short mining windows (don't restart just for 1 hour)
  if (effectiveMinRunHours > 1) {
    let i = 0;
    while (i < result.length) {
      if (result[i].state === 'MINING') {
        let j = i;
        while (j < result.length && result[j].state === 'MINING') j++;
        if (j - i < effectiveMinRunHours && j - i > 0 && i > 0) {
          // Short mining window surrounded by curtailment — stay curtailed
          for (let k = i; k < j; k++) {
            result[k].state = 'CURTAILED';
            result[k].note = `Below min run duration (${effectiveMinRunHours}h incl. ramp-up) — curtailment maintained`;
          }
        }
        i = j;
      } else {
        i++;
      }
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

// ─── Next State Change Prediction ──────────────────────────────────────────

/**
 * Predict when the next state change will occur using DAM data.
 * Looks at the schedule to find when the fleet transitions.
 */
function predictNextStateChange(decisions, constraints, hysteresis) {
  try {
    const node = getDefaultNode();
    const damData = getDayAheadPrices(node);
    if (!damData?.dayAheadPrices) return null;

    const currentHour = new Date().getHours();
    const currentAllMining = decisions.every(d => d.action === 'MINE');
    const currentAllCurtailed = decisions.every(d => d.action === 'CURTAIL');

    // Scan future hours for a state change
    for (const hourData of damData.dayAheadPrices) {
      if (hourData.hour <= currentHour) continue;
      const futurePriceMWh = hourData.lmp;

      // Check if any decision would flip
      let wouldChange = false;
      let newState = null;
      for (const d of decisions) {
        const halfBand = hysteresis / 2;
        if (d.action === 'MINE' && futurePriceMWh > d.breakevenMWh + halfBand) {
          wouldChange = true;
        }
        if (d.action === 'CURTAIL' && futurePriceMWh < d.breakevenMWh - halfBand) {
          wouldChange = true;
        }
      }

      if (wouldChange) {
        const today = new Date().toISOString().split('T')[0];
        return {
          estimatedHour: hourData.hour,
          estimatedTime: `${today}T${String(hourData.hour).padStart(2, '0')}:00:00`,
          expectedPrice: futurePriceMWh,
          trigger: `DAM price ${futurePriceMWh > decisions[0]?.currentPriceMWh ? 'rises to' : 'drops to'} $${futurePriceMWh.toFixed(0)}/MWh at ${hourData.hour}:00`,
        };
      }
    }

    return null; // No state change predicted in remaining DAM window
  } catch (e) {
    return null;
  }
}

// ─── Performance Analysis ──────────────────────────────────────────────────

/**
 * Analyze curtailment performance over a given period.
 * Compares actual savings with breakdown by type.
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
      savingsByType: { avoided_losses: 0, demand_response: 0, spike_avoidance: 0 },
      savingsByTrigger: {},
      dailySavings: [],
    };
  }

  let totalSavings = 0;
  let totalCurtailedMinutes = 0;
  const savingsByTrigger = {};
  const savingsByType = { avoided_losses: 0, demand_response: 0, spike_avoidance: 0 };
  const dailyMap = {};

  for (const event of events) {
    const savings = event.estimated_savings || 0;
    totalSavings += savings;

    const durationMin = event.duration_minutes || 0;
    totalCurtailedMinutes += durationMin;

    // By trigger type
    const trigger = event.trigger_type || 'manual';
    savingsByTrigger[trigger] = (savingsByTrigger[trigger] || 0) + savings;

    // By savings source type
    const priceMWh = event.energy_price_mwh || 0;
    if (priceMWh > 100) {
      savingsByType.spike_avoidance += savings;
    } else if (trigger === 'demand_response') {
      savingsByType.demand_response += savings;
    } else {
      savingsByType.avoided_losses += savings;
    }

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
    savingsByTrigger,
    dailySavings: Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date)),
  };
}

// ─── Backtesting Engine ────────────────────────────────────────────────────

/**
 * Backtest a curtailment strategy against historical data.
 * Returns daily AND monthly breakdown with always-on comparison.
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

  const networkData = await fetchNetworkData();
  const networkHashprice = calculateNetworkHashprice(networkData);
  const constraints = getCurtailmentConstraints(config);
  const hysteresis = constraints.hysteresisBandMWh ?? DEFAULT_HYSTERESIS_BAND_MWH;

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
  let totalAvgMiningPrice = 0;
  let totalAvgCurtailedPrice = 0;
  let miningPricePoints = 0;
  let curtailPricePoints = 0;

  for (const [date, prices] of Object.entries(pricesByDate)) {
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
        dayAlwaysMineRev += (machResult.netRevenue * entry.quantity) / 24;
      }

      // Strategy evaluation
      const meritOrder = buildMeritOrder(config.entries, priceKWh, networkHashprice);

      for (const entry of meritOrder) {
        const shouldMine = evaluateStrategy(strategy, entry, priceMWh, params, hysteresis);

        if (shouldMine) {
          dayStrategyRev += (entry.machineResult.netRevenue * entry.quantity) / 24;
          dayMiningHours += 1 / config.entries.length;
          totalAvgMiningPrice += priceMWh;
          miningPricePoints++;
        } else {
          dayCurtailedHours += 1 / config.entries.length;
          totalAvgCurtailedPrice += priceMWh;
          curtailPricePoints++;
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

  // Monthly breakdown
  const monthlyMap = {};
  for (const day of dailyResults) {
    const month = day.date.substring(0, 7); // YYYY-MM
    if (!monthlyMap[month]) {
      monthlyMap[month] = { month, alwaysMine: 0, optimized: 0, savings: 0, days: 0 };
    }
    monthlyMap[month].alwaysMine += day.alwaysMineRevenue;
    monthlyMap[month].optimized += day.strategyRevenue;
    monthlyMap[month].savings += day.improvement;
    monthlyMap[month].days += 1;
  }
  const monthlyBreakdown = Object.values(monthlyMap).sort((a, b) => a.month.localeCompare(b.month));

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
      avgMiningEnergyPrice: miningPricePoints > 0 ? totalAvgMiningPrice / miningPricePoints : 0,
      avgCurtailedEnergyPrice: curtailPricePoints > 0 ? totalAvgCurtailedPrice / curtailPricePoints : 0,
    },
    dailyResults,
    monthlyBreakdown,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Evaluate whether a machine class should mine under a given strategy.
 */
function evaluateStrategy(strategy, entry, priceMWh, params, hysteresis) {
  const halfBand = hysteresis / 2;
  switch (strategy) {
    case 'peeling':
      return priceMWh < (entry.breakevenMWh - halfBand);
    case 'all_or_nothing':
      return priceMWh < entry.breakevenMWh;
    case 'threshold': {
      const threshold = params.thresholdMWh ?? 50;
      return priceMWh < threshold;
    }
    case 'aggressive':
      return priceMWh < (entry.breakevenMWh - hysteresis);
    default:
      return entry.machineResult.isProfitable;
  }
}

// ─── Demand Response Integration ───────────────────────────────────────────

/**
 * Check Phase 2 grid status and return DR premium if active.
 * Returns $/MWh payment rate for curtailing during grid stress events.
 */
function getDemandResponsePremium(constraints) {
  if (!constraints.demandResponseEnabled) return 0;
  const paymentRate = constraints.demandResponsePaymentRate ?? 0;

  // Check grid status from Phase 2
  const status = getGridStatus();
  if (status === 'emergency' || status === 'warning') {
    return paymentRate > 0 ? paymentRate : 50; // Default $50/MWh DR premium
  }

  return 0;
}

/**
 * Get current grid status from Phase 2 grid events.
 */
function getGridStatus() {
  try {
    const events = getGridEvents('ERCOT', 1); // last 1 day
    const activeEvents = events.filter(e => !e.resolved_at);
    if (activeEvents.some(e => e.event_type?.startsWith('eea'))) return 'emergency';
    if (activeEvents.some(e => e.event_type === 'watch' || e.event_type === 'conservation_appeal')) return 'warning';
    return 'normal';
  } catch (e) {
    return 'normal';
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Get current real-time energy price in $/MWh from Phase 2 cache.
 */
function getCurrentEnergyPriceMWh() {
  const defaultNode = getDefaultNode();
  const iso = 'ERCOT';

  const cacheKey = `energy-rt-${iso}-${defaultNode}`;
  const cached = getCache(cacheKey);
  if (cached?.data?.realTimePrice?.lmp !== undefined) {
    return cached.data.realTimePrice.lmp;
  }

  const rtCache = getCache('energy-realtime-prices');
  if (rtCache?.data?.[defaultNode] !== undefined) {
    return rtCache.data[defaultNode];
  }

  // Fallback: use fleet default energy cost converted to $/MWh
  const config = getFleetConfig();
  const defaultKWh = config?.defaultEnergyCostKWh || 0.05;
  return defaultKWh * 1000;
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

  const today = new Date().toISOString().split('T')[0];
  const todayCache = getCache(`energy-da-${iso}-${node}-${today}`);
  if (todayCache?.data) return todayCache.data;

  return generateMockDayAheadPrices();
}

/**
 * Generate mock day-ahead prices for when real data isn't available.
 */
function generateMockDayAheadPrices() {
  const prices = [];
  const basePattern = [
    22, 20, 18, 17, 18, 22, 30, 42,
    52, 58, 55, 50, 48, 55, 65, 80,
    95, 85, 60, 45, 35, 30, 28, 25,
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
    minRunDurationMinutes: userConstraints.minRunDurationMinutes ?? 30,
    rampUpMinutes: userConstraints.rampUpMinutes ?? 15,
    demandResponseEnabled: userConstraints.demandResponseEnabled ?? false,
    demandResponsePaymentRate: userConstraints.demandResponsePaymentRate ?? 0,
    demandResponsePrograms: userConstraints.demandResponsePrograms ?? [],
    minimumTakePercent: userConstraints.minimumTakePercent ?? 0,
    maxCurtailmentPercent: userConstraints.maxCurtailmentPercent ?? 100,
    hysteresisBandMWh: userConstraints.hysteresisBandMWh ?? DEFAULT_HYSTERESIS_BAND_MWH,
    curtailmentMode: userConstraints.curtailmentMode ?? 'copilot',
    alwaysMineBelow: userConstraints.alwaysMineBelow ?? null,
    alwaysCurtailAbove: userConstraints.alwaysCurtailAbove ?? null,
    poolMinHashrateTH: userConstraints.poolMinHashrateTH ?? null,
    autoSchedule: userConstraints.autoSchedule ?? false,
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
