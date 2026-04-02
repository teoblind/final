#!/usr/bin/env node
/**
 * Enrich HubSpot Contact Classification Reasoning
 *
 * Generates rich 2-3 sentence reasoning for each classified contact using
 * a comprehensive knowledge base of companies, domains, and title patterns.
 * Runs entirely locally - no API calls needed.
 *
 * Usage: node scripts/enrich_reasoning.js [--dry-run] [--limit 100] [--other-only]
 */

import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = join(__dirname, '..', 'data', 'sangha', 'sangha.db');

const args = process.argv.slice(2);
const LIMIT = getArgNum('--limit', 0);
const DRY_RUN = args.includes('--dry-run');
const OTHER_ONLY = args.includes('--other-only');

function getArgNum(flag, fallback) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1]) return parseInt(args[idx + 1], 10);
  return fallback;
}

// ============================================================================
// KNOWN COMPANIES DATABASE
// Maps domain fragments or company name fragments to rich descriptions
// ============================================================================

const KNOWN_COMPANIES = {
  // Bitcoin Mining
  'mara': { desc: 'Marathon Digital Holdings (MARA) is one of the largest publicly traded Bitcoin mining companies in North America', sector: 'bitcoin mining' },
  'marathon': { desc: 'Marathon Digital Holdings is a leading Bitcoin mining enterprise operating large-scale ASIC mining facilities', sector: 'bitcoin mining' },
  'riot': { desc: 'Riot Platforms is a major publicly traded Bitcoin mining and digital infrastructure company', sector: 'bitcoin mining' },
  'riotplatforms': { desc: 'Riot Platforms operates large-scale Bitcoin mining facilities and is a key player in US-based mining infrastructure', sector: 'bitcoin mining' },
  'cleanspark': { desc: 'CleanSpark is a Bitcoin mining company focused on sustainable energy sources for mining operations', sector: 'bitcoin mining' },
  'bitdeer': { desc: 'Bitdeer Technologies is a world-leading technology company for Bitcoin mining, offering cloud mining and hosting services', sector: 'bitcoin mining' },
  'terawulf': { desc: 'TeraWulf operates zero-carbon Bitcoin mining facilities powered by nuclear and hydroelectric energy', sector: 'bitcoin mining' },
  'hut8': { desc: 'Hut 8 Mining is a publicly traded Bitcoin mining company and one of the largest holders of self-mined Bitcoin', sector: 'bitcoin mining' },
  'cipher': { desc: 'Cipher Mining is a US-based Bitcoin mining company focused on developing data center capacity', sector: 'bitcoin mining' },
  'corescientific': { desc: 'Core Scientific is one of the largest Bitcoin mining and blockchain hosting providers in North America', sector: 'bitcoin mining' },
  'irisenergy': { desc: 'Iris Energy is a sustainable Bitcoin mining company using 100% renewable energy sources', sector: 'bitcoin mining' },
  'griid': { desc: 'GRIID Infrastructure is a vertically integrated Bitcoin mining company with proprietary power assets', sector: 'bitcoin mining' },
  'bitfarms': { desc: 'Bitfarms is a global Bitcoin mining company operating multiple mining facilities across North and South America', sector: 'bitcoin mining' },
  'hive': { desc: 'HIVE Blockchain Technologies is a cryptocurrency mining company with green energy-powered facilities', sector: 'bitcoin mining' },

  // Bitcoin Services
  'luxor': { desc: 'Luxor Technology is a Bitcoin mining pool and hashrate marketplace providing services to mining operations', sector: 'bitcoin services' },
  'blockstream': { desc: 'Blockstream is a leading Bitcoin infrastructure company providing mining, satellite, and Layer 2 solutions', sector: 'bitcoin services' },
  'foundry': { desc: 'Foundry (a DCG company) operates the largest Bitcoin mining pool in North America and provides mining equipment financing', sector: 'bitcoin services' },
  'braiins': { desc: 'Braiins is a Bitcoin mining software company that operates Slush Pool, the first Bitcoin mining pool ever created', sector: 'bitcoin services' },
  'bitmain': { desc: 'Bitmain is the world\'s largest manufacturer of Bitcoin mining ASIC hardware', sector: 'bitcoin services' },
  'microbt': { desc: 'MicroBT is a major manufacturer of Bitcoin mining hardware (WhatsMiner series)', sector: 'bitcoin services' },

  // Renewable Energy Companies
  'nextera': { desc: 'NextEra Energy is the world\'s largest generator of renewable energy from wind and sun', sector: 'renewable energy' },
  'aes': { desc: 'AES Corporation is a Fortune 500 global power company operating a diverse portfolio of generation and distribution assets', sector: 'renewable energy' },
  'enel': { desc: 'Enel is a multinational energy company and one of the largest renewable energy operators globally', sector: 'renewable energy' },
  'enbridg': { desc: 'Enbridge is a major North American energy infrastructure company operating pipelines and renewable energy assets', sector: 'renewable energy' },
  'clearway': { desc: 'Clearway Energy is one of the largest renewable energy operators in the US with wind, solar, and storage assets', sector: 'renewable energy' },
  'invenergy': { desc: 'Invenergy is one of North America\'s largest independent renewable energy companies developing wind, solar, and storage', sector: 'renewable energy' },
  'intersect': { desc: 'Intersect Power is a clean energy company developing utility-scale solar, storage, and green hydrogen projects', sector: 'renewable energy' },
  'avangrid': { desc: 'Avangrid is a leading sustainable energy company with substantial renewable generation assets', sector: 'renewable energy' },
  'pattern': { desc: 'Pattern Energy is a renewable energy company operating wind and solar facilities across North America', sector: 'renewable energy' },
  'longroadenergy': { desc: 'Longroad Energy is a renewable energy developer focused on utility-scale solar and wind projects', sector: 'renewable energy' },
  'keycaptureenergy': { desc: 'Key Capture Energy is a developer and operator of utility-scale battery storage projects', sector: 'renewable energy' },
  'pluralenergy': { desc: 'Plural Energy is a renewable energy company working on community-scale clean power generation', sector: 'renewable energy' },
  'clenera': { desc: 'Clenera (an Enlight company) is a renewable energy developer focused on solar and storage in the western US', sector: 'renewable energy' },
  'energyre': { desc: 'energyRe is a renewable energy developer focused on large-scale wind and solar projects', sector: 'renewable energy' },
  'balancedrockpower': { desc: 'Balanced Rock Power is a renewable energy company focused on power generation and infrastructure', sector: 'renewable energy' },
  'cordelio': { desc: 'Cordelio Power is an independent power producer operating renewable energy assets across North America', sector: 'renewable energy' },
  'hespsolar': { desc: 'HESP Solar is a solar energy development and operations company', sector: 'renewable energy' },
  'cpowerenergymanagement': { desc: 'CPower is an energy management company providing demand-side energy solutions and virtual power plant services', sector: 'renewable energy' },
  'ercot': { desc: 'ERCOT manages the electric grid and power market for most of Texas', sector: 'renewable energy' },
  'caiso': { desc: 'CAISO (California ISO) operates the bulk of California\'s electricity grid', sector: 'renewable energy' },
  'pjm': { desc: 'PJM Interconnection coordinates the wholesale electricity market across 13 US states', sector: 'renewable energy' },
  'miso': { desc: 'MISO (Midcontinent Independent System Operator) manages the electrical grid across 15 US states and Canada', sector: 'renewable energy' },
  'spp': { desc: 'Southwest Power Pool manages the electric grid across 14 US states', sector: 'renewable energy' },

  // Investment Banks / PE / VC
  'goldman': { desc: 'Goldman Sachs is a leading global investment banking and financial services firm', sector: 'finance' },
  'morgan': { desc: 'Morgan Stanley is a leading global financial services firm providing investment banking and wealth management', sector: 'finance' },
  'jpmorgan': { desc: 'JPMorgan Chase is the largest bank in the United States and a major global financial services firm', sector: 'finance' },
  'bofa': { desc: 'Bank of America is one of the largest financial institutions in the US providing banking and investment services', sector: 'finance' },
  'lazard': { desc: 'Lazard is a premier financial advisory and asset management firm known for M&A and restructuring', sector: 'finance' },
  'macquarie': { desc: 'Macquarie Asset Management is one of the world\'s largest infrastructure asset managers', sector: 'finance' },
  'denhamcapital': { desc: 'Denham Capital is a global energy-focused private equity firm investing in sustainable infrastructure', sector: 'finance' },
  'eqt': { desc: 'EQT Partners is a purpose-driven global investment organization focused on active ownership strategies', sector: 'finance' },
  'ventureaviator': { desc: 'Venture Aviator is an investment and advisory firm', sector: 'finance' },
  'cobank': { desc: 'CoBank is a cooperative bank providing financial services to agribusiness, rural infrastructure, and energy sectors', sector: 'finance' },
  'ntcic': { desc: 'National Trust Community Investment Corporation provides tax credit financing for community development and renewable energy', sector: 'finance' },
  'cubicoinvest': { desc: 'Cubico Sustainable Investments is a global renewable energy company investing in wind and solar assets', sector: 'finance' },
  'celticbank': { desc: 'Celtic Bank provides specialized lending including renewable energy project finance', sector: 'finance' },
  'fidelity': { desc: 'Fidelity Investments is one of the largest asset managers in the world', sector: 'finance' },
  'blackrock': { desc: 'BlackRock is the world\'s largest asset manager with significant renewable energy investments', sector: 'finance' },
  'brookfield': { desc: 'Brookfield Asset Management is a global alternative asset manager with major renewable energy and infrastructure holdings', sector: 'finance' },

  // Law Firms
  'mayerbrown': { desc: 'Mayer Brown is a global law firm with a leading energy and project finance practice', sector: 'legal' },
  'lw': { desc: 'Latham & Watkins is a global law firm known for energy, project finance, and M&A transactions', sector: 'legal' },
  'kirkland': { desc: 'Kirkland & Ellis is one of the world\'s largest law firms with a strong private equity and energy practice', sector: 'legal' },
  'skadden': { desc: 'Skadden Arps is a premier global law firm known for M&A and corporate transactions', sector: 'legal' },
  'weil': { desc: 'Weil Gotshal is a major law firm with expertise in restructuring and private equity', sector: 'legal' },
  'milbank': { desc: 'Milbank is a leading international law firm known for project finance and energy transactions', sector: 'legal' },
  'norton': { desc: 'Norton Rose Fulbright is a global law firm with a major energy practice', sector: 'legal' },
  'boltonstjohns': { desc: 'Bolton St Johns is a law and advisory firm', sector: 'legal' },
  'vinson': { desc: 'Vinson & Elkins is a leading law firm known for energy industry transactions and projects', sector: 'legal' },

  // Insurance
  'marsh': { desc: 'Marsh is the world\'s leading insurance broker and risk advisor, with specialized renewable energy practice', sector: 'insurance' },
  'aon': { desc: 'Aon is a global professional services firm providing risk management and insurance solutions', sector: 'insurance' },
  'willis': { desc: 'Willis Towers Watson is a leading global advisory and broking company for insurance and risk management', sector: 'insurance' },
  'zurich': { desc: 'Zurich Insurance Group is a major global insurer with dedicated renewable energy coverage', sector: 'insurance' },
  'gcube': { desc: 'GCube is a specialist renewable energy insurance provider', sector: 'insurance' },

  // Sangha itself
  'sangha': { desc: 'Sangha Systems is the company itself - a renewable energy and Bitcoin mining infrastructure developer', sector: 'internal' },
};

