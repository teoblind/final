"""
Ampera — Phase 9: SanghaModel Simulation Engine

Monte Carlo simulation for Bitcoin mining revenue projections,
risk scoring, floor suggestions, and scenario analysis.
"""

from __future__ import annotations

import threading
import time
import uuid
from typing import Any, Dict, Optional

import numpy as np

from models import (
    CalibrationPayload,
    FloorSuggestions,
    HashpricePercentiles,
    InsuranceInputs,
    MinerProfile,
    NetworkState,
    RevenueProjection,
    RiskAssessment,
    ScenarioRequest,
    ScenarioResult,
    ScenarioType,
    SimulationParams,
)

# ---------------------------------------------------------------------------
# Constants — realistic Bitcoin mining economics
# ---------------------------------------------------------------------------

CURRENT_HASHPRICE_PH_DAY = 50.0       # $/PH/day baseline
CURRENT_NETWORK_HASHRATE_EH = 750.0   # EH/s
CURRENT_DIFFICULTY = 92.0e12          # ~92 T
CURRENT_AVG_BLOCK_TIME = 600.0        # 10 minutes in seconds
NETWORK_AVG_EFFICIENCY_JTH = 25.0     # J/TH network average
ESTIMATED_ACTIVE_MINERS = 45000       # rough estimate of active operations

BTC_PRICE_USD = 68000.0               # baseline BTC price
BLOCK_REWARD = 3.125                  # post-2024-halving
BLOCKS_PER_DAY = 144

# Hashprice drift & volatility (monthly)
HASHPRICE_MONTHLY_DRIFT = -0.015      # slight negative drift (difficulty growth)
HASHPRICE_MONTHLY_VOL = 0.12          # monthly volatility

# Efficiency benchmarks (J/TH) — lower is better
BEST_EFFICIENCY = 15.0                # S21 XP class
WORST_EFFICIENCY = 60.0               # older S9/S17 class

# ---------------------------------------------------------------------------
# In-memory job store
# ---------------------------------------------------------------------------

_job_store: Dict[str, Dict[str, Any]] = {}
_job_lock = threading.Lock()

# Calibration state (updated via /v1/calibration/ingest)
_calibration_state: Dict[str, Any] = {
    "last_updated": None,
    "network_efficiency_avg": NETWORK_AVG_EFFICIENCY_JTH,
    "network_hashrate_EH": CURRENT_NETWORK_HASHRATE_EH,
    "curtailment_avg_hours": 20.0,
    "energy_cost_avg": 0.05,
}


# ---------------------------------------------------------------------------
# Helper: fleet-level aggregation
# ---------------------------------------------------------------------------

def _aggregate_fleet(profile: MinerProfile) -> Dict[str, float]:
    """Compute fleet-level totals from a MinerProfile."""
    total_hashrate_TH = 0.0
    total_power_W = 0.0
    weighted_efficiency_sum = 0.0
    total_units = 0

    for entry in profile.fleet:
        unit_hashrate = entry.hashrateTH * entry.count
        unit_power = entry.efficiencyJTH * entry.hashrateTH * entry.count  # watts
        total_hashrate_TH += unit_hashrate
        total_power_W += unit_power
        weighted_efficiency_sum += entry.efficiencyJTH * unit_hashrate
        total_units += entry.count

    fleet_efficiency = weighted_efficiency_sum / total_hashrate_TH if total_hashrate_TH > 0 else 30.0
    effective_hashrate_TH = total_hashrate_TH * (profile.performanceData.effective_hashrate_pct / 100.0)
    total_hashrate_PH = effective_hashrate_TH / 1000.0

    # Energy cost per day (kWh)
    power_kw = total_power_W / 1000.0
    uptime_fraction = profile.performanceData.uptime_pct / 100.0
    daily_energy_kwh = power_kw * 24.0 * uptime_fraction
    daily_energy_cost = daily_energy_kwh * profile.energyProfile.avg_cost_kwh

    # Monthly energy cost
    monthly_energy_cost = daily_energy_cost * 30.0

    # Curtailment savings
    curtailment_savings_pct = 0.0
    if profile.curtailmentProfile.dr_participation:
        curtailment_hours = profile.curtailmentProfile.hours_per_month
        # Assume curtailment hours are at premium prices, offset by demand-response credits
        curtailment_savings_pct = min(curtailment_hours / (30.0 * 24.0) * 100.0, 15.0)

    pool_fee = profile.poolProfile.fee_pct / 100.0

    return {
        "total_hashrate_TH": total_hashrate_TH,
        "effective_hashrate_TH": effective_hashrate_TH,
        "total_hashrate_PH": total_hashrate_PH,
        "fleet_efficiency_JTH": fleet_efficiency,
        "daily_energy_cost": daily_energy_cost,
        "monthly_energy_cost": monthly_energy_cost,
        "uptime_fraction": uptime_fraction,
        "curtailment_savings_pct": curtailment_savings_pct,
        "pool_fee": pool_fee,
        "total_units": total_units,
        "power_kw": power_kw,
    }


