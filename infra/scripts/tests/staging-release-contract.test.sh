#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
RELEASE="$ROOT/infra/scripts/staging-release-deploy.sh"
COMPOSE="$ROOT/infra/docker-compose.staging.yml"
BACKUP_TEST="$ROOT/infra/scripts/staging-verify-backup-restore.sh"
DOCKERIGNORE="$ROOT/.dockerignore"
WORKFLOW="$ROOT/.github/workflows/validate-release-images.yml"
PASS=0
FAIL=0

check() {
  local label=$1 file=$2 pattern=$3
  if grep -Fq -- "$pattern" "$file"; then
    PASS=$((PASS + 1))
    echo "ok    $label"
  else
    FAIL=$((FAIL + 1))
    echo "FAIL  $label"
  fi
}

check "all five application images are in the release set" "$RELEASE" \
  'SERVICES=(backend worker realtime whatsapp-web frontend)'
check "deployment requires a full commit SHA matching HEAD" "$RELEASE" \
  '[[ "$(git -C "$ROOT" rev-parse HEAD)" == "$REVISION" ]]'
check "dirty and untracked work is rejected" "$RELEASE" \
  'git -C "$ROOT" status --porcelain --untracked-files=all'
check "only the pinned commit is exported" "$RELEASE" \
  'git -C "$ROOT" archive "$REVISION"'
check "the five image builds use the exported Compose file" "$RELEASE" \
  '"${COMPOSE[@]}" build "${SERVICES[@]}"'
check "remote Docker contexts are rejected" "$RELEASE" \
  '[[ "$docker_endpoint" == "unix:///var/run/docker.sock" ]]'
check "release concurrency uses a host lock" "$RELEASE" \
  'flock -n 9'
check "failed release state is recorded" "$RELEASE" \
  'failed_step=%s\n'
check "failed rollout logs are saved without printing them" "$RELEASE" \
  'failed-rollout-service-logs.txt'
check "rollback can recover when application containers are stopped" "$RELEASE" \
  'verify_staging_stack rollback'
check "rollback verifies database identity through PostgreSQL itself" "$RELEASE" \
  "SELECT current_database()"
check "rollback refuses an unfinished Prisma migration" "$RELEASE" \
  'unfinished or missing Prisma migration history blocks code-only rollback'
check "the backup rehearsal is isolated from networks" "$BACKUP_TEST" \
  '--network none'
check "the backup restore stops on the first error" "$BACKUP_TEST" \
  '--exit-on-error --no-owner --no-acl'
check "staging backend does not migrate at startup" "$COMPOSE" \
  'command: ["node", "dist/main"]'
check "Docker context excludes workspace dependencies" "$DOCKERIGNORE" \
  '**/node_modules'
check "Docker context excludes generated frontend assets" "$DOCKERIGNORE" \
  '**/.next'
check "Docker context excludes environment files" "$DOCKERIGNORE" \
  '**/.env.*'
check "CI image validation sets up Buildx" "$WORKFLOW" \
  'docker/setup-buildx-action@v3'
check "CI validates both candidate-only migrations in the backend image" "$WORKFLOW" \
  '20261026120000_preserve_legacy_schema_values/migration.sql'

if grep -Eq '^[[:space:]]+push:' "$WORKFLOW" || grep -Fq 'appleboy/ssh-action' "$WORKFLOW"; then
  FAIL=$((FAIL + 1))
  echo "FAIL  image validation has no production-push or SSH deployment trigger"
else
  PASS=$((PASS + 1))
  echo "ok    image validation has no production-push or SSH deployment trigger"
fi

migration_runner_count=$(grep -Fc '"${COMPOSE[@]}" run --rm --no-deps backend prisma migrate deploy' "$RELEASE")
if [[ "$migration_runner_count" == 1 ]]; then
  PASS=$((PASS + 1))
  echo "ok    Prisma deploy has one explicit release runner"
else
  FAIL=$((FAIL + 1))
  echo "FAIL  Prisma deploy has one explicit release runner (found $migration_runner_count)"
fi

echo "---"
echo "passed: $PASS  failed: $FAIL"
[[ "$FAIL" -eq 0 ]]
