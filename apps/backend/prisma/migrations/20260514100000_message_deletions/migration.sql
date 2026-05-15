-- CreateTable
CREATE TABLE "message_deletions" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "deleted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_deletions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "message_deletions_message_id_user_id_key" ON "message_deletions"("message_id", "user_id");

-- CreateIndex
CREATE INDEX "message_deletions_tenant_id_idx" ON "message_deletions"("tenant_id");

-- CreateIndex
CREATE INDEX "message_deletions_user_id_idx" ON "message_deletions"("user_id");

-- AddForeignKey
ALTER TABLE "message_deletions" ADD CONSTRAINT "message_deletions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_deletions" ADD CONSTRAINT "message_deletions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_deletions" ADD CONSTRAINT "message_deletions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
