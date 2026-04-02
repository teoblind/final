#!/usr/bin/env node
/**
 * Local HubSpot Contact Classifier
 *
 * Fetches ALL contacts from HubSpot API (read-only), classifies them using
 * heuristic rules (domain patterns, company names, job titles), and stores
 * results in the local Coppice SQLite DB. Does NOT modify HubSpot.
 *
 * Usage: node scripts/classify_local.js [--tenant sangha]
 */

import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── Config ───────────────────────────────────────────────────────────────

const TENANT_ID = process.argv.includes('--tenant')
  ? process.argv[process.argv.indexOf('--tenant') + 1]
  : 'default';

const TENANT_DIR = TENANT_ID === 'default' ? 'sangha' : TENANT_ID;
const DB_PATH = join(__dirname, '..', 'backend', 'data', TENANT_DIR, `${TENANT_DIR}.db`);

// Get API key from CLI arg or env
function getApiKey() {
  const argIdx = process.argv.indexOf('--key');
  if (argIdx !== -1 && process.argv[argIdx + 1]) return process.argv[argIdx + 1];
  if (process.env.HUBSPOT_API_KEY) return process.env.HUBSPOT_API_KEY;
  throw new Error('No HubSpot API key provided. Use --key <key> or set HUBSPOT_API_KEY env var');
}

const HUBSPOT_BASE = 'https://api.hubapi.com';
const PROPERTIES = [
  'firstname', 'lastname', 'email', 'phone', 'company', 'jobtitle',
  'industry', 'hs_lead_status', 'lifecyclestage',
  'sangha_industry', 'sangha_reason_to_contact', 'sangha_email_type',
];

// ─── Classification Rules ─────────────────────────────────────────────────

const GENERIC_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com',
  'icloud.com', 'me.com', 'live.com', 'msn.com', 'protonmail.com', 'mail.com',
  'ymail.com', 'googlemail.com', 'yahoo.co.uk', 'comcast.net', 'att.net',
  'sbcglobal.net', 'verizon.net', 'cox.net', 'charter.net',
]);

