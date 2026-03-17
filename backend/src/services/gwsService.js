/**
 * Google Workspace CLI (gws) Service
 *
 * Thin wrapper around `gws` CLI for Hivemind agent tools.
 * Spawns gws as a child process, returns parsed JSON output.
 *
 * Auth: gws uses credentials at ~/.config/gws/credentials.json
 * (configured during deploy with the default agent's refresh token).
 *
 * NOTE: This is for interactive agent queries only.
 * Production email/calendar polling stays on the googleapis SDK.
 */

import { spawn } from 'child_process';

const GWS_BIN = process.env.GWS_BIN || 'gws';
const GWS_TIMEOUT_MS = 30_000;

/**
 * Execute a gws CLI command and return parsed JSON.
 *
 * @param {string[]} args — CLI arguments, e.g. ['gmail', 'users', 'messages', 'list', '--params', '{"userId":"me"}']
 * @returns {Promise<object>} parsed JSON response
 */
export async function execGws(args) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';

    const proc = spawn(GWS_BIN, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: GWS_TIMEOUT_MS,
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

export async function gmailSearch(query, maxResults = 10) {
  const params = { userId: 'me', q: query, maxResults };
  const list = await execGws(['gmail', 'users', 'messages', 'list', '--params', JSON.stringify(params)]);

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
      ]);
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

export async function gmailRead(messageId) {
  const full = await execGws([
    'gmail', 'users', 'messages', 'get',
    '--params', JSON.stringify({ userId: 'me', id: messageId, format: 'full' }),
  ]);

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

export async function calendarListEvents(calendarId = 'primary', maxResults = 10, timeMin = null) {
  const params = {
    calendarId,
    maxResults,
    singleEvents: true,
    orderBy: 'startTime',
  };
  if (timeMin) params.timeMin = timeMin;
  else params.timeMin = new Date().toISOString();

  const result = await execGws(['calendar', 'events', 'list', '--params', JSON.stringify(params)]);

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

export async function driveSearch(query, maxResults = 10) {
  const params = { q: query, pageSize: maxResults, fields: 'files(id,name,mimeType,modifiedTime,webViewLink,size)' };
  const result = await execGws(['drive', 'files', 'list', '--params', JSON.stringify(params)]);
  return result.files || [];
}

export async function sheetsRead(spreadsheetId, range) {
  const result = await execGws([
    'sheets', '+read',
    '--spreadsheet', spreadsheetId,
    '--range', range,
  ]);
  return { range: result.range, values: result.values || [] };
}

export async function sheetsAppend(spreadsheetId, range, values) {
  const result = await execGws([
    'sheets', '+append',
    '--spreadsheet', spreadsheetId,
    '--range', range,
    '--json', JSON.stringify({ values }),
  ]);
  return result;
}
