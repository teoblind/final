/**
 * Hashprice Engine — Core calculation engine for fleet-aware mining profitability.
 *
 * Computes hashprice at three levels:
 *   1. Network-level (what the existing macro panel shows)
 *   2. Fleet-level (weighted average across all machines)
 *   3. Machine-level (per ASIC model profitability)
 *
 * Designed as a pure calculation module that Phase 4 (Curtailment) can consume
 * programmatically — no Express/HTTP dependencies.
 */

import axios from 'axios';
import { getCache, setCache } from '../cache/database.js';
import { ASIC_DATABASE } from './asicDatabase.js';

const BLOCKS_PER_DAY = 144;
const BLOCK_REWARD = 3.125; // Post April 2024 halving
const SATS_PER_BTC = 100_000_000;

// ─── Network Data Fetching ──────────────────────────────────────────────────

/**
 * Fetch current network data (hashrate, difficulty, fees, mempool).
 * Uses cache with 10-minute TTL since network hashrate updates slowly.
 */
export async function fetchNetworkData() {
  const cacheKey = 'fleet-network-data';
  const cached = getCache(cacheKey);
  if (cached && !cached.stale) {
    return { ...cached.data, cached: true };
  }

  try {
    // Fetch in parallel: BTC price, network hashrate, difficulty, mempool fees
    const [priceRes, hashrateRes, difficultyRes, mempoolRes, blockCountRes] = await Promise.allSettled([
      axios.get('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true', { timeout: 10000 }),
      axios.get('https://blockchain.info/q/hashrate', { timeout: 10000 }),
      axios.get('https://blockchain.info/q/getdifficulty', { timeout: 10000 }),
      axios.get('https://mempool.space/api/v1/fees/recommended', { timeout: 10000 }),
      axios.get('https://blockchain.info/q/getblockcount', { timeout: 10000 }),
    ]);

    const btcPrice = priceRes.status === 'fulfilled' ? priceRes.value.data.bitcoin.usd : null;
    const btcChange24h = priceRes.status === 'fulfilled' ? priceRes.value.data.bitcoin.usd_24h_change : 0;
    // blockchain.info /q/hashrate returns GH/s
    const networkHashrateGH = hashrateRes.status === 'fulfilled' ? hashrateRes.value.data : null;
    const difficulty = difficultyRes.status === 'fulfilled' ? difficultyRes.value.data : null;
    const mempoolFees = mempoolRes.status === 'fulfilled' ? mempoolRes.value.data : null;
    const blockHeight = blockCountRes.status === 'fulfilled' ? blockCountRes.value.data : null;

    if (!btcPrice || !networkHashrateGH) {
      throw new Error('Failed to fetch critical network data');
    }

    const networkHashrateTH = networkHashrateGH / 1000; // GH/s → TH/s
    const networkHashrateEH = networkHashrateGH / 1e9;  // GH/s → EH/s

    // Difficulty adjustment calculation
    const DIFFICULTY_PERIOD = 2016;
    const blocksIntoEpoch = blockHeight ? blockHeight % DIFFICULTY_PERIOD : 0;
    const blocksUntilAdjustment = DIFFICULTY_PERIOD - blocksIntoEpoch;
    // Estimate time: 10 min per block average
    const estimatedDaysUntilAdjustment = (blocksUntilAdjustment * 10) / (60 * 24);

    // Estimate next difficulty: ratio of actual vs expected time for blocks mined so far
    // If blocks are being found faster than 10 min, difficulty goes up
    // Rough estimate: use hashrate growth as proxy
    const estimatedAdjustmentPercent = 0; // We'll refine this from historical data

    // Average transaction fees — use approximate 0.5 BTC/block as baseline
    // This is the same approximation used in the existing hashprice route
    const avgFeesPerBlock = 0.5;

    const data = {
      timestamp: new Date().toISOString(),
      btcPrice,
      btcChange24h,
      networkHashrateTH,
      networkHashrateEH,
      difficulty: difficulty || 0,
      blockReward: BLOCK_REWARD,
      avgFeesPerBlock,
      blockHeight: blockHeight || 0,
      blocksUntilAdjustment,
      estimatedDaysUntilAdjustment,
      estimatedNextDifficulty: difficulty ? difficulty * (1 + estimatedAdjustmentPercent / 100) : 0,
      estimatedAdjustmentPercent,
      mempoolFeeRate: mempoolFees ? {
        fastest: mempoolFees.fastestFee,
        halfHour: mempoolFees.halfHourFee,
        hour: mempoolFees.hourFee,
        economy: mempoolFees.economyFee,
      } : null,
      source: 'CoinGecko + Blockchain.info + Mempool.space',
      isMock: false,
    };

    setCache(cacheKey, data, 10); // 10 minute cache
    return data;

  } catch (error) {
    console.error('Error fetching network data:', error.message);
    // Return cached data even if stale
    if (cached) {
      return { ...cached.data, cached: true, stale: true };
    }
    // Return mock data as last resort
    return getMockNetworkData();
  }
}

