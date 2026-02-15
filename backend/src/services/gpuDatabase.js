/**
 * GPU Model Database — Phase 7: HPC / AI Compute Abstraction Layer
 *
 * Pre-populated specifications for datacenter-grade GPU accelerators used in
 * AI training, inference, and HPC workloads. Provides fleet power/performance
 * calculations and unified revenue metrics for the workload abstraction layer.
 */

// ─── GPU Model Specifications ───────────────────────────────────────────────

export const GPU_MODELS = [
  // NVIDIA Hopper
  {
    id: 'h100-sxm',
    manufacturer: 'NVIDIA',
    model: 'NVIDIA H100 SXM',
    tdpWatts: 700,
    memoryGB: 80,
    memoryType: 'HBM3',
    fp16Tflops: 989,
    fp32Tflops: 494.5,
    generation: 'Hopper',
    computeCapability: '9.0',
    releaseYear: 2023,
  },
  {
    id: 'h100-pcie',
    manufacturer: 'NVIDIA',
    model: 'NVIDIA H100 PCIe',
    tdpWatts: 350,
    memoryGB: 80,
    memoryType: 'HBM3',
    fp16Tflops: 756,
    fp32Tflops: 378,
    generation: 'Hopper',
    computeCapability: '9.0',
    releaseYear: 2023,
  },
  {
    id: 'h200-sxm',
    manufacturer: 'NVIDIA',
    model: 'NVIDIA H200 SXM',
    tdpWatts: 700,
    memoryGB: 141,
    memoryType: 'HBM3e',
    fp16Tflops: 989,
    fp32Tflops: 494.5,
    generation: 'Hopper',
    computeCapability: '9.0',
    releaseYear: 2024,
  },

  // NVIDIA Ampere
  {
    id: 'a100-sxm',
    manufacturer: 'NVIDIA',
    model: 'NVIDIA A100 SXM',
    tdpWatts: 400,
    memoryGB: 80,
    memoryType: 'HBM2e',
    fp16Tflops: 312,
    fp32Tflops: 156,
    generation: 'Ampere',
    computeCapability: '8.0',
    releaseYear: 2020,
  },
  {
    id: 'a100-pcie',
    manufacturer: 'NVIDIA',
    model: 'NVIDIA A100 PCIe',
    tdpWatts: 300,
    memoryGB: 80,
    memoryType: 'HBM2e',
    fp16Tflops: 312,
    fp32Tflops: 156,
    generation: 'Ampere',
    computeCapability: '8.0',
    releaseYear: 2020,
  },

  // NVIDIA Ada Lovelace
  {
    id: 'l40s',
    manufacturer: 'NVIDIA',
    model: 'NVIDIA L40S',
    tdpWatts: 350,
    memoryGB: 48,
    memoryType: 'GDDR6X',
    fp16Tflops: 362,
    fp32Tflops: 181,
    generation: 'Ada Lovelace',
    computeCapability: '8.9',
    releaseYear: 2023,
  },

  // NVIDIA Blackwell
  {
    id: 'b200',
    manufacturer: 'NVIDIA',
    model: 'NVIDIA B200',
    tdpWatts: 1000,
    memoryGB: 192,
    memoryType: 'HBM3e',
    fp16Tflops: 2250,
    fp32Tflops: 1125,
    generation: 'Blackwell',
    computeCapability: '10.0',
    releaseYear: 2025,
  },
  {
    id: 'gb200',
    manufacturer: 'NVIDIA',
    model: 'NVIDIA GB200',
    tdpWatts: 2700,
    memoryGB: 384,
    memoryType: 'HBM3e',
    fp16Tflops: 4500,
    fp32Tflops: 2250,
    generation: 'Blackwell (Grace)',
    computeCapability: '10.0',
    releaseYear: 2025,
  },

  // AMD CDNA 3
  {
    id: 'mi300x',
    manufacturer: 'AMD',
    model: 'AMD MI300X',
    tdpWatts: 750,
    memoryGB: 192,
    memoryType: 'HBM3',
    fp16Tflops: 1307,
    fp32Tflops: 653.5,
    generation: 'CDNA 3',
    computeCapability: null,
    releaseYear: 2024,
  },
  {
    id: 'mi325x',
    manufacturer: 'AMD',
    model: 'AMD MI325X',
    tdpWatts: 750,
    memoryGB: 256,
    memoryType: 'HBM3e',
    fp16Tflops: 1307,
    fp32Tflops: 653.5,
    generation: 'CDNA 3',
    computeCapability: null,
    releaseYear: 2024,
  },
];

