/**
 * Gmail Re-Auth Script
 *
 * Generates a new refresh token with gmail.send + gmail.modify scopes.
 * Run locally: node scripts/gmail-reauth.mjs
 * Then copy the new GMAIL_REFRESH_TOKEN to the VPS .env file.
 */

import { google } from 'googleapis';
import http from 'http';

const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET env vars first');
  process.exit(1);
}
const REDIRECT_URI = 'http://localhost:8099';

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
];

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: SCOPES,
  prompt: 'consent',
});

console.log('\n📧 Gmail Re-Auth — coppice@zhan.capital');
console.log('========================================\n');
console.log('Open this URL in your browser (sign in as coppice@zhan.capital):\n');
console.log(authUrl);
console.log('\nWaiting for OAuth callback on http://localhost:8099...\n');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:8099`);
  const code = url.searchParams.get('code');

  if (!code) {
    res.writeHead(400);
    res.end('No code received');
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    console.log('✅ New tokens received!\n');
    console.log('GMAIL_REFRESH_TOKEN=' + tokens.refresh_token);
    console.log('\nCopy the line above to your VPS .env file.');

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h1>Success!</h1><p>You can close this tab. Check your terminal for the new refresh token.</p>');

    setTimeout(() => process.exit(0), 1000);
  } catch (err) {
    console.error('Error:', err.message);
    res.writeHead(500);
    res.end('Error: ' + err.message);
  }
});

server.listen(8099);
