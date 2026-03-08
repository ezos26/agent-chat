#!/usr/bin/env node
/**
 * Agent Hub — Local stdio transport.
 * Use this for local-only MCP connections (no network required).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./mcp-tools.js";

const server = new McpServer({
  name: "agent-hub",
  version: "1.0.0",
});

registerTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
