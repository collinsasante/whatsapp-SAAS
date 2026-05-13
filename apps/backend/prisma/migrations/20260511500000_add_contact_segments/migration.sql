CREATE TABLE "contact_segments" (
    "id"            TEXT NOT NULL,
    "tenant_id"     TEXT NOT NULL,
    "name"          TEXT NOT NULL,
    "description"   TEXT,
    "filters"       JSONB NOT NULL DEFAULT '[]',
    "contact_count" INTEGER NOT NULL DEFAULT 0,
    "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "contact_segments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "contact_segments_tenant_id_idx" ON "contact_segments"("tenant_id");

ALTER TABLE "contact_segments"
  ADD CONSTRAINT "contact_segments_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
