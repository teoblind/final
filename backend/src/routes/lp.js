/**
 * LP (Balance Sheet Partner) API Routes
 *
 * Endpoints for LP users to view their portfolio, review allocations,
 * manage claims, and track settlements.
 * Requires 'balance_sheet_partner' role.
 */

import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import {
  getLPPortfolioMetrics,
  getLPAllocations,
  getLPAllocation,
  updateLPAllocation,
  getLPPolicies,
  getLPClaims,
  updateInsuranceClaim,
  getBalanceSheetPartner,
  updateQuoteRequest,
  getQuoteRequest,
  insertAuditLog,
} from '../cache/database.js';
import crypto from 'crypto';
import db from '../cache/database.js';

const router = Router();

// All LP routes require authentication and the balance_sheet_partner role
router.use(authenticate, requireRole('balance_sheet_partner'));

// Resolve the LP entity for the authenticated user.
// The LP ID is stored in the user's tenant_id (LP users are assigned to an LP-typed tenant).
function getLPId(req) {
  // LP id is stored in user metadata or derived from tenant
  return req.user.tenantId;
}

// ─── Portfolio Overview ──────────────────────────────────────────────────────

router.get('/portfolio', (req, res) => {
  try {
    const lpId = getLPId(req);
    const metrics = getLPPortfolioMetrics(lpId);
    const lp = getBalanceSheetPartner(lpId);
    res.json({
      partner: lp ? { name: lp.name, shortName: lp.short_name, status: lp.status } : null,
      ...metrics,
    });
  } catch (err) {
    console.error('LP portfolio error:', err);
    res.status(500).json({ error: 'Failed to load portfolio' });
  }
});

// ─── Pending Allocations ─────────────────────────────────────────────────────

router.get('/allocations', (req, res) => {
  try {
    const lpId = getLPId(req);
    const status = req.query.status || null;
    const allocations = getLPAllocations(lpId, status);
    res.json({ allocations, total: allocations.length });
  } catch (err) {
    console.error('LP allocations error:', err);
    res.status(500).json({ error: 'Failed to load allocations' });
  }
});

router.get('/allocations/:id', (req, res) => {
  try {
    const alloc = getLPAllocation(req.params.id);
    if (!alloc || alloc.lp_id !== getLPId(req)) {
      return res.status(404).json({ error: 'Allocation not found' });
    }
    res.json({ allocation: alloc });
  } catch (err) {
    console.error('LP allocation detail error:', err);
    res.status(500).json({ error: 'Failed to load allocation' });
  }
});

// ─── Allocation Actions ──────────────────────────────────────────────────────

router.post('/allocations/:id/approve', (req, res) => {
  try {
    const alloc = getLPAllocation(req.params.id);
    if (!alloc || alloc.lp_id !== getLPId(req)) {
      return res.status(404).json({ error: 'Allocation not found' });
    }
    if (alloc.status !== 'pending') {
      return res.status(400).json({ error: `Cannot approve allocation in '${alloc.status}' status` });
    }
    const now = new Date().toISOString();
    updateLPAllocation(alloc.id, {
      status: 'approved',
      reviewedAt: now,
      reviewedBy: req.user.id,
      reviewNotes: req.body.notes || null,
    });

    // Update the quote request to quote_issued
    const qr = getQuoteRequest(alloc.quote_request_id);
    if (qr) {
      updateQuoteRequest(alloc.quote_request_id, { status: 'quote_issued', reviewedAt: now });
    }

    insertAuditLog({
      id: crypto.randomUUID(), tenant_id: getLPId(req), user_id: req.user.id,
      action: 'lp_allocation_approved', resource_type: 'lp_allocation', resource_id: alloc.id,
      details: JSON.stringify({ quoteRequestId: alloc.quote_request_id }),
    });

    res.json({ status: 'approved' });
  } catch (err) {
    console.error('LP approve error:', err);
    res.status(500).json({ error: 'Failed to approve allocation' });
  }
});

