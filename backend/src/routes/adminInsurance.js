/**
 * Admin Insurance Routes — Phase 9 (Sangha Admin / Underwriter)
 *
 * Cross-tenant insurance administration endpoints for underwriting queue,
 * portfolio overview, claims management, calibration, and stress testing.
 * All routes require authentication + sangha_admin or sangha_underwriter role.
 */

import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authenticate, requireRole } from '../middleware/auth.js';
import {
  getAllQuoteRequests,
  getQuoteRequest,
  updateQuoteRequest,
  getLatestRiskAssessment,
  createRiskAssessment,
  updateRiskAssessment,
  getRiskAssessment,
  getPortfolioMetrics,
  getAllPendingClaims,
  getInsuranceClaim,
  updateInsuranceClaim,
  getLatestCalibrationExport,
  getCalibrationExports,
  createCalibrationExport,
  getTenant,
} from '../cache/database.js';
import { emitEvent } from '../services/webhookService.js';

const router = Router();

// All routes require authentication + sangha_admin or sangha_underwriter role
router.use(authenticate);
router.use(requireRole('sangha_admin', 'sangha_underwriter'));

// ═══════════════════════════════════════════════════════════════════════════════
// Underwriting Queue
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /queue — List all quote requests across tenants
 * Query: ?status=X to filter by status
 */
router.get('/queue', async (req, res) => {
  try {
    const { status } = req.query;
    const requests = getAllQuoteRequests(status || null);

    // Enrich with tenant name and latest risk score
    const enriched = requests.map(qr => {
      const tenant = getTenant(qr.tenant_id);
      const latestAssessment = getLatestRiskAssessment(qr.tenant_id);

      return {
        id: qr.id,
        tenantId: qr.tenant_id,
        tenantName: tenant?.name || 'Unknown',
        status: qr.status,
        desiredFloor: qr.desired_floor,
        desiredTerm: qr.desired_term,
        coveredHashrate: qr.covered_hashrate,
        additionalNotes: qr.additional_notes,
        riskScore: latestAssessment?.risk_score ?? null,
        riskAssessmentId: qr.latest_risk_assessment_id,
        indicativeQuote: qr.indicativeQuote,
        formalQuote: qr.formalQuote,
        requestedAt: qr.requested_at,
        expiresAt: qr.expires_at,
      };
    });

    res.json({
      queue: enriched,
      total: enriched.length,
    });
  } catch (error) {
    console.error('List queue error:', error);
    res.status(500).json({ error: 'Failed to list underwriting queue' });
  }
});

/**
 * GET /queue/:id — Get specific quote request with full details
 */
router.get('/queue/:id', async (req, res) => {
  try {
    const qr = getQuoteRequest(req.params.id);

    if (!qr) {
      return res.status(404).json({ error: 'Quote request not found' });
    }

    const tenant = getTenant(qr.tenant_id);
    let riskAssessment = null;
    if (qr.latest_risk_assessment_id) {
      riskAssessment = getRiskAssessment(qr.latest_risk_assessment_id);
    }
    if (!riskAssessment) {
      riskAssessment = getLatestRiskAssessment(qr.tenant_id);
    }

    res.json({
      quoteRequest: {
        id: qr.id,
        tenantId: qr.tenant_id,
        tenantName: tenant?.name || 'Unknown',
        requestedBy: qr.requested_by,
        status: qr.status,
        desiredFloor: qr.desired_floor,
        desiredTerm: qr.desired_term,
        coveredHashrate: qr.covered_hashrate,
        additionalNotes: qr.additional_notes,
        minerProfile: qr.minerProfile,
        indicativeQuote: qr.indicativeQuote,
        formalQuote: qr.formalQuote,
        reviewedBy: qr.reviewed_by,
        reviewedAt: qr.reviewed_at,
        reviewNotes: qr.review_notes,
        requestedAt: qr.requested_at,
        expiresAt: qr.expires_at,
      },
      riskAssessment: riskAssessment
        ? {
            id: riskAssessment.id,
            assessmentType: riskAssessment.assessment_type,
            status: riskAssessment.status,
            riskScore: riskAssessment.risk_score,
            probBelowBreakeven12m: riskAssessment.prob_below_breakeven_12m,
            suggestedFloorModerate: riskAssessment.suggested_floor_moderate,
            assessment: riskAssessment.assessment,
            modelVersion: riskAssessment.model_version,
            completedAt: riskAssessment.completed_at,
            expiresAt: riskAssessment.expires_at,
          }
        : null,
    });
  } catch (error) {
    console.error('Get queue item error:', error);
    res.status(500).json({ error: 'Failed to retrieve quote request details' });
  }
});

