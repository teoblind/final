/**
 * Debug script: test polling the Sangha agent inbox
 */
import { google } from 'googleapis';
import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const db = new Database(join(__dirname, '../data/cache.db'));

const rows = db.prepare('SELECT * FROM tenant_email_config').all();
console.log('Tenant configs:', rows.length);

const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;

// Test default inbox
const defaultToken = process.env.GMAIL_REFRESH_TOKEN;
if (defaultToken) {
  console.log('\n--- Default inbox (agent@zhan.coppice.ai) ---');
  const client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, 'http://localhost:8099');
  client.setCredentials({ refresh_token: defaultToken });
  const gmail = google.gmail({ version: 'v1', auth: client });
  try {
    const res = await gmail.users.messages.list({ userId: 'me', q: 'is:unread newer_than:1h -from:me', maxResults: 5 });
    console.log('Unread messages:', res.data.messages?.length || 0);
  } catch (err) {
    console.error('Error:', err.message);
  }
}

// Test tenant inboxes
for (const row of rows) {
  console.log(`\n--- Tenant inbox: ${row.sender_email} (${row.tenant_id}) ---`);
  const client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, 'http://localhost:8099');
  client.setCredentials({ refresh_token: row.gmail_refresh_token });
  const gmail = google.gmail({ version: 'v1', auth: client });
  try {
    const res = await gmail.users.messages.list({ userId: 'me', q: 'is:unread newer_than:1h -from:me', maxResults: 5 });
    const messages = res.data.messages || [];
    console.log('Unread messages:', messages.length);
    for (const m of messages) {
      const full = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'metadata', metadataHeaders: ['From', 'Subject'] });
      const headers = full.data.payload?.headers || [];
      const from = headers.find(h => h.name === 'From')?.value;
      const subject = headers.find(h => h.name === 'Subject')?.value;
      console.log(` - From: ${from}`);
      console.log(`   Subject: ${subject}`);
    }
  } catch (err) {
    console.error('Error:', err.message);
  }
}
