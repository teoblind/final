/**
 * Agent SDK Service - Routes queries through Claude Agent SDK subprocesses
 *
 * Instead of simulating Claude Code capabilities (tool loops, MCP, sandbox),
 * this service spawns real Claude Agent SDK instances per query. Each instance
 * gets an in-process MCP server that bridges all existing Coppice tools.
 *
 * Architecture:
 *   Frontend → SSE stream → agentSdkService.chatStreamSdk()
 *     → SDK query() with in-process MCP server
 *       → MCP tool calls → routeToolCall() (existing tool handlers)
 *     → SDK messages → SSE events to frontend
 */

import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import {
  getCurrentTenantId,
  getTenantDb,
  getAgentMode,
  insertActivity,
  saveThreadSummary,
  insertAgentRun,
  insertApprovalItem,
  SANGHA_TENANT_ID,
} from '../cache/database.js';
import { saveMessage, getThreadMessages } from './chatService.js';

// Lazy DB accessor - mirrors chatService.js pattern
const db = new Proxy({}, {
  get(target, prop) {
    const tenantId = getCurrentTenantId() || SANGHA_TENANT_ID;
    const realDb = getTenantDb(tenantId);
    const val = realDb[prop];
    if (typeof val === 'function') return val.bind(realDb);
    return val;
  },
});

const MAX_HISTORY = 50;

// ─── Tool Definitions ───────────────────────────────────────────────────────
// Each tool() call creates an MCP-compatible tool that bridges to the existing
// routeToolCall() dispatcher. We define the Zod schemas to match the existing
// Anthropic input_schema definitions.

/**
 * Dynamically import routeToolCall from chatService to avoid circular deps.
 * We lazy-load it on first tool call.
 */
let _routeToolCall = null;
async function getRouteToolCall() {
  if (!_routeToolCall) {
    // routeToolCall isn't exported - we'll import the tool handler functions directly
    const mod = await import('./chatService.js');
    _routeToolCall = mod.routeToolCall;
  }
  return _routeToolCall;
}

// ─── Tool Schema Builders ────────────────────────────────────────────────────
// Convert Anthropic JSON Schema tool definitions to Zod schemas for the SDK.
// This is a generic converter so we don't have to hand-write 70+ Zod schemas.

function jsonSchemaToZod(schema) {
  if (!schema || typeof schema !== 'object') return z.any();

  switch (schema.type) {
    case 'string':
      if (schema.enum) return z.enum(schema.enum);
      return z.string().describe(schema.description || '');
    case 'number':
    case 'integer':
      return z.number().describe(schema.description || '');
    case 'boolean':
      return z.boolean().describe(schema.description || '');
    case 'array':
      return z.array(schema.items ? jsonSchemaToZod(schema.items) : z.any()).describe(schema.description || '');
    case 'object': {
      if (!schema.properties) return z.record(z.any()).describe(schema.description || '');
      const shape = {};
      const required = new Set(schema.required || []);
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        const zodProp = jsonSchemaToZod(propSchema);
        shape[key] = required.has(key) ? zodProp : zodProp.optional();
      }
      return z.object(shape).describe(schema.description || '');
    }
    default:
      return z.any();
  }
}

/**
 * Convert an Anthropic tool definition to an SDK MCP tool.
 * @param {Object} anthropicTool - { name, description, input_schema }
 * @param {string} tenantId - Tenant context for tool execution
 * @returns {SdkMcpToolDefinition}
 */
