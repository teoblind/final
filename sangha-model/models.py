"""
Sangha MineOS — Phase 9: SanghaModel Pydantic Models

Defines the full API contract for the SanghaModel risk-assessment
microservice, covering miner profiles, simulation parameters,
risk outputs, calibration ingestion, network state, and scenarios.
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Miner Profile (input)
# ---------------------------------------------------------------------------

class FleetEntry(BaseModel):
    model: str = Field(..., description="Hardware model name, e.g. 'S21 XP'")
    count: int = Field(..., ge=1, description="Number of units of this model")
    hashrateTH: float = Field(..., gt=0, description="Per-unit hashrate in TH/s")
    efficiencyJTH: float = Field(..., gt=0, description="Efficiency in J/TH")
    age_months: int = Field(0, ge=0, description="Average age of units in months")


class EnergyProfile(BaseModel):
    avg_cost_kwh: float = Field(..., gt=0, description="Blended average energy cost in $/kWh")
    iso: str = Field("ERCOT", description="ISO / grid region")
    ppa_pct: float = Field(0.0, ge=0, le=100, description="Percentage of load under PPA")
    curtailment_participation: bool = Field(False, description="Whether operator participates in curtailment programs")


class CurtailmentProfile(BaseModel):
    hours_per_month: float = Field(0, ge=0, description="Average curtailment hours per month")
    price_threshold: float = Field(100.0, ge=0, description="Energy price threshold for curtailment ($/MWh)")
    dr_participation: bool = Field(False, description="Participates in demand-response programs")


class PerformanceData(BaseModel):
    uptime_pct: float = Field(95.0, ge=0, le=100, description="Fleet uptime percentage")
    effective_hashrate_pct: float = Field(98.0, ge=0, le=100, description="Effective vs. nameplate hashrate percentage")


class PoolProfile(BaseModel):
    pool_name: str = Field("default", description="Mining pool name")
    fee_pct: float = Field(2.0, ge=0, le=100, description="Pool fee percentage")
    payout_method: str = Field("FPPS", description="Payout method (FPPS, PPS+, PPLNS, etc.)")


class MinerProfile(BaseModel):
    fleet: List[FleetEntry] = Field(..., min_length=1, description="List of fleet entries")
    energyProfile: EnergyProfile
    curtailmentProfile: CurtailmentProfile = Field(default_factory=CurtailmentProfile)
    performanceData: PerformanceData = Field(default_factory=PerformanceData)
    poolProfile: PoolProfile = Field(default_factory=PoolProfile)


# ---------------------------------------------------------------------------
# Simulation Parameters
# ---------------------------------------------------------------------------

class BtcPriceModel(str, Enum):
    lognormal = "lognormal"
    gbm = "gbm"
    mean_revert = "mean_revert"


class DifficultyModel(str, Enum):
    linear = "linear"
    log_growth = "log_growth"
    s_curve = "s_curve"


class SimulationParams(BaseModel):
    horizonMonths: int = Field(12, ge=1, le=60, description="Projection horizon in months")
    numSimulations: int = Field(10000, ge=100, le=100000, description="Number of Monte Carlo paths")
    btcPriceModel: BtcPriceModel = Field(BtcPriceModel.lognormal, description="BTC price model to use")
    difficultyModel: DifficultyModel = Field(DifficultyModel.log_growth, description="Difficulty growth model")


# ---------------------------------------------------------------------------
# Risk Assessment (output)
# ---------------------------------------------------------------------------

class HashpricePercentiles(BaseModel):
    p10: float
    p25: float
    p50: float
    p75: float
    p90: float


class FloorSuggestions(BaseModel):
    conservative: float = Field(..., description="Conservative floor (p25 of distribution)")
    moderate: float = Field(..., description="Moderate floor (p40 of distribution)")
    aggressive: float = Field(..., description="Aggressive floor (p50 of distribution)")


class InsuranceInputs(BaseModel):
    indicative_premium_conservative: float
    indicative_premium_moderate: float
    indicative_premium_aggressive: float
    notional_hashrate_PH: float
    term_months: int
    risk_score: float


class RevenueProjection(BaseModel):
    month: int
    revenue_usd_p10: float
    revenue_usd_p50: float
    revenue_usd_p90: float
    cost_usd: float
    profit_usd_p50: float


class RiskAssessment(BaseModel):
    riskScore: float = Field(..., ge=0, le=100, description="Composite risk score 0-100")
    probBelowBreakeven12m: float = Field(..., ge=0, le=1, description="Probability of being below breakeven within horizon")
    hashpriceDistributions: List[HashpricePercentiles] = Field(..., description="Per-month hashprice percentile distributions")
    revenueProjections: List[RevenueProjection] = Field(..., description="Per-month revenue projections")
    suggestedFloors: FloorSuggestions
    insuranceInputs: InsuranceInputs


# ---------------------------------------------------------------------------
# Calibration (input from MineOS telemetry)
# ---------------------------------------------------------------------------

class FleetAggregate(BaseModel):
    model: str
    total_units: int
    avg_hashrate_TH: float
    avg_efficiency_JTH: float
    avg_uptime_pct: float


class CurtailmentBehavior(BaseModel):
    avg_curtailment_hours: float
    avg_price_threshold: float
    dr_participation_rate: float


class EnergyProfileAggregate(BaseModel):
    avg_cost_kwh: float
    iso_distribution: Dict[str, float] = Field(default_factory=dict)
    ppa_pct_avg: float = Field(0.0)


class MinerEntryExit(BaseModel):
    new_miners_30d: int = Field(0)
    exited_miners_30d: int = Field(0)
    net_hashrate_change_pct: float = Field(0.0)


class CalibrationPayload(BaseModel):
    fleetAggregates: List[FleetAggregate] = Field(default_factory=list)
    curtailmentBehavior: CurtailmentBehavior = Field(default_factory=lambda: CurtailmentBehavior(
        avg_curtailment_hours=0, avg_price_threshold=100, dr_participation_rate=0
    ))
    energyProfiles: EnergyProfileAggregate = Field(default_factory=lambda: EnergyProfileAggregate(avg_cost_kwh=0.05))
    minerEntryExit: MinerEntryExit = Field(default_factory=MinerEntryExit)


# ---------------------------------------------------------------------------
# Network State
# ---------------------------------------------------------------------------

class NetworkState(BaseModel):
    totalHashrateEH: float = Field(..., description="Total network hashrate in EH/s")
    difficulty: float = Field(..., description="Current mining difficulty")
    avgBlockTime: float = Field(..., description="Average block time in seconds")
    avgEfficiency: float = Field(..., description="Network-average efficiency in J/TH")
    estimatedActiveMiners: int = Field(..., description="Estimated number of active mining operations")


# ---------------------------------------------------------------------------
# Scenario Analysis
# ---------------------------------------------------------------------------

class ScenarioType(str, Enum):
    btc_crash = "btc_crash"
    difficulty_spike = "difficulty_spike"
    energy_spike = "energy_spike"
    halving = "halving"
    hashrate_drop = "hashrate_drop"
    regulatory = "regulatory"
    custom = "custom"


class ScenarioRequest(BaseModel):
    scenarioType: ScenarioType
    params: Dict[str, Any] = Field(default_factory=dict, description="Scenario-specific parameters")
    profile: Optional[MinerProfile] = Field(None, description="Optional miner profile for scenario context")


class ScenarioResult(BaseModel):
    scenarioType: ScenarioType
    baselineRevenue: float = Field(..., description="Baseline monthly revenue in USD")
    scenarioRevenue: float = Field(..., description="Revenue under scenario in USD")
    impact_pct: float = Field(..., description="Percentage impact on revenue")
    details: Dict[str, Any] = Field(default_factory=dict, description="Scenario-specific detail breakdown")


# ---------------------------------------------------------------------------
# API Envelope Models
# ---------------------------------------------------------------------------

class FullAssessmentRequest(BaseModel):
    profile: MinerProfile
    params: SimulationParams = Field(default_factory=SimulationParams)


class JobAccepted(BaseModel):
    job_id: str
    status: str = "accepted"
    message: str = "Simulation job queued. Poll GET /v1/risk-assessment/{job_id} for results."


class HealthResponse(BaseModel):
    status: str = "ok"
    service: str = "sangha-model"
    model_version: str
    uptime: float = Field(..., description="Uptime in seconds")


class ErrorResponse(BaseModel):
    detail: str
