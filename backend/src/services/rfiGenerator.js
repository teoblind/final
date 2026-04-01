/**
 * RFI Generator
 *
 * Auto-detects missing information during takeoff review and
 * drafts Request for Information documents for GC submission.
 */

import { v4 as uuidv4 } from 'uuid';
import { createDacpRfi, getDacpRfis, updateDacpRfi, insertActivity } from '../cache/database.js';

// Common RFI categories for concrete subcontractor work
const RFI_TEMPLATES = {
  missing_detail: {
    category: 'scope',
    template: (detail, sheet) =>
      `Please provide ${detail}. This detail is referenced on ${sheet} but does not appear in the current plan set. We need this information to complete our concrete takeoff and pricing.`,
  },
  conflicting_info: {
    category: 'scope',
    template: (item, sheet1, sheet2) =>
      `There appears to be a conflict between ${sheet1} and ${sheet2} regarding ${item}. Please clarify which drawing takes precedence and provide the correct detail.`,
  },
  missing_spec: {
    category: 'specification',
    template: (spec) =>
      `The specifications do not appear to address ${spec}. Please provide the required specification for this item so we can obtain accurate pricing from our suppliers.`,
  },
  transformer_pad: {
    category: 'scope',
    template: (location) =>
      `Please provide size and details for the transformer pad${location ? ` at ${location}` : ''}. The architectural drawings reference "see structural" and the structural drawings do not include this detail.`,
  },
  concrete_strength: {
    category: 'specification',
    template: (area) =>
      `Please confirm the required concrete compressive strength (PSI) for ${area}. The specifications are unclear on the mix design requirements for this area.`,
  },
  rebar_coverage: {
    category: 'specification',
    template: (element) =>
      `Please confirm the required concrete cover for reinforcing steel in ${element}. The structural drawings do not specify the minimum cover requirement.`,
  },
  grade_elevation: {
    category: 'scope',
    template: (area) =>
      `Please provide the finish grade elevation for ${area}. This information is needed to calculate excavation and concrete quantities.`,
  },
  joint_layout: {
    category: 'scope',
    template: (area) =>
      `Please provide the control joint and expansion joint layout for ${area}. The architectural/structural drawings do not show the joint pattern.`,
  },
};

/**
 * Detect potential RFI needs from a bid request analysis.
 * Returns a list of suggested RFIs.
 */
export function detectRfiNeeds({ itbAnalysis, missingInfo, scopeBreakdown }) {
  const suggestions = [];

  // From ITB analysis missing_critical items
  if (itbAnalysis?.missing_critical) {
    for (const item of itbAnalysis.missing_critical) {
      suggestions.push({
        subject: `Missing Information: ${item}`,
        body: `Please provide clarification on the following: ${item}. This information is required to complete our estimate.`,
        category: 'scope',
        source: 'itb_analysis',
      });
    }
  }

  // From missing info JSON on bid request
  if (missingInfo) {
    const items = typeof missingInfo === 'string' ? JSON.parse(missingInfo) : missingInfo;
    if (Array.isArray(items)) {
      for (const item of items) {
        const itemText = typeof item === 'string' ? item : item.description || item.item || JSON.stringify(item);
        suggestions.push({
          subject: `Clarification Needed: ${itemText.slice(0, 80)}`,
          body: `We need additional information regarding: ${itemText}. Please advise so we can provide accurate pricing.`,
          category: 'scope',
          source: 'bid_review',
        });
      }
    }
  }

  // From spec parser rfi_needed items
  if (itbAnalysis?.rfi_needed) {
    for (const rfi of itbAnalysis.rfi_needed) {
      suggestions.push({
        subject: rfi.subject,
        body: rfi.question,
        category: 'specification',
        source: 'spec_parser',
      });
    }
  }

  return suggestions;
}

/**
 * Generate RFI drafts for a bid request and save to DB.
 */
export function generateRfiDrafts(tenantId, { bidRequestId, gcName, gcEmail, projectName, suggestions }) {
  const rfis = [];

  for (const s of suggestions) {
    const id = uuidv4();
    const rfi = {
      id,
      tenantId,
      bidRequestId,
      gcName,
      gcEmail,
      subject: `RFI - ${projectName}: ${s.subject}`,
      body: s.body,
      category: s.category || 'scope',
      status: 'draft',
    };

    createDacpRfi(rfi);
    rfis.push(rfi);
  }

  if (rfis.length > 0) {
    insertActivity({
      tenantId,
      type: 'agent',
      title: `Generated ${rfis.length} RFI drafts for ${projectName}`,
      subtitle: `To: ${gcName}`,
      detailJson: JSON.stringify({ bidRequestId, rfiCount: rfis.length, categories: rfis.map(r => r.category) }),
      sourceType: 'estimate',
      sourceId: bidRequestId,
      agentId: 'estimating',
    });
  }

  return rfis;
}

/**
 * Format an RFI for email sending.
 */
export function formatRfiEmail(rfi, { companyName = 'DACP Construction', contactName, contactPhone, contactEmail }) {
  return {
    to: rfi.gcEmail || rfi.gc_email,
    subject: rfi.subject,
    body: `${rfi.gc_name || rfi.gcName},

${rfi.body || rfi.body}

Please respond at your earliest convenience as we are working to finalize our estimate.

Thank you,
${contactName || companyName}
${contactPhone ? `Phone: ${contactPhone}` : ''}
${contactEmail ? `Email: ${contactEmail}` : ''}`,
  };
}

/**
 * Use a template to generate a specific RFI.
 */
export function generateFromTemplate(templateKey, ...args) {
  const template = RFI_TEMPLATES[templateKey];
  if (!template) return null;
  return {
    subject: `RFI: ${templateKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}`,
    body: template.template(...args),
    category: template.category,
  };
}

/**
 * Build a Claude prompt for complex RFI generation.
 */
export function buildRfiPrompt(projectName, scopeDescription, missingItems) {
  return `You are a concrete subcontractor's estimator reviewing plans for "${projectName}".

The following items are missing or unclear from the bid documents:
${missingItems.map((item, i) => `${i + 1}. ${item}`).join('\n')}

Project scope: ${scopeDescription}

For each missing item, draft a professional, concise RFI (Request for Information) to send to the general contractor. Each RFI should:
- Be specific about what information is needed
- Reference the relevant drawing sheet or spec section if known
- Explain why this information is needed for pricing
- Be 2-4 sentences maximum

Return as JSON array:
[{"subject": "RFI subject line", "body": "RFI body text", "category": "scope|specification|schedule|coordination"}]`;
}

export default { detectRfiNeeds, generateRfiDrafts, formatRfiEmail, generateFromTemplate, buildRfiPrompt };
