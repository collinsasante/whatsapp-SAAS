\set ON_ERROR_STOP on

SELECT 'conversation_events_metadata_nonempty' AS check_name, count(*) AS row_count
FROM "conversation_events"
WHERE "metadata" IS NOT NULL AND "metadata" <> '{}'::jsonb
UNION ALL
SELECT 'feature_flags_nondefault_rollout_type', count(*)
FROM "feature_flags"
WHERE "rollout_type" IS NOT NULL AND "rollout_type" <> 'all'
UNION ALL
SELECT 'platform_settings_updatedBy_nonnull', count(*)
FROM "platform_settings"
WHERE "updatedBy" IS NOT NULL
UNION ALL
SELECT 'canned_responses_legacy_category_nonempty', count(*)
FROM "canned_responses"
WHERE NULLIF(btrim("category"), '') IS NOT NULL
UNION ALL
SELECT 'tenant_whatsapp_credentials_without_number_row', count(*)
FROM "tenants" t
WHERE t."phone_number_id" IS NOT NULL
  AND t."waba_id" IS NOT NULL
  AND t."access_token" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "whatsapp_numbers" n
    WHERE n."tenant_id" = t."id"
      AND n."phone_number_id" = t."phone_number_id"
  )
UNION ALL
SELECT 'campaign_rows_before_multi_account_attribution', count(*)
FROM "campaigns";

DO $$
DECLARE
  conflict_details TEXT;
  billing_migration_pending BOOLEAN;
  whatsapp_channel_migration_pending BOOLEAN;
