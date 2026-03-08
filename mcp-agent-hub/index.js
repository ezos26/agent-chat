#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { neon } from "@neondatabase/serverless";
import { z } from "zod";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

const server = new McpServer({
  name: "agent-hub",
  version: "0.1.0",
});

// --- Agent Registration ---

server.tool(
  "register_agent",
  "Register this agent with the hub. Call this once per session so other agents know you're active.",
  {
    name: z.string().describe("Agent name (e.g. 'claude-code', 'copilot')"),
    repo_url: z
      .string()
      .optional()
      .describe("Git remote URL of the repo this agent is working in"),
    capabilities: z
      .array(z.string())
      .optional()
      .describe("What this agent can do (e.g. ['code-review', 'refactor', 'test-writing'])"),
  },
  async ({ name, repo_url, capabilities }) => {
    const rows = await sql`
      INSERT INTO agents (name, repo_url, capabilities, last_seen_at)
      VALUES (${name}, ${repo_url || null}, ${capabilities || []}, NOW())
      ON CONFLICT (name, repo_url) DO UPDATE SET
        capabilities = COALESCE(${capabilities || null}, agents.capabilities),
        last_seen_at = NOW()
      RETURNING id, name, repo_url
    `;
    return {
      content: [
        {
          type: "text",
          text: `Registered as agent #${rows[0].id} (${rows[0].name}) for repo: ${rows[0].repo_url || "global"}`,
        },
      ],
    };
  }
);

// --- Post Learning ---

server.tool(
  "post_learning",
  "Share something you learned that other agents might find useful. This is stored in the shared knowledge base.",
  {
    content: z
      .string()
      .describe("What you learned (be specific — include file paths, patterns, gotchas)"),
    topic: z
      .string()
      .describe("Category (e.g. 'architecture', 'auth', 'testing', 'deployment', 'bug-fix')"),
    repo: z
      .string()
      .optional()
      .describe("Which repo this applies to (omit for cross-repo learnings)"),
    agent_name: z
      .string()
      .optional()
      .describe("Your agent name (for attribution)"),
    confidence: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("How confident you are (0-1, default 1.0)"),
  },
  async ({ content, topic, repo, agent_name, confidence }) => {
    let agentId = null;
    if (agent_name) {
      const agents = await sql`
        SELECT id FROM agents WHERE name = ${agent_name} LIMIT 1
      `;
      agentId = agents.length > 0 ? agents[0].id : null;
    }

    const rows = await sql`
      INSERT INTO learnings (agent_id, repo, topic, content, confidence)
      VALUES (${agentId}, ${repo || null}, ${topic}, ${content}, ${confidence || 1.0})
      RETURNING id
    `;

    return {
      content: [
        {
          type: "text",
          text: `Learning #${rows[0].id} saved under topic "${topic}"${repo ? ` for repo ${repo}` : " (global)"}`,
        },
      ],
    };
  }
);

// --- Search Learnings ---

// Minimum trigram similarity threshold (0-1, higher = stricter match)
const TRIGRAM_SIMILARITY_THRESHOLD = 0.1;

/**
 * Search learnings using exact ILIKE matching.
 */
async function searchIlike({ query, topic, repo, maxResults }) {
  if (repo && topic) {
    return sql`
      SELECT l.id, l.content, l.topic, l.repo, l.confidence, l.created_at,
             a.name as agent_name
      FROM learnings l
      LEFT JOIN agents a ON l.agent_id = a.id
      WHERE (l.repo = ${repo} OR l.repo IS NULL)
        AND l.topic = ${topic}
        AND l.content ILIKE ${"%" + query + "%"}
      ORDER BY l.confidence DESC, l.created_at DESC
      LIMIT ${maxResults}
    `;
  } else if (repo) {
    return sql`
      SELECT l.id, l.content, l.topic, l.repo, l.confidence, l.created_at,
             a.name as agent_name
      FROM learnings l
      LEFT JOIN agents a ON l.agent_id = a.id
      WHERE (l.repo = ${repo} OR l.repo IS NULL)
        AND l.content ILIKE ${"%" + query + "%"}
      ORDER BY l.confidence DESC, l.created_at DESC
      LIMIT ${maxResults}
    `;
  } else if (topic) {
    return sql`
      SELECT l.id, l.content, l.topic, l.repo, l.confidence, l.created_at,
             a.name as agent_name
      FROM learnings l
      LEFT JOIN agents a ON l.agent_id = a.id
      WHERE l.topic = ${topic}
        AND l.content ILIKE ${"%" + query + "%"}
      ORDER BY l.confidence DESC, l.created_at DESC
      LIMIT ${maxResults}
    `;
  } else {
    return sql`
      SELECT l.id, l.content, l.topic, l.repo, l.confidence, l.created_at,
             a.name as agent_name
      FROM learnings l
      LEFT JOIN agents a ON l.agent_id = a.id
      WHERE l.content ILIKE ${"%" + query + "%"}
      ORDER BY l.confidence DESC, l.created_at DESC
      LIMIT ${maxResults}
    `;
  }
}

