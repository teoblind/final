import express from 'express';
import { getCache, setCache, getManualData, addManualData } from '../cache/database.js';
import {
  getCountryHashrate,
  getIranData,
  getChinaData,
  getGovernmentHoldings,
  getDashboardSummary,
  refreshFromGitHub
} from '../services/hashrateService.js';

const router = express.Router();

// Countries to track for hashrate share
const COUNTRIES = [
  { code: 'US', name: 'United States', color: '#3b82f6' },
  { code: 'CN', name: 'China (Estimated)', color: '#ef4444', note: 'Official: 0%, Estimated: ~21% via VPN' },
  { code: 'RU', name: 'Russia', color: '#a855f7' },
  { code: 'KZ', name: 'Kazakhstan', color: '#f59e0b' },
  { code: 'IR', name: 'Iran', color: '#10b981' }
];

// Get Iran and global hashrate share data
router.get('/', async (req, res) => {
  const cacheKey = 'hashrate-share';

  try {
    const cached = getCache(cacheKey);
    if (cached && !cached.stale) {
      return res.json({
        ...cached.data,
        cached: true,
        fetchedAt: cached.fetchedAt
      });
    }

    // Get data from hashrate service (real-bitcoin repo data)
    const summary = await getDashboardSummary();
    const iranData = await getIranData();
    const chinaData = await getChinaData();
    const hashrateDistribution = await getCountryHashrate();

    // Build country data with estimates
    const countryData = [
      {
        code: 'US',
        name: 'United States',
        color: '#3b82f6',
        current: summary.countries.usa.hashratePercent,
        confidence: summary.countries.usa.confidence,
        source: 'estimated'
      },
      {
        code: 'CN',
        name: 'China (Estimated)',
        color: '#ef4444',
        note: 'Official: 0%, Estimated: ~21% via VPN',
        current: chinaData.hashrate.estimatedMid,
        low: chinaData.hashrate.estimatedLow,
        high: chinaData.hashrate.estimatedHigh,
        confidence: chinaData.hashrate.confidence,
        evidence: chinaData.hashrate.evidence,
        holdingsBTC: chinaData.holdings.estimatedSecretMid,
        source: 'estimated'
      },
      {
        code: 'RU',
        name: 'Russia',
        color: '#a855f7',
        current: summary.countries.russia.hashratePercent,
        holdingsBTC: summary.countries.russia.holdingsBTC,
        confidence: summary.countries.russia.confidence,
        source: 'estimated'
      },
      {
        code: 'KZ',
        name: 'Kazakhstan',
        color: '#f59e0b',
        current: summary.countries.kazakhstan.hashratePercent,
        confidence: summary.countries.kazakhstan.confidence,
        source: 'estimated'
      },
      {
        code: 'IR',
        name: 'Iran',
        color: '#10b981',
        current: iranData.hashrate.estimatedMid,
        low: iranData.hashrate.estimatedLow,
        high: iranData.hashrate.estimatedHigh,
        confidence: iranData.hashrate.confidence,
        evidence: iranData.hashrate.evidence,
        holdingsBTC: iranData.holdings.estimatedMid,
        holdingsLow: iranData.holdings.estimatedLow,
        holdingsHigh: iranData.holdings.estimatedHigh,
        source: 'estimated'
      }
    ];

    // Get any manual overrides
    countryData.forEach(country => {
      const manualData = getManualData('hashrate_share', country.code);
      if (manualData.length > 0) {
        country.manualOverride = manualData[0].value;
        country.manualDate = manualData[0].date;
        country.history = manualData.map(d => ({
          date: d.date,
          value: d.value,
          notes: d.notes
        }));
      }
    });

    // Iran-specific details
    const iran = countryData.find(c => c.code === 'IR');

    // CBECI data notes
    const cbeci = {
      url: 'https://ccaf.io/cbeci/mining_map',
      lastUpdate: getManualData('cbeci', 'last_update')[0]?.date || summary.lastUpdated,
      methodology: 'Uses IP geolocation of mining pool servers. VPN usage causes significant underreporting of China and overreporting of other countries.',
      reliability: 'Low-Medium. Data is based on pool IP addresses, not actual miner locations.'
    };

    const result = {
      countries: countryData,
      iran: iran,
      iranDetails: {
        hashrate: iranData.hashrate,
        holdings: iranData.holdings,
        notes: iranData.hashrate.notes
      },
      chinaGap: {
        official: chinaData.hashrate.disclosedPercent,
        estimated: chinaData.hashrate.estimatedMid,
        low: chinaData.hashrate.estimatedLow,
        high: chinaData.hashrate.estimatedHigh,
        explanation: 'China officially banned Bitcoin mining in 2021, but significant mining continues via VPNs and offshore arrangements.',
        evidence: chinaData.hashrate.evidence
      },
      totalTracked: countryData.reduce((sum, c) => sum + (c.current || 0), 0),
      globalHashrateEH: summary.globalHashrateEH,
      governmentHoldingsBTC: summary.totalGovernmentBTC,
      cbeci,
      keyInsights: hashrateDistribution.keyInsights,
      supplementarySources: [
        'Cambridge Bitcoin Electricity Consumption Index (CBECI)',
        'https://github.com/teoblind/real-bitcoin',
        'Hashrate Index',
        'Mining pool disclosures'
      ],
      dataDate: summary.lastUpdated,
      disclaimer: 'Hashrate geographic distribution is inherently unreliable. All figures are estimates based on limited data.',
      refreshNote: 'Data updated from research repository. CBECI updates irregularly.'
    };

    setCache(cacheKey, result, 60 * 24); // Cache for a day

    res.json({
      ...result,
      cached: false,
      fetchedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching hashrate share:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get Iran-specific detailed data
router.get('/iran', async (req, res) => {
  try {
    const iranData = await getIranData();
    res.json({
      ...iranData,
      fetchedAt: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get China-specific detailed data
router.get('/china', async (req, res) => {
  try {
    const chinaData = await getChinaData();
    res.json({
      ...chinaData,
      fetchedAt: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all government holdings
router.get('/holdings', async (req, res) => {
  try {
    const holdings = await getGovernmentHoldings();
    res.json({
      ...holdings,
      fetchedAt: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Force refresh data from GitHub
router.post('/refresh', async (req, res) => {
  try {
    const result = await refreshFromGitHub();
    setCache('hashrate-share', null, 0); // Clear cache
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add hashrate share data (manual override)
router.post('/manual', (req, res) => {
  const { country, value, date, notes } = req.body;

  if (!country || value === undefined || !date) {
    return res.status(400).json({ error: 'Country, value, and date are required' });
  }

  const validCountries = COUNTRIES.map(c => c.code);
  if (!validCountries.includes(country)) {
    return res.status(400).json({ error: `Country must be one of: ${validCountries.join(', ')}` });
  }

  if (value < 0 || value > 100) {
    return res.status(400).json({ error: 'Value must be between 0 and 100 (percentage)' });
  }

  try {
    addManualData('hashrate_share', country, parseFloat(value), date, notes);
    setCache('hashrate-share', null, 0);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Mark CBECI update
router.post('/cbeci-update', (req, res) => {
  const { date, notes } = req.body;

  if (!date) {
    return res.status(400).json({ error: 'Date is required' });
  }

  try {
    addManualData('cbeci', 'last_update', 0, date, notes);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get history for a specific country
router.get('/history/:country', (req, res) => {
  const { country } = req.params;

  const countryInfo = COUNTRIES.find(c => c.code === country);
  if (!countryInfo) {
    return res.status(400).json({ error: `Country must be one of: ${COUNTRIES.map(c => c.code).join(', ')}` });
  }

  try {
    const history = getManualData('hashrate_share', country);
    res.json({
      ...countryInfo,
      history: history.map(d => ({
        date: d.date,
        value: d.value,
        notes: d.notes
      })),
      fetchedAt: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
