/**
 * ERCOT Data Service
 *
 * Fetches energy market data from ERCOT's public API.
 * Falls back to realistic mock data when API credentials are not configured.
 *
 * ERCOT API requires:
 * - ERCOT_API_SUBSCRIPTION_KEY (Ocp-Apim-Subscription-Key header)
 * - ERCOT_API_USERNAME / ERCOT_API_PASSWORD for OAuth token
 *
 * When credentials are missing, generates realistic mock data based on
 * typical ERCOT price patterns (seasonal, hourly, weather-driven).
 */

import axios from 'axios';
import { insertEnergyPrices } from '../cache/database.js';

const ERCOT_API_BASE = 'https://api.ercot.com/api/public-reports';
const ERCOT_TOKEN_URL = 'https://ercotb2c.b2clogin.com/ercotb2c.onmicrosoft.com/B2C_1_PUBAPI-ROPC-FLOW/oauth2/v2.0/token';

let cachedToken = null;
let tokenExpiry = 0;

// =============================================================================
// ERCOT API Authentication
// =============================================================================
async function getErcotToken() {
  const username = process.env.ERCOT_API_USERNAME;
  const password = process.env.ERCOT_API_PASSWORD;
  const subKey = process.env.ERCOT_API_SUBSCRIPTION_KEY;

  if (!username || !password || !subKey) return null;
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  try {
    const params = new URLSearchParams({
      grant_type: 'password',
      username,
      password,
      scope: `openid ${subKey} offline_access`,
      client_id: subKey,
      response_type: 'id_token'
    });

    const resp = await axios.post(ERCOT_TOKEN_URL, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10000
    });

    cachedToken = resp.data.id_token;
    tokenExpiry = Date.now() + (resp.data.expires_in - 60) * 1000;
    return cachedToken;
  } catch (e) {
    console.error('ERCOT token auth failed:', e.message);
    return null;
  }
}

function hasErcotCredentials() {
  return !!(process.env.ERCOT_API_USERNAME && process.env.ERCOT_API_PASSWORD && process.env.ERCOT_API_SUBSCRIPTION_KEY);
}

