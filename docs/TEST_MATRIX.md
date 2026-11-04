# Test matrix: how to run everything, and what each result does and does not prove (2026-11-04)

Results below were produced on the candidate (`integration/staging-candidate-v2`) on a laptop with a throwaway PostgreSQL 17 and Redis. Nothing was run against staging, production or any real provider.

| Suite | Command | Result |
|---|---|---|
| Backend unit + real-Postgres specs | `pnpm --filter @whatsapp-platform/backend test` with the env vars below | 4261 passed, 16 suites skipped (see below) |
| Backend end to end (real routes, real database) | `pnpm --filter @whatsapp-platform/backend test:e2e --runInBand` (needs `.env.test` or exported `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, Redis) | 206 passed |
| Opt-in e2e: AI learning on Postgres | same, with `AI_LEARNING_PG_TESTS=1` (database name must contain `test`) | 25 passed |
| Opt-in e2e: simulation limits on Redis | `AI_LIMITS_REDIS_TESTS=1 AI_LIMITS_REDIS_URL=redis://127.0.0.1:PORT` | 16 passed |
| Frontend | `pnpm --filter frontend exec tsc --noEmit`; lint and vitest live on `chore/frontend-quality` (not merged until staging acceptance) | typecheck clean; lint 0 errors, 0 hook defects, 30 cosmetic warnings; vitest 9 passed |
| Worker | `pnpm --filter worker exec tsc --noEmit` | clean |
| Infra shell suites (need GNU coreutils: Linux) | `bash infra/scripts/tests/backup.test.sh`, `backup-trial.test.sh`, `offhost-backup.test.sh` | 44, 44, 25 (off-host run earlier; unchanged since) |
| Credential encryption rehearsal | `infra/scripts/credential-encryption-rehearsal.sh` | 34 of 34 |
| Migration rehearsal | `infra/scripts/migration-rehearsal.sh` | 26 of 26 |

Environment switches for the database-backed specs (each needs its own disposable database whose name contains `test`/`scratch`/`tmp`, migrated with `prisma migrate deploy`; they truncate tables, so two specs must not share one database): `MSGSYNC_TEST_DATABASE_URL`, `AILEASE_TEST_DATABASE_URL`, `REENCRYPT_TEST_DATABASE_URL`, `SPENDCAP_TEST_DATABASE_URL`, `CAPALERT_TEST_DATABASE_URL`, `AI_LEARNING_TEST_DATABASE_URL`, `DIGITAL_SELF_TEST_DATABASE_URL`, `MEDIA_TEST_DATABASE_URL`, `TENANT_ISOLATION_TEST_DATABASE_URL`, `RAG_TEST_DATABASE_URL` (the pgvector integration spec also needs the local embedding model and stays skipped here).

## What the green results do not prove
* Every provider test uses a **fake** (Telegram Bot API, TikTok publishing and messaging, speech and vision, Meta). They prove our behaviour: verification, isolation, de-duplication, state machines, validation, credits, redaction. They say nothing about the real services.
* TikTok Business Messaging's wire contract is partly assumed (`docs/TIKTOK_CONTRACT_VERIFICATION.md`).
* Mutation checks (a deliberate bug the tests must catch) were run for: cap-alert claim, tenant-key check, opt-in check, signature check, tenant routing, id validation, context verification, redaction at the provider boundary, the wrong-key abort, the lease claim, and a rollback script. They are not a CI step.
* CI wiring for the new database specs lives with the CI workflow on `chore/frontend-quality` and is applied when that branch is merged.
* Known cosmetic lint warnings remain (`<img>` instead of `next/image`, unescaped apostrophes): 30, none a defect.
