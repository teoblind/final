#!/usr/bin/env node
/**
 * Stress Test - Estimating Features (Direct Service Tests)
 *
 * Tests all 5 new estimating services by importing them directly,
 * bypassing HTTP auth. This validates the actual business logic.
 *
 * Usage: node scripts/stress_test_estimating.js
 */

import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, '..', '.env') });

// Import DB (initializes tables) and set tenant context
import { setTenantContext, getDacpSuppliers, getDacpRfis, getDacpProjectSpecs, getDacpBidDistributions, getDacpBondProgram } from '../src/cache/database.js';

// Import services
import { extractSpecRequirements } from '../src/services/specParser.js';
import { detectRfiNeeds, generateRfiDrafts, formatRfiEmail, generateFromTemplate } from '../src/services/rfiGenerator.js';
import { createBidDistributions, getBidComparison, draftBidEmail, markBidSent, recordGcResponse } from '../src/services/bidDistribution.js';
import { calculateTieredBondCost, analyzeBondRate, setupBondProgram, addBondAnalysisToEstimate, MARKET_BENCHMARKS } from '../src/services/bondingOptimizer.js';

const TENANT_ID = 'dacp-construction-001';
let passed = 0;
let failed = 0;
const failures = [];

function assert(name, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    const msg = detail ? `${name} -- ${detail}` : name;
    failures.push(msg);
    console.log(`  FAIL  ${msg}`);
  }
}

// ─── Test Data ────────────────────────────────────────────────────────────────

const SPEC_TEXT_SIMPLE = `
SECTION 03 30 00 - CAST-IN-PLACE CONCRETE

1.01 GENERAL: All concrete work shall comply with ACI 318. Concrete compressive
strength shall be 4000 PSI at 28 days for all structural elements and 3000 PSI
for sidewalks and flatwork. Grade 60 rebar per ASTM A615. Epoxy-coated rebar
required in all exterior exposed conditions.

1.02 TAX STATUS: This project qualifies under the Mississippi Procurement Certificate
(MPC) program. The GC will pay 3.5% to the Mississippi Department of Revenue.
All subcontractors and material suppliers are exempt from sales tax.

1.03 BONDS: A performance bond and payment bond are required, each in the amount
of 100% of the contract sum.

1.04 LABOR: Prevailing wage rates apply per Davis-Bacon Act. All workers must be
certified and carry appropriate documentation.

1.05 VBE PARTICIPATION: A minimum of 10% VBE participation is required.
SBLVB firms are encouraged to submit proposals.

1.06 SPECIAL CONDITIONS:
- Liquidated damages of $1,500 per calendar day for late completion.
- Retainage of 10% shall be withheld until substantial completion.
- Warranty period is 2 years from date of substantial completion.
- Working hours restricted to 7:00 AM to 6:00 PM Monday through Saturday.
- Completion date is December 31, 2026.
`;

const SPEC_TEXT_COMPLEX = `
DIVISION 03 - CONCRETE

SECTION 03 10 00 - CONCRETE FORMING
All formwork per ACI 347. Self-consolidating concrete (SCC) for complex pours.
Type V cement (sulfate resistant) required in foundation elements below grade.

SECTION 03 20 00 - REINFORCEMENT
Grade 75 rebar for columns. Grade 60 for slabs and beams.
Stainless steel rebar in pool deck areas. Galvanized rebar at all water features.
Air-entrained concrete required for all exterior flatwork (6% +/- 1%).

SECTION 03 30 00 - CAST-IN-PLACE
5000 PSI for post-tensioned slabs. 6000 PSI for columns.
4000 PSI for grade beams. 3500 PSI for sidewalks.
Lightweight concrete for second floor elevated deck.
Fiber-reinforced concrete for warehouse slab-on-grade.

SECTION 01 20 00 - GENERAL
This is a tax exempt project. No sales tax applies to materials.
Union labor required per project labor agreement.
No bonds required for subcontractors under $500,000.

Staging area available at northeast corner of site only.
Noise restrictions in effect between 10 PM and 6 AM.
`;

