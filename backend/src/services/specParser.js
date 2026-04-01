/**
 * Specification Parser
 *
 * Extracts structured data from construction specification PDFs:
 * tax status (MPC/exempt), labor requirements, VBE/SBLVB,
 * concrete specs, rebar grades, bond requirements, special conditions.
 */

import { v4 as uuidv4 } from 'uuid';
import { upsertDacpProjectSpecs, insertActivity } from '../cache/database.js';

/**
 * Parse specification text and extract structured requirements.
 * Uses regex patterns for common spec language, then Claude for complex parsing.
 */
export function extractSpecRequirements(specText) {
  const result = {
    taxStatus: null,
    taxDetails: '',
    laborRequirements: [],
    bondRequired: false,
    bondType: null,
    concreteSpecs: [],
    rebarSpecs: [],
    specialConditions: [],
    vbeSblvbRequired: false,
    vbeSblvbDetails: '',
  };

  if (!specText) return result;

  const text = specText.toLowerCase();

  // Tax status detection
  if (text.includes('mpc') || text.includes('mississippi procurement certificate')) {
    result.taxStatus = 'mpc_exempt';
    result.taxDetails = 'Mississippi Procurement Certificate - GC pays 3.5% to Dept of Revenue, subs/suppliers exempt';
  } else if (text.includes('tax exempt') || text.includes('tax-exempt')) {
    result.taxStatus = 'exempt';
    const exemptMatch = specText.match(/tax[- ]exempt[^.]*\./i);
    result.taxDetails = exemptMatch ? exemptMatch[0] : 'Tax exempt per specifications';
  } else if (text.includes('sales tax') && !text.includes('no sales tax')) {
    result.taxStatus = 'taxable';
    const taxMatch = specText.match(/sales tax[^.]*\./i);
    result.taxDetails = taxMatch ? taxMatch[0] : 'Sales tax applies';
  }

  // Labor requirements
  if (text.includes('prevailing wage') || text.includes('davis-bacon') || text.includes('davis bacon')) {
    result.laborRequirements.push({ type: 'prevailing_wage', details: 'Prevailing wage rates required (Davis-Bacon)' });
  }
  if (text.includes('union') && (text.includes('labor') || text.includes('workforce'))) {
    result.laborRequirements.push({ type: 'union', details: 'Union labor requirements' });
  }

  // VBE/SBLVB participation
  const vbePatterns = [/vbe[^.]*participation[^.]*\./gi, /sblvb[^.]*\./gi, /minority[^.]*business[^.]*\./gi, /disadvantaged[^.]*business[^.]*\./gi, /dbe[^.]*participation[^.]*\./gi];
  for (const pattern of vbePatterns) {
    const match = specText.match(pattern);
    if (match) {
      result.vbeSblvbRequired = true;
      result.vbeSblvbDetails += match[0] + ' ';
    }
  }

  // Bond requirements
  if (text.includes('performance bond') || text.includes('payment bond') || text.includes('bid bond')) {
    result.bondRequired = true;
    if (text.includes('performance bond') && text.includes('payment bond')) {
      result.bondType = 'performance_and_payment';
    } else if (text.includes('performance bond')) {
      result.bondType = 'performance';
    } else if (text.includes('payment bond')) {
      result.bondType = 'payment';
    } else {
      result.bondType = 'bid';
    }
  }

  // Concrete specifications
  const psiMatches = specText.match(/(\d{3,5})\s*psi/gi) || [];
  const uniquePsi = [...new Set(psiMatches.map(m => parseInt(m)))];
  for (const psi of uniquePsi) {
    result.concreteSpecs.push({ type: 'strength', value: `${psi} PSI` });
  }

  // Concrete types
  const concreteTypes = [
    { pattern: /type\s*v/i, label: 'Type V (sulfate resistant)' },
    { pattern: /type\s*ii/i, label: 'Type II (moderate sulfate)' },
    { pattern: /lightweight\s*concrete/i, label: 'Lightweight concrete' },
    { pattern: /fiber[- ]reinforced/i, label: 'Fiber-reinforced concrete' },
    { pattern: /self[- ]consolidating/i, label: 'Self-consolidating concrete (SCC)' },
    { pattern: /air[- ]entrained/i, label: 'Air-entrained concrete' },
  ];
  for (const ct of concreteTypes) {
    if (ct.pattern.test(specText)) {
      result.concreteSpecs.push({ type: 'mix_type', value: ct.label });
    }
  }

  // Rebar specifications
  const rebarGrades = [
    { pattern: /grade\s*40/i, label: 'Grade 40' },
    { pattern: /grade\s*60/i, label: 'Grade 60' },
    { pattern: /grade\s*75/i, label: 'Grade 75' },
    { pattern: /grade\s*80/i, label: 'Grade 80' },
    { pattern: /epoxy[- ]coated/i, label: 'Epoxy-coated rebar' },
    { pattern: /galvanized\s*rebar/i, label: 'Galvanized rebar' },
    { pattern: /stainless\s*steel\s*rebar/i, label: 'Stainless steel rebar' },
  ];
  for (const rg of rebarGrades) {
    if (rg.pattern.test(specText)) {
      result.rebarSpecs.push({ type: 'grade', value: rg.label });
    }
  }

  // Special conditions
  const specialPatterns = [
    { pattern: /liquidated\s*damages[^.]*\./i, type: 'liquidated_damages' },
    { pattern: /retainage[^.]*\./i, type: 'retainage' },
    { pattern: /warranty[^.]*\./i, type: 'warranty' },
    { pattern: /completion\s*date[^.]*\./i, type: 'schedule' },
    { pattern: /working\s*hours[^.]*\./i, type: 'work_hours' },
    { pattern: /noise\s*restriction[^.]*\./i, type: 'noise' },
    { pattern: /staging\s*area[^.]*\./i, type: 'staging' },
  ];
  for (const sp of specialPatterns) {
    const match = specText.match(sp.pattern);
    if (match) {
      result.specialConditions.push({ type: sp.type, details: match[0] });
    }
  }

  return result;
}