router.post('/allocations/:id/reject', (req, res) => {
  try {
    const alloc = getLPAllocation(req.params.id);
    if (!alloc || alloc.lp_id !== getLPId(req)) {
      return res.status(404).json({ error: 'Allocation not found' });
    }
    if (alloc.status !== 'pending') {
      return res.status(400).json({ error: `Cannot reject allocation in '${alloc.status}' status` });
    }
    updateLPAllocation(alloc.id, {
      status: 'rejected',
      reviewedAt: new Date().toISOString(),
      reviewedBy: req.user.id,
      reviewNotes: req.body.reason || null,
    });

    updateQuoteRequest(alloc.quote_request_id, { status: 'lp_rejected' });

    insertAuditLog({
      id: crypto.randomUUID(), tenant_id: getLPId(req), user_id: req.user.id,
      action: 'lp_allocation_rejected', resource_type: 'lp_allocation', resource_id: alloc.id,
      details: JSON.stringify({ reason: req.body.reason }),
    });

    res.json({ status: 'rejected' });
  } catch (err) {
    console.error('LP reject error:', err);
    res.status(500).json({ error: 'Failed to reject allocation' });
  }
});

router.post('/allocations/:id/modify', (req, res) => {
  try {
    const alloc = getLPAllocation(req.params.id);
    if (!alloc || alloc.lp_id !== getLPId(req)) {
      return res.status(404).json({ error: 'Allocation not found' });
    }
    if (alloc.status !== 'pending') {
      return res.status(400).json({ error: `Cannot modify allocation in '${alloc.status}' status` });
    }
    const { modification } = req.body;
    if (!modification) {
      return res.status(400).json({ error: 'Modification description is required' });
    }
    updateLPAllocation(alloc.id, {
      status: 'modification_requested',
      reviewedAt: new Date().toISOString(),
      reviewedBy: req.user.id,
      modificationRequested: modification,
    });

    updateQuoteRequest(alloc.quote_request_id, { status: 'lp_revision_requested' });

    insertAuditLog({
      id: crypto.randomUUID(), tenant_id: getLPId(req), user_id: req.user.id,
      action: 'lp_modification_requested', resource_type: 'lp_allocation', resource_id: alloc.id,
      details: JSON.stringify({ modification }),
    });

    res.json({ status: 'modification_requested' });
  } catch (err) {
    console.error('LP modify error:', err);
    res.status(500).json({ error: 'Failed to request modification' });
  }
});

// ─── Active Policies ─────────────────────────────────────────────────────────

router.get('/policies', (req, res) => {
  try {
    const lpId = getLPId(req);
    // Return policies but strip miner-identifying info
    const policies = getLPPolicies(lpId).map(p => ({
      id: p.id,
      policyNumber: p.policy_number,
      instrumentType: p.instrument_type,
      status: p.status,
      floorPrice: p.floor_price,
      monthlyPremium: p.monthly_premium,
      coveredHashrate: p.covered_hashrate,
      termMonths: p.term_months,
      startDate: p.start_date,
      endDate: p.end_date,
      // No tenant_name, no tenant_id - LP sees policy-level data only
    }));
    res.json({ policies, total: policies.length });
  } catch (err) {
    console.error('LP policies error:', err);
    res.status(500).json({ error: 'Failed to load policies' });
  }
});

// ─── Claims & Settlements ────────────────────────────────────────────────────

router.get('/claims', (req, res) => {
  try {
    const lpId = getLPId(req);
    const claims = getLPClaims(lpId, req.query.status || null).map(c => ({
      id: c.id,
      policyNumber: c.policy_number,
      claimMonth: c.claim_month,
      status: c.status,
      grossClaimAmount: c.gross_claim_amount,
      recommendedPayout: c.recommended_payout,
      paidAmount: c.paid_amount,
      settlementStatus: c.settlement_status,
      settledAt: c.settled_at,
      settlementReference: c.settlement_reference,
    }));
    res.json({ claims, total: claims.length });
  } catch (err) {
    console.error('LP claims error:', err);
    res.status(500).json({ error: 'Failed to load claims' });
  }
});

router.get('/claims/:id/verification', (req, res) => {
  try {
    const lpId = getLPId(req);
    const claims = getLPClaims(lpId);
    const claim = claims.find(c => c.id === req.params.id);
    if (!claim) {
      return res.status(404).json({ error: 'Claim not found' });
    }
    // Return sanitized verification - aggregate stats, no raw telemetry
    const verification = claim.verification || {};
    res.json({
      claimId: claim.id,
      claimMonth: claim.claim_month,
      verificationSummary: {
        fleetUptimePercent: verification.fleetUptimePercent || null,
        hashrateMatchPercent: verification.hashrateMatchPercent || null,
        energyCostVerified: verification.energyCostVerified || null,
        dataQuality: verification.dataQuality || 'standard',
      },
      grossClaim: claim.gross_claim_amount,
      recommendedPayout: claim.recommended_payout,
    });
  } catch (err) {
    console.error('LP claim verification error:', err);
    res.status(500).json({ error: 'Failed to load verification' });
  }
});

