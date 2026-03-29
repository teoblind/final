#!/usr/bin/env node
/**
 * MCP Bridge Server — Exposes Coppice backend tools to Claude Code CLI
 *
 * This is a stdio-based MCP server that:
 * 1. Fetches available tools from the backend's /api/v1/internal/tools endpoint
 * 2. Translates MCP tool calls into HTTP requests to /api/v1/internal/tool
 * 3. Returns results back via MCP protocol
 *
 * Spawned by Claude CLI on Mac via SSH:
 *   ssh root@vps "node /root/coppice/backend/src/mcp-bridge.js"
 *
 * The CLI's .mcp.json configures this as an MCP server, so `claude -p` can
 * call tools like `mcp__coppice-tools__workspace_create_sheet`.
 *
 * Environment:
 *   MCP_BRIDGE_PORT - Backend port (default: 3002)
 *   MCP_BRIDGE_TENANT - Default tenant ID (default: from CLI args or 'default')
 */

const BACKEND_PORT = process.env.MCP_BRIDGE_PORT || 3002;
const BASE_URL = `http://127.0.0.1:${BACKEND_PORT}/api/v1/internal`;

// Parse tenant from CLI args: node mcp-bridge.js --tenant=dacp-construction-001
const tenantArg = process.argv.find(a => a.startsWith('--tenant='));
const DEFAULT_TENANT = tenantArg ? tenantArg.split('=')[1] : (process.env.MCP_BRIDGE_TENANT || 'default');

// ─── MCP Protocol (JSON-RPC over stdio with Content-Length framing) ─────────

let cachedTools = null;

async function fetchTools() {
  if (cachedTools) return cachedTools;
  try {
    const res = await fetch(`${BASE_URL}/tools`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    cachedTools = (data.tools || []).map(t => ({
      name: t.name,
      description: t.description || '',
      inputSchema: t.input_schema || { type: 'object', properties: {} },
    }));
    return cachedTools;
  } catch (err) {
    process.stderr.write(`[MCP Bridge] Failed to fetch tools: ${err.message}\n`);
    return [];
  }
}

async function callTool(toolName, toolInput) {
  try {
    // Allow tool input to override tenant (Claude agent passes this in system prompt context)
    const tenantId = toolInput?._tenant_id || DEFAULT_TENANT;
    const cleanInput = { ...toolInput };
    delete cleanInput._tenant_id; // Don't pass meta-field to actual tool

    const res = await fetch(`${BASE_URL}/tool`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toolName,
        toolInput: cleanInput,
        tenantId,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) {
      return { isError: true, content: [{ type: 'text', text: `Error: ${data.error}` }] };
    }
    const text = typeof data.result === 'string' ? data.result : JSON.stringify(data.result, null, 2);
    return { content: [{ type: 'text', text }] };
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: `MCP Bridge error: ${err.message}` }] };
  }
}

// ─── JSON-RPC Message Handling ──────────────────────────────────────────────

async function handleMessage(msg) {
  const { id, method, params } = msg;

  switch (method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'coppice-tools', version: '1.0.0' },
        },
      };

    case 'notifications/initialized':
      // No response needed for notifications
      return null;

    case 'tools/list': {
      const tools = await fetchTools();
      return {
        jsonrpc: '2.0',
        id,
        result: { tools },
      };
    }

    case 'tools/call': {
      const { name, arguments: args } = params || {};
      process.stderr.write(`[MCP Bridge] Calling tool: ${name}\n`);
      const result = await callTool(name, args);
      return {
        jsonrpc: '2.0',
        id,
        result,
      };
    }

    default:
      if (method?.startsWith('notifications/')) return null; // ignore notifications
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      };
  }
}

// ─── Content-Length Framed stdio Transport ───────────────────────────────────

function sendMessage(msg) {
  const json = JSON.stringify(msg);
  const header = `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n`;
  process.stdout.write(header + json);
}

let inputBuffer = '';

function processInput() {
  while (true) {
    // Look for Content-Length header
    const headerEnd = inputBuffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) break;

    const header = inputBuffer.slice(0, headerEnd);
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      // Skip malformed header
      inputBuffer = inputBuffer.slice(headerEnd + 4);
      continue;
    }

    const contentLength = parseInt(match[1], 10);
    const bodyStart = headerEnd + 4;

    if (inputBuffer.length < bodyStart + contentLength) break; // Need more data

    const body = inputBuffer.slice(bodyStart, bodyStart + contentLength);
    inputBuffer = inputBuffer.slice(bodyStart + contentLength);

    try {
      const msg = JSON.parse(body);
      pendingRequests++;
      handleMessage(msg).then(response => {
        if (response) sendMessage(response);
      }).catch(err => {
        process.stderr.write(`[MCP Bridge] Error: ${err.message}\n`);
        if (msg.id) {
          sendMessage({
            jsonrpc: '2.0',
            id: msg.id,
            error: { code: -32603, message: err.message },
          });
        }
      }).finally(() => {
        pendingRequests--;
        if (stdinEnded && pendingRequests <= 0) process.exit(0);
      });
    } catch (err) {
      process.stderr.write(`[MCP Bridge] Parse error: ${err.message}\n`);
    }
  }
}

let pendingRequests = 0;

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  inputBuffer += chunk;
  processInput();
});

let stdinEnded = false;
process.stdin.on('end', () => {
  stdinEnded = true;
  // Wait for pending async requests to complete before exiting
  if (pendingRequests <= 0) process.exit(0);
});

process.stderr.write(`[MCP Bridge] Started (tenant: ${DEFAULT_TENANT}, backend: ${BASE_URL})\n`);
