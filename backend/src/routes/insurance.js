/**
 * Insurance Routes - Phase 9 (Miner-Facing)
 *
 * Endpoints for miner risk profiles, indicative & formal quotes,
 * policy management, claims history, and coverage status.
 * All routes require authentication.
 */

import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authenticate } from '../middleware/auth.js';
import {
  getLatestRiskAssessment,
  createRiskAssessment,
  updateRiskAssessment,
  getRiskAssessment,
  createQuoteRequest,
  getQuoteRequest,
  getQuoteRequests,
  updateQuoteRequest,
  createInsurancePolicy,
  getInsurancePolicies,
  getInsuranceClaims,
  getClaimsByMonth,
  getTenant,
} from '../cache/database.js';
import { emitEvent } from '../services/webhookService.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

// ─── Helper: Build Mock Miner Profile ────────────────────────────────────────

/**
 * Builds a MinerProfile from the tenant's fleet, energy, and curtailment data.
 * Uses mock aggregates for now until live data pipelines are wired.
 */
function buildMinerProfile(tenantId) {
  const tenant = getTenant(tenantId);
  return {
    tenantId,
    tenantName: tenant?.name || 'Unknown',
    fleet: {
      totalHashrateTH: 450,
      machineCount: 150,
      avgEfficiency: 30.5,
      avgAge: 14,
    },
    energy: {
      avgCostPerKWh: 0.045,
      primarySource: 'grid + solar',
      curtailmentParticipation: true,
      avgUptimePct: 96.2,
    },
    curtailment: {
      recentEvents30d: 8,
      avgRevenuePerEvent: 420,
      estimatedSavings30d: 3360,
    },
    breakeven: {
      currentHashprice: 0.065,
      breakevenHashprice: 0.048,
      marginPct: 26.2,
    },
    generatedAt: new Date().toISOString(),
  };
}

// ─── Helper: Compute Indicative Premium ──────────────────────────────────────

/**
 * Compute a rough indicative premium based on floor, hashrate, term, and risk score.
 * This is a simplified pricing model for indicative purposes only.
 */
