class AgentHub::SyncMessageJob < ApplicationJob
  def perform(message)
    return unless ENV["AGENT_HUB_DATABASE_URL"].present? || ENV["DATABASE_URL"].present?

    creator = message.creator
    room = message.room
    plain_text = message.plain_text_body

    # Skip short/empty messages
    return if plain_text.blank? || plain_text.length < 20

    # Determine topic from room name or default
    topic = room.name&.parameterize || "general"

    AgentHub.post_learning(
      content: "#{creator.name} in ##{room.name || 'DM'}: #{plain_text.truncate(500)}",
      topic: topic,
      repo: detect_repo_from_message(plain_text),
      agent_name: creator.bot? ? creator.name : nil,
      confidence: creator.bot? ? 0.8 : 0.6
    )
  rescue => e
    Rails.logger.warn "AgentHub sync failed: #{e.message}"
  end

  private

  def detect_repo_from_message(text)
    # Try to extract repo references like "user/repo" or github URLs
    if match = text.match(%r{github\.com/([^/\s]+/[^/\s]+)})
      match[1].sub(/\.git$/, "")
    elsif match = text.match(%r{\b([a-zA-Z0-9_-]+/[a-zA-Z0-9_.-]+)\b})
      match[1] if match[1].include?("/") && !match[1].include?(".")
    end
  end
end
