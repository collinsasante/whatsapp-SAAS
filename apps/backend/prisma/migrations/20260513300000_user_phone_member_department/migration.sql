-- Add phone number to users (workspace contact for the agent)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone" TEXT;

-- Add department to workspace_members (workspace-specific classification)
ALTER TABLE "workspace_members" ADD COLUMN IF NOT EXISTS "department" TEXT;

-- Add last_login_at to users for accurate activity tracking
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_login_at" TIMESTAMP(3);
