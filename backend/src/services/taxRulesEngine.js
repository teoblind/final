/**
 * Construction Tax Rules Engine
 *
 * Applies state-specific tax rules to construction estimates.
 * Covers: sales tax, government exemptions, bond requirements,
 * prevailing wage, labor taxability, use tax, and special taxes.
 */

import { v4 as uuidv4 } from 'uuid';
import {
  getConstructionTaxRules,
  getConstructionTaxRule,
  upsertConstructionTaxRule,
} from '../cache/database.js';

// ─── Standard bond premium tiers (industry default) ───────────────────────
const DEFAULT_BOND_TIERS = [
  { ceiling: 100000, rate: 2.5 },
  { ceiling: 500000, rate: 1.5 },
  { ceiling: 2500000, rate: 1.0 },
  { ceiling: Infinity, rate: 0.75 },
];

/**
 * Calculate bond premium using tiered sliding scale
 */
export function calculateBondPremium(contractValue, tiersJson) {
  const tiers = tiersJson ? JSON.parse(tiersJson) : DEFAULT_BOND_TIERS;
  let remaining = contractValue;
  let premium = 0;
  let prev = 0;

  for (const tier of tiers) {
    const ceiling = tier.ceiling === null || tier.ceiling === 'Infinity' ? Infinity : tier.ceiling;
    const bracket = Math.min(remaining, ceiling - prev);
    if (bracket <= 0) break;
    premium += bracket * (tier.rate / 100);
    remaining -= bracket;
    prev = ceiling;
    if (remaining <= 0) break;
  }

  return {
    premium: Math.round(premium * 100) / 100,
    effectiveRate: contractValue > 0 ? Math.round((premium / contractValue) * 10000) / 100 : 0,
    tiers,
  };
}

/**
 * Calculate sales tax on materials given state rules
 */
export function calculateMaterialsTax(materialsCost, rule, isGovtProject = false) {
  if (!rule) return { tax: 0, rate: 0, notes: 'No tax rule found' };

  // Mississippi uses the 3.5% contractor's tax on total contract instead of sales tax on materials
  if (rule.state === 'MS' && rule.mpc_details_json) {
    return {
      tax: 0,
      rate: 0,
      notes: 'MS uses MPC system - 3.5% contractor\'s tax on total contract replaces 7% sales tax on materials. Materials purchased with MPC are exempt.',
      mpcApplies: true,
    };
  }

  // Government project exemption check
  if (isGovtProject && rule.govt_project_exempt) {
    return {
      tax: 0,
      rate: 0,
      notes: `Government project - materials exempt. ${rule.govt_exemption_mechanism || ''} Form: ${rule.govt_exemption_form || 'N/A'}`,
      exempt: true,
    };
  }

  const rate = rule.base_sales_tax_rate || 0;
  const tax = Math.round(materialsCost * (rate / 100) * 100) / 100;

  return {
    tax,
    rate,
    notes: `${rule.state} ${rule.contractor_classification} - pays ${rate}% at purchase`,
    maxCombined: rule.max_combined_rate,
  };
}

/**
 * Calculate Mississippi contractor's tax (3.5% on total contract)
 */
export function calculateMississippiContractorTax(totalContract, rule) {
  if (rule?.state !== 'MS') return null;

  const mpc = rule.mpc_details_json ? JSON.parse(rule.mpc_details_json) : {};
  const rate = mpc.contractorTaxRate || 3.5;
  const tax = Math.round(totalContract * (rate / 100) * 100) / 100;
  const grossUp = Math.round(totalContract * 1.0362694 * 100) / 100;

  return {
    tax,
    rate,
    grossUpTotal: grossUp,
    grossUpFactor: 1.0362694,
    notes: `MS contractor's tax: ${rate}% on total contract ($${totalContract.toLocaleString()}) = $${tax.toLocaleString()}. Gross-up total: $${grossUp.toLocaleString()}`,
    mpcRequired: totalContract > (mpc.inStateThreshold || 75000),
    prepayThreshold: mpc.inStateThreshold || 75000,
    outOfStateThreshold: mpc.outOfStateThreshold || 10000,
  };
}

