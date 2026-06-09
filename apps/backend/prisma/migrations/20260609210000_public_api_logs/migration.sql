CREATE TABLE "public_api_logs" (
  "id"            TEXT NOT NULL,
  "tenant_id"     TEXT NOT NULL,
  "api_key_id"    TEXT NOT NULL,
  "endpoint"      TEXT NOT NULL,
  "phone"         TEXT,
  "template_name" TEXT,
  "status"        TEXT NOT NULL,
  "error_message" TEXT,
  "ip"            TEXT,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "public_api_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "public_api_logs_tenant_id_created_at_idx"
  ON "public_api_logs"("tenant_id", "created_at" DESC);

ALTER TABLE "public_api_logs"
  ADD CONSTRAINT "public_api_logs_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public_api_logs"
  ADD CONSTRAINT "public_api_logs_api_key_id_fkey"
    FOREIGN KEY ("api_key_id") REFERENCES "api_keys"("id") ON DELETE CASCADE ON UPDATE CASCADE;
