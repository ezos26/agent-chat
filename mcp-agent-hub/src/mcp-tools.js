/**
 * MCP tool definitions — shared between local (stdio) and remote (HTTP) transports.
 */
import { z } from "zod";
import * as db from "./db.js";

export function registerTools(server) {
  // --- Register Agent ---
  server.tool(
    "register_agent",
    "Register this agent with the hub. Call this once per session so other agents know you're active.",
    {
      name: z.string().describe("Agent name (e.g. 'claude-code', 'copilot')"),
      repo_url: z.string().optional().describe("Git remote URL of the repo this agent is working in"),
      capabilities: z.array(z.string()).optional().describe("What this agent can do"),
    },
    async ({ name, repo_url, capabilities }) => {
      const agent = await db.registerAgent(name, repo_url, capabilities);
      return text(`Registered as agent #${agent.id} (${agent.name}) for repo: ${agent.repo_url || "global"}`);
    }
  );

  // --- Post Learning ---
  server.tool(
    "post_learning",
    "Share something you learned that other agents might find useful.",
    {
      content: z.string().describe("What you learned (be specific — include file paths, patterns, gotchas)"),
      topic: z.string().describe("Category (e.g. 'architecture', 'auth', 'testing', 'deployment', 'bug-fix')"),
      repo: z.string().optional().describe("Which repo this applies to (omit for cross-repo learnings)"),
      agent_name: z.string().optional().describe("Your agent name (for attribution)"),
      confidence: z.number().min(0).max(1).optional().describe("How confident you are (0-1, default 1.0)"),
    },
    async ({ content, topic, repo, agent_name, confidence }) => {
      const agentId = await db.resolveAgentId(agent_name);
      const learning = await db.postLearning({ agentId, repo, topic, content, confidence });
      return text(`Learning #${learning.id} saved under topic "${topic}"${repo ? ` for repo ${repo}` : " (global)"}`);
    }
  );

  // --- Search Learnings ---
  server.tool(
    "search_learnings",
    "Search the shared knowledge base. Uses exact matching first, then fuzzy trigram similarity.",
    {
      query: z.string().describe("What you want to know about"),
      topic: z.string().optional().describe("Filter by topic"),
      repo: z.string().optional().describe("Filter by repo (also includes global learnings)"),
      limit: z.number().optional().describe("Max results (default 10)"),
    },
    async ({ query, topic, repo, limit }) => {
      const { rows, method } = await db.searchLearnings({ query, topic, repo, limit: limit || 10 });

      if (rows.length === 0) {
        return text(`No learnings found for "${query}". This is uncharted territory!`);
      }

      const results = rows.map((r) => {
        const sim = r.sim_score != null ? ` | similarity: ${parseFloat(r.sim_score).toFixed(2)}` : "";
        return `[#${r.id}] (${r.topic}) ${r.repo || "global"} — ${r.content}\n  by: ${r.agent_name || "unknown"} | confidence: ${r.confidence}${sim} | ${r.created_at}`;
      });

      const note = method === "fuzzy" ? " (via fuzzy matching)" : "";
      return text(`Found ${rows.length} learnings${note}:\n\n${results.join("\n\n")}`);
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
      files_changed: z.array(z.string()).optional().describe("List of files changed"),
      agent_name: z.string().optional().describe("Your agent name"),
    },
    async ({ repo, sha, summary, files_changed, agent_name }) => {
      const agentId = await db.resolveAgentId(agent_name);
      const commit = await db.logCommit({ agentId, repo, sha, summary, filesChanged: files_changed });
      return text(`Commit ${sha.slice(0, 7)} logged for ${repo}: ${summary}`);
    }
  );

  // --- Get Repo Context ---
  server.tool(
    "get_repo_context",
    "Get all known context about a repo — recent learnings, commits, and open questions.",
    {
      repo: z.string().describe("Repo identifier"),
      limit: z.number().optional().describe("Max items per category (default 5)"),
    },
    async ({ repo, limit }) => {
      const { learnings, commits, questions } = await db.getRepoContext(repo, limit || 5);
      const sections = [];

      if (learnings.length > 0) {
        sections.push("## Learnings\n" + learnings.map(
          (l) => `- [${l.topic}] ${l.content} (by ${l.agent_name || "unknown"}, confidence: ${l.confidence})`
        ).join("\n"));
      }
      if (commits.length > 0) {
        sections.push("## Recent Commits\n" + commits.map(
          (c) => `- ${c.sha.slice(0, 7)}: ${c.summary} (by ${c.agent_name || "unknown"}, files: ${(c.files_changed || []).join(", ")})`
        ).join("\n"));
      }
      if (questions.length > 0) {
        sections.push("## Open Questions\n" + questions.map(
          (q) => `- ${q.question}${q.context ? ` (context: ${q.context})` : ""} — asked by ${q.agent_name || "unknown"}`
        ).join("\n"));
      }

      return text(sections.length > 0
        ? `# Context for ${repo}\n\n${sections.join("\n\n")}`
        : `No context found for ${repo} yet. You're the first agent here!`);
    }
  );

  // --- Ask Question ---
  server.tool(
    "ask_question",
    "Post a question for other agents to answer.",
    {
      question: z.string().describe("Your question"),
      repo: z.string().optional().describe("Relevant repo"),
      context: z.string().optional().describe("Additional context"),
      agent_name: z.string().optional().describe("Your agent name"),
    },
    async ({ question, repo, context, agent_name }) => {
      const agentId = await db.resolveAgentId(agent_name);
      const q = await db.askQuestion({ agentId, repo, question, context });
      return text(`Question #${q.id} posted. Other agents will see this when they check repo context.`);
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
      const agentId = await db.resolveAgentId(agent_name);
      await db.answerQuestion(question_id, answer, agentId);
      return text(`Question #${question_id} answered and marked resolved.`);
    }
  );

  // --- List Agents ---
  server.tool(
    "list_agents",
    "See which agents are registered and what repos they're working on.",
    {
      active_since_hours: z.number().optional().describe("Only show agents active in the last N hours (default 24)"),
    },
    async ({ active_since_hours }) => {
      const rows = await db.listAgents(active_since_hours || 24);
      if (rows.length === 0) {
        return text(`No agents active in the last ${active_since_hours || 24} hours.`);
      }
      const list = rows.map(
        (r) => `- #${r.id} ${r.name} → ${r.repo_url || "no repo"} (capabilities: ${(r.capabilities || []).join(", ") || "none"}, last seen: ${r.last_seen_at})`
      );
      return text(`${rows.length} active agents:\n\n${list.join("\n")}`);
    }
  );
}

function text(t) {
  return { content: [{ type: "text", text: t }] };
}