function getMockNetworkData() {
  return {
    timestamp: new Date().toISOString(),
    btcPrice: 65000,
    btcChange24h: -1.2,
    networkHashrateTH: 750_000_000, // 750 EH/s in TH/s
    networkHashrateEH: 750,
    difficulty: 110_450_000_000_000,
    blockReward: BLOCK_REWARD,
    avgFeesPerBlock: 0.5,
    blockHeight: 870000,
    blocksUntilAdjustment: 847,
    estimatedDaysUntilAdjustment: 5.9,
    estimatedNextDifficulty: 113_980_000_000_000,
    estimatedAdjustmentPercent: 3.2,
    mempoolFeeRate: { fastest: 25, halfHour: 15, hour: 10, economy: 5 },
    source: 'Mock Data',
    isMock: true,
  };
}

// ─── Core Hashprice Calculations ────────────────────────────────────────────

/**
 * Calculate network-level hashprice ($/TH/s/day)
 */
export function calculateNetworkHashprice(networkData) {
  const { btcPrice, networkHashrateTH, blockReward, avgFeesPerBlock } = networkData;

  // hashprice = (blocks_per_day × (block_reward + avg_fees) × btc_price) / network_hashrate_TH
  const dailyBtcPerTH = (BLOCKS_PER_DAY * (blockReward + avgFeesPerBlock)) / networkHashrateTH;
  const hashprice = dailyBtcPerTH * btcPrice;

  return {
    hashprice,                                        // $/TH/s/day
    btcPerTHPerDay: dailyBtcPerTH,                   // BTC earned per TH/s per day
    blockRewardComponent: (BLOCKS_PER_DAY * blockReward * btcPrice) / networkHashrateTH,
    feeComponent: (BLOCKS_PER_DAY * avgFeesPerBlock * btcPrice) / networkHashrateTH,
    networkHashrate: networkData.networkHashrateEH,
    difficulty: networkData.difficulty,
    btcPrice,
  };
}

/**
 * Calculate per-machine profitability.
 * @param {object} model - ASIC model specs { hashrate (TH/s), powerConsumption (W), efficiency (J/TH) }
 * @param {number} energyCostPerKWh - Electricity cost in $/kWh
 * @param {object} networkHashprice - Output from calculateNetworkHashprice()
 */
