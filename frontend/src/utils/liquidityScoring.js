/**
 * TBL-Style Liquidity Signal Scoring Engine
 *
 * DIY implementation inspired by The Bitcoin Layer's framework.
 * Computes composite liquidity score and generates BUY/SELL/NEUTRAL signals
 * for BTC, Gold, and Silver.
 *
 * Key threshold: Composite > 50 = "CONDUCIVE" for risk assets
 */

/**
 * Input data structure for liquidity calculations
 * @typedef {Object} LiquidityInputs
 * @property {number} moveIndex - MOVE Index (bond volatility)
 * @property {number} us10y - US 10-Year Treasury Yield %
 * @property {number} dxy - US Dollar Index
 * @property {number} fedBS - Fed Balance Sheet in $T
 * @property {number} btcPrice - Current BTC price
 * @property {number} btc200dma - BTC 200-day moving average
 * @property {number} btcMvrv - Market Value to Realized Value ratio
 * @property {number} btcFundingRate - Perpetual swap funding rate (decimal)
 * @property {number} btcEtfFlowWeekly - Weekly BTC ETF net flows in $M
 * @property {number} goldPrice - Gold price
 * @property {number} silverPrice - Silver price
 * @property {number} goldSilverRatio - Gold/Silver ratio
 * @property {number} cpiYoy - CPI Year-over-Year %
 * @property {number} coreYoy - Core CPI YoY %
 * @property {number} us2y - 2Y Treasury yield %
 * @property {number} us30y - 30Y Treasury yield %
 * @property {string} fedFundsRate - Fed Funds Rate range (e.g., "3.50-3.75")
 * @property {number} unemployment - Unemployment rate %
 * @property {number} nfp - Last NFP print in thousands
 * @property {number} initialClaims - Weekly initial jobless claims in thousands
 * @property {number} tga - Treasury General Account balance in $B
 * @property {number} rrp - Overnight Reverse Repo in $B
 * @property {number} spx - S&P 500 level
 * @property {number} vix - VIX
 * @property {number} hyOAS - High Yield OAS in bps
 */

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Clamps a value between min and max
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @param {number} value - Value to clamp
 * @returns {number}
 */
function clamp(min, max, value) {
  return Math.max(min, Math.min(max, value));
}

// ============================================================================
// COMPONENT SCORES (0-100)
// ============================================================================

/**
 * Bond Volatility Score (MOVE Index) - INVERSE relationship
 *
 * Formula: score = clamp(0, 100, 100 - ((MOVE - 70) / 90) * 100)
 *
 * Interpretation:
 * - MOVE 70 = score 100 (great liquidity, low bond vol)
 * - MOVE 115 = score 50 (neutral)
 * - MOVE 160 = score 0 (terrible, high bond vol)
 *
 * @param {number} moveIndex - MOVE Index value
 * @returns {number} Score 0-100
 */
export function calculateMoveScore(moveIndex) {
  if (moveIndex === null || moveIndex === undefined) return null;
  return clamp(0, 100, 100 - ((moveIndex - 70) / 90) * 100);
}

/**
 * Treasury Rates Score (US 10Y Yield) - INVERSE relationship
 *
 * Formula: score = clamp(0, 100, 100 - ((US10Y - 2.0) / 4.0) * 100)
 *
 * Interpretation:
 * - 2% = score 100 (great, low rates supportive)
 * - 4% = score 50 (neutral)
 * - 6% = score 0 (terrible, high rates restrictive)
 *
 * @param {number} us10y - US 10Y yield in %
 * @returns {number} Score 0-100
 */
export function calculateRateScore(us10y) {
  if (us10y === null || us10y === undefined) return null;
  return clamp(0, 100, 100 - ((us10y - 2.0) / 4.0) * 100);
}