// ============================================================================
// INDUSTRY CONTEXT TEMPLATES
// ============================================================================

const INDUSTRY_CONTEXT = {
  'Renewable Energy': {
    'Potential IPP Client': (c) => {
      const companyDesc = getCompanyDesc(c);
      if (companyDesc) {
        return `${companyDesc}. As a renewable energy company, they represent a potential independent power producer (IPP) client for Sangha's co-located Bitcoin mining infrastructure, which could consume excess power generation.`;
      }
      const ident = getCompanyIdentifier(c);
      return `${ident} operates in the renewable energy sector based on ${getMatchSource(c)}. This makes them a potential IPP client for Sangha, which co-locates Bitcoin mining at power generation sites to serve as a flexible load and improve project economics.`;
    },
    'Technical Support': (c) => {
      const companyDesc = getCompanyDesc(c);
      if (companyDesc) {
        return `${companyDesc}. They are a potential technical support or engineering resource for Sangha's renewable energy and mining infrastructure projects. ${getTitleContext(c)}`;
      }
      const ident = getCompanyIdentifier(c);
      return `${ident} is in the renewable energy space based on ${getMatchSource(c)}. They could provide technical expertise relevant to Sangha's power generation and mining facility development. ${getTitleContext(c)}`;
    },
    'Marketing Opportunities': (c) => {
      const ident = getCompanyIdentifier(c);
      return `${ident} operates in renewable energy based on ${getMatchSource(c)}. They represent a potential marketing or business development collaboration opportunity for Sangha's energy and mining operations. ${getTitleContext(c)}`;
    },
    'Friend': (c) => {
      const companyDesc = getCompanyDesc(c);
      if (companyDesc) {
        return `${companyDesc}. This is an internal contact or close affiliate of Sangha Systems within the renewable energy ecosystem.`;
      }
      return `${getCompanyIdentifier(c)} is closely associated with Sangha Systems based on ${getMatchSource(c)}. This contact is classified as a friend or internal affiliate of the organization.`;
    },
  },
  'Bitcoin mining': {
    'Potential IPP Client': (c) => {
      const companyDesc = getCompanyDesc(c);
      if (companyDesc) {
        return `${companyDesc}. As a Bitcoin mining operation, they could be both a potential client for Sangha's power infrastructure and a peer in the mining industry, with opportunities for power purchase agreements or co-location partnerships.`;
      }
      const ident = getCompanyIdentifier(c);
      return `${ident} is in the Bitcoin mining industry based on ${getMatchSource(c)}. Mining operations require large-scale power, making them a natural IPP client candidate for Sangha's renewable energy generation assets.`;
    },
    'Technical Support': (c) => {
      const ident = getCompanyIdentifier(c);
      return `${ident} is involved in Bitcoin mining based on ${getMatchSource(c)}. They may provide mining-related technical services or expertise relevant to Sangha's mining operations and infrastructure. ${getTitleContext(c)}`;
    },
    'Marketing Opportunities': (c) => {
      const ident = getCompanyIdentifier(c);
      return `${ident} is in the Bitcoin mining space based on ${getMatchSource(c)}. This contact represents a marketing or partnership opportunity within the mining community that Sangha operates in.`;
    },
  },
  'Bitcoin services': {
    'Technical Support': (c) => {
      const companyDesc = getCompanyDesc(c);
      if (companyDesc) {
        return `${companyDesc}. They provide services that Sangha's mining operations may rely on, such as mining pools, firmware, or hashrate management tools.`;
      }
      const ident = getCompanyIdentifier(c);
      return `${ident} provides Bitcoin-related services based on ${getMatchSource(c)}. These services (pools, hardware, software, or analytics) are directly relevant to Sangha's Bitcoin mining operations.`;
    },
    'Marketing Opportunities': (c) => {
      const companyDesc = getCompanyDesc(c);
      if (companyDesc) {
        return `${companyDesc}. As a Bitcoin ecosystem company, they represent a marketing or partnership opportunity for Sangha's mining and energy infrastructure business.`;
      }
      const ident = getCompanyIdentifier(c);
      return `${ident} operates in the Bitcoin services ecosystem based on ${getMatchSource(c)}. This positions them as a potential marketing partner or service provider for Sangha's mining operations.`;
    },
  },
  'Investment/Finance': {
    'Investment - DevCo': (c) => {
      const companyDesc = getCompanyDesc(c);
      if (companyDesc) {
        return `${companyDesc}. They are a potential investor or financing partner for Sangha's development company, which builds renewable energy and Bitcoin mining infrastructure. ${getTitleContext(c)}`;
      }
      const ident = getCompanyIdentifier(c);
      return `${ident} is a financial institution or investment firm based on ${getMatchSource(c)}. They are a potential capital partner for Sangha's development company, which requires project finance for renewable energy and mining assets. ${getTitleContext(c)}`;
    },
    'Advisor': (c) => {
      const companyDesc = getCompanyDesc(c);
      if (companyDesc) {
        return `${companyDesc}. They are a potential financial advisor to Sangha for capital markets, M&A, or strategic transactions. ${getTitleContext(c)}`;
      }
      const ident = getCompanyIdentifier(c);
      return `${ident} is a financial advisory firm based on ${getMatchSource(c)}. They could serve as a financial advisor to Sangha on capital raising, project finance, or strategic transactions related to energy and mining assets.`;
    },
    'Technical Support': (c) => {
      const ident = getCompanyIdentifier(c);
      return `${ident} is in financial services based on ${getMatchSource(c)}. They may provide analytical, research, or operational support relevant to Sangha's financial planning and investment activities. ${getTitleContext(c)}`;
    },
    'Marketing Opportunities': (c) => {
      const ident = getCompanyIdentifier(c);
      return `${ident} operates in financial services based on ${getMatchSource(c)}. This contact may present marketing or awareness-building opportunities for Sangha within the investment community.`;
    },
  },
  'Legal': {
    'Advisor': (c) => {
      const companyDesc = getCompanyDesc(c);
      if (companyDesc) {
        return `${companyDesc}. They are a potential legal advisor for Sangha's project development, power purchase agreements, and corporate transactions. ${getTitleContext(c)}`;
      }
      const ident = getCompanyIdentifier(c);
      return `${ident} is a legal services provider based on ${getMatchSource(c)}. Their legal expertise could be valuable for Sangha's contract negotiations, regulatory compliance, and project finance documentation. ${getTitleContext(c)}`;
    },
    'Technical Support': (c) => {
      const ident = getCompanyIdentifier(c);
      return `${ident} provides legal services based on ${getMatchSource(c)}. They may support Sangha with regulatory, compliance, or technical legal matters in energy and mining. ${getTitleContext(c)}`;
    },
    'Marketing Opportunities': (c) => {
      const ident = getCompanyIdentifier(c);
      return `${ident} is in the legal sector based on ${getMatchSource(c)}. This contact could provide marketing or networking opportunities within the legal community that serves energy and mining industries.`;
    },
  },
  'Insurance': {
    'Marketing Opportunities': (c) => {
      const companyDesc = getCompanyDesc(c);
      if (companyDesc) {
        return `${companyDesc}. Insurance is critical for Sangha's renewable energy and mining operations, making this contact relevant for risk management and coverage needs.`;
      }
      const ident = getCompanyIdentifier(c);
      return `${ident} is in the insurance industry based on ${getMatchSource(c)}. Sangha's renewable energy installations and Bitcoin mining equipment require specialized insurance, making this a relevant marketing and service relationship.`;
    },
    'Technical Support': (c) => {
      const ident = getCompanyIdentifier(c);
      return `${ident} provides insurance services based on ${getMatchSource(c)}. They could support Sangha with risk assessment, underwriting, or claims for energy and mining assets. ${getTitleContext(c)}`;
    },
  },
  'SaaS - Web 2': {
    'Technical Support': (c) => {
      const ident = getCompanyIdentifier(c);
      return `${ident} is a technology/SaaS company based on ${getMatchSource(c)}. They may provide software, monitoring, analytics, or operational tools relevant to Sangha's energy and mining infrastructure. ${getTitleContext(c)}`;
    },
  },
  'Engineering': {
    'Technical Support': (c) => {
      const ident = getCompanyIdentifier(c);
      return `${ident} is an engineering firm based on ${getMatchSource(c)}. They could provide design, construction, or technical consulting services for Sangha's renewable energy and mining facility development. ${getTitleContext(c)}`;
    },
  },
  'Construction': {
    'Marketing Opportunities': (c) => {
      const ident = getCompanyIdentifier(c);
      return `${ident} is in the construction industry based on ${getMatchSource(c)}. Construction firms are key partners for building out Sangha's renewable energy generation and Bitcoin mining facility infrastructure.`;
    },
    'Technical Support': (c) => {
      const ident = getCompanyIdentifier(c);
      return `${ident} provides construction services based on ${getMatchSource(c)}. They could support the physical buildout of Sangha's solar, wind, or mining facility projects. ${getTitleContext(c)}`;
    },
  },
  'Real Estate': {
    'Marketing Opportunities': (c) => {
      const ident = getCompanyIdentifier(c);
      return `${ident} is in real estate based on ${getMatchSource(c)}. Real estate expertise is relevant to Sangha's land acquisition and site development needs for renewable energy generation and mining operations.`;
    },
    'Technical Support': (c) => {
      const ident = getCompanyIdentifier(c);
      return `${ident} operates in real estate based on ${getMatchSource(c)}. They may be relevant to Sangha's site selection, land leasing, and property management for energy and mining facilities. ${getTitleContext(c)}`;
    },
  },
  'Electrical Equipment': {
    'Technical Support': (c) => {
      const ident = getCompanyIdentifier(c);
      return `${ident} is in the electrical equipment sector based on ${getMatchSource(c)}. They may supply transformers, switchgear, substations, or other critical electrical infrastructure for Sangha's power generation and mining sites.`;
    },
  },
  'Operations Management': {
    'Technical Support': (c) => {
      const ident = getCompanyIdentifier(c);
      return `${ident} specializes in operations management based on ${getMatchSource(c)}. They could help optimize Sangha's facility operations, logistics, or supply chain for mining and energy assets. ${getTitleContext(c)}`;
    },
  },
  'Other': {
    'Other': (c) => {
      const ident = getCompanyIdentifier(c);
      const domain = c.domain;
      const company = c.company;
      const title = c.title;

      if (!domain && !company && !title) {
        return `This contact has no company, domain, or title information available, making industry classification impossible. They have been assigned to the general newsletter for broad communications.`;
      }
      if (domain && isGenericDomain(domain)) {
        if (title) {
          return `This contact uses a personal email (${domain}) rather than a corporate domain. While their title "${title}" provides some context, without a company domain it is not possible to reliably classify their industry affiliation with Sangha's core verticals.`;
        }
        return `This contact uses a personal email domain (${domain}) with no company or title information, making it impossible to determine their industry relevance to Sangha's energy and mining business. They receive the general newsletter by default.`;
      }
      if (domain) {
        const domainLabel = company ? `${company} (${domain})` : domain;
        if (title) {
          return `The domain ${domainLabel} does not match any of Sangha's core industry verticals (energy, mining, finance, legal, insurance). Their title "${title}" and the company domain suggest a business outside Sangha's primary ecosystem, so they receive general communications.`;
        }
        return `The domain ${domainLabel} does not match any of Sangha's core industry verticals (energy, mining, finance, legal, insurance, engineering). Without additional company or title data, this contact is classified as Other and receives the general newsletter.`;
      }
      if (company) {
        return `${company} does not clearly align with Sangha's core verticals of renewable energy, Bitcoin mining, investment, legal, or engineering. ${getTitleContext(c, 'Their role')} does not provide enough signal to classify them into a specific industry category.`;
      }
      return `Limited information is available for this contact. Without a recognizable domain, company name, or title matching Sangha's core industry verticals, they are classified as Other and receive general communications.`;
    },
  },
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

const GENERIC_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com',
  'icloud.com', 'me.com', 'live.com', 'msn.com', 'protonmail.com', 'mail.com',
  'ymail.com', 'googlemail.com', 'yahoo.co.uk', 'comcast.net', 'att.net',
  'sbcglobal.net', 'verizon.net', 'cox.net', 'charter.net',
]);