async function ercotApiGet(endpoint, params = {}) {
  const token = await getErcotToken();
  if (!token) throw new Error('No ERCOT credentials');

  return axios.get(`${ERCOT_API_BASE}${endpoint}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Ocp-Apim-Subscription-Key': process.env.ERCOT_API_SUBSCRIPTION_KEY
    },
    params,
    timeout: 15000
  });
}

// =============================================================================
// EIA API (for fuel mix - free, just needs API key)
// =============================================================================
async function fetchEiaFuelMix() {
  const key = process.env.EIA_API_KEY;
  if (!key) return null;

  try {
    const resp = await axios.get('https://api.eia.gov/v2/electricity/rto/fuel-type-data/data/', {
      params: {
        api_key: key,
        'facets[respondent][]': 'ERCO',
        'data[0]': 'value',
        frequency: 'hourly',
        sort: [{ column: 'period', direction: 'desc' }],
        length: 100
      },
      timeout: 15000
    });

    if (resp.data?.response?.data) {
      const rawData = resp.data.response.data;
      const fuelTypes = {};
      rawData.forEach(d => {
        const fuel = d.fueltype || d['type-name'] || 'Unknown';
        if (!fuelTypes[fuel]) fuelTypes[fuel] = 0;
        fuelTypes[fuel] += d.value || 0;
      });
      return { fuelTypes, source: 'EIA', isMock: false };
    }
    return null;
  } catch (e) {
    console.error('EIA API error:', e.message);
    return null;
  }
}

// =============================================================================
// Realistic Mock Data Generator
// =============================================================================

/**
 * Generate a realistic ERCOT LMP based on time patterns.
 * ERCOT price dynamics:
 * - Base load: $20-35/MWh
 * - Night trough (0-5 AM): -$5 to $15/MWh
 * - Morning ramp (6-9 AM): $25-50/MWh
 * - Midday solar depression (10 AM-2 PM): $15-30/MWh
 * - Evening peak (3-8 PM): $40-100+/MWh in summer
 * - Wind surplus (night): Can push prices negative
 * - Summer peak: 2-3x winter prices
 * - Occasional spikes >$100 during grid stress
 */
function generateRealisticLMP(date, node = 'HB_NORTH') {
  const d = new Date(date);
  const hour = d.getUTCHours() - 6; // CPT offset (approximate)
  const h = ((hour % 24) + 24) % 24;
  const month = d.getMonth(); // 0-11
  const dayOfWeek = d.getDay(); // 0=Sun

  // Seasonal multiplier (summer peak June-Aug)
  const seasonalMult = [0.7, 0.65, 0.75, 0.85, 1.0, 1.3, 1.5, 1.5, 1.2, 0.9, 0.75, 0.7][month];

  // Weekend discount
  const weekendMult = (dayOfWeek === 0 || dayOfWeek === 6) ? 0.8 : 1.0;

  // Hourly price curve (typical ERCOT pattern)
  const hourlyBase = [
    8, 5, 3, 2, 3, 8,        // 0-5 AM: low demand, wind surplus
    18, 28, 35, 32,           // 6-9 AM: morning ramp
    28, 25, 22, 20,           // 10 AM-1 PM: solar depression
    25, 35, 50, 55,           // 2-5 PM: afternoon peak
    48, 40, 32, 25,           // 6-9 PM: evening decline
    18, 12                     // 10-11 PM: night
  ][h];

  // Node-specific adjustment
  const nodeAdj = { HB_NORTH: 0, HB_SOUTH: 2, HB_WEST: -3, HB_HOUSTON: 4, HB_PAN: -5 }[node] || 0;

  // Random noise (normal-ish distribution)
  const noise = (Math.random() - 0.5) * 12 + (Math.random() - 0.5) * 8;

  // Occasional spike (2% chance during peak hours in summer)
  let spike = 0;
  if (h >= 14 && h <= 19 && month >= 5 && month <= 8 && Math.random() < 0.02) {
    spike = 50 + Math.random() * 200;
  }

  // Occasional negative pricing (wind surplus at night, 5% chance)
  let windNeg = 0;
  if (h >= 0 && h <= 5 && Math.random() < 0.05) {
    windNeg = -(5 + Math.random() * 15);
  }

  const lmp = Math.round((hourlyBase * seasonalMult * weekendMult + nodeAdj + noise + spike + windNeg) * 100) / 100;

  return {
    lmp,
    energyComponent: Math.round((lmp * 0.85) * 100) / 100,
    congestionComponent: Math.round((lmp * 0.1 + (Math.random() - 0.5) * 3) * 100) / 100,
    lossComponent: Math.round((lmp * 0.05 + (Math.random() - 0.5) * 1) * 100) / 100
  };
}

function generateMockFuelMix() {
  const hour = new Date().getUTCHours() - 6;
  const h = ((hour % 24) + 24) % 24;

  // Approximate ERCOT generation mix (varies by hour)
  const solarFactor = h >= 7 && h <= 18 ? Math.sin((h - 7) / 11 * Math.PI) : 0;
  const windFactor = 0.5 + Math.sin(h / 24 * Math.PI * 2 + 1) * 0.3;

  const total = 55000 + Math.random() * 15000;
  const solar = Math.round(total * 0.12 * solarFactor);
  const wind = Math.round(total * 0.28 * windFactor);
  const nuclear = Math.round(total * 0.08);
  const coal = Math.round(total * 0.12);
  const gas = total - solar - wind - nuclear - coal;

  return {
    timestamp: new Date().toISOString(),
    total: Math.round(total),
    breakdown: [
      { fuel: 'Natural Gas', mw: Math.round(gas), pct: Math.round(gas / total * 100) },
      { fuel: 'Wind', mw: wind, pct: Math.round(wind / total * 100) },
      { fuel: 'Solar', mw: solar, pct: Math.round(solar / total * 100) },
      { fuel: 'Nuclear', mw: nuclear, pct: Math.round(nuclear / total * 100) },
      { fuel: 'Coal', mw: coal, pct: Math.round(coal / total * 100) },
    ],
    source: 'Mock (configure EIA_API_KEY for live data)',
    isMock: true
  };
}

// =============================================================================
// Public API functions
// =============================================================================

export async function fetchErcotData(node = 'HB_NORTH') {
  // Try real ERCOT API first
  if (hasErcotCredentials()) {
    try {
      const resp = await ercotApiGet('/np6-905-cd/spp_node_zone_hub', {
        settlementPoint: node,
        size: 1,
        sort: 'deliveryDateFrom desc'
      });
      const row = resp.data?.data?.[0];
      if (row) {
        return {
          timestamp: new Date().toISOString(),
          realTimePrice: {
            lmp: parseFloat(row.settlementPointPrice || row.spp),
            energyComponent: parseFloat(row.energyComponent || 0),
            congestionComponent: parseFloat(row.congestionComponent || 0),
            lossComponent: parseFloat(row.lossComponent || 0)
          },
          gridCondition: { status: 'normal', alerts: [] },
          source: 'ERCOT API (NP6-905-CD)',
          isMock: false
        };
      }
    } catch (e) {
      console.warn('ERCOT API fetch failed, using mock:', e.message);
    }
  }

  // Fallback: realistic mock data
  const now = new Date();
  const price = generateRealisticLMP(now, node);

  return {
    timestamp: now.toISOString(),
    realTimePrice: price,
    gridCondition: { status: 'normal', alerts: [], ordcAdder: 0 },
    source: 'Mock data (configure ERCOT_API credentials for live data)',
    isMock: true
  };
}

export async function fetchErcotDayAhead(node = 'HB_NORTH', date) {
  const targetDate = date || new Date(Date.now() + 86400000).toISOString().split('T')[0];

  if (hasErcotCredentials()) {
    try {
      const resp = await ercotApiGet('/np4-190-cd/dam_stlmnt_pnt_prices', {
        settlementPoint: node,
        deliveryDate: targetDate,
        size: 24
      });
      if (resp.data?.data?.length > 0) {
        const prices = resp.data.data.map(row => ({
          hour: parseInt(row.deliveryHour || row.hour),
          lmp: parseFloat(row.settlementPointPrice || row.damPrice),
          energyComponent: parseFloat(row.energyComponent || 0),
          congestionComponent: parseFloat(row.congestionComponent || 0),
          lossComponent: parseFloat(row.lossComponent || 0)
        }));
        return {
          date: targetDate,
          dayAheadPrices: prices,
          dailyAvg: prices.reduce((s, p) => s + p.lmp, 0) / prices.length,
          source: 'ERCOT API (NP4-190-CD)',
          isMock: false
        };
      }
    } catch (e) {
      console.warn('ERCOT DAM fetch failed, using mock:', e.message);
    }
  }

  // Mock day-ahead prices
  const prices = Array.from({ length: 24 }, (_, h) => {
    const mockDate = new Date(`${targetDate}T${String(h).padStart(2, '0')}:00:00Z`);
    const price = generateRealisticLMP(mockDate, node);
    return { hour: h, lmp: price.lmp, energyComponent: price.energyComponent, congestionComponent: price.congestionComponent, lossComponent: price.lossComponent };
  });

  return {
    date: targetDate,
    dayAheadPrices: prices,
    dailyAvg: Math.round(prices.reduce((s, p) => s + p.lmp, 0) / 24 * 100) / 100,
    source: 'Mock data (configure ERCOT_API credentials for live data)',
    isMock: true
  };
}

export async function fetchErcotSystemLoad() {
  if (hasErcotCredentials()) {
    try {
      const resp = await ercotApiGet('/np6-345-cd/act_sys_load_by_wzn', { size: 1, sort: 'operDay desc' });
      const row = resp.data?.data?.[0];
      if (row) {
        return {
          systemLoad: {
            current: parseFloat(row.systemLoad || row.totalLoad),
            forecast: []
          },
          source: 'ERCOT API',
          isMock: false
        };
      }
    } catch (e) {
      console.warn('ERCOT load fetch failed, using mock:', e.message);
    }
  }

  // Mock system load
  const hour = new Date().getUTCHours() - 6;
  const h = ((hour % 24) + 24) % 24;
  const month = new Date().getMonth();

  const baseDemand = [38, 36, 35, 34, 35, 38, 42, 48, 52, 54, 55, 56, 55, 54, 56, 60, 62, 60, 55, 50, 46, 43, 40, 38];
  const seasonalMult = [0.7, 0.7, 0.75, 0.85, 1.0, 1.2, 1.4, 1.4, 1.2, 0.9, 0.75, 0.7][month];
  const current = Math.round((baseDemand[h] * 1000 * seasonalMult + (Math.random() - 0.5) * 3000));

  const forecast = Array.from({ length: 24 }, (_, i) => {
    const fh = (h + i + 1) % 24;
    return {
      hour: fh,
      load: Math.round(baseDemand[fh] * 1000 * seasonalMult + (Math.random() - 0.5) * 2000)
    };
  });

  return {
    systemLoad: { current, forecast },
    source: 'Mock data',
    isMock: true
  };
}

export async function fetchErcotFuelMix() {
  // Try EIA first (free API key)
  const eiaData = await fetchEiaFuelMix();
  if (eiaData) return eiaData;

  // Fallback to mock
  return generateMockFuelMix();
}

/**
 * Generate and persist historical mock data for backtesting.
 * Creates 5-minute interval price records.
 */
export function generateHistoricalMockData(node = 'HB_NORTH', days = 365) {
  const now = new Date();
  const records = [];
  const intervalsPerDay = 288; // 24 * 60 / 5 = 288 five-minute intervals

  for (let d = days; d >= 0; d--) {
    for (let i = 0; i < intervalsPerDay; i += 12) { // Every hour (every 12th 5-min interval) for storage efficiency
      const ts = new Date(now - d * 86400000 + i * 5 * 60000);
      const price = generateRealisticLMP(ts, node);
      records.push({
        iso: 'ERCOT', node,
        timestamp: ts.toISOString(),
        market_type: 'realtime',
        lmp: price.lmp,
        energy_component: price.energyComponent,
        congestion_component: price.congestionComponent,
        loss_component: price.lossComponent
      });
    }
  }

  insertEnergyPrices(records);
  return records.length;
}
