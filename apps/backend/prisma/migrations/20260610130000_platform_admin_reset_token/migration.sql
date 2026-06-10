ALTER TABLE "platform_admins"
  ADD COLUMN "reset_token" TEXT,
  ADD COLUMN "reset_token_expires_at" TIMESTAMP(3);
