-- CreateTable
CREATE TABLE "whatsapp_meta_apps" (
    "id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "secret_enc" TEXT,
    "secret_fingerprint" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_meta_apps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_waba_apps" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "waba_id" TEXT NOT NULL,
    "meta_app_id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_waba_apps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_webhook_signature_stats" (
    "id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "waba_id" TEXT NOT NULL DEFAULT '',
    "app_id" TEXT NOT NULL DEFAULT '',
    "outcome" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_webhook_signature_stats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_meta_apps_app_id_key" ON "whatsapp_meta_apps"("app_id");

-- CreateIndex
CREATE INDEX "whatsapp_waba_apps_waba_id_idx" ON "whatsapp_waba_apps"("waba_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_waba_apps_tenant_id_waba_id_meta_app_id_key" ON "whatsapp_waba_apps"("tenant_id", "waba_id", "meta_app_id");

-- CreateIndex
CREATE INDEX "whatsapp_webhook_signature_stats_day_idx" ON "whatsapp_webhook_signature_stats"("day");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_webhook_signature_stats_day_waba_id_app_id_outcome_key" ON "whatsapp_webhook_signature_stats"("day", "waba_id", "app_id", "outcome");

-- AddForeignKey
ALTER TABLE "whatsapp_waba_apps" ADD CONSTRAINT "whatsapp_waba_apps_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_waba_apps" ADD CONSTRAINT "whatsapp_waba_apps_meta_app_id_fkey" FOREIGN KEY ("meta_app_id") REFERENCES "whatsapp_meta_apps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
