/**
 * Construction Copilot - Steps 1, 5, 8 of the DACP Estimating Workflow
 *
 * Step 1: ITB Analysis - Deep-parse an invitation to bid, extract scope, specs,
 *         compliance requirements, flag missing info, recommend bid/no-bid.
 * Step 5: Supplier Quote Drafting - Generate email drafts to material suppliers
 *         with specs, quantities, and project context for pricing requests.
 * Step 8: Contract vs Proposal Comparison - Line-by-line comparison of GC contract
 *         against DACP proposal, flagging scope additions, missing exclusions,
 *         and financial discrepancies.
 */

import Anthropic from '@anthropic-ai/sdk';
import { tunnelPrompt } from './cliTunnel.js';

const anthropic = new Anthropic();

// ─── Step 1: ITB Analysis ──────────────────────────────────────────────────

const ITB_ANALYSIS_PROMPT = `You are DACP Construction's pre-construction AI analyst. You specialize in analyzing Invitations to Bid (ITBs) for concrete and masonry subcontract work.

Given the following bid request details, perform a comprehensive analysis:

BID REQUEST:
From: {from_name} <{from_email}>
GC: {gc_name}
Subject: {subject}
Due Date: {due_date}
Attachments: {attachments}

Body:
{body}

Scope Items:
{scope_items}

Missing Information Flagged:
{missing_info}

Analyze and return a JSON object with these sections:

{
  "project_summary": {
    "name": "project name",
    "location": "city/state if mentioned",
    "owner": "building owner if mentioned",
    "gc": "general contractor",
    "architect": "if mentioned",
    "bid_due": "date",
    "pre_bid_meeting": "date/time if mentioned",
    "project_type": "commercial/infrastructure/institutional/industrial/residential"
  },
  "scope_analysis": {
    "csi_divisions": ["03 - Concrete", "04 - Masonry", etc.],
    "concrete_elements": [
      {"element": "name", "quantity": "value", "unit": "unit", "notes": "any special requirements"}
    ],
    "estimated_total_cy": "number or range",
    "estimated_duration_weeks": "number or range",
    "complexity": "simple|medium|complex",
    "complexity_factors": ["list of factors that affect complexity"]
  },
  "spec_requirements": {
    "concrete_strength": "psi requirements mentioned",
    "rebar_grade": "if mentioned",
    "special_concrete": "any specialty mixes (Type V, lightweight, etc.)",
    "formwork_notes": "if any specific formwork requirements",
    "curing_requirements": "if mentioned",
    "testing_requirements": "if mentioned"
  },
  "compliance_requirements": {
    "dbe_required": true/false,
    "dbe_percentage": "if specified",
    "prevailing_wage": true/false,
    "buy_america": true/false,
    "prequalification_required": true/false,
    "bonding_required": "if mentioned",
    "security_clearance": true/false,
    "night_work": true/false,
    "other": ["any other compliance items"]
  },
  "missing_critical": [
    {"item": "what's missing", "impact": "how it affects bid", "action": "what DACP should request"}
  ],
  "risk_factors": [
    {"risk": "description", "severity": "high|medium|low", "mitigation": "suggested approach"}
  ],
  "bid_recommendation": {
    "recommend": "bid|no-bid|conditional",
    "confidence": "high|medium|low",
    "reasoning": "2-3 sentence explanation",
    "conditions": ["conditions that must be met if conditional"]
  },
  "next_steps": [
    {"step": "description", "priority": "high|medium|low", "deadline": "if applicable"}
  ]
}

Be thorough but practical. Flag anything that could cause DACP to lose money. DACP is a concrete/masonry sub - only analyze scope relevant to their trade. Return ONLY the JSON, no other text.`;

