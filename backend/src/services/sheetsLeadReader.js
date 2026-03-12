/**
 * Reads lead data from Google Sheets via service account.
 * Replaces SQLite seed data with real pipeline data.
 */

import { google } from 'googleapis';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SPREADSHEET_ID = '10uNIqP2m0MV0Na_nXAO_tfhekyaadymzu6mpOj-BLNg';
const KEY_FILE = path.join(process.env.HOME || '/root', 'google-service-account.json');

const TENANT_SHEETS = {
  'default': 'COPPICE — ENERGY',
  'sangha': 'COPPICE — ENERGY',
  'dacp-construction-001': 'COPPICE — CONSTRUCTION',
};

let sheetsClient = null;

async function getSheets() {
  if (sheetsClient) return sheetsClient;
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: KEY_FILE,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    sheetsClient = google.sheets({ version: 'v4', auth });
    return sheetsClient;
  } catch (err) {
    console.error('[SheetsLeadReader] Auth failed:', err.message);
    return null;
  }
}

/**
 * Fetch all leads from the Google Sheet for a tenant.
 */
export async function getSheetLeads(tenantId, status = null, limit = 100) {
  const sheetName = TENANT_SHEETS[tenantId];
  if (!sheetName) return null;

  const sheets = await getSheets();
  if (!sheets) return null;

  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${sheetName}'!A1:Z`,
    });

    const rows = res.data.values;
    if (!rows || rows.length < 2) return [];

    const headers = rows[0].map(h => h.toLowerCase().trim());
    const leads = [];

    for (let i = 1; i < rows.length && leads.length < limit; i++) {
      const row = rows[i];
      const lead = {};
      headers.forEach((h, idx) => {
        lead[h] = row[idx] || '';
      });

      // Normalize status field
      const leadStatus = (lead.status || 'new').toLowerCase().trim();
      if (status && leadStatus !== status.toLowerCase()) return;

      leads.push({
        id: lead.id || `sheet-${i}`,
        company_name: lead.company || lead['company name'] || lead.company_name || '',
        status: leadStatus,
        source: lead.source || 'discovery',
        priority_score: parseInt(lead.priority || lead.priority_score) || 50,
        notes: lead.notes || '',
        website: lead.website || '',
        city: lead.city || '',
        state: lead.state || '',
        contact_name: lead['contact name'] || lead.contact_name || lead['decision maker'] || '',
        contact_email: lead['contact email'] || lead.contact_email || lead.email || '',
        contact_title: lead['contact title'] || lead.contact_title || lead.title || '',
        contactCount: (lead['contact email'] || lead.email) ? 1 : 0,
        created_at: lead['date added'] || lead.created_at || new Date().toISOString(),
      });
    }

    return leads;
  } catch (err) {
    console.error('[SheetsLeadReader] Error reading sheet:', err.message);
    return null;
  }
}

/**
 * Get stats from the Google Sheet for a tenant.
 */
export async function getSheetLeadStats(tenantId) {
  const leads = await getSheetLeads(tenantId, null, 5000);
  if (!leads) return null;

  const statusMap = {};
  let withEmail = 0;

  for (const lead of leads) {
    const s = lead.status || 'new';
    statusMap[s] = (statusMap[s] || 0) + 1;
    if (lead.contact_email) withEmail++;
  }

  return {
    totalLeads: leads.length,
    newLeads: statusMap.new || 0,
    enrichedLeads: statusMap.enriched || 0,
    contactedLeads: statusMap.contacted || 0,
    respondedLeads: statusMap.responded || 0,
    meetingLeads: statusMap.meeting || 0,
    qualifiedLeads: statusMap.qualified || 0,
    totalEmailsSent: statusMap.contacted || 0,
    totalResponded: statusMap.responded || 0,
    responseRate: (statusMap.contacted > 0) ? Math.round(((statusMap.responded || 0) / statusMap.contacted) * 1000) / 10 : 0,
    pendingDrafts: 0,
    sentToday: 0,
    withEmail,
    by_status: statusMap,
  };
}
