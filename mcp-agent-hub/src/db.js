/**
 * Database layer — all queries against Neon pgvector.
 * Single source of truth for schema interactions.
 */
import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("WARNING: DATABASE_URL not set — database calls will fail");
}

const sql = DATABASE_URL ? neon(DATABASE_URL) : (() => { throw new Error("DATABASE_URL not configured"); });

// --- Trigram similarity threshold (0-1, lower = more fuzzy) ---
const TRIGRAM_THRESHOLD = 0.1;

// ========================
// Agents
// ========================

export async function registerAgent(name, repoUrl, capabilities) {
  const rows = await sql`
    INSERT INTO agents (name, repo_url, capabilities, last_seen_at)
    VALUES (${name}, ${repoUrl || null}, ${capabilities || []}, NOW())
    ON CONFLICT (name, repo_url) DO UPDATE SET
      capabilities = COALESCE(${capabilities?.length ? capabilities : null}, agents.capabilities),
      last_seen_at = NOW()
    RETURNING id, name, repo_url, capabilities, last_seen_at
  `;
  return rows[0];
}

export async function listAgents(activeSinceHours = 24) {
  return sql`
    SELECT id, name, repo_url, capabilities, last_seen_at, created_at
    FROM agents
    WHERE last_seen_at > NOW() - INTERVAL '1 hour' * ${activeSinceHours}
    ORDER BY last_seen_at DESC
  `;
}

export async function getAgentById(id) {
  const rows = await sql`SELECT * FROM agents WHERE id = ${id}`;
  return rows[0] || null;
}

export async function resolveAgentId(name) {
  if (!name) return null;
  const rows = await sql`SELECT id FROM agents WHERE name = ${name} LIMIT 1`;
  return rows.length > 0 ? rows[0].id : null;
}

export async function getAgentStats() {
  const rows = await sql`
    SELECT
      (SELECT COUNT(*) FROM agents) as total_agents,
      (SELECT COUNT(*) FROM agents WHERE last_seen_at > NOW() - INTERVAL '1 hour') as active_1h,
      (SELECT COUNT(*) FROM agents WHERE last_seen_at > NOW() - INTERVAL '24 hours') as active_24h,
      (SELECT COUNT(*) FROM learnings) as total_learnings,
      (SELECT COUNT(*) FROM commits) as total_commits,
      (SELECT COUNT(*) FROM questions WHERE resolved = FALSE) as open_questions,
      (SELECT COUNT(*) FROM questions WHERE resolved = TRUE) as resolved_questions
  `;
  return rows[0];
}

// ========================
// Learnings
// ========================

export async function postLearning({ agentId, repo, topic, content, confidence = 1.0 }) {
  const rows = await sql`
    INSERT INTO learnings (agent_id, repo, topic, content, confidence)
    VALUES (${agentId}, ${repo || null}, ${topic}, ${content}, ${confidence})
    RETURNING id, repo, topic, created_at
  `;
  return rows[0];
}

export async function searchLearningsExact({ query, topic, repo, limit = 10 }) {
  const conditions = [];
  if (repo && topic) {
    return sql`
      SELECT l.id, l.content, l.topic, l.repo, l.confidence, l.created_at,
             a.name as agent_name
      FROM learnings l LEFT JOIN agents a ON l.agent_id = a.id
      WHERE (l.repo = ${repo} OR l.repo IS NULL) AND l.topic = ${topic}
        AND l.content ILIKE ${"%" + query + "%"}
      ORDER BY l.confidence DESC, l.created_at DESC LIMIT ${limit}
    `;
  } else if (repo) {
    return sql`
      SELECT l.id, l.content, l.topic, l.repo, l.confidence, l.created_at,
             a.name as agent_name
      FROM learnings l LEFT JOIN agents a ON l.agent_id = a.id
      WHERE (l.repo = ${repo} OR l.repo IS NULL)
        AND l.content ILIKE ${"%" + query + "%"}
      ORDER BY l.confidence DESC, l.created_at DESC LIMIT ${limit}
    `;
  } else if (topic) {
    return sql`
      SELECT l.id, l.content, l.topic, l.repo, l.confidence, l.created_at,
             a.name as agent_name
      FROM learnings l LEFT JOIN agents a ON l.agent_id = a.id
      WHERE l.topic = ${topic} AND l.content ILIKE ${"%" + query + "%"}
      ORDER BY l.confidence DESC, l.created_at DESC LIMIT ${limit}
    `;
  } else {
    return sql`
      SELECT l.id, l.content, l.topic, l.repo, l.confidence, l.created_at,
             a.name as agent_name
      FROM learnings l LEFT JOIN agents a ON l.agent_id = a.id
      WHERE l.content ILIKE ${"%" + query + "%"}
      ORDER BY l.confidence DESC, l.created_at DESC LIMIT ${limit}
    `;
  }
}