export async function analyzeItb(bidRequest) {
  const prompt = ITB_ANALYSIS_PROMPT
    .replace('{from_name}', bidRequest.from_name || '')
    .replace('{from_email}', bidRequest.from_email || '')
    .replace('{gc_name}', bidRequest.gc_name || '')
    .replace('{subject}', bidRequest.subject || '')
    .replace('{due_date}', bidRequest.due_date || 'Not specified')
    .replace('{attachments}', JSON.stringify(bidRequest.attachments || []))
    .replace('{body}', bidRequest.body || '')
    .replace('{scope_items}', JSON.stringify(bidRequest.scope?.items || []))
    .replace('{missing_info}', JSON.stringify(bidRequest.missing_info || []));

  const text = await tunnelPrompt({
    tenantId: 'dacp-construction-001',
    agentId: 'estimating',
    prompt,
    maxTurns: 3,
    timeoutMs: 120_000,
    label: 'ITB Analysis',
  });

  // Extract JSON from response (handle potential markdown wrapping)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Failed to parse ITB analysis response');

  return JSON.parse(jsonMatch[0]);
}


// ─── Step 5: Supplier Quote Drafting ───────────────────────────────────────

const SUPPLIER_TEMPLATES = {
  concrete: {
    default_suppliers: [
      { name: 'Patrick Ready Mix', email: 'quotes@patrickreadymix.com', phone: '(504) 555-0142', rep: 'Patrick Didier', notes: 'Preferred - excellent reliability and service history' },
      { name: 'Boral Ready Mix', email: 'neworleans@boralrm.com', phone: '(504) 555-0198', rep: 'Sales Department', notes: 'Competitive pricing, good availability' },
      { name: 'Argos Ready Mix', email: 'quotes.nola@argos-us.com', phone: '(504) 555-0221', rep: 'Regional Sales', notes: 'Large fleet, good for high-volume pours' },
    ],
  },
  rebar: {
    default_suppliers: [
      { name: 'Commercial Metals Company (CMC)', email: 'quotes@cmcrebar.com', phone: '(504) 555-0167', rep: 'Sales Team', notes: 'Full fabrication and delivery' },
      { name: 'Harris Rebar', email: 'nola.sales@harrisrebar.com', phone: '(504) 555-0189', rep: 'Estimating', notes: 'Fast turnaround on fab drawings' },
    ],
  },
  masonry: {
    default_suppliers: [
      { name: 'Acme Brick', email: 'quotes@acmebrick.com', phone: '(504) 555-0134', rep: 'LA Sales', notes: 'Wide product selection' },
      { name: 'Boral Masonry', email: 'masonry.quotes@boral.com', phone: '(504) 555-0156', rep: 'Sales Department', notes: 'CMU and specialty block' },
    ],
  },
  formwork: {
    default_suppliers: [
      { name: 'PERI Formwork', email: 'rental.south@peri-usa.com', phone: '(504) 555-0212', rep: 'Rental Dept', notes: 'Metal form rental - good for complex pours' },
    ],
  },
};

export function draftSupplierQuotes(projectName, gcName, bidDueDate, materials, projectLocation) {
  const quotes = [];

  for (const mat of materials) {
    const category = mat.category?.toLowerCase() || 'concrete';
    const suppliers = SUPPLIER_TEMPLATES[category]?.default_suppliers || SUPPLIER_TEMPLATES.concrete.default_suppliers;

    // Draft email for the preferred (first) supplier
    const supplier = suppliers[0];
    const alternates = suppliers.slice(1);

    const emailBody = generateSupplierEmailBody({
      supplierRep: supplier.rep,
      supplierName: supplier.name,
      projectName,
      gcName,
      projectLocation: projectLocation || 'New Orleans, LA area',
      bidDueDate,
      materialType: mat.type || category,
      specifications: mat.specifications || [],
      quantities: mat.quantities || [],
      deliveryNotes: mat.delivery_notes || '',
      specialRequirements: mat.special_requirements || '',
    });

    quotes.push({
      category,
      supplier: supplier.name,
      supplier_email: supplier.email,
      supplier_rep: supplier.rep,
      supplier_notes: supplier.notes,
      alternate_suppliers: alternates.map(s => ({ name: s.name, email: s.email, notes: s.notes })),
      email_draft: {
        to: supplier.email,
        subject: `Quote Request: ${projectName} - ${mat.type || category}`,
        body: emailBody,
      },
    });
  }

  return quotes;
}

