-- INACTIVITY was added to the shared AutomationTrigger enum and the inactivity worker (ce17ff8)
-- but never to the database enum, so the worker's query failed every run.
-- Additive and idempotent: existing rules are unaffected.
ALTER TYPE "AutomationTrigger" ADD VALUE IF NOT EXISTS 'INACTIVITY';
