/**
 * Seed Sangha Email Config
 *
 * Reads the refresh token from ~/gmail_token_sangha.json (or ~/gmail_token_agent.json)
 * and inserts it into the tenant_email_config table for the default (Sangha) tenant.
 *
 * Usage:
 *   node scripts/seed-sangha-email.mjs
 *   node scripts/seed-sangha-email.mjs --token-file ~/gmail_token_agent.json
 */

import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Parse optional --token-file flag
const tokenFlagIdx = process.argv.indexOf('--token-file');
const tokenPath = tokenFlagIdx !== -1 && process.argv[tokenFlagIdx + 1]
  ? process.argv[tokenFlagIdx + 1]
  : join(homedir(), 'gmail_token_sangha.json');

// Read token file
let tokenData;
try {
  tokenData = JSON.parse(readFileSync(tokenPath, 'utf-8'));
} catch (err) {
  console.error(`Failed to read token file: ${tokenPath}`);
  console.error(err.message);
  console.error('\nRun the OAuth flow first:');
  console.error('  node scripts/gmail-auth-tenant.mjs --account agent@sangha.coppice.ai');
  process.exit(1);
}

const refreshToken = tokenData.refresh_token;
if (!refreshToken) {
  console.error('No refresh_token found in token file');
  process.exit(1);
}

// Open database
const dbPath = join(__dirname, '../data/cache.db');
const db = new Database(dbPath);

// Ensure table exists
db.exec(`
  CREATE TABLE IF NOT EXISTS tenant_email_config (
    tenant_id TEXT PRIMARY KEY,
    sender_email TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    gmail_refresh_token TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Upsert config
db.prepare(`
  INSERT INTO tenant_email_config (tenant_id, sender_email, sender_name, gmail_refresh_token, updated_at)
  VALUES (?, ?, ?, ?, datetime('now'))
  ON CONFLICT(tenant_id) DO UPDATE SET
    sender_email = excluded.sender_email,
    sender_name = excluded.sender_name,
    gmail_refresh_token = excluded.gmail_refresh_token,
    updated_at = datetime('now')
`).run('default', 'agent@sangha.coppice.ai', 'Sangha Agent', refreshToken);

console.log('Sangha email config inserted:');
console.log('  Tenant:  default (Sangha Renewables)');
console.log('  Sender:  Sangha Agent <agent@sangha.coppice.ai>');
console.log('  Token:   ' + refreshToken.slice(0, 20) + '...');
console.log('\nRestart the server to pick up the new config.');
