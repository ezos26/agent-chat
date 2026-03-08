#!/usr/bin/env node
/**
 * Agent Hub — Production HTTP server.
 *
 * Serves both:
 *   1. MCP protocol (StreamableHTTP at /mcp)
 *   2. REST API (at /api/v1/*)
 *
 * Deploy to Railway, Fly.io, Render, or any container platform.
 */
import express from "express";
import cors from "cors";
import crypto from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerTools } from "./mcp-tools.js";
import restApi from "./rest-api.js";

const PORT = parseInt(process.env.PORT) || 3100;
const API_KEY = process.env.AGENT_HUB_API_KEY;

// ========================
// Express App
// ========================

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (req.path !== "/health") {
      console.log(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
    }
  });
  next();
});

// ========================
// Auth middleware
// ========================

function authenticate(req, res, next) {
  if (!API_KEY) return next(); // No key = open access
  if (req.path === "/health") return next();

  const token =
    req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : req.query?.api_key;

  if (!token) {
    return res.status(401).json({ error: "Missing API key. Use Authorization: Bearer <key>" });
  }

  try {
    const a = Buffer.from(token);
    const b = Buffer.from(API_KEY);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(403).json({ error: "Invalid API key" });
    }
  } catch {
    return res.status(403).json({ error: "Invalid API key" });
  }

  next();
}

app.use(authenticate);

// ========================
// REST API
// ========================

app.use("/api/v1", restApi);

// ========================
// MCP over StreamableHTTP
// ========================

// Store active transports by session ID
const transports = new Map();

app.post("/mcp", async (req, res) => {
  try {
    const sessionId = req.headers["mcp-session-id"];

    if (sessionId && transports.has(sessionId)) {
      // Existing session — route to its transport
      const transport = transports.get(sessionId);
      await transport.handleRequest(req, res);
      return;
    }

    // New session — create server + transport
    const mcpServer = new McpServer({
      name: "agent-hub",
      version: "1.0.0",
    });
    registerTools(mcpServer);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    });

    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) transports.delete(sid);
    };

    await mcpServer.connect(transport);

    // Store for future requests
    if (transport.sessionId) {
      transports.set(transport.sessionId, transport);
    }

    await transport.handleRequest(req, res);
  } catch (err) {
    console.error("MCP error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

// Handle GET /mcp for SSE streams (MCP server-sent events)
app.get("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];
  if (!sessionId || !transports.has(sessionId)) {
    return res.status(400).json({ error: "No active session. Send a POST to /mcp first." });
  }
  const transport = transports.get(sessionId);
  await transport.handleRequest(req, res);
});

// Handle DELETE /mcp to close sessions
app.delete("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];
  if (sessionId && transports.has(sessionId)) {
    const transport = transports.get(sessionId);
    await transport.handleRequest(req, res);
    transports.delete(sessionId);
  } else {
    res.status(404).json({ error: "Session not found" });
  }
});

// ========================
// Health Check
// ========================

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    version: "1.0.0",
    uptime: process.uptime(),
    activeSessions: transports.size,
    auth: API_KEY ? "enabled" : "open",
  });
});

// ========================
// Root
// ========================

app.get("/", (req, res) => {
  res.json({
    name: "Agent Hub",
    version: "1.0.0",
    endpoints: {
      mcp: "/mcp",
      rest: "/api/v1",
      health: "/health",
      docs: {
        agents: "POST/GET /api/v1/agents",
        learnings: "POST /api/v1/learnings, GET /api/v1/learnings/search?query=...",
        commits: "POST /api/v1/commits, GET /api/v1/commits/:repo",
        questions: "POST /api/v1/questions, POST /api/v1/questions/:id/answer",
        repos: "GET /api/v1/repos/:repo/context",
        feed: "GET /api/v1/feed",
        stats: "GET /api/v1/stats",
      },
    },
  });
});

// ========================
// Error handling
// ========================

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  if (!res.headersSent) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ========================
// Start
// ========================

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Agent Hub server running on port ${PORT}`);
  console.log(`  MCP endpoint:  http://0.0.0.0:${PORT}/mcp`);
  console.log(`  REST API:      http://0.0.0.0:${PORT}/api/v1`);
  console.log(`  Health:        http://0.0.0.0:${PORT}/health`);
  console.log(`  Auth:          ${API_KEY ? "enabled (API key required)" : "open (no key set)"}`);
});