// Domain/company keyword -> [industry, reason, materials]
const DOMAIN_RULES = [
  // Energy (high priority)
  { keywords: ['energy', 'power', 'solar', 'wind', 'utility', 'electric', 'renewable', 'grid', 'watt', 'hydro', 'geothermal', 'biomass'], industry: 'Renewable Energy', reason: 'Potential IPP Client', materials: 'General Newsletter' },
  // Bitcoin mining (specific companies first)
  { keywords: ['marathon', 'mara'], industry: 'Bitcoin mining', reason: 'Potential IPP Client', materials: 'General Newsletter' },
  { keywords: ['riot', 'riotplatforms'], industry: 'Bitcoin mining', reason: 'Potential IPP Client', materials: 'General Newsletter' },
  { keywords: ['cleanspark'], industry: 'Bitcoin mining', reason: 'Potential IPP Client', materials: 'General Newsletter' },
  { keywords: ['bitdeer'], industry: 'Bitcoin mining', reason: 'Potential IPP Client', materials: 'General Newsletter' },
  { keywords: ['terawulf'], industry: 'Bitcoin mining', reason: 'Potential IPP Client', materials: 'General Newsletter' },
  { keywords: ['hut8', 'hut 8'], industry: 'Bitcoin mining', reason: 'Potential IPP Client', materials: 'General Newsletter' },
  { keywords: ['cipher'], industry: 'Bitcoin mining', reason: 'Potential IPP Client', materials: 'General Newsletter' },
  { keywords: ['core scientific', 'corescientific'], industry: 'Bitcoin mining', reason: 'Potential IPP Client', materials: 'General Newsletter' },
  { keywords: ['iris energy', 'irisenergy'], industry: 'Bitcoin mining', reason: 'Potential IPP Client', materials: 'General Newsletter' },
  { keywords: ['mining', 'miner', 'hash', 'btc'], industry: 'Bitcoin mining', reason: 'Potential IPP Client', materials: 'General Newsletter' },
  // Bitcoin services
  { keywords: ['luxor'], industry: 'Bitcoin services', reason: 'Technical Support', materials: 'General Newsletter' },
  { keywords: ['blockstream', 'blockvolution'], industry: 'Bitcoin services', reason: 'Marketing Opportunities', materials: 'General Newsletter' },
  { keywords: ['bitcoin', 'crypto', 'blockchain', 'web3', 'defi'], industry: 'Bitcoin services', reason: 'Marketing Opportunities', materials: 'General Newsletter' },
  // Investment / Finance
  { keywords: ['capital', 'ventures', 'invest', 'fund', 'equity', 'asset', 'wealth', 'finance', 'fidelity', 'goldman', 'morgan', 'bank', 'hedge'], industry: 'Investment/Finance', reason: 'Investment - DevCo', materials: 'Investment Teaser' },
  { keywords: ['advisory', 'advisors'], industry: 'Investment/Finance', reason: 'Advisor', materials: 'Investment Teaser' },
  { keywords: ['partners', 'partnership'], industry: 'Investment/Finance', reason: 'Investment - DevCo', materials: 'Investment Teaser' },
  // Insurance
  { keywords: ['insurance', 'insur', 'underwrite', 'marsh', 'actuari'], industry: 'Insurance', reason: 'Marketing Opportunities', materials: 'General Marketing' },
  // Legal
  { keywords: ['law', 'legal', 'counsel', 'attorney', 'litigation', 'solicitor'], industry: 'Legal', reason: 'Advisor', materials: 'General Newsletter' },
  // Engineering
  { keywords: ['engineer', 'design'], industry: 'Engineering', reason: 'Technical Support', materials: 'General Newsletter' },
  // Construction
  { keywords: ['construct', 'build', 'contractor', 'excavat'], industry: 'Construction', reason: 'Marketing Opportunities', materials: 'General Marketing' },
  // Real Estate
  { keywords: ['realty', 'property', 'estate', 'realtor'], industry: 'Real Estate', reason: 'Marketing Opportunities', materials: 'General Marketing' },
  // SaaS
  { keywords: ['software', 'saas', 'cloud', 'tech', 'app', 'platform', 'data'], industry: 'SaaS - Web 2', reason: 'Technical Support', materials: 'General Newsletter' },
  // Electrical Equipment
  { keywords: ['electrical', 'transformer', 'switchgear', 'substation', 'voltage'], industry: 'Electrical Equipment', reason: 'Technical Support', materials: 'General Newsletter' },
  // Operations
  { keywords: ['operations', 'logistics', 'supply chain'], industry: 'Operations Management', reason: 'Technical Support', materials: 'General Newsletter' },
  // Known companies
  { keywords: ['sangha'], industry: 'Renewable Energy', reason: 'Friend', materials: 'General Newsletter' },
  { keywords: ['ventureaviator'], industry: 'Investment/Finance', reason: 'Investment - DevCo', materials: 'Investment Teaser' },
  { keywords: ['boltonstjohns'], industry: 'Legal', reason: 'Advisor', materials: 'General Newsletter' },
];

// Job title overrides
const TITLE_OVERRIDES = [
  { keywords: ['ceo', 'founder', 'co-founder', 'president', 'principal', 'managing director', 'chairman'], reasonForInvestment: 'Investment - DevCo', reasonForEnergy: 'Potential IPP Client' },
  { keywords: ['cfo', 'chief financial', 'treasurer'], reasonForInvestment: 'Investment - DevCo' },
  { keywords: ['engineer', 'developer', 'technical', 'cto', 'architect'], reason: 'Technical Support' },
  { keywords: ['marketing', 'communications', 'pr ', 'public relations', 'brand'], reason: 'Marketing Opportunities' },
  { keywords: ['legal', 'counsel', 'attorney', 'compliance', 'regulatory'], reason: 'Advisor', industry: 'Legal' },
  { keywords: ['analyst', 'research'], reason: 'Technical Support' },
];