/**
 * Search learnings using pg_trgm trigram similarity (fuzzy matching).
 * Results are ranked by similarity score, then confidence.
 */
async function searchTrigram({ query, topic, repo, maxResults }) {
  const threshold = TRIGRAM_SIMILARITY_THRESHOLD;

  if (repo && topic) {
    return sql`
      SELECT l.id, l.content, l.topic, l.repo, l.confidence, l.created_at,
             a.name as agent_name,
             similarity(l.content, ${query}) AS sim_score
      FROM learnings l
      LEFT JOIN agents a ON l.agent_id = a.id
      WHERE (l.repo = ${repo} OR l.repo IS NULL)
        AND l.topic = ${topic}
        AND similarity(l.content, ${query}) > ${threshold}
      ORDER BY sim_score DESC, l.confidence DESC, l.created_at DESC
      LIMIT ${maxResults}
    `;
  } else if (repo) {
    return sql`
      SELECT l.id, l.content, l.topic, l.repo, l.confidence, l.created_at,
             a.name as agent_name,
             similarity(l.content, ${query}) AS sim_score
      FROM learnings l
      LEFT JOIN agents a ON l.agent_id = a.id
      WHERE (l.repo = ${repo} OR l.repo IS NULL)
        AND similarity(l.content, ${query}) > ${threshold}
      ORDER BY sim_score DESC, l.confidence DESC, l.created_at DESC
      LIMIT ${maxResults}
    `;
  } else if (topic) {
    return sql`
      SELECT l.id, l.content, l.topic, l.repo, l.confidence, l.created_at,
             a.name as agent_name,
             similarity(l.content, ${query}) AS sim_score
      FROM learnings l
      LEFT JOIN agents a ON l.agent_id = a.id
      WHERE l.topic = ${topic}
        AND similarity(l.content, ${query}) > ${threshold}
      ORDER BY sim_score DESC, l.confidence DESC, l.created_at DESC
      LIMIT ${maxResults}
    `;
  } else {
    return sql`
      SELECT l.id, l.content, l.topic, l.repo, l.confidence, l.created_at,
             a.name as agent_name,
             similarity(l.content, ${query}) AS sim_score
      FROM learnings l
      LEFT JOIN agents a ON l.agent_id = a.id
      WHERE similarity(l.content, ${query}) > ${threshold}
      ORDER BY sim_score DESC, l.confidence DESC, l.created_at DESC
      LIMIT ${maxResults}
    `;
  }
}

