-- Enable uuid-ossp for SQL-level UUID generation (backfill only; app uses Prisma client UUIDs)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- MemberStatus enum
CREATE TYPE "MemberStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'PENDING');

-- workspace_members: many-to-many user ↔ workspace with per-workspace role
CREATE TABLE "workspace_members" (
  "id"            TEXT         NOT NULL,
  "workspace_id"  TEXT         NOT NULL,
  "user_id"       TEXT         NOT NULL,
  "role"          TEXT         NOT NULL DEFAULT 'AGENT',
  "status"        "MemberStatus" NOT NULL DEFAULT 'ACTIVE',
  "invited_by_id" TEXT,
  "joined_at"     TIMESTAMP(3),
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("id")
);

-- workspace_invitations: secure invite tokens
CREATE TABLE "workspace_invitations" (
  "id"            TEXT         NOT NULL,
  "workspace_id"  TEXT         NOT NULL,
  "email"         TEXT         NOT NULL,
  "name"          TEXT,
  "role"          TEXT         NOT NULL DEFAULT 'AGENT',
  "token"         TEXT         NOT NULL,
  "invited_by_id" TEXT         NOT NULL,
  "expires_at"    TIMESTAMP(3) NOT NULL,
  "accepted_at"   TIMESTAMP(3),
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workspace_invitations_pkey" PRIMARY KEY ("id")
);

-- Foreign keys
ALTER TABLE "workspace_members"
  ADD CONSTRAINT "workspace_members_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workspace_members"
  ADD CONSTRAINT "workspace_members_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workspace_members"
  ADD CONSTRAINT "workspace_members_invited_by_id_fkey"
  FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "workspace_invitations"
  ADD CONSTRAINT "workspace_invitations_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workspace_invitations"
  ADD CONSTRAINT "workspace_invitations_invited_by_id_fkey"
  FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Unique & indexes
CREATE UNIQUE INDEX "workspace_members_workspace_id_user_id_key"
  ON "workspace_members"("workspace_id", "user_id");

CREATE UNIQUE INDEX "workspace_invitations_token_key"
  ON "workspace_invitations"("token");

CREATE INDEX "workspace_members_workspace_id_idx"  ON "workspace_members"("workspace_id");
CREATE INDEX "workspace_members_user_id_idx"       ON "workspace_members"("user_id");
CREATE INDEX "workspace_invitations_workspace_id_idx" ON "workspace_invitations"("workspace_id");
CREATE INDEX "workspace_invitations_email_idx"     ON "workspace_invitations"("email");

-- Backfill: register every existing user as a member of their primary workspace.
-- Map the existing UserRole enum to workspace role strings.
INSERT INTO "workspace_members" (
  "id", "workspace_id", "user_id", "role", "status", "joined_at", "created_at", "updated_at"
)
SELECT
  uuid_generate_v4()::text,
  u."tenant_id",
  u."id",
  CASE u."role"
    WHEN 'SUPER_ADMIN' THEN 'OWNER'
    WHEN 'ADMIN'       THEN 'ADMIN'
    WHEN 'AGENT'       THEN 'AGENT'
    WHEN 'VIEWER'      THEN 'VIEWER'
    ELSE 'AGENT'
  END,
  'ACTIVE',
  u."created_at",
  NOW(),
  NOW()
FROM "users" u
ON CONFLICT ("workspace_id", "user_id") DO NOTHING;
