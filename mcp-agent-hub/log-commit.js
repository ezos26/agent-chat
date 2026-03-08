#!/usr/bin/env node
/**
 * Logs the latest git commit to the agent-hub Neon DB.
 *
 * Usage:
 *   node /home/ezos/projects/agent-chat/mcp-agent-hub/log-commit.js
 *
 * Requires:
 *   - DATABASE_URL env var pointing to the Neon DB
 *   - Must be run from within a git repository
 *
 * Auto-detects repo from `git remote get-url origin` and reads the
 * latest commit info via git log / git diff-tree.
 */

import { neon } from "@neondatabase/serverless";
import { execSync } from "child_process";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

function git(cmd) {
  return execSync(cmd, { encoding: "utf-8" }).trim();
}

async function main() {
  // --- Gather commit info ---

  let repoUrl;
  try {
    repoUrl = git("git remote get-url origin");
  } catch {
    // No remote — use the directory name as a fallback identifier
    repoUrl = git("basename $(git rev-parse --show-toplevel)");
  }

  // Normalise GitHub URLs to owner/repo format
  // e.g. git@github.com:ezos/agent-chat.git  -> ezos/agent-chat
  //      https://github.com/ezos/agent-chat.git -> ezos/agent-chat
  let repo = repoUrl
    .replace(/\.git$/, "")
    .replace(/^https?:\/\/[^/]+\//, "")
    .replace(/^git@[^:]+:/, "");

  const sha = git("git log -1 --format=%H");
  const summary = git("git log -1 --format=%s");

  let filesChanged = [];
  try {
    const diffOutput = git("git diff-tree --no-commit-id --name-only -r HEAD");
    if (diffOutput) {
      filesChanged = diffOutput.split("\n").filter(Boolean);
    }
  } catch {
    // Initial commit or other edge case — no files to report
  }

  // --- Insert into Neon ---

  const sql = neon(DATABASE_URL);

  try {
    const rows = await sql`
      INSERT INTO commits (agent_id, repo, sha, summary, files_changed)
      VALUES (NULL, ${repo}, ${sha}, ${summary}, ${filesChanged})
      ON CONFLICT (repo, sha) DO UPDATE SET summary = ${summary}
      RETURNING id
    `;

    console.log(
      `Logged commit ${sha.slice(0, 7)} to agent-hub (id=${rows[0].id}): ${summary}`
    );
    console.log(`  repo: ${repo}`);
    if (filesChanged.length > 0) {
      console.log(`  files: ${filesChanged.join(", ")}`);
    }
  } catch (err) {
    console.error("Failed to log commit:", err.message);
    // Exit 0 so we never block a git workflow
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err.message);
  // Never block the git workflow
  process.exit(0);
});
