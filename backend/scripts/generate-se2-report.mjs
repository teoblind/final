/**
 * Generate SE2 BTM Mining Feasibility Analysis — Excel + PDF
 * Compiles research from three agents into deliverables for Mo Haji / Spencer
 */

import ExcelJS from 'exceljs';

const DESKTOP = '/Users/teoblind/Desktop';

// ─── Styling ────────────────────────────────────────────────────────────────

const SANGHA_GREEN = '1A6B3C';
const DARK = '0D2818';
const LIGHT_GREEN = 'E8F5E9';
const WHITE = 'FFFFFF';
const LIGHT_GRAY = 'F5F7FA';
const MED_GRAY = 'E0E0E0';

const headerStyle = {
  font: { bold: true, color: { argb: 'FF' + WHITE }, size: 11, name: 'Calibri' },
  fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + DARK } },
  alignment: { vertical: 'middle', horizontal: 'center', wrapText: true },
  border: { bottom: { style: 'thin', color: { argb: 'FF' + SANGHA_GREEN } } },
};

const sectionHeader = {
  font: { bold: true, color: { argb: 'FF' + WHITE }, size: 12, name: 'Calibri' },
  fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + SANGHA_GREEN } },
  alignment: { vertical: 'middle', wrapText: true },
};

const subHeaderStyle = {
  font: { bold: true, color: { argb: 'FF' + DARK }, size: 10.5, name: 'Calibri' },
  fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + LIGHT_GREEN } },
  alignment: { vertical: 'middle', wrapText: true },
};

const currFmt = '$#,##0.00';
const numFmt = '#,##0';
const pctFmt = '0.0%';

function applyAltRows(ws, startRow, endRow) {
  for (let r = startRow; r <= endRow; r++) {
    if (r % 2 === 0) {
      ws.getRow(r).eachCell(c => {
        if (!c.style?.fill?.fgColor) {
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + LIGHT_GRAY } };
        }
      });
    }
  }
}