const GC_LISTS = [
  [
    { name: 'Turner Construction', email: 'bids@turner.com', contact: 'Mike Rodriguez', reputation: 'excellent' },
    { name: 'Hensel Phelps', email: 'bids@henselphelps.com', contact: 'Sarah Johnson', reputation: 'good' },
    { name: 'Brasfield & Gorrie', email: 'bids@brasfieldgorrie.com', contact: 'Tom Williams', reputation: 'good' },
  ],
  [
    { name: 'Manhattan Construction', email: 'bids@manhattan.com', contact: 'Rick Torres', reputation: 'poor' },
    { name: 'Cadence McShane', email: 'bids@cadencemcshane.com', contact: 'Lisa Chen', reputation: 'unknown' },
    { name: 'Austin Commercial', email: 'bids@austincommercial.com', contact: 'James Brown', reputation: 'good' },
    { name: 'DPR Construction', email: 'bids@dpr.com', contact: 'Amy Park', reputation: 'excellent' },
  ],
];

// ─── Run Tests ────────────────────────────────────────────────────────────────

function runAll() {
  // Wrap everything in tenant context
  setTenantContext(TENANT_ID, () => {
    console.log('\n========================================');
    console.log('  ESTIMATING FEATURES STRESS TEST');
    console.log(`  Tenant: ${TENANT_ID}`);
    console.log('========================================\n');

    testSpecParser();
    testRfiGenerator();
    testBidDistribution();
    testBondOptimizer();
    testConcurrency();

    console.log('\n========================================');
    console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
    console.log('========================================');

    if (failures.length > 0) {
      console.log('\nFailures:');
      for (const f of failures) {
        console.log(`  - ${f}`);
      }
    }
    console.log('');
  });

  process.exit(failed > 0 ? 1 : 0);
}

// ─── 1. SPEC PARSER ──────────────────────────────────────────────────────────

function testSpecParser() {
  console.log('--- 1. SPEC PARSER ---');

  // Simple spec with MPC, bonds, prevailing wage
  const simple = extractSpecRequirements(SPEC_TEXT_SIMPLE);
  assert('Simple: taxStatus = mpc_exempt', simple.taxStatus === 'mpc_exempt', `got: ${simple.taxStatus}`);
  assert('Simple: bondRequired = true', simple.bondRequired === true);
  assert('Simple: bondType = performance_and_payment', simple.bondType === 'performance_and_payment', `got: ${simple.bondType}`);
  assert('Simple: has prevailing_wage', simple.laborRequirements.some(l => l.type === 'prevailing_wage'));
  assert('Simple: vbeSblvbRequired = true', simple.vbeSblvbRequired === true);
  assert('Simple: has 4000 PSI', simple.concreteSpecs.some(s => s.value?.includes('4000')));
  assert('Simple: has 3000 PSI', simple.concreteSpecs.some(s => s.value?.includes('3000')));
  assert('Simple: has Grade 60', simple.rebarSpecs.some(s => s.value?.includes('Grade 60')));
  assert('Simple: has epoxy-coated', simple.rebarSpecs.some(s => s.value?.includes('Epoxy')));
  assert('Simple: has liquidated_damages', simple.specialConditions.some(s => s.type === 'liquidated_damages'));
  assert('Simple: has retainage', simple.specialConditions.some(s => s.type === 'retainage'));
  assert('Simple: has warranty', simple.specialConditions.some(s => s.type === 'warranty'));
  assert('Simple: has work_hours', simple.specialConditions.some(s => s.type === 'work_hours'));
  assert('Simple: has schedule (completion date)', simple.specialConditions.some(s => s.type === 'schedule'));

  // Complex spec
  const complex = extractSpecRequirements(SPEC_TEXT_COMPLEX);
  assert('Complex: taxStatus = exempt', complex.taxStatus === 'exempt', `got: ${complex.taxStatus}`);
  assert('Complex: has union labor', complex.laborRequirements.some(l => l.type === 'union'));
  assert('Complex: has 5000 PSI', complex.concreteSpecs.some(s => s.value?.includes('5000')));
  assert('Complex: has 6000 PSI', complex.concreteSpecs.some(s => s.value?.includes('6000')));
  assert('Complex: has 4000 PSI', complex.concreteSpecs.some(s => s.value?.includes('4000')));
  assert('Complex: has 3500 PSI', complex.concreteSpecs.some(s => s.value?.includes('3500')));
  assert('Complex: has Type V', complex.concreteSpecs.some(s => s.value?.includes('Type V')));
  assert('Complex: has SCC', complex.concreteSpecs.some(s => s.value?.includes('Self-consolidating')));
  assert('Complex: has lightweight', complex.concreteSpecs.some(s => s.value?.includes('Lightweight')));
  assert('Complex: has fiber-reinforced', complex.concreteSpecs.some(s => s.value?.includes('Fiber')));
  assert('Complex: has air-entrained', complex.concreteSpecs.some(s => s.value?.includes('Air')));
  assert('Complex: has Grade 75', complex.rebarSpecs.some(s => s.value?.includes('Grade 75')));
  assert('Complex: has Grade 60', complex.rebarSpecs.some(s => s.value?.includes('Grade 60')));
  assert('Complex: has stainless', complex.rebarSpecs.some(s => s.value?.includes('Stainless')));
  assert('Complex: has galvanized', complex.rebarSpecs.some(s => s.value?.includes('Galvanized')));
  assert('Complex: has noise restriction', complex.specialConditions.some(s => s.type === 'noise'));
  assert('Complex: has staging area', complex.specialConditions.some(s => s.type === 'staging'));

  // Edge: empty spec
  const empty = extractSpecRequirements('');
  assert('Empty: taxStatus = null', empty.taxStatus === null);
  assert('Empty: bondRequired = false', empty.bondRequired === false);
  assert('Empty: no labor reqs', empty.laborRequirements.length === 0);
  assert('Empty: no concrete specs', empty.concreteSpecs.length === 0);

  // Edge: null spec
  const nullSpec = extractSpecRequirements(null);
  assert('Null: returns valid object', nullSpec !== null && typeof nullSpec === 'object');

  // Minimal spec
  const minimal = extractSpecRequirements('Basic concrete work. 3000 PSI. Standard rebar.');
  assert('Minimal: has 3000 PSI', minimal.concreteSpecs.some(s => s.value?.includes('3000')));

  console.log('');
}