function computeIndicativePremium(floor, hashrate, term, riskScore) {
  // Base rate: 2-8% of covered value depending on risk
  const riskMultiplier = 0.02 + (riskScore / 100) * 0.06;
  // Monthly covered value estimate: floor * hashrate * 30 days
  const monthlyCoveredValue = floor * hashrate * 30;
  // Term adjustment: longer terms get a slight discount
  const termDiscount = term >= 12 ? 0.9 : term >= 6 ? 0.95 : 1.0;
  const monthlyPremium = Math.round(monthlyCoveredValue * riskMultiplier * termDiscount * 100) / 100;
  const annualPremium = Math.round(monthlyPremium * 12 * 100) / 100;
  return { monthlyPremium, annualPremium };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Risk Profile
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /risk-profile - Get latest risk assessment for tenant
 */
router.get('/risk-profile', async (req, res) => {
  try {
    const assessment = getLatestRiskAssessment(req.tenantId);

    if (!assessment) {
      return res.json({
        available: false,
        message: 'No assessment available',
      });
    }

    res.json({
      available: true,
      assessmentId: assessment.id,
      assessmentType: assessment.assessment_type,
      status: assessment.status,
      riskScore: assessment.risk_score,
      probBelowBreakeven12m: assessment.prob_below_breakeven_12m,
      suggestedFloors: {
        moderate: assessment.suggested_floor_moderate,
      },
      keyFindings: assessment.assessment?.keyFindings || [],
      modelVersion: assessment.model_version,
      completedAt: assessment.completed_at,
      expiresAt: assessment.expires_at,
    });
  } catch (error) {
    console.error('Get risk profile error:', error);
    res.status(500).json({ error: 'Failed to retrieve risk profile' });
  }
});

/**
 * POST /risk-profile/refresh - Request new risk assessment
 */
router.post('/risk-profile/refresh', async (req, res) => {
  try {
    const assessmentType = req.query.type === 'full' ? 'full' : 'quick';
    const profile = buildMinerProfile(req.tenantId);

    const assessmentId = uuidv4();
    createRiskAssessment({
      id: assessmentId,
      tenantId: req.tenantId,
      assessmentType,
      status: 'pending',
      modelVersion: 'v1.0',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });

    // Attempt quick assessment inline
    try {
      const { requestQuickAssessment } = await import('../services/sanghaModelClient.js');
      const result = await requestQuickAssessment(profile);

      updateRiskAssessment(assessmentId, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        assessmentJson: result,
        riskScore: result.riskScore,
        probBelowBreakeven12m: result.probBelowBreakeven12m,
        suggestedFloorModerate: result.suggestedFloorModerate,
        modelVersion: result.modelVersion || 'v1.0',
      });

      const completed = getRiskAssessment(assessmentId);
      return res.json({
        assessmentId,
        assessmentType,
        status: 'completed',
        riskScore: completed.risk_score,
        probBelowBreakeven12m: completed.prob_below_breakeven_12m,
        suggestedFloors: {
          moderate: completed.suggested_floor_moderate,
        },
        keyFindings: completed.assessment?.keyFindings || [],
        modelVersion: completed.model_version,
        completedAt: completed.completed_at,
        expiresAt: completed.expires_at,
      });
    } catch (modelError) {
      // Model service unavailable - generate mock quick assessment
      const mockResult = {
        riskScore: 42,
        probBelowBreakeven12m: 0.18,
        suggestedFloorModerate: 0.052,
        keyFindings: [
          'Fleet efficiency above network average',
          'Energy costs within competitive range',
          'Curtailment participation reduces downside exposure',
        ],
        modelVersion: 'v1.0-mock',
      };

      updateRiskAssessment(assessmentId, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        assessmentJson: mockResult,
        riskScore: mockResult.riskScore,
        probBelowBreakeven12m: mockResult.probBelowBreakeven12m,
        suggestedFloorModerate: mockResult.suggestedFloorModerate,
        modelVersion: mockResult.modelVersion,
      });

      if (assessmentType === 'full') {
        // Trigger async full assessment in background (fire-and-forget)
        import('../services/sanghaModelClient.js')
          .then(({ requestFullAssessment }) => requestFullAssessment(profile, assessmentId))
          .catch(err => console.error('Async full assessment error:', err.message));
      }

      const completed = getRiskAssessment(assessmentId);
      return res.json({
        assessmentId,
        assessmentType,
        status: assessmentType === 'full' ? 'processing' : 'completed',
        riskScore: completed.risk_score,
        probBelowBreakeven12m: completed.prob_below_breakeven_12m,
        suggestedFloors: {
          moderate: completed.suggested_floor_moderate,
        },
        keyFindings: mockResult.keyFindings,
        modelVersion: completed.model_version,
        completedAt: completed.completed_at,
        expiresAt: completed.expires_at,
        note: assessmentType === 'full'
          ? 'Quick assessment returned; full assessment is processing asynchronously'
          : undefined,
      });
    }
  } catch (error) {
    console.error('Refresh risk profile error:', error);
    res.status(500).json({ error: 'Failed to refresh risk profile' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Quotes
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /quotes/indicative - Calculate indicative premium
 * Query params: floor, hashrate, term
 */
router.get('/quotes/indicative', async (req, res) => {
  try {
    const floor = parseFloat(req.query.floor);
    const hashrate = parseFloat(req.query.hashrate);
    const term = parseInt(req.query.term, 10);

    if (!floor || !hashrate || !term) {
      return res.status(400).json({
        error: 'Missing required query params: floor, hashrate, term',
      });
    }

    if (floor <= 0 || hashrate <= 0 || term <= 0) {
      return res.status(400).json({
        error: 'floor, hashrate, and term must be positive numbers',
      });
    }

    // Get latest risk score for premium calculation
    const assessment = getLatestRiskAssessment(req.tenantId);
    const riskScore = assessment?.risk_score ?? 50; // default mid-range if no assessment

    const { monthlyPremium, annualPremium } = computeIndicativePremium(
      floor,
      hashrate,
      term,
      riskScore
    );

    res.json({
      floor,
      hashrate,
      term,
      monthlyPremium,
      annualPremium,
      riskScore,
      disclaimer: 'Indicative only. Final premium subject to formal underwriting review and may differ based on additional risk factors, market conditions, and policy terms.',
    });
  } catch (error) {
    console.error('Indicative quote error:', error);
    res.status(500).json({ error: 'Failed to calculate indicative premium' });
  }
});

/**
 * POST /quotes/request - Submit formal quote request
 * Body: { desiredFloor, desiredTerm, coveredHashrate, additionalNotes }
 */
router.post('/quotes/request', async (req, res) => {
  try {
    const { desiredFloor, desiredTerm, coveredHashrate, additionalNotes } = req.body;

    if (!desiredFloor || !coveredHashrate) {
      return res.status(400).json({
        error: 'desiredFloor and coveredHashrate are required',
      });
    }

    if (desiredFloor <= 0 || coveredHashrate <= 0) {
      return res.status(400).json({
        error: 'desiredFloor and coveredHashrate must be positive numbers',
      });
    }

    const profile = buildMinerProfile(req.tenantId);
    const assessment = getLatestRiskAssessment(req.tenantId);
    const riskScore = assessment?.risk_score ?? 50;
    const term = desiredTerm || 12;

    // Build indicative quote to attach
    const { monthlyPremium, annualPremium } = computeIndicativePremium(
      desiredFloor,
      coveredHashrate,
      term,
      riskScore
    );

    const indicativeQuote = {
      floor: desiredFloor,
      hashrate: coveredHashrate,
      term,
      monthlyPremium,
      annualPremium,
      riskScore,
      generatedAt: new Date().toISOString(),
    };

    const quoteId = uuidv4();
    createQuoteRequest({
      id: quoteId,
      tenantId: req.tenantId,
      requestedBy: req.user.id,
      status: 'submitted',
      desiredFloor,
      desiredTerm: term,
      coveredHashrate,
      additionalNotes: additionalNotes || null,
      minerProfileJson: profile,
      latestRiskAssessmentId: assessment?.id || null,
      indicativeQuoteJson: indicativeQuote,
    });

    const quoteRequest = getQuoteRequest(quoteId);

    // Emit webhook
    emitEvent(req.tenantId, 'insurance.quote_requested', {
      quoteRequestId: quoteId,
      desiredFloor,
      desiredTerm: term,
      coveredHashrate,
      riskScore,
      indicativeMonthlyPremium: monthlyPremium,
    });

    res.status(201).json({
      quoteRequest: {
        id: quoteRequest.id,
        tenantId: quoteRequest.tenant_id,
        status: quoteRequest.status,
        desiredFloor: quoteRequest.desired_floor,
        desiredTerm: quoteRequest.desired_term,
        coveredHashrate: quoteRequest.covered_hashrate,
        additionalNotes: quoteRequest.additional_notes,
        minerProfile: quoteRequest.minerProfile,
        indicativeQuote: quoteRequest.indicativeQuote,
        riskAssessmentId: quoteRequest.latest_risk_assessment_id,
        requestedAt: quoteRequest.requested_at,
      },
    });
  } catch (error) {
    console.error('Submit quote request error:', error);
    res.status(500).json({ error: 'Failed to submit quote request' });
  }
});

/**
 * GET /quotes - List quote requests for tenant
 */
router.get('/quotes', async (req, res) => {
  try {
    const { status } = req.query;
    const quotes = getQuoteRequests(req.tenantId, status || null);

    res.json({
      quotes: quotes.map(qr => ({
        id: qr.id,
        status: qr.status,
        desiredFloor: qr.desired_floor,
        desiredTerm: qr.desired_term,
        coveredHashrate: qr.covered_hashrate,
        additionalNotes: qr.additional_notes,
        indicativeQuote: qr.indicativeQuote,
        formalQuote: qr.formalQuote,
        riskAssessmentId: qr.latest_risk_assessment_id,
        requestedAt: qr.requested_at,
        expiresAt: qr.expires_at,
      })),
      total: quotes.length,
    });
  } catch (error) {
    console.error('List quotes error:', error);
    res.status(500).json({ error: 'Failed to list quote requests' });
  }
});

/**
 * GET /quotes/:id - Get specific quote request
 */
router.get('/quotes/:id', async (req, res) => {
  try {
    const qr = getQuoteRequest(req.params.id);

    if (!qr) {
      return res.status(404).json({ error: 'Quote request not found' });
    }

    if (qr.tenant_id !== req.tenantId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.json({
      quoteRequest: {
        id: qr.id,
        tenantId: qr.tenant_id,
        status: qr.status,
        desiredFloor: qr.desired_floor,
        desiredTerm: qr.desired_term,
        coveredHashrate: qr.covered_hashrate,
        additionalNotes: qr.additional_notes,
        minerProfile: qr.minerProfile,
        indicativeQuote: qr.indicativeQuote,
        formalQuote: qr.formalQuote,
        riskAssessmentId: qr.latest_risk_assessment_id,
        reviewedBy: qr.reviewed_by,
        reviewedAt: qr.reviewed_at,
        reviewNotes: qr.review_notes,
        requestedAt: qr.requested_at,
        expiresAt: qr.expires_at,
      },
    });
  } catch (error) {
    console.error('Get quote error:', error);
    res.status(500).json({ error: 'Failed to retrieve quote request' });
  }
});

/**
 * POST /quotes/:id/accept - Accept a formal quote (status must be 'quote_issued')
 */
router.post('/quotes/:id/accept', async (req, res) => {
  try {
    const qr = getQuoteRequest(req.params.id);

    if (!qr) {
      return res.status(404).json({ error: 'Quote request not found' });
    }

    if (qr.tenant_id !== req.tenantId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (qr.status !== 'quote_issued') {
      return res.status(400).json({
        error: `Cannot accept quote in status '${qr.status}'. Quote must be in 'quote_issued' status.`,
      });
    }

    // Check if quote has expired
    if (qr.expires_at && new Date(qr.expires_at) < new Date()) {
      return res.status(400).json({
        error: 'This quote has expired. Please request a new quote.',
      });
    }

    const formalQuote = qr.formalQuote;
    if (!formalQuote) {
      return res.status(400).json({ error: 'No formal quote found on this request' });
    }

    // Create insurance policy from the formal quote
    const policyId = uuidv4();
    const now = new Date();
    const startDate = now.toISOString().split('T')[0];
    const termMonths = formalQuote.termMonths || qr.desired_term || 12;
    const endDate = new Date(now);
    endDate.setMonth(endDate.getMonth() + termMonths);
    const endDateStr = endDate.toISOString().split('T')[0];
    const policyNumber = `SNG-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    createInsurancePolicy({
      id: policyId,
      tenantId: req.tenantId,
      quoteRequestId: qr.id,
      policyNumber,
      status: 'active',
      floorPrice: formalQuote.floorPrice || qr.desired_floor,
      monthlyPremium: formalQuote.monthlyPremium,
      coveredHashrate: qr.covered_hashrate,
      termMonths,
      startDate,
      endDate: endDateStr,
      upsideSharePct: formalQuote.upsideSharePct || 0.15,
      termsJson: formalQuote.specialTerms ? { specialTerms: formalQuote.specialTerms } : null,
    });

    // Update quote request status
    updateQuoteRequest(qr.id, {
      status: 'accepted',
      reviewedAt: new Date().toISOString(),
    });

    // Emit webhooks
    emitEvent(req.tenantId, 'insurance.quote_accepted', {
      quoteRequestId: qr.id,
      policyId,
      policyNumber,
    });

    emitEvent(req.tenantId, 'insurance.policy_activated', {
      policyId,
      policyNumber,
      floorPrice: formalQuote.floorPrice || qr.desired_floor,
      monthlyPremium: formalQuote.monthlyPremium,
      coveredHashrate: qr.covered_hashrate,
      termMonths,
      startDate,
      endDate: endDateStr,
    });

    res.json({
      policy: {
        id: policyId,
        policyNumber,
        status: 'active',
        floorPrice: formalQuote.floorPrice || qr.desired_floor,
        monthlyPremium: formalQuote.monthlyPremium,
        coveredHashrate: qr.covered_hashrate,
        termMonths,
        startDate,
        endDate: endDateStr,
        upsideSharePct: formalQuote.upsideSharePct || 0.15,
      },
      quoteRequestId: qr.id,
    });
  } catch (error) {
    console.error('Accept quote error:', error);
    res.status(500).json({ error: 'Failed to accept quote' });
  }
});

/**
 * POST /quotes/:id/decline - Decline a formal quote
 */
router.post('/quotes/:id/decline', async (req, res) => {
  try {
    const qr = getQuoteRequest(req.params.id);

    if (!qr) {
      return res.status(404).json({ error: 'Quote request not found' });
    }

    if (qr.tenant_id !== req.tenantId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (qr.status !== 'quote_issued') {
      return res.status(400).json({
        error: `Cannot decline quote in status '${qr.status}'. Quote must be in 'quote_issued' status.`,
      });
    }

    updateQuoteRequest(qr.id, {
      status: 'declined',
      reviewedAt: new Date().toISOString(),
    });

    res.json({
      id: qr.id,
      status: 'declined',
      message: 'Quote declined successfully',
    });
  } catch (error) {
    console.error('Decline quote error:', error);
    res.status(500).json({ error: 'Failed to decline quote' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Policies
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /policy - Get active insurance policies for tenant
 */
router.get('/policy', async (req, res) => {
  try {
    const policies = getInsurancePolicies(req.tenantId, 'active');

    res.json({
      policies: policies.map(p => ({
        id: p.id,
        policyNumber: p.policy_number,
        status: p.status,
        floorPrice: p.floor_price,
        monthlyPremium: p.monthly_premium,
        coveredHashrate: p.covered_hashrate,
        termMonths: p.term_months,
        startDate: p.start_date,
        endDate: p.end_date,
        upsideSharePct: p.upside_share_pct,
        terms: p.terms,
        createdAt: p.created_at,
      })),
      total: policies.length,
    });
  } catch (error) {
    console.error('Get policies error:', error);
    res.status(500).json({ error: 'Failed to retrieve policies' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Claims
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /claims - Get all claims for tenant. Optional query: ?policy_id=X
 */
router.get('/claims', async (req, res) => {
  try {
    const { policy_id } = req.query;
    const claims = getInsuranceClaims(req.tenantId, policy_id || null);

    res.json({
      claims: claims.map(c => ({
        id: c.id,
        policyId: c.policy_id,
        claimMonth: c.claim_month,
        status: c.status,
        actualHashprice: c.actual_hashprice,
        floorPrice: c.floor_price,
        shortfallPerTH: c.shortfall_per_th,
        coveredHashrate: c.covered_hashrate,
        grossClaimAmount: c.gross_claim_amount,
        verificationStatus: c.verification_status,
        recommendedPayout: c.recommended_payout,
        paidAmount: c.paid_amount,
        paidAt: c.paid_at,
        createdAt: c.created_at,
      })),
      total: claims.length,
    });
  } catch (error) {
    console.error('Get claims error:', error);
    res.status(500).json({ error: 'Failed to retrieve claims' });
  }
});

/**
 * GET /claims/:month - Get claims for specific month (format: YYYY-MM)
 */
router.get('/claims/:month', async (req, res) => {
  try {
    const { month } = req.params;

    // Validate month format
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({
        error: 'Invalid month format. Use YYYY-MM (e.g., 2025-03)',
      });
    }

    const claims = getClaimsByMonth(req.tenantId, month);

    res.json({
      month,
      claims: claims.map(c => ({
        id: c.id,
        policyId: c.policy_id,
        claimMonth: c.claim_month,
        status: c.status,
        actualHashprice: c.actual_hashprice,
        floorPrice: c.floor_price,
        shortfallPerTH: c.shortfall_per_th,
        coveredHashrate: c.covered_hashrate,
        grossClaimAmount: c.gross_claim_amount,
        verificationStatus: c.verification_status,
        recommendedPayout: c.recommended_payout,
        paidAmount: c.paid_amount,
        paidAt: c.paid_at,
        createdAt: c.created_at,
      })),
      total: claims.length,
    });
  } catch (error) {
    console.error('Get claims by month error:', error);
    res.status(500).json({ error: 'Failed to retrieve claims for month' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Coverage Status
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /coverage-status - Combined coverage view
 * Active policy details, current month claim status, cumulative paid,
 * net value (premiums paid vs claims received).
 */
router.get('/coverage-status', async (req, res) => {
  try {
    const policies = getInsurancePolicies(req.tenantId, 'active');
    const allClaims = getInsuranceClaims(req.tenantId);

    // Current month in YYYY-MM format
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const currentMonthClaims = allClaims.filter(c => c.claim_month === currentMonth);

    // Calculate cumulative values
    const totalPremiumsPaid = policies.reduce((sum, p) => {
      const startDate = new Date(p.start_date);
      const monthsActive = Math.max(
        1,
        (now.getFullYear() - startDate.getFullYear()) * 12 +
          (now.getMonth() - startDate.getMonth()) + 1
      );
      return sum + p.monthly_premium * Math.min(monthsActive, p.term_months);
    }, 0);

    const totalClaimsReceived = allClaims
      .filter(c => c.status === 'paid')
      .reduce((sum, c) => sum + (c.paid_amount || 0), 0);

    const totalClaimsPending = allClaims
      .filter(c => ['pending', 'verified'].includes(c.status))
      .reduce((sum, c) => sum + (c.gross_claim_amount || 0), 0);

    res.json({
      activePolicies: policies.map(p => ({
        id: p.id,
        policyNumber: p.policy_number,
        floorPrice: p.floor_price,
        monthlyPremium: p.monthly_premium,
        coveredHashrate: p.covered_hashrate,
        termMonths: p.term_months,
        startDate: p.start_date,
        endDate: p.end_date,
        upsideSharePct: p.upside_share_pct,
      })),
      currentMonth: {
        month: currentMonth,
        claims: currentMonthClaims.map(c => ({
          id: c.id,
          policyId: c.policy_id,
          status: c.status,
          grossClaimAmount: c.gross_claim_amount,
          paidAmount: c.paid_amount,
        })),
        claimCount: currentMonthClaims.length,
      },
      cumulative: {
        totalPremiumsPaid: Math.round(totalPremiumsPaid * 100) / 100,
        totalClaimsReceived: Math.round(totalClaimsReceived * 100) / 100,
        totalClaimsPending: Math.round(totalClaimsPending * 100) / 100,
        netValue: Math.round((totalClaimsReceived - totalPremiumsPaid) * 100) / 100,
      },
      policyCount: policies.length,
    });
  } catch (error) {
    console.error('Coverage status error:', error);
    res.status(500).json({ error: 'Failed to retrieve coverage status' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Scheduler Controls - start/stop background jobs from the dashboard
// ═══════════════════════════════════════════════════════════════════════════════

let schedulerState = { claims: false, calibration: false };

/**
 * GET /schedulers - Get status of all Phase 9 schedulers
 */
router.get('/schedulers', (req, res) => {
  res.json({
    claims: { running: schedulerState.claims, description: 'Monthly claims generation (1st of month)' },
    calibration: { running: schedulerState.calibration, description: 'Daily calibration export to SanghaModel' },
  });
});

/**
 * POST /schedulers/start - Start one or all schedulers
 * Body: { scheduler: 'claims' | 'calibration' | 'all' }
 */
router.post('/schedulers/start', async (req, res) => {
  try {
    const { scheduler = 'all' } = req.body || {};

    if (scheduler === 'claims' || scheduler === 'all') {
      if (!schedulerState.claims) {
        const { startClaimsScheduler } = await import('../services/claimsVerifier.js');
        startClaimsScheduler(1);
        schedulerState.claims = true;
      }
    }

    if (scheduler === 'calibration' || scheduler === 'all') {
      if (!schedulerState.calibration) {
        const { startCalibrationScheduler } = await import('../services/calibrationExporter.js');
        startCalibrationScheduler(24);
        schedulerState.calibration = true;
      }
    }

    res.json({ success: true, schedulers: schedulerState });
  } catch (error) {
    console.error('Failed to start schedulers:', error);
    res.status(500).json({ error: 'Failed to start schedulers' });
  }
});

/**
 * POST /schedulers/stop - Stop one or all schedulers
 * Body: { scheduler: 'claims' | 'calibration' | 'all' }
 */
router.post('/schedulers/stop', async (req, res) => {
  try {
    const { scheduler = 'all' } = req.body || {};

    if (scheduler === 'claims' || scheduler === 'all') {
      if (schedulerState.claims) {
        const { stopClaimsScheduler } = await import('../services/claimsVerifier.js');
        stopClaimsScheduler();
        schedulerState.claims = false;
      }
    }

    if (scheduler === 'calibration' || scheduler === 'all') {
      if (schedulerState.calibration) {
        const { stopCalibrationScheduler } = await import('../services/calibrationExporter.js');
        stopCalibrationScheduler();
        schedulerState.calibration = false;
      }
    }

    res.json({ success: true, schedulers: schedulerState });
  } catch (error) {
    console.error('Failed to stop schedulers:', error);
    res.status(500).json({ error: 'Failed to stop schedulers' });
  }
});

export default router;
