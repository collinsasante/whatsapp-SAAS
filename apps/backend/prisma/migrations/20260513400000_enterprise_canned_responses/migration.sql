-- CreateTable
CREATE TABLE "canned_response_categories" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6B7280',
    "icon" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "canned_response_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_favorite_responses" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "canned_response_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_favorite_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canned_response_usages" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "canned_response_id" TEXT NOT NULL,
    "used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "canned_response_usages_pkey" PRIMARY KEY ("id")
);

-- AlterTable: extend canned_responses
ALTER TABLE "canned_responses"
    ADD COLUMN "title" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "category_id" TEXT,
    ADD COLUMN "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "media_url" TEXT,
    ADD COLUMN "media_type" TEXT,
    ADD COLUMN "usage_count" INTEGER NOT NULL DEFAULT 0;

-- Drop old string category column (it was not heavily used, migrate to categoryId)
-- Note: kept for now as nullable so existing data is safe; will clean up in follow-up
-- ALTER TABLE "canned_responses" DROP COLUMN "category";

-- CreateIndex
CREATE UNIQUE INDEX "canned_response_categories_tenant_id_name_key" ON "canned_response_categories"("tenant_id", "name");
CREATE INDEX "canned_response_categories_tenant_id_idx" ON "canned_response_categories"("tenant_id");

CREATE UNIQUE INDEX "user_favorite_responses_user_id_canned_response_id_key" ON "user_favorite_responses"("user_id", "canned_response_id");
CREATE INDEX "user_favorite_responses_user_id_idx" ON "user_favorite_responses"("user_id");

CREATE INDEX "canned_response_usages_user_id_used_at_idx" ON "canned_response_usages"("user_id", "used_at" DESC);
CREATE INDEX "canned_response_usages_tenant_id_idx" ON "canned_response_usages"("tenant_id");

-- AddForeignKey
ALTER TABLE "canned_response_categories" ADD CONSTRAINT "canned_response_categories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "canned_responses" ADD CONSTRAINT "canned_responses_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "canned_response_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "user_favorite_responses" ADD CONSTRAINT "user_favorite_responses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_favorite_responses" ADD CONSTRAINT "user_favorite_responses_canned_response_id_fkey" FOREIGN KEY ("canned_response_id") REFERENCES "canned_responses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "canned_response_usages" ADD CONSTRAINT "canned_response_usages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "canned_response_usages" ADD CONSTRAINT "canned_response_usages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "canned_response_usages" ADD CONSTRAINT "canned_response_usages_canned_response_id_fkey" FOREIGN KEY ("canned_response_id") REFERENCES "canned_responses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
