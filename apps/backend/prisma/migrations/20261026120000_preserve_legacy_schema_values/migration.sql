BEGIN;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'conversation_events'
          AND column_name = 'metadata'
    ) THEN
        EXECUTE $sql$
            UPDATE "conversation_events"
            SET "payload" = "metadata"
            WHERE "metadata" IS NOT NULL
              AND "metadata" <> '{}'::jsonb
              AND "payload" = '{}'::jsonb
        $sql$;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'feature_flags'
          AND column_name = 'rollout_type'
    ) THEN
        EXECUTE $sql$
            UPDATE "feature_flags"
            SET "rolloutType" = "rollout_type"
            WHERE "rollout_type" IS NOT NULL
              AND "rollout_type" <> 'all'
              AND "rolloutType" = 'all'
        $sql$;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'platform_settings'
          AND column_name = 'updatedBy'
    ) THEN
        EXECUTE $sql$
            UPDATE "platform_settings"
            SET "updated_by" = "updatedBy"
            WHERE "updatedBy" IS NOT NULL
              AND "updated_by" IS NULL
        $sql$;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'canned_responses'
          AND column_name = 'category'
    ) THEN
        INSERT INTO "canned_response_categories"
            ("id", "tenant_id", "name", "created_at", "updated_at")
        SELECT gen_random_uuid()::text, source."tenant_id", source.category_name, now(), now()
        FROM (
            SELECT DISTINCT "tenant_id", "category" AS category_name
            FROM "canned_responses"
            WHERE NULLIF(btrim("category"), '') IS NOT NULL
        ) source
        ON CONFLICT ("tenant_id", "name") DO NOTHING;

        EXECUTE $sql$
            UPDATE "canned_responses" response
            SET "category_id" = category."id"
            FROM "canned_response_categories" category
            WHERE response."category_id" IS NULL
              AND response."category" = category."name"
              AND response."tenant_id" = category."tenant_id"
        $sql$;
    END IF;
END $$;

COMMIT;