function classifyContact(contact) {
  const props = contact.properties || {};
  const email = (props.email || '').toLowerCase();
  const company = (props.company || '').toLowerCase();
  const title = (props.jobtitle || '').toLowerCase();
  const firstName = props.firstname || '';
  const lastName = props.lastname || '';
  const name = `${firstName} ${lastName}`.trim();

  const domain = email.includes('@') ? email.split('@')[1] : '';
  const domainName = domain ? domain.split('.')[0] : '';
  const isGeneric = GENERIC_DOMAINS.has(domain);

  const searchText = `${domainName} ${company} ${title}`.toLowerCase();

  let industry = null;
  let reason = null;
  let materials = null;
  let reasoning = '';
  let confidence = 50;
  let matchedKeyword = null;

  // Try domain/company rules
  for (const rule of DOMAIN_RULES) {
    for (const kw of rule.keywords) {
      if (searchText.includes(kw)) {
        industry = rule.industry;
        reason = rule.reason;
        materials = rule.materials;
        matchedKeyword = kw;

        // Build reasoning
        if (domainName.includes(kw)) {
          reasoning = `Email domain "${domain}" matches "${kw}" pattern`;
          confidence = 85;
        } else if (company.includes(kw)) {
          reasoning = `Company "${props.company}" matches "${kw}" pattern`;
          confidence = 80;
        } else if (title.includes(kw)) {
          reasoning = `Job title "${props.jobtitle}" matches "${kw}" pattern`;
          confidence = 70;
        }
        break;
      }
    }
    if (industry) break;
  }

  // Apply title overrides
  if (industry && title) {
    for (const override of TITLE_OVERRIDES) {
      for (const kw of override.keywords) {
        if (title.includes(kw)) {
          if (override.industry) {
            industry = override.industry;
            reasoning += ` | Title "${props.jobtitle}" suggests ${override.industry}`;
          }
          if (override.reason) {
            reason = override.reason;
          } else if (override.reasonForInvestment && industry === 'Investment/Finance') {
            reason = override.reasonForInvestment;
          } else if (override.reasonForEnergy && (industry === 'Renewable Energy' || industry === 'Bitcoin mining')) {
            reason = override.reasonForEnergy;
          }
          break;
        }
      }
    }
  }

  // Generic email with no company match - classify as Other
  if (!industry) {
    if (isGeneric && !company) {
      industry = 'Other';
      reason = 'Other';
      materials = 'General Newsletter';
      reasoning = `Generic email domain (${domain}), no company info available`;
      confidence = 30;
    } else if (domain && !isGeneric) {
      industry = 'Other';
      reason = 'Other';
      materials = 'General Newsletter';
      reasoning = `Company domain "${domain}" did not match any classification rules`;
      confidence = 40;
    } else if (company) {
      industry = 'Other';
      reason = 'Other';
      materials = 'General Newsletter';
      reasoning = `Company "${props.company}" did not match any classification rules`;
      confidence = 35;
    } else {
      industry = 'Other';
      reason = 'Other';
      materials = 'General Newsletter';
      reasoning = 'No identifying information available';
      confidence = 20;
    }
  }

  return {
    hubspot_id: contact.id,
    name,
    email: props.email || null,
    company: props.company || null,
    title: props.jobtitle || null,
    domain: domain || null,
    industry,
    reason,
    materials,
    reasoning,
    confidence,
  };
}

// ─── HubSpot API ──────────────────────────────────────────────────────────