BEGIN
  SELECT string_agg(
    format('tenant_id=%s whatsapp_message_id=%s message_ids=%s',
      duplicate."tenant_id", duplicate."whatsapp_message_id", duplicate.message_ids),
    E'\n'
  )
  INTO conflict_details
  FROM (
    SELECT "tenant_id", "whatsapp_message_id",
           string_agg("id", ', ' ORDER BY "id") AS message_ids
    FROM "messages"
    WHERE "whatsapp_message_id" IS NOT NULL
    GROUP BY "tenant_id", "whatsapp_message_id"
    HAVING count(*) > 1
  ) duplicate;

  IF conflict_details IS NOT NULL THEN
    RAISE EXCEPTION 'Schema-drift migration requires unique WhatsApp message IDs:%', E'\n' || conflict_details;
  END IF;

  whatsapp_channel_migration_pending :=
    to_regclass('public._prisma_migrations') IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM "_prisma_migrations"
      WHERE "migration_name" = '20260915120000_whatsapp_multi_account_channels'
        AND "finished_at" IS NOT NULL
        AND "rolled_back_at" IS NULL
    );

  IF whatsapp_channel_migration_pending
     AND to_regclass('public.whatsapp_numbers') IS NOT NULL
     AND to_regclass('public.channels') IS NOT NULL
     AND to_regclass('public.conversations') IS NOT NULL THEN
    SELECT string_agg(
      format(
        'tenant_id=%s whatsapp_number_id=%s label=%s phone_number_id=%s candidate_channel_ids=%s',
        ambiguous.tenant_id, ambiguous.number_id, ambiguous.label,
        ambiguous.phone_number_id, ambiguous.channel_ids
      ),
      E'\n'
    )
    INTO conflict_details
    FROM (
      SELECT n."tenant_id", n."id" AS number_id, n."label",
             n."phone_number_id",
             string_agg(c."id", ', ' ORDER BY c."created_at", c."id") AS channel_ids
      FROM "whatsapp_numbers" n
      JOIN "channels" c
        ON c."tenant_id" = n."tenant_id"
       AND c."type" = 'WHATSAPP'
      GROUP BY n."tenant_id", n."id", n."label", n."phone_number_id"
      HAVING count(*) <> 1
         OR NOT bool_or(
           c."name" = n."label"
           OR COALESCE(c."credentials"->>'phoneNumberId' = n."phone_number_id", false)
           OR EXISTS (
             SELECT 1
             FROM "conversations" conversation
             WHERE conversation."whatsapp_number_id" = n."id"
               AND conversation."channel_id" = c."id"
           )
         )
    ) ambiguous;

    IF conflict_details IS NOT NULL THEN
      RAISE EXCEPTION
        'WhatsApp channel backfill would reuse a channel without a unique, evidence-backed association. Resolve these records before migration:%',
        E'\n' || conflict_details;
    END IF;
  END IF;

  IF to_regclass('public.channels') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'channels' AND column_name = 'credentials'
     ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'channels' AND column_name = 'external_id'
    ) THEN
      EXECUTE $query$
        SELECT string_agg(
          format('tenant_id=%s type=%s external_id=%s channel_ids=%s',
            duplicate.tenant_id, duplicate.type, duplicate.external_id, duplicate.channel_ids),
          E'\n'
        )
        FROM (
          SELECT "tenant_id" AS tenant_id, "type"::text AS type,
                 COALESCE(NULLIF("external_id", ''), NULLIF("credentials"->>'externalId', '')) AS external_id,
                 string_agg("id", ', ' ORDER BY "id") AS channel_ids
          FROM "channels"
          GROUP BY "tenant_id", "type",
                   COALESCE(NULLIF("external_id", ''), NULLIF("credentials"->>'externalId', ''))
          HAVING COALESCE(NULLIF("external_id", ''), NULLIF("credentials"->>'externalId', '')) IS NOT NULL
             AND count(*) > 1
        ) duplicate
      $query$ INTO conflict_details;
    ELSE
      EXECUTE $query$
      SELECT string_agg(
        format('tenant_id=%s type=%s external_id=%s channel_ids=%s',
          duplicate.tenant_id, duplicate.type, duplicate.external_id, duplicate.channel_ids),
        E'\n'
      )
      FROM (
        SELECT "tenant_id" AS tenant_id, "type"::text AS type,
               "credentials"->>'externalId' AS external_id,
               string_agg("id", ', ' ORDER BY "id") AS channel_ids
        FROM "channels"
        WHERE NULLIF("credentials"->>'externalId', '') IS NOT NULL
        GROUP BY "tenant_id", "type", "credentials"->>'externalId'
        HAVING count(*) > 1
      ) duplicate
      $query$ INTO conflict_details;
    END IF;

    IF conflict_details IS NOT NULL THEN
      RAISE EXCEPTION 'Messenger migration has duplicate credential identities:%', E'\n' || conflict_details;
    END IF;
  END IF;

  IF to_regclass('public.contacts') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'contacts' AND column_name = 'external_id'
     )
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'contacts' AND column_name = 'external_id_type'
     ) THEN
    EXECUTE $query$
      SELECT string_agg(
        format('tenant_id=%s external_id_type=%s external_id=%s contact_ids=%s',
          duplicate.tenant_id, duplicate.external_id_type, duplicate.external_id, duplicate.contact_ids),
        E'\n'
      )
      FROM (
        SELECT "tenant_id" AS tenant_id, "external_id_type" AS external_id_type,
               "external_id" AS external_id,
               string_agg("id", ', ' ORDER BY "id") AS contact_ids
        FROM "contacts"
        WHERE "external_id" IS NOT NULL AND "external_id_type" IS NOT NULL
        GROUP BY "tenant_id", "external_id_type", "external_id"
        HAVING count(*) > 1
      ) duplicate
    $query$ INTO conflict_details;

    IF conflict_details IS NOT NULL THEN
      RAISE EXCEPTION 'Messenger migration has duplicate contact identities:%', E'\n' || conflict_details;
    END IF;
  END IF;

  IF to_regclass('public.messages') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'messages' AND column_name = 'channel_id'
     ) THEN
    EXECUTE $query$
      SELECT string_agg(format('message_id=%s channel_id=%s', m."id", m."channel_id"), E'\n')
      FROM "messages" m
      LEFT JOIN "channels" c ON c."id" = m."channel_id"
      WHERE m."channel_id" IS NOT NULL AND c."id" IS NULL
    $query$ INTO conflict_details;

    IF conflict_details IS NOT NULL THEN
      RAISE EXCEPTION 'Messenger migration has orphaned message channel references:%', E'\n' || conflict_details;
    END IF;
  END IF;

  billing_migration_pending :=
    to_regclass('public._prisma_migrations') IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM "_prisma_migrations"
      WHERE "migration_name" = '20260903170000_ai_credits_billing'
        AND "finished_at" IS NOT NULL
        AND "rolled_back_at" IS NULL
    );

  IF billing_migration_pending
     AND to_regclass('public.ai_pricing_configs') IS NOT NULL
     AND to_regclass('public.ai_credit_packages') IS NOT NULL THEN
    EXECUTE $query$
      SELECT string_agg('deepseek/deepseek-v4-flash has values differing from the migration seed', E'\n')
      FROM "ai_pricing_configs"
      WHERE "provider" = 'deepseek'
        AND "model_key" = 'deepseek-v4-flash'
        AND ("input_cost_per_million_usd", "output_cost_per_million_usd", "credits_per_usd", "is_active")
            IS DISTINCT FROM (0.14::double precision, 0.28::double precision, 2000::double precision, true)
    $query$ INTO conflict_details;

    IF conflict_details IS NOT NULL THEN
      RAISE EXCEPTION 'AI pricing seed requires operator review:%', E'\n' || conflict_details;
    END IF;

    EXECUTE $query$
      SELECT string_agg(format('credit package %s differs from the migration seed', existing.slug), E'\n')
      FROM (
        VALUES
          ('starter-1000', 'Starter', 1000, 0, 10::double precision, 5::double precision, 0),
          ('growth-3000', 'Growth', 3000, 0, 25::double precision, 12::double precision, 1),
          ('pro-7000', 'Pro', 7000, 0, 50::double precision, 25::double precision, 2),
          ('scale-15000', 'Scale', 15000, 0, 100::double precision, 55::double precision, 3)
      ) AS seed(slug, name, credits, bonus_credits, price_ghs, price_usd, display_order)
      JOIN "ai_credit_packages" existing USING ("slug")
      WHERE (existing."name", existing."credits", existing."bonus_credits",
             existing."price_ghs", existing."price_usd", existing."display_order", existing."is_active")
            IS DISTINCT FROM
            (seed.name, seed.credits, seed.bonus_credits,
             seed.price_ghs, seed.price_usd, seed.display_order, true)
    $query$ INTO conflict_details;

    IF conflict_details IS NOT NULL THEN
      RAISE EXCEPTION 'AI credit package seed requires operator review:%', E'\n' || conflict_details;
    END IF;
  END IF;
END $$;