// ─── 2. RFI GENERATOR ────────────────────────────────────────────────────────

function testRfiGenerator() {
  console.log('--- 2. RFI GENERATOR ---');

  // Detect from missing items
  const suggestions1 = detectRfiNeeds({
    missingInfo: ['Transformer pad size', 'Grade elevation for Bldg B', 'Control joint layout'],
  });
  assert('Detect: 3 suggestions from missingInfo', suggestions1.length === 3, `got: ${suggestions1.length}`);

  // Detect from ITB analysis
  const suggestions2 = detectRfiNeeds({
    itbAnalysis: {
      missing_critical: ['PT shop drawing responsibility', 'Pump access requirements'],
      rfi_needed: [
        { subject: 'Mix Design Approval', question: 'Confirm mix design process.' },
      ],
    },
  });
  assert('Detect: 3 suggestions from ITB', suggestions2.length === 3, `got: ${suggestions2.length}`);

  // Detect from both sources combined
  const suggestions3 = detectRfiNeeds({
    missingInfo: ['Slab thickness'],
    itbAnalysis: {
      missing_critical: ['Vibration pad details'],
      rfi_needed: [{ subject: 'Floor Flatness', question: 'Confirm FF/FL.' }],
    },
  });
  assert('Detect: 3 suggestions combined', suggestions3.length === 3, `got: ${suggestions3.length}`);

  // Detect from empty input
  const suggestions4 = detectRfiNeeds({});
  assert('Detect: 0 suggestions from empty', suggestions4.length === 0);

  // Generate RFI drafts and save to DB
  const rfis = generateRfiDrafts(TENANT_ID, {
    bidRequestId: 'stress-bid-001',
    gcName: 'Turner Construction',
    gcEmail: 'bids@turner.com',
    projectName: 'Biloxi Upper Elementary',
    suggestions: suggestions1,
  });
  assert('Generate: created 3 RFIs', rfis.length === 3, `got: ${rfis.length}`);
  assert('Generate: each has id', rfis.every(r => r.id));
  assert('Generate: each has subject', rfis.every(r => r.subject));
  assert('Generate: each has status=draft', rfis.every(r => r.status === 'draft'));

  // Read back from DB
  const dbRfis = getDacpRfis(TENANT_ID, 'stress-bid-001');
  assert('DB: rfis saved correctly', dbRfis.length === 3, `got: ${dbRfis.length}`);

  // Format email
  if (rfis[0]) {
    const email = formatRfiEmail(rfis[0], { companyName: 'DACP Construction', contactName: 'Marcel Pineda' });
    assert('Email: has to field', !!email.to);
    assert('Email: has subject', !!email.subject);
    assert('Email: has body', !!email.body);
    assert('Email: body mentions DACP', email.body.includes('Marcel Pineda') || email.body.includes('DACP'));
  }

  // Template generation
  const tpad = generateFromTemplate('transformer_pad', 'Building A');
  assert('Template: transformer_pad works', tpad !== null);
  assert('Template: body mentions Building A', tpad.body.includes('Building A'));

  const strength = generateFromTemplate('concrete_strength', 'the parking garage slab');
  assert('Template: concrete_strength works', strength !== null);

  const badTemplate = generateFromTemplate('nonexistent_template');
  assert('Template: nonexistent returns null', badTemplate === null);

  console.log('');
}

