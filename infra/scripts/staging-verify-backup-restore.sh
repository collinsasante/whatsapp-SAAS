#!/usr/bin/env bash
set -euo pipefail

BACKUP=${1:-}
if [[ -z "$BACKUP" || ! -s "$BACKUP" ]]; then
  echo "Usage: $0 /absolute/path/to/staging-backup.dump" >&2
  exit 2
fi

command -v docker >/dev/null 2>&1 || { echo "ABORT: docker is required." >&2; exit 1; }
docker image inspect postgres:16-alpine >/dev/null 2>&1 || {
  echo "ABORT: postgres:16-alpine must be available locally; pull it before the release window." >&2
  exit 1
}

NAME="verzchat-restore-check-$(date +%Y%m%d%H%M%S)-$$"
CONTAINER_ID=""
cleanup() {
  if [[ -n "$CONTAINER_ID" ]] && docker container inspect "$CONTAINER_ID" >/dev/null 2>&1; then
    if ! docker rm --force "$CONTAINER_ID" >/dev/null; then
      echo "WARNING: could not remove isolated restore-test container $CONTAINER_ID." >&2
    fi
  fi
}
trap cleanup EXIT

CONTAINER_ID=$(docker run --detach --rm \
  --name "$NAME" \
  --network none \
  --env POSTGRES_USER=restoretest \
  --env POSTGRES_PASSWORD=restore-only-not-a-secret \
  --env POSTGRES_DB=restoretest \
  postgres:16-alpine)

ready=false
for _ in $(seq 1 60); do
  if docker exec "$CONTAINER_ID" pg_isready -U restoretest -d restoretest >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
[[ "$ready" == true ]] || { echo "ABORT: isolated PostgreSQL did not become ready." >&2; exit 1; }

docker cp "$BACKUP" "$CONTAINER_ID:/tmp/restore.dump" >/dev/null
docker exec "$CONTAINER_ID" pg_restore --list /tmp/restore.dump >/dev/null
docker exec "$CONTAINER_ID" pg_restore \
  --exit-on-error --no-owner --no-acl \
  -U restoretest -d restoretest /tmp/restore.dump >/dev/null
echo "PASS: PostgreSQL dump restored in an isolated, network-disabled disposable container."
