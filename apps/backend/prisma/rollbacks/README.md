# Rollback scripts for the seven pending migrations

One `.down.sql` per migration, in `prisma/rollbacks/` (NOT in `prisma/migrations/`, so `prisma migrate deploy` never runs them). Apply in **reverse order** of the migrations, only after the application code that uses the objects has been rolled back, and only after a verified dump. Each one removes only what its migration added; no customer data in existing tables is touched. They are rehearsed by `infra/scripts/migration-rehearsal.sh`.

After a rollback, the `_prisma_migrations` ledger still lists the migration as applied. To make Prisma re-apply it later, delete that row (`DELETE FROM _prisma_migrations WHERE migration_name = '...'`), or re-run the migration SQL by hand: every migration here is guarded and idempotent.

What a rollback loses: only the data the migration's own objects held (sync history, leases, publication history, cap alerts, generated transcripts, campaign send claims), plus the cap and opt-in settings.