function generateSupplierEmailBody({ supplierRep, supplierName, projectName, gcName, projectLocation, bidDueDate, materialType, specifications, quantities, deliveryNotes, specialRequirements }) {
  let body = `${supplierRep},

DACP Construction is bidding on the ${projectName} project${gcName ? ` for ${gcName}` : ''} in ${projectLocation}. We need pricing on the following ${materialType} materials:

PROJECT: ${projectName}
LOCATION: ${projectLocation}
GC: ${gcName || 'TBD'}
BID DUE: ${bidDueDate || 'TBD'}
`;

  if (quantities.length > 0) {
    body += `\nQUANTITIES:\n`;
    for (const q of quantities) {
      body += `  - ${q}\n`;
    }
  }

  if (specifications.length > 0) {
    body += `\nSPECIFICATIONS:\n`;
    for (const spec of specifications) {
      body += `  - ${spec}\n`;
    }
  }

  if (specialRequirements) {
    body += `\nSPECIAL REQUIREMENTS:\n  ${specialRequirements}\n`;
  }

  if (deliveryNotes) {
    body += `\nDELIVERY NOTES:\n  ${deliveryNotes}\n`;
  }

  body += `
Please provide:
1. Unit pricing for each item listed above
2. Delivery lead time
3. Minimum order quantities (if any)
4. Any applicable volume discounts
5. Pump services availability and pricing (if applicable)

We need your quote by ${bidDueDate ? new Date(new Date(bidDueDate).getTime() - 3 * 86400000).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '3 days before bid deadline'} to incorporate into our bid.

Thank you,

Tom Mangan
Senior Estimator & Project Manager
DACP Construction LLC
(985) 306-4005
estimating@dacpconstruction.com`;

  return body;
}


// ─── Step 8: Contract vs Proposal Comparison ───────────────────────────────

const CONTRACT_COMPARISON_PROMPT = `You are DACP Construction's contract review specialist. Compare the following DACP proposal against the General Contractor's subcontract and identify ALL discrepancies.

DACP PROPOSAL:
{proposal_text}

GC SUBCONTRACT:
{contract_text}

Perform a thorough comparison and return a JSON object:

{
  "summary": {
    "proposal_project": "project name from proposal",
    "contract_project": "project name from contract",
    "gc_name": "GC name",
    "proposal_amount": "bid amount from proposal if mentioned",
    "contract_amount": "contract amount if mentioned",
    "amount_match": true/false,
    "overall_risk": "low|medium|high|critical"
  },
  "scope_comparison": {
    "in_both": [
      {"item": "description", "notes": "any differences in wording/detail"}
    ],
    "in_proposal_only": [
      {"item": "description", "risk": "DACP committed to this but contract doesn't include it - clarify if DACP is still responsible"}
    ],
    "in_contract_only": [
      {"item": "description", "risk": "high|medium|low", "impact": "This scope was NOT in DACP's bid - potential cost exposure", "estimated_impact": "rough $ impact if possible"}
    ]
  },
  "exclusion_comparison": {
    "exclusions_honored": [
      {"item": "description", "status": "properly excluded in contract"}
    ],
    "exclusions_missing": [
      {"item": "description from DACP proposal exclusions", "risk": "critical|high|medium", "impact": "If not in contract, DACP may be responsible for this cost", "action": "Must add to contract before signing"}
    ],
    "new_exclusions_in_contract": [
      {"item": "description", "notes": "GC added exclusion not in proposal"}
    ]
  },
  "financial_flags": [
    {"issue": "description", "severity": "critical|high|medium|low", "action": "what DACP should do"}
  ],
  "legal_flags": [
    {"clause": "description of concerning clause", "concern": "why it's risky", "severity": "critical|high|medium|low", "recommendation": "suggested change"}
  ],
  "recommended_redlines": [
    {"section": "where in contract", "current_language": "what it says now", "proposed_change": "what DACP should request", "priority": "must-have|should-have|nice-to-have", "reasoning": "why this matters"}
  ],
  "action_items": [
    {"action": "what DACP needs to do", "priority": "immediate|before-signing|after-signing", "responsible": "Tom/Danny/Legal"}
  ]
}

Be aggressive in protecting DACP's interests. Flag EVERYTHING that could cost DACP money. Missing exclusions are the #1 risk - if DACP excluded something in their proposal but it's not excluded in the contract, DACP is on the hook. Return ONLY the JSON.`;