/**
 * Dollar Strength Score (DXY) - INVERSE relationship
 *
 * Formula: score = clamp(0, 100, 100 - ((DXY - 88) / 17) * 100)
 *
 * Interpretation:
 * - DXY 88 = score 100 (great, weak dollar)
 * - DXY 97 = score ~47 (bad)
 * - DXY 105 = score 0 (terrible, strong dollar)
 *
 * @param {number} dxy - Dollar Index value
 * @returns {number} Score 0-100
 */
export function calculateDxyScore(dxy) {
  if (dxy === null || dxy === undefined) return null;
  return clamp(0, 100, 100 - ((dxy - 88) / 17) * 100);
}

/**
 * Banking Assets Score (Fed Balance Sheet) - DIRECT relationship
 *
 * Formula: score = clamp(0, 100, ((FedBS - 5.5) / 1.5) * 100)
 *
 * Interpretation:
 * - $5.5T = score 0 (minimal)
 * - $6.25T = score 50 (neutral)
 * - $7.0T = score 100 (max liquidity injection)
 *
 * @param {number} fedBS - Fed Balance Sheet in $T
 * @returns {number} Score 0-100
 */
export function calculateBankScore(fedBS) {
  if (fedBS === null || fedBS === undefined) return null;
  return clamp(0, 100, ((fedBS - 5.5) / 1.5) * 100);
}

// ============================================================================
// COMPOSITE LIQUIDITY INDEX
// ============================================================================

/**
 * Calculate composite liquidity index (0-100)
 *
 * Average of 4 component scores:
 * - MOVE Score (bond volatility, inverse)
 * - Rate Score (10Y yield, inverse)
 * - DXY Score (dollar strength, inverse)
 * - Bank Score (Fed balance sheet, direct)
 *
 * Key threshold: > 50 = "CONDUCIVE" for risk assets
 *
 * @param {LiquidityInputs} inputs
 * @returns {{
 *   composite: number,
 *   moveScore: number,
 *   rateScore: number,
 *   dxyScore: number,
 *   bankScore: number,
 *   isConducive: boolean
 * }}
 */
export function calculateCompositeIndex(inputs) {
  const moveScore = calculateMoveScore(inputs.moveIndex);
  const rateScore = calculateRateScore(inputs.us10y);
  const dxyScore = calculateDxyScore(inputs.dxy);
  const bankScore = calculateBankScore(inputs.fedBS);

  // Calculate average, handling nulls
  const scores = [moveScore, rateScore, dxyScore, bankScore].filter(s => s !== null);
  const composite = scores.length > 0
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : null;

  return {
    composite,
    moveScore: moveScore !== null ? Math.round(moveScore) : null,
    rateScore: rateScore !== null ? Math.round(rateScore) : null,
    dxyScore: dxyScore !== null ? Math.round(dxyScore) : null,
    bankScore: bankScore !== null ? Math.round(bankScore) : null,
    isConducive: composite !== null && composite > 50
  };
}

// ============================================================================
// SIGNAL GENERATION
// ============================================================================

/**
 * Generate overall market signal based on composite score
 *
 * Thresholds:
 * - composite > 55  → "BUY"
 * - composite < 35  → "SELL"
 * - composite < 45  → "CAUTIOUS"
 * - else            → "NEUTRAL"
 *
 * @param {number} composite - Composite liquidity score
 * @returns {"BUY"|"SELL"|"CAUTIOUS"|"NEUTRAL"|null}
 */
export function getOverallSignal(composite) {
  if (composite === null || composite === undefined) return null;
  if (composite > 55) return 'BUY';
  if (composite < 35) return 'SELL';
  if (composite < 45) return 'CAUTIOUS';
  return 'NEUTRAL';
}