# ---------------------------------------------------------------------------
# Risk Score Calculation
# ---------------------------------------------------------------------------

def _compute_risk_score(profile: MinerProfile, fleet: Dict[str, float]) -> float:
    """
    Composite risk score (0–100, lower is better).

    Formula:
      risk = 100 - (efficiency_score*0.3 + energy_score*0.25 + uptime_score*0.2
                     + curtailment_score*0.15 + pool_score*0.1)

    Each sub-score is 0–100 where 100 = best.
    """
    # Efficiency score: best=15 J/TH -> 100, worst=60 J/TH -> 0
    eff = fleet["fleet_efficiency_JTH"]
    efficiency_score = max(0.0, min(100.0,
        (WORST_EFFICIENCY - eff) / (WORST_EFFICIENCY - BEST_EFFICIENCY) * 100.0
    ))

    # Energy score: 0.02 $/kWh -> 100, 0.12 $/kWh -> 0
    cost = profile.energyProfile.avg_cost_kwh
    energy_score = max(0.0, min(100.0,
        (0.12 - cost) / (0.12 - 0.02) * 100.0
    ))

    # Uptime score: direct percentage
    uptime_score = profile.performanceData.uptime_pct

    # Curtailment score: participation + reasonable hours
    curtailment_score = 50.0  # baseline
    if profile.curtailmentProfile.dr_participation:
        curtailment_score += 30.0
    if profile.curtailmentProfile.hours_per_month > 10:
        curtailment_score += 10.0
    if profile.energyProfile.curtailment_participation:
        curtailment_score += 10.0
    curtailment_score = min(100.0, curtailment_score)

    # Pool score: lower fees + FPPS preferred
    fee = profile.poolProfile.fee_pct
    pool_score = max(0.0, min(100.0, (5.0 - fee) / 5.0 * 80.0))
    if profile.poolProfile.payout_method.upper() in ("FPPS", "PPS+"):
        pool_score += 20.0
    pool_score = min(100.0, pool_score)

    composite = (
        efficiency_score * 0.30
        + energy_score * 0.25
        + uptime_score * 0.20
        + curtailment_score * 0.15
        + pool_score * 0.10
    )

    risk = 100.0 - composite
    return round(max(0.0, min(100.0, risk)), 2)


# ---------------------------------------------------------------------------
# Monte Carlo Simulation
# ---------------------------------------------------------------------------

