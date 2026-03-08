# Handoff 001 - Agent Hub MCP Server
Generated: 2026-03-08

## Quick Start (30 seconds to productive)
Branch: main
Run: `cd mcp-agent-hub && npm start` (port 3100)
Status: Works locally (stdio + HTTP). Railway deploy FAILING — Root Directory must be set to `mcp-agent-hub` in Railway dashboard. Neon DB has tables and 2 learnings stored. Global git hook not yet installed.

## Git State
Clean. All work committed and pushed to origin/main (commit 88042bc). No uncommitted files.

## Environment
- `DATABASE_URL` — Neon Postgres connection string (required)
- `API_KEY` — Optional, auth is open by default. Generated key exists: `a5f11899d55e84759b73512f8fda416b105d7f428f3ec31d4df3ae1c28423f29`
- `PORT` — Defaults to 3100
- MCP config lives in `~/.claude.json` (user scope, points to `src/local.js`)
- `.mcp.json` in repo root configures Neon remote MCP

## Immediate Context
The Agent Hub is a standalone Node.js service that provides a central knowledge base for AI agents across repos. It exposes 7 MCP tools and a REST API, backed by Neon Postgres with pgvector and pg_trgm extensions. The Rails app (Sabbatic) has been wired to sync via HTTP (AgentHub model + Webhook hook + background job). Railway deployment needs one config fix to work.

## User's Actual Goal
"I want to make a place for all my agents can connect within any repo to learn and commit" — a shared knowledge layer accessible from any computer.

## Critical Knowledge
- Sabbatic uses SQLite, NOT Postgres, despite DATABASE_URL in .env. Do not add pg gem to Gemfile.
- The AgentHub Rails model (`app/models/agent_hub.rb`) uses HTTP calls to the Agent Hub service, not direct PG queries. Do not change this.
- Express 5 requires `{*param}` syntax for catch-all routes, not `:param(*)`.
- `claude mcp add -e` puts env vars in args, not env — manual editing of `~/.claude.json` was needed.
- `zod` is used in `mcp-tools.js` but is NOT listed in `package.json`. It works via transitive dependency from `@modelcontextprotocol/sdk` but this is fragile and should be fixed.
- node_modules was committed initially and had to be cleaned up with `git rm`.
- Gemfile.lock is frozen in Docker — cannot add gems without running `bundle install` first.

## Gotchas & Warnings
- **CRITICAL**: `zod` missing from `package.json` dependencies. Add it explicitly to avoid breakage if SDK changes.
- **HIGH**: Railway deploy fails until Root Directory is set to `mcp-agent-hub` in the Railway dashboard. It defaults to building the root Dockerfile (the Rails app).
- **MEDIUM**: `install-hooks.sh` sources shell profiles which may contain credentials. Review before running.
- **MEDIUM**: No try-catch on most REST API endpoints in `rest-api.js`. Unhandled errors will crash the server.
- **LOW**: `.gitignore` is minimal — no `.env` coverage. Risk of committing secrets.
- **LOW**: API key auth is optional (open by default). Fine for dev, not for production.
- **LOW**: No test coverage exists (no test files at all).

## Next Actions
1. Fix Railway deploy: set Root Directory to `mcp-agent-hub` in Railway dashboard, then redeploy.
2. Add `zod` to `mcp-agent-hub/package.json` dependencies explicitly.
3. Add error handling (try-catch) to REST API endpoints in `rest-api.js`.
4. Add `.env` to `.gitignore`.
5. Install global git hook (`install-hooks.sh`) after reviewing it for credential safety.
6. Consider adding basic tests.

## Files to Read First
- `mcp-agent-hub/src/mcp-tools.js` — The 7 MCP tool definitions (core interface)
- `mcp-agent-hub/src/db.js` — All database queries against Neon
- `mcp-agent-hub/src/server.js` — Production HTTP server (Express + MCP StreamableHTTP)
- `mcp-agent-hub/src/rest-api.js` — REST API routes
- `mcp-agent-hub/src/local.js` — Local stdio MCP transport
- `app/models/agent_hub.rb` — Rails model (HTTP-based, not PG)
- `app/models/webhook.rb` — Agent hub sync hook
- `~/CLAUDE.md` — Global agent instructions

## Open Questions
- Should API key auth be enforced by default in production?
- What is the long-term plan for search — stay with pg_trgm or move to embeddings?
- Should the git hook log commits to the hub automatically, and if so, which repos?
- Is there a plan for agent identity/registration beyond the current simple model?

## Confidence Levels
High: Local server works (npm start/dev/migrate verified), all files present and complete, git state clean, AgentHub model uses HTTP not PG, SQLite not Postgres for Sabbatic
Medium: Railway deploy fix (Root Directory setting — parent claim, not independently tested), install-hooks.sh credential concern (single agent flagged)
Low: REST API error handling gaps (single agent observation, not crash-tested)