/**
 * Calculate BTC signal score and generate signal
 *
 * Formula:
 * btcScore = composite * 0.4                                          // liquidity weight
 *          + (etfFlowsWeekly > 200 ? 20 : etfFlows > 0 ? 10 : etfFlows > -500 ? -10 : -20)  // ETF flows
 *          + (fundingRate > 0 ? 5 : -8)                              // perp funding
 *          + (btcPrice > btc200dma ? 15 : -15)                       // trend structure
 *          + (mvrv > 2.5 ? -15 : mvrv > 1 ? -5 : -15)              // valuation
 *
 * Signal thresholds:
 * - btcScore > 30   → "BUY"
 * - btcScore > 0    → "NEUTRAL"
 * - btcScore > -20  → "CAUTIOUS"
 * - else            → "SELL"
 *
 * @param {LiquidityInputs} inputs
 * @param {number} composite - Pre-calculated composite score
 * @returns {{score: number, signal: string, factors: Object}}
 */
export function calculateBtcSignal(inputs, composite) {
  if (composite === null) return { score: null, signal: null, factors: {} };

  // Liquidity weight (40%)
  const liquidityComponent = composite * 0.4;

  // ETF flows component
  let etfComponent;
  if (inputs.btcEtfFlowWeekly > 200) etfComponent = 20;
  else if (inputs.btcEtfFlowWeekly > 0) etfComponent = 10;
  else if (inputs.btcEtfFlowWeekly > -500) etfComponent = -10;
  else etfComponent = -20;

  // Funding rate component
  const fundingComponent = inputs.btcFundingRate > 0 ? 5 : -8;

  // Trend structure component
  const trendComponent = inputs.btcPrice > inputs.btc200dma ? 15 : -15;

  // MVRV valuation component
  let mvrvComponent;
  if (inputs.btcMvrv > 2.5) mvrvComponent = -15;
  else if (inputs.btcMvrv > 1) mvrvComponent = -5;
  else mvrvComponent = -15; // Undervalued is also concerning (bear market)

  const score = Math.round(
    liquidityComponent + etfComponent + fundingComponent + trendComponent + mvrvComponent
  );

  // Generate signal
  let signal;
  if (score > 30) signal = 'BUY';
  else if (score > 0) signal = 'NEUTRAL';
  else if (score > -20) signal = 'CAUTIOUS';
  else signal = 'SELL';

  return {
    score,
    signal,
    factors: {
      liquidity: Math.round(liquidityComponent),
      etfFlows: etfComponent,
      funding: fundingComponent,
      trend: trendComponent,
      mvrv: mvrvComponent
    }
  };
}

/**
 * Calculate Gold signal score and generate signal
 *
 * Formula:
 * realYield = us10y - cpiYoY
 * goldScore = composite * 0.25                                        // lower liquidity weight
 *           + (realYield > 2 ? -15 : realYield > 1 ? -5 : 10)       // real yield
 *           + (dxy > 100 ? -20 : dxy > 97 ? -10 : 10)               // dollar headwind
 *           + 10                                                      // structural CB buying premium
 *
 * Signal thresholds:
 * - goldScore > 20  → "BUY"
 * - goldScore > 0   → "NEUTRAL"
 * - else            → "SELL"
 *
 * @param {LiquidityInputs} inputs
 * @param {number} composite - Pre-calculated composite score
 * @returns {{score: number, signal: string, factors: Object, realYield: number}}
 */
export function calculateGoldSignal(inputs, composite) {
  if (composite === null) return { score: null, signal: null, factors: {}, realYield: null };

  // Calculate real yield
  const realYield = inputs.us10y - inputs.cpiYoy;

  // Liquidity weight (25% - lower than BTC)
  const liquidityComponent = composite * 0.25;

  // Real yield component (inverse relationship)
  let realYieldComponent;
  if (realYield > 2) realYieldComponent = -15;
  else if (realYield > 1) realYieldComponent = -5;
  else realYieldComponent = 10;

  // Dollar headwind component
  let dollarComponent;
  if (inputs.dxy > 100) dollarComponent = -20;
  else if (inputs.dxy > 97) dollarComponent = -10;
  else dollarComponent = 10;

  // Structural CB buying premium (always positive for gold)
  const cbBuyingPremium = 10;

  const score = Math.round(
    liquidityComponent + realYieldComponent + dollarComponent + cbBuyingPremium
  );

  // Generate signal
  let signal;
  if (score > 20) signal = 'BUY';
  else if (score > 0) signal = 'NEUTRAL';
  else signal = 'SELL';

  return {
    score,
    signal,
    realYield: Math.round(realYield * 100) / 100,
    factors: {
      liquidity: Math.round(liquidityComponent),
      realYield: realYieldComponent,
      dollar: dollarComponent,
      cbBuying: cbBuyingPremium
    }
  };
}