// ─── 3. BID DISTRIBUTION ────────────────────────────────────────────────────

function testBidDistribution() {
  console.log('--- 3. BID DISTRIBUTION ---');

  // Create distributions for a $1.5M project
  const dists1 = createBidDistributions(TENANT_ID, {
    bidRequestId: 'stress-dist-001',
    estimateId: 'est-001',
    projectName: 'Biloxi Upper Elementary',
    baseBidTotal: 1500000,
    gcList: GC_LISTS[0],
  });
  assert('Create: 3 distributions', dists1.length === 3, `got: ${dists1.length}`);

  // Validate reputation adjustments
  const factors = { excellent: 0.97, good: 1.0, average: 1.03, poor: 1.08, unknown: 1.02 };
  for (const dist of dists1) {
    const expected = Math.round(1500000 * factors[dist.gcReputation] / 100) * 100;
    assert(`Adjustment: ${dist.gcName} (${dist.gcReputation}) = $${dist.adjustedTotal}`, dist.adjustedTotal === expected, `expected $${expected}`);
  }

  // Create for a larger project with more GCs
  const dists2 = createBidDistributions(TENANT_ID, {
    bidRequestId: 'stress-dist-002',
    estimateId: 'est-002',
    projectName: 'Downtown Dallas Tower',
    baseBidTotal: 8500000,
    gcList: GC_LISTS[1],
  });
  assert('Create: 4 distributions (large project)', dists2.length === 4, `got: ${dists2.length}`);

  // Verify poor reputation gets 8% premium
  const poorGc = dists2.find(d => d.gcReputation === 'poor');
  if (poorGc) {
    const expectedPoor = Math.round(8500000 * 1.08 / 100) * 100;
    assert('Poor GC gets 8% premium', poorGc.adjustedTotal === expectedPoor, `got $${poorGc.adjustedTotal}, expected $${expectedPoor}`);
  }

  // Verify excellent reputation gets 3% discount
  const excellentGc = dists2.find(d => d.gcReputation === 'excellent');
  if (excellentGc) {
    const expectedExc = Math.round(8500000 * 0.97 / 100) * 100;
    assert('Excellent GC gets 3% discount', excellentGc.adjustedTotal === expectedExc, `got $${excellentGc.adjustedTotal}, expected $${expectedExc}`);
  }

  // Get comparison view
  const comparison = getBidComparison(TENANT_ID, 'stress-dist-001');
  assert('Comparison: totalGCs = 3', comparison.totalGCs === 3, `got: ${comparison.totalGCs}`);
  assert('Comparison: has distributions', comparison.distributions.length === 3);
  assert('Comparison: has priceRange', comparison.priceRange.min > 0 && comparison.priceRange.max > 0);
  assert('Comparison: min < max', comparison.priceRange.min <= comparison.priceRange.max);

  // Draft bid email
  const emailDraft = draftBidEmail(dists1[0], {
    companyName: 'DACP Construction',
    contactName: 'Marcel Pineda',
    contactPhone: '555-000-1111',
    inclusions: '- All concrete per plans\n- Rebar furnished and installed\n- Finishing',
    exclusions: '- Excavation\n- Backfill\n- Waterproofing',
  });
  assert('Email: has to', !!emailDraft.to);
  assert('Email: subject has project name', emailDraft.subject.includes('Biloxi'));
  assert('Email: body has total', emailDraft.body.includes('$'));
  assert('Email: body has inclusions', emailDraft.body.includes('INCLUSIONS'));
  assert('Email: body has exclusions', emailDraft.body.includes('EXCLUSIONS'));

  // Empty GC list
  const empty = createBidDistributions(TENANT_ID, {
    bidRequestId: 'stress-dist-empty',
    estimateId: 'est-empty',
    projectName: 'Empty Test',
    baseBidTotal: 500000,
    gcList: [],
  });
  assert('Empty GC list: returns empty array', empty.length === 0);

  // Different project sizes
  const sizes = [100000, 500000, 2000000, 5000000, 10000000, 50000000];
  for (const size of sizes) {
    const d = createBidDistributions(TENANT_ID, {
      bidRequestId: `stress-size-${size}`,
      estimateId: `est-size-${size}`,
      projectName: `$${(size/1000000).toFixed(1)}M Project`,
      baseBidTotal: size,
      gcList: [{ name: 'Test GC', email: 'test@gc.com', reputation: 'good' }],
    });
    assert(`Size $${(size/1000000).toFixed(1)}M: creates distribution`, d.length === 1);
    assert(`Size $${(size/1000000).toFixed(1)}M: amount = base (good rep)`, d[0].adjustedTotal === Math.round(size / 100) * 100);
  }

  console.log('');
}

