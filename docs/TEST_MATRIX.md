# Test matrix: how to run everything, and what each result does and does not prove (2026-11-05)

Produced on the release candidate (`integration/staging-candidate-v2`) on a laptop with a throwaway PostgreSQL 17 (pgvector 0.8.4) and Redis. **Nothing was run against staging, production or any real provider.** CI runs the same suites (`.github/workflows/backend-tests.yml`, `frontend-quality.yml`).

## Results

| Suite | Command | Result |
|---|---|---|
| Backend unit + every real-database, queue, pgvector and real-model suite | `pnpm --filter @whatsapp-platform/backend exec jest --runInBand` with the environment below | **285 suites, 4618 passed, 1 skipped, 0 failed.** The one skip is a test that only applies when `onnxruntime-web` is *not* installed. |
| Backend end to end (real routes, real database, real exception filter where it matters) | `pnpm --filter @whatsapp-platform/backend test:e2e --runInBand` with the environment below | **23 suites, 303 passed, 0 skipped.** |
| Worker (real BullMQ on a Redis the test starts itself) | `pnpm --filter @whatsapp-platform/worker test` | 19 passed |
| WhatsApp-Web service (includes Baileys' real audio-duration parser on real MP3 and OGG) | `pnpm --filter @whatsapp-platform/whatsapp-web test` | 34 passed |
| Frontend | `pnpm --filter @whatsapp-platform/frontend typecheck`, `lint`, `test`, and `next build` | typecheck clean; lint 0 errors, 30 warnings (classified in `docs/FRONTEND_QUALITY.md`); 6 tests passed; build succeeds |
| Type checks and builds | `tsc --noEmit` in backend, worker, whatsapp-web, realtime; `nest build` | all clean |
| Browser journeys (real Chromium, production build, freshly migrated and seeded database) | described in `docs/CONTAINER_AND_QUEUE_VALIDATION.md` section 4 | 38 of 38 checks |
| Release images (arm64, isolated network, throwaway Postgres and Redis) | `docs/CONTAINER_AND_QUEUE_VALIDATION.md` section 1 | backend, worker, realtime, whatsapp-web built and ran; **frontend image not committed (local Docker disk full)** |
| Infra shell suites (need GNU coreutils: Linux) | `bash infra/scripts/tests/backup.test.sh`, `backup-trial.test.sh`, `offhost-backup.test.sh` | 44, 44, 25 (last run 2026-11-04; unchanged since) |
| Credential encryption rehearsal | `infra/scripts/credential-encryption-rehearsal.sh` | 34 of 34 (2026-11-04; unchanged since) |
| Migration rehearsal | `infra/scripts/migration-rehearsal.sh` | 26 of 26 (2026-11-04; unchanged since) |

The `pnpm -r build` at the repository root fails for the mobile-only packages (`packages/theme` and similar); they are not in any server image. See `docs/DEPENDENCY_SECURITY.md`.

## Environment for the database-backed suites

Each real-database suite needs its own disposable database whose name ends in `test` on a local host (they truncate tables), migrated with `prisma migrate deploy`. CI clones one migrated template per suite. Variables: `AI_LEARNING_TEST_DATABASE_URL`, `AI_LEARNING_TEST_ISOLATED_DATABASE_URL` (a different database), `AI_LEARNING_TEST_REDIS_URL`, `AILEASE_TEST_DATABASE_URL`, `CAPALERT_TEST_DATABASE_URL`, `DIGITAL_SELF_TEST_DATABASE_URL`, `DIGITAL_SELF_TEST_REDIS_URL`, `MEDIA_TEST_DATABASE_URL`, `MSGSYNC_TEST_DATABASE_URL`, `REENCRYPT_TEST_DATABASE_URL`, `SPENDCAP_TEST_DATABASE_URL`, `TENANT_ISOLATION_TEST_DATABASE_URL`.

* Retrieval suites: `RAG_TEST_DATABASE_URL` (an isolated database with `CREATE EXTENSION vector`). The local MiniLM model suite additionally needs `EMBEDDING_MODEL_DIR` (the SHA-pinned `tokenizer.json` and `onnx/model_quantized.onnx` from `Xenova/all-MiniLM-L6-v2@751bff3`, which are not in the repository), `NODE_PATH` pointing at an install of `onnxruntime-web@1.31.1`, and `NODE_OPTIONS=--experimental-vm-modules`. CI leaves that one suite off for lack of weights.
* e2e: exported `DATABASE_URL` (or `.env.test`), `JWT_SECRET`, `JWT_REFRESH_SECRET`, `INTERNAL_SECRET`, `WHATSAPP_WEB_INTERNAL_API_KEY`, `WHATSAPP_APP_SECRET`, Redis, and for the opt-in suites `AI_LEARNING_PG_TESTS=1`, `AI_LIMITS_REDIS_TESTS=1`, `AI_LIMITS_REDIS_URL`.
* Seed data trap: the e2e suites truncate every table, including rows that migrations insert (credit packs). A database cloned from the e2e database has none; build any database used for browser journeys with `prisma migrate deploy` and the repository seed, and assert the seed rows before opening a browser.

## What the green results do not prove

* Every provider test uses a **fake** (Telegram Bot API, TikTok publishing and messaging, speech and vision, Meta, Paystack, Stripe). They prove our behaviour: verification, isolation, de-duplication, state machines, validation, credits, error mapping. They do not prove a provider accepts our requests. No row in `docs/CHANNEL_CAPABILITY_MATRIX.md` is "real-integration verified" for the new work.
* TikTok Business Messaging's wire contract is partly assumed (`docs/TIKTOK_CONTRACT_VERIFICATION.md`).
* OAuth journeys stop at the authorisation URL (navigation to the provider is blocked and app ids are fake). No real Page, TikTok account or WhatsApp number was connected, and no payment provider was configured.
* The images were built for arm64. The `linux/amd64` native modules the VPS runs are verified only by the first CI or staging build.
* Nothing here is staging evidence: staging acceptance, real-provider checks and the production release remain behind the AP-3 gate.
* Mutation checks (a deliberate bug the tests must catch) were run for: cap-alert claim, tenant-key check, opt-in check, signature check, tenant routing, id validation, context verification, redaction at the provider boundary, the stale-snooze guard, the upload content check and size ceiling, the provider-error mapping in the exception filter. One mutation check left a file altered and that was committed without its guard; the final full run caught it (`3b08121`). Restore mutated files from git, never from a hand-made backup.