/**
 * Calculate Silver signal score and generate signal
 *
 * Formula:
 * silverScore = goldScore * 0.6    // correlated to gold
 *             - 10                 // volatility penalty
 *             + (goldSilverRatio > 80 ? 10 : goldSilverRatio > 70 ? 5 : goldSilverRatio < 60 ? -5 : 0)
 *
 * Signal thresholds:
 * - silverScore > 15  → "BUY"
 * - silverScore > -5  → "NEUTRAL"
 * - else              → "SELL"
 *
 * @param {LiquidityInputs} inputs
 * @param {number} goldScore - Pre-calculated gold score
 * @returns {{score: number, signal: string, factors: Object}}
 */
export function calculateSilverSignal(inputs, goldScore) {
  if (goldScore === null) return { score: null, signal: null, factors: {} };

  // Gold correlation component
  const goldCorrelation = goldScore * 0.6;

  // Volatility penalty (silver more volatile than gold)
  const volatilityPenalty = -10;

  // Gold/Silver ratio component
  let ratioComponent;
  if (inputs.goldSilverRatio > 80) ratioComponent = 10; // Silver cheap relative to gold
  else if (inputs.goldSilverRatio > 70) ratioComponent = 5;
  else if (inputs.goldSilverRatio < 60) ratioComponent = -5; // Silver expensive
  else ratioComponent = 0;

  const score = Math.round(goldCorrelation + volatilityPenalty + ratioComponent);

  // Generate signal
  let signal;
  if (score > 15) signal = 'BUY';
  else if (score > -5) signal = 'NEUTRAL';
  else signal = 'SELL';

  return {
    score,
    signal,
    factors: {
      goldCorrelation: Math.round(goldCorrelation),
      volatility: volatilityPenalty,
      ratio: ratioComponent
    }
  };
}

// ============================================================================
// MAIN CALCULATION FUNCTION
// ============================================================================

/**
 * Calculate all liquidity signals from inputs
 *
 * @param {LiquidityInputs} inputs
 * @returns {Object} Complete liquidity analysis
 */
export function calculateLiquiditySignals(inputs) {
  // Calculate composite index
  const compositeResult = calculateCompositeIndex(inputs);

  // Get overall signal
  const overallSignal = getOverallSignal(compositeResult.composite);

  // Calculate asset signals
  const btcResult = calculateBtcSignal(inputs, compositeResult.composite);
  const goldResult = calculateGoldSignal(inputs, compositeResult.composite);
  const silverResult = calculateSilverSignal(inputs, goldResult.score);

  // Calculate yield curve data
  const yieldCurve = {
    us2y: inputs.us2y,
    us10y: inputs.us10y,
    us30y: inputs.us30y,
    spread2s10s: inputs.us10y - inputs.us2y,
    isInverted: inputs.us2y > inputs.us10y
  };

  // Regime analysis
  const regimes = analyzeRegimes(inputs, compositeResult);

  return {
    timestamp: new Date().toISOString(),
    composite: compositeResult,
    overallSignal,
    btc: {
      price: inputs.btcPrice,
      ...btcResult
    },
    gold: {
      price: inputs.goldPrice,
      ...goldResult
    },
    silver: {
      price: inputs.silverPrice,
      ...silverResult
    },
    yieldCurve,
    regimes,
    inputs // Include inputs for reference
  };
}