function isGenericDomain(domain) {
  return GENERIC_DOMAINS.has((domain || '').toLowerCase());
}

function getCompanyDesc(c) {
  const domain = (c.domain || '').toLowerCase().split('.')[0];
  const company = (c.company || '').toLowerCase().replace(/[^a-z0-9 ]/g, '');

  // For known company matching, require either:
  // 1. The domain starts with the key (e.g. "mara.com" starts with "mara")
  // 2. The domain exactly equals the key
  // 3. The key is long enough (6+ chars) for substring matching to be safe
  // This prevents "michaelmarandallc" from matching "mara"

  // Check domain first
  for (const [key, info] of Object.entries(KNOWN_COMPANIES)) {
    if (!domain) continue;
    if (domain === key) return info.desc;
    if (domain.startsWith(key) && key.length >= 4) return info.desc;
    if (key.length >= 6 && domain.includes(key)) return info.desc;
  }
  // Then company name (more lenient since company names are descriptive)
  for (const [key, info] of Object.entries(KNOWN_COMPANIES)) {
    if (!company) continue;
    // For short keys (< 6 chars), require word boundary match
    if (key.length < 6) {
      const re = new RegExp(`\\b${key}\\b`, 'i');
      if (re.test(company)) return info.desc;
    } else {
      if (company.includes(key)) return info.desc;
    }
  }
  return null;
}