async function main() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sangha Renewables — Coppice Agent';
  wb.created = new Date();

  // ═══════════════════════════════════════════════════════════════════════════
  // SHEET 1: EXECUTIVE SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════
  const exec = wb.addWorksheet('Executive Summary');
  exec.columns = [
    { header: '', key: 'field', width: 35 },
    { header: '', key: 'value', width: 55 },
  ];

  // Title row
  exec.mergeCells('A1:B1');
  const titleCell = exec.getCell('A1');
  titleCell.value = 'SE2 BTM Mining Feasibility Analysis — Executive Summary';
  titleCell.style = { font: { bold: true, size: 16, color: { argb: 'FF' + DARK } }, alignment: { horizontal: 'center' } };
  exec.getRow(1).height = 35;

  exec.mergeCells('A2:B2');
  exec.getCell('A2').value = 'Prepared by Coppice Agent — Sangha Renewables | March 13, 2026';
  exec.getCell('A2').style = { font: { italic: true, size: 10, color: { argb: 'FF666666' } }, alignment: { horizontal: 'center' } };

  let row = 4;
  const addSection = (title) => {
    exec.mergeCells(`A${row}:B${row}`);
    exec.getCell(`A${row}`).value = title;
    exec.getCell(`A${row}`).style = sectionHeader;
    exec.getRow(row).height = 25;
    row++;
  };
  const addField = (field, value) => {
    exec.getCell(`A${row}`).value = field;
    exec.getCell(`A${row}`).font = { bold: true, size: 10 };
    exec.getCell(`B${row}`).value = value;
    exec.getCell(`B${row}`).alignment = { wrapText: true };
    row++;
  };

  addSection('PROJECT OVERVIEW');
  addField('Analyst', 'Mo Haji (mohamed.haji@gmail.com)');
  addField('Introduced By', 'Spencer Marr (spencer@sanghasystems.com)');
  addField('Subject', 'BTM mining feasibility for contracted wind asset in Swedish SE2 zone');
  addField('Date', 'March 13, 2026');
  addField('Asset Type', 'Onshore wind farm, ~200-250 MW nameplate (estimated from production data)');
  addField('Market Zone', 'SE2 (Sundsvall), Sweden — Nord Pool');
  addField('Contract Structure', 'Financial PPA with basis risk absorbed by offtaker (CfD-like)');

  row++;
  addSection('KEY FINDINGS');
  addField('Asset Status', 'Operating at ~1-3% effective capacity factor due to extreme curtailment by Svenska kraftnät (grid operator)');
  addField('Curtailment Cause', 'Severe transmission congestion at SE2→SE3 boundary (7,300 MW capacity). 679 hours of negative prices in 2025.');
  addField('Historical Pricing', 'Median $8.95/MWh, but massive volatility (Min -$108.78, Max $450.58). Pdn. Wtd. price: $16.81/MWh');
  addField('Forward Curve', 'Median $35.64/MWh — 4x historical. Green industrialization (HYBRIT, Stegra, Northvolt) absorbing surplus by 2030.');
  addField('Production Anomaly', 'Data is NOT corrupted. Low median (31 MWh) consistent with a wind farm curtailed to near-zero most days. Negative values (-7 MWh) = station service / parasitic load.');
  addField('BTM Opportunity', 'STRONG. Absorbs otherwise-curtailed generation at near-zero cost during 679+ negative-price hours/year. Converts waste energy to Bitcoin.');
  addField('Time Sensitivity', 'Window closing: surplus will be absorbed by industrial demand by ~2030. Forward prices already pricing this in.');

  row++;
  addSection('REGULATORY WARNINGS');
  addField('Sweden Tax', 'SEK 0.36/kWh electricity tax (6,000% increase from 2023). All-in cost ~$0.093/kWh — challenging for mining.');
  addField('Transparency Act', 'Jan 2025: Operations >0.5 MW must publish real-time energy consumption data (Crypto-Asset Environmental Transparency Act).');
  addField('Industry Exodus', '68% of Swedish miners plan to relocate by 2026. Sweden\'s mining share dropped from 38% to 27% of Nordic market.');
  addField('Alternative', 'Norway may be more favorable jurisdiction, though it banned new mining DCs in Oct 2025. Finland is most welcoming.');

  row++;
  addSection('RECOMMENDATION');
  addField('Verdict', 'Pursue — but structure deal NOW before industrial demand absorbs the surplus. Target merchant (uncontracted) wind assets in SE1/SE2 for maximum leverage.');
  addField('Next Steps', '1) Confirm data granularity (daily vs hourly) and nameplate capacity with Mo\n2) Model BTM economics using SE2 historical hourly prices\n3) Assess regulatory pathway for >0.5 MW operation\n4) Evaluate Norway/Finland as alternative jurisdictions');

  // ═══════════════════════════════════════════════════════════════════════════
  // SHEET 2: Mo's PRICING DATA
  // ═══════════════════════════════════════════════════════════════════════════
  const pricing = wb.addWorksheet('Pricing Data');
  pricing.columns = [
    { header: 'Metric', key: 'metric', width: 25 },
    { header: 'Historical (Full)', key: 'hist_full', width: 18 },
    { header: 'Historical (95%)', key: 'hist_95', width: 18 },
    { header: 'Forward (Full)', key: 'fwd_full', width: 18 },
    { header: 'Forward (95%)', key: 'fwd_95', width: 18 },
  ];
  pricing.getRow(1).eachCell(c => { Object.assign(c, { style: headerStyle }); });

  [
    ['Median ($/MWh)', 8.95, 8.04, 35.64, 35.00],
    ['Mean ($/MWh)', 29.46, 21.97, 38.47, 35.16],
    ['Max ($/MWh)', 450.58, 128.49, 457.54, 57.46],
    ['Min ($/MWh)', -108.78, -108.78, 1.07, 1.07],
    ['Pdn. Wtd. Price', null, 16.81, null, null],
  ].forEach(([m, hf, h95, ff, f95]) => {
    const r = pricing.addRow({ metric: m, hist_full: hf, hist_95: h95, fwd_full: ff, fwd_95: f95 });
    [2, 3, 4, 5].forEach(i => { if (r.getCell(i).value !== null) r.getCell(i).numFmt = currFmt; });
  });
  pricing.addRow({});
  pricing.addRow({ metric: '* Historical: Nov 2024 – Feb 2026' });
  pricing.addRow({ metric: '* Forward: Jan 2026 – Dec 2029' });
  pricing.addRow({ metric: '* All prices in USD (EUR→USD at 1.15)' });
  applyAltRows(pricing, 2, 6);

  // ═══════════════════════════════════════════════════════════════════════════
  // SHEET 3: PRODUCTION DATA + ANALYSIS
  // ═══════════════════════════════════════════════════════════════════════════
  const prod = wb.addWorksheet('Production Analysis');
  prod.columns = [
    { header: 'Metric', key: 'metric', width: 35 },
    { header: 'Value', key: 'value', width: 20 },
    { header: 'Notes', key: 'notes', width: 50 },
  ];
  prod.getRow(1).eachCell(c => { Object.assign(c, { style: headerStyle }); });

  [
    ['Median Production', '31 MWh', 'Extremely low — asset curtailed most of the time'],
    ['Mean Production', '51 MWh', 'Right-skewed: occasional full output pulls mean above median'],
    ['Max Production', '2,089 MWh', 'Key to sizing: implies ~200-250 MW nameplate if daily data'],
    ['Min Production', '-7 MWh', 'Station service / parasitic load during zero-gen — NOT corrupted data'],
    ['Data Period', 'May 2022 – Feb 2026', '~46 months, ~1,400 days, ~33,000 hours'],
    ['', '', ''],
    ['ANALYSIS', '', ''],
    ['Estimated Nameplate', '~200-250 MW', 'From max daily output: 2,089 MWh / 24h = 87 MW avg → ~220 MW at 40% CF'],
    ['Effective Capacity Factor', '~1-3%', 'Mean 51 MWh/day × 365 = 18,600 MWh/yr ÷ (220 MW × 8,760) = ~1%'],
    ['Expected Normal CF', '30-35%', 'A normal SE2 wind farm would produce 580,000-670,000 MWh/yr at 220 MW'],
    ['Actual vs Expected', '~3%', 'Producing roughly 3% of what it should — consistent with extreme curtailment'],
    ['Negative Price Hours', '679 hrs (2025)', 'SE2 tops all of Europe for negative pricing frequency'],
    ['', '', ''],
    ['WHY PRODUCTION IS SO LOW', '', ''],
    ['1. Transmission congestion', 'SE2→SE3', 'Cannot export surplus power south when wind + hydro both running'],
    ['2. Grid operator instructions', 'Svenska kraftnät', 'Downward dispatch orders during surplus; conditional grid connection agreements'],
    ['3. Economic curtailment', 'Rational behavior', 'Asset self-curtails during negative price hours (679+ hours in 2025)'],
    ['4. System inertia', 'Wind displacement', 'Grid needs synchronous machines online for stability; wind gets curtailed first'],
    ['5. Countertrading', 'EU 70% rule', 'TSO pays SE2 generators to reduce output to maintain cross-zonal capacity'],
  ].forEach(([m, v, n]) => {
    prod.addRow({ metric: m, value: v, notes: n });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SHEET 4: EBITDA ANALYSIS
  // ═══════════════════════════════════════════════════════════════════════════
  const ebitda = wb.addWorksheet('Implied EBITDA');
  ebitda.columns = [
    { header: 'Metric', key: 'metric', width: 30 },
    { header: 'Historical', key: 'hist', width: 18 },
    { header: 'Forward (EIP Curve)', key: 'fwd', width: 20 },
    { header: 'Notes', key: 'notes', width: 40 },
  ];
  ebitda.getRow(1).eachCell(c => { Object.assign(c, { style: headerStyle }); });

  [
    ['Mining MW', 100, 100, 'BTM mining capacity assumption'],
    ['# of Hours', 4196, 7, 'Hours where price < $5/MWh floor'],
    ['Floor Price ($/MWh)', 5.00, 5.00, 'Minimum the miner pays for power'],
    ['Implied EBITDA Uplift', 2098000, 3500, 'Revenue from mining during sub-floor hours'],
  ].forEach(([m, h, f, n]) => {
    const r = ebitda.addRow({ metric: m, hist: h, fwd: f, notes: n });
    if (m.includes('Floor')) { r.getCell(2).numFmt = currFmt; r.getCell(3).numFmt = currFmt; }
    else if (m.includes('EBITDA')) { r.getCell(2).numFmt = '$#,##0'; r.getCell(3).numFmt = '$#,##0'; r.getCell(2).font = { bold: true, size: 12 }; r.getCell(3).font = { bold: true, size: 12 }; }
    else { r.getCell(2).numFmt = numFmt; r.getCell(3).numFmt = numFmt; }
  });

  ebitda.addRow({});
  ebitda.addRow({ metric: 'KEY INSIGHT', hist: '', fwd: '', notes: '' });
  const insightRow = ebitda.lastRow.number;
  ebitda.mergeCells(`A${insightRow}:D${insightRow}`);
  ebitda.getCell(`A${insightRow}`).value = 'KEY INSIGHT: Historical EBITDA shows $2.1M uplift because SE2 had 4,196 hours below $5/MWh. Forward curve shows only 7 hours — meaning the market expects prices to rise significantly as industrial demand (Stegra, HYBRIT, Northvolt) absorbs the surplus. The BTM window is closing.';
  ebitda.getCell(`A${insightRow}`).alignment = { wrapText: true };
  ebitda.getCell(`A${insightRow}`).font = { bold: true, italic: true, size: 10 };
  ebitda.getRow(insightRow).height = 45;

  // ═══════════════════════════════════════════════════════════════════════════
  // SHEET 5: SE2 MARKET OVERVIEW
  // ═══════════════════════════════════════════════════════════════════════════
  const market = wb.addWorksheet('SE2 Market Overview');
  market.columns = [
    { header: 'Topic', key: 'topic', width: 30 },
    { header: 'Detail', key: 'detail', width: 70 },
  ];
  market.getRow(1).eachCell(c => { Object.assign(c, { style: headerStyle }); });

  [
    ['Zone', 'SE2 (Sundsvall) — second-northernmost of Sweden\'s four bidding zones'],
    ['Generation Mix', 'Hydropower (>97% of non-wind), rapidly growing onshore wind (47% of Swedish wind output)'],
    ['Structural Position', 'Generation-surplus zone. Most production in SE1/SE2, most consumption in SE3/SE4 (Stockholm, Malmö)'],
    ['Key Bottleneck', 'SE2→SE3 transmission: 7,300 MW capacity, but binding constraint during high-production periods'],
    ['Negative Price Hours', '679 (2025), 720 (2024) — tops ALL of Europe'],
    ['2024 Avg Price', '12.4 EUR/MWh (~$14.3/MWh)'],
    ['2025 Avg Price', '24.2 EUR/MWh (~$27.8/MWh) — rising due to industrial demand'],
    ['Settlement Period', '15-minute (transitioned from 1-hour in 2025, amplified volatility)'],
    ['Grid Operator', 'Svenska kraftnät (TSO)'],
    ['Market', 'Nord Pool (zonal pricing, not nodal like ERCOT)'],
    ['', ''],
    ['WHY PRICES ARE "BRUTAL"', ''],
    ['1. Oversupply', 'Wind + hydro (spring flood) combined generation massively exceeds local demand'],
    ['2. Transmission constraint', 'Cannot export surplus south; prices collapse in SE2 while SE3/SE4 stay high'],
    ['3. Must-run generation', 'Run-of-river hydro can\'t ramp down; must generate to avoid spillage'],
    ['4. Spike mechanics', 'Cold snaps + low wind + tight hydro → scarcity events ($450+/MWh)'],
    ['5. 15-min settlement', '2025 transition amplified volatility; producers can\'t determine balance in real-time'],
    ['', ''],
    ['FORWARD CURVE DIVERGENCE', ''],
    ['Historical median', '$8.95/MWh'],
    ['Forward median', '$35.64/MWh (4x historical)'],
    ['Driver 1', 'Green industrialization: HYBRIT/SSAB, Stegra/H2 Green Steel, Northvolt absorbing surplus'],
    ['Driver 2', 'SE2 faces 14.3 TWh additional industrial demand by 2030'],
    ['Driver 3', 'Stegra signed 7-year, 2 TWh/yr PPA with Statkraft — locking up generation capacity'],
    ['Driver 4', 'Additional 8,000+ MW demand by 2030, only ~1,000 MW new generation being added'],
    ['Implication', 'SE2 surplus will turn to DEFICIT by ~2030. Window for cheap BTM power is closing.'],
  ].forEach(([t, d]) => {
    market.addRow({ topic: t, detail: d });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SHEET 6: SCANDINAVIAN MINING LANDSCAPE
  // ═══════════════════════════════════════════════════════════════════════════
  const miners = wb.addWorksheet('Scandinavian Mining');
  miners.columns = [
    { header: 'Company', key: 'company', width: 25 },
    { header: 'Country', key: 'country', width: 12 },
    { header: 'Location', key: 'location', width: 20 },
    { header: 'Capacity (MW)', key: 'capacity', width: 15 },
    { header: 'Power Source', key: 'power', width: 15 },
    { header: 'Status / Notes', key: 'notes', width: 40 },
  ];
  miners.getRow(1).eachCell(c => { Object.assign(c, { style: headerStyle }); });

  [
    ['Kryptovault', 'Norway', 'Honefoss', '45 (18 active)', 'Hydro', 'Largest Norwegian facility; heat reuse for lumber drying'],
    ['Kryptovault', 'Norway', 'Dale', '25 (8 active)', 'Hydro', 'Former textile factory'],
    ['COWA / Lian Group', 'Norway', 'Mo i Rana', '40 (36 active)', 'Hydro', 'Former ironworks, built by Bitfury 2018'],
    ['Bitdeer', 'Norway', 'Molde', '38', 'Hydro', 'Cloud mining / hosting'],
    ['Bitzero', 'Norway', 'Namsskogan', '40→110', 'Hydro', 'Expanding to 110 MW, targeting 7 EH/s by Sept 2026'],
    ['Bitzero', 'Norway', 'Royrvik', '110 (315 P2)', 'Hydro', 'Under construction, Phase 2 = 315 MW'],
    ['Sazmining', 'Norway', 'Arctic Circle', '2.6', 'Hydro', 'Heat recovery for building + fish drying'],
    ['HIVE Digital', 'Sweden', 'Boden (SE1)', '37.5', 'Hydro', 'Converting to Tier III+ HPC/AI liquid-cooled center'],
    ['Northern Data', 'Sweden', 'Boden (SE1)', '35', 'Hydro', 'Acquired Hydro66 facility at Node Pole'],
    ['Genesis Digital', 'Sweden', 'Near Porjus', '8 (100 planned)', 'Hydro', '100% clean energy, co-located near 417 MW hydro plant'],
    ['Genesis Mining', 'Iceland', 'Multiple sites', 'Undisclosed', 'Geo+Hydro', '12% hashrate drop after 40 MW reallocated to off-peak'],
    ['Marathon Digital', 'Finland', 'Satakunta', '2 (pilot)', 'Grid', 'Heat recovery warms ~11,000 residents'],
  ].forEach(arr => {
    miners.addRow({ company: arr[0], country: arr[1], location: arr[2], capacity: arr[3], power: arr[4], notes: arr[5] });
  });
  applyAltRows(miners, 2, 13);

  miners.addRow({});
  miners.addRow({});
  const regRow = miners.lastRow.number + 1;
  miners.mergeCells(`A${regRow}:F${regRow}`);
  miners.getCell(`A${regRow}`).value = 'REGULATORY LANDSCAPE';
  miners.getCell(`A${regRow}`).style = sectionHeader;

  const regData = [
    ['Sweden', 'SEK 0.36/kWh tax (6,000% increase July 2023). Transparency Act Jan 2025. 68% of miners plan to leave by 2026.'],
    ['Norway', 'Banned new mining DCs Oct 2025. Mandatory DC registry Jan 2025. Existing operations grandfathered.'],
    ['Iceland', 'Existing farms capped at 150 MW. New entrants limited to 30 MW. BTC DCs = 90% of national DC power.'],
    ['Finland', 'Most welcoming Nordic jurisdiction. Regulated under FIN-FSA + EU MiCA. Cloud mining sector booming.'],
    ['EU (MiCA)', 'Effective Dec 2024. Sustainability disclosures required. No PoW ban, but carbon pricing under assessment.'],
  ];
  regData.forEach(([country, detail]) => {
    const r = miners.addRow({ company: country, country: '', location: '', capacity: '', power: '', notes: detail });
    miners.mergeCells(`B${r.number}:F${r.number}`);
    r.getCell(1).font = { bold: true };
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SHEET 7: ERCOT vs NORD POOL COMPARISON
  // ═══════════════════════════════════════════════════════════════════════════
  const compare = wb.addWorksheet('ERCOT vs Nord Pool');
  compare.columns = [
    { header: 'Factor', key: 'factor', width: 25 },
    { header: 'Nord Pool (Nordic/SE2)', key: 'nordic', width: 40 },
    { header: 'ERCOT (Texas)', key: 'ercot', width: 40 },
  ];
  compare.getRow(1).eachCell(c => { Object.assign(c, { style: headerStyle }); });

  [
    ['Pricing Model', 'Zonal (4 zones in Sweden)', 'Nodal (~10,000+ nodes, LMP)'],
    ['Electricity Cost', '2-4.5¢/kWh (northern, hydro PPA)', '3-5¢/kWh (BTM/wholesale)'],
    ['Energy Source', '92-100% renewable (hydro, wind)', 'Mixed (~30% renewable)'],
    ['Cooling', 'Free air cooling; PUE 1.05 achievable', 'Active cooling required; PUE 1.3-1.5+'],
    ['Demand Response', 'Not available (no equivalent program)', 'Up to 10% of revenue; Riot earned $31.7M in one summer'],
    ['Regulatory Risk', 'HIGH and rising (Sweden tax, Norway ban)', 'MODERATE (registration required, politically supportive)'],
    ['Grid Capacity', '~250 MW Norway, ~150 MW Sweden (frozen)', '4,288 MW active, growing to 5,300+ MW by 2027'],
    ['Negative Price Hours', '679/yr in SE2 (8% of all hours)', 'Common in West Texas wind zones, less extreme'],
    ['Scalability', 'Limited by regulation + grid politics', 'Nearly unlimited (ERCOT adding capacity)'],
    ['Carbon Claim', 'Strong (nearly 100% renewable)', 'Weak (grid ~30% renewable)'],
    ['Tax Incentives', 'Gone in Sweden; Norway taxing $0.015/kWh', 'No state income tax; favorable property deals'],
    ['Settlement Period', '15-minute (2025 transition)', '15-minute (with 5-min RT prices)'],
  ].forEach(arr => {
    compare.addRow({ factor: arr[0], nordic: arr[1], ercot: arr[2] });
  });
  applyAltRows(compare, 2, 13);

  // ═══════════════════════════════════════════════════════════════════════════
  // SHEET 8: SOURCES
  // ═══════════════════════════════════════════════════════════════════════════
  const sources = wb.addWorksheet('Sources');
  sources.columns = [
    { header: 'Source', key: 'source', width: 60 },
    { header: 'Topic', key: 'topic', width: 30 },
  ];
  sources.getRow(1).eachCell(c => { Object.assign(c, { style: headerStyle }); });

  [
    ['Montel News — Sweden tops 2025 negative power price hours', 'SE2 Pricing'],
    ['Bloomberg / Energy Connects — Investors Learn Brutal Lesson from Sweden Wind', 'Market Crisis'],
    ['Svenska kraftnät — Grid Development Plan 2024-2033', 'Transmission'],
    ['ScienceDirect — Curtailment Analysis for Nordic Power System', 'Curtailment'],
    ['Swedish Wind Energy Association — Statistics Q1 2025', 'Wind Capacity'],
    ['Hashrate Index — Bitcoin Mining in Sweden / Norway', 'Mining Operations'],
    ['CoinDesk — Sweden 6,000% Tax Hike', 'Regulation'],
    ['CoinDesk — Norway Bans New Crypto Mining DCs', 'Regulation'],
    ['S&P Global — H2 Green Steel Signs 14 TWh PPA', 'Forward Curve'],
    ['SKGS — Swedish Industry Electricity Demand to 2035', 'Demand Growth'],
    ['Ei — Sweden Electricity and Natural Gas Market 2024', 'Market Structure'],
    ['IEA — Sweden 2024 Energy Policy Review', 'Policy'],
    ['Braiins — Bitcoin Mining & Electric Grid Part 2', 'BTM Mining'],
    ['Marathon Digital — Finland Heat Recovery Press Release', 'Heat Reuse'],
    ['Bitzero — 70MW Expansion + FSE Listing', 'Norway Mining'],
  ].forEach(arr => {
    sources.addRow({ source: arr[0], topic: arr[1] });
  });
  applyAltRows(sources, 2, 16);

  // Save
  const outPath = `${DESKTOP}/Sangha_SE2_BTM_Analysis_Mo_Haji.xlsx`;
  await wb.xlsx.writeFile(outPath);
  console.log(`✓ Excel saved: ${outPath}`);
}

main().catch(console.error);