// ─── Lookup Functions ───────────────────────────────────────────────────────

/**
 * Return all GPU models in the database.
 */
export function getGpuModels() {
  return GPU_MODELS;
}

/**
 * Get a single GPU model by its id.
 * @param {string} id
 * @returns {object|undefined}
 */
export function getGpuModel(id) {
  return GPU_MODELS.find(m => m.id === id);
}

/**
 * Filter GPU models by manufacturer ('NVIDIA' or 'AMD').
 * @param {string} manufacturer
 * @returns {object[]}
 */
export function getGpuModelsByManufacturer(manufacturer) {
  return GPU_MODELS.filter(
    m => m.manufacturer.toLowerCase() === manufacturer.toLowerCase()
  );
}

// ─── Fleet Power & Metrics Calculations ─────────────────────────────────────

/**
 * Calculate total power consumption for a GPU fleet in MW.
 *
 * Each entry in the array describes a cluster of servers:
 *   { gpuModelId, quantity, gpusPerServer, serverOverheadWatts, pue }
 *
 * - GPU power = model TDP * quantity
 * - Server overhead = (quantity / gpusPerServer) * serverOverheadWatts
 * - Total = (GPU power + server overhead) * PUE
 *
 * @param {Array<{gpuModelId: string, quantity: number, gpusPerServer?: number, serverOverheadWatts?: number, pue?: number}>} entries
 * @returns {number} Total fleet power in MW
 */
export function calculateGpuFleetPower(entries) {
  let totalWatts = 0;

  for (const entry of entries) {
    const model = getGpuModel(entry.gpuModelId);
    if (!model) continue;

    const quantity = entry.quantity || 0;
    const gpusPerServer = entry.gpusPerServer || 8;
    const serverOverheadWatts = entry.serverOverheadWatts || 0;
    const pue = entry.pue || 1.0;

    const gpuPowerW = model.tdpWatts * quantity;
    const serverCount = Math.ceil(quantity / gpusPerServer);
    const overheadW = serverCount * serverOverheadWatts;

    totalWatts += (gpuPowerW + overheadW) * pue;
  }

  return totalWatts / 1_000_000; // Convert W to MW
}

/**
 * Calculate comprehensive fleet metrics: total GPUs, total power (MW),
 * and total accelerator memory (TB).
 *
 * @param {Array<{gpuModelId: string, quantity: number, gpusPerServer?: number, serverOverheadWatts?: number, pue?: number}>} entries
 * @returns {{ totalGPUs: number, totalPowerMW: number, totalMemoryTB: number }}
 */
export function calculateGpuFleetMetrics(entries) {
  let totalGPUs = 0;
  let totalPowerWatts = 0;
  let totalMemoryGB = 0;

  for (const entry of entries) {
    const model = getGpuModel(entry.gpuModelId);
    if (!model) continue;

    const quantity = entry.quantity || 0;
    const gpusPerServer = entry.gpusPerServer || 8;
    const serverOverheadWatts = entry.serverOverheadWatts || 0;
    const pue = entry.pue || 1.0;

    totalGPUs += quantity;
    totalMemoryGB += model.memoryGB * quantity;

    const gpuPowerW = model.tdpWatts * quantity;
    const serverCount = Math.ceil(quantity / gpusPerServer);
    const overheadW = serverCount * serverOverheadWatts;

    totalPowerWatts += (gpuPowerW + overheadW) * pue;
  }

  return {
    totalGPUs,
    totalPowerMW: totalPowerWatts / 1_000_000,
    totalMemoryTB: totalMemoryGB / 1024,
  };
}

