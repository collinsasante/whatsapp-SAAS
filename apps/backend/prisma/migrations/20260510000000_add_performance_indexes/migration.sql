-- Performance indexes for common query patterns
CREATE INDEX IF NOT EXISTS conversations_tenant_id_status_last_message_at_idx ON conversations(tenant_id, status, last_message_at);
CREATE INDEX IF NOT EXISTS messages_conversation_id_created_at_idx ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS messages_tenant_id_media_url_idx ON messages(tenant_id, media_url);
