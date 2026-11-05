-- Individual agent consent for Digital Self. Additive: nothing is dropped or rewritten, every existing profile and learning event is kept.
--
-- Every existing row starts PENDING, deliberately: no earlier record (including the workspace-level opt-in and any consent created through the API
-- on someone's behalf) is treated as the agent's own agreement. Until an agent decides, no new evidence is learned from them and their profile is
-- not used or assignable; what was already learned stays in place until that agent, or an authorised deletion request, removes it.
CREATE TYPE "DigitalSelfConsentStatus" AS ENUM ('PENDING', 'GRANTED', 'DECLINED', 'WITHDRAWN');

ALTER TABLE "digital_selves"
  ADD COLUMN "consent_status" "DigitalSelfConsentStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "consent_version" TEXT,
  ADD COLUMN "consent_decided_at" TIMESTAMP(3),
  ADD COLUMN "consent_decided_by_id" TEXT;

-- A decision is only valid when the person who made it is the agent the profile belongs to. Enforced by the database, so it holds for any writer.
-- The explicit IS NOT NULL matters: a CHECK passes when its expression is NULL, and "NULL = user_id" is NULL, so without it a decision with no recorded
-- decider would be accepted.
ALTER TABLE "digital_selves"
  ADD CONSTRAINT "digital_selves_consent_by_self_chk"
  CHECK ("consent_status" = 'PENDING' OR ("consent_decided_by_id" IS NOT NULL AND "consent_decided_by_id" = "user_id"));
