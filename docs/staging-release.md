# Staging release

How a release reaches staging, what it is guaranteed not to touch, and how to undo it. Everything here is enforced by
`infra/scripts/staging-release-deploy.sh` and `infra/scripts/lib/*.sh` and covered by `infra/scripts/tests/*.test.sh`. Nothing in this
document has been verified on the live staging server; the items that can only be checked there are listed in section 6 as release gates.

## 1. What a release touches (and never touches)

A release rebuilds and restarts exactly five application services: `backend`, `worker`, `realtime`, `whatsapp-web`, `frontend`.

- Every `docker compose up -d` in the script uses `--no-deps`, so a release **cannot** recreate PostgreSQL, Redis, MinIO or nginx.
- The script builds only those five services. It never builds the database image.
- It never runs `down`, removes a volume, prunes images or removes containers.
- The data volumes are `external: true` with fixed names (`staging_postgres_staging_data` and the others), so a Compose project-name change
  can never silently create a new empty database.
- Before the rollout the script records the database container id; after the rollout it fails if the id changed.

## 2. The database image: pgvector, never stock

Staging's PostgreSQL is meant to run `verzchat-staging/postgres-pgvector:16.15-0.8.7`, built from `infra/postgres/Dockerfile`
(`postgres:16.15-alpine` + pgvector `v0.8.7`), and `docker-compose.staging.yml` names that image. A stock `postgres` image cannot load the
`vector` extension that is registered in the database, which breaks hybrid retrieval and makes `pg_restore` of the vector table fail
(reproduced locally with a real dump: it restores into the pgvector image and fails on `CREATE EXTENSION vector` in the stock image).

Safeguards, all run **before any service is stopped**:

1. The Compose file must name a `verzchat-staging/postgres-pgvector:*` image for `postgres`. A stock image, a missing image line, or another
   spelling of a stock image aborts the release.
2. The **running** database container must already be that exact image. A release never changes the database image.
3. The running server must be able to load pgvector (`pg_available_extensions` lists `vector`).

### One-time database image procedure (only if safeguard 2 aborts: the running database is not yet the pgvector image)

This is the only way the database image changes, and it is deliberately not part of a release. Choose a quiet period; take a backup first.

```bash
cd /root/staging-release-checkout/infra          # a clean checkout of the approved commit
# 1. build the image on the server and smoke-test it in a THROWAWAY container (not the staging database)
docker build --build-arg PG_IMAGE=postgres:16.15-alpine --build-arg PGVECTOR_VERSION=v0.8.7 \
  -t verzchat-staging/postgres-pgvector:16.15-0.8.7 -f postgres/Dockerfile postgres
docker run --rm --entrypoint sh verzchat-staging/postgres-pgvector:16.15-0.8.7 -c 'postgres --version; ls /usr/local/lib/postgresql/vector.so'
# 2. backup, verified: custom-format dump, archive readable, restores in an isolated container of the NEW image
docker exec wa_staging_postgres sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > /root/staging-db-image-swap.dump
docker exec -i wa_staging_postgres pg_restore --list < /root/staging-db-image-swap.dump > /dev/null && echo "archive readable"
RESTORE_CHECK_IMAGE=verzchat-staging/postgres-pgvector:16.15-0.8.7 bash scripts/staging-verify-backup-restore.sh /root/staging-db-image-swap.dump
# 3. swap ONLY the database container (same external data volume). Applications reconnect on their own.
docker compose --project-name verzchat-staging --env-file .env.staging -f docker-compose.staging.yml up -d --no-deps --no-build postgres
# 4. verify: healthy, same migration history
docker exec wa_staging_postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select count(*) from _prisma_migrations where finished_at is not null"'
```

Rolling the database image back to a stock image is safe **only** while no database has run `CREATE EXTENSION vector` and no
`kb_vector_chunks` table exists. Never create HNSW or IVFFlat indexes on staging: they make the stock image unusable.

## 3. Hybrid-RAG assets on the host

The backend mounts two host directories **read-only** (long-form bind mounts with `read_only: true` and `create_host_path: false`, so a
missing directory is a start-up error and Docker never creates an empty, root-owned replacement):

| Host | In the container | Contents |
|---|---|---|
| `/opt/verz-models/all-MiniLM-L6-v2` | `/models/all-MiniLM-L6-v2` | `tokenizer.json`, `onnx/model_quantized.onnx` |
| `/opt/verz-ort` | `/ort` | `node_modules/onnxruntime-web` (1.31.1) |

with `NODE_PATH=/ort/node_modules` and `EMBEDDING_MODEL_DIR=/models/all-MiniLM-L6-v2`. Hybrid retrieval stays **off** unless
`RAG_HYBRID_ENABLED=true` and `EMBEDDING_PROVIDER=local-minilm` are set in `.env.staging` (empty by default; nothing is hard-coded in git).
The mounts exist in the Compose file either way; the settings only decide whether retrieval uses them.

