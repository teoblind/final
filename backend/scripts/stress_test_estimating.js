#!/usr/bin/env node
/**
 * Stress Test - Estimating Features
 *
 * Tests all 5 new estimating services:
 * 1. Supplier Outreach
 * 2. Spec Parser
 * 3. RFI Generator
 * 4. Bid Distribution
 * 5. Bond Rate Optimizer
 *
 * Usage: node scripts/stress_test_estimating.js
 */

import jwt from 'jsonwebtoken';

const BASE = 'http://localhost:3002/api/v1/estimates';
const HOST = 'dacp.coppice.ai';
const JWT_SECRET = process.env.JWT_SECRET || 'lhFaqUPe1IR5DYqdWdSwwHJCguwVlU4FquFFNMShgWCjCHFRYs8L+x6PRXwGMdsG';

// Generate a test token
const token = jwt.sign(
  { userId: 'dacp-admin-001', email: 'admin@dacp.localhost', tenantId: 'dacp-construction-001', role: 'owner' },
  JWT_SECRET,
  { expiresIn: '1h' }
);

const headers = {
  'Content-Type': 'application/json',
  'Host': HOST,
  'Authorization': `Bearer ${token}`,
};

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, method, path, body = null) {
  const url = `${BASE}${path}`;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const start = Date.now();
  try {
    const res = await fetch(url, opts);
    const ms = Date.now() - start;
    const data = await res.json().catch(() => ({}));

    if (res.ok) {
      passed++;
      console.log(`  PASS  ${name} (${ms}ms) ${res.status}`);
      return data;
    } else {
      failed++;
      const msg = `${name}: ${res.status} ${JSON.stringify(data).slice(0, 200)}`;
      failures.push(msg);
      console.log(`  FAIL  ${msg} (${ms}ms)`);
      return null;
    }
  } catch (err) {
    failed++;
    const ms = Date.now() - start;
    const msg = `${name}: ${err.message}`;
    failures.push(msg);
    console.log(`  FAIL  ${msg} (${ms}ms)`);
    return null;
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

const SPEC_TEXT_MINIMAL = `
Basic concrete work. 3000 PSI. Standard rebar. No special requirements.
`;

const PROJECT_NAMES = [
  'Biloxi Upper Elementary School',
  'Downtown Dallas Mixed Use Tower',
  'Frisco Station Phase 3',
  'Bishop Arts Apartments',
  'I-35 Bridge Expansion',
  'Gulf Coast Medical Center',
  'Austin Tech Campus',
  'Houston Industrial Warehouse',
  'San Antonio Convention Center',
  'Jackson MS Federal Courthouse',
];

const GC_LISTS = [
  [
    { name: 'Turner Construction', email: 'bids@turner.com', contact: 'Mike Rodriguez', reputation: 'excellent' },
    { name: 'Hensel Phelps', email: 'bids@henselphelps.com', contact: 'Sarah Johnson', reputation: 'good' },
    { name: 'Brasfield & Gorrie', email: 'bids@brasfieldgorrie.com', contact: 'Tom Williams', reputation: 'good' },
  ],
  [
    { name: 'Skanska USA', email: 'bids@skanska.com', contact: 'Erik Andersson', reputation: 'excellent' },
    { name: 'JE Dunn', email: 'bids@jedunn.com', contact: 'Dave Miller', reputation: 'average' },
  ],
  [
    { name: 'Manhattan Construction', email: 'bids@manhattan.com', contact: 'Rick Torres', reputation: 'poor' },
    { name: 'Cadence McShane', email: 'bids@cadencemcshane.com', contact: 'Lisa Chen', reputation: 'unknown' },
    { name: 'Austin Commercial', email: 'bids@austincommercial.com', contact: 'James Brown', reputation: 'good' },
    { name: 'DPR Construction', email: 'bids@dpr.com', contact: 'Amy Park', reputation: 'excellent' },
  ],
];

// ─── Run Tests ────────────────────────────────────────────────────────────────

async function runAll() {
  console.log('\n========================================');
  console.log('  ESTIMATING FEATURES STRESS TEST');
  console.log('========================================\n');

  // ── 1. SUPPLIER OUTREACH ──────────────────────────────────────────────
  console.log('--- 1. SUPPLIER OUTREACH ---');

  // List suppliers (empty at first)
  await test('List all suppliers', 'GET', '/suppliers');
  await test('List concrete suppliers', 'GET', '/suppliers?type=concrete');
  await test('List rebar suppliers', 'GET', '/suppliers?type=rebar');

  // Search suppliers (will fail without Google API key, but should not crash)
  await test('Search concrete suppliers - Dallas', 'POST', '/suppliers/search', {
    location: 'Dallas, TX',
    supplierType: 'concrete',
    radiusMinutes: 15,
  });

  await test('Search rebar suppliers - Houston', 'POST', '/suppliers/search', {
    location: 'Houston, TX',
    supplierType: 'rebar',
    radiusMinutes: 60,
  });

  // Outreach generation
  await test('Generate supplier outreach - Biloxi', 'POST', '/suppliers/outreach', {
    projectName: 'Biloxi Upper Elementary School',
    projectLocation: 'Biloxi, MS',
    bidRequestId: 'test-bid-001',
    scope: 'Concrete flatwork, foundations, grade beams, piers',
    dueDate: '2026-04-15',
    supplierTypes: ['concrete', 'rebar'],
  });

  // ── 2. SPEC PARSER ────────────────────────────────────────────────────
  console.log('\n--- 2. SPEC PARSER ---');

  // Parse simple spec
  const simpleSpec = await test('Parse simple spec (MPC, bonds, prevailing wage)', 'POST', '/specs/parse', {
    bidRequestId: 'test-bid-001',
    projectName: 'Biloxi Upper Elementary School',
    specText: SPEC_TEXT_SIMPLE,
    docId: 'doc-001',
  });

  // Parse complex spec
  const complexSpec = await test('Parse complex spec (SCC, Type V, union, multi-PSI)', 'POST', '/specs/parse', {
    bidRequestId: 'test-bid-002',
    projectName: 'Downtown Dallas Mixed Use Tower',
    specText: SPEC_TEXT_COMPLEX,
    docId: 'doc-002',
  });

  // Parse minimal spec
  await test('Parse minimal spec', 'POST', '/specs/parse', {
    bidRequestId: 'test-bid-003',
    projectName: 'Simple Job',
    specText: SPEC_TEXT_MINIMAL,
    docId: 'doc-003',
  });

  // Parse empty spec (edge case)
  await test('Parse empty spec (edge case)', 'POST', '/specs/parse', {
    bidRequestId: 'test-bid-004',
    projectName: 'No Specs Project',
    specText: '',
    docId: 'doc-004',
  });

  // Get parsed specs back
  await test('Get specs for bid-001', 'GET', '/specs/test-bid-001');
  await test('Get specs for bid-002', 'GET', '/specs/test-bid-002');
  await test('Get specs for nonexistent bid', 'GET', '/specs/nonexistent-bid');

  // Validate parse results
  if (simpleSpec) {
    const checks = [
      ['taxStatus === mpc_exempt', simpleSpec.taxStatus === 'mpc_exempt'],
      ['bondRequired === true', simpleSpec.bondRequired === true],
      ['bondType === performance_and_payment', simpleSpec.bondType === 'performance_and_payment'],
      ['has prevailing_wage labor req', simpleSpec.laborRequirements?.some(l => l.type === 'prevailing_wage')],
      ['vbeSblvbRequired === true', simpleSpec.vbeSblvbRequired === true],
      ['has 4000 PSI spec', simpleSpec.concreteSpecs?.some(s => s.value?.includes('4000'))],
      ['has Grade 60 rebar', simpleSpec.rebarSpecs?.some(s => s.value?.includes('Grade 60'))],
      ['has epoxy-coated rebar', simpleSpec.rebarSpecs?.some(s => s.value?.includes('Epoxy'))],
      ['has liquidated_damages condition', simpleSpec.specialConditions?.some(s => s.type === 'liquidated_damages')],
      ['has retainage condition', simpleSpec.specialConditions?.some(s => s.type === 'retainage')],
      ['has warranty condition', simpleSpec.specialConditions?.some(s => s.type === 'warranty')],
    ];
    console.log('  --- Simple spec validation ---');
    for (const [label, ok] of checks) {
      if (ok) { passed++; console.log(`  PASS  ${label}`); }
      else { failed++; failures.push(`Validation: ${label}`); console.log(`  FAIL  ${label}`); }
    }
  }

  if (complexSpec) {
    const checks = [
      ['taxStatus === exempt', complexSpec.taxStatus === 'exempt'],
      ['bondRequired === false', complexSpec.bondRequired === false],
      ['has union labor req', complexSpec.laborRequirements?.some(l => l.type === 'union')],
      ['has 5000 PSI spec', complexSpec.concreteSpecs?.some(s => s.value?.includes('5000'))],
      ['has 6000 PSI spec', complexSpec.concreteSpecs?.some(s => s.value?.includes('6000'))],
      ['has Type V concrete', complexSpec.concreteSpecs?.some(s => s.value?.includes('Type V'))],
      ['has SCC concrete', complexSpec.concreteSpecs?.some(s => s.value?.includes('Self-consolidating'))],
      ['has lightweight concrete', complexSpec.concreteSpecs?.some(s => s.value?.includes('Lightweight'))],
      ['has fiber-reinforced', complexSpec.concreteSpecs?.some(s => s.value?.includes('Fiber'))],
      ['has air-entrained', complexSpec.concreteSpecs?.some(s => s.value?.includes('Air'))],
      ['has Grade 75 rebar', complexSpec.rebarSpecs?.some(s => s.value?.includes('Grade 75'))],
      ['has stainless rebar', complexSpec.rebarSpecs?.some(s => s.value?.includes('Stainless'))],
      ['has galvanized rebar', complexSpec.rebarSpecs?.some(s => s.value?.includes('Galvanized'))],
      ['has noise restriction', complexSpec.specialConditions?.some(s => s.type === 'noise')],
      ['has staging area', complexSpec.specialConditions?.some(s => s.type === 'staging')],
    ];
    console.log('  --- Complex spec validation ---');
    for (const [label, ok] of checks) {
      if (ok) { passed++; console.log(`  PASS  ${label}`); }
      else { failed++; failures.push(`Validation: ${label}`); console.log(`  FAIL  ${label}`); }
    }
  }

  // ── 3. RFI GENERATOR ──────────────────────────────────────────────────
  console.log('\n--- 3. RFI GENERATOR ---');

  // Generate RFIs from missing items
  const rfiResult1 = await test('Generate RFIs - missing items', 'POST', '/rfis/generate', {
    bidRequestId: 'test-bid-001',
    gcName: 'Turner Construction',
    gcEmail: 'bids@turner.com',
    projectName: 'Biloxi Upper Elementary School',
    missingItems: [
      'Transformer pad size and location',
      'Finish grade elevation for building B',
      'Control joint layout for warehouse slab',
      'Concrete cover requirement for exterior columns',
    ],
  });

  // Generate RFIs from ITB analysis
  await test('Generate RFIs - ITB analysis', 'POST', '/rfis/generate', {
    bidRequestId: 'test-bid-002',
    gcName: 'Hensel Phelps',
    gcEmail: 'bids@henselphelps.com',
    projectName: 'Downtown Dallas Mixed Use Tower',
    itbAnalysis: {
      missing_critical: [
        'Post-tension shop drawing responsibility',
        'Concrete pump access requirements',
        'Tower crane foundation design',
      ],
      rfi_needed: [
        { subject: 'Concrete Mix Design Approval', question: 'Please confirm the mix design approval process and required lead time for custom mixes.' },
        { subject: 'Rebar Lap Splice Details', question: 'Structural drawings S-401 and S-402 show conflicting lap splice lengths. Please clarify.' },
      ],
    },
  });

  // Generate with both missing items AND ITB
  await test('Generate RFIs - combined sources', 'POST', '/rfis/generate', {
    bidRequestId: 'test-bid-003',
    gcName: 'DPR Construction',
    gcEmail: 'bids@dpr.com',
    projectName: 'Austin Tech Campus',
    missingItems: ['Slab thickness for server room', 'Special curing requirements for data center floor'],
    itbAnalysis: {
      missing_critical: ['Vibration isolation pad details'],
      rfi_needed: [{ subject: 'Floor Flatness Requirements', question: 'Please confirm FF/FL requirements for raised floor areas.' }],
    },
  });

  // Generate with empty data (edge case)
  await test('Generate RFIs - empty (edge case)', 'POST', '/rfis/generate', {
    bidRequestId: 'test-bid-004',
    gcName: 'Test GC',
    gcEmail: 'test@gc.com',
    projectName: 'Empty Test',
  });

  // List all RFIs
  const allRfis = await test('List all RFIs', 'GET', '/rfis');

  // List RFIs by bid
  await test('List RFIs for bid-001', 'GET', '/rfis?bidRequestId=test-bid-001');
  await test('List RFIs for bid-002', 'GET', '/rfis?bidRequestId=test-bid-002');

  // Update RFI status
  if (rfiResult1?.rfis?.[0]) {
    const rfiId = rfiResult1.rfis[0].id;
    await test('Update RFI to sent', 'PATCH', `/rfis/${rfiId}`, {
      status: 'sent',
      sentDate: new Date().toISOString(),
    });
    await test('Update RFI with response', 'PATCH', `/rfis/${rfiId}`, {
      status: 'responded',
      responseBody: 'Transformer pad is 8x10 per detail S-12 on sheet S-201.',
      responseDate: new Date().toISOString(),
    });
  }

  // ── 4. BID DISTRIBUTION ───────────────────────────────────────────────
  console.log('\n--- 4. BID DISTRIBUTION ---');

  // Create distributions for different project sizes
  const bidAmounts = [450000, 1250000, 3800000, 8500000, 15000000];

  for (let i = 0; i < bidAmounts.length; i++) {
    const gcList = GC_LISTS[i % GC_LISTS.length];
    const project = PROJECT_NAMES[i];
    const bidId = `test-bid-dist-${i}`;

    const distResult = await test(`Create distributions - ${project} ($${(bidAmounts[i]/1000000).toFixed(1)}M)`, 'POST', '/bid-distributions', {
      bidRequestId: bidId,
      estimateId: `est-${i}`,
      projectName: project,
      baseBidTotal: bidAmounts[i],
      gcList,
    });

    // Validate adjustments
    if (distResult?.length > 0) {
      for (const dist of distResult) {
        const rep = dist.gcReputation;
        const factor = { excellent: 0.97, good: 1.0, average: 1.03, poor: 1.08, unknown: 1.02 }[rep];
        const expected = Math.round(bidAmounts[i] * factor / 100) * 100;
        const match = dist.adjustedTotal === expected;
        if (match) { passed++; console.log(`  PASS  ${dist.gcName} adjustment correct: $${dist.adjustedTotal.toLocaleString()} (${rep})`); }
        else { failed++; failures.push(`${dist.gcName} adjustment: got ${dist.adjustedTotal}, expected ${expected}`); console.log(`  FAIL  ${dist.gcName} adjustment: got ${dist.adjustedTotal}, expected ${expected}`); }
      }
    }

    // Get comparison
    await test(`Get bid comparison - ${project}`, 'GET', `/bid-distributions?bidRequestId=${bidId}`);
  }

  // Mark a bid as sent and record response
  const firstDist = await test('Get first project distributions', 'GET', '/bid-distributions?bidRequestId=test-bid-dist-0');
  if (firstDist?.distributions?.[0]) {
    const distId = firstDist.distributions[0].id;
    await test('Mark bid as sent', 'POST', `/bid-distributions/${distId}/send`);
    await test('Record GC response', 'POST', `/bid-distributions/${distId}/response`, {
      responseAmount: 460000,
      awardStatus: 'won',
      notes: 'Awarded! Start date April 15.',
    });
  }

  // Edge case: empty GC list
  await test('Create distributions - empty GC list (edge case)', 'POST', '/bid-distributions', {
    bidRequestId: 'test-bid-dist-empty',
    estimateId: 'est-empty',
    projectName: 'Empty GC Test',
    baseBidTotal: 500000,
    gcList: [],
  });

  // ── 5. BOND RATE OPTIMIZER ────────────────────────────────────────────
  console.log('\n--- 5. BOND RATE OPTIMIZER ---');

  // Get current bonding info
  await test('Get bonding info + benchmarks', 'GET', '/bonding');

  // Setup bond program
  await test('Setup bond program - competitive rate', 'POST', '/bonding/setup', {
    suretyCompany: 'Travelers Insurance',
    suretyContact: 'John Smith',
    suretyEmail: 'jsmith@travelers.com',
    suretyPhone: '555-123-4567',
    totalCapacity: 25000000,
    currentUtilization: 8000000,
    currentRatePct: 1.25,
    effectiveDate: '2026-01-01',
    expiryDate: '2027-01-01',
    notes: 'Renewed annual program',
  });

  await test('Setup bond program - above market rate', 'POST', '/bonding/setup', {
    suretyCompany: 'CNA Surety',
    suretyContact: 'Jane Doe',
    suretyEmail: 'jdoe@cna.com',
    suretyPhone: '555-987-6543',
    totalCapacity: 10000000,
    currentUtilization: 3000000,
    currentRatePct: 3.0,
    effectiveDate: '2026-01-01',
    expiryDate: '2027-01-01',
    notes: 'Legacy program - rate too high per Bill',
  });

  // Analyze bond rates at different project sizes
  const bondTests = [
    { total: 500000, rate: 3.0, expectFlag: 'critical' },
    { total: 500000, rate: 2.0, expectFlag: 'warning' },
    { total: 500000, rate: 1.5, expectFlag: 'good' },
    { total: 500000, rate: 1.0, expectFlag: 'good' },
    { total: 2500000, rate: 1.5, expectFlag: 'good' },
    { total: 2500000, rate: 2.5, expectFlag: 'critical' },
    { total: 5000000, rate: 1.25, expectFlag: null },  // slightly above but not warning
    { total: 5000000, rate: 2.0, expectFlag: 'critical' },
    { total: 10000000, rate: 1.0, expectFlag: null },
    { total: 10000000, rate: 1.5, expectFlag: 'critical' },
    { total: 25000000, rate: 0.85, expectFlag: null },
    { total: 25000000, rate: 1.5, expectFlag: 'critical' },
    { total: 50000000, rate: 0.75, expectFlag: 'good' },
    { total: 50000000, rate: 1.0, expectFlag: 'warning' },
    { total: 100000000, rate: 0.5, expectFlag: 'good' },
  ];

  for (const bt of bondTests) {
    const result = await test(
      `Analyze bond: $${(bt.total/1000000).toFixed(1)}M @ ${bt.rate}%`,
      'POST', '/bonding/analyze',
      { estimateTotal: bt.total, bondRatePct: bt.rate }
    );

    if (result) {
      // Validate savings math
      const expectedCurrentCost = Math.round(bt.total * bt.rate / 100);
      const costMatch = result.currentCost === expectedCurrentCost;
      if (costMatch) { passed++; console.log(`  PASS  Current cost calc: $${result.currentCost.toLocaleString()}`); }
      else { failed++; failures.push(`Bond cost: got ${result.currentCost}, expected ${expectedCurrentCost}`); console.log(`  FAIL  Bond cost: got ${result.currentCost}, expected ${expectedCurrentCost}`); }

      // Validate savings = current - market
      const expectedSavings = result.currentCost - result.marketCost;
      const savingsMatch = result.savings === expectedSavings;
      if (savingsMatch) { passed++; console.log(`  PASS  Savings calc: $${result.savings.toLocaleString()}`); }
      else { failed++; failures.push(`Savings: got ${result.savings}, expected ${expectedSavings}`); console.log(`  FAIL  Savings: got ${result.savings}, expected ${expectedSavings}`); }

      // Validate breakdown adds up
      if (result.breakdown?.length > 0) {
        const breakdownTotal = result.breakdown.reduce((sum, b) => sum + b.cost, 0);
        const breakdownMatch = Math.abs(breakdownTotal - result.marketCost) <= 1; // rounding tolerance
        if (breakdownMatch) { passed++; console.log(`  PASS  Breakdown adds up: $${breakdownTotal.toLocaleString()}`); }
        else { failed++; failures.push(`Breakdown sum ${breakdownTotal} != marketCost ${result.marketCost}`); console.log(`  FAIL  Breakdown sum ${breakdownTotal} != marketCost ${result.marketCost}`); }
      }

      // Validate flag
      if (bt.expectFlag) {
        const flagMatch = result.flag === bt.expectFlag;
        if (flagMatch) { passed++; console.log(`  PASS  Flag correct: ${result.flag}`); }
        else { failed++; failures.push(`Flag: got ${result.flag}, expected ${bt.expectFlag} (rate=${bt.rate}%, market=${result.marketRate}%)`); console.log(`  FAIL  Flag: got ${result.flag}, expected ${bt.expectFlag} (rate=${bt.rate}%, market=${result.marketRate}%)`); }
      }
    }
  }

  // Edge cases for bond analyzer
  await test('Analyze bond: $0 project (edge case)', 'POST', '/bonding/analyze', {
    estimateTotal: 0,
    bondRatePct: 1.5,
  });

  await test('Analyze bond: $1B project', 'POST', '/bonding/analyze', {
    estimateTotal: 1000000000,
    bondRatePct: 0.5,
  });

  await test('Analyze bond: 0% rate', 'POST', '/bonding/analyze', {
    estimateTotal: 5000000,
    bondRatePct: 0,
  });

  await test('Analyze bond: 10% rate (extreme)', 'POST', '/bonding/analyze', {
    estimateTotal: 1000000,
    bondRatePct: 10,
  });

  // ── CONCURRENCY TEST ──────────────────────────────────────────────────
  console.log('\n--- CONCURRENCY ---');

  const concurrentStart = Date.now();
  const concurrent = [];
  for (let i = 0; i < 20; i++) {
    concurrent.push(
      test(`Concurrent bond analyze #${i+1}`, 'POST', '/bonding/analyze', {
        estimateTotal: (i + 1) * 1000000,
        bondRatePct: 1.0 + (i * 0.1),
      })
    );
  }
  await Promise.all(concurrent);
  const concurrentMs = Date.now() - concurrentStart;
  console.log(`  20 concurrent requests completed in ${concurrentMs}ms (avg ${Math.round(concurrentMs/20)}ms)`);

  // Concurrent spec parses
  const specConcurrent = [];
  for (let i = 0; i < 10; i++) {
    specConcurrent.push(
      test(`Concurrent spec parse #${i+1}`, 'POST', '/specs/parse', {
        bidRequestId: `concurrent-bid-${i}`,
        projectName: PROJECT_NAMES[i],
        specText: i % 2 === 0 ? SPEC_TEXT_SIMPLE : SPEC_TEXT_COMPLEX,
      })
    );
  }
  await Promise.all(specConcurrent);

  // ── REPORT ────────────────────────────────────────────────────────────
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
  process.exit(failed > 0 ? 1 : 0);
}

runAll().catch(err => {
  console.error('Fatal error:', err);
  process.exit(2);
});
