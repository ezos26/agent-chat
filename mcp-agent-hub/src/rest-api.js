/**
 * REST API routes — for scripts, CI pipelines, webhooks, and dashboards.
 * These complement the MCP tools with standard HTTP endpoints.
 */
import { Router } from "express";
import * as db from "./db.js";

const router = Router();

// Wrap async route handlers to forward errors to Express error handler
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// ========================
// Health & Dashboard
// ========================

router.get("/health", async (req, res) => {
  try {
    const stats = await db.getAgentStats();
    res.json({
      status: "ok",
      version: "1.0.0",
      uptime: process.uptime(),
      stats,
    });
  } catch (err) {
    res.status(503).json({ status: "error", error: err.message });
  }
});

router.get("/stats", wrap(async (req, res) => {
  const stats = await db.getAgentStats();
  res.json(stats);
}));

router.get("/feed", wrap(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const feed = await db.getActivityFeed(limit);
  res.json({ items: feed, count: feed.length });
}));

// ========================
// Agents
// ========================

router.post("/agents", wrap(async (req, res) => {
  const { name, repo_url, capabilities } = req.body;
  if (!name) return res.status(400).json({ error: "name is required" });

  const agent = await db.registerAgent(name, repo_url, capabilities);
  res.status(201).json(agent);
}));

router.get("/agents", wrap(async (req, res) => {
  const hours = parseInt(req.query.active_since_hours) || 24;
  const agents = await db.listAgents(hours);
  res.json({ agents, count: agents.length });
}));

// ========================
// Learnings
// ========================

router.post("/learnings", wrap(async (req, res) => {
  const { content, topic, repo, agent_name, confidence } = req.body;
  if (!content || !topic) {
    return res.status(400).json({ error: "content and topic are required" });
  }

  const agentId = await db.resolveAgentId(agent_name);
  const learning = await db.postLearning({ agentId, repo, topic, content, confidence });
  res.status(201).json(learning);
}));

router.get("/learnings/search", wrap(async (req, res) => {
  const { query, topic, repo, limit } = req.query;
  if (!query) return res.status(400).json({ error: "query parameter is required" });

  const { rows, method } = await db.searchLearnings({
    query,
    topic,
    repo,
    limit: Math.min(parseInt(limit) || 10, 100),
  });
  res.json({ results: rows, method, count: rows.length });
}));

// ========================
// Commits
// ========================

router.post("/commits", wrap(async (req, res) => {
  const { repo, sha, summary, files_changed, agent_name } = req.body;
  if (!repo || !sha || !summary) {
    return res.status(400).json({ error: "repo, sha, and summary are required" });
  }

  const agentId = await db.resolveAgentId(agent_name);
  const commit = await db.logCommit({ agentId, repo, sha, summary, filesChanged: files_changed });
  res.status(201).json(commit);
}));

router.get("/commits/:repo", wrap(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 10, 100);
  const commits = await db.getRecentCommits(req.params.repo, limit);
  res.json({ commits, count: commits.length });
}));

// ========================
// Questions
// ========================

router.post("/questions", wrap(async (req, res) => {
  const { question, repo, context, agent_name } = req.body;
  if (!question) return res.status(400).json({ error: "question is required" });

  const agentId = await db.resolveAgentId(agent_name);
  const q = await db.askQuestion({ agentId, repo, question, context });
  res.status(201).json(q);
}));

router.post("/questions/:id/answer", wrap(async (req, res) => {
  const { answer, agent_name } = req.body;
  if (!answer) return res.status(400).json({ error: "answer is required" });

  const agentId = await db.resolveAgentId(agent_name);
  await db.answerQuestion(parseInt(req.params.id), answer, agentId);
  res.json({ status: "resolved" });
}));

router.get("/questions", wrap(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 10, 100);
  const questions = await db.getOpenQuestions(req.query.repo, limit);
  res.json({ questions, count: questions.length });
}));

// ========================
// Repo Context
// ========================

router.get("/repos/:repo/context", wrap(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 5, 50);
  const context = await db.getRepoContext(req.params.repo, limit);
  res.json(context);
}));

export default router;