/**
 * Apply full tax analysis to an estimate
 */
export function applyTaxRulesToEstimate(estimate, state, tenantId, options = {}) {
  const rule = getConstructionTaxRule(tenantId, state);
  if (!rule) {
    return {
      state,
      error: `No tax rules found for ${state}. Add rules via Settings > Tax Rules.`,
      taxBreakdown: null,
    };
  }

  const isGovtProject = options.isGovtProject || false;
  const materialsCost = options.materialsCost || estimate.subtotal * 0.65; // estimate 65% materials if not specified
  const laborCost = options.laborCost || estimate.subtotal * 0.35;

  // 1. Materials tax
  const materialsTax = calculateMaterialsTax(materialsCost, rule, isGovtProject);

  // 2. Mississippi contractor's tax (replaces materials tax)
  const msTax = rule.state === 'MS'
    ? calculateMississippiContractorTax(estimate.totalBid || estimate.total_bid, rule)
    : null;

  // 3. Labor tax
  let laborTax = { tax: 0, rate: 0, notes: 'Labor exempt' };
  if (rule.labor_taxable) {
    const rate = rule.base_sales_tax_rate || 0;
    laborTax = {
      tax: Math.round(laborCost * (rate / 100) * 100) / 100,
      rate,
      notes: rule.labor_tax_notes || `${rule.state} taxes construction labor at ${rate}%`,
    };
  }

  // 4. Use tax (for out-of-state material purchases)
  const useTax = {
    rate: rule.use_tax_rate || rule.base_sales_tax_rate || 0,
    notes: `${rule.state} use tax applies to out-of-state material purchases. Credit given for tax paid in origin state.`,
  };

  // 5. Bond analysis
  const bondRequired = (estimate.totalBid || estimate.total_bid || 0) >= (rule.bond_threshold || 0);
  const bondPremium = bondRequired
    ? calculateBondPremium(estimate.totalBid || estimate.total_bid, rule.bond_tiers_json)
    : { premium: 0, effectiveRate: 0, notes: `Below ${rule.state} bond threshold ($${(rule.bond_threshold || 0).toLocaleString()})` };

  // 6. Prevailing wage flag
  const prevailingWage = {
    applies: rule.prevailing_wage ? true : false,
    threshold: rule.prevailing_wage_threshold,
    notes: rule.prevailing_wage_notes || (rule.prevailing_wage
      ? `${rule.state} prevailing wage applies (threshold: $${(rule.prevailing_wage_threshold || 0).toLocaleString()})`
      : `${rule.state} has no state prevailing wage law. Davis-Bacon applies only to federally funded projects.`),
  };

  // 7. Special taxes
  const specialTaxes = rule.special_taxes_json ? JSON.parse(rule.special_taxes_json) : [];

  // Total tax impact
  const totalTaxImpact = (msTax ? msTax.tax : materialsTax.tax) + laborTax.tax + bondPremium.premium;

  return {
    state: rule.state,
    stateName: rule.state_name,
    contractorClassification: rule.contractor_classification,
    isGovtProject,
    materialsTax: msTax ? { ...materialsTax, overriddenByMPC: true } : materialsTax,
    mississippiTax: msTax,
    laborTax,
    useTax,
    bondRequired,
    bondThreshold: rule.bond_threshold,
    bondPremium,
    prevailingWage,
    specialTaxes,
    govtExemption: isGovtProject ? {
      exempt: rule.govt_project_exempt ? true : false,
      mechanism: rule.govt_exemption_mechanism,
      form: rule.govt_exemption_form,
    } : null,
    totalTaxImpact,
    totalWithTax: (estimate.totalBid || estimate.total_bid || 0) + totalTaxImpact,
    notes: rule.notes,
  };
}

/**
 * Auto-detect project state from address or project name
 */