def run_monte_carlo(
    profile: MinerProfile,
    params: SimulationParams,
) -> RiskAssessment:
    """
    Full Monte Carlo simulation for hashprice / revenue distributions.

    Uses a lognormal random walk for hashprice evolution, with drift
    adjusted for difficulty growth and BTC price volatility.
    """
    rng = np.random.default_rng()
    fleet = _aggregate_fleet(profile)
    horizon = params.horizonMonths
    n_sims = params.numSimulations

    # --- Choose drift / vol based on price model ---
    if params.btcPriceModel.value == "gbm":
        monthly_drift = HASHPRICE_MONTHLY_DRIFT + 0.005  # slightly more optimistic
        monthly_vol = HASHPRICE_MONTHLY_VOL * 1.1
    elif params.btcPriceModel.value == "mean_revert":
        monthly_drift = HASHPRICE_MONTHLY_DRIFT * 0.5    # slower drift
        monthly_vol = HASHPRICE_MONTHLY_VOL * 0.8
    else:  # lognormal (default)
        monthly_drift = HASHPRICE_MONTHLY_DRIFT
        monthly_vol = HASHPRICE_MONTHLY_VOL

    # Difficulty growth modifier
    if params.difficultyModel.value == "linear":
        diff_factor = 1.0
    elif params.difficultyModel.value == "s_curve":
        diff_factor = 0.8   # growth slowing
    else:  # log_growth (default)
        diff_factor = 1.0

    adjusted_drift = monthly_drift * diff_factor

    # Generate hashprice paths: shape (n_sims, horizon)
    # log-normal increments
    log_returns = rng.normal(
        loc=adjusted_drift - 0.5 * monthly_vol ** 2,
        scale=monthly_vol,
        size=(n_sims, horizon),
    )
    cumulative = np.cumsum(log_returns, axis=1)
    hashprice_paths = CURRENT_HASHPRICE_PH_DAY * np.exp(cumulative)  # $/PH/day

    # --- Per-month percentiles ---
    hashprice_distributions: list[HashpricePercentiles] = []
    revenue_projections: list[RevenueProjection] = []

    effective_hashrate_PH = fleet["total_hashrate_PH"]
    pool_multiplier = 1.0 - fleet["pool_fee"]
    uptime = fleet["uptime_fraction"]
    monthly_cost = fleet["monthly_energy_cost"]

    # Curtailment adjustment: reduce costs slightly
    curtailment_factor = 1.0 - (fleet["curtailment_savings_pct"] / 100.0)
    adjusted_monthly_cost = monthly_cost * curtailment_factor

    for m in range(horizon):
        col = hashprice_paths[:, m]
        p10, p25, p40, p50, p75, p90 = np.percentile(col, [10, 25, 40, 50, 75, 90])

        hashprice_distributions.append(HashpricePercentiles(
            p10=round(float(p10), 2),
            p25=round(float(p25), 2),
            p50=round(float(p50), 2),
            p75=round(float(p75), 2),
            p90=round(float(p90), 2),
        ))

        # Revenue = hashprice * hashrate_PH * days * pool_multiplier * uptime
        days = 30
        rev_p10 = float(p10) * effective_hashrate_PH * days * pool_multiplier * uptime
        rev_p50 = float(p50) * effective_hashrate_PH * days * pool_multiplier * uptime
        rev_p90 = float(p90) * effective_hashrate_PH * days * pool_multiplier * uptime

        revenue_projections.append(RevenueProjection(
            month=m + 1,
            revenue_usd_p10=round(rev_p10, 2),
            revenue_usd_p50=round(rev_p50, 2),
            revenue_usd_p90=round(rev_p90, 2),
            cost_usd=round(adjusted_monthly_cost, 2),
            profit_usd_p50=round(rev_p50 - adjusted_monthly_cost, 2),
        ))

    # --- Breakeven probability ---
    # Breakeven hashprice = daily cost / hashrate_PH / uptime / pool_multiplier
    daily_cost = adjusted_monthly_cost / 30.0
    if effective_hashrate_PH > 0 and uptime > 0 and pool_multiplier > 0:
        breakeven_hashprice = daily_cost / (effective_hashrate_PH * uptime * pool_multiplier)
    else:
        breakeven_hashprice = float("inf")

    # Check how many sims end up below breakeven at any month in horizon
    below_breakeven_count = 0
    for sim in range(n_sims):
        if np.any(hashprice_paths[sim, :] < breakeven_hashprice):
            below_breakeven_count += 1
    prob_below = below_breakeven_count / n_sims

    # --- Risk score ---
    risk_score = _compute_risk_score(profile, fleet)

    # --- Floor suggestions ---
    # Use the final-month distribution for floors
    final_col = hashprice_paths[:, -1]
    p25_final = float(np.percentile(final_col, 25))
    p40_final = float(np.percentile(final_col, 40))
    p50_final = float(np.percentile(final_col, 50))

    suggested_floors = FloorSuggestions(
        conservative=round(p25_final, 2),
        moderate=round(p40_final, 2),
        aggressive=round(p50_final, 2),
    )

    # --- Insurance inputs ---
    term = horizon
    insurance_inputs = InsuranceInputs(
        indicative_premium_conservative=calculate_indicative_premium(
            p25_final, effective_hashrate_PH, risk_score, term
        ),
        indicative_premium_moderate=calculate_indicative_premium(
            p40_final, effective_hashrate_PH, risk_score, term
        ),
        indicative_premium_aggressive=calculate_indicative_premium(
            p50_final, effective_hashrate_PH, risk_score, term
        ),
        notional_hashrate_PH=round(effective_hashrate_PH, 4),
        term_months=term,
        risk_score=risk_score,
    )

    return RiskAssessment(
        riskScore=risk_score,
        probBelowBreakeven12m=round(prob_below, 4),
        hashpriceDistributions=hashprice_distributions,
        revenueProjections=revenue_projections,
        suggestedFloors=suggested_floors,
        insuranceInputs=insurance_inputs,
    )


