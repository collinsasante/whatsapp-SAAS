-- Versioned disclosure acknowledgement for AI Learning. Additive and nullable: a row with no acknowledgement is simply not eligible to
-- learn (fail-safe), so no existing row can start learning because of this migration.
ALTER TABLE "ai_learning_settings"
    ADD COLUMN "disclosure_version" TEXT,
    ADD COLUMN "disclosure_acknowledged_at" TIMESTAMP(3),
    ADD COLUMN "disclosure_acknowledged_by_id" TEXT;