export async function compareContractProposal(proposalText, contractText) {
  const prompt = CONTRACT_COMPARISON_PROMPT
    .replace('{proposal_text}', proposalText)
    .replace('{contract_text}', contractText);

  const text = await tunnelPrompt({
    tenantId: 'dacp-construction-001',
    agentId: 'estimating',
    prompt,
    maxTurns: 3,
    timeoutMs: 120_000,
    label: 'Contract Comparison',
  });

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Failed to parse contract comparison response');

  return JSON.parse(jsonMatch[0]);
}


// ─── Demo Data: Rich ITB with Spec Content ─────────────────────────────────

export const DEMO_ITB = {
  id: 'BR-DEMO-001',
  from_email: 'lthompson@renegadeconstruction.com',
  from_name: 'Lisa Thompson',
  gc_name: 'Renegade Construction (RNGD)',
  subject: 'ITB: Riverside Commerce Center - Concrete & Masonry Package',
  body: `Tom,

Renegade is soliciting bids for the concrete and masonry scope on the Riverside Commerce Center project in Kenner, LA. This is a 3-story mixed-use building (retail ground floor, office above) with structured parking.

Project Details:
- Owner: Riverside Development Partners LLC
- Architect: HKS Architects (Dallas)
- Plans Dated: February 15, 2026
- Addenda: #1 issued March 5, 2026

Bid Due: April 1, 2026 by 2:00 PM CST
Pre-Bid Meeting: March 25, 2026 at 10:00 AM - project site, 400 Riverside Dr, Kenner, LA 70062

Plans are available on BuildingConnected. Access code: RNGD-RSC-2026

This is a Jefferson Parish project. DBE participation goal is 30%. Buy America provisions apply.

We need pricing on:
- All structural concrete (foundations, SOG, elevated decks, columns, beams, stairs)
- All masonry (CMU backup walls, brick veneer)
- Site concrete (sidewalks, curb & gutter, loading dock)

Specification Highlights (Division 03):
- Concrete: 4,000 psi normal weight (foundations, columns, beams)
- Concrete: 5,000 psi (post-tension elevated decks)
- Rebar: ASTM A615 Grade 60
- PT system: VSL or approved equal
- Formwork: architectural finish required on exposed columns (Class B finish per ACI 347)
- Curing: ASTM C309 Type 1-D moisture-retaining compound
- Testing: Contractor to provide test cylinders - 4 per 50 CY minimum

Specification Highlights (Division 04):
- CMU: ASTM C90, lightweight, 8" and 12"
- Mortar: Type S per ASTM C270
- Grout: ASTM C476, fine grout for cells
- Brick: Boral "Heritage" modular (4x2-2/3x8), color: Williamsburg Red
- No masonry sealer required

Please include the following in your bid:
- Concrete pump services
- All formwork (material and labor)
- All reinforcing steel (furnish, fabricate, and place)
- Post-tension system (elevated decks only)
- All masonry labor and material
- Hoisting for masonry materials

Exclusions we expect you to note:
- Structural steel embeds (furnished by steel sub)
- Waterproofing and damp-proofing
- Building layout (by surveyor)

Full spec book is 384 pages. Structural drawings S001-S412, Architectural A001-A208.

Questions due by March 28, 2026.

Thanks,
Lisa Thompson
Preconstruction Manager
Renegade Construction
(504) 555-0177
lthompson@renegadeconstruction.com`,
  attachments: [
    'Riverside_Structural_S001-S412.pdf',
    'Riverside_Architectural_A001-A208.pdf',
    'Spec_Book_384pp.pdf',
    'Addendum_1.pdf',
    'Geotech_Report.pdf',
  ],
  scope: {
    items: [
      'Drilled piers 24" dia - 52 EA, avg 30\' depth',
      'Pile caps (3PC, 4PC, 6PC) - 38 EA',
      'Grade beams 18"x24" - 1,800 LF',
      'Columns (various) - 64 EA',
      'SOG 6" (ground floor retail) - 32,000 SF',
      'SOG 8" (parking structure) - 45,000 SF',
      'PT elevated deck 10" - 28,000 SF (3 levels)',
      'Stairs - 4 EA (3 stories each)',
      'CMU backup walls 8" - 14,000 SF',
      'CMU walls 12" - 6,200 SF',
      'Brick veneer - 18,500 SF',
      'Sidewalks 4" - 4,800 SF',
      'Curb & gutter - 2,200 LF',
      'Loading dock 8" - 3,600 SF',
    ],
    estimated_volume: '~5,200 CY concrete + 38,700 CMU + 18,500 SF brick',
  },
  due_date: '2026-04-01',
  status: 'new',
  urgency: 'high',
  missing_info: ['Soil boring logs referenced but not attached to email', 'PT design drawings not included - VSL or approved equal'],
  received_at: '2026-03-19T09:30:00Z',
};


