class CreateSabbaticSchema < ActiveRecord::Migration[8.2]
  def change
    # Create accounts table
    create_table "accounts", force: :cascade do |t|
      t.string "name", null: false
      t.string "join_code", null: false
      t.text "custom_styles"
      t.json "settings"
      t.integer "singleton_guard", default: 0, null: false
      t.datetime "created_at", null: false
      t.datetime "updated_at", null: false
      t.index ["singleton_guard"], name: "index_accounts_on_singleton_guard", unique: true
    end

    # Create users table with bot support
    create_table "users", force: :cascade do |t|
      t.string "name", null: false
      t.string "email_address"
      t.string "password_digest"
      t.text "bio"
      t.integer "role", default: 0, null: false
      t.integer "status", default: 0, null: false
      t.string "bot_token"
      t.datetime "created_at", null: false
      t.datetime "updated_at", null: false
      t.index ["email_address"], name: "index_users_on_email_address", unique: true
      t.index ["bot_token"], name: "index_users_on_bot_token", unique: true
    end

    # Create webhooks table for bot integrations
    create_table "webhooks", force: :cascade do |t|
      t.integer "user_id", null: false
      t.string "url"
      t.datetime "created_at", null: false
      t.datetime "updated_at", null: false
      t.index ["user_id"], name: "index_webhooks_on_user_id"
    end

    # Create rooms table
    create_table "rooms", force: :cascade do |t|
      t.bigint "creator_id", null: false
      t.string "name"
      t.string "type", null: false
      t.datetime "created_at", null: false
      t.datetime "updated_at", null: false
    end

    # Create memberships table
    create_table "memberships", force: :cascade do |t|
      t.integer "user_id", null: false
      t.integer "room_id", null: false
      t.string "involvement", default: "mentions"
      t.integer "connections", default: 0, null: false
      t.datetime "connected_at"
      t.datetime "unread_at"
      t.datetime "created_at", null: false
      t.datetime "updated_at", null: false
      t.index ["room_id", "user_id"], name: "index_memberships_on_room_id_and_user_id", unique: true
      t.index ["room_id", "created_at"], name: "index_memberships_on_room_id_and_created_at"
      t.index ["room_id"], name: "index_memberships_on_room_id"
      t.index ["user_id"], name: "index_memberships_on_user_id"
    end

    # Create messages table
    create_table "messages", force: :cascade do |t|
      t.integer "room_id", null: false
      t.integer "creator_id", null: false
      t.string "client_message_id", null: false
      t.datetime "created_at", null: false
      t.datetime "updated_at", null: false
      t.index ["creator_id"], name: "index_messages_on_creator_id"
      t.index ["room_id"], name: "index_messages_on_room_id"
    end

    # Create boosts table
    create_table "boosts", force: :cascade do |t|
      t.integer "message_id", null: false
      t.integer "booster_id", null: false
      t.string "content", limit: 16, null: false
      t.datetime "created_at", null: false
      t.datetime "updated_at", null: false
      t.index ["message_id"], name: "index_boosts_on_message_id"
      t.index ["booster_id"], name: "index_boosts_on_booster_id"
    end

    # Create sessions table
    create_table "sessions", force: :cascade do |t|
      t.integer "user_id", null: false
      t.string "token", null: false
      t.string "ip_address"
      t.string "user_agent"
      t.datetime "last_active_at", null: false
      t.datetime "created_at", null: false
      t.datetime "updated_at", null: false
      t.index ["token"], name: "index_sessions_on_token", unique: true
      t.index ["user_id"], name: "index_sessions_on_user_id"
    end

    # Create searches table
    create_table "searches", force: :cascade do |t|
      t.integer "user_id", null: false
      t.string "query", null: false
      t.datetime "created_at", null: false
      t.datetime "updated_at", null: false
      t.index ["user_id"], name: "index_searches_on_user_id"
    end

    # Create push subscriptions table
    create_table "push_subscriptions", force: :cascade do |t|
      t.integer "user_id", null: false
      t.string "endpoint"
      t.string "p256dh_key"
      t.string "auth_key"
      t.string "user_agent"
      t.datetime "created_at", null: false
      t.datetime "updated_at", null: false
      t.index ["user_id"], name: "index_push_subscriptions_on_user_id"
      t.index ["endpoint", "p256dh_key", "auth_key"], name: "idx_on_endpoint_p256dh_key_auth_key_7553014576"
    end

    # Create bans table
    create_table "bans", force: :cascade do |t|
      t.integer "user_id", null: false
      t.string "ip_address", null: false
      t.datetime "created_at", null: false
      t.datetime "updated_at", null: false
      t.index ["user_id"], name: "index_bans_on_user_id"
      t.index ["ip_address"], name: "index_bans_on_ip_address"
    end

    # Action Text tables
    create_table "action_text_rich_texts", force: :cascade do |t|
      t.string "name", null: false
      t.text "body"
      t.string "record_type", null: false
      t.bigint "record_id", null: false
      t.datetime "created_at", null: false
      t.datetime "updated_at", null: false
      t.index ["record_type", "record_id", "name"], name: "index_action_text_rich_texts_uniqueness", unique: true
    end

    # Active Storage tables
    create_table "active_storage_blobs", force: :cascade do |t|
      t.string "key", null: false
      t.string "filename", null: false
      t.string "content_type"
      t.text "metadata"
      t.string "service_name", null: false
      t.bigint "byte_size", null: false
      t.string "checksum"
      t.datetime "created_at", null: false
      t.index ["key"], name: "index_active_storage_blobs_on_key", unique: true
    end

    create_table "active_storage_attachments", force: :cascade do |t|
      t.string "name", null: false
      t.string "record_type", null: false
      t.bigint "record_id", null: false
      t.bigint "blob_id", null: false
      t.datetime "created_at", null: false
      t.index ["record_type", "record_id", "name", "blob_id"], name: "index_active_storage_attachments_uniqueness", unique: true
      t.index ["blob_id"], name: "index_active_storage_attachments_on_blob_id"
    end

    create_table "active_storage_variant_records", force: :cascade do |t|
      t.bigint "blob_id", null: false
      t.string "variation_digest", null: false
      t.index ["blob_id", "variation_digest"], name: "index_active_storage_variant_records_uniqueness", unique: true
    end

    # Add foreign keys
    add_foreign_key "active_storage_attachments", "active_storage_blobs", column: "blob_id"
    add_foreign_key "active_storage_variant_records", "active_storage_blobs", column: "blob_id"
    add_foreign_key "bans", "users"
    add_foreign_key "boosts", "messages"
    add_foreign_key "messages", "rooms"
    add_foreign_key "messages", "users", column: "creator_id"
    add_foreign_key "push_subscriptions", "users"
    add_foreign_key "searches", "users"
    add_foreign_key "sessions", "users"
    add_foreign_key "webhooks", "users"

    # Create virtual table for message search
    create_virtual_table "message_search_index", "fts5", ["body", "tokenize=porter"]
  end
end