Before a release stops anything, the script checks that those files exist and that the model files match their pinned SHA-256
(`da0e7993…62a0` tokenizer, `afdb6f1a…bdb1` model: the constants the backend loader enforces; a test fails if they drift, and they were
checked against real model files locally). After the rollout it checks that both mounts are present and read-only. Installing the assets
(once):

```bash
mkdir -p /opt/verz-models/all-MiniLM-L6-v2/onnx /opt/verz-ort
curl -L -o /opt/verz-models/all-MiniLM-L6-v2/tokenizer.json https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/751bff37182d3f1213fa05d7196b954e230abad9/tokenizer.json
curl -L -o /opt/verz-models/all-MiniLM-L6-v2/onnx/model_quantized.onnx https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/751bff37182d3f1213fa05d7196b954e230abad9/onnx/model_quantized.onnx
docker run --rm -v /opt/verz-ort:/ort -w /ort node:20-alpine sh -c 'npm init -y >/dev/null && npm install --no-audit --no-fund onnxruntime-web@1.31.1'
```

## 4. Running a release

```bash
cd /root/staging-release-checkout                      # clean checkout, HEAD == the commit being released
CONFIRM_STAGING_RELEASE=<40-char sha> bash infra/scripts/staging-release-deploy.sh deploy <40-char sha>
```

In order: identity and approval gates; required settings (`INTERNAL_SECRET`, `WHATSAPP_WEB_INTERNAL_API_KEY`, `WHATSAPP_APP_SECRET`,
`CREDENTIALS_ENCRYPTION_KEY` as 32 bytes of base64, and the rest in `lib/staging-required-settings.sh`); secret-boundary check; image
build; applied-migration gate; **database image and hybrid-RAG safeguards**; read-only data preflight; writers stopped; `pg_dump`, archive
listing and an isolated restore rehearsal (using the running database's own image); migrations applied once; the five services recreated
with `--no-deps`; database-unchanged and mount checks; health checks. Any failure aborts with the step name and writes
`release-status.txt`; if the writers were already stopped the script says so and leaves them stopped.

The backup directory is `/root/staging-release-backups/rollback-<timestamp>/` with `staging.dump`, `staging.dump.sha256`,
`rollback-image-tag`, the preflight outputs and `release-status.txt`.

**The script has no free-space check.** Before a release, on the server: `df -h /root /var/lib/docker`. The backend image build alone is
about 1.2 GB, plus the dump and its restore rehearsal; keep at least 15 GB free on both.

### The applied-migration gate and the old exception

The gate refuses a candidate unless every migration applied on staging exists in it with an identical checksum. Staging once ran an
unmerged branch whose migration `20260708120000_verz_ai_grounded_retrieval` is applied there. The release candidate now **contains** that
migration byte-for-byte (restored from commit `5ba3e99`), so `STAGING_ALLOWED_EXTRA_MIGRATIONS` is **not needed** and must stay unset.

### AI learning on staging

A release changes none of the learning settings: `AI_LEARNING_OPT_IN_OPEN` defaults to `false`, retention to off, and no workspace is
opted in. Opening the gate for the synthetic workspace is a separate, approved step (see `DIGITAL_SELF_LEARNING_PRIVACY.md` and
`digital-self-staging-validation.md`).

## 5. Rollback

**Code only (fast, repeatable):**

```bash
CONFIRM_CODE_ONLY_ROLLBACK=<tag> bash infra/scripts/staging-release-deploy.sh rollback <tag>     # tag = rollback-YYYYMMDD-HHMMSS
```

It re-creates the five services from the images tagged at the start of the release (`--no-deps`, database container checked unchanged). It
refuses if the migration history is unfinished, if phone-less contacts exist, or if AI-credit reservations are unresolved. It never touches
the database. The three AI-learning migrations (`20261102120000`, `20261102130000`, `20261103120000`) are additive, so older code runs
against the migrated schema; the `NOT VALID` foreign key on `ai_interaction_logs.conversation_id` also applies to older code, which
already tolerates a failed log insert.

**Database restore (destructive; needs explicit approval; not scripted on purpose):** the verified dump is
`/root/staging-release-backups/<tag>/staging.dump`.

```bash
cd /root/staging-release-backups/<tag> && sha256sum -c staging.dump.sha256        # must print OK
# then, with the application writers stopped, restore following your approved recovery plan
```

Do not restore over the live database without that plan: the rehearsal proves the dump is loadable, not that a restore is harmless.

## 6. Release gates that need the live server (not provable locally)

1. `infra/scripts/staging-evidence.sh` output reviewed: running images and ids, mounts, the Compose files actually in use, anything that
   could recreate services, model hashes, `vector` 0.8.7, chunk and ANN counts, migration counts, containment counts, preflights, backups.
2. The running database is the pgvector image (otherwise run the one-time procedure in section 2).
3. Free space as in section 4.
4. After the release: both mounts read-only, `RAG_HYBRID_ENABLED` as intended, `vector` 0.8.7, chunk count unchanged, a Test Chat
   paraphrase reports `mode: hybrid` including `vector` (only when hybrid is switched on), no new ERROR lines.
