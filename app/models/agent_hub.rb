require "net/http"
require "json"
require "uri"

class AgentHub
  TIMEOUT = 5.seconds

  class << self
    def post_learning(content:, topic:, repo: nil, agent_name: nil, confidence: 1.0)
      post("/api/v1/learnings", {
        content: content, topic: topic, repo: repo,
        agent_name: agent_name, confidence: confidence
      })
    end

    def log_commit(repo:, sha:, summary:, files_changed: [], agent_name: nil)
      post("/api/v1/commits", {
        repo: repo, sha: sha, summary: summary,
        files_changed: files_changed, agent_name: agent_name
      })
    end

    def register_agent(name:, repo_url: nil, capabilities: [])
      post("/api/v1/agents", {
        name: name, repo_url: repo_url, capabilities: capabilities
      })
    end

    private

    def post(path, body)
      uri = URI.join(base_url, path)
      request = Net::HTTP::Post.new(uri, "Content-Type" => "application/json")
      request["Authorization"] = "Bearer #{api_key}" if api_key.present?
      request.body = body.to_json

      http = Net::HTTP.new(uri.host, uri.port)
      http.use_ssl = (uri.scheme == "https")
      http.open_timeout = TIMEOUT
      http.read_timeout = TIMEOUT
      http.request(request)
    rescue Net::OpenTimeout, Net::ReadTimeout, Errno::ECONNREFUSED => e
      Rails.logger.warn "AgentHub request failed: #{e.message}"
      nil
    end

    def base_url
      ENV["AGENT_HUB_URL"] || "http://localhost:3100"
    end

    def api_key
      ENV["AGENT_HUB_API_KEY"]
    end
  end
end
