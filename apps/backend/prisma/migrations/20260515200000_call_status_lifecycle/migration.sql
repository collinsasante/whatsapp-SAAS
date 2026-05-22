-- Migration: call_status_lifecycle
-- Replaces the old CallStatus enum values with a proper finite-state machine.
-- Uses full rename/recreate pattern so all values are available in the same transaction.

-- Step 1: Create new enum with all values
CREATE TYPE "CallStatus_new" AS ENUM (
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

-- Step 2: Drop column default so the type cast can proceed
ALTER TABLE call_logs ALTER COLUMN status DROP DEFAULT;

-- Step 3: Migrate existing data (cast through text to new enum)
ALTER TABLE call_logs
  ALTER COLUMN status TYPE "CallStatus_new" USING (
    CASE status::text
      WHEN 'ANSWERED'    THEN 'ONGOING'
      WHEN 'COMPLETED'   THEN 'ENDED'
      WHEN 'CANCELLED'   THEN 'CANCELED'
      WHEN 'TRANSFERRED' THEN 'ENDED'
      ELSE status::text
    END
  )::"CallStatus_new";

-- Step 4: Restore the default with the new type
ALTER TABLE call_logs ALTER COLUMN status SET DEFAULT 'INITIATED'::"CallStatus_new";

-- Step 5: Drop old enum and rename new one
DROP TYPE "CallStatus";
ALTER TYPE "CallStatus_new" RENAME TO "CallStatus";