router.post('/claims/:id/settle', (req, res) => {
  try {
    const lpId = getLPId(req);
    const claims = getLPClaims(lpId);
    const claim = claims.find(c => c.id === req.params.id);
    if (!claim) {
      return res.status(404).json({ error: 'Claim not found' });
    }
    const { settlementReference } = req.body;
    updateInsuranceClaim(claim.id, {
      status: 'paid',
      paidAmount: claim.recommended_payout || claim.gross_claim_amount,
      paidAt: new Date().toISOString(),
    });
    // Update settlement tracking columns
    db.prepare(`UPDATE insurance_claims SET settlement_status = 'settled_by_lp', settled_at = datetime('now'), settlement_reference = ? WHERE id = ?`).run(settlementReference || null, claim.id);

    insertAuditLog({
      id: crypto.randomUUID(), tenant_id: lpId, user_id: req.user.id,
      action: 'lp_claim_settled', resource_type: 'insurance_claim', resource_id: claim.id,
      details: JSON.stringify({ settlementReference }),
    });

    res.json({ status: 'settled' });
  } catch (err) {
    console.error('LP settle error:', err);
    res.status(500).json({ error: 'Failed to settle claim' });
  }
});

router.post('/claims/:id/dispute', (req, res) => {
  try {
    const lpId = getLPId(req);
    const claims = getLPClaims(lpId);
    const claim = claims.find(c => c.id === req.params.id);
    if (!claim) {
      return res.status(404).json({ error: 'Claim not found' });
    }
    const { reason } = req.body;
    if (!reason) {
      return res.status(400).json({ error: 'Dispute reason is required' });
    }
    db.prepare(`UPDATE insurance_claims SET settlement_status = 'disputed_by_lp', updated_at = datetime('now') WHERE id = ?`).run(claim.id);

    insertAuditLog({
      id: crypto.randomUUID(), tenant_id: lpId, user_id: req.user.id,
      action: 'lp_claim_disputed', resource_type: 'insurance_claim', resource_id: claim.id,
      details: JSON.stringify({ reason }),
    });

    res.json({ status: 'disputed' });
  } catch (err) {
    console.error('LP dispute error:', err);
    res.status(500).json({ error: 'Failed to dispute claim' });
  }
});

// ─── Settlements History ─────────────────────────────────────────────────────

router.get('/settlements', (req, res) => {
  try {
    const lpId = getLPId(req);
    const settled = getLPClaims(lpId, 'settled_by_lp').map(c => ({
      claimId: c.id,
      policyNumber: c.policy_number,
      claimMonth: c.claim_month,
      amount: c.paid_amount,
      settledAt: c.settled_at,
      reference: c.settlement_reference,
    }));
    res.json({ settlements: settled });
  } catch (err) {
    console.error('LP settlements error:', err);
    res.status(500).json({ error: 'Failed to load settlements' });
  }
});

// ─── Performance Metrics ─────────────────────────────────────────────────────

router.get('/performance', (req, res) => {
  try {
    const lpId = getLPId(req);
    const metrics = getLPPortfolioMetrics(lpId);
    const lp = getBalanceSheetPartner(lpId);
    const feeStructure = lp?.feeStructure || {};
    const managementFeeAnnual = (metrics.capitalDeployed * (feeStructure.managementFeePercent || 1)) / 100;
    const netIncome = (metrics.monthlyPremiumIncome * 12) - (metrics.totalClaimsPaid);
    const sanghaFees = (metrics.monthlyPremiumIncome * 12 * (feeStructure.structuringFeePercent || 5)) / 100 + managementFeeAnnual;

    res.json({
      ...metrics,
      annualPremiumIncome: metrics.monthlyPremiumIncome * 12,
      netIncomePreFees: netIncome,
      sanghaFeesPaid: sanghaFees,
      netIncomePostFees: netIncome - sanghaFees,
      returnOnDeployedCapital: metrics.capitalDeployed ? (netIncome - sanghaFees) / metrics.capitalDeployed : 0,
    });
  } catch (err) {
    console.error('LP performance error:', err);
    res.status(500).json({ error: 'Failed to load performance' });
  }
});

export default router;
