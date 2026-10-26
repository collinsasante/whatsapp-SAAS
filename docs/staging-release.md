# Staging release: applied-migration gate

`infra/scripts/staging-release-deploy.sh` refuses to deploy a candidate unless every
migration recorded as applied in the staging database exists in the candidate with an
identical checksum (`infra/scripts/lib/staging-migration-gate.sh`). This protects against
deploying code older than the database, or a candidate that rewrites applied history.

## Known exception: schema from an earlier AI feature branch

Staging once ran `feature/verz-ai-grounded-reply-engine`, which was never merged. Its
migration `20260708120000_verz_ai_grounded_retrieval` is applied on staging and absent from
`staging`/`main`. It is additive only (no drops, deletes or updates):

- tables `knowledge_base_chunks` and `ai_knowledge_gaps`
- columns on `ai_interaction_logs` (all nullable or defaulted) and `tenant_settings`
  (all nullable or defaulted)

The current candidate code does not read or write these objects. They remain in the staging
database unused. Production does not have them, and the migration is not in `main`.

To release despite it, name it explicitly for that run only:

```bash
STAGING_ALLOWED_EXTRA_MIGRATIONS=20260708120000_verz_ai_grounded_retrieval \
CONFIRM_STAGING_RELEASE=<sha> \
  bash infra/scripts/staging-release-deploy.sh deploy <sha>
```

Rules:

- Unset or empty means the strict behaviour: any applied migration absent from the
  candidate aborts the release.
- Only IDs hard-coded in `STAGING_KNOWN_EXTRA_MIGRATIONS` are accepted. Any other value
  aborts the release before anything is built.
- The exception only excuses a migration that is *absent* from the candidate. If the file
  is present, its checksum is still compared. Checksum mismatches, unreadable history and
  every other absent migration still abort.
- The variable is read from the operator's environment only, never from `.env.staging`,
  and the production deploy scripts do not use it.
- A release that used the exception prints a notice and writes
  `allowed-extra-migrations.txt` into its backup directory.

Checked locally against a scratch database with the real Prisma 5.22 CLI: with that
migration applied and absent from the candidate, `prisma migrate status` reports the
schema up to date and `prisma migrate deploy` has nothing to apply. Verify on staging after
the release that the app works end to end.

Remove the entry once the objects are dropped through a reviewed migration or the feature
branch is merged.
