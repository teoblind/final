#!/usr/bin/env node
/**
 * Export Lead Pipeline to Google Sheets
 *
 * Creates two Google Spreadsheets (Sangha + DACP) with Leads + Contacts sheets,
 * shares with stakeholders, and registers in tenant_files for dashboard access.
 */

import 'dotenv/config';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { google } from 'googleapis';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DB_PATH = join(__dirname, '../data/cache.db');
const db = new Database(DB_PATH);

// OAuth token path — coppice@zhan.capital
const TOKEN_PATH = join(os.homedir(), 'MeetingBot/calendar_token.json');
const CREDS_PATH = join(os.homedir(), 'Charger-Bot/credentials.json');

const TENANTS = [
  {
    id: 'default',
    label: 'Sangha',
    sheetTitle: 'Sangha Lead Pipeline',
    headerColor: { red: 0.1, green: 0.42, blue: 0.24 }, // #1a6b3c
    shareWith: [
      { email: 'teo@zhan.capital', role: 'writer' },
      { email: 'spencer@sanghasystems.com', role: 'reader' },
    ],
    fileCategory: 'Leads',
  },
  {
    id: 'dacp-construction-001',
    label: 'DACP',
    sheetTitle: 'DACP Lead Pipeline',
    headerColor: { red: 0.15, green: 0.39, blue: 0.93 }, // #2563eb
    shareWith: [
      { email: 'teo@zhan.capital', role: 'writer' },
      { email: 'Mpineda@dacpholdings.com', role: 'reader' },
    ],
    fileCategory: 'Leads',
  },
];

async function getAuthClient() {
  const creds = JSON.parse(fs.readFileSync(CREDS_PATH, 'utf-8'));
  const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
  const { client_id, client_secret } = creds.installed || creds.web;
  const oauth2 = new google.auth.OAuth2(client_id, client_secret, 'urn:ietf:wg:oauth:2.0:oob');
  oauth2.setCredentials(token);
  return oauth2;
}

function getLeads(tenantId) {
  return db.prepare('SELECT * FROM le_leads WHERE tenant_id = ? ORDER BY priority_score DESC').all(tenantId);
}

function getContacts(tenantId) {
  return db.prepare(`
    SELECT c.*, l.venue_name
    FROM le_contacts c
    JOIN le_leads l ON c.lead_id = l.id AND c.tenant_id = l.tenant_id
    WHERE c.tenant_id = ?
    ORDER BY l.priority_score DESC
  `).all(tenantId);
}

async function createSheet(auth, tenant) {
  const sheets = google.sheets({ version: 'v4', auth });
  const drive = google.drive({ version: 'v3', auth });

  const leads = getLeads(tenant.id);
  const contacts = getContacts(tenant.id);

  console.log(`  ${tenant.label}: ${leads.length} leads, ${contacts.length} contacts`);

  if (leads.length === 0) {
    console.log(`  Skipping ${tenant.label} — no leads found`);
    return null;
  }

  // Create spreadsheet with two sheets
  const spreadsheet = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: tenant.sheetTitle },
      sheets: [
        { properties: { title: 'Leads', sheetId: 0 } },
        { properties: { title: 'Contacts', sheetId: 1 } },
      ],
    },
  });

  const spreadsheetId = spreadsheet.data.spreadsheetId;
  const spreadsheetUrl = spreadsheet.data.spreadsheetUrl;
  console.log(`  Created: ${spreadsheetUrl}`);

  // Populate Leads sheet
  const leadHeaders = ['Company', 'Region', 'Industry', 'Priority', 'Status', 'Trigger News', 'Website', 'Discovered'];
  const leadRows = leads.map(l => [
    l.venue_name || '',
    l.region || '',
    l.industry || '',
    l.priority_score || 0,
    l.status || 'new',
    l.trigger_news || '',
    l.website || '',
    l.discovered_at ? l.discovered_at.slice(0, 10) : '',
  ]);

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'Leads!A1',
    valueInputOption: 'RAW',
    requestBody: { values: [leadHeaders, ...leadRows] },
  });

  // Populate Contacts sheet
  const contactHeaders = ['Company', 'Name', 'Title', 'Email', 'Phone', 'Source', 'Verified'];
  const contactRows = contacts.map(c => [
    c.venue_name || '',
    c.name || '',
    c.title || '',
    c.email || '',
    c.phone || '',
    c.source || '',
    c.mx_valid ? 'Yes' : 'No',
  ]);

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'Contacts!A1',
    valueInputOption: 'RAW',
    requestBody: { values: [contactHeaders, ...contactRows] },
  });

  // Style headers: bold, white text, colored background, freeze row 1
  const { red, green: g, blue } = tenant.headerColor;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        // Leads header style
        {
          repeatCell: {
            range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red, green: g, blue },
                textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
              },
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat)',
          },
        },
        // Contacts header style
        {
          repeatCell: {
            range: { sheetId: 1, startRowIndex: 0, endRowIndex: 1 },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red, green: g, blue },
                textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
              },
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat)',
          },
        },
        // Freeze header rows
        { updateSheetProperties: { properties: { sheetId: 0, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
        { updateSheetProperties: { properties: { sheetId: 1, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
        // Auto-resize columns
        { autoResizeDimensions: { dimensions: { sheetId: 0, dimension: 'COLUMNS', startIndex: 0, endIndex: 8 } } },
        { autoResizeDimensions: { dimensions: { sheetId: 1, dimension: 'COLUMNS', startIndex: 0, endIndex: 7 } } },
      ],
    },
  });

  // Share with stakeholders
  for (const share of tenant.shareWith) {
    try {
      await drive.permissions.create({
        fileId: spreadsheetId,
        requestBody: { type: 'user', role: share.role, emailAddress: share.email },
        sendNotificationEmail: false,
      });
      console.log(`  Shared with ${share.email} (${share.role})`);
    } catch (err) {
      console.error(`  Failed to share with ${share.email}:`, err.message);
    }
  }

  // Register in tenant_files
  const fileId = `tf-${tenant.id === 'default' ? 'sangha' : 'dacp'}-leads-sheet`;
  db.prepare(`
    INSERT OR REPLACE INTO tenant_files (id, tenant_id, name, category, file_type, size_bytes, modified_at, drive_file_id, drive_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    fileId,
    tenant.id,
    tenant.sheetTitle,
    tenant.fileCategory,
    'google_sheet',
    0,
    new Date().toISOString(),
    spreadsheetId,
    spreadsheetUrl
  );
  console.log(`  Registered in tenant_files: ${fileId}`);

  return { spreadsheetId, spreadsheetUrl };
}

async function main() {
  console.log('Export Leads to Google Sheets');
  console.log('============================\n');

  const auth = await getAuthClient();

  for (const tenant of TENANTS) {
    console.log(`\nProcessing ${tenant.label}...`);
    try {
      const result = await createSheet(auth, tenant);
      if (result) {
        console.log(`  Done: ${result.spreadsheetUrl}\n`);
      }
    } catch (err) {
      console.error(`  Error for ${tenant.label}:`, err.message);
    }
  }

  console.log('\nAll done.');
  db.close();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