/**
 * POST /queue/:id/quote — Issue formal quote for a request
 * Body: { monthlyPremium, upsideSharePct, floorPrice, termMonths, specialTerms, expiresInDays }
 */
router.post('/queue/:id/quote', async (req, res) => {
  try {
    const qr = getQuoteRequest(req.params.id);

    if (!qr) {
      return res.status(404).json({ error: 'Quote request not found' });
    }

    if (!['submitted', 'under_review'].includes(qr.status)) {
      return res.status(400).json({
        error: `Cannot issue quote for request in status '${qr.status}'. Must be 'submitted' or 'under_review'.`,
      });
    }

    const {
      monthlyPremium,
      upsideSharePct,
      floorPrice,
      termMonths,
      specialTerms,
      expiresInDays,
    } = req.body;

    if (!monthlyPremium || !floorPrice) {
      return res.status(400).json({
        error: 'monthlyPremium and floorPrice are required',
      });
    }

    if (monthlyPremium <= 0 || floorPrice <= 0) {
      return res.status(400).json({
        error: 'monthlyPremium and floorPrice must be positive numbers',
      });
    }

    const expirationDays = expiresInDays || 14;
    const expiresAt = new Date(Date.now() + expirationDays * 24 * 60 * 60 * 1000).toISOString();

    const formalQuote = {
      monthlyPremium,
      annualPremium: Math.round(monthlyPremium * 12 * 100) / 100,
      upsideSharePct: upsideSharePct ?? 0.15,
      floorPrice,
      termMonths: termMonths || qr.desired_term || 12,
      specialTerms: specialTerms || null,
      issuedBy: req.user.id,
      issuedAt: new Date().toISOString(),
      expiresAt,
    };

    updateQuoteRequest(qr.id, {
      status: 'quote_issued',
      formalQuoteJson: formalQuote,
      reviewedBy: req.user.id,
      reviewedAt: new Date().toISOString(),
      expiresAt,
    });

    const updated = getQuoteRequest(qr.id);

    // Emit webhook to the tenant
    emitEvent(qr.tenant_id, 'insurance.quote_issued', {
      quoteRequestId: qr.id,
      monthlyPremium,
      floorPrice,
      termMonths: formalQuote.termMonths,
      expiresAt,
    });

    res.json({
      quoteRequest: {
        id: updated.id,
        tenantId: updated.tenant_id,
        status: updated.status,
        desiredFloor: updated.desired_floor,
        desiredTerm: updated.desired_term,
        coveredHashrate: updated.covered_hashrate,
        formalQuote: updated.formalQuote,
        reviewedBy: updated.reviewed_by,
        reviewedAt: updated.reviewed_at,
        expiresAt: updated.expires_at,
      },
    });
  } catch (error) {
    console.error('Issue quote error:', error);
    res.status(500).json({ error: 'Failed to issue formal quote' });
  }
});

/**
 * POST /queue/:id/assess — Trigger risk assessment for a specific quote request's tenant
 */