export function detectProjectState(text) {
  if (!text) return null;

  const stateMap = {
    'texas': 'TX', 'tx': 'TX', 'houston': 'TX', 'dallas': 'TX', 'san antonio': 'TX', 'austin': 'TX', 'fort worth': 'TX',
    'mississippi': 'MS', 'ms': 'MS', 'biloxi': 'MS', 'jackson': 'MS', 'gulfport': 'MS', 'hattiesburg': 'MS',
    'louisiana': 'LA', 'la': 'LA', 'new orleans': 'LA', 'baton rouge': 'LA', 'shreveport': 'LA', 'lake charles': 'LA',
    'alabama': 'AL', 'al': 'AL', 'birmingham': 'AL', 'mobile': 'AL', 'huntsville': 'AL', 'montgomery': 'AL',
    'florida': 'FL', 'fl': 'FL', 'miami': 'FL', 'tampa': 'FL', 'jacksonville': 'FL', 'orlando': 'FL',
    'georgia': 'GA', 'ga': 'GA', 'atlanta': 'GA', 'savannah': 'GA', 'augusta': 'GA', 'macon': 'GA',
    'arkansas': 'AR', 'ar': 'AR', 'little rock': 'AR', 'fayetteville': 'AR', 'fort smith': 'AR',
    'oklahoma': 'OK', 'ok': 'OK', 'oklahoma city': 'OK', 'tulsa': 'OK', 'norman': 'OK',
    'tennessee': 'TN', 'tn': 'TN', 'nashville': 'TN', 'memphis': 'TN', 'knoxville': 'TN', 'chattanooga': 'TN',
    'south carolina': 'SC', 'sc': 'SC', 'charleston': 'SC', 'columbia': 'SC', 'greenville': 'SC', 'myrtle beach': 'SC',
  };

  const lower = text.toLowerCase();
  // Check multi-word matches first (e.g., "new orleans", "south carolina")
  const sorted = Object.keys(stateMap).sort((a, b) => b.length - a.length);
  for (const key of sorted) {
    if (lower.includes(key)) return stateMap[key];
  }

  // Check for 2-letter state codes in the text (e.g., ", TX" or "TX 77001")
  const codeMatch = text.match(/\b(TX|MS|LA|AL|FL|GA|AR|OK|TN|SC)\b/);
  if (codeMatch) return codeMatch[1];

  return null;
}

/**
 * Seed the 10-state initial tax rules for a tenant
 */
export function seedTaxRules(tenantId) {
  const existing = getConstructionTaxRules(tenantId);
  if (existing.length >= 10) return { seeded: false, count: existing.length, message: 'Rules already exist' };

  const rules = getTenStateRules();
  let count = 0;

  for (const rule of rules) {
    const existingRule = getConstructionTaxRule(tenantId, rule.state);
    if (!existingRule) {
      upsertConstructionTaxRule({
        id: `TAXRULE-${rule.state}-${uuidv4().slice(0, 6)}`,
        tenantId,
        ...rule,
      });
      count++;
    }
  }

  return { seeded: true, count, message: `Seeded ${count} state tax rules` };
}

/**
 * 10-state construction tax rules dataset
 */