// ─── Demo Data: DACP Proposal ──────────────────────────────────────────────

export const DEMO_PROPOSAL = `DACP CONSTRUCTION LLC
PROPOSAL

Date: March 30, 2026
Project: Riverside Commerce Center
Location: 400 Riverside Dr, Kenner, LA 70062
Owner: Riverside Development Partners LLC
Architect: HKS Architects
GC: Renegade Construction (RNGD)
Plans Dated: February 15, 2026
Addendum #1: March 5, 2026

SCOPE OF WORK - CONCRETE:

Specific Operations:
1. Drilled piers 24" dia - 52 EA (avg 30' depth)
2. Pile caps (3PC, 4PC, 6PC) - 38 EA
3. Grade beams 18"x24" - 1,800 LF
4. Columns (various sizes per schedule) - 64 EA
5. Slab on Grade 6" (ground floor retail) - 32,000 SF
6. Slab on Grade 8" (parking structure) - 45,000 SF
7. Post-tension elevated deck 10" - 28,000 SF (3 levels)
8. Stairs - 4 sets, 3 stories each
9. Concrete pump services for all pours
10. All formwork (material and labor)
11. All reinforcing steel - furnish, fabricate, and place
12. Post-tension system (elevated decks)
13. Hoisting for concrete operations

SCOPE OF WORK - MASONRY:

1. CMU backup walls 8" - 14,000 SF
2. CMU walls 12" - 6,200 SF
3. Brick veneer (Boral Heritage, Williamsburg Red) - 18,500 SF
4. Masonry mortar (Type S per ASTM C270)
5. Grout (ASTM C476)
6. Hoisting for masonry materials

SITE WORK:

1. Sidewalks 4" - 4,800 SF
2. Curb & gutter - 2,200 LF
3. Loading dock 8" - 3,600 SF

MATERIAL SPECIFICATIONS:
- Concrete: 4,000 psi (foundations, columns, beams); 5,000 psi (PT elevated decks)
- Rebar: ASTM A615, Grade 60
- CMU: ASTM C90, lightweight
- Mortar: Type S per ASTM C270
- Curing: ASTM C309 Type 1-D

EQUIPMENT:
- Concrete pump services (boom pump for elevated, line pump for SOG)
- Crane for masonry material hoisting (included in masonry scope)

EXCLUSIONS:
1. Sales tax (Jefferson Parish - verify exemption status)
2. Building layout by engineer/surveyor
3. Demolition of any kind
4. Performance and payment bond (available upon request at additional cost)
5. Permits and related fees
6. Traffic control
7. Site dewatering
8. Fill material and compaction of subgrade
9. Material testing (test cylinders furnished by DACP; testing lab by others)
10. Waterproofing and damp-proofing
11. Structural steel embeds (furnished by steel subcontractor)
12. Rigid insulation
13. Masonry sealer
14. Caulking and sealants
15. Polished, stained, or stamped concrete finishes
16. Crane/hoisting for other trades
17. Saw cutting or drilling for other trades
18. Expansion joint covers

CLARIFICATIONS:
- Price based on normal 5-day work week. Overtime premium if accelerated schedule required.
- Concrete pours scheduled minimum 48 hours in advance with concrete supplier.
- DACP is a certified DBE contractor (LA certification #DBE-2019-0847).
- Pricing valid for 60 days from date of proposal.

TOTAL BID: $1,847,500.00

Estimated Duration: 18 weeks (concrete) + 12 weeks (masonry), with overlap

Respectfully submitted,
Tom Mangan
Senior Estimator & Project Manager
DACP Construction LLC
(985) 306-4005`;


// ─── Demo Data: GC Contract (with intentional discrepancies) ───────────────