export function calculateMachineHashprice(model, energyCostPerKWh, networkHashprice) {
  const { hashprice: networkHP, btcPerTHPerDay } = networkHashprice;

  // Gross revenue per unit per day
  const grossRevenue = networkHP * model.hashrate;

  // Electricity cost per unit per day
  // Power (W) → kW, × 24 hours × $/kWh
  const electricityCost = (model.powerConsumption / 1000) * 24 * energyCostPerKWh;

  // Net revenue (profit or loss)
  const netRevenue = grossRevenue - electricityCost;

  // Breakeven electricity: the $/kWh at which revenue = cost
  // grossRevenue = (power_kW × 24 × breakeven_rate)
  // breakeven_rate = grossRevenue / (power_kW × 24)
  const breakEvenElectricity = grossRevenue / ((model.powerConsumption / 1000) * 24);

  return {
    model: {
      id: model.id,
      manufacturer: model.manufacturer,
      model: model.model,
      hashrate: model.hashrate,
      powerConsumption: model.powerConsumption,
      efficiency: model.efficiency,
    },
    grossRevenue,
    electricityCost,
    netRevenue,
    profitMargin: grossRevenue > 0 ? ((netRevenue / grossRevenue) * 100) : -100,
    breakEvenElectricity,
    isProfitable: netRevenue > 0,
    dailyBTCEarned: btcPerTHPerDay * model.hashrate,
  };
}

/**
 * Calculate fleet-level profitability across all machine classes.
 * @param {Array} fleetEntries - Array of { asicModel, quantity, overclockProfile?, energyNode? }
 * @param {number} defaultEnergyCostPerKWh - Default $/kWh (used when no node-specific price)
 * @param {object} networkHashprice - Output from calculateNetworkHashprice()
 * @param {object} nodePrices - Optional map of { node: $/MWh } from Phase 2 energy data
 */
export function calculateFleetHashprice(fleetEntries, defaultEnergyCostPerKWh, networkHashprice, nodePrices = {}) {
  let totalGrossRevenue = 0;
  let totalElectricityCost = 0;
  let profitableMachines = 0;
  let unprofitableMachines = 0;
  let profitableHashrate = 0;
  let totalHashrate = 0;
  let totalPowerW = 0;

  const revenueByModel = fleetEntries.map(entry => {
    // Use overclocked specs if provided
    const specs = entry.overclockProfile ? {
      ...entry.asicModel,
      hashrate: entry.overclockProfile.hashrate,
      powerConsumption: entry.overclockProfile.powerConsumption,
      efficiency: entry.overclockProfile.powerConsumption / entry.overclockProfile.hashrate,
    } : entry.asicModel;

    // Determine energy cost: node-specific ERCOT price or default
    let energyCostPerKWh = defaultEnergyCostPerKWh;
    if (entry.energyNode && nodePrices[entry.energyNode] !== undefined) {
      // ERCOT prices are in $/MWh → convert to $/kWh
      energyCostPerKWh = nodePrices[entry.energyNode] / 1000;
    }

    const machineResult = calculateMachineHashprice(specs, energyCostPerKWh, networkHashprice);

    // Scale by quantity
    const qty = entry.quantity;
    totalGrossRevenue += machineResult.grossRevenue * qty;
    totalElectricityCost += machineResult.electricityCost * qty;
    totalHashrate += specs.hashrate * qty;
    totalPowerW += specs.powerConsumption * qty;

    if (machineResult.isProfitable) {
      profitableMachines += qty;
      profitableHashrate += specs.hashrate * qty;
    } else {
      unprofitableMachines += qty;
    }

    return {
      ...machineResult,
      quantity: qty,
      totalGrossRevenue: machineResult.grossRevenue * qty,
      totalElectricityCost: machineResult.electricityCost * qty,
      totalNetRevenue: machineResult.netRevenue * qty,
      energyCostPerKWh,
      energyNode: entry.energyNode || null,
      location: entry.location || null,
    };
  });

  const totalNetRevenue = totalGrossRevenue - totalElectricityCost;
  const weightedEfficiency = totalHashrate > 0 ? (totalPowerW / totalHashrate) : 0; // W/TH = J/TH

  return {
    totalGrossRevenue,
    totalElectricityCost,
    totalNetRevenue,
    profitMargin: totalGrossRevenue > 0 ? ((totalNetRevenue / totalGrossRevenue) * 100) : -100,
    revenueByModel,
    profitableMachines,
    unprofitableMachines,
    totalHashrate,                    // TH/s
    totalPowerMW: totalPowerW / 1e6,  // MW
    profitableHashrate,               // TH/s
    weightedEfficiency,               // J/TH
  };
}