/**
 * Parse a spec document and save structured data to DB.
 */
export async function parseAndSaveSpecs(tenantId, { bidRequestId, jobId, projectName, specText, docId }) {
  const parsed = extractSpecRequirements(specText);

  const specsId = uuidv4();
  upsertDacpProjectSpecs({
    id: specsId,
    tenantId,
    bidRequestId,
    jobId,
    projectName,
    taxStatus: parsed.taxStatus,
    taxDetails: parsed.taxDetails,
    laborRequirementsJson: JSON.stringify(parsed.laborRequirements),
    bondRequired: parsed.bondRequired,
    bondType: parsed.bondType,
    concreteSpecsJson: JSON.stringify(parsed.concreteSpecs),
    rebarSpecsJson: JSON.stringify(parsed.rebarSpecs),
    specialConditionsJson: JSON.stringify(parsed.specialConditions),
    vbeSblvbRequired: parsed.vbeSblvbRequired,
    vbeSblvbDetails: parsed.vbeSblvbDetails.trim(),
    parsedFromDocId: docId,
    rawExtractedText: specText?.slice(0, 10000),
  });

  // Log activity
  const flags = [];
  if (parsed.taxStatus) flags.push(`Tax: ${parsed.taxStatus}`);
  if (parsed.bondRequired) flags.push(`Bond: ${parsed.bondType}`);
  if (parsed.vbeSblvbRequired) flags.push('VBE/SBLVB required');
  if (parsed.laborRequirements.length) flags.push(parsed.laborRequirements.map(l => l.type).join(', '));

  insertActivity({
    tenantId,
    type: 'agent',
    title: `Parsed specs for ${projectName}`,
    subtitle: flags.join(' | ') || 'No special flags detected',
    detailJson: JSON.stringify({ specsId, bidRequestId, parsed }),
    sourceType: 'estimate',
    sourceId: bidRequestId,
    agentId: 'estimating',
  });

  return { id: specsId, ...parsed };
}

/**
 * Build a Claude prompt to do deep spec analysis on complex docs.
 * Used when regex parsing isn't enough.
 */
export function buildSpecAnalysisPrompt(specText, projectName) {
  return `Analyze these construction specifications for "${projectName}" and extract the following in JSON format:

{
  "tax_status": "exempt|taxable|mpc_exempt|unknown",
  "tax_details": "explanation of tax situation",
  "labor_requirements": [{"type": "prevailing_wage|union|open_shop", "details": "..."}],
  "bond_required": true/false,
  "bond_type": "performance|payment|bid|performance_and_payment|null",
  "concrete_specs": [{"type": "strength|mix_type|finish|curing", "value": "..."}],
  "rebar_specs": [{"type": "grade|coating|size", "value": "..."}],
  "vbe_sblvb_required": true/false,
  "vbe_sblvb_details": "participation requirements",
  "special_conditions": [{"type": "schedule|liquidated_damages|retainage|warranty|staging|other", "details": "..."}],
  "missing_critical": ["list of items that should be in specs but are missing"],
  "rfi_needed": [{"subject": "...", "question": "..."}]
}

SPECIFICATIONS TEXT:
${specText.slice(0, 30000)}`;
}

export default { extractSpecRequirements, parseAndSaveSpecs, buildSpecAnalysisPrompt };
