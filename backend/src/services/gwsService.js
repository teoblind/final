/**
 * Google Workspace CLI (gws) Service - Tenant-Aware
 *
 * Thin wrapper around `gws` CLI for Hivemind agent tools.
 * Each call uses the correct tenant's OAuth token from tenant_email_config.
 *
 * How it works:
 *   1. Look up the tenant's refresh token from their SQLite DB
 *   2. Write a temp credentials file for that tenant
 *   3. Spawn gws with HOME pointed at the temp dir (so gws reads the right creds)
 *   4. Parse and return JSON
 *
 * This ensures DACP queries only see DACP's inbox/drive/calendar,
 * Sangha queries only see Sangha's, etc.
 *
 * NOTE: This is for interactive agent queries only.
 * Production email/calendar polling stays on the googleapis SDK.
 */

import { spawn } from 'child_process';
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { getTenantDb, getKeyVaultValue } from '../cache/database.js';

const GWS_BIN = process.env.GWS_BIN || 'gws';
const GWS_TIMEOUT_MS = 30_000;

// Cache tenant config dirs to avoid rewriting files every call
const tenantConfigCache = new Map();

/**
 * Get or create a gws config directory for a specific tenant.
 * Writes the tenant's OAuth credentials so gws authenticates as the right agent.
 */
function getTenantGwsConfig(tenantId) {
  const resolvedTenant = tenantId || 'default';
  let refreshToken = process.env.GMAIL_REFRESH_TOKEN; // fallback
  let clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.GMAIL_CLIENT_ID;
  let clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.env.GMAIL_CLIENT_SECRET;

  // Check key_vault first (where Google integration flow stores tokens)
  try {
    const kvToken = getKeyVaultValue(resolvedTenant, 'google-docs', 'refresh_token');
    if (kvToken) refreshToken = kvToken;
  } catch {
    // key_vault may not exist or have no entry
  }

  // Fall back to tenant_email_config
  if (!refreshToken || refreshToken === process.env.GMAIL_REFRESH_TOKEN) {
    try {
      const tdb = getTenantDb(resolvedTenant);
      const row = tdb.prepare('SELECT gmail_refresh_token FROM tenant_email_config WHERE tenant_id = ? LIMIT 1').get(resolvedTenant);
      if (row?.gmail_refresh_token) refreshToken = row.gmail_refresh_token;
    } catch {
      // tenant_email_config may not exist - use fallback
    }
  }

  if (!refreshToken || !clientId || !clientSecret) {
    throw new Error(`No OAuth credentials available for tenant "${resolvedTenant}"`);
  }

  // Create a tenant-specific config dir under /tmp
  const configDir = join(tmpdir(), `gws-tenant-${resolvedTenant}`);
  const gwsDir = join(configDir, '.config', 'gws');

  if (!existsSync(gwsDir)) {
    mkdirSync(gwsDir, { recursive: true });
  }

  // Write credentials (always overwrite in case token was rotated)
  writeFileSync(join(gwsDir, 'credentials.json'), JSON.stringify({
    type: 'authorized_user',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  }));

  // Write minimal client_secret.json (gws warns but works without project_id)
  if (!existsSync(join(gwsDir, 'client_secret.json'))) {
    writeFileSync(join(gwsDir, 'client_secret.json'), JSON.stringify({
      installed: {
        client_id: clientId,
        client_secret: clientSecret,
        auth_uri: 'https://accounts.google.com/o/oauth2/auth',
        token_uri: 'https://oauth2.googleapis.com/token',
        redirect_uris: ['http://localhost'],
      },
    }));
  }

  return configDir;
}

/**
 * Execute a gws CLI command for a specific tenant.
 *
 * @param {string[]} args - CLI arguments
 * @param {string} [tenantId] - tenant ID for credential lookup
 * @returns {Promise<object>} parsed JSON response
 */