# ---------------------------------------------------------------------------
# Quick Assessment (pre-computed distributions, <2s)
# ---------------------------------------------------------------------------

def quick_assessment(profile: MinerProfile) -> RiskAssessment:
    """
    Fast risk assessment using pre-computed/analytic distributions.
    Avoids full Monte Carlo; targets <2s response time.
    """
    fleet = _aggregate_fleet(profile)
    risk_score = _compute_risk_score(profile, fleet)
    effective_hashrate_PH = fleet["total_hashrate_PH"]
    pool_multiplier = 1.0 - fleet["pool_fee"]
    uptime = fleet["uptime_fraction"]
    monthly_cost = fleet["monthly_energy_cost"]
    curtailment_factor = 1.0 - (fleet["curtailment_savings_pct"] / 100.0)
    adjusted_monthly_cost = monthly_cost * curtailment_factor

    horizon = 12
    hashprice_distributions: list[HashpricePercentiles] = []
    revenue_projections: list[RevenueProjection] = []

    for m in range(horizon):
        t = m + 1
        # Analytic lognormal percentiles
        mu = np.log(CURRENT_HASHPRICE_PH_DAY) + (HASHPRICE_MONTHLY_DRIFT - 0.5 * HASHPRICE_MONTHLY_VOL ** 2) * t
        sigma = HASHPRICE_MONTHLY_VOL * np.sqrt(t)

        # lognormal percentile: exp(mu + sigma * z)
        z_values = {
            "p10": -1.2816,
            "p25": -0.6745,
            "p40": -0.2533,
            "p50": 0.0,
            "p75": 0.6745,
            "p90": 1.2816,
        }
        percs = {k: round(float(np.exp(mu + sigma * z)), 2) for k, z in z_values.items()}

        hashprice_distributions.append(HashpricePercentiles(
            p10=percs["p10"],
            p25=percs["p25"],
            p50=percs["p50"],
            p75=percs["p75"],
            p90=percs["p90"],
        ))

        days = 30
        rev_fn = lambda hp: hp * effective_hashrate_PH * days * pool_multiplier * uptime
        revenue_projections.append(RevenueProjection(
            month=t,
            revenue_usd_p10=round(rev_fn(percs["p10"]), 2),
            revenue_usd_p50=round(rev_fn(percs["p50"]), 2),
            revenue_usd_p90=round(rev_fn(percs["p90"]), 2),
            cost_usd=round(adjusted_monthly_cost, 2),
            profit_usd_p50=round(rev_fn(percs["p50"]) - adjusted_monthly_cost, 2),
        ))

    # Breakeven probability (analytic approximation)
    daily_cost = adjusted_monthly_cost / 30.0
    if effective_hashrate_PH > 0 and uptime > 0 and pool_multiplier > 0:
        breakeven_hashprice = daily_cost / (effective_hashrate_PH * uptime * pool_multiplier)
    else:
        breakeven_hashprice = float("inf")

    # Use 12-month distribution to estimate prob below breakeven
    mu_12 = np.log(CURRENT_HASHPRICE_PH_DAY) + (HASHPRICE_MONTHLY_DRIFT - 0.5 * HASHPRICE_MONTHLY_VOL ** 2) * 12
    sigma_12 = HASHPRICE_MONTHLY_VOL * np.sqrt(12)
    if breakeven_hashprice > 0 and breakeven_hashprice < float("inf"):
        # P(X < breakeven) for lognormal
        from math import log as mlog, erfc, sqrt
        z = (mlog(breakeven_hashprice) - mu_12) / sigma_12
        # CDF of standard normal via erfc
        prob_below = 0.5 * erfc(-z / sqrt(2.0))
    else:
        prob_below = 1.0

    # Floors from 12-month analytic distribution
    p25_floor = float(np.exp(mu_12 + sigma_12 * (-0.6745)))
    p40_floor = float(np.exp(mu_12 + sigma_12 * (-0.2533)))
    p50_floor = float(np.exp(mu_12 + sigma_12 * 0.0))

    suggested_floors = FloorSuggestions(
        conservative=round(p25_floor, 2),
        moderate=round(p40_floor, 2),
        aggressive=round(p50_floor, 2),
    )

    term = horizon
    insurance_inputs = InsuranceInputs(
        indicative_premium_conservative=calculate_indicative_premium(
            p25_floor, effective_hashrate_PH, risk_score, term
        ),
        indicative_premium_moderate=calculate_indicative_premium(
            p40_floor, effective_hashrate_PH, risk_score, term
        ),
        indicative_premium_aggressive=calculate_indicative_premium(
            p50_floor, effective_hashrate_PH, risk_score, term
        ),
        notional_hashrate_PH=round(effective_hashrate_PH, 4),
        term_months=term,
        risk_score=risk_score,
    )

    return RiskAssessment(
        riskScore=risk_score,
        probBelowBreakeven12m=round(float(prob_below), 4),
        hashpriceDistributions=hashprice_distributions,
        revenueProjections=revenue_projections,
        suggestedFloors=suggested_floors,
        insuranceInputs=insurance_inputs,
    )


