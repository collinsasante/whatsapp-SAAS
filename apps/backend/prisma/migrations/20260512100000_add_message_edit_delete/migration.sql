-- AlterTable
ALTER TABLE "messages" ADD COLUMN "is_edited" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "messages" ADD COLUMN "edited_at" TIMESTAMP(3);
ALTER TABLE "messages" ADD COLUMN "deleted_for_everyone" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "messages" ADD COLUMN "deleted_at" TIMESTAMP(3);
