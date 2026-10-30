#!/usr/bin/env bash
set -euo pipefail

MODE=${1:-}
REVISION=${2:-}
CURRENT_STEP="initial validation"
BACKUP_DIR=""
ROLLOUT_STARTED=false
WRITERS_STOPPED=false
COMPLETED_STEPS=()
umask 077

fail() {
  local message=$*
  echo "ABORT during $CURRENT_STEP: $message" >&2
  if ((${#COMPLETED_STEPS[@]})); then
    printf 'Completed steps: %s\n' "$(IFS='; '; echo "${COMPLETED_STEPS[*]}")" >&2
  else
    echo "Completed steps: none" >&2
  fi
  if [[ "$WRITERS_STOPPED" == true ]]; then
    echo "Staging write services were quiesced; verify their actual state before restarting or continuing rollout." >&2
  fi
  if [[ "$ROLLOUT_STARTED" == true && -n "$BACKUP_DIR" && -d "$BACKUP_DIR" ]]; then
    if "${COMPOSE[@]}" logs --no-color --tail=100 "${SERVICES[@]}" > "$BACKUP_DIR/failed-rollout-service-logs.txt" 2>&1; then
      chmod 600 "$BACKUP_DIR/failed-rollout-service-logs.txt"
      echo "Service log tail saved (restricted): $BACKUP_DIR/failed-rollout-service-logs.txt" >&2
    else
      echo "Could not capture service logs; use Docker Compose logs during operator investigation." >&2
    fi
  fi
  if [[ -n "$BACKUP_DIR" && -d "$BACKUP_DIR" ]]; then
    {
      printf 'failed_step=%s\n' "$CURRENT_STEP"
      printf 'failure=%s\n' "$message"
      printf 'completed_steps=%s\n' "$(IFS='; '; echo "${COMPLETED_STEPS[*]}")"
      printf 'writers_stopped=%s\n' "$WRITERS_STOPPED"
      printf 'rollout_started=%s\n' "$ROLLOUT_STARTED"
    } > "$BACKUP_DIR/release-status.txt"
    chmod 600 "$BACKUP_DIR/release-status.txt"
    echo "Release state saved (restricted): $BACKUP_DIR/release-status.txt" >&2
  fi
  exit 1
}
trap 'fail "unexpected shell command failure at line $LINENO"' ERR

complete_step() {
  COMPLETED_STEPS+=("$1")
  if [[ -n "$BACKUP_DIR" && -d "$BACKUP_DIR" ]]; then
    {
      printf 'completed_steps=%s\n' "$(IFS='; '; echo "${COMPLETED_STEPS[*]}")"
      printf 'last_completed_step=%s\n' "$1"
    } > "$BACKUP_DIR/release-status.txt"
    chmod 600 "$BACKUP_DIR/release-status.txt"
  fi
}

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || fail "run from a Git checkout"
COMPOSE_FILE="$ROOT/infra/docker-compose.staging.yml"
ENV_FILE="$ROOT/infra/.env.staging"
BACKUP_ROOT=/root/staging-release-backups
CANDIDATE_ROOT=/root/staging-release-candidates
PROJECT=verzchat-staging
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/staging-migration-gate.sh
source "$SCRIPT_DIR/lib/staging-migration-gate.sh"
SERVICES=(backend worker realtime whatsapp-web frontend)

if [[ "$MODE" == "--help" || "$MODE" == "-h" ]]; then
  cat <<'USAGE'
Usage:
  infra/scripts/staging-release-deploy.sh deploy <40-char-commit>
  infra/scripts/staging-release-deploy.sh rollback <rollback-image-tag>

Deployment requires a clean, exact local commit, CONFIRM_STAGING_RELEASE set
to that commit, and a successful isolated backup-restore rehearsal. Optional
STAGING_ALLOWED_EXTRA_MIGRATIONS=<id> excuses one known, additive migration that
staging has applied but the candidate lacks (see docs/staging-release.md).
Rollback restores code images only; it never restores or changes the database.
USAGE
  exit 0
fi

[[ -f "$COMPOSE_FILE" ]] || fail "staging Compose file is missing"
[[ -f "$ENV_FILE" ]] || fail "staging environment file is missing"
command -v docker >/dev/null 2>&1 || fail "docker is required"
[[ "$EUID" -eq 0 ]] || fail "run this staging-host procedure as root"
[[ -z "${DOCKER_HOST:-}" ]] || fail "DOCKER_HOST overrides are not allowed; use the staging host's local Docker daemon"
docker_endpoint=$(docker context inspect "$(docker context show)" --format '{{.Endpoints.docker.Host}}' 2>/dev/null) ||
  fail "could not inspect the active Docker context"
[[ "$docker_endpoint" == "unix:///var/run/docker.sock" ]] ||
  fail "active Docker context is not the staging host's local /var/run/docker.sock"
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required"
command -v flock >/dev/null 2>&1 || fail "flock is required for the release lock"
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is required for candidate verification"
command -v curl >/dev/null 2>&1 || fail "curl is required for ingress health checks"

exec 9>/var/lock/verzchat-staging-release.lock
flock -n 9 || fail "another staging release holds the deployment lock"

COMPOSE=(docker compose --project-name "$PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE")

require_env() {
  local key=$1
  awk -F= -v key="$key" '$1 == key && length(substr($0, index($0, "=") + 1)) > 0 { found=1 } END { exit !found }' "$ENV_FILE" ||
    fail "required staging setting $key is missing or empty"
}

verify_migration_checksums() {
  local migration_dir=$1 remote_file=$2
  docker exec wa_staging_postgres psql -X -At -F '|' -U "$DB_USER" -d "$DB_NAME" \
    -c 'SELECT migration_name, checksum FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name' \
    > "$remote_file" || fail "cannot read applied migration history"
  check_applied_migrations "$migration_dir" "$remote_file" || fail "$MIGRATION_GATE_ERROR"
  if ((${#ALLOWED_EXTRA_APPLIED[@]})); then
    echo "NOTICE: permitting applied migration(s) absent from the candidate (STAGING_ALLOWED_EXTRA_MIGRATIONS): ${ALLOWED_EXTRA_APPLIED[*]}"
    printf '%s\n' "${ALLOWED_EXTRA_APPLIED[@]}" > "$BACKUP_DIR/allowed-extra-migrations.txt"
  fi
}

migration_manifest_hash() {
  local dir=$1
  (
    cd "$dir"
    find migrations -type f -name migration.sql | sort |
      while IFS= read -r file; do
        printf '%s ' "$file"
        sha256sum "$file" | awk '{print $1}'
      done |
      sha256sum | awk '{print $1}'
  )
}

verify_staging_stack() {
  local mode=${1:-deploy} service container project running health volume redis_volume minio_volume uploads_volume db_info db_host db_name db_user
  for service in "${SERVICES[@]}" postgres redis minio nginx; do
    container="wa_staging_${service//-/_}"
    if ! project=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$container" 2>/dev/null); then
      if [[ "$mode" == "rollback" ]] && [[ " ${SERVICES[*]} " == *" $service "* ]]; then
        continue
      fi
      fail "expected staging container $container is missing"
    fi
    [[ "$project" == "$PROJECT" ]] || fail "$container is not in the $PROJECT Compose project"
    running=$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null) ||
      fail "could not verify runtime state for $container"
    if [[ "$running" != "true" ]] && [[ "$mode" == "rollback" ]] && [[ " ${SERVICES[*]} " == *" $service "* ]]; then
      continue
    fi
    [[ "$running" == "true" ]] || fail "$container is not running"
  done
  for service in postgres redis; do
    container="wa_staging_$service"
    health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$container" 2>/dev/null) ||
      fail "could not verify health state for $container"
    [[ "$health" == "healthy" ]] || fail "$container health is $health, not healthy"
  done

  volume=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}' wa_staging_postgres)
  [[ "$volume" == staging_postgres_staging_data ]] || fail "PostgreSQL is not mounted on the pinned staging volume"
  redis_volume=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' wa_staging_redis)
  [[ "$redis_volume" == staging_redis_staging_data ]] || fail "Redis is not mounted on the pinned staging volume"
  minio_volume=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' wa_staging_minio)
  [[ "$minio_volume" == staging_minio_staging_data ]] || fail "MinIO is not mounted on the pinned staging volume"
  if docker inspect wa_staging_backend >/dev/null 2>&1; then
    uploads_volume=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/app/uploads"}}{{.Name}}{{end}}{{end}}' wa_staging_backend)
    [[ "$uploads_volume" == staging_uploads_staging_data ]] || fail "backend uploads are not mounted on the pinned staging volume"
  elif [[ "$mode" == "rollback" ]]; then
    docker volume inspect staging_uploads_staging_data >/dev/null 2>&1 ||
      fail "the pinned backend uploads volume is missing"
  else
    fail "the staging backend container is missing"
  fi

  if [[ "$mode" == "rollback" ]]; then
    db_user=$(docker exec wa_staging_postgres printenv POSTGRES_USER) || fail "cannot read PostgreSQL role name"
    db_name=$(docker exec wa_staging_postgres printenv POSTGRES_DB) || fail "cannot read PostgreSQL database name"
    [[ "$db_name" == *_staging ]] || fail "database identity is not the expected staging database"
    db_info=$(docker exec wa_staging_postgres psql -X -At -U "$db_user" -d "$db_name" -c 'SELECT current_database()') ||
      fail "cannot verify the staging database directly"
    [[ "$db_info" == "$db_name" ]] || fail "database identity check returned an unexpected database"
  else
    db_info=$(docker exec wa_staging_backend node -e 'const u=new URL(process.env.DATABASE_URL);process.stdout.write(`${u.hostname} ${u.pathname.slice(1)}`)' 2>/dev/null) ||
      fail "could not verify the current backend database identity"
    read -r db_host db_name <<< "$db_info"
    [[ "$db_host" == postgres && "$db_name" == *_staging ]] || fail "database identity is not the expected staging database"
  fi
}

wait_http() {
  local container=$1 url=$2
  for _ in $(seq 1 30); do
    if docker exec "$container" node -e 'fetch(process.argv[1]).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}

verify_rollout_health() {
  local service container running
  for service in "${SERVICES[@]}"; do
    container="wa_staging_${service//-/_}"
    running=$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null) ||
      fail "could not verify runtime state for $container"
    [[ "$running" == "true" ]] || fail "$container is not running after rollout"
  done
  wait_http wa_staging_backend http://127.0.0.1:3001/api/v1/health || fail "backend health check failed"
  wait_http wa_staging_realtime http://127.0.0.1:3002/health || fail "realtime health check failed"
  wait_http wa_staging_whatsapp_web http://127.0.0.1:3004/health || fail "WhatsApp Web health check failed"
  wait_http wa_staging_frontend http://127.0.0.1:3000/ || fail "frontend health check failed"
  docker exec wa_staging_worker node -e 'process.exit(0)' >/dev/null 2>&1 || fail "worker container is not responsive"
  docker exec wa_staging_nginx nginx -t >/dev/null || fail "nginx configuration check failed"
  curl --fail --silent --show-error http://127.0.0.1:8080/api/v1/health >/dev/null ||
    fail "staging ingress health check failed"
}

if [[ "$MODE" == "rollback" ]]; then
  CURRENT_STEP="rollback prerequisites"
  TAG=$REVISION
  [[ "$TAG" =~ ^rollback-[0-9]{8}-[0-9]{6}$ ]] || fail "rollback requires an exact rollback-YYYYMMDD-HHMMSS image tag"
  [[ "${CONFIRM_CODE_ONLY_ROLLBACK:-}" == "$TAG" ]] || fail "set CONFIRM_CODE_ONLY_ROLLBACK to the exact tag after confirming DB compatibility"
  verify_staging_stack rollback
  for service in "${SERVICES[@]}"; do
    docker image inspect "verzchat-staging/$service:$TAG" >/dev/null 2>&1 ||
      fail "rollback image for $service is missing; no containers were changed"
  done
  DB_USER=$(docker exec wa_staging_postgres printenv POSTGRES_USER) || fail "cannot read PostgreSQL role name"
  DB_NAME=$(docker exec wa_staging_postgres printenv POSTGRES_DB) || fail "cannot read PostgreSQL database name"
  [[ "$DB_NAME" == *_staging ]] || fail "database identity is not staging"
  if ! docker exec -i wa_staging_postgres psql -X -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" -f - >/dev/null <<'SQL'
DO $$
DECLARE unfinished bigint;
BEGIN
  IF to_regclass('public._prisma_migrations') IS NULL THEN
    RAISE EXCEPTION 'Prisma migration history is missing';
  END IF;
  SELECT count(*) INTO unfinished
  FROM "_prisma_migrations"
  WHERE "finished_at" IS NULL AND "rolled_back_at" IS NULL;
  IF unfinished > 0 THEN
    RAISE EXCEPTION 'database has % unfinished Prisma migrations; code-only rollback is not sufficient', unfinished;
  END IF;
END $$;
SQL
  then
    fail "unfinished or missing Prisma migration history blocks code-only rollback; use an approved database recovery procedure"
  fi
  NULL_PHONE_CONTACTS=$(docker exec wa_staging_postgres psql -X -At -U "$DB_USER" -d "$DB_NAME" \
    -c 'SELECT count(*) FROM contacts WHERE phone IS NULL') || fail "cannot check Messenger contact rollback compatibility"
  [[ "$NULL_PHONE_CONTACTS" == "0" ]] ||
    fail "the database contains phone-less contacts; rollback to pre-Messenger application code is unsafe"
  if ! docker exec -i wa_staging_postgres psql -X -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" -f - >/dev/null <<'SQL'
DO $$
DECLARE unresolved bigint;
BEGIN
  IF to_regclass('public.ai_credit_reservations') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM ai_credit_reservations WHERE status = ''RESERVED'''
      INTO unresolved;
    IF unresolved > 0 THEN
      RAISE EXCEPTION 'code rollback blocked: % AI-credit reservations are unresolved', unresolved;
    END IF;
  END IF;
END $$;
SQL
  then
    fail "unresolved AI-credit reservations make code-only rollback unsafe"
  fi
  export RELEASE_TAG=$TAG
  "${COMPOSE[@]}" config --quiet || fail "staging Compose configuration is invalid"
  CURRENT_STEP="code-only rollback"
  ROLLOUT_STARTED=true
  "${COMPOSE[@]}" up -d --no-build --force-recreate "${SERVICES[@]}" || fail "image-only rollback rollout failed"
  CURRENT_STEP="verify code-only rollback readiness"
  verify_rollout_health
  ROLLOUT_STARTED=false
  complete_step "code images restored; database was not changed"
  echo "Code images restored from $TAG. Database state was not changed; verify migration compatibility and smoke tests."
  exit 0
fi

[[ "$MODE" == "deploy" ]] || fail "use deploy <40-char-commit> or rollback <rollback-image-tag>"
CURRENT_STEP="candidate identity and approval gates"
[[ "$REVISION" =~ ^[0-9a-f]{40}$ ]] || fail "deployment requires a full 40-character commit SHA"
[[ "$(git -C "$ROOT" rev-parse HEAD)" == "$REVISION" ]] || fail "requested commit is not the checkout HEAD"
[[ -z "$(git -C "$ROOT" status --porcelain --untracked-files=all)" ]] || fail "release checkout must be clean; commit/review all candidate changes first"
git -C "$ROOT" cat-file -e "$REVISION^{commit}" 2>/dev/null || fail "candidate commit does not exist locally"
[[ "${CONFIRM_STAGING_RELEASE:-}" == "$REVISION" ]] || fail "set CONFIRM_STAGING_RELEASE to the exact approved commit SHA"

validate_allowed_extra_migrations || fail "$MIGRATION_GATE_ERROR"
for key in POSTGRES_PASSWORD REDIS_PASSWORD JWT_SECRET JWT_REFRESH_SECRET MINIO_ACCESS_KEY MINIO_SECRET_KEY; do
  require_env "$key"
done
grep -Eq '^(STAGING_PUBLIC_URL|VPS_IP)=.+' "$ENV_FILE" || fail "STAGING_PUBLIC_URL or VPS_IP must be configured"

verify_staging_stack
complete_step "staging project, volumes, and database identity verified"
CURRENT_STEP="staging secret-boundary preflight"
INFRA_DIR="$ROOT/infra" bash "$ROOT/infra/scripts/staging-recreate.sh" check ||
  fail "staging secret-boundary preflight failed"
export RELEASE_TAG=$REVISION
"${COMPOSE[@]}" config --quiet || fail "candidate staging Compose configuration is invalid"
complete_step "staging settings and Compose configuration validated without emitting resolved settings"

CURRENT_STEP="export candidate commit"
if [[ -e "$CANDIDATE_ROOT/$REVISION" ]]; then
  fail "candidate export already exists at $CANDIDATE_ROOT/$REVISION; inspect it rather than overwriting it"
fi
mkdir -p "$CANDIDATE_ROOT"
mkdir "$CANDIDATE_ROOT/$REVISION"
git -C "$ROOT" archive "$REVISION" | tar -x -C "$CANDIDATE_ROOT/$REVISION" || fail "could not export the exact commit"
COMPOSE_FILE="$CANDIDATE_ROOT/$REVISION/infra/docker-compose.staging.yml"
COMPOSE=(docker compose --project-name "$PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE")
complete_step "exact commit exported to an immutable revision directory"

CURRENT_STEP="build versioned runtime images"
echo "Building all versioned runtime images from $REVISION"
"${COMPOSE[@]}" build "${SERVICES[@]}" || fail "candidate image build failed; running services have not been changed"
complete_step "backend, worker, realtime, WhatsApp Web, and frontend images built"
CURRENT_STEP="verify backend Prisma payload"
BACKEND_IMAGE="verzchat-staging/backend:$REVISION"
EXPECTED_MIGRATIONS=$(migration_manifest_hash "$CANDIDATE_ROOT/$REVISION/apps/backend/prisma")
EXPECTED_SCHEMA=$(sha256sum "$CANDIDATE_ROOT/$REVISION/apps/backend/prisma/schema.prisma" | awk '{print $1}')
IMAGE_METADATA=$(docker run --rm --entrypoint sh "$BACKEND_IMAGE" -c \
  'set -e; test -s /app/node_modules/@prisma/client/package.json; node -e "if(typeof require(\"@prisma/client\").PrismaClient!==\"function\")process.exit(1)"; cd /app/prisma; find migrations -type f -name migration.sql | sort | while IFS= read -r file; do printf "%s " "$file"; sha256sum "$file" | awk "{print \$1}"; done | sha256sum | awk "{print \$1}"; sha256sum schema.prisma | awk "{print \$1}"')
IMAGE_MIGRATIONS=$(printf '%s\n' "$IMAGE_METADATA" | sed -n '1p')
IMAGE_SCHEMA=$(printf '%s\n' "$IMAGE_METADATA" | sed -n '2p')
[[ "$EXPECTED_MIGRATIONS" == "$IMAGE_MIGRATIONS" && "$EXPECTED_SCHEMA" == "$IMAGE_SCHEMA" ]] ||
  fail "backend image Prisma schema or migrations do not exactly match the release source"
complete_step "backend image Prisma client, schema, and migration payload verified"

CURRENT_STEP="snapshot current code images"
TAG="rollback-$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$BACKUP_ROOT/$TAG"
umask 077
[[ ! -e "$BACKUP_DIR" ]] || fail "backup path already exists; refusing to overwrite it"
mkdir -p "$BACKUP_DIR" || fail "cannot create a protected release backup directory"
chmod 700 "$BACKUP_ROOT" "$BACKUP_DIR" || fail "cannot secure the release backup directory"
for service in "${SERVICES[@]}"; do
  image_id=$(docker inspect -f '{{.Image}}' "wa_staging_${service//-/_}") || fail "cannot inspect current $service image"
  docker tag "$image_id" "verzchat-staging/$service:$TAG" || fail "cannot snapshot current $service image"
done
complete_step "all current runtime image IDs tagged for code-only rollback"

CURRENT_STEP="verify staging database identity"
DB_INFO=$(docker exec wa_staging_backend node -e 'const u=new URL(process.env.DATABASE_URL);process.stdout.write(`${u.hostname} ${u.pathname.slice(1)}`)' 2>/dev/null) ||
  fail "cannot read database identity from the running backend container"
read -r DB_HOST DB_NAME <<< "$DB_INFO"
[[ "$DB_HOST" == postgres && "$DB_NAME" == *_staging ]] || fail "database identity changed or is not staging"
DB_USER=$(docker exec wa_staging_postgres printenv POSTGRES_USER) || fail "cannot read PostgreSQL role name"
complete_step "database identity rechecked before preflight"

CURRENT_STEP="migration history and data preflight"
echo "Checking migration history and legacy-data preconditions (read-only)"
verify_migration_checksums "$CANDIDATE_ROOT/$REVISION/apps/backend/prisma/migrations" "$BACKUP_DIR/applied-migration-checksums.txt"
STATUS_RC=0
"${COMPOSE[@]}" run --rm --no-deps backend prisma migrate status --schema /app/prisma/schema.prisma \
  > "$BACKUP_DIR/prisma-migrate-status.txt" 2>&1 || STATUS_RC=$?
# Prisma exits 1 for pending migrations (what a release with a migration looks like). Accept that, and the permitted extra
# migration, and nothing else: see check_prisma_migrate_status.
check_prisma_migrate_status "$BACKUP_DIR/prisma-migrate-status.txt" "$STATUS_RC" "$CANDIDATE_ROOT/$REVISION/apps/backend/prisma/migrations" "$BACKUP_DIR/applied-migration-checksums.txt" ||
  fail "Prisma migration history check failed: $MIGRATION_GATE_ERROR (details: $BACKUP_DIR/prisma-migrate-status.txt)"
docker exec -i wa_staging_postgres psql -X -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" -f - \
  < "$CANDIDATE_ROOT/$REVISION/infra/scripts/staging-migration-preflight.sql" \
  > "$BACKUP_DIR/preflight-before.txt" || fail "read-only migration preflight found a blocking conflict"
complete_step "applied checksums, Prisma status, and read-only data preflight passed"

CURRENT_STEP="quiesce writers and verify database backup"
echo "Stopping staging writers before the database snapshot and migration"
"${COMPOSE[@]}" stop --timeout 30 backend worker whatsapp-web || fail "could not stop staging write services"
WRITERS_STOPPED=true
docker exec -i wa_staging_postgres psql -X -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" -f - \
  < "$CANDIDATE_ROOT/$REVISION/infra/scripts/staging-migration-preflight.sql" \
  > "$BACKUP_DIR/preflight-quiesced.txt" || fail "quiesced migration preflight found a blocking conflict"
docker exec wa_staging_postgres pg_dump -U "$DB_USER" -Fc "$DB_NAME" > "$BACKUP_DIR/staging.dump" ||
  fail "database dump failed; write services remain stopped"
chmod 600 "$BACKUP_DIR/staging.dump"
docker exec -i wa_staging_postgres pg_restore --list < "$BACKUP_DIR/staging.dump" >/dev/null ||
  fail "database dump archive is unreadable"
bash "$ROOT/infra/scripts/staging-verify-backup-restore.sh" "$BACKUP_DIR/staging.dump" ||
  fail "isolated database restore rehearsal failed; write services remain stopped"
sha256sum "$BACKUP_DIR/staging.dump" > "$BACKUP_DIR/staging.dump.sha256"
printf '%s\n' "$REVISION" > "$BACKUP_DIR/candidate"
printf '%s\n' "$TAG" > "$BACKUP_DIR/rollback-image-tag"
complete_step "writers quiesced; database dump restored successfully in an isolated rehearsal"

CURRENT_STEP="apply database migrations"
echo "Applying candidate Prisma migrations with the versioned backend image"
"${COMPOSE[@]}" run --rm --no-deps backend prisma migrate deploy --schema /app/prisma/schema.prisma ||
  fail "migration failed; do not restart old code automatically; inspect migration state and database first"
complete_step "candidate Prisma migrations applied once by the backend release job"

CURRENT_STEP="roll out application services and verify readiness"
echo "Rolling out versioned images"
ROLLOUT_STARTED=true
"${COMPOSE[@]}" up -d --no-build --force-recreate "${SERVICES[@]}" ||
  fail "rollout failed after migrations; database remains migrated; use only an approved recovery plan"
WRITERS_STOPPED=false

verify_rollout_health
ROLLOUT_STARTED=false
complete_step "backend, realtime, WhatsApp Web, worker, frontend, nginx, and ingress health checks passed"

echo "Candidate $REVISION is deployed to staging. Backup: $BACKUP_DIR. Rollback image tag: $TAG"
echo "Rollback is code-only and requires CONFIRM_CODE_ONLY_ROLLBACK=$TAG after DB compatibility review."