function getCompanyIdentifier(c) {
  if (c.company) return c.company;
  if (c.domain) return `The organization at ${c.domain}`;
  if (c.name) return c.name;
  return 'This contact';
}

function getMatchSource(c) {
  const domain = (c.domain || '').toLowerCase();
  const company = (c.company || '').toLowerCase();
  const title = (c.title || '').toLowerCase();

  // Figure out what triggered the classification
  if (domain && !isGenericDomain(domain)) {
    return `their email domain (${c.domain})`;
  }
  if (company) {
    return `their company name (${c.company})`;
  }
  if (title) {
    return `their job title (${c.title})`;
  }
  return 'available contact information';
}

function getTitleContext(c) {
  if (!c.title) return '';
  const title = c.title;

  // C-suite
  if (/\b(ceo|chief executive|founder|co-founder|president)\b/i.test(title)) {
    return `As ${title}, they are a senior decision-maker who could directly authorize partnerships or investments.`;
  }
  if (/\b(cfo|chief financial|treasurer)\b/i.test(title)) {
    return `As ${title}, they oversee financial decisions and could evaluate investment or financing opportunities.`;
  }
  if (/\b(cto|chief technology|chief technical)\b/i.test(title)) {
    return `As ${title}, they lead technology decisions relevant to infrastructure and operations.`;
  }
  if (/\b(coo|chief operating)\b/i.test(title)) {
    return `As ${title}, they oversee day-to-day operations and could influence infrastructure partnerships.`;
  }
  // VP/Director level
  if (/\b(vice president|vp|svp|evp)\b/i.test(title)) {
    return `As ${title}, they hold senior leadership with authority over relevant business decisions.`;
  }
  if (/\b(director|head of|managing director)\b/i.test(title)) {
    return `As ${title}, they lead their department and can influence strategic decisions.`;
  }
  // Manager
  if (/\b(manager|lead|supervisor)\b/i.test(title)) {
    return `As ${title}, they manage relevant operational functions and serve as a point of contact.`;
  }
  // Specialist roles
  if (/\b(partner)\b/i.test(title)) {
    return `As ${title}, they hold a senior position with strategic influence and decision-making authority.`;
  }
  if (/\b(counsel|attorney|lawyer)\b/i.test(title)) {
    return `As ${title}, they handle legal matters relevant to contracts and regulatory compliance.`;
  }
  if (/\b(analyst|associate)\b/i.test(title)) {
    return `As ${title}, they provide analytical and support functions relevant to the relationship.`;
  }
  if (/\b(engineer|developer|architect)\b/i.test(title)) {
    return `As ${title}, they bring technical expertise relevant to infrastructure and operations.`;
  }
  // Generic
  return `Their role as ${title} is relevant to the relationship with Sangha.`;
}

