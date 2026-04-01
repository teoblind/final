/**
 * MCP Client Manager - manages Model Context Protocol client connections per tenant.
 *
 * Each tenant can configure external MCP servers (stdio or SSE transport).
 * This service maintains persistent connections and translates between
 * MCP tool format and Anthropic tool-use format for the chat engine.
 */

class McpClientManager {
  constructor() {
    // Cache: Map<tenantId, Map<serverId, { client, transport, tools, name }>>
    this.connections = new Map();
  }

  /**
   * Connect to an MCP server for a given tenant.
   * Uses dynamic imports so the MCP SDK is only loaded when needed.
   */
  async connect(tenantId, serverConfig) {
    const { id, name, transport: transportType, command, args_json, env_json, url } = serverConfig;

    // Dynamic import to avoid startup errors if SDK not installed
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');

    let transport;
    if (transportType === 'stdio') {
      const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
      const args = JSON.parse(args_json || '[]');
      const env = { ...process.env, ...JSON.parse(env_json || '{}') };
      transport = new StdioClientTransport({ command, args, env });
    } else if (transportType === 'sse') {
      const { SSEClientTransport } = await import('@modelcontextprotocol/sdk/client/sse.js');
      transport = new SSEClientTransport(new URL(url));
    } else {
      throw new Error(`Unsupported MCP transport type: ${transportType}`);
    }

    const client = new Client(
      { name: `coppice-${tenantId}`, version: '1.0.0' },
      { capabilities: { tools: {} } }
    );

    await client.connect(transport);

    // List available tools from the server
    const { tools } = await client.listTools();

    // Cache the connection
    if (!this.connections.has(tenantId)) {
      this.connections.set(tenantId, new Map());
    }
    this.connections.get(tenantId).set(id, { client, transport, tools, name });

    console.log(`[MCP] Connected to "${name}" for tenant ${tenantId} - ${tools.length} tool(s)`);
    return tools;
  }

  /**
   * Get all MCP tools for a tenant, formatted as Anthropic tool definitions.
   * Tool names use the convention: mcp__serverName__toolName
   */
  async getToolsForTenant(tenantId) {
    const tenantConns = this.connections.get(tenantId);
    if (!tenantConns) return [];

    const anthropicTools = [];
    for (const [serverId, conn] of tenantConns) {
      for (const tool of conn.tools) {
        anthropicTools.push({
          name: `mcp__${conn.name}__${tool.name}`,
          description: tool.description || `MCP tool from ${conn.name}`,
          input_schema: tool.inputSchema || { type: 'object', properties: {} },
        });
      }
    }
    return anthropicTools;
  }

  /**
   * Call an MCP tool by its full namespaced name (mcp__serverName__toolName).
   * Routes to the correct server connection and returns the result as a string.
   */
  async callTool(tenantId, fullToolName, input) {
    // Parse: mcp__serverName__toolName (toolName may contain __ if the original name does)
    const parts = fullToolName.split('__');
    if (parts.length < 3 || parts[0] !== 'mcp') {
      throw new Error(`Invalid MCP tool name: ${fullToolName}`);
    }
    const serverName = parts[1];
    const toolName = parts.slice(2).join('__');

    const tenantConns = this.connections.get(tenantId);
    if (!tenantConns) throw new Error('No MCP connections for tenant');

    // Find the connection by server name
    let conn;
    for (const c of tenantConns.values()) {
      if (c.name === serverName) {
        conn = c;
        break;
      }
    }
    if (!conn) throw new Error(`MCP server "${serverName}" not connected`);

    const result = await conn.client.callTool({ name: toolName, arguments: input });

    // Convert MCP result content to string for Claude
    if (result.content) {
      return result.content
        .map((c) => {
          if (c.type === 'text') return c.text;
          if (c.type === 'image') return `[Image: ${c.mimeType}]`;
          return JSON.stringify(c);
        })
        .join('\n');
    }
    return JSON.stringify(result);
  }

  /**
   * Disconnect a single MCP server for a tenant.
   */
  async disconnect(tenantId, serverId) {
    const tenantConns = this.connections.get(tenantId);
    if (!tenantConns) return;
    const conn = tenantConns.get(serverId);
    if (conn) {
      try {
        await conn.client.close();
      } catch (e) {
        console.warn(`[MCP] Error closing ${conn.name}:`, e.message);
      }
      tenantConns.delete(serverId);
    }
  }

  /**
   * Disconnect all MCP servers for a tenant.
   */
  async disconnectAll(tenantId) {
    const tenantConns = this.connections.get(tenantId);
    if (!tenantConns) return;
    for (const [id] of tenantConns) {
      await this.disconnect(tenantId, id);
    }
    this.connections.delete(tenantId);
  }

  /**
   * Check if a tenant has any active MCP connections.
   */
  hasConnections(tenantId) {
    const tenantConns = this.connections.get(tenantId);
    return tenantConns && tenantConns.size > 0;
  }
}

export const mcpManager = new McpClientManager();