/**
 * Analyze macro regimes
 * @param {LiquidityInputs} inputs
 * @param {Object} composite
 * @returns {Object}
 */
function analyzeRegimes(inputs, composite) {
  return {
    fed: {
      status: inputs.fedBS > 6.5 ? 'EASING' : inputs.fedBS > 6.0 ? 'NEUTRAL' : 'TIGHTENING',
      detail: `BS: $${inputs.fedBS?.toFixed(2)}T`
    },
    inflation: {
      status: inputs.cpiYoy > 4 ? 'HIGH' : inputs.cpiYoy > 2.5 ? 'ELEVATED' : 'STABLE',
      detail: `CPI: ${inputs.cpiYoy?.toFixed(1)}%`
    },
    labor: {
      status: inputs.unemployment > 5 ? 'WEAK' : inputs.unemployment > 4 ? 'SOFTENING' : 'TIGHT',
      detail: `UE: ${inputs.unemployment?.toFixed(1)}%`
    },
    dollar: {
      status: inputs.dxy > 105 ? 'STRONG' : inputs.dxy > 100 ? 'FIRM' : inputs.dxy > 95 ? 'NEUTRAL' : 'WEAK',
      detail: `DXY: ${inputs.dxy?.toFixed(1)}`
    },
    bondVol: {
      status: inputs.moveIndex > 130 ? 'HIGH' : inputs.moveIndex > 100 ? 'ELEVATED' : 'LOW',
      detail: `MOVE: ${inputs.moveIndex?.toFixed(0)}`
    },
    credit: {
      status: inputs.hyOAS > 500 ? 'STRESSED' : inputs.hyOAS > 400 ? 'TIGHT' : inputs.hyOAS > 300 ? 'NORMAL' : 'EASY',
      detail: `HY OAS: ${inputs.hyOAS?.toFixed(0)}bps`
    }
  };
}

// ============================================================================
// DEFAULT/EXAMPLE INPUTS
// ============================================================================

/**
 * Example inputs for testing (Feb 9, 2026 data from spec)
 * Expected output: Composite 43, BTC SELL, Gold NEUTRAL, Silver SELL
 */
export const EXAMPLE_INPUTS = {
  // Core 4 components
  moveIndex: 118,
  us10y: 4.19,
  dxy: 97.6,
  fedBS: 6.05,

  // BTC-specific
  btcPrice: 70259,
  btc200dma: 78000,
  btcMvrv: 1.35,
  btcFundingRate: -0.01,
  btcEtfFlowWeekly: -358,

  // Gold/Silver
  goldPrice: 4987,
  silverPrice: 77,
  goldSilverRatio: 64.7,

  // Macro
  cpiYoy: 2.8,
  coreYoy: 3.2,
  us2y: 4.0,
  us30y: 4.5,
  fedFundsRate: '3.50-3.75',
  unemployment: 4.1,
  nfp: 150,
  initialClaims: 220,
  tga: 750,
  rrp: 200,
  spx: 5800,
  vix: 18,
  hyOAS: 350
};

/**
 * Empty inputs template
 */
export const EMPTY_INPUTS = {
  moveIndex: null,
  us10y: null,
  dxy: null,
  fedBS: null,
  btcPrice: null,
  btc200dma: null,
  btcMvrv: null,
  btcFundingRate: null,
  btcEtfFlowWeekly: null,
  goldPrice: null,
  silverPrice: null,
  goldSilverRatio: null,
  cpiYoy: null,
  coreYoy: null,
  us2y: null,
  us30y: null,
  fedFundsRate: null,
  unemployment: null,
  nfp: null,
  initialClaims: null,
  tga: null,
  rrp: null,
  spx: null,
  vix: null,
  hyOAS: null
};