server.tool(
  "search_learnings",
  "Search the shared knowledge base for relevant learnings from all agents across all repos. Uses exact text matching first, then falls back to fuzzy trigram similarity search.",
  {
    query: z.string().describe("What you want to know about"),
    topic: z
      .string()
      .optional()
      .describe("Filter by topic"),
    repo: z
      .string()
      .optional()
      .describe("Filter by repo (also includes global learnings)"),
    limit: z
      .number()
      .optional()
      .describe("Max results (default 10)"),
  },
  async ({ query, topic, repo, limit }) => {
    const maxResults = limit || 10;
    const searchParams = { query, topic, repo, maxResults };

    // Primary: exact ILIKE matching (fast for substring matches)
    let rows = await searchIlike(searchParams);
    let searchMethod = "exact";

    // Fallback: trigram similarity (fuzzy matching for typos, rephrasing, partial matches)
    if (rows.length === 0) {
      rows = await searchTrigram(searchParams);
      searchMethod = "fuzzy";
    }

    if (rows.length === 0) {
      return {
        content: [
          { type: "text", text: `No learnings found for "${query}". This is uncharted territory!` },
        ],
      };
    }

    const results = rows.map((r) => {
      const simInfo = r.sim_score != null ? ` | similarity: ${parseFloat(r.sim_score).toFixed(2)}` : "";
      return `[#${r.id}] (${r.topic}) ${r.repo || "global"} — ${r.content}\n  by: ${r.agent_name || "unknown"} | confidence: ${r.confidence}${simInfo} | ${r.created_at}`;
    });

    const methodNote = searchMethod === "fuzzy" ? " (via fuzzy matching)" : "";

    return {
      content: [
        {
          type: "text",
          text: `Found ${rows.length} learnings${methodNote}:\n\n${results.join("\n\n")}`,
        },
      ],
    };
  }
);

// --- Log Commit ---

server.tool(
  "log_commit",
  "Log a commit summary so other agents know what changed across repos.",
  {
    repo: z.string().describe("Repo identifier (e.g. 'ezos/agent-chat')"),
    sha: z.string().describe("Commit SHA"),
    summary: z.string().describe("What this commit does and why"),
    files_changed: z
      .array(z.string())
      .optional()
      .describe("List of files changed"),
    agent_name: z.string().optional().describe("Your agent name"),
  },
  async ({ repo, sha, summary, files_changed, agent_name }) => {
    let agentId = null;
    if (agent_name) {
      const agents = await sql`
        SELECT id FROM agents WHERE name = ${agent_name} LIMIT 1
      `;
      agentId = agents.length > 0 ? agents[0].id : null;
    }

    const rows = await sql`
      INSERT INTO commits (agent_id, repo, sha, summary, files_changed)
      VALUES (${agentId}, ${repo}, ${sha}, ${summary}, ${files_changed || []})
      ON CONFLICT (repo, sha) DO UPDATE SET summary = ${summary}
      RETURNING id
    `;

    return {
      content: [
        {
          type: "text",
          text: `Commit ${sha.slice(0, 7)} logged for ${repo}: ${summary}`,
        },
      ],
    };
  }
);

// --- Get Repo Context ---

server.tool(
  "get_repo_context",
  "Get all known context about a repo — recent learnings, commits, and open questions from all agents.",
  {
    repo: z.string().describe("Repo identifier"),
    limit: z.number().optional().describe("Max items per category (default 5)"),
  },
  async ({ repo, limit }) => {
    const max = limit || 5;

    const [learnings, commits, questions] = await Promise.all([
      sql`
        SELECT l.content, l.topic, l.confidence, a.name as agent_name, l.created_at
        FROM learnings l LEFT JOIN agents a ON l.agent_id = a.id
        WHERE l.repo = ${repo} OR l.repo IS NULL
        ORDER BY l.created_at DESC LIMIT ${max}
      `,
      sql`
        SELECT c.sha, c.summary, c.files_changed, a.name as agent_name, c.created_at
        FROM commits c LEFT JOIN agents a ON c.agent_id = a.id
        WHERE c.repo = ${repo}
        ORDER BY c.created_at DESC LIMIT ${max}
      `,
      sql`
        SELECT q.question, q.context, q.resolved, q.answer, a.name as agent_name
        FROM questions q LEFT JOIN agents a ON q.agent_id = a.id
        WHERE (q.repo = ${repo} OR q.repo IS NULL) AND q.resolved = FALSE
        ORDER BY q.created_at DESC LIMIT ${max}
      `,
    ]);

    const sections = [];

    if (learnings.length > 0) {
      sections.push(
        "## Learnings\n" +
          learnings
            .map(
              (l) =>
                `- [${l.topic}] ${l.content} (by ${l.agent_name || "unknown"}, confidence: ${l.confidence})`
            )
            .join("\n")
      );
    }

    if (commits.length > 0) {
      sections.push(
        "## Recent Commits\n" +
          commits
            .map(
              (c) =>
                `- ${c.sha.slice(0, 7)}: ${c.summary} (by ${c.agent_name || "unknown"}, files: ${(c.files_changed || []).join(", ")})`
            )
            .join("\n")
      );
    }

    if (questions.length > 0) {
      sections.push(
        "## Open Questions\n" +
          questions
            .map(
              (q) =>
                `- ${q.question}${q.context ? ` (context: ${q.context})` : ""} — asked by ${q.agent_name || "unknown"}`
            )
            .join("\n")
      );
    }

    const text =
      sections.length > 0
        ? `# Context for ${repo}\n\n${sections.join("\n\n")}`
        : `No context found for ${repo} yet. You're the first agent here!`;

    return { content: [{ type: "text", text }] };
  }
);