# ---------------------------------------------------------------------------
# Premium Calculation
# ---------------------------------------------------------------------------

def calculate_indicative_premium(
    floor: float,
    hashrate_PH: float,
    risk_score: float,
    term: int,
) -> float:
    """
    Calculate indicative insurance premium.

    Premium is based on:
      - Distance from current hashprice to floor (put-like option)
      - Hashrate (notional exposure)
      - Risk score (loading factor)
      - Term (time value)
    """
    if hashrate_PH <= 0 or floor <= 0:
        return 0.0

    # Notional value per month: floor * hashrate_PH * 30 days
    monthly_notional = floor * hashrate_PH * 30.0

    # Moneyness ratio — how far the floor is from current hashprice
    moneyness = floor / CURRENT_HASHPRICE_PH_DAY
    moneyness = min(moneyness, 1.0)  # cap at ATM

    # Base premium rate: higher for deeper in-the-money floors
    base_rate = 0.02 + 0.08 * moneyness  # 2% - 10% of notional

    # Risk loading: higher risk score -> higher premium
    risk_loading = 1.0 + (risk_score / 100.0) * 0.5  # 1.0x - 1.5x

    # Term factor: longer terms cost more (sqrt of time)
    term_factor = np.sqrt(term / 12.0)

    premium = monthly_notional * term * base_rate * risk_loading * term_factor

    return round(float(premium), 2)


# ---------------------------------------------------------------------------
# Scenario Analysis
# ---------------------------------------------------------------------------

_DEFAULT_PROFILE_FLEET = {
    "total_hashrate_PH": 1.0,
    "monthly_energy_cost": 15000.0,
    "pool_fee": 0.02,
    "uptime_fraction": 0.95,
}


