/**
 * Internal Tool Endpoint - localhost-only route for MCP bridge
 *
 * The CLI tunnel agent (claude -p on Mac) uses MCP tools that proxy back
 * to this endpoint via SSH. This lets the CLI agent call Google Workspace,
 * email, knowledge, and all other backend tools without API credits.
 *
 * Security: Only accepts requests from 127.0.0.1 (the MCP bridge runs
 * on the same VPS via SSH, so it always hits localhost).
 */

import express from 'express';
import { routeToolCall } from '../services/chatService.js';
import { runWithTenant, SANGHA_TENANT_ID } from '../cache/database.js';

const router = express.Router();

// Localhost-only guard
router.use((req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  if (!isLocal) {
    console.warn(`[Internal] Rejected non-local request from ${ip}`);
    return res.status(403).json({ error: 'Forbidden - localhost only' });
  }
  next();
});

/**
 * POST /api/v1/internal/tool
 * Body: { toolName: string, toolInput: object, tenantId: string }
 * Returns: { result: any, error?: string }
 */
router.post('/tool', async (req, res) => {
  const { toolName, toolInput, tenantId } = req.body;

  if (!toolName) {
    return res.status(400).json({ error: 'toolName is required' });
  }

  const resolvedTenant = tenantId || SANGHA_TENANT_ID;

  try {
    console.log(`[Internal] Tool call: ${toolName} (tenant: ${resolvedTenant})`);

    // Run with tenant context (AsyncLocalStorage) so DB operations resolve correctly
    const result = await runWithTenant(resolvedTenant, () =>
      routeToolCall(toolName, toolInput || {}, resolvedTenant)
    );

    // Stringify large results to avoid JSON issues
    const serialized = typeof result === 'string' ? result : JSON.stringify(result);
    res.json({ result: serialized });
  } catch (err) {
    console.error(`[Internal] Tool ${toolName} failed:`, err.message);
    res.json({ result: null, error: err.message });
  }
});

/**
 * GET /api/v1/internal/tools
 * Returns the list of all available tool names and schemas.
 * Used by the MCP bridge to populate its tools/list response.
 */
router.get('/tools', async (req, res) => {
  try {
    const {
      WORKSPACE_TOOLS, LEAD_ENGINE_TOOLS, HUBSPOT_TOOLS, EMAIL_SECURITY_TOOLS,
      KNOWLEDGE_TOOLS, WEB_TOOLS, LEGAL_TOOLS, DOCUMENT_TOOLS, SCHEDULER_TOOLS,
      CALENDAR_TOOLS, DACP_TOOLS, MINING_TOOLS, GWS_TOOLS, EMAIL_TOOLS,
      CODE_EXECUTION_TOOLS,
    } = await import('../services/chatService.js');

    const allTools = [
      ...WORKSPACE_TOOLS,
      ...LEAD_ENGINE_TOOLS,
      ...(HUBSPOT_TOOLS || []),
      ...(EMAIL_SECURITY_TOOLS || []),
      ...(KNOWLEDGE_TOOLS || []),
      ...(WEB_TOOLS || []),
      ...(LEGAL_TOOLS || []),
      ...(DOCUMENT_TOOLS || []),
      ...(SCHEDULER_TOOLS || []),
      ...(CALENDAR_TOOLS || []),
      ...(DACP_TOOLS || []),
      ...(MINING_TOOLS || []),
      ...(GWS_TOOLS || []),
      ...(EMAIL_TOOLS || []),
      ...(CODE_EXECUTION_TOOLS || []),
    ];

    res.json({ tools: allTools });
  } catch (err) {
    console.error('[Internal] Failed to list tools:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
