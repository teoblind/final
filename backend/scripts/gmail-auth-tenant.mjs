/**
 * Multi-Tenant Gmail OAuth Script
 *
 * Generates a refresh token for a tenant-specific Gmail account.
 *
 * Usage:
 *   node scripts/gmail-auth-tenant.mjs --account agent@sangha.coppice.ai
 *
 * Uses OAuth app credentials from ~/Charger-Bot/credentials.json.
 * Saves token to ~/gmail_token_<slug>.json (e.g. ~/gmail_token_sangha.json).
 */

import { google } from 'googleapis';
import http from 'http';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// Parse --account flag
const accountIdx = process.argv.indexOf('--account');
if (accountIdx === -1 || !process.argv[accountIdx + 1]) {
  console.error('Usage: node scripts/gmail-auth-tenant.mjs --account <email>');
  console.error('Example: node scripts/gmail-auth-tenant.mjs --account agent@sangha.coppice.ai');
  process.exit(1);
}
const account = process.argv[accountIdx + 1];

// Derive slug from email for output filename
const slug = account.split('@')[0].replace(/[^a-z0-9]/gi, '_');
const outputPath = join(homedir(), `gmail_token_${slug}.json`);

// Load OAuth app credentials
const credPath = join(homedir(), 'Charger-Bot/credentials.json');
let creds;
try {
  const raw = JSON.parse(readFileSync(credPath, 'utf-8'));
  creds = raw.installed || raw.web;
} catch (err) {
  console.error(`Failed to read credentials from ${credPath}:`, err.message);
  process.exit(1);
}

const REDIRECT_URI = 'http://localhost:8099';
const oauth2Client = new google.auth.OAuth2(creds.client_id, creds.client_secret, REDIRECT_URI);

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
];

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: SCOPES,
  prompt: 'consent',
  login_hint: account,
});

console.log(`\nGmail Tenant Auth — ${account}`);
console.log('='.repeat(50) + '\n');
console.log('Open this URL in your browser:\n');
console.log(authUrl);
console.log(`\nSign in as: ${account}`);
console.log('Waiting for OAuth callback on http://localhost:8099...\n');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:8099');
  const code = url.searchParams.get('code');

  if (!code) {
    res.writeHead(400);
    res.end('No code received');
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);

    // Save full token to file
    writeFileSync(outputPath, JSON.stringify(tokens, null, 2));

    console.log('Token saved to:', outputPath);
    console.log('\nRefresh token:', tokens.refresh_token);
    console.log('\nNext step: run the seed script to insert this into the database:');
    console.log(`  node scripts/seed-sangha-email.mjs`);

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<h1>Success!</h1><p>Token saved to ${outputPath}. You can close this tab.</p>`);

    setTimeout(() => process.exit(0), 1000);
  } catch (err) {
    console.error('Error:', err.message);
    res.writeHead(500);
    res.end('Error: ' + err.message);
  }
});

server.listen(8099);
