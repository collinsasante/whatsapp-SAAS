-- Migration: call_status_lifecycle
-- Replaces the old CallStatus enum values with a proper finite-state machine:
--   Old: SCHEDULED, INITIATED, RINGING, ANSWERED, MISSED, FAILED, COMPLETED, CANCELLED, TRANSFERRED
--   New: SCHEDULED, INITIATED, RINGING, INCOMING, ONGOING, MISSED, DECLINED, CANCELED, UNANSWERED, BUSY, FAILED, ENDED

-- Step 1: Add all new enum values to the existing type
ALTER TYPE "CallStatus" ADD VALUE IF NOT EXISTS 'INCOMING';
ALTER TYPE "CallStatus" ADD VALUE IF NOT EXISTS 'ONGOING';
ALTER TYPE "CallStatus" ADD VALUE IF NOT EXISTS 'DECLINED';
ALTER TYPE "CallStatus" ADD VALUE IF NOT EXISTS 'CANCELED';
ALTER TYPE "CallStatus" ADD VALUE IF NOT EXISTS 'UNANSWERED';
ALTER TYPE "CallStatus" ADD VALUE IF NOT EXISTS 'BUSY';
ALTER TYPE "CallStatus" ADD VALUE IF NOT EXISTS 'ENDED';

-- Step 2: Migrate existing data to new values
-- ANSWERED -> ONGOING (call was active)
UPDATE call_logs SET status = 'ONGOING' WHERE status = 'ANSWERED';
-- COMPLETED -> ENDED (call finished normally)
UPDATE call_logs SET status = 'ENDED' WHERE status = 'COMPLETED';
-- CANCELLED -> CANCELED (spelling standardised)
UPDATE call_logs SET status = 'CANCELED' WHERE status = 'CANCELLED';
-- TRANSFERRED -> ENDED (transferred calls are effectively over for original leg)
UPDATE call_logs SET status = 'ENDED' WHERE status = 'TRANSFERRED';

-- Step 3: Recreate the enum without the old values
--   Postgres doesn't support DROP VALUE, so we use the rename/recreate pattern.
ALTER TYPE "CallStatus" RENAME TO "CallStatus_old";

CREATE TYPE "CallStatus" AS ENUM (
  'SCHEDULED',
  'INITIATED',
  'RINGING',
  'INCOMING',
  'ONGOING',
  'MISSED',
  'DECLINED',
  'CANCELED',
  'UNANSWERED',
  'BUSY',
  'FAILED',
  'ENDED'
);

ALTER TABLE call_logs
  ALTER COLUMN status TYPE "CallStatus" USING status::text::"CallStatus";

DROP TYPE "CallStatus_old";
