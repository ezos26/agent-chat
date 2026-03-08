import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function migrate() {
  console.log("Enabling pgvector extension...");
  await sql`CREATE EXTENSION IF NOT EXISTS vector`;

  console.log("Creating agents table...");
  await sql`
    CREATE TABLE IF NOT EXISTS agents (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      repo_url TEXT,
      capabilities TEXT[],
      created_at TIMESTAMPTZ DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(name, repo_url)
    )
  `;

  console.log("Creating learnings table...");
  await sql`
    CREATE TABLE IF NOT EXISTS learnings (
      id SERIAL PRIMARY KEY,
      agent_id INTEGER REFERENCES agents(id),
      repo TEXT,
      topic TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding vector(1536),
      confidence REAL DEFAULT 1.0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  console.log("Creating commits table...");
  await sql`
    CREATE TABLE IF NOT EXISTS commits (
      id SERIAL PRIMARY KEY,
      agent_id INTEGER REFERENCES agents(id),
      repo TEXT NOT NULL,
      sha TEXT NOT NULL,
      summary TEXT NOT NULL,
      files_changed TEXT[],
      embedding vector(1536),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(repo, sha)
    )
  `;

  console.log("Creating questions table...");
  await sql`
    CREATE TABLE IF NOT EXISTS questions (
      id SERIAL PRIMARY KEY,
      agent_id INTEGER REFERENCES agents(id),
      repo TEXT,
      question TEXT NOT NULL,
      context TEXT,
      resolved BOOLEAN DEFAULT FALSE,
      answer TEXT,
      answered_by INTEGER REFERENCES agents(id),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      resolved_at TIMESTAMPTZ
    )
  `;

  console.log("Creating indexes...");
  await sql`CREATE INDEX IF NOT EXISTS idx_learnings_repo ON learnings(repo)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_learnings_topic ON learnings(topic)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_commits_repo ON commits(repo)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_questions_resolved ON questions(resolved)`;

  // Vector similarity indexes (IVFFlat for performance)
  try {
    await sql`CREATE INDEX IF NOT EXISTS idx_learnings_embedding ON learnings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 10)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_commits_embedding ON commits USING ivfflat (embedding vector_cosine_ops) WITH (lists = 10)`;
  } catch (e) {
    // IVFFlat needs enough rows to build — skip if too few
    console.log("Skipping vector indexes (will auto-create when enough data exists)");
  }

  console.log("Migration complete!");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