export const DEMO_CONTRACT = `C.D.W. RENEGADE CONSTRUCTION LLC
SUBCONTRACT AGREEMENT

Project: Riverside Commerce Center
Subcontract No: RSC-SC-014
Date: April 8, 2026

SUBCONTRACTOR: DACP Construction LLC
15095 Old Spanish Trail, Paradis, LA 70080

GENERAL CONTRACTOR: Renegade Construction LLC
1200 Magazine St, Suite 400, New Orleans, LA 70130

CONTRACT AMOUNT: $1,847,500.00

SCOPE OF WORK - EXHIBIT A:

Subcontractor shall furnish all labor, materials, tools, and equipment to complete the following work per the Contract Documents dated January 10, 2026:

Division 03 - Concrete:
- 03 10 00: Concrete Formwork (including architectural Class B finish on all exposed concrete)
- 03 20 00: Concrete Reinforcement (furnish, fabricate, place)
- 03 30 00: Cast-in-Place Concrete
- 03 38 00: Post-Tensioned Concrete

Division 04 - Masonry:
- 04 05 11: Masonry Mortaring & Grout
- 04 22 00: Concrete Unit Masonry
- 04 21 13: Brick Masonry

SPECIFIC SCOPE ITEMS:
1. Drilled piers 24" dia - 52 EA
2. Pile caps - 38 EA
3. Grade beams - 1,800 LF
4. Columns - 64 EA
5. SOG ground floor - 32,000 SF
6. SOG parking - 45,000 SF
7. PT elevated deck - 28,000 SF
8. Stairs - 4 sets
9. CMU walls 8" - 14,000 SF
10. CMU walls 12" - 6,200 SF
11. Brick veneer - 18,500 SF
12. Sidewalks - 4,800 SF
13. Curb & gutter - 2,200 LF
14. Loading dock - 3,600 SF
15. Concrete pump services
16. Formwork (material and labor)
17. Reinforcing steel
18. Post-tension system
19. Hoisting
20. Expansion joint installation and covers
21. Concrete sealer application - parking structure SOG (2 coats)
22. Core drilling for MEP penetrations - up to 150 cores, 2"-6" diameter
23. Provide and install embed plates for structural steel connections - per steel erector's layout

EXCLUSIONS BY CONTRACTOR:
1. Building layout
2. Demolition
3. Traffic control
4. Waterproofing and damp-proofing

PAYMENT TERMS:
- Progress payments monthly, net 45 days from approved application
- 10% retainage until substantial completion
- Retainage released 60 days after substantial completion

INSURANCE REQUIREMENTS:
- General Liability: $2,000,000 per occurrence
- Auto Liability: $1,000,000
- Workers Comp: statutory limits
- Umbrella: $5,000,000
- Subcontractor shall name GC as additional insured

INDEMNIFICATION:
Subcontractor shall defend, indemnify, and hold harmless the General Contractor from any and all claims, damages, losses, and expenses arising from Subcontractor's work, INCLUDING claims arising from the sole negligence of the General Contractor.

SCHEDULE:
- Notice to proceed: April 21, 2026
- Substantial completion: October 15, 2026 (26 weeks)
- Liquidated damages: $2,500 per calendar day beyond substantial completion date

CHANGE ORDERS:
- All changes must be approved in writing before work begins
- Markup on change order work: 10% overhead + 5% profit (labor and material)
- No markup on equipment rental for change order work
- Subcontractor must submit change order requests within 7 calendar days of discovering changed condition

COMPLETE JOB:
Subcontractor shall furnish all necessary labor, materials, tools, and equipment to unload and install a complete system as outlined in the Scope of Work.

Subcontractor Initial: ______     Renegade Initial: ______
Page 1 of 4`;


// ─── Document Analysis (CSI Division Extraction) ────────────────────────────