function bridgeTool(anthropicTool, tenantId) {
  const zodSchema = jsonSchemaToZod(anthropicTool.input_schema);

  // Determine if this is a read-only tool for annotations
  const SAFE_TOOL_NAMES = new Set([
    'search_knowledge', 'get_leads', 'get_lead_stats', 'list_emails', 'read_email',
    'browse_url', 'web_research', 'get_outreach_log', 'get_reply_inbox', 'get_followup_queue',
    'get_discovery_config', 'list_trusted_senders', 'search_hubspot_contacts',
    'search_hubspot_companies', 'search_hubspot_deals', 'get_hubspot_pipeline',
    'lookup_pricing', 'get_bid_requests', 'get_estimates', 'get_jobs', 'get_dacp_stats',
    'analyze_itb', 'compare_contract', 'run_bid_checks', 'parse_supplier_quote',
    'gws_gmail_search', 'gws_gmail_read', 'gws_calendar_events', 'gws_drive_search',
    'gws_sheets_read', 'list_scheduled_tasks', 'workspace_search_drive',
    'workspace_read_file', 'workspace_export_pdf', 'plan_content',
  ]);

  const isReadOnly = SAFE_TOOL_NAMES.has(anthropicTool.name);

  return tool(
    anthropicTool.name,
    anthropicTool.description,
    zodSchema,
    async (args) => {
      const routeToolCall = await getRouteToolCall();
      try {
        const result = await routeToolCall(anthropicTool.name, args, tenantId);
        return {
          content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error: ${err.message}` }],
          isError: true,
        };
      }
    },
    {
      annotations: {
        readOnlyHint: isReadOnly,
        destructiveHint: !isReadOnly,
        openWorldHint: anthropicTool.name.startsWith('browse_') || anthropicTool.name.startsWith('web_'),
      },
    },
  );
}

// ─── Tool Selection (mirrors chatService.js agent→tool mapping) ──────────────

/**
 * Get the list of Anthropic tool definitions for a given agent.
 * Dynamically imports from chatService to get the tool arrays.
 */
async function getToolsForAgent(agentId) {
  const mod = await import('./chatService.js');
  // chatService exports the tool arrays
  const tools = [...(mod.WORKSPACE_TOOLS || [])];

  const leAgents = ['sangha', 'hivemind', 'email', 'lead-engine', 'zhan'];
  if (leAgents.includes(agentId) && mod.LEAD_ENGINE_TOOLS) tools.push(...mod.LEAD_ENGINE_TOOLS);

  const knAgents = ['sangha', 'hivemind', 'curtailment', 'pools', 'zhan', 'estimating', 'workflow'];
  if (knAgents.includes(agentId) && mod.KNOWLEDGE_TOOLS) tools.push(...mod.KNOWLEDGE_TOOLS);

  const hsAgents = ['sangha', 'hivemind'];
  if (hsAgents.includes(agentId) && process.env.HUBSPOT_API_KEY && mod.HUBSPOT_TOOLS) tools.push(...mod.HUBSPOT_TOOLS);

  const miningAgents = ['sangha', 'curtailment'];
  if (miningAgents.includes(agentId) && mod.MINING_TOOLS) tools.push(...mod.MINING_TOOLS);

  const dacpAgents = ['hivemind', 'estimating', 'workflow'];
  if (dacpAgents.includes(agentId) && mod.DACP_TOOLS) tools.push(...mod.DACP_TOOLS);

  const emailAgents = ['sangha', 'hivemind', 'email', 'zhan', 'workflow', 'comms'];
  if (emailAgents.includes(agentId) && mod.EMAIL_TOOLS) tools.push(...mod.EMAIL_TOOLS);

  const esAgents = ['sangha', 'hivemind', 'zhan'];
  if (esAgents.includes(agentId) && mod.EMAIL_SECURITY_TOOLS) tools.push(...mod.EMAIL_SECURITY_TOOLS);

  if (mod.WEB_TOOLS) tools.push(...mod.WEB_TOOLS);

  const legalAgents = ['sangha', 'hivemind', 'documents', 'zhan'];
  if (legalAgents.includes(agentId) && mod.LEGAL_TOOLS) tools.push(...mod.LEGAL_TOOLS);

  const docAgents = ['sangha', 'hivemind', 'zhan', 'documents', 'email', 'workflow', 'comms'];
  if (docAgents.includes(agentId) && mod.DOCUMENT_TOOLS) tools.push(...mod.DOCUMENT_TOOLS);

  const calendarAgents = ['hivemind', 'sangha', 'zhan'];
  if (calendarAgents.includes(agentId) && mod.CALENDAR_TOOLS) tools.push(...mod.CALENDAR_TOOLS);

  const gwsAgents = ['hivemind', 'sangha', 'zhan', 'workflow', 'comms'];
  if (gwsAgents.includes(agentId) && mod.GWS_TOOLS) tools.push(...mod.GWS_TOOLS);

  const schedulerAgents = ['hivemind', 'workflow', 'comms', 'zhan', 'sangha'];
  if (schedulerAgents.includes(agentId) && mod.SCHEDULER_TOOLS) tools.push(...mod.SCHEDULER_TOOLS);

  const codeAgents = ['hivemind', 'sangha', 'zhan', 'workflow'];
  if (codeAgents.includes(agentId) && mod.CODE_EXECUTION_TOOLS) tools.push(...mod.CODE_EXECUTION_TOOLS);

  return tools;
}

// ─── System Prompt Builder ───────────────────────────────────────────────────

async function buildSystemPrompt(agentId, tenantId, displayContent, threadId, userId, options = {}) {
  const mod = await import('./chatService.js');

  const basePrompt = (mod.SYSTEM_PROMPTS || {})[agentId] || (mod.SYSTEM_PROMPTS || {}).sangha || '';

  const FORMATTING_RULES = `\n\n═══ FORMATTING RULES ═══\n- NEVER use emojis in your responses. No checkmarks, no icons, no unicode symbols. Keep it clean text only.\n- Use clean, minimal formatting. Short paragraphs, simple lists with dashes, no excessive headers.\n- Be concise and direct. No filler phrases like "Great question!" or "Absolutely!".\n- When presenting data, use clean tables or simple lists - no decorative formatting.`;

  const HELP_MODE_GUARD = options.helpMode
    ? `\n\nCRITICAL - HELP ASSISTANT MODE:\nYou are the Coppice Assistant, a product support chatbot embedded in the dashboard.\n- You MUST ONLY discuss this tenant's business, data, and tools. NEVER mention other companies, tenants, or people outside this organization.\n- Keep answers helpful, concise, and focused on the product features available in their dashboard.`
    : '';

  // Conditional prompt addons per agent
  const leAgents = ['sangha', 'hivemind', 'email', 'lead-engine', 'zhan'];
  const leadEngineAddon = leAgents.includes(agentId) ? (mod.LEAD_ENGINE_PROMPT_ADDON || '') : '';

  const hsAgents = ['sangha', 'hivemind'];
  const hubspotAddon = (hsAgents.includes(agentId) && process.env.HUBSPOT_API_KEY) ? (mod.HUBSPOT_PROMPT_ADDON || '') : '';

  const webAddon = mod.WEB_TOOLS_PROMPT_ADDON || '';

  const legalAgents = ['sangha', 'hivemind', 'documents', 'zhan'];
  const legalAddon = legalAgents.includes(agentId) ? (mod.LEGAL_TOOLS_PROMPT_ADDON || '') : '';

  const emailAgents = ['sangha', 'hivemind', 'email', 'zhan', 'workflow', 'comms'];
  const emailAddon = emailAgents.includes(agentId) ? (mod.getEmailPromptAddon?.(tenantId) || '') : '';

  const esAgents = ['sangha', 'hivemind', 'zhan'];
  const emailSecurityAddon = esAgents.includes(agentId) ? (mod.EMAIL_SECURITY_PROMPT_ADDON || '') : '';

  const docAgents = ['sangha', 'hivemind', 'zhan', 'documents', 'email', 'workflow', 'comms'];
  const documentAddon = docAgents.includes(agentId) ? (mod.DOCUMENT_TOOLS_PROMPT_ADDON || '') : '';

  const dacpPromptAgents = ['hivemind', 'estimating', 'workflow'];
  const dacpAddon = dacpPromptAgents.includes(agentId) ? (mod.DACP_TOOLS_PROMPT_ADDON || '') : '';

  const gwsAgents = ['hivemind', 'sangha', 'zhan', 'workflow', 'comms'];
  const gwsAddon = gwsAgents.includes(agentId) ? (mod.GWS_TOOLS_PROMPT_ADDON || '') : '';

  const schedulerAgents = ['hivemind', 'workflow', 'comms', 'zhan', 'sangha'];
  const schedulerAddon = schedulerAgents.includes(agentId) ? (mod.SCHEDULER_TOOLS_PROMPT_ADDON || '') : '';

  const codeAgents = ['hivemind', 'sangha', 'zhan', 'workflow'];
  const codeAddon = codeAgents.includes(agentId) ? (mod.CODE_EXECUTION_PROMPT_ADDON || '') : '';

  // Knowledge context
  const knowledgeContext = mod.buildKnowledgeContext?.(tenantId, displayContent) || '';

  // Sibling thread context
  let siblingContext = '';
  if (threadId) {
    try {
      const { getSiblingThreadSummaries } = await import('../cache/database.js');
      const siblings = getSiblingThreadSummaries(tenantId, agentId, threadId, userId, 5);
      if (siblings.length > 0) {
        siblingContext = '\n\n═══ CONTEXT FROM OTHER ACTIVE SESSIONS ═══\n';
        for (const s of siblings) {
          const age = Math.round((Date.now() - new Date(s.updated_at + 'Z').getTime()) / 60000);
          const ageLabel = age < 60 ? `${age}m ago` : age < 1440 ? `${Math.round(age / 60)}h ago` : `${Math.round(age / 1440)}d ago`;
          siblingContext += `\n- [${s.title || 'Untitled'}] (${ageLabel}): ${s.summary}`;
        }
      }
    } catch {}
  }

  const PROPRIETARY_GUARD = mod.PROPRIETARY_GUARD || '';

  return basePrompt + FORMATTING_RULES + PROPRIETARY_GUARD + HELP_MODE_GUARD
    + leadEngineAddon + hubspotAddon + webAddon + legalAddon + emailAddon
    + emailSecurityAddon + documentAddon + dacpAddon + gwsAddon + schedulerAddon
    + codeAddon + knowledgeContext + siblingContext;
}

// ─── Conversation History Loader ─────────────────────────────────────────────

function loadHistory(tenantId, agentId, userId, threadId) {
  const SQL_RECENT = `
    SELECT role, content FROM messages
    WHERE tenant_id = ? AND agent_id = ? AND user_id = ?
      AND (thread_id = ? OR (thread_id IS NULL AND ? IS NULL))
    ORDER BY created_at DESC LIMIT ?
  `;
  const rows = db.prepare(SQL_RECENT).all(tenantId, agentId, userId, threadId, threadId, MAX_HISTORY);
  return rows.reverse().map(row => ({
    role: row.role === 'assistant' ? 'assistant' : 'user',
    content: row.content,
  }));
}

// ─── Build MCP Server for Tenant+Agent ───────────────────────────────────────

async function buildMcpServer(tenantId, agentId) {
  const anthropicTools = await getToolsForAgent(agentId);
  const mcpTools = anthropicTools.map(t => bridgeTool(t, tenantId));

  return createSdkMcpServer({
    name: `coppice-${tenantId}-${agentId}`,
    version: '1.0.0',
    tools: mcpTools,
  });
}

// ─── SAFE_TOOLS for copilot mode ─────────────────────────────────────────────

const SAFE_TOOL_NAMES = new Set([
  'search_knowledge', 'get_leads', 'get_lead_stats', 'list_emails', 'read_email',
  'browse_url', 'web_research', 'get_outreach_log', 'get_reply_inbox', 'get_followup_queue',
  'get_discovery_config', 'list_trusted_senders', 'search_hubspot_contacts',
  'search_hubspot_companies', 'search_hubspot_deals', 'get_hubspot_pipeline',
  'lookup_pricing', 'get_bid_requests', 'get_estimates', 'get_jobs', 'get_dacp_stats',
  'analyze_itb', 'compare_contract', 'run_bid_checks', 'parse_supplier_quote',
  'gws_gmail_search', 'gws_gmail_read', 'gws_calendar_events', 'gws_drive_search',
  'gws_sheets_read', 'list_scheduled_tasks', 'workspace_search_drive',
  'workspace_read_file', 'workspace_export_pdf', 'plan_content',
]);

// ─── Main Streaming Entry Point ──────────────────────────────────────────────

/**
 * Stream a chat response via the Claude Agent SDK.
 *
 * @param {string} tenantId
 * @param {string} agentId
 * @param {string} userId
 * @param {string|Array} userContent - Text or multimodal content blocks
 * @param {string|null} threadId
 * @param {Object} options - { helpMode }
 * @param {Function} onChunk - SSE callback: (chunk: string) => void
 * @returns {Promise<{ response: string }>}
 */
export async function chatStreamSdk(tenantId, agentId, userId, userContent, threadId = null, options = {}, onChunk) {
  const runId = randomUUID().slice(0, 12);
  const runStart = Date.now();
  const toolsUsed = [];

  // Support multimodal content
  const isMultimodal = Array.isArray(userContent);
  const displayContent = isMultimodal
    ? userContent.filter(b => b.type === 'text').map(b => b.text).join('\n')
    : userContent;

  // Save user message
  const messageMetadata = isMultimodal ? {
    multimodal: true,
    files: userContent.filter(b => b.type === 'image').map(b => ({ name: b._fileName || 'image', type: b.source?.media_type })),
  } : null;
  saveMessage(tenantId, agentId, userId, 'user', displayContent, messageMetadata, threadId);

  // Build system prompt
  const systemPrompt = await buildSystemPrompt(agentId, tenantId, displayContent, threadId, userId, options);

  // Build conversation history as a single prompt string
  // The SDK takes a prompt string, not a messages array. We'll format history + new message.
  const history = loadHistory(tenantId, agentId, userId, threadId);

  // Build the prompt from history context + current message
  let prompt = '';
  if (history.length > 1) {
    // Include recent history as context (skip the last message since it's the one we just saved)
    const contextMessages = history.slice(0, -1);
    prompt += 'Previous conversation:\n';
    for (const msg of contextMessages) {
      const role = msg.role === 'assistant' ? 'Assistant' : 'User';
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      prompt += `${role}: ${content}\n\n`;
    }
    prompt += '---\nCurrent message:\n';
  }
  prompt += displayContent;

  // Build MCP server with bridged tools
  const mcpServer = await buildMcpServer(tenantId, agentId);

  // Copilot mode check
  const agentMode = getAgentMode(agentId);
  const isCopilot = agentMode === 'copilot';

  // AbortController for timeout
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), 300_000); // 5 min

  let fullText = '';
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  try {
    const sdkQuery = query({
      prompt,
      options: {
        systemPrompt,
        model: options.helpMode ? 'claude-haiku-4-5-20251001' : (process.env.CHAT_MODEL || 'claude-sonnet-4-20250514'),
        cwd: `/tmp/coppice-workspaces/${tenantId}`,
        includePartialMessages: true,
        maxTurns: 25,
        abortController,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        thinking: { type: 'disabled' },
        mcpServers: {
          coppice: mcpServer,
        },
        // Copilot mode: intercept action tools
        canUseTool: isCopilot
          ? async (toolName, input, opts) => {
              // Strip MCP prefix if present (SDK adds "mcp__coppice__" prefix)
              const baseName = toolName.replace(/^mcp__coppice__/, '');

              if (SAFE_TOOL_NAMES.has(baseName)) {
                return { behavior: 'allow' };
              }

              // Action tool - create approval item and deny
              try {
                insertApprovalItem({
                  tenantId,
                  agentId,
                  title: `${baseName}: ${JSON.stringify(input).slice(0, 100)}`,
                  description: `Agent wants to use ${baseName} with input: ${JSON.stringify(input).slice(0, 500)}`,
                  type: 'tool_call',
                  payloadJson: JSON.stringify({ toolName: baseName, input, tenantId }),
                });
              } catch (e) {
                console.warn('[SDK Copilot] Failed to insert approval:', e.message);
              }

              return {
                behavior: 'deny',
                message: `This action requires approval. It has been added to the approval queue. The user will review and approve it from the Command Dashboard.`,
              };
            }
          : async () => ({ behavior: 'allow' }),
        // Environment
        env: {
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        },
      },
    });

    for await (const msg of sdkQuery) {
      switch (msg.type) {
        case 'stream_event': {
          // Token-by-token streaming events from the API
          const event = msg.event;
          if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            const text = event.delta.text;
            fullText += text;
            onChunk(text);
          }
          break;
        }

        case 'assistant': {
          // Complete assistant message - extract text and tool use info
          const content = msg.message?.content || [];
          for (const block of content) {
            if (block.type === 'tool_use') {
              toolsUsed.push(block.name);
              // Send progress event for tool use
              onChunk(JSON.stringify({
                _type: 'progress',
                iteration: toolsUsed.length,
                maxTurns: 25,
                tools: [block.name],
              }));
              onChunk(`\n<${block.name}>`);
              onChunk(`</${block.name}>\n`);
            }
          }

          // Track tokens
          if (msg.message?.usage) {
            totalInputTokens += msg.message.usage.input_tokens || 0;
            totalOutputTokens += msg.message.usage.output_tokens || 0;
          }
          break;
        }

        case 'result': {
          // Query completed
          break;
        }

        default:
          // Ignore other message types (system, status, etc.)
          break;
      }
    }

    sdkQuery.close?.();
  } catch (err) {
    if (err.name === 'AbortError') {
      console.warn(`[SDK] Agent ${agentId} timed out after 5 minutes`);
      onChunk('\n\n[Response timed out after 5 minutes]');
      fullText += '\n\n[Response timed out after 5 minutes]';
    } else {
      console.error(`[SDK] Query error for ${agentId}:`, err);
      throw err;
    }
  } finally {
    clearTimeout(timeoutId);
  }

  // Fallback if no text was generated
  if (!fullText.trim()) {
    const fallback = 'I wasn\'t able to generate a response. Please try rephrasing your question.';
    onChunk(fallback);
    fullText = fallback;
  }

  // Save assistant response
  saveMessage(tenantId, agentId, userId, 'assistant', fullText, {
    model: options.helpMode ? 'claude-haiku-4-5-20251001' : (process.env.CHAT_MODEL || 'claude-sonnet-4-20250514'),
    input_tokens: totalInputTokens,
    output_tokens: totalOutputTokens,
    tools_used: toolsUsed,
    sdk: true,
  }, threadId);

  // Record agent run
  try {
    insertAgentRun({
      runId,
      tenantId,
      agentId,
      userId,
      threadId,
      input: displayContent.slice(0, 1000),
      output: fullText.slice(0, 10000),
      model: options.helpMode ? 'claude-haiku-4-5-20251001' : (process.env.CHAT_MODEL || 'claude-sonnet-4-20250514'),
      route: 'sdk',
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      toolsUsed: toolsUsed.length > 0 ? toolsUsed : null,
      durationMs: Date.now() - runStart,
      status: 'completed',
    });
  } catch (e) {
    console.warn('[SDK Run] Failed to record:', e.message);
  }

  return { response: fullText };
}

// ─── Feature Flag ────────────────────────────────────────────────────────────

/**
 * Check if the Agent SDK is enabled for a given tenant/agent.
 * Reads from env var or tenant settings.
 */
export function isSdkEnabled(tenantId, agentId) {
  // Global kill switch
  if (process.env.AGENT_SDK_ENABLED === 'false') return false;

  // Global enable
  if (process.env.AGENT_SDK_ENABLED === 'true') return true;

  // Per-agent enable via comma-separated list
  const enabledAgents = (process.env.AGENT_SDK_AGENTS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (enabledAgents.includes(agentId)) return true;

  // Default: disabled (opt-in)
  return false;
}