export async function searchLearningsFuzzy({ query, topic, repo, limit = 10 }) {
  if (repo && topic) {
    return sql`
      SELECT l.id, l.content, l.topic, l.repo, l.confidence, l.created_at,
             a.name as agent_name, similarity(l.content, ${query}) AS sim_score
      FROM learnings l LEFT JOIN agents a ON l.agent_id = a.id
      WHERE (l.repo = ${repo} OR l.repo IS NULL) AND l.topic = ${topic}
        AND similarity(l.content, ${query}) > ${TRIGRAM_THRESHOLD}
      ORDER BY sim_score DESC, l.confidence DESC LIMIT ${limit}
    `;
  } else if (repo) {
    return sql`
      SELECT l.id, l.content, l.topic, l.repo, l.confidence, l.created_at,
             a.name as agent_name, similarity(l.content, ${query}) AS sim_score
      FROM learnings l LEFT JOIN agents a ON l.agent_id = a.id
      WHERE (l.repo = ${repo} OR l.repo IS NULL)
        AND similarity(l.content, ${query}) > ${TRIGRAM_THRESHOLD}
      ORDER BY sim_score DESC, l.confidence DESC LIMIT ${limit}
    `;
  } else if (topic) {
    return sql`
      SELECT l.id, l.content, l.topic, l.repo, l.confidence, l.created_at,
             a.name as agent_name, similarity(l.content, ${query}) AS sim_score
      FROM learnings l LEFT JOIN agents a ON l.agent_id = a.id
      WHERE l.topic = ${topic}
        AND similarity(l.content, ${query}) > ${TRIGRAM_THRESHOLD}
      ORDER BY sim_score DESC, l.confidence DESC LIMIT ${limit}
    `;
  } else {
    return sql`
      SELECT l.id, l.content, l.topic, l.repo, l.confidence, l.created_at,
             a.name as agent_name, similarity(l.content, ${query}) AS sim_score
      FROM learnings l LEFT JOIN agents a ON l.agent_id = a.id
      WHERE similarity(l.content, ${query}) > ${TRIGRAM_THRESHOLD}
      ORDER BY sim_score DESC, l.confidence DESC LIMIT ${limit}
    `;
  }
}

export async function searchLearnings(params) {
  let rows = await searchLearningsExact(params);
  let method = "exact";
  if (rows.length === 0) {
    rows = await searchLearningsFuzzy(params);
    method = "fuzzy";
  }
  return { rows, method };
}

// ========================
// Commits
// ========================

export async function logCommit({ agentId, repo, sha, summary, filesChanged = [] }) {
  const rows = await sql`
    INSERT INTO commits (agent_id, repo, sha, summary, files_changed)
    VALUES (${agentId}, ${repo}, ${sha}, ${summary}, ${filesChanged})
    ON CONFLICT (repo, sha) DO UPDATE SET summary = ${summary}
    RETURNING id, repo, sha, created_at
  `;
  return rows[0];
}

export async function getRecentCommits(repo, limit = 10) {
  return sql`
    SELECT c.id, c.sha, c.summary, c.files_changed, c.created_at,
           a.name as agent_name
    FROM commits c LEFT JOIN agents a ON c.agent_id = a.id
    WHERE c.repo = ${repo}
    ORDER BY c.created_at DESC LIMIT ${limit}
  `;
}

// ========================
// Questions
// ========================

export async function askQuestion({ agentId, repo, question, context }) {
  const rows = await sql`
    INSERT INTO questions (agent_id, repo, question, context)
    VALUES (${agentId}, ${repo || null}, ${question}, ${context || null})
    RETURNING id, repo, created_at
  `;
  return rows[0];
}

export async function answerQuestion(questionId, answer, answeredById) {
  await sql`
    UPDATE questions
    SET resolved = TRUE, answer = ${answer}, answered_by = ${answeredById}, resolved_at = NOW()
    WHERE id = ${questionId}
  `;
}

export async function getOpenQuestions(repo, limit = 10) {
  if (repo) {
    return sql`
      SELECT q.id, q.question, q.context, q.repo, q.created_at,
             a.name as agent_name
      FROM questions q LEFT JOIN agents a ON q.agent_id = a.id
      WHERE (q.repo = ${repo} OR q.repo IS NULL) AND q.resolved = FALSE
      ORDER BY q.created_at DESC LIMIT ${limit}
    `;
  }
  return sql`
    SELECT q.id, q.question, q.context, q.repo, q.created_at,
           a.name as agent_name
    FROM questions q LEFT JOIN agents a ON q.agent_id = a.id
    WHERE q.resolved = FALSE
    ORDER BY q.created_at DESC LIMIT ${limit}
  `;
}

// ========================
// Repo Context (aggregate)
// ========================

export async function getRepoContext(repo, limit = 5) {
  const [learnings, commits, questions] = await Promise.all([
    sql`
      SELECT l.content, l.topic, l.confidence, a.name as agent_name, l.created_at
      FROM learnings l LEFT JOIN agents a ON l.agent_id = a.id
      WHERE l.repo = ${repo} OR l.repo IS NULL
      ORDER BY l.created_at DESC LIMIT ${limit}
    `,
    sql`
      SELECT c.sha, c.summary, c.files_changed, a.name as agent_name, c.created_at
      FROM commits c LEFT JOIN agents a ON c.agent_id = a.id
      WHERE c.repo = ${repo}
      ORDER BY c.created_at DESC LIMIT ${limit}
    `,
    sql`
      SELECT q.id, q.question, q.context, q.resolved, q.answer, a.name as agent_name
      FROM questions q LEFT JOIN agents a ON q.agent_id = a.id
      WHERE (q.repo = ${repo} OR q.repo IS NULL) AND q.resolved = FALSE
      ORDER BY q.created_at DESC LIMIT ${limit}
    `,
  ]);
  return { learnings, commits, questions };
}

// ========================
// Activity Feed
// ========================

export async function getActivityFeed(limit = 50) {
  return sql`
    SELECT * FROM (
      SELECT 'learning' as type, l.id, l.content as summary, l.repo, l.topic,
             a.name as agent_name, l.created_at
      FROM learnings l LEFT JOIN agents a ON l.agent_id = a.id
      UNION ALL
      SELECT 'commit' as type, c.id, c.summary, c.repo, NULL as topic,
             a.name as agent_name, c.created_at
      FROM commits c LEFT JOIN agents a ON c.agent_id = a.id
      UNION ALL
      SELECT 'question' as type, q.id, q.question as summary, q.repo, NULL as topic,
             a.name as agent_name, q.created_at
      FROM questions q LEFT JOIN agents a ON q.agent_id = a.id
    ) activity
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
}

export { sql };
