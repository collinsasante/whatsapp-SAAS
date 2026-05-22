-- ============================================================
-- Rename CallDirection values: INBOUND → INCOMING, OUTBOUND → OUTGOING
-- Remove INCOMING from CallStatus (direction carries that meaning now)
-- Add RECONNECTING, HOLD, VOICEMAIL to CallStatus
-- ============================================================

-- 1. Migrate existing direction data to new text values first
ALTER TABLE "call_logs" ALTER COLUMN "direction" TYPE text;
UPDATE "call_logs" SET direction = 'INCOMING' WHERE direction = 'INBOUND';
UPDATE "call_logs" SET direction = 'OUTGOING' WHERE direction = 'OUTBOUND';

-- 2. Drop old enum and recreate with new values
DROP TYPE "CallDirection";
CREATE TYPE "CallDirection" AS ENUM ('INCOMING', 'OUTGOING');
ALTER TABLE "call_logs" ALTER COLUMN "direction" TYPE "CallDirection"
  USING direction::"CallDirection";

-- 3. Drop default before changing status type, migrate INCOMING → RINGING
ALTER TABLE "call_logs" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "call_logs" ALTER COLUMN "status" TYPE text;
UPDATE "call_logs" SET status = 'RINGING' WHERE status = 'INCOMING';

-- 4. Drop old enum and recreate with full set
DROP TYPE "CallStatus";
CREATE TYPE "CallStatus" AS ENUM (
  'SCHEDULED', 'INITIATED', 'RINGING', 'ONGOING',
  'MISSED', 'DECLINED', 'CANCELED', 'UNANSWERED',
  'BUSY', 'FAILED', 'ENDED',
  'RECONNECTING', 'HOLD', 'VOICEMAIL'
);
ALTER TABLE "call_logs" ALTER COLUMN "status" TYPE "CallStatus"
  USING status::"CallStatus";
ALTER TABLE "call_logs" ALTER COLUMN "status" SET DEFAULT 'INITIATED'::"CallStatus";