/**
 * Calculate the breakeven hashprice for a given model at a given energy cost.
 * This is the network hashprice at which this machine breaks even.
 */
export function getBreakevenHashprice(model, energyCostPerKWh) {
  // breakeven hashprice = electricity_cost_per_day / hashrate_TH
  // electricity_cost_per_day = (W / 1000) * 24 * $/kWh
  const dailyElecCost = (model.powerConsumption / 1000) * 24 * energyCostPerKWh;
  return dailyElecCost / model.hashrate;
}

/**
 * Project hashprice under different scenarios.
 * @param {object} networkData - Current network data
 * @param {object} params - Scenario parameters
 */
export function projectHashprice(networkData, params = {}) {
  const {
    btcPriceMultiplier = 1.0,
    difficultyMultiplier = 1.0,
    customFeeRate = null,
  } = params;

  const adjustedBtcPrice = networkData.btcPrice * btcPriceMultiplier;
  const adjustedDifficulty = networkData.difficulty * difficultyMultiplier;

  // Hashrate roughly scales with difficulty (simplified)
  const adjustedHashrateTH = networkData.networkHashrateTH * difficultyMultiplier;

  const adjustedNetwork = {
    ...networkData,
    btcPrice: adjustedBtcPrice,
    difficulty: adjustedDifficulty,
    networkHashrateTH: adjustedHashrateTH,
    networkHashrateEH: adjustedHashrateTH / 1e6,
    avgFeesPerBlock: customFeeRate !== null ? customFeeRate : networkData.avgFeesPerBlock,
  };

  return calculateNetworkHashprice(adjustedNetwork);
}

/**
 * Run scenario simulation with fleet modifications.
 */
export function simulateScenario(fleetEntries, defaultEnergyCost, networkData, scenarioParams) {
  const {
    btcPriceMultiplier = 1.0,
    difficultyMultiplier = 1.0,
    electricityPrice = null,
    fleetModifications = [],
  } = scenarioParams;

  // Apply fleet modifications
  let modifiedFleet = [...fleetEntries];
  for (const mod of fleetModifications) {
    const existingIdx = modifiedFleet.findIndex(e => e.asicModel.id === mod.modelId);
    if (existingIdx >= 0) {
      const newQty = modifiedFleet[existingIdx].quantity + mod.quantityDelta;
      if (newQty <= 0) {
        modifiedFleet.splice(existingIdx, 1);
      } else {
        modifiedFleet[existingIdx] = { ...modifiedFleet[existingIdx], quantity: newQty };
      }
    } else if (mod.quantityDelta > 0) {
      const asicModel = ASIC_DATABASE.find(m => m.id === mod.modelId);
      if (asicModel) {
        modifiedFleet.push({ asicModel, quantity: mod.quantityDelta });
      }
    }
  }

  // Project network hashprice with scenario
  const projectedHP = projectHashprice(networkData, {
    btcPriceMultiplier,
    difficultyMultiplier,
  });

  // Calculate fleet profitability under scenario
  const energyCost = electricityPrice !== null ? electricityPrice : defaultEnergyCost;
  const fleetResult = calculateFleetHashprice(modifiedFleet, energyCost, projectedHP);

  return {
    scenario: scenarioParams,
    projectedNetworkHashprice: projectedHP,
    fleetResult,
    adjustedBtcPrice: networkData.btcPrice * btcPriceMultiplier,
    adjustedDifficulty: networkData.difficulty * difficultyMultiplier,
    adjustedElectricity: energyCost,
  };
}

export default {
  fetchNetworkData,
  calculateNetworkHashprice,
  calculateMachineHashprice,
  calculateFleetHashprice,
  getBreakevenHashprice,
  projectHashprice,
  simulateScenario,
};