// ─── Revenue Rate Calculation ───────────────────────────────────────────────

/**
 * Calculate unified revenue metrics for a compute workload.
 *
 * The workload object describes an HPC/AI compute workload:
 *   {
 *     type: 'hpc_reserved' | 'hpc_interruptible' | 'hpc_spot' | ...,
 *     contracts: [{ ratePerGpuHr, gpuCount, uptimeSLA, monthlyRevenue }],
 *     fleet: [{ gpuModelId, quantity, gpusPerServer, serverOverheadWatts, pue }],
 *     powerAllocationMW: number  // allocated site power
 *   }
 *
 * @param {object} workload
 * @param {number} energyPriceMWh - Energy cost in $/MWh
 * @returns {{ grossRevenuePerMW: number, energyCostPerMW: number, netRevenuePerMW: number, profitMargin: number, revenuePerGPUHour: number, utilizationRate: number }}
 */
export function getComputeRevenueRate(workload, energyPriceMWh) {
  const contracts = workload.contracts || [];
  const fleet = workload.fleet || [];
  const powerAllocationMW = workload.powerAllocationMW || 0;

  // Aggregate contract revenue (daily)
  let totalGpuHoursPerDay = 0;
  let totalGrossRevenuePerDay = 0;
  let totalContractGpus = 0;
  let weightedUtilization = 0;

  for (const contract of contracts) {
    const gpuCount = contract.gpuCount || 0;
    const ratePerGpuHr = contract.ratePerGpuHr || 0;
    const uptimeSla = contract.uptimeSLA || 99.0;

    // Expected utilization based on SLA (reserved contracts run near 100%)
    const utilization = Math.min(uptimeSla / 100, 1);
    const gpuHoursPerDay = gpuCount * 24 * utilization;

    totalGpuHoursPerDay += gpuHoursPerDay;
    totalGrossRevenuePerDay += gpuHoursPerDay * ratePerGpuHr;
    totalContractGpus += gpuCount;
    weightedUtilization += gpuCount * utilization;
  }

  // Fleet power metrics
  const fleetMetrics = calculateGpuFleetMetrics(fleet);
  const fleetPowerMW = fleetMetrics.totalPowerMW || powerAllocationMW;
  const effectivePowerMW = fleetPowerMW > 0 ? fleetPowerMW : powerAllocationMW;

  // Energy cost per day for the fleet
  const energyCostPerDay = effectivePowerMW * energyPriceMWh * 24; // MW * $/MWh * hours

  // Revenue per MW per day
  const grossRevenuePerMW = effectivePowerMW > 0
    ? totalGrossRevenuePerDay / effectivePowerMW
    : 0;

  const energyCostPerMW = effectivePowerMW > 0
    ? energyCostPerDay / effectivePowerMW
    : energyPriceMWh * 24;

  const netRevenuePerMW = grossRevenuePerMW - energyCostPerMW;
  const profitMargin = grossRevenuePerMW > 0
    ? (netRevenuePerMW / grossRevenuePerMW) * 100
    : 0;

  // Average revenue per GPU-hour across all contracts
  const revenuePerGPUHour = totalGpuHoursPerDay > 0
    ? totalGrossRevenuePerDay / totalGpuHoursPerDay
    : 0;

  // Utilization: contracted GPUs vs total fleet GPUs
  const totalFleetGpus = fleetMetrics.totalGPUs || totalContractGpus;
  const utilizationRate = totalFleetGpus > 0
    ? Math.min((weightedUtilization / totalFleetGpus) * 100, 100)
    : 0;

  return {
    grossRevenuePerMW,   // $/MW/day
    energyCostPerMW,     // $/MW/day
    netRevenuePerMW,     // $/MW/day
    profitMargin,        // percentage
    revenuePerGPUHour,   // $/GPU-hour (weighted average)
    utilizationRate,     // percentage
  };
}

export default {
  GPU_MODELS,
  getGpuModels,
  getGpuModel,
  getGpuModelsByManufacturer,
  calculateGpuFleetPower,
  calculateGpuFleetMetrics,
  getComputeRevenueRate,
};
