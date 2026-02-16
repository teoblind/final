"""
Sangha Ampera — Phase 9: SanghaModel FastAPI Wrapper

A Python microservice providing Monte Carlo risk-assessment,
scenario analysis, and calibration endpoints for Bitcoin mining
operations. Runs on port 8100.
"""

from __future__ import annotations

import os
import time
from typing import Optional

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware

from models import (
    CalibrationPayload,
    ErrorResponse,
    FullAssessmentRequest,
    HealthResponse,
    JobAccepted,
    MinerProfile,
    NetworkState,
    RiskAssessment,
    ScenarioRequest,
    ScenarioResult,
    SimulationParams,
)
from simulator import (
    get_job,
    get_network_state,
    ingest_calibration,
    quick_assessment,
    run_scenario,
    submit_job,
)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

load_dotenv()

API_KEY = os.getenv("SANGHA_MODEL_API_KEY", "sm_dev_key_12345")
PORT = int(os.getenv("PORT", "8100"))
MODEL_VERSION = "0.9.0-phase9"
SERVICE_START_TIME = time.time()

# ---------------------------------------------------------------------------
# FastAPI App
# ---------------------------------------------------------------------------

app = FastAPI(
    title="SanghaModel",
    description=(
        "Monte Carlo risk-assessment engine for Sangha Ampera. "
        "Provides hashprice distribution projections, risk scoring, "
        "floor suggestions, scenario analysis, and calibration ingestion."
    ),
    version=MODEL_VERSION,
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Auth dependency
# ---------------------------------------------------------------------------

async def verify_api_key(x_api_key: Optional[str] = Header(None)) -> str:
    """Validate the X-API-Key header against the configured key."""
    if x_api_key is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing X-API-Key header",
        )
    if x_api_key != API_KEY:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid API key",
        )
    return x_api_key


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get(
    "/v1/health",
    response_model=HealthResponse,
    tags=["health"],
    summary="Service health check",
)
async def health_check():
    """Return service health, model version, and uptime."""
    return HealthResponse(
        status="ok",
        service="sangha-model",
        model_version=MODEL_VERSION,
        uptime=round(time.time() - SERVICE_START_TIME, 2),
    )


@app.post(
    "/v1/risk-assessment",
    response_model=JobAccepted,
    status_code=status.HTTP_202_ACCEPTED,
    tags=["risk-assessment"],
    summary="Full Monte Carlo risk assessment (async)",
    responses={
        202: {"description": "Simulation job accepted"},
        401: {"model": ErrorResponse},
        403: {"model": ErrorResponse},
    },
)
async def full_risk_assessment(
    body: FullAssessmentRequest,
    _key: str = Depends(verify_api_key),
):
    """
    Submit a full Monte Carlo simulation job.

    Returns 202 with a job_id. Poll ``GET /v1/risk-assessment/{job_id}``
    for results.
    """
    job_id = submit_job(body.profile, body.params)
    return JobAccepted(
        job_id=job_id,
        status="accepted",
        message="Simulation job queued. Poll GET /v1/risk-assessment/{job_id} for results.",
    )


@app.get(
    "/v1/risk-assessment/{job_id}",
    tags=["risk-assessment"],
    summary="Poll for simulation job results",
    responses={
        200: {"description": "Job completed — full RiskAssessment returned"},
        202: {"description": "Job still running"},
        404: {"model": ErrorResponse},
        500: {"model": ErrorResponse},
    },
)
async def get_risk_assessment_result(
    job_id: str,
    _key: str = Depends(verify_api_key),
):
    """Retrieve results for a previously submitted simulation job."""
    job = get_job(job_id)
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job {job_id} not found",
        )

    if job["status"] == "running":
        return {
            "job_id": job_id,
            "status": "running",
            "message": "Simulation still in progress",
        }

    if job["status"] == "failed":
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Simulation failed: {job['error']}",
        )

    # completed
    return {
        "job_id": job_id,
        "status": "completed",
        "result": job["result"],
    }


@app.post(
    "/v1/risk-assessment/quick",
    response_model=RiskAssessment,
    tags=["risk-assessment"],
    summary="Quick risk assessment (<2s)",
    responses={
        200: {"description": "Quick risk assessment result"},
        401: {"model": ErrorResponse},
        403: {"model": ErrorResponse},
    },
)
async def quick_risk_assessment(
    profile: MinerProfile,
    _key: str = Depends(verify_api_key),
):
    """
    Quick risk assessment using analytic (pre-computed) distributions.
    Returns in under 2 seconds. Suitable for real-time UI updates.
    """
    return quick_assessment(profile)


@app.post(
    "/v1/calibration/ingest",
    tags=["calibration"],
    summary="Ingest aggregated telemetry from Ampera",
    responses={
        200: {"description": "Calibration data ingested"},
        401: {"model": ErrorResponse},
        403: {"model": ErrorResponse},
    },
)
async def calibration_ingest(
    payload: CalibrationPayload,
    _key: str = Depends(verify_api_key),
):
    """
    Receive aggregated fleet telemetry from Ampera to calibrate
    the model's priors for network efficiency, hashrate, and
    curtailment behavior.
    """
    result = ingest_calibration(payload)
    return result


@app.get(
    "/v1/network/current-state",
    response_model=NetworkState,
    tags=["network"],
    summary="Current Bitcoin network state",
    responses={
        200: {"description": "Current network state"},
        401: {"model": ErrorResponse},
        403: {"model": ErrorResponse},
    },
)
async def network_current_state(
    _key: str = Depends(verify_api_key),
):
    """
    Return the current network state including hashrate, difficulty,
    block time, efficiency distribution, and estimated active miners.
    """
    return get_network_state()


@app.post(
    "/v1/scenario",
    response_model=ScenarioResult,
    tags=["scenario"],
    summary="Run what-if scenario",
    responses={
        200: {"description": "Scenario analysis result"},
        401: {"model": ErrorResponse},
        403: {"model": ErrorResponse},
    },
)
async def run_what_if_scenario(
    scenario: ScenarioRequest,
    _key: str = Depends(verify_api_key),
):
    """
    Run a what-if scenario (BTC crash, difficulty spike, energy spike,
    halving, hashrate drop, regulatory, or custom) and return the
    impact on revenue compared to baseline.
    """
    return run_scenario(scenario)


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=PORT,
        reload=False,
        log_level="info",
    )