def run_scenario(scenario: ScenarioRequest) -> ScenarioResult:
    """Run a what-if scenario and compare against baseline."""
    params = scenario.params

    # If profile provided, use it for baseline; otherwise use defaults
    if scenario.profile is not None:
        fleet = _aggregate_fleet(scenario.profile)
        hashrate_PH = fleet["total_hashrate_PH"]
        monthly_cost = fleet["monthly_energy_cost"]
        pool_fee = fleet["pool_fee"]
        uptime = fleet["uptime_fraction"]
    else:
        hashrate_PH = _DEFAULT_PROFILE_FLEET["total_hashrate_PH"]
        monthly_cost = _DEFAULT_PROFILE_FLEET["monthly_energy_cost"]
        pool_fee = _DEFAULT_PROFILE_FLEET["pool_fee"]
        uptime = _DEFAULT_PROFILE_FLEET["uptime_fraction"]

    # Baseline monthly revenue
    baseline_daily_rev = CURRENT_HASHPRICE_PH_DAY * hashrate_PH * (1.0 - pool_fee) * uptime
    baseline_monthly_rev = baseline_daily_rev * 30.0

    details: Dict[str, Any] = {}

    if scenario.scenarioType == ScenarioType.btc_crash:
        crash_pct = params.get("crash_pct", 30.0) / 100.0
        new_hashprice = CURRENT_HASHPRICE_PH_DAY * (1.0 - crash_pct)
        scenario_daily = new_hashprice * hashrate_PH * (1.0 - pool_fee) * uptime
        scenario_monthly = scenario_daily * 30.0
        details = {
            "btc_price_drop_pct": crash_pct * 100,
            "new_hashprice": round(new_hashprice, 2),
            "breakeven_hashprice": round(monthly_cost / (hashrate_PH * 30 * (1 - pool_fee) * uptime), 2) if hashrate_PH > 0 else None,
        }

    elif scenario.scenarioType == ScenarioType.difficulty_spike:
        spike_pct = params.get("spike_pct", 20.0) / 100.0
        # Difficulty spike reduces hashprice proportionally
        new_hashprice = CURRENT_HASHPRICE_PH_DAY / (1.0 + spike_pct)
        scenario_daily = new_hashprice * hashrate_PH * (1.0 - pool_fee) * uptime
        scenario_monthly = scenario_daily * 30.0
        details = {
            "difficulty_increase_pct": spike_pct * 100,
            "new_hashprice": round(new_hashprice, 2),
            "new_difficulty": round(CURRENT_DIFFICULTY * (1 + spike_pct), 2),
        }

    elif scenario.scenarioType == ScenarioType.energy_spike:
        energy_increase_pct = params.get("increase_pct", 50.0) / 100.0
        new_monthly_cost = monthly_cost * (1.0 + energy_increase_pct)
        scenario_monthly = baseline_monthly_rev  # revenue unchanged
        # But profit changes
        baseline_profit = baseline_monthly_rev - monthly_cost
        scenario_profit = baseline_monthly_rev - new_monthly_cost
        # We report revenue impact as net impact on profit
        scenario_monthly = baseline_monthly_rev - (new_monthly_cost - monthly_cost)
        details = {
            "energy_increase_pct": energy_increase_pct * 100,
            "old_monthly_cost": round(monthly_cost, 2),
            "new_monthly_cost": round(new_monthly_cost, 2),
            "baseline_profit": round(baseline_profit, 2),
            "scenario_profit": round(scenario_profit, 2),
        }

    elif scenario.scenarioType == ScenarioType.halving:
        # Block reward halves -> hashprice approximately halves
        new_hashprice = CURRENT_HASHPRICE_PH_DAY * 0.5
        # But some miners leave, so difficulty may drop, partially offsetting
        difficulty_drop = params.get("difficulty_drop_pct", 15.0) / 100.0
        adjusted_hashprice = new_hashprice / (1.0 - difficulty_drop)
        scenario_daily = adjusted_hashprice * hashrate_PH * (1.0 - pool_fee) * uptime
        scenario_monthly = scenario_daily * 30.0
        details = {
            "reward_reduction": "50%",
            "estimated_difficulty_drop_pct": difficulty_drop * 100,
            "post_halving_hashprice": round(adjusted_hashprice, 2),
        }

    elif scenario.scenarioType == ScenarioType.hashrate_drop:
        drop_pct = params.get("drop_pct", 20.0) / 100.0
        # Network hashrate drops -> your share increases -> higher per-PH revenue
        new_hashprice = CURRENT_HASHPRICE_PH_DAY / (1.0 - drop_pct)
        scenario_daily = new_hashprice * hashrate_PH * (1.0 - pool_fee) * uptime
        scenario_monthly = scenario_daily * 30.0
        details = {
            "network_hashrate_drop_pct": drop_pct * 100,
            "new_hashprice": round(new_hashprice, 2),
            "beneficiary": True,
        }

    elif scenario.scenarioType == ScenarioType.regulatory:
        impact_pct = params.get("impact_pct", 10.0) / 100.0
        compliance_cost = params.get("monthly_compliance_cost", 5000.0)
        scenario_monthly = baseline_monthly_rev * (1.0 - impact_pct) - compliance_cost
        details = {
            "operational_impact_pct": impact_pct * 100,
            "monthly_compliance_cost": compliance_cost,
            "description": params.get("description", "Regulatory environment change"),
        }

    else:  # custom
        custom_hashprice_mult = params.get("hashprice_multiplier", 1.0)
        custom_cost_mult = params.get("cost_multiplier", 1.0)
        new_hashprice = CURRENT_HASHPRICE_PH_DAY * custom_hashprice_mult
        new_cost = monthly_cost * custom_cost_mult
        scenario_daily = new_hashprice * hashrate_PH * (1.0 - pool_fee) * uptime
        scenario_monthly = scenario_daily * 30.0 - (new_cost - monthly_cost)
        details = {
            "hashprice_multiplier": custom_hashprice_mult,
            "cost_multiplier": custom_cost_mult,
            "new_hashprice": round(new_hashprice, 2),
            "new_monthly_cost": round(new_cost, 2),
        }

    impact_pct = ((scenario_monthly - baseline_monthly_rev) / baseline_monthly_rev * 100.0
                  if baseline_monthly_rev != 0 else 0.0)

    return ScenarioResult(
        scenarioType=scenario.scenarioType,
        baselineRevenue=round(baseline_monthly_rev, 2),
        scenarioRevenue=round(scenario_monthly, 2),
        impact_pct=round(impact_pct, 2),
        details=details,
    )