function getTenStateRules() {
  return [
    {
      state: 'TX',
      stateName: 'Texas',
      baseSalesTaxRate: 6.25,
      maxCombinedRate: 8.25,
      contractorClassification: 'consuming_contractor',
      contractorModelDescription: 'Lump-sum: contractor pays tax at purchase, cannot charge customer. Separated contracts: contractor acts as retailer, collects tax from customer.',
      govtProjectExempt: false,
      govtExemptionMechanism: 'Partial - government entities exempt but contractors on lump-sum contracts still pay tax at purchase. Separated contracts can pass through exemption.',
      govtExemptionForm: 'Form 01-339',
      bondThreshold: 25000,
      bondAmountPct: 100,
      bondTiersJson: JSON.stringify([
        { ceiling: 100000, rate: 2.5 },
        { ceiling: 500000, rate: 1.5 },
        { ceiling: 2500000, rate: 1.0 },
        { ceiling: null, rate: 0.75 },
      ]),
      prevailingWage: false,
      prevailingWageThreshold: null,
      prevailingWageNotes: 'No state prevailing wage law. Federal Davis-Bacon applies only to federally funded projects over $2,000.',
      laborTaxable: false,
      laborTaxNotes: 'Labor to repair, remodel, or restore real property is not taxable when separately stated.',
      useTaxRate: 6.25,
      specialTaxesJson: JSON.stringify([]),
      mpcDetailsJson: null,
      notes: 'Home state for DACP. Local jurisdictions add up to 2% on top of 6.25% state rate. Performance bond threshold is $100K.',
    },
    {
      state: 'MS',
      stateName: 'Mississippi',
      baseSalesTaxRate: 7.0,
      maxCombinedRate: 7.0,
      contractorClassification: 'consuming_contractor_mpc',
      contractorModelDescription: 'MS imposes a separate 3.5% contractor\'s tax on non-residential construction contracts over $10,000 instead of the 7% general sales tax.',
      govtProjectExempt: false,
      govtExemptionMechanism: 'No exemptions from the 3.5% contractor\'s tax - applies to all non-residential construction including government, churches, hospitals, and nonprofits.',
      govtExemptionForm: 'N/A',
      bondThreshold: 0,
      bondAmountPct: 100,
      bondTiersJson: JSON.stringify([
        { ceiling: 100000, rate: 2.5 },
        { ceiling: 500000, rate: 1.5 },
        { ceiling: 2500000, rate: 1.0 },
        { ceiling: null, rate: 0.75 },
      ]),
      prevailingWage: false,
      prevailingWageThreshold: null,
      prevailingWageNotes: 'No state prevailing wage law. Federal Davis-Bacon applies only to federally funded projects.',
      laborTaxable: false,
      laborTaxNotes: 'Labor is included in the 3.5% contractor\'s tax base (levied on total contract price). No separate labor tax.',
      useTaxRate: 7.0,
      specialTaxesJson: JSON.stringify([]),
      mpcDetailsJson: JSON.stringify({
        contractorTaxRate: 3.5,
        generalSalesTaxRate: 7.0,
        inStateThreshold: 75000,
        outOfStateThreshold: 10000,
        grossUpFactor: 1.0362694,
        formNumber: 'Form 72-405',
        description: 'Material Purchase Certificate (MPC). GC applies before work begins. Prepays 3.5% on total contract value. MPC exempts all subs/suppliers from 7% sales tax on materials.',
      }),
      notes: 'Active project state (Biloxi). All public contracts require bonds regardless of value. MPC system is unique to MS.',
    },
    {
      state: 'LA',
      stateName: 'Louisiana',
      baseSalesTaxRate: 5.0,
      maxCombinedRate: 11.0,
      contractorClassification: 'consuming_contractor',
      contractorModelDescription: 'Contractors are consumers/end users of materials. Purchase materials tax-inclusive, do not charge customer tax on the improvement.',
      govtProjectExempt: true,
      govtExemptionMechanism: 'Effective July 1, 2025 (Act 384): contractors and subs on public construction projects can purchase materials and services exempt from state AND local sales tax.',
      govtExemptionForm: 'Form R-85014 (Exemption Certificate) or Form R-1020 (Agent Designation)',
      bondThreshold: 25000,
      bondAmountPct: 100,
      bondTiersJson: JSON.stringify([
        { ceiling: 100000, rate: 2.5 },
        { ceiling: 500000, rate: 1.5 },
        { ceiling: 2500000, rate: 1.0 },
        { ceiling: null, rate: 0.75 },
      ]),
      prevailingWage: false,
      prevailingWageThreshold: null,
      prevailingWageNotes: 'No state prevailing wage law. Federal Davis-Bacon applies only to federally funded projects.',
      laborTaxable: false,
      laborTaxNotes: 'Labor to construct or repair immovable (real) property is not subject to sales tax.',
      useTaxRate: 5.0,
      specialTaxesJson: JSON.stringify([
        { name: 'Local parish tax', description: 'Parishes add 0-7% local tax. Typical combined 8.45-11%.' },
      ]),
      mpcDetailsJson: null,
      notes: 'Adjacent to TX, major construction market. New government exemption effective July 2025 is significant cost saver on public projects.',
    },
    {
      state: 'AL',
      stateName: 'Alabama',
      baseSalesTaxRate: 4.0,
      maxCombinedRate: 11.0,
      contractorClassification: 'consuming_contractor',
      contractorModelDescription: 'Contractors are end users of building materials and must pay sales tax at purchase.',
      govtProjectExempt: true,
      govtExemptionMechanism: 'Under Act 2013-205: contractors and subs on government entity projects can purchase building materials tax-exempt if the property becomes part of the structure. Annual certificate renewal required.',
      govtExemptionForm: 'Certificate of Exemption for Government Entity Projects (from AL DOR)',
      bondThreshold: 50000,
      bondAmountPct: 100,
      bondTiersJson: JSON.stringify([
        { ceiling: 100000, rate: 2.5 },
        { ceiling: 500000, rate: 1.5 },
        { ceiling: 2500000, rate: 1.0 },
        { ceiling: null, rate: 0.75 },
      ]),
      prevailingWage: false,
      prevailingWageThreshold: null,
      prevailingWageNotes: 'No state prevailing wage law. Federal Davis-Bacon applies only to federally funded projects.',
      laborTaxable: false,
      laborTaxNotes: 'Construction labor/installation services are not subject to Alabama sales tax.',
      useTaxRate: 4.0,
      specialTaxesJson: JSON.stringify([
        { name: 'Contractors Gross Receipts Tax', description: 'May apply in some municipal jurisdictions.' },
      ]),
      mpcDetailsJson: null,
      notes: 'Gulf Coast neighbor. Payment bond only requires 50% of contract value (lower than most states). Government exemption is strong.',
    },
    {
      state: 'FL',
      stateName: 'Florida',
      baseSalesTaxRate: 6.0,
      maxCombinedRate: 8.5,
      contractorClassification: 'consuming_contractor',
      contractorModelDescription: 'Under lump-sum/cost-plus/T&M contracts: contractor is final consumer, pays tax at purchase. Under retail-sale-plus-installation: contractor is retailer of materials.',
      govtProjectExempt: false,
      govtExemptionMechanism: 'Government entities exempt on direct purchases only. Contractors on lump-sum contracts still pay tax. Government must have Consumer\'s Certificate of Exemption.',
      govtExemptionForm: 'Form DR-14 (Consumer\'s Certificate of Exemption)',
      bondThreshold: 200000,
      bondAmountPct: 100,
      bondTiersJson: JSON.stringify([
        { ceiling: 100000, rate: 2.5 },
        { ceiling: 500000, rate: 1.5 },
        { ceiling: 2500000, rate: 1.0 },
        { ceiling: null, rate: 0.75 },
      ]),
      prevailingWage: false,
      prevailingWageThreshold: null,
      prevailingWageNotes: 'No state prevailing wage law. Federal Davis-Bacon applies only to federally funded projects.',
      laborTaxable: false,
      laborTaxNotes: 'Construction labor for real property improvements is not taxable. Off-site fabrication labor IS part of taxable fabrication cost.',
      useTaxRate: 6.0,
      specialTaxesJson: JSON.stringify([
        { name: 'County discretionary surtax', description: '0.5-2.5% applies to first $5,000 of a single transaction.' },
      ]),
      mpcDetailsJson: null,
      notes: 'Huge construction market. High bond threshold ($200K mandatory). Off-site rebar fabrication labor is taxable - important for turnkey rebar quotes.',
    },
    {
      state: 'GA',
      stateName: 'Georgia',
      baseSalesTaxRate: 4.0,
      maxCombinedRate: 8.0,
      contractorClassification: 'consuming_contractor',
      contractorModelDescription: 'Contractors are deemed consumers of materials per O.C.G.A. 48-8-63. Must register for sales/use tax number.',
      govtProjectExempt: false,
      govtExemptionMechanism: 'Government entities exempt on DIRECT purchases only. Exemption does NOT flow through to contractors on government projects. Contractors bear full tax burden.',
      govtExemptionForm: 'Form ST-5 (Certificate of Exemption - for government\'s own purchases only)',
      bondThreshold: 250000,
      bondAmountPct: 100,
      bondTiersJson: JSON.stringify([
        { ceiling: 100000, rate: 2.5 },
        { ceiling: 500000, rate: 1.5 },
        { ceiling: 2500000, rate: 1.0 },
        { ceiling: null, rate: 0.75 },
      ]),
      prevailingWage: false,
      prevailingWageThreshold: null,
      prevailingWageNotes: 'No state prevailing wage law. Federal Davis-Bacon applies only to federally funded projects.',
      laborTaxable: false,
      laborTaxNotes: 'Labor exempt when separately stated on invoice. If labor is not separately stated, entire charge is taxable. Fabrication labor is taxable.',
      useTaxRate: 4.0,
      specialTaxesJson: JSON.stringify([
        { name: 'SPLOST', description: 'Special Purpose Local Option Sales Tax - varies by county, collected as part of combined rate.' },
      ]),
      mpcDetailsJson: null,
      notes: 'Critical: no government project exemption for contractors. Highest bond threshold of the 10 states at $250K. Must factor full sales tax into government bids.',
    },
    {
      state: 'AR',
      stateName: 'Arkansas',
      baseSalesTaxRate: 6.5,
      maxCombinedRate: 12.0,
      contractorClassification: 'consuming_contractor',
      contractorModelDescription: 'All contractors are deemed consumers/users of materials per GR-21.',
      govtProjectExempt: false,
      govtExemptionMechanism: 'Government entities exempt on direct purchases only. Contractors purchasing for government projects are generally NOT exempt.',
      govtExemptionForm: 'Form ST-391 (Exemption Certificate)',
      bondThreshold: 20000,
      bondAmountPct: 100,
      bondTiersJson: JSON.stringify([
        { ceiling: 100000, rate: 2.5 },
        { ceiling: 500000, rate: 1.5 },
        { ceiling: 2500000, rate: 1.0 },
        { ceiling: null, rate: 0.75 },
      ]),
      prevailingWage: false,
      prevailingWageThreshold: null,
      prevailingWageNotes: 'No state prevailing wage law. Federal Davis-Bacon applies only to federally funded projects.',
      laborTaxable: false,
      laborTaxNotes: 'Nonmechanical materials attached to realty (including concrete) are exempt. Mechanical/electrical replacement/repair is taxable.',
      useTaxRate: 6.5,
      specialTaxesJson: JSON.stringify([]),
      mpcDetailsJson: null,
      notes: 'Adjacent to TX. Lowest bond threshold at $20K. High combined tax rates (up to 12%). Concrete work generally labor-exempt.',
    },
    {
      state: 'OK',
      stateName: 'Oklahoma',
      baseSalesTaxRate: 4.5,
      maxCombinedRate: 11.0,
      contractorClassification: 'consuming_contractor',
      contractorModelDescription: 'Contractors must pay sales tax on all materials, supplies, and equipment purchased to develop, repair, alter, remodel, and improve real property.',
      govtProjectExempt: true,
      govtExemptionMechanism: 'Contractors with public contracts with OK municipalities, counties, school districts, higher education, rural water districts, and other specified public entities may make exempt purchases.',
      govtExemptionForm: 'Form 13-16-A (Application for Sales Tax Exemption)',
      bondThreshold: 50000,
      bondAmountPct: 100,
      bondTiersJson: JSON.stringify([
        { ceiling: 100000, rate: 2.5 },
        { ceiling: 500000, rate: 1.5 },
        { ceiling: 2500000, rate: 1.0 },
        { ceiling: null, rate: 0.75 },
      ]),
      prevailingWage: false,
      prevailingWageThreshold: null,
      prevailingWageNotes: 'No state prevailing wage law. Federal Davis-Bacon applies only to federally funded projects.',
      laborTaxable: false,
      laborTaxNotes: 'Labor exempt when separately stated on invoice. If not separately stated, full amount may be taxable.',
      useTaxRate: 4.5,
      specialTaxesJson: JSON.stringify([]),
      mpcDetailsJson: null,
      notes: 'Adjacent to TX. Government exemption passes through to contractors (unlike GA/TN/SC). Good market for public projects.',
    },
    {
      state: 'TN',
      stateName: 'Tennessee',
      baseSalesTaxRate: 7.0,
      maxCombinedRate: 9.75,
      contractorClassification: 'consuming_contractor',
      contractorModelDescription: 'Contractors and subcontractors are users/consumers and must pay tax on materials, supplies, and taxable services used to make improvements to realty.',
      govtProjectExempt: false,
      govtExemptionMechanism: 'Very limited. Contractors generally owe sales/use tax on materials EVEN when contracted by government organizations. Narrow exceptions for utility/infrastructure projects.',
      govtExemptionForm: 'Form RV-F1301301 (Government Certificate of Exemption - for entity\'s direct purchases only)',
      bondThreshold: 100000,
      bondAmountPct: 100,
      bondTiersJson: JSON.stringify([
        { ceiling: 100000, rate: 2.5 },
        { ceiling: 500000, rate: 1.5 },
        { ceiling: 2500000, rate: 1.0 },
        { ceiling: null, rate: 0.75 },
      ]),
      prevailingWage: false,
      prevailingWageThreshold: null,
      prevailingWageNotes: 'No state prevailing wage law. Federal Davis-Bacon applies only to federally funded projects.',
      laborTaxable: false,
      laborTaxNotes: 'Labor performed on real property is not subject to sales tax.',
      useTaxRate: 7.0,
      specialTaxesJson: JSON.stringify([
        { name: 'Business Tax (Gross Receipts)', description: 'Tennessee imposes a Business Tax on gross receipts from contracting activities. Classification and rates vary by county.' },
      ]),
      mpcDetailsJson: null,
      notes: 'One of the hardest states for contractors on government projects - must include full sales tax in bids. Highest base rate (7%) tied with MS. Business Tax adds to overhead.',
    },
    {
      state: 'SC',
      stateName: 'South Carolina',
      baseSalesTaxRate: 6.0,
      maxCombinedRate: 8.5,
      contractorClassification: 'consuming_contractor',
      contractorModelDescription: 'Contractors are deemed end users of building materials.',
      govtProjectExempt: false,
      govtExemptionMechanism: 'Federal government projects ONLY are exempt. State, county, and municipal government projects are NOT exempt - SC does not exempt its own government agency purchases in most cases.',
      govtExemptionForm: 'Written contract chain documentation (federal projects only)',
      bondThreshold: 100000,
      bondAmountPct: 100,
      bondTiersJson: JSON.stringify([
        { ceiling: 100000, rate: 2.5 },
        { ceiling: 500000, rate: 1.5 },
        { ceiling: 2500000, rate: 1.0 },
        { ceiling: null, rate: 0.75 },
      ]),
      prevailingWage: false,
      prevailingWageThreshold: null,
      prevailingWageNotes: 'No state prevailing wage law. Federal Davis-Bacon applies only to federally funded projects.',
      laborTaxable: false,
      laborTaxNotes: 'Construction labor is not subject to South Carolina sales tax.',
      useTaxRate: 6.0,
      specialTaxesJson: JSON.stringify([
        { name: 'Large facility exemption', description: 'Construction materials for single facility with $100M+ capital investment in 18 months are exempt. Unlikely for concrete subs.' },
      ]),
      mpcDetailsJson: null,
      notes: 'Only federal government projects are exempt. State/local government projects have NO exemption. Major cost factor on state/local bids. Bid bond requires at least 5% of total bid.',
    },
  ];
}