// ============================================================================
// MAIN REASONING GENERATOR
// ============================================================================

function generateReasoning(c) {
  const industry = c.industry || 'Other';
  const reason = c.reason || 'Other';

  // Look up in context templates
  const industryTemplates = INDUSTRY_CONTEXT[industry];
  if (industryTemplates) {
    const template = industryTemplates[reason];
    if (template) {
      return template(c);
    }
    // Fallback: use first available template for this industry
    const firstKey = Object.keys(industryTemplates)[0];
    if (firstKey) {
      return industryTemplates[firstKey](c);
    }
  }

  // Ultimate fallback
  const ident = getCompanyIdentifier(c);
  return `${ident} was classified as ${industry} (${reason}) based on ${getMatchSource(c)}. This classification determines they receive ${c.materials || 'general'} communications from Sangha.`;
}

// ============================================================================
// MAIN
// ============================================================================

function main() {
  console.log('=== HubSpot Classification Reasoning Enrichment ===\n');
  console.log(`DB: ${DB_PATH}`);
  if (LIMIT) console.log(`Limit: ${LIMIT} contacts`);
  if (DRY_RUN) console.log('** DRY RUN - no DB writes **');
  if (OTHER_ONLY) console.log('** OTHER ONLY mode **');
  console.log('');

  if (!fs.existsSync(DB_PATH)) {
    console.error(`ERROR: Database not found at ${DB_PATH}`);
    process.exit(1);
  }

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');

  const nonOtherCount = db.prepare("SELECT COUNT(*) as cnt FROM hubspot_classifications WHERE industry != 'Other'").get().cnt;
  const otherCount = db.prepare("SELECT COUNT(*) as cnt FROM hubspot_classifications WHERE industry = 'Other'").get().cnt;
  console.log(`Total contacts: ${nonOtherCount + otherCount}`);
  console.log(`  Non-Other: ${nonOtherCount}`);
  console.log(`  Other: ${otherCount}\n`);

  const updateStmt = db.prepare('UPDATE hubspot_classifications SET reasoning = ? WHERE hubspot_id = ?');

  let totalProcessed = 0;
  let totalUpdated = 0;

  function processContacts(query, label) {
    const contacts = db.prepare(query).all();
    let toProcess = LIMIT ? Math.min(contacts.length, LIMIT - totalProcessed) : contacts.length;

    if (toProcess <= 0) {
      console.log(`[${label}] No contacts to process.`);
      return;
    }

    console.log(`[${label}] Processing ${toProcess} contacts...`);

    const updates = [];
    for (let i = 0; i < toProcess; i++) {
      const c = contacts[i];
      const reasoning = generateReasoning(c);
      updates.push({ reasoning, hubspot_id: c.hubspot_id });
    }

    // Batch write in a transaction
    if (!DRY_RUN) {
      const tx = db.transaction(() => {
        for (const u of updates) {
          updateStmt.run(u.reasoning, u.hubspot_id);
        }
      });
      tx();
    }

    totalProcessed += toProcess;
    totalUpdated += updates.length;

    // Print samples
    console.log(`  Updated ${updates.length} contacts`);
    const sampleCount = Math.min(5, updates.length);
    for (let i = 0; i < sampleCount; i++) {
      const c = contacts[i];
      console.log(`\n  Sample ${i + 1}:`);
      console.log(`    Name: ${c.name || '(none)'} | Company: ${c.company || '(none)'} | Domain: ${c.domain || '(none)'}`);
      console.log(`    Title: ${c.title || '(none)'}`);
      console.log(`    Classification: ${c.industry} / ${c.reason} / ${c.materials}`);
      console.log(`    OLD reasoning: ${c.reasoning}`);
      console.log(`    NEW reasoning: ${updates[i].reasoning}`);
    }
    console.log('');
  }

  // Phase 1: Non-Other contacts
  if (!OTHER_ONLY) {
    processContacts(
      "SELECT * FROM hubspot_classifications WHERE industry != 'Other' ORDER BY confidence DESC, industry ASC",
      'Non-Other'
    );
  }

  // Phase 2: Other contacts
  if (!LIMIT || totalProcessed < LIMIT) {
    processContacts(
      "SELECT * FROM hubspot_classifications WHERE industry = 'Other' ORDER BY confidence DESC",
      'Other'
    );
  }

  console.log(`=== DONE ===`);
  console.log(`Total processed: ${totalProcessed}`);
  console.log(`Total updated: ${totalUpdated}`);
  if (DRY_RUN) console.log('(Dry run - no changes written to DB)');

  db.close();
}

main();