# ---------------------------------------------------------------------------
# Calibration
# ---------------------------------------------------------------------------

def ingest_calibration(payload: CalibrationPayload) -> Dict[str, Any]:
    """
    Ingest aggregated telemetry from Ampera to calibrate model parameters.
    Updates the in-memory calibration state.
    """
    global _calibration_state

    now = time.time()

    if payload.fleetAggregates:
        total_hashrate = sum(f.avg_hashrate_TH * f.total_units for f in payload.fleetAggregates)
        total_units = sum(f.total_units for f in payload.fleetAggregates)
        if total_units > 0:
            weighted_eff = sum(
                f.avg_efficiency_JTH * f.avg_hashrate_TH * f.total_units
                for f in payload.fleetAggregates
            ) / total_hashrate if total_hashrate > 0 else NETWORK_AVG_EFFICIENCY_JTH
            _calibration_state["network_efficiency_avg"] = weighted_eff

    if payload.curtailmentBehavior:
        _calibration_state["curtailment_avg_hours"] = payload.curtailmentBehavior.avg_curtailment_hours

    if payload.energyProfiles:
        _calibration_state["energy_cost_avg"] = payload.energyProfiles.avg_cost_kwh

    if payload.minerEntryExit:
        net_change = payload.minerEntryExit.net_hashrate_change_pct
        current = _calibration_state["network_hashrate_EH"]
        _calibration_state["network_hashrate_EH"] = current * (1 + net_change / 100.0)

    _calibration_state["last_updated"] = now

    return {
        "status": "calibration_ingested",
        "timestamp": now,
        "updated_fields": list(_calibration_state.keys()),
    }


# ---------------------------------------------------------------------------
# Network State
# ---------------------------------------------------------------------------

def get_network_state() -> NetworkState:
    """Return current network state, incorporating any calibration updates."""
    return NetworkState(
        totalHashrateEH=round(_calibration_state["network_hashrate_EH"], 2),
        difficulty=CURRENT_DIFFICULTY,
        avgBlockTime=CURRENT_AVG_BLOCK_TIME,
        avgEfficiency=round(_calibration_state["network_efficiency_avg"], 2),
        estimatedActiveMiners=ESTIMATED_ACTIVE_MINERS,
    )


# ---------------------------------------------------------------------------
# Async Job Management
# ---------------------------------------------------------------------------

def submit_job(profile: MinerProfile, params: SimulationParams) -> str:
    """Submit a Monte Carlo simulation job to run in a background thread."""
    job_id = str(uuid.uuid4())

    with _job_lock:
        _job_store[job_id] = {
            "status": "running",
            "submitted_at": time.time(),
            "result": None,
            "error": None,
        }

    def _run():
        try:
            result = run_monte_carlo(profile, params)
            with _job_lock:
                _job_store[job_id]["status"] = "completed"
                _job_store[job_id]["result"] = result
                _job_store[job_id]["completed_at"] = time.time()
        except Exception as exc:
            with _job_lock:
                _job_store[job_id]["status"] = "failed"
                _job_store[job_id]["error"] = str(exc)

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()

    return job_id


def get_job(job_id: str) -> Optional[Dict[str, Any]]:
    """Retrieve job status and result."""
    with _job_lock:
        return _job_store.get(job_id)
