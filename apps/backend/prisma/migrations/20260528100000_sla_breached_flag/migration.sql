-- Add sla_breached flag to conversations
-- Allows the SLA monitor worker to track which conversations have already
-- had a breach notification emitted, preventing repeated alerts.
ALTER TABLE "conversations" ADD COLUMN "sla_breached" BOOLEAN NOT NULL DEFAULT false;
