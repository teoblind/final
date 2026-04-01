/**
 * Multi-GC Bid Distribution
 *
 * As a subcontractor, DACP can bid the same project to multiple GCs.
 * This service manages creating adjusted bids per GC based on
 * reputation, payment history, and relationship.
 */

import { v4 as uuidv4 } from 'uuid';
import { createDacpBidDistribution, getDacpBidDistributions, updateDacpBidDistribution, insertActivity } from '../cache/database.js';

// GC reputation tiers affect pricing adjustments
const REPUTATION_ADJUSTMENTS = {
  excellent: { label: 'Preferred - runs jobs well, pays on time', priceFactor: 0.97 },  // 3% discount
  good: { label: 'Good track record', priceFactor: 1.0 },       // Standard pricing
  average: { label: 'Average - some issues', priceFactor: 1.03 }, // 3% premium
  poor: { label: 'Poor - payment/management issues', priceFactor: 1.08 }, // 8% premium
  unknown: { label: 'No history', priceFactor: 1.02 }, // 2% risk premium
};

/**
 * Create bid distributions for multiple GCs from a single estimate.
 */
export function createBidDistributions(tenantId, { bidRequestId, estimateId, projectName, baseBidTotal, gcList }) {
  const distributions = [];

  for (const gc of gcList) {
    const reputation = gc.reputation || 'unknown';
    const adjustment = REPUTATION_ADJUSTMENTS[reputation] || REPUTATION_ADJUSTMENTS.unknown;
    const adjustedTotal = Math.round(baseBidTotal * adjustment.priceFactor / 100) * 100; // Round to nearest $100

    const dist = {
      id: uuidv4(),
      tenantId,
      bidRequestId,
      estimateId,
      projectName,
      gcName: gc.name,
      gcEmail: gc.email,
      gcContact: gc.contact,
      gcReputation: reputation,
      adjustedTotal,
      adjustmentReason: adjustment.label + (adjustment.priceFactor !== 1.0 ? ` (${((adjustment.priceFactor - 1) * 100).toFixed(0)}% adjustment)` : ''),
      bidStatus: 'draft',
    };

    createDacpBidDistribution(dist);
    distributions.push(dist);
  }

  if (distributions.length > 0) {
    insertActivity({
      tenantId,
      type: 'agent',
      title: `Created ${distributions.length} bid distributions for ${projectName}`,
      subtitle: `Base bid: $${baseBidTotal.toLocaleString()} | GCs: ${distributions.map(d => d.gcName).join(', ')}`,
      detailJson: JSON.stringify({
        bidRequestId,
        estimateId,
        baseBidTotal,
        distributions: distributions.map(d => ({ gc: d.gcName, adjusted: d.adjustedTotal, reputation: d.gcReputation })),
      }),
      sourceType: 'estimate',
      sourceId: bidRequestId,
      agentId: 'estimating',
    });
  }

  return distributions;
}

/**
 * Get a comparison view of all bid distributions for a project.
 */
export function getBidComparison(tenantId, bidRequestId) {
  const dists = getDacpBidDistributions(tenantId, bidRequestId);

  const summary = {
    totalGCs: dists.length,
    sent: dists.filter(d => d.bid_status === 'sent').length,
    responded: dists.filter(d => d.bid_status === 'responded' || d.response_amount).length,
    awarded: dists.filter(d => d.award_status === 'won').length,
    priceRange: {
      min: Math.min(...dists.map(d => d.adjusted_total).filter(Boolean)),
      max: Math.max(...dists.map(d => d.adjusted_total).filter(Boolean)),
    },
    distributions: dists,
  };

  return summary;
}

/**
 * Draft a bid submission email for a specific GC.
 */
export function draftBidEmail(distribution, { companyName = 'DACP Construction', contactName, contactPhone, contactEmail, inclusions, exclusions }) {
  const gcName = distribution.gc_name || distribution.gcName;
  const projectName = distribution.project_name || distribution.projectName;
  const total = distribution.adjusted_total || distribution.adjustedTotal;

  return {
    to: distribution.gc_email || distribution.gcEmail,
    subject: `Concrete Bid: ${projectName}`,
    body: `${gcName},

Please find our pricing below for the concrete scope on ${projectName}.

Total Bid Amount: $${total?.toLocaleString()}

${inclusions ? `INCLUSIONS:\n${inclusions}\n` : ''}
${exclusions ? `EXCLUSIONS:\n${exclusions}\n` : ''}

This pricing is valid for 30 days from the date of this submission. We look forward to the opportunity to work with you on this project.

Please do not hesitate to contact us with any questions.

Best regards,
${contactName || companyName}
${contactPhone ? `Phone: ${contactPhone}` : ''}
${contactEmail ? `Email: ${contactEmail}` : ''}`,
  };
}

/**
 * Mark a distribution as sent.
 */
export function markBidSent(tenantId, distId) {
  return updateDacpBidDistribution(tenantId, distId, {
    bidStatus: 'sent',
    sentDate: new Date().toISOString(),
  });
}

/**
 * Record a GC response.
 */
export function recordGcResponse(tenantId, distId, { responseAmount, awardStatus, notes }) {
  const updates = {
    bidStatus: 'responded',
    responseDate: new Date().toISOString(),
  };
  if (responseAmount !== undefined) updates.responseAmount = responseAmount;
  if (awardStatus) updates.awardStatus = awardStatus;
  if (notes) updates.notes = notes;

  return updateDacpBidDistribution(tenantId, distId, updates);
}

/**
 * Build a Claude prompt to identify GCs bidding on a project.
 */
export function buildGcDiscoveryPrompt(projectName, projectLocation, projectType) {
  return `Research which general contractors are likely bidding on the following project:

Project: ${projectName}
Location: ${projectLocation}
Type: ${projectType || 'Commercial construction'}

Search for:
1. General contractors active in the ${projectLocation} area
2. GCs that specialize in ${projectType || 'commercial'} projects
3. Any public bid listings for this project

Return as JSON:
{
  "gcs": [
    {
      "name": "GC Company Name",
      "email": "contact email if found",
      "contact": "contact person name",
      "reputation": "excellent|good|average|poor|unknown",
      "notes": "why they might be bidding this"
    }
  ],
  "sources": ["where this info was found"]
}`;
}

export default { createBidDistributions, getBidComparison, draftBidEmail, markBidSent, recordGcResponse, buildGcDiscoveryPrompt };
