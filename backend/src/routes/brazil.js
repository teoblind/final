import express from 'express';
import axios from 'axios';
import yahooFinance from '../services/yahooService.js';
import { getCache, setCache, getManualData, addManualData, getDatacenterProjects, addDatacenterProject } from '../cache/database.js';

const router = express.Router();

// Get Brazil green compute data
router.get('/', async (req, res) => {
  const cacheKey = 'brazil-compute';

  try {
    const cached = getCache(cacheKey);
    if (cached && !cached.stale) {
      return res.json({
        ...cached.data,
        cached: true,
        fetchedAt: cached.fetchedAt
      });
    }

    // Fetch equity data in parallel
    const [equityData, macroData, energyData, mineralData] = await Promise.all([
      fetchBrazilEquities(),
      fetchBrazilMacro(),
      fetchEnergyData(),
      fetchMineralData()
    ]);

    // Get data center projects in Brazil
    const dcProjects = getDatacenterProjects('BR');

    const result = {
      equities: equityData,
      macro: macroData,
      energy: energyData,
      minerals: mineralData,
      datacenters: {
        projects: dcProjects.map(p => ({
          id: p.id,
          company: p.company,
          location: p.location,
          capacityMW: p.capacity_mw,
          status: p.status,
          expectedOnline: p.expected_online,
          notes: p.notes
        })),
        totalMW: dcProjects.reduce((sum, p) => sum + (p.capacity_mw || 0), 0),
        majorPlayers: ['Scala Data Centers', 'Equinix São Paulo', 'AWS São Paulo', 'Oracle Brazil', 'Ascenty', 'ODATA']
      },
      thesis: {
        summary: 'Brazil is structurally positioned for AI-era capital allocation due to energy abundance, critical minerals, and improving macro fundamentals.',
        advantages: [
          'Surplus renewable capacity (~80% hydro/renewable grid)',
          'Niobium dominance (90% of global supply)',
          'Rare earth development projects',
          'Falling real interest rates',
          'Geographic diversification from US/EU grid bottlenecks'
        ],
        risks: [
          'Currency volatility',
          'Political risk',
          'Infrastructure execution',
          'Distance from major AI compute centers'
        ]
      },
      sources: ['Yahoo Finance', 'Banco Central do Brasil', 'ONS', 'ANEEL', 'USGS', 'Manual Entry']
    };

    setCache(cacheKey, result, 15);

    res.json({
      ...result,
      cached: false,
      fetchedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching Brazil data:', error);
    const cached = getCache(cacheKey);
    if (cached) {
      return res.json({
        ...cached.data,
        cached: true,
        stale: true,
        fetchedAt: cached.fetchedAt
      });
    }
    res.status(500).json({ error: error.message });
  }
});

// Add manual data
router.post('/manual', (req, res) => {
  const { category, metric, value, date, notes } = req.body;

  if (!category || !metric || value === undefined || !date) {
    return res.status(400).json({ error: 'Category, metric, value, and date are required' });
  }

  const validCategories = ['energy', 'minerals', 'macro'];
  if (!validCategories.includes(category)) {
    return res.status(400).json({ error: `Category must be one of: ${validCategories.join(', ')}` });
  }

  try {
    addManualData(`brazil_${category}`, metric, parseFloat(value), date, notes);
    setCache('brazil-compute', null, 0);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add data center project
router.post('/datacenter', (req, res) => {
  const { company, location, capacity_mw, status, expected_online, notes } = req.body;

  if (!company || !location) {
    return res.status(400).json({ error: 'Company and location are required' });
  }

  try {
    addDatacenterProject({
      company,
      location,
      region: 'BR',
      capacity_mw: capacity_mw ? parseFloat(capacity_mw) : null,
      status: status || 'announced',
      expected_online,
      notes
    });
    setCache('brazil-compute', null, 0);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

async function fetchBrazilEquities() {
  try {
    const symbols = ['EWZ', 'EEM', 'SPY'];
    const period1 = new Date();
    period1.setFullYear(period1.getFullYear() - 1);

    const quotes = await Promise.all(
      symbols.map(sym => yahooFinance.quote(sym).catch(() => null))
    );

    const history = await Promise.all(
      symbols.map(sym =>
        yahooFinance.chart(sym, { period1, interval: '1d' })
          .then(d => ({ symbol: sym, quotes: d.quotes || [] }))
          .catch(() => ({ symbol: sym, quotes: [] }))
      )
    );

    // Normalize to 100
    const normalized = {};
    history.forEach(({ symbol, quotes: q }) => {
      if (q.length > 0) {
        const startPrice = q[0].close;
        normalized[symbol] = q.map(quote => ({
          date: quote.date?.toISOString().split('T')[0],
          value: startPrice ? (quote.close / startPrice) * 100 : null
        })).filter(d => d.value);
      }
    });

    // EWZ vs SPY ratio
    const ewzSpyRatio = [];
    const spyMap = new Map();
    (normalized['SPY'] || []).forEach(d => spyMap.set(d.date, d.value));

    (normalized['EWZ'] || []).forEach(d => {
      const spyVal = spyMap.get(d.date);
      if (spyVal) {
        ewzSpyRatio.push({ date: d.date, ratio: d.value / spyVal });
      }
    });

    // Get BRL/USD
    let brlUsd = null;
    try {
      const fxQuote = await yahooFinance.quote('BRL=X');
      brlUsd = {
        rate: fxQuote.regularMarketPrice,
        change: fxQuote.regularMarketChangePercent
      };
    } catch (e) {
      console.log('BRL/USD fetch failed');
    }

    return {
      current: {
        EWZ: quotes[0],
        EEM: quotes[1],
        SPY: quotes[2]
      },
      normalized,
      ewzSpyRatio,
      ewzVsEem: ewzSpyRatio.length > 0 ? ewzSpyRatio[ewzSpyRatio.length - 1] : null,
      brlUsd
    };

  } catch (e) {
    console.log('Brazil equities fetch failed:', e.message);
    return {
      current: {},
      normalized: {},
      ewzSpyRatio: [],
      brlUsd: null
    };
  }
}

async function fetchBrazilMacro() {
  // Get manual data for SELIC and IPCA
  const selicData = getManualData('brazil_macro', 'selic');
  const ipcaData = getManualData('brazil_macro', 'ipca');

  const latestSelic = selicData[0]?.value || null;
  const latestIpca = ipcaData[0]?.value || null;
  const realRate = latestSelic && latestIpca ? latestSelic - latestIpca : null;

  return {
    selic: {
      current: latestSelic,
      history: selicData,
      description: 'Brazil policy rate (Banco Central do Brasil)'
    },
    ipca: {
      current: latestIpca,
      history: ipcaData,
      description: 'Brazil CPI inflation'
    },
    realRate: {
      current: realRate,
      description: 'SELIC - IPCA (positive = attractive carry)'
    },
    sources: ['Banco Central do Brasil', 'FRED', 'Manual Entry'],
    note: 'Add SELIC and IPCA data manually for accurate real rate calculation'
  };
}

async function fetchEnergyData() {
  // Get manual data
  const capacityData = getManualData('brazil_energy', 'installed_capacity');
  const demandData = getManualData('brazil_energy', 'peak_demand');
  const reservoirData = getManualData('brazil_energy', 'reservoir_level');

  const latestCapacity = capacityData[0]?.value || null;
  const latestDemand = demandData[0]?.value || null;
  const headroom = latestCapacity && latestDemand ? latestCapacity - latestDemand : null;

  return {
    installedCapacity: {
      value: latestCapacity,
      unit: 'GW',
      history: capacityData
    },
    peakDemand: {
      value: latestDemand,
      unit: 'GW',
      history: demandData
    },
    headroom: {
      value: headroom,
      unit: 'GW',
      description: 'Available capacity above peak demand'
    },
    reservoirLevel: {
      value: reservoirData[0]?.value || null,
      unit: '%',
      history: reservoirData
    },
    generationMix: {
      hydro: 65,
      wind: 12,
      solar: 5,
      biomass: 8,
      nuclear: 2,
      thermal: 8
    },
    sources: ['ONS (Operador Nacional do Sistema Elétrico)', 'ANEEL', 'Manual Entry']
  };
}

async function fetchMineralData() {
  // Get manual data
  const niobiumData = getManualData('brazil_minerals', 'niobium_production');
  const rareEarthData = getManualData('brazil_minerals', 'rare_earth_reserves');
  const lithiumData = getManualData('brazil_minerals', 'lithium_reserves');

  return {
    niobium: {
      globalShare: 90,
      production: niobiumData[0]?.value || null,
      unit: 'tonnes',
      uses: 'High-strength steel, superalloys, superconducting magnets',
      mainProducer: 'CBMM (Companhia Brasileira de Metalurgia e Mineração)',
      history: niobiumData
    },
    rareEarths: {
      reserves: rareEarthData[0]?.value || null,
      projects: ['Serra Verde (GoiAS)', 'Morro do Ferro'],
      status: 'Development stage',
      history: rareEarthData
    },
    lithium: {
      reserves: lithiumData[0]?.value || null,
      location: 'Minas Gerais (Jequitinhonha Valley)',
      status: 'Early exploration',
      history: lithiumData
    },
    sources: ['USGS', 'DNPM (Brazil Mining Agency)', 'CBMM', 'Manual Entry']
  };
}

export default router;