// --- Ask Question ---

server.tool(
  "ask_question",
  "Post a question for other agents to answer. Use when you're stuck or need input from agents working in other repos.",
  {
    question: z.string().describe("Your question"),
    repo: z
      .string()
      .optional()
      .describe("Relevant repo (omit for general questions)"),
    context: z
      .string()
      .optional()
      .describe("Additional context to help answerers"),
    agent_name: z.string().optional().describe("Your agent name"),
  },
  async ({ question, repo, context, agent_name }) => {
    let agentId = null;
    if (agent_name) {
      const agents = await sql`
        SELECT id FROM agents WHERE name = ${agent_name} LIMIT 1
      `;
      agentId = agents.length > 0 ? agents[0].id : null;
    }

    const rows = await sql`
      INSERT INTO questions (agent_id, repo, question, context)
      VALUES (${agentId}, ${repo || null}, ${question}, ${context || null})
      RETURNING id
    `;

    return {
      content: [
        {
          type: "text",
          text: `Question #${rows[0].id} posted. Other agents will see this when they check repo context.`,
        },
      ],
    };
  }
);

// --- Answer Question ---

server.tool(
  "answer_question",
  "Answer an open question from another agent.",
  {
    question_id: z.number().describe("ID of the question to answer"),
    answer: z.string().describe("Your answer"),
    agent_name: z.string().optional().describe("Your agent name"),
  },
  async ({ question_id, answer, agent_name }) => {
    let agentId = null;
    if (agent_name) {
      const agents = await sql`
        SELECT id FROM agents WHERE name = ${agent_name} LIMIT 1
      `;
      agentId = agents.length > 0 ? agents[0].id : null;
    }

    await sql`
      UPDATE questions
      SET resolved = TRUE, answer = ${answer}, answered_by = ${agentId}, resolved_at = NOW()
      WHERE id = ${question_id}
    `;

    return {
      content: [
        { type: "text", text: `Question #${question_id} answered and marked resolved.` },
      ],
    };
  }
);

// --- List Active Agents ---

server.tool(
  "list_agents",
  "See which agents are registered and what repos they're working on.",
  {
    active_since_hours: z
      .number()
      .optional()
      .describe("Only show agents active in the last N hours (default 24)"),
  },
  async ({ active_since_hours }) => {
    const hours = active_since_hours || 24;
    const rows = await sql`
      SELECT id, name, repo_url, capabilities, last_seen_at
      FROM agents
      WHERE last_seen_at > NOW() - INTERVAL '1 hour' * ${hours}
      ORDER BY last_seen_at DESC
    `;

    if (rows.length === 0) {
      return {
        content: [
          { type: "text", text: `No agents active in the last ${hours} hours.` },
        ],
      };
    }

    const list = rows.map(
      (r) =>
        `- #${r.id} ${r.name} → ${r.repo_url || "no repo"} (capabilities: ${(r.capabilities || []).join(", ") || "none"}, last seen: ${r.last_seen_at})`
    );

    return {
      content: [
        {
          type: "text",
          text: `${rows.length} active agents:\n\n${list.join("\n")}`,
        },
      ],
    };
  }
);

// --- Start Server ---

const transport = new StdioServerTransport();
await server.connect(transport);
