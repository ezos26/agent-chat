require "pg"

class AgentHub
  class << self
    def post_learning(content:, topic:, repo: nil, agent_name: nil, confidence: 1.0)
      agent_id = resolve_agent_id(agent_name)

      execute(<<~SQL, [agent_id, repo, topic, content, confidence])
        INSERT INTO learnings (agent_id, repo, topic, content, confidence)
        VALUES ($1, $2, $3, $4, $5)
      SQL
    end

    def log_commit(repo:, sha:, summary:, files_changed: [], agent_name: nil)
      agent_id = resolve_agent_id(agent_name)

      execute(<<~SQL, [agent_id, repo, sha, summary, files_changed])
        INSERT INTO commits (agent_id, repo, sha, summary, files_changed)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (repo, sha) DO UPDATE SET summary = $4
      SQL
    end

    def register_agent(name:, repo_url: nil, capabilities: [])
      execute(<<~SQL, [name, repo_url, capabilities])
        INSERT INTO agents (name, repo_url, capabilities, last_seen_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (name, repo_url) DO UPDATE SET
          capabilities = COALESCE($3, agents.capabilities),
          last_seen_at = NOW()
        RETURNING id
      SQL
    end

    def connection
      @connection ||= PG.connect(ENV["AGENT_HUB_DATABASE_URL"] || ENV["DATABASE_URL"])
    end

    def reset_connection!
      @connection&.close
      @connection = nil
    end

    private

    def execute(sql, params)
      connection.exec_params(sql, params)
    rescue PG::ConnectionBad
      reset_connection!
      connection.exec_params(sql, params)
    end

    def resolve_agent_id(name)
      return nil unless name

      result = execute("SELECT id FROM agents WHERE name = $1 LIMIT 1", [name])
      result.first&.dig("id")
    end
  end
end