export async function execGws(args, tenantId = null) {
  const configDir = getTenantGwsConfig(tenantId);

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';

    const proc = spawn(GWS_BIN, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: GWS_TIMEOUT_MS,
      env: {
        ...process.env,
        HOME: configDir, // gws reads ~/.config/gws/credentials.json
      },
    });

    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`gws timed out after ${GWS_TIMEOUT_MS / 1000}s: ${args.join(' ')}`));
    }, GWS_TIMEOUT_MS);

    proc.on('close', (code) => {
      clearTimeout(timer);

      // Filter out "Using keyring backend" noise from stderr
      const cleanStderr = stderr
        .split('\n')
        .filter(l => !l.startsWith('Using keyring backend'))
        .join('\n')
        .trim();

      if (code !== 0) {
        // Try to parse error JSON from stdout
        try {
          const errObj = JSON.parse(stdout);
          if (errObj.error) {
            reject(new Error(`gws error: ${errObj.error.message || JSON.stringify(errObj.error)}`));
            return;
          }
        } catch {}
        reject(new Error(`gws exited with code ${code}: ${cleanStderr || stdout}`));
        return;
      }

      try {
        const parsed = JSON.parse(stdout);
        resolve(parsed);
      } catch {
        // Some commands return non-JSON (e.g. success messages)
        resolve({ raw: stdout.trim() });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to spawn gws: ${err.message}`));
    });
  });
}

// ─── High-level helpers used by chatService tool handlers ─────────────────
// All helpers now accept tenantId for tenant isolation.

export async function gmailSearch(query, maxResults = 10, tenantId = null) {
  const params = { userId: 'me', q: query, maxResults };
  const list = await execGws(['gmail', 'users', 'messages', 'list', '--params', JSON.stringify(params)], tenantId);

  if (!list.messages || list.messages.length === 0) {
    return { messages: [], total: 0 };
  }

  // Fetch snippets for each message
  const results = [];
  for (const msg of list.messages.slice(0, maxResults)) {
    try {
      const full = await execGws([
        'gmail', 'users', 'messages', 'get',
        '--params', JSON.stringify({ userId: 'me', id: msg.id, format: 'metadata', metadataHeaders: ['From', 'To', 'Subject', 'Date'] }),
      ], tenantId);
      const headers = full.payload?.headers || [];
      results.push({
        id: msg.id,
        threadId: msg.threadId,
        from: headers.find(h => h.name === 'From')?.value,
        to: headers.find(h => h.name === 'To')?.value,
        subject: headers.find(h => h.name === 'Subject')?.value,
        date: headers.find(h => h.name === 'Date')?.value,
        snippet: full.snippet,
      });
    } catch {
      results.push({ id: msg.id, threadId: msg.threadId, error: 'Failed to fetch details' });
    }
  }

  return { messages: results, total: list.resultSizeEstimate || results.length };
}

export async function gmailRead(messageId, tenantId = null) {
  const full = await execGws([
    'gmail', 'users', 'messages', 'get',
    '--params', JSON.stringify({ userId: 'me', id: messageId, format: 'full' }),
  ], tenantId);

  const headers = full.payload?.headers || [];
  let body = '';

  // Extract plain text body
  const parts = full.payload?.parts || [];
  if (parts.length > 0) {
    const textPart = parts.find(p => p.mimeType === 'text/plain');
    if (textPart?.body?.data) {
      body = Buffer.from(textPart.body.data, 'base64url').toString('utf-8');
    }
  } else if (full.payload?.body?.data) {
    body = Buffer.from(full.payload.body.data, 'base64url').toString('utf-8');
  }

  return {
    id: full.id,
    threadId: full.threadId,
    from: headers.find(h => h.name === 'From')?.value,
    to: headers.find(h => h.name === 'To')?.value,
    cc: headers.find(h => h.name === 'Cc')?.value,
    subject: headers.find(h => h.name === 'Subject')?.value,
    date: headers.find(h => h.name === 'Date')?.value,
    body,
    snippet: full.snippet,
    labelIds: full.labelIds,
  };
}

export async function calendarListEvents(calendarId = 'primary', maxResults = 10, timeMin = null, tenantId = null) {
  const params = {
    calendarId,
    maxResults,
    singleEvents: true,
    orderBy: 'startTime',
  };
  if (timeMin) params.timeMin = timeMin;
  else params.timeMin = new Date().toISOString();

  const result = await execGws(['calendar', 'events', 'list', '--params', JSON.stringify(params)], tenantId);

  return (result.items || []).map(e => ({
    id: e.id,
    summary: e.summary,
    start: e.start?.dateTime || e.start?.date,
    end: e.end?.dateTime || e.end?.date,
    location: e.location,
    attendees: (e.attendees || []).map(a => a.email),
    meetLink: e.hangoutLink || e.conferenceData?.entryPoints?.find(ep => ep.entryPointType === 'video')?.uri,
    status: e.status,
  }));
}

export async function driveSearch(query, maxResults = 10, tenantId = null) {
  const params = { q: query, pageSize: maxResults, fields: 'files(id,name,mimeType,modifiedTime,webViewLink,size)' };
  const result = await execGws(['drive', 'files', 'list', '--params', JSON.stringify(params)], tenantId);
  return result.files || [];
}

export async function sheetsRead(spreadsheetId, range, tenantId = null) {
  const result = await execGws([
    'sheets', '+read',
    '--spreadsheet', spreadsheetId,
    '--range', range,
  ], tenantId);
  return { range: result.range, values: result.values || [] };
}

export async function sheetsAppend(spreadsheetId, range, values, tenantId = null) {
  const result = await execGws([
    'sheets', '+append',
    '--spreadsheet', spreadsheetId,
    '--range', range,
    '--json', JSON.stringify({ values }),
  ], tenantId);
  return result;
}
