/**
 * HubSpot CRM Service - Search, dedup, create, and sync contacts/companies/deals.
 *
 * Used by: Sangha Hivemind chat (tools), Lead Engine (dedup + sync),
 * Command Dashboard (pipeline widget).
 */

import { getKeyVaultValue } from '../cache/database.js';

const HUBSPOT_BASE = 'https://api.hubapi.com';

// Resolve API key: per-tenant vault first, then env fallback
export function getApiKey(tenantId) {
  if (tenantId) {
    const vaultKey = getKeyVaultValue(tenantId, 'hubspot', 'api_key');
    if (vaultKey) return vaultKey;
  }
  const key = process.env.HUBSPOT_API_KEY;
  if (!key) throw new Error('HUBSPOT_API_KEY not configured');
  return key;
}

export function isConfigured(tenantId) {
  try { getApiKey(tenantId); return true; } catch { return false; }
}

async function hubspotFetch(endpoint, method = 'GET', body = null, tenantId = null) {
  const res = await fetch(`${HUBSPOT_BASE}${endpoint}`, {
    method,
    headers: {
      'Authorization': `Bearer ${getApiKey(tenantId)}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : null,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`HubSpot ${res.status}: ${errText.slice(0, 300)}`);
  }

  return res.json();
}

// ─── SEARCH ─────────────────────────────────────────────────────────────────

export async function searchContacts(query, tenantId) {
  const data = await hubspotFetch('/crm/v3/objects/contacts/search', 'POST', {
    query,
    limit: 10,
    properties: [
      'firstname', 'lastname', 'email', 'phone', 'company',
      'jobtitle', 'lifecyclestage', 'hs_lead_status',
      'notes_last_contacted', 'lastmodifieddate', 'createdate',
    ],
  }, tenantId);

  return data.results.map(c => ({
    id: c.id,
    name: `${c.properties.firstname || ''} ${c.properties.lastname || ''}`.trim(),
    email: c.properties.email,
    phone: c.properties.phone,
    company: c.properties.company,
    title: c.properties.jobtitle,
    stage: c.properties.lifecyclestage,
    lead_status: c.properties.hs_lead_status,
    last_contacted: c.properties.notes_last_contacted,
    last_updated: c.properties.lastmodifieddate,
    created: c.properties.createdate,
  }));
}

export async function searchCompanies(query, tenantId) {
  const data = await hubspotFetch('/crm/v3/objects/companies/search', 'POST', {
    query,
    limit: 10,
    properties: [
      'name', 'domain', 'industry', 'city', 'state',
      'numberofemployees', 'annualrevenue', 'description',
      'notes_last_contacted', 'hs_lead_status',
      'createdate', 'lastmodifieddate',
    ],
  }, tenantId);

  return data.results.map(c => ({
    id: c.id,
    name: c.properties.name,
    domain: c.properties.domain,
    industry: c.properties.industry,
    city: c.properties.city,
    state: c.properties.state,
    employees: c.properties.numberofemployees,
    revenue: c.properties.annualrevenue,
    description: c.properties.description,
    lead_status: c.properties.hs_lead_status,
    last_contacted: c.properties.notes_last_contacted,
    created: c.properties.createdate,
  }));
}

export async function searchDeals(query) {
  const data = await hubspotFetch('/crm/v3/objects/deals/search', 'POST', {
    query,
    limit: 10,
    properties: [
      'dealname', 'dealstage', 'amount', 'closedate',
      'pipeline', 'hs_lastmodifieddate', 'description', 'createdate',
    ],
  });

  return data.results.map(d => ({
    id: d.id,
    name: d.properties.dealname,
    stage: d.properties.dealstage,
    amount: d.properties.amount,
    close_date: d.properties.closedate,
    pipeline: d.properties.pipeline,
    description: d.properties.description,
    created: d.properties.createdate,
  }));
}

// ─── DEDUPLICATION ──────────────────────────────────────────────────────────

export async function checkContactExists(email) {
  try {
    const data = await hubspotFetch('/crm/v3/objects/contacts/search', 'POST', {
      filterGroups: [{
        filters: [{ propertyName: 'email', operator: 'EQ', value: email }],
      }],
      properties: ['firstname', 'lastname', 'email', 'company', 'lifecyclestage', 'hs_lead_status'],
      limit: 1,
    });
    return data.total > 0 ? data.results[0] : null;
  } catch { return null; }
}

export async function checkCompanyExists(companyName) {
  try {
    const data = await hubspotFetch('/crm/v3/objects/companies/search', 'POST', {
      query: companyName,
      limit: 5,
      properties: ['name', 'domain', 'hs_lead_status'],
    });
    return data.results.find(c =>
      c.properties.name?.toLowerCase().includes(companyName.toLowerCase()) ||
      companyName.toLowerCase().includes(c.properties.name?.toLowerCase())
    ) || null;
  } catch { return null; }
}

// ─── CREATE / SYNC ──────────────────────────────────────────────────────────

export async function createContact({ email, firstName, lastName, company, title, phone, source }) {
  const properties = {
    email, firstname: firstName, lastname: lastName,
    company, jobtitle: title, phone,
    hs_lead_status: 'NEW', lifecyclestage: 'lead',
  };
  // Remove undefined/null
  Object.keys(properties).forEach(k => { if (properties[k] == null) delete properties[k]; });

  const data = await hubspotFetch('/crm/v3/objects/contacts', 'POST', { properties });
  return { id: data.id, ...data.properties };
}

export async function createCompany({ name, domain, industry, city, state, description }) {
  const properties = { name, domain, industry, city, state, description };
  Object.keys(properties).forEach(k => { if (!properties[k]) delete properties[k]; });

  const data = await hubspotFetch('/crm/v3/objects/companies', 'POST', { properties });
  return { id: data.id, ...data.properties };
}

export async function createDeal({ name, stage, amount, contactId, companyId, pipeline }) {
  const data = await hubspotFetch('/crm/v3/objects/deals', 'POST', {
    properties: {
      dealname: name,
      dealstage: stage || 'appointmentscheduled',
      amount: amount || '',
      pipeline: pipeline || 'default',
    },
  });

  if (contactId) {
    try {
      await hubspotFetch(`/crm/v3/objects/deals/${data.id}/associations/contacts/${contactId}/3`, 'PUT');
    } catch (e) { console.error('Deal→Contact association error:', e.message); }
  }
  if (companyId) {
    try {
      await hubspotFetch(`/crm/v3/objects/deals/${data.id}/associations/companies/${companyId}/341`, 'PUT');
    } catch (e) { console.error('Deal→Company association error:', e.message); }
  }

  return { id: data.id, ...data.properties };
}

export async function updateContactStatus(contactId, status) {
  await hubspotFetch(`/crm/v3/objects/contacts/${contactId}`, 'PATCH', {
    properties: { hs_lead_status: status },
  });
}

export async function logActivity(contactId, note) {
  await hubspotFetch('/crm/v3/objects/notes', 'POST', {
    properties: {
      hs_note_body: note,
      hs_timestamp: new Date().toISOString(),
    },
    associations: [{
      to: { id: contactId },
      types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }],
    }],
  });
}

// ─── CONTACTS LIST + CLASSIFICATION ────────────────────────────────────────

export async function listContacts({ limit = 50, after, classified, tenantId } = {}) {
  const properties = [
    'firstname', 'lastname', 'email', 'phone', 'company', 'jobtitle',
    'hs_lead_status', 'lifecyclestage', 'createdate', 'lastmodifieddate',
    'sangha_industry', 'sangha_reason_to_contact', 'sangha_email_type',
  ];

  // If filtering by classified/unclassified, use search endpoint
  if (classified === true || classified === false) {
    const operator = classified ? 'HAS_PROPERTY' : 'NOT_HAS_PROPERTY';
    const body = {
      filterGroups: [{ filters: [{ propertyName: 'sangha_industry', operator }] }],
      properties,
      limit: Math.min(limit, 100),
      sorts: [{ propertyName: 'lastmodifieddate', direction: 'DESCENDING' }],
    };
    if (after) body.after = after;
    const data = await hubspotFetch('/crm/v3/objects/contacts/search', 'POST', body, tenantId);
    return {
      contacts: data.results.map(formatContactWithClassification),
      total: data.total,
      paging: data.paging,
    };
  }

  // Default: list all contacts
  let url = `/crm/v3/objects/contacts?limit=${Math.min(limit, 100)}&properties=${properties.join(',')}`;
  if (after) url += `&after=${after}`;
  const data = await hubspotFetch(url, 'GET', null, tenantId);
  return {
    contacts: data.results.map(formatContactWithClassification),
    total: data.total,
    paging: data.paging,
  };
}

function formatContactWithClassification(c) {
  return {
    id: c.id,
    name: `${c.properties.firstname || ''} ${c.properties.lastname || ''}`.trim(),
    email: c.properties.email,
    phone: c.properties.phone,
    company: c.properties.company,
    title: c.properties.jobtitle,
    stage: c.properties.lifecyclestage,
    lead_status: c.properties.hs_lead_status,
    created: c.properties.createdate,
    last_modified: c.properties.lastmodifieddate,
    classification: {
      industry: c.properties.sangha_industry || null,
      reason: c.properties.sangha_reason_to_contact || null,
      materials: c.properties.sangha_email_type || null,
    },
  };
}

export async function updateContactClassification(contactId, { industry, reason, materials } = {}, tenantId) {
  const properties = {};
  if (industry) properties.sangha_industry = industry;
  if (reason) properties.sangha_reason_to_contact = reason;
  if (materials) properties.sangha_email_type = materials;
  if (Object.keys(properties).length === 0) throw new Error('No classification fields provided');
  await hubspotFetch(`/crm/v3/objects/contacts/${contactId}`, 'PATCH', { properties }, tenantId);
  return { id: contactId, updated: properties };
}

export async function bulkUpdateClassifications(updates, tenantId) {
  // HubSpot batch update: max 100 per request
  const results = { success: 0, failed: 0, errors: [] };
  const batches = [];
  for (let i = 0; i < updates.length; i += 100) {
    batches.push(updates.slice(i, i + 100));
  }
  for (const batch of batches) {
    try {
      await hubspotFetch('/crm/v3/objects/contacts/batch/update', 'POST', {
        inputs: batch.map(u => ({
          id: u.id,
          properties: {
            ...(u.industry ? { sangha_industry: u.industry } : {}),
            ...(u.reason ? { sangha_reason_to_contact: u.reason } : {}),
            ...(u.materials ? { sangha_email_type: u.materials } : {}),
          },
        })),
      }, tenantId);
      results.success += batch.length;
    } catch (e) {
      results.failed += batch.length;
      results.errors.push(e.message);
    }
  }
  return results;
}

export async function searchContactsWithClassification(query, { industry, reason, materials, classified, limit = 50 } = {}, tenantId) {
  const properties = [
    'firstname', 'lastname', 'email', 'phone', 'company', 'jobtitle',
    'hs_lead_status', 'lifecyclestage', 'createdate', 'lastmodifieddate',
    'sangha_industry', 'sangha_reason_to_contact', 'sangha_email_type',
  ];

  const filters = [];
  if (industry) filters.push({ propertyName: 'sangha_industry', operator: 'EQ', value: industry });
  if (reason) filters.push({ propertyName: 'sangha_reason_to_contact', operator: 'EQ', value: reason });
  if (materials) filters.push({ propertyName: 'sangha_email_type', operator: 'EQ', value: materials });
  if (classified === true) filters.push({ propertyName: 'sangha_industry', operator: 'HAS_PROPERTY' });
  if (classified === false) filters.push({ propertyName: 'sangha_industry', operator: 'NOT_HAS_PROPERTY' });

  const body = { properties, limit: Math.min(limit, 100) };
  if (query) body.query = query;
  if (filters.length > 0) body.filterGroups = [{ filters }];

  const data = await hubspotFetch('/crm/v3/objects/contacts/search', 'POST', body, tenantId);
  return {
    contacts: data.results.map(formatContactWithClassification),
    total: data.total,
    paging: data.paging,
  };
}

export async function getClassificationStats(tenantId) {
  const [classifiedRes, unclassifiedRes] = await Promise.all([
    hubspotFetch('/crm/v3/objects/contacts/search', 'POST', {
      filterGroups: [{ filters: [{ propertyName: 'sangha_industry', operator: 'HAS_PROPERTY' }] }],
      limit: 1,
    }, tenantId),
    hubspotFetch('/crm/v3/objects/contacts/search', 'POST', {
      filterGroups: [{ filters: [{ propertyName: 'sangha_industry', operator: 'NOT_HAS_PROPERTY' }] }],
      limit: 1,
    }, tenantId),
  ]);
  return {
    classified: classifiedRes.total || 0,
    unclassified: unclassifiedRes.total || 0,
    total: (classifiedRes.total || 0) + (unclassifiedRes.total || 0),
  };
}

// ─── PIPELINE STATS ─────────────────────────────────────────────────────────

export async function getPipelineStats(tenantId) {
  const data = await hubspotFetch('/crm/v3/objects/deals?limit=100&properties=dealname,dealstage,amount,closedate,pipeline', 'GET', null, tenantId);

  const stages = {};
  let totalValue = 0;

  for (const deal of data.results) {
    const stage = deal.properties.dealstage || 'unknown';
    const amount = parseFloat(deal.properties.amount || 0);

    if (!stages[stage]) stages[stage] = { count: 0, value: 0 };
    stages[stage].count++;
    stages[stage].value += amount;
    totalValue += amount;
  }

  return { total_deals: data.results.length, total_value: totalValue, by_stage: stages };
}

export async function getRecentActivity(limit = 20, tenantId) {
  const data = await hubspotFetch(`/crm/v3/objects/contacts?limit=${limit}&properties=firstname,lastname,email,company,jobtitle,lastmodifieddate&sorts=-lastmodifieddate`, 'GET', null, tenantId);

  return data.results.map(c => ({
    id: c.id,
    name: `${c.properties.firstname || ''} ${c.properties.lastname || ''}`.trim(),
    email: c.properties.email,
    company: c.properties.company,
    title: c.properties.jobtitle,
    last_modified: c.properties.lastmodifieddate,
  }));
}