// ─── 4. BOND RATE OPTIMIZER ─────────────────────────────────────────────────

function testBondOptimizer() {
  console.log('--- 4. BOND RATE OPTIMIZER ---');

  // Market benchmarks exist
  assert('Benchmarks: tiers defined', MARKET_BENCHMARKS.tiers.length === 5);
  assert('Benchmarks: byExperience defined', Object.keys(MARKET_BENCHMARKS.byExperience).length === 4);

  // Tiered bond cost calculation
  const calc1 = calculateTieredBondCost(1000000);
  assert('Calc $1M: totalCost > 0', calc1.totalCost > 0);
  assert('Calc $1M: effectiveRate = 1.5%', calc1.effectiveRate === 1.5, `got: ${calc1.effectiveRate}`);
  assert('Calc $1M: 1 tier in breakdown', calc1.breakdown.length === 1, `got: ${calc1.breakdown.length}`);

  const calc2 = calculateTieredBondCost(5000000);
  assert('Calc $5M: spans 2 tiers', calc2.breakdown.length === 2, `got: ${calc2.breakdown.length}`);
  assert('Calc $5M: effective rate < 1.5%', calc2.effectiveRate < 1.5, `got: ${calc2.effectiveRate}`);

  const calc3 = calculateTieredBondCost(30000000);
  assert('Calc $30M: spans 5 tiers', calc3.breakdown.length === 5, `got: ${calc3.breakdown.length}`);
  assert('Calc $30M: effective rate < 1%', calc3.effectiveRate < 1.0, `got: ${calc3.effectiveRate}`);

  // Validate breakdown math
  for (const calc of [calc1, calc2, calc3]) {
    const breakdownSum = calc.breakdown.reduce((s, b) => s + b.cost, 0);
    assert(`Breakdown sums to totalCost (${calc.totalCost})`, Math.abs(breakdownSum - calc.totalCost) <= 1, `sum: ${breakdownSum}`);
    const breakdownAmounts = calc.breakdown.reduce((s, b) => s + b.amount, 0);
    const expectedAmount = calc === calc1 ? 1000000 : calc === calc2 ? 5000000 : 30000000;
    assert(`Breakdown amounts sum to project total`, breakdownAmounts === expectedAmount, `sum: ${breakdownAmounts}`);
  }

  // Edge: $0 project
  const calc0 = calculateTieredBondCost(0);
  assert('Calc $0: totalCost = 0', calc0.totalCost === 0);
  assert('Calc $0: effectiveRate = 0', calc0.effectiveRate === 0);

  // Edge: $1B project
  const calcB = calculateTieredBondCost(1000000000);
  assert('Calc $1B: totalCost > 0', calcB.totalCost > 0);
  assert('Calc $1B: effective rate close to 0.75%', calcB.effectiveRate < 0.8, `got: ${calcB.effectiveRate}`);

  // Analyze bond rates
  const analysis1 = analyzeBondRate(TENANT_ID, { estimateTotal: 1000000, bondRatePct: 3.0 });
  assert('Analysis $1M@3%: flag = critical', analysis1.flag === 'critical', `got: ${analysis1.flag}`);
  assert('Analysis $1M@3%: currentCost = 30000', analysis1.currentCost === 30000);
  assert('Analysis $1M@3%: savings > 0', analysis1.savings > 0);
  assert('Analysis $1M@3%: has recommendation', !!analysis1.recommendation);

  const analysis2 = analyzeBondRate(TENANT_ID, { estimateTotal: 1000000, bondRatePct: 1.5 });
  assert('Analysis $1M@1.5%: flag = good', analysis2.flag === 'good', `got: ${analysis2.flag}`);

  const analysis3 = analyzeBondRate(TENANT_ID, { estimateTotal: 5000000, bondRatePct: 2.0 });
  assert('Analysis $5M@2%: flag = critical', analysis3.flag === 'critical', `got: ${analysis3.flag}`);

  // DACP's actual rate per Bill
  const dacpAnalysis = analyzeBondRate(TENANT_ID, { estimateTotal: 2000000, bondRatePct: 3.0 });
  assert('DACP 3% rate: flagged critical', dacpAnalysis.flag === 'critical', `got: ${dacpAnalysis.flag}`);
  assert('DACP 3% rate: significant savings', dacpAnalysis.savings > 10000, `savings: $${dacpAnalysis.savings}`);
  console.log(`  INFO  DACP @ 3%: could save $${dacpAnalysis.savings.toLocaleString()} (${dacpAnalysis.savingsPct}%) on $2M project`);

  // Sweep: test many rate/size combos
  const sizes = [500000, 1000000, 2500000, 5000000, 10000000, 25000000, 50000000];
  const rates = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0, 5.0];
  let sweepPass = 0;
  let sweepFail = 0;
  for (const size of sizes) {
    for (const rate of rates) {
      try {
        const a = analyzeBondRate(TENANT_ID, { estimateTotal: size, bondRatePct: rate });
        // Validate math
        const expectedCost = Math.round(size * rate / 100);
        if (a.currentCost !== expectedCost) { sweepFail++; continue; }
        if (a.savings !== a.currentCost - a.marketCost) { sweepFail++; continue; }
        sweepPass++;
      } catch (e) {
        sweepFail++;
      }
    }
  }
  assert(`Sweep: ${sweepPass}/${sizes.length * rates.length} combos pass math check`, sweepFail === 0, `${sweepFail} failed`);

  // Setup bond program (saves to DB)
  const setup1 = setupBondProgram(TENANT_ID, {
    suretyCompany: 'Travelers Insurance',
    suretyContact: 'John Smith',
    suretyEmail: 'jsmith@travelers.com',
    suretyPhone: '555-123-4567',
    totalCapacity: 25000000,
    currentUtilization: 8000000,
    currentRatePct: 1.25,
    effectiveDate: '2026-01-01',
    expiryDate: '2027-01-01',
  });
  assert('Setup competitive: returns id', !!setup1.id);
  assert('Setup competitive: rateFlag = competitive', setup1.rateFlag === 'competitive', `got: ${setup1.rateFlag}`);

  const setup2 = setupBondProgram(TENANT_ID, {
    suretyCompany: 'CNA Surety',
    suretyContact: 'Jane Doe',
    suretyEmail: 'jdoe@cna.com',
    totalCapacity: 10000000,
    currentRatePct: 3.0,
    effectiveDate: '2026-01-01',
    expiryDate: '2027-01-01',
  });
  assert('Setup above market: rateFlag = above_market', setup2.rateFlag === 'above_market', `got: ${setup2.rateFlag}`);

  // Read from DB
  const programs = getDacpBondProgram(TENANT_ID);
  assert('DB: bond programs saved', programs.length >= 2, `got: ${programs.length}`);

  // addBondAnalysisToEstimate
  const noteResult1 = addBondAnalysisToEstimate(TENANT_ID, 2000000, 3.0);
  assert('Add to estimate @3%: returns recommendation', noteResult1 !== null);
  assert('Add to estimate @3%: has flag', !!noteResult1?.flag);

  const noteResult2 = addBondAnalysisToEstimate(TENANT_ID, 2000000, 1.0);
  assert('Add to estimate @1%: returns null (good rate)', noteResult2 === null);

  console.log('');
}