const DOCUMENT_ANALYSIS_PROMPT = `You are DACP Construction's document analyst. You specialize in analyzing construction bid documents for a concrete and masonry subcontractor.

Given the following documents from a bid request, analyze each document and extract:
1. Which CSI divisions are covered
2. Specification sections relevant to DACP's scope (Division 03 Concrete, Division 04 Masonry)
3. Requirements, exclusions, and special conditions
4. Anything that could affect DACP's bid pricing

BID REQUEST CONTEXT:
Project: {project_name}
GC: {gc_name}
Due Date: {due_date}

DOCUMENTS:
{documents_text}

Return a JSON object:
{
  "divisions": [
    {
      "code": "03",
      "name": "Concrete",
      "sections": [
        {"number": "03 10 00", "title": "Concrete Formwork", "relevant": true, "requirements": ["list of requirements"], "notes": "any important notes"}
      ]
    }
  ],
  "dacp_relevant_sections": [
    {"section": "section number and title", "requirements": ["key requirements"], "spec_references": ["spec page/section refs"]}
  ],
  "compliance_items": [
    {"item": "description", "source_document": "filename", "impact": "how it affects DACP"}
  ],
  "special_conditions": [
    {"condition": "description", "source_document": "filename", "risk_level": "high|medium|low"}
  ],
  "missing_from_documents": [
    {"item": "what's missing", "impact": "why it matters for DACP's bid"}
  ]
}

Focus ONLY on items relevant to concrete and masonry work. Return ONLY the JSON.`;

/**
 * Analyze bid documents and extract CSI divisions / spec requirements.
 * @param {Object} bidRequest - The bid request record
 * @param {Array<{filename: string, parsed_text: string}>} documents - Parsed document objects
 * @returns {Promise<Object>} Structured analysis with divisions, requirements, etc.
 */
export async function analyzeDocuments(bidRequest, documents) {
  const documentsText = documents.map((d, i) =>
    `--- Document ${i + 1}: ${d.filename} ---\n${d.parsed_text || '(no text extracted)'}`
  ).join('\n\n');

  const prompt = DOCUMENT_ANALYSIS_PROMPT
    .replace('{project_name}', bidRequest.subject || bidRequest.gc_name || '')
    .replace('{gc_name}', bidRequest.gc_name || '')
    .replace('{due_date}', bidRequest.due_date || 'Not specified')
    .replace('{documents_text}', documentsText);

  const text = await tunnelPrompt({
    tenantId: 'dacp-construction-001',
    agentId: 'estimating',
    prompt,
    maxTurns: 3,
    timeoutMs: 120_000,
    label: 'Document Analysis',
  });

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Failed to parse document analysis response');

  return JSON.parse(jsonMatch[0]);
}


// ─── Plan Image Analysis (Claude Vision) ────────────────────────────────────

const PLAN_ANALYSIS_PROMPT = `You are DACP Construction's plan analysis specialist. You analyze construction drawings (structural plans, architectural plans, sections, details) to identify concrete and masonry elements.

Examine the provided construction drawing(s) and identify ALL concrete and masonry elements visible. For each element, estimate quantities where possible.

Return a JSON object:
{
  "drawing_info": {
    "sheet_number": "if visible",
    "title": "drawing title if visible",
    "scale": "if visible",
    "drawing_type": "plan|section|detail|elevation|schedule"
  },
  "elements": [
    {
      "type": "footing|column|slab|wall|beam|stair|pier|grade_beam|curb|sidewalk|other",
      "description": "specific description (e.g., '24x24 spread footing', '16\" CMU wall')",
      "count": null,
      "dimensions": {
        "width": "value with unit if visible",
        "height": "value with unit if visible",
        "length": "value with unit if visible",
        "thickness": "value with unit if visible",
        "depth": "value with unit if visible"
      },
      "material": "concrete|cmu|brick|masonry",
      "specifications": ["4000 psi", "Grade 60 rebar", etc.],
      "reinforcement": "rebar details if visible",
      "estimated_quantity": {
        "value": null,
        "unit": "CY|SF|LF|EA",
        "basis": "how quantity was estimated"
      },
      "confidence": "high|medium|low",
      "notes": "any special requirements, callouts, or details visible"
    }
  ],
  "general_notes": ["any general concrete/masonry notes visible on the drawing"],
  "references": ["referenced details, sections, or other sheets mentioned"]
}

Focus ONLY on concrete and masonry elements. Ignore structural steel, MEP, etc. unless they interface with concrete work (e.g., embeds, sleeves). Return ONLY the JSON.`;

/**
 * Analyze construction plan images using Claude vision.
 * @param {Array<{base64: string, mediaType: string, filename: string}>} images
 * @returns {Promise<Object>} Combined analysis with elements checklist
 */
