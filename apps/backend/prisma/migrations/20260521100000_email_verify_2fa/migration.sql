ALTER TABLE "users" ADD COLUMN "email_verified" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "users" ADD COLUMN "email_verify_token" TEXT;
ALTER TABLE "users" ADD COLUMN "email_verify_expiry" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "two_factor_code" TEXT;
ALTER TABLE "users" ADD COLUMN "two_factor_code_expiry" TIMESTAMP(3);

-- Mark all existing users as already verified so they are not locked out
UPDATE "users" SET "email_verified" = TRUE;