async function fetchAllContacts(apiKey) {
  const allContacts = [];
  let after = undefined;
  let page = 0;

  while (true) {
    let url = `${HUBSPOT_BASE}/crm/v3/objects/contacts?limit=100&properties=${PROPERTIES.join(',')}`;
    if (after) url += `&after=${after}`;

    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`HubSpot ${res.status}: ${err.slice(0, 200)}`);
    }

    const data = await res.json();
    allContacts.push(...(data.results || []));
    page++;

    console.log(`  Page ${page}: fetched ${data.results?.length || 0} contacts (total: ${allContacts.length})`);

    after = data.paging?.next?.after;
    if (!after) break;

    // Rate limit
    await new Promise(r => setTimeout(r, 100));
  }

  return allContacts;
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nHubSpot Local Classifier`);
  console.log(`Tenant: ${TENANT_ID} (dir: ${TENANT_DIR})`);
  console.log(`DB: ${DB_PATH}\n`);

  if (!fs.existsSync(DB_PATH)) {
    console.error(`ERROR: Database not found at ${DB_PATH}`);
    process.exit(1);
  }

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');

  // Ensure table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS hubspot_classifications (
      hubspot_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      name TEXT, email TEXT, company TEXT, title TEXT, domain TEXT,
      industry TEXT, reason TEXT, materials TEXT, reasoning TEXT,
      confidence INTEGER DEFAULT 50,
      classified_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (hubspot_id, tenant_id)
    )
  `);
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_hs_class_tenant ON hubspot_classifications(tenant_id, industry)'); } catch {}

  // Get API key
  let apiKey;
  try {
    apiKey = getApiKey();
    console.log(`API key found (${apiKey.slice(0, 8)}...)\n`);
  } catch (e) {
    console.error(`ERROR: ${e.message}`);
    process.exit(1);
  }

  // Fetch all contacts
  console.log('Fetching all contacts from HubSpot...');
  const contacts = await fetchAllContacts(apiKey);
  console.log(`\nFetched ${contacts.length} total contacts\n`);

  // Classify all
  console.log('Classifying...');
  const classifications = contacts.map(classifyContact);

  // Count stats
  const industryCounts = {};
  for (const c of classifications) {
    industryCounts[c.industry] = (industryCounts[c.industry] || 0) + 1;
  }

  // Bulk insert
  console.log(`\nWriting ${classifications.length} classifications to local DB...`);
  const tenantId = TENANT_ID === 'default' ? 'default' : TENANT_ID;

  const stmt = db.prepare(`
    INSERT INTO hubspot_classifications (hubspot_id, tenant_id, name, email, company, title, domain, industry, reason, materials, reasoning, confidence, classified_at)
    VALUES (@hubspot_id, @tenant_id, @name, @email, @company, @title, @domain, @industry, @reason, @materials, @reasoning, @confidence, datetime('now'))
    ON CONFLICT(hubspot_id, tenant_id) DO UPDATE SET
      name=@name, email=@email, company=@company, title=@title, domain=@domain,
      industry=@industry, reason=@reason, materials=@materials, reasoning=@reasoning,
      confidence=@confidence, classified_at=datetime('now')
  `);

  const tx = db.transaction((items) => {
    for (const item of items) {
      stmt.run({ ...item, tenant_id: tenantId });
    }
  });
  tx(classifications);

  // Print stats
  console.log(`\n=== DONE ===`);
  console.log(`Total contacts: ${contacts.length}`);
  console.log(`Classified: ${classifications.length}`);
  console.log(`\nBy industry:`);
  const sorted = Object.entries(industryCounts).sort((a, b) => b[1] - a[1]);
  for (const [ind, count] of sorted) {
    const pct = ((count / classifications.length) * 100).toFixed(1);
    console.log(`  ${ind.padEnd(30)} ${String(count).padStart(5)}  (${pct}%)`);
  }

  // High confidence vs low confidence
  const highConf = classifications.filter(c => c.confidence >= 70).length;
  const medConf = classifications.filter(c => c.confidence >= 40 && c.confidence < 70).length;
  const lowConf = classifications.filter(c => c.confidence < 40).length;
  console.log(`\nConfidence breakdown:`);
  console.log(`  High (70+):  ${highConf}`);
  console.log(`  Medium (40-69): ${medConf}`);
  console.log(`  Low (<40):   ${lowConf}`);

  db.close();
  console.log('\nDatabase closed. Classifications stored locally only - HubSpot was NOT modified.');
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