export async function analyzePlanImages(images) {
  const results = [];

  for (const img of images) {
    const content = [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: img.mediaType,
          data: img.base64,
        },
      },
      {
        type: 'text',
        text: PLAN_ANALYSIS_PROMPT,
      },
    ];

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{ role: 'user', content }],
    });

    const text = response.content[0]?.text || '{}';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const analysis = JSON.parse(jsonMatch[0]);
      results.push({ filename: img.filename, ...analysis });
    }
  }

  // Merge all elements into a combined checklist
  const allElements = [];
  const generalNotes = [];
  const references = [];

  for (const r of results) {
    if (r.elements) {
      for (const el of r.elements) {
        allElements.push({ ...el, source_sheet: r.drawing_info?.sheet_number || r.filename });
      }
    }
    if (r.general_notes) generalNotes.push(...r.general_notes);
    if (r.references) references.push(...r.references);
  }

  return {
    sheets: results,
    checklist: allElements,
    general_notes: [...new Set(generalNotes)],
    references: [...new Set(references)],
    total_elements: allElements.length,
  };
}


// ─── PlanSwift Export Parser ────────────────────────────────────────────────

/**
 * Known PlanSwift column header variations mapped to normalized names.
 */
const PLANSWIFT_HEADER_MAP = {
  // Item / description
  'item': 'item',
  'item name': 'item',
  'description': 'item',
  'desc': 'item',
  'name': 'item',
  'takeoff item': 'item',
  'assembly': 'item',
  // Quantity
  'quantity': 'quantity',
  'qty': 'quantity',
  'count': 'quantity',
  'total qty': 'quantity',
  'amount': 'quantity',
  // Unit
  'unit': 'unit',
  'uom': 'unit',
  'units': 'unit',
  'unit of measure': 'unit',
  // Length
  'length': 'length',
  'len': 'length',
  'total length': 'length',
  'linear feet': 'length',
  'lf': 'length',
  // Area
  'area': 'area',
  'total area': 'area',
  'square feet': 'area',
  'sf': 'area',
  'sq ft': 'area',
  // Volume
  'volume': 'volume',
  'total volume': 'volume',
  'cubic yards': 'volume',
  'cy': 'volume',
  'cu yd': 'volume',
  // Width / height / depth / thickness
  'width': 'width',
  'height': 'height',
  'depth': 'depth',
  'thickness': 'thickness',
  // Category / section
  'category': 'category',
  'section': 'category',
  'csi': 'category',
  'division': 'category',
  // Notes
  'notes': 'notes',
  'remarks': 'notes',
  'comment': 'notes',
  'comments': 'notes',
};

/**
 * Parse PlanSwift XLSX/CSV export rows into structured quantity items.
 * Normalizes column names to a standard schema compatible with estimateBot.
 *
 * @param {Array<Object>} rows - Raw parsed rows (array of {colName: value} objects)
 * @returns {Array<Object>} Normalized quantity items
 */
export function parsePlanSwiftExport(rows) {
  if (!rows || rows.length === 0) return [];

  // Detect and normalize column headers from the first row's keys
  const sampleKeys = Object.keys(rows[0]);
  const headerMapping = {};
  for (const key of sampleKeys) {
    const normalized = PLANSWIFT_HEADER_MAP[key.toLowerCase().trim()];
    if (normalized) {
      headerMapping[key] = normalized;
    } else {
      // Keep unknown columns as-is (lowercased, underscored)
      headerMapping[key] = key.toLowerCase().replace(/\s+/g, '_');
    }
  }

  const items = [];
  for (const row of rows) {
    const normalized = {};
    for (const [origKey, normKey] of Object.entries(headerMapping)) {
      const val = row[origKey];
      if (val !== undefined && val !== null && val !== '') {
        normalized[normKey] = val;
      }
    }

    // Skip empty rows (no item name and no quantity)
    if (!normalized.item && !normalized.quantity) continue;

    // Coerce numeric fields
    for (const numField of ['quantity', 'length', 'area', 'volume', 'width', 'height', 'depth', 'thickness']) {
      if (normalized[numField] !== undefined) {
        const parsed = parseFloat(normalized[numField]);
        if (!isNaN(parsed)) normalized[numField] = parsed;
      }
    }

    items.push(normalized);
  }

  return items;
}
