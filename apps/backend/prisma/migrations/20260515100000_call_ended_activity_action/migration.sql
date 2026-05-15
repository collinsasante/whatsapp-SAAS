-- Add CALL_ENDED to ActivityAction enum
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'CALL_ENDED';
