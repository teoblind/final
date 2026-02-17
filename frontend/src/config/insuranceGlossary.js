/**
 * Insurance Glossary — definitions for Sangha financial instrument terms.
 * Used by the <GlossaryTerm> component to provide inline tooltips.
 */

const INSURANCE_GLOSSARY = {
  quarq_spread: {
    term: 'Quarq Spread',
    shortDef: 'Mining profit margin: hashprice revenue minus electricity cost, adjusted for fleet efficiency.',
    energyEquivalent: 'Spark Spread',
    learnMorePanelId: 'insurance-instruments',
  },
  synthetic_ppa: {
    term: 'Synthetic PPA (CfD)',
    shortDef: 'Cash-settled hashprice guarantee — lock a strike price, settle the difference.',
    energyEquivalent: 'Contract for Difference / Virtual PPA',
    learnMorePanelId: 'insurance-instruments',
  },
  proxy_revenue_swap: {
    term: 'Proxy Revenue Swap',
    shortDef: 'Covers both BTC price risk and difficulty/volume risk in a single instrument.',
    energyEquivalent: 'Proxy Revenue Swap (wind/solar)',
    learnMorePanelId: 'insurance-instruments',
  },
  heat_rate_hedge: {
    term: 'Heat Rate / Efficiency Hedge',
    shortDef: 'Makes an inefficient fleet economically equivalent to a more efficient one.',
    energyEquivalent: 'Heat Rate Call Option',
    learnMorePanelId: 'insurance-instruments',
  },
  hashprice: {
    term: 'Hashprice',
    shortDef: 'Revenue per unit of hashrate per day ($/TH/s/day or $/PH/day). Embeds BTC price, block reward, fees, and network difficulty.',
    energyEquivalent: 'Power price ($/MWh)',
    learnMorePanelId: null,
  },
  revenue_floor: {
    term: 'Revenue Floor',
    shortDef: 'The minimum hashprice guaranteed by Sangha. If market drops below, Sangha pays the difference.',
    energyEquivalent: 'Strike price / floor price',
    learnMorePanelId: null,
  },
  upside_sharing: {
    term: 'Upside Sharing',
    shortDef: 'The percentage of revenue above the floor that the miner shares with Sangha as premium.',
    energyEquivalent: 'Call spread / cap',
    learnMorePanelId: null,
  },
};

export default INSURANCE_GLOSSARY;
