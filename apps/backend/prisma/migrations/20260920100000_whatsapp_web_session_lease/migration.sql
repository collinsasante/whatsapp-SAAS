-- Single-owner lease for a WhatsAppWebSession's live Baileys socket.
-- Purely additive: two nullable columns, no data destroyed, no existing
-- constraint tightened. apps/whatsapp-web claims a session via a
-- conditional UPDATE before opening a connection, and renews the lease on a
-- heartbeat while the socket is active -- prevents two instances of the
-- service from ever running the same session concurrently if it's ever
-- scaled beyond one replica. A stale lease (no heartbeat within the
-- timeout) is free for any instance to reclaim.

ALTER TABLE "whatsapp_web_sessions" ADD COLUMN "owner_instance_id" TEXT;
ALTER TABLE "whatsapp_web_sessions" ADD COLUMN "lock_heartbeat_at" TIMESTAMP(3);
