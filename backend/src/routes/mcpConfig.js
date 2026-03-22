/**
 * MCP Server Configuration Routes
 *
 * REST API for managing external MCP (Model Context Protocol) server connections
 * per tenant. Supports stdio and SSE transports.
 */
import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { getMcpServers, getMcpServer, createMcpServer, updateMcpServer, deleteMcpServer } from '../cache/database.js';
import { mcpManager } from '../services/mcpClientService.js';
import { randomUUID } from 'crypto';

const router = Router();
router.use(authenticate);

// List MCP servers for the current tenant
router.get('/', (req, res) => {
  try {
    const servers = getMcpServers(req.tenantId);
    res.json(servers);
  } catch (err) {
    console.error('[MCP Routes] List error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Add a new MCP server
router.post('/', async (req, res) => {
  try {
    const { name, transport, command, args, env, url } = req.body;

    if (!name || !transport) {
      return res.status(400).json({ error: 'name and transport are required' });
    }
    if (transport === 'stdio' && !command) {
      return res.status(400).json({ error: 'command is required for stdio transport' });
    }
    if (transport === 'sse' && !url) {
      return res.status(400).json({ error: 'url is required for sse transport' });
    }

    const id = randomUUID();
    const argsJson = JSON.stringify(args || []);
    const envJson = JSON.stringify(env || {});

    createMcpServer(req.tenantId, { id, name, transport, command, args_json: argsJson, env_json: envJson, url });

    // Try to connect immediately
    try {
      const tools = await mcpManager.connect(req.tenantId, {
        id, name, transport, command, args_json: argsJson, env_json: envJson, url,
      });
      res.json({ id, name, tools: tools.length, connected: true });
    } catch (connectErr) {
      console.warn(`[MCP Routes] Connection failed for "${name}":`, connectErr.message);
      res.json({ id, name, tools: 0, connected: false, error: connectErr.message });
    }
  } catch (err) {
    console.error('[MCP Routes] Create error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get a single MCP server
router.get('/:id', (req, res) => {
  try {
    const server = getMcpServer(req.params.id, req.tenantId);
    if (!server) return res.status(404).json({ error: 'MCP server not found' });
    res.json(server);
  } catch (err) {
    console.error('[MCP Routes] Get error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Update an MCP server (enable/disable, update config)
router.patch('/:id', async (req, res) => {
  try {
    const { enabled, name, command, args, env, url } = req.body;
    const updates = {};
    if (enabled !== undefined) updates.enabled = enabled;
    if (name !== undefined) updates.name = name;
    if (command !== undefined) updates.command = command;
    if (args !== undefined) updates.args_json = JSON.stringify(args);
    if (env !== undefined) updates.env_json = JSON.stringify(env);
    if (url !== undefined) updates.url = url;

    updateMcpServer(req.params.id, req.tenantId, updates);

    // Disconnect if disabled
    if (enabled === 0 || enabled === false) {
      await mcpManager.disconnect(req.tenantId, req.params.id);
    }

    // Reconnect if re-enabled or config changed
    if (enabled === 1 || enabled === true) {
      const server = getMcpServer(req.params.id, req.tenantId);
      if (server) {
        await mcpManager.disconnect(req.tenantId, req.params.id);
        try {
          await mcpManager.connect(req.tenantId, server);
        } catch (e) {
          console.warn(`[MCP Routes] Reconnect failed for "${server.name}":`, e.message);
        }
      }
    }

    res.json({ updated: true });
  } catch (err) {
    console.error('[MCP Routes] Update error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Delete an MCP server
router.delete('/:id', async (req, res) => {
  try {
    await mcpManager.disconnect(req.tenantId, req.params.id);
    deleteMcpServer(req.params.id, req.tenantId);
    res.json({ deleted: true });
  } catch (err) {
    console.error('[MCP Routes] Delete error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Reconnect an MCP server (useful after config changes or failures)
router.post('/:id/reconnect', async (req, res) => {
  try {
    const server = getMcpServer(req.params.id, req.tenantId);
    if (!server) return res.status(404).json({ error: 'MCP server not found' });

    await mcpManager.disconnect(req.tenantId, req.params.id);

    try {
      const tools = await mcpManager.connect(req.tenantId, server);
      res.json({ connected: true, tools: tools.length });
    } catch (connectErr) {
      res.json({ connected: false, error: connectErr.message });
    }
  } catch (err) {
    console.error('[MCP Routes] Reconnect error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