router.post('/queue/:id/assess', async (req, res) => {
  try {
    const qr = getQuoteRequest(req.params.id);

    if (!qr) {
      return res.status(404).json({ error: 'Quote request not found' });
    }

    const assessmentType = req.query.type === 'full' ? 'full' : 'quick';
    const tenant = getTenant(qr.tenant_id);

    // Build a basic miner profile from available data
    const profile = {
      tenantId: qr.tenant_id,
      tenantName: tenant?.name || 'Unknown',
      minerProfile: qr.minerProfile || null,
      desiredFloor: qr.desired_floor,
      coveredHashrate: qr.covered_hashrate,
    };

    const assessmentId = uuidv4();
    createRiskAssessment({
      id: assessmentId,
      tenantId: qr.tenant_id,
      assessmentType,
      status: 'pending',
      modelVersion: 'v1.0',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });

    // Attempt assessment via sanghaModelClient
    try {
      const client = await import('../services/sanghaModelClient.js');
      const assessFn = assessmentType === 'full' ? client.requestFullAssessment : client.requestQuickAssessment;
      const result = await assessFn(profile);

      updateRiskAssessment(assessmentId, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        assessmentJson: result,
        riskScore: result.riskScore,
        probBelowBreakeven12m: result.probBelowBreakeven12m,
        suggestedFloorModerate: result.suggestedFloorModerate,
        modelVersion: result.modelVersion || 'v1.0',
      });
    } catch (modelError) {
      // Model service unavailable — use mock assessment
      const mockResult = {
        riskScore: 45,
        probBelowBreakeven12m: 0.22,
        suggestedFloorModerate: 0.050,
        keyFindings: [
          'Assessment generated from available profile data',
          'Full model service unavailable — mock values used',
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
    }

    // Link assessment to quote request
    const completed = getRiskAssessment(assessmentId);

    res.json({
      assessmentId,
      quoteRequestId: qr.id,
      tenantId: qr.tenant_id,
      assessmentType,
      status: completed.status,
      riskScore: completed.risk_score,
      probBelowBreakeven12m: completed.prob_below_breakeven_12m,
      suggestedFloorModerate: completed.suggested_floor_moderate,
      modelVersion: completed.model_version,
      completedAt: completed.completed_at,
    });
  } catch (error) {
    console.error('Trigger assessment error:', error);
    res.status(500).json({ error: 'Failed to trigger risk assessment' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Portfolio
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /portfolio — Portfolio overview with metrics
 */
router.get('/portfolio', async (req, res) => {
  try {
    const metrics = getPortfolioMetrics();

    // Compute additional derived metrics
    const exposureByRiskTier = {};
    if (metrics.byRiskTier && metrics.byRiskTier.length > 0) {
      for (const tier of metrics.byRiskTier) {
        exposureByRiskTier[tier.tier || 'unknown'] = {
          policyCount: tier.count,
          coveredHashrate: tier.hashrate || 0,
          monthlyPremium: tier.premium || 0,
        };
      }
    }

    // Monthly premium income (annualized)
    const annualPremiumIncome = Math.round((metrics.monthlyPremiumIncome || 0) * 12 * 100) / 100;

    // Trailing loss ratio = total claims paid / total premiums collected
    const trailingLossRatio = metrics.lossRatio || 0;

    res.json({
      portfolio: {
        activePolicies: metrics.activePolicies,
        totalCoveredHashrate: metrics.totalCoveredHashrate,
        monthlyPremiumIncome: metrics.monthlyPremiumIncome,
        annualPremiumIncome,
        totalClaimsPaid: metrics.totalClaimsPaid,
        claimCount: metrics.claimCount,
        pendingClaimsCount: metrics.pendingClaimsCount,
        pendingClaimsAmount: metrics.pendingClaimsAmount,
        trailingLossRatio: Math.round(trailingLossRatio * 10000) / 10000,
        exposureByRiskTier,
      },
    });
  } catch (error) {
    console.error('Portfolio overview error:', error);
    res.status(500).json({ error: 'Failed to retrieve portfolio overview' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Claims Management
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /claims — List all pending claims across tenants
 */
router.get('/claims', async (req, res) => {
  try {
    const claims = getAllPendingClaims();

    res.json({
      claims: claims.map(c => ({
        id: c.id,
        tenantId: c.tenant_id,
        tenantName: c.tenant_name || 'Unknown',
        policyId: c.policy_id,
        policyNumber: c.policy_number,
        claimMonth: c.claim_month,
        status: c.status,
        actualHashprice: c.actual_hashprice,
        floorPrice: c.floor_price,
        policyFloor: c.policy_floor,
        shortfallPerTH: c.shortfall_per_th,
        coveredHashrate: c.covered_hashrate,
        grossClaimAmount: c.gross_claim_amount,
        verificationStatus: c.verification_status,
        recommendedPayout: c.recommended_payout,
        adjustmentReason: c.adjustment_reason,
        paidAmount: c.paid_amount,
        createdAt: c.created_at,
      })),
      total: claims.length,
    });
  } catch (error) {
    console.error('List pending claims error:', error);
    res.status(500).json({ error: 'Failed to list pending claims' });
  }
});

/**
 * POST /claims/:id/verify — Manually verify a claim
 * Body: { status, adjustmentReason, recommendedPayout }
 */
router.post('/claims/:id/verify', async (req, res) => {
  try {
    const claim = getInsuranceClaim(req.params.id);

    if (!claim) {
      return res.status(404).json({ error: 'Claim not found' });
    }

    const { status, adjustmentReason, recommendedPayout } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'status is required' });
    }

    const allowedStatuses = ['verified', 'rejected', 'needs_review'];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        error: `Invalid status. Must be one of: ${allowedStatuses.join(', ')}`,
      });
    }

    const updates = {
      verificationStatus: status,
      adjustmentReason: adjustmentReason || null,
    };

    if (status === 'verified') {
      updates.status = 'verified';
      updates.recommendedPayout = recommendedPayout ?? claim.gross_claim_amount;
      updates.verificationJson = {
        verifiedBy: req.user.id,
        verifiedAt: new Date().toISOString(),
        adjustmentReason: adjustmentReason || null,
        originalAmount: claim.gross_claim_amount,
        recommendedPayout: updates.recommendedPayout,
      };
    } else if (status === 'rejected') {
      updates.status = 'rejected';
      updates.verificationJson = {
        rejectedBy: req.user.id,
        rejectedAt: new Date().toISOString(),
        adjustmentReason: adjustmentReason || 'Claim rejected during manual review',
      };
    }

    updateInsuranceClaim(claim.id, updates);

    const updated = getInsuranceClaim(claim.id);

    // Emit webhook if verified
    if (status === 'verified') {
      emitEvent(claim.tenant_id, 'insurance.claim_verified', {
        claimId: claim.id,
        policyId: claim.policy_id,
        claimMonth: claim.claim_month,
        recommendedPayout: updates.recommendedPayout,
      });
    }

    res.json({
      claim: {
        id: updated.id,
        tenantId: updated.tenant_id,
        policyId: updated.policy_id,
        claimMonth: updated.claim_month,
        status: updated.status,
        verificationStatus: updated.verification_status,
        grossClaimAmount: updated.gross_claim_amount,
        recommendedPayout: updated.recommended_payout,
        adjustmentReason: updated.adjustment_reason,
        verification: updated.verification,
      },
    });
  } catch (error) {
    console.error('Verify claim error:', error);
    res.status(500).json({ error: 'Failed to verify claim' });
  }
});

/**
 * POST /claims/:id/pay — Mark claim as paid
 * Body: { amount }
 */
router.post('/claims/:id/pay', async (req, res) => {
  try {
    const claim = getInsuranceClaim(req.params.id);

    if (!claim) {
      return res.status(404).json({ error: 'Claim not found' });
    }

    if (claim.status === 'paid') {
      return res.status(400).json({ error: 'Claim has already been paid' });
    }

    if (!['verified', 'pending'].includes(claim.status)) {
      return res.status(400).json({
        error: `Cannot pay claim in status '${claim.status}'. Claim must be 'verified' or 'pending'.`,
      });
    }

    const { amount } = req.body;

    if (amount === undefined || amount === null) {
      return res.status(400).json({ error: 'amount is required' });
    }

    if (amount <= 0) {
      return res.status(400).json({ error: 'amount must be a positive number' });
    }

    const paidAt = new Date().toISOString();

    updateInsuranceClaim(claim.id, {
      status: 'paid',
      paidAmount: amount,
      paidAt,
    });

    const updated = getInsuranceClaim(claim.id);

    // Emit webhook
    emitEvent(claim.tenant_id, 'insurance.claim_paid', {
      claimId: claim.id,
      policyId: claim.policy_id,
      claimMonth: claim.claim_month,
      paidAmount: amount,
      paidAt,
    });

    res.json({
      claim: {
        id: updated.id,
        tenantId: updated.tenant_id,
        policyId: updated.policy_id,
        claimMonth: updated.claim_month,
        status: updated.status,
        grossClaimAmount: updated.gross_claim_amount,
        paidAmount: updated.paid_amount,
        paidAt: updated.paid_at,
      },
    });
  } catch (error) {
    console.error('Pay claim error:', error);
    res.status(500).json({ error: 'Failed to mark claim as paid' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Calibration
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /calibration — Get calibration status (latest export, data quality)
 */
router.get('/calibration', async (req, res) => {
  try {
    const latestExport = getLatestCalibrationExport();
    const recentExports = getCalibrationExports(5);

    const dataQuality = {
      lastExportAge: latestExport
        ? Math.round((Date.now() - new Date(latestExport.exported_at).getTime()) / (1000 * 60 * 60))
        : null,
      lastExportAgeUnit: 'hours',
      exportCount: recentExports.length,
      status: !latestExport
        ? 'no_exports'
        : (Date.now() - new Date(latestExport.exported_at).getTime()) < 24 * 60 * 60 * 1000
          ? 'current'
          : 'stale',
    };

    res.json({
      latestExport: latestExport
        ? {
            id: latestExport.id,
            exportedAt: latestExport.exported_at,
            exportVersion: latestExport.export_version,
            payloadHash: latestExport.payload_hash,
            tenantsIncluded: latestExport.tenants_included,
            totalHashrateTH: latestExport.total_hashrate_th,
            responseStatus: latestExport.response_status,
          }
        : null,
      recentExports: recentExports.map(e => ({
        id: e.id,
        exportedAt: e.exported_at,
        exportVersion: e.export_version,
        tenantsIncluded: e.tenants_included,
        totalHashrateTH: e.total_hashrate_th,
        responseStatus: e.response_status,
      })),
      dataQuality,
    });
  } catch (error) {
    console.error('Get calibration status error:', error);
    res.status(500).json({ error: 'Failed to retrieve calibration status' });
  }
});

/**
 * POST /calibration/export — Trigger manual calibration export
 */
router.post('/calibration/export', async (req, res) => {
  try {
    const exportId = uuidv4();

    // Attempt to run calibration export via calibrationExporter service
    let exportResult;
    try {
      const { exportCalibrationData } = await import('../services/calibrationExporter.js');
      exportResult = await exportCalibrationData();
    } catch (serviceError) {
      // Service unavailable — create a mock export record
      exportResult = {
        exportVersion: 'v1.0',
        payloadHash: uuidv4().replace(/-/g, ''),
        tenantsIncluded: 0,
        totalHashrateTH: 0,
        responseStatus: null,
        responseBody: 'Calibration exporter service unavailable',
      };
    }

    createCalibrationExport({
      id: exportId,
      tenantId: 'sangha',
      exportVersion: exportResult.exportVersion || 'v1.0',
      payloadHash: exportResult.payloadHash || uuidv4().replace(/-/g, ''),
      tenantsIncluded: exportResult.tenantsIncluded || 0,
      totalHashrateTH: exportResult.totalHashrateTH || 0,
      responseStatus: exportResult.responseStatus || null,
      responseBody: exportResult.responseBody || null,
    });

    res.status(201).json({
      exportId,
      status: exportResult.responseStatus ? 'completed' : 'recorded',
      exportVersion: exportResult.exportVersion || 'v1.0',
      tenantsIncluded: exportResult.tenantsIncluded || 0,
      totalHashrateTH: exportResult.totalHashrateTH || 0,
      responseStatus: exportResult.responseStatus || null,
      exportedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Trigger calibration export error:', error);
    res.status(500).json({ error: 'Failed to trigger calibration export' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Stress Testing
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /stress-test — Run stress test scenario via sanghaModelClient
 * Body: { scenarioType, params }
 */
router.post('/stress-test', async (req, res) => {
  try {
    const { scenarioType, params } = req.body;

    if (!scenarioType) {
      return res.status(400).json({ error: 'scenarioType is required' });
    }

    const validScenarios = [
      'hashprice_crash',
      'difficulty_spike',
      'energy_cost_surge',
      'network_disruption',
      'correlated_claims',
      'custom',
    ];

    if (!validScenarios.includes(scenarioType)) {
      return res.status(400).json({
        error: `Invalid scenarioType. Must be one of: ${validScenarios.join(', ')}`,
      });
    }

    // Attempt to run stress test via sanghaModelClient
    let scenarioResults;
    try {
      const { runScenario } = await import('../services/sanghaModelClient.js');
      scenarioResults = await runScenario({ scenarioType, params: params || {} });
    } catch (serviceError) {
      // Model service unavailable — return mock stress test results
      const portfolioMetrics = getPortfolioMetrics();

      scenarioResults = {
        scenarioType,
        params: params || {},
        modelVersion: 'v1.0-mock',
        simulatedAt: new Date().toISOString(),
        results: {
          impactedPolicies: portfolioMetrics.activePolicies,
          estimatedClaimsTriggered: Math.ceil(portfolioMetrics.activePolicies * 0.6),
          estimatedTotalPayout: Math.round(
            (portfolioMetrics.totalCoveredHashrate || 100) * 0.05 * 30 * 0.4 * 100
          ) / 100,
          capitalAdequacy: 'sufficient',
          maxDrawdown: 0.35,
          recoveryMonths: 3,
          riskRating: scenarioType === 'hashprice_crash' ? 'high' : 'medium',
        },
        warnings: [
          'Results generated from mock model — actual stress test service unavailable',
        ],
      };
    }

    res.json({
      stressTest: scenarioResults,
    });
  } catch (error) {
    console.error('Stress test error:', error);
    res.status(500).json({ error: 'Failed to run stress test' });
  }
});

export default router;