// ─── 5. CONCURRENCY / STRESS ────────────────────────────────────────────────

function testConcurrency() {
  console.log('--- 5. STRESS / VOLUME ---');

  // Rapid-fire spec parsing (100 iterations)
  const specStart = Date.now();
  for (let i = 0; i < 100; i++) {
    extractSpecRequirements(i % 2 === 0 ? SPEC_TEXT_SIMPLE : SPEC_TEXT_COMPLEX);
  }
  const specMs = Date.now() - specStart;
  assert(`100 spec parses in ${specMs}ms`, specMs < 5000, `took ${specMs}ms`);
  console.log(`  INFO  100 spec parses: ${specMs}ms (${(specMs/100).toFixed(1)}ms avg)`);

  // Rapid-fire bond calculations (1000 iterations)
  const bondStart = Date.now();
  for (let i = 0; i < 1000; i++) {
    calculateTieredBondCost((i + 1) * 100000);
  }
  const bondMs = Date.now() - bondStart;
  assert(`1000 bond calcs in ${bondMs}ms`, bondMs < 5000, `took ${bondMs}ms`);
  console.log(`  INFO  1000 bond calcs: ${bondMs}ms (${(bondMs/1000).toFixed(2)}ms avg)`);

  // Rapid-fire bond analyses (500 iterations)
  const analysisStart = Date.now();
  for (let i = 0; i < 500; i++) {
    analyzeBondRate(TENANT_ID, { estimateTotal: (i + 1) * 200000, bondRatePct: 0.5 + (i % 10) * 0.3 });
  }
  const analysisMs = Date.now() - analysisStart;
  assert(`500 bond analyses in ${analysisMs}ms`, analysisMs < 5000, `took ${analysisMs}ms`);
  console.log(`  INFO  500 bond analyses: ${analysisMs}ms (${(analysisMs/500).toFixed(2)}ms avg)`);

  // Rapid-fire RFI detection (200 iterations)
  const rfiStart = Date.now();
  for (let i = 0; i < 200; i++) {
    detectRfiNeeds({
      missingInfo: [`Missing item ${i}`, `Another missing item ${i}`],
      itbAnalysis: { missing_critical: [`Critical ${i}`], rfi_needed: [{ subject: `RFI ${i}`, question: `Question ${i}` }] },
    });
  }
  const rfiMs = Date.now() - rfiStart;
  assert(`200 RFI detections in ${rfiMs}ms`, rfiMs < 5000, `took ${rfiMs}ms`);
  console.log(`  INFO  200 RFI detections: ${rfiMs}ms (${(rfiMs/200).toFixed(2)}ms avg)`);

  // Bulk bid distributions (50 projects x 4 GCs = 200 distributions)
  const distStart = Date.now();
  for (let i = 0; i < 50; i++) {
    createBidDistributions(TENANT_ID, {
      bidRequestId: `stress-bulk-${i}`,
      estimateId: `est-bulk-${i}`,
      projectName: `Stress Project ${i}`,
      baseBidTotal: 1000000 + i * 100000,
      gcList: GC_LISTS[1],
    });
  }
  const distMs = Date.now() - distStart;
  assert(`50x4=200 bid distributions in ${distMs}ms`, distMs < 10000, `took ${distMs}ms`);
  console.log(`  INFO  200 bid distributions: ${distMs}ms (${(distMs/200).toFixed(2)}ms avg)`);

  console.log('');
}

// ─── Go ─────────────────────────────────────────────────────────────────────

runAll();
