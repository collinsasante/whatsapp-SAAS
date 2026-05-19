#!/bin/bash
# Backup: PostgreSQL + Redis → local + remote (Backblaze B2 via rclone)
# Cron: 0 2 * * * root bash /root/whatsapp-platform/infra/scripts/backup.sh >> /var/log/verzchat-backup.log 2>&1
set -euo pipefail

BACKUP_DIR="/opt/backups/whatsapp-platform"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RETAIN_DAYS=7
REMOTE_RETAIN_DAYS=30

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

mkdir -p "$BACKUP_DIR"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

log "=== Backup started ==="

# ── PostgreSQL ────────────────────────────────────────────────────────────────

log "Backing up PostgreSQL..."
PG_FILE="$BACKUP_DIR/postgres_${TIMESTAMP}.sql.gz"

docker exec wa_postgres pg_dump \
  -U "${POSTGRES_USER:-waplatform}" \
  --no-password \
  "${POSTGRES_DB:-waplatform}" \
  | gzip -9 > "$PG_FILE"

PG_SIZE=$(du -sh "$PG_FILE" | cut -f1)
log "PostgreSQL backup: $PG_FILE ($PG_SIZE)"

# Verify the dump is not empty/corrupted
LINES=$(zcat "$PG_FILE" | wc -l)
if [[ "$LINES" -lt 10 ]]; then
  log "ERROR: PostgreSQL dump appears empty (only $LINES lines). Aborting."
  exit 1
fi

# ── Redis ─────────────────────────────────────────────────────────────────────

log "Backing up Redis..."
REDIS_FILE="$BACKUP_DIR/redis_${TIMESTAMP}.rdb"

if [[ -n "${REDIS_PASSWORD:-}" ]]; then
  docker exec wa_redis redis-cli -a "$REDIS_PASSWORD" --no-auth-warning BGSAVE
else
  docker exec wa_redis redis-cli BGSAVE
fi

# Wait for BGSAVE to complete
for i in $(seq 1 10); do
  LAST_SAVE=$(docker exec wa_redis redis-cli ${REDIS_PASSWORD:+-a "$REDIS_PASSWORD"} ${REDIS_PASSWORD:+--no-auth-warning} LASTSAVE 2>/dev/null || echo "0")
  NOW=$(date +%s)
  if [[ $((NOW - LAST_SAVE)) -lt 30 ]]; then break; fi
  sleep 2
done

docker cp wa_redis:/data/dump.rdb "$REDIS_FILE" 2>/dev/null || log "WARNING: Redis dump.rdb not found, skipping"

if [[ -f "$REDIS_FILE" ]]; then
  REDIS_SIZE=$(du -sh "$REDIS_FILE" | cut -f1)
  log "Redis backup: $REDIS_FILE ($REDIS_SIZE)"
fi

# ── Remote upload via rclone ──────────────────────────────────────────────────

if command -v rclone &>/dev/null && rclone listremotes 2>/dev/null | grep -q "b2:"; then
  REMOTE_PATH="b2:${B2_BUCKET:-verzchat-backups}/$(date +%Y/%m)"
  log "Uploading to remote: $REMOTE_PATH"

  rclone copy "$PG_FILE" "$REMOTE_PATH/" \
    --log-level ERROR \
    --retries 3 \
    --low-level-retries 3 \
    && log "PostgreSQL uploaded to remote."

  if [[ -f "$REDIS_FILE" ]]; then
    rclone copy "$REDIS_FILE" "$REMOTE_PATH/" \
      --log-level ERROR \
      --retries 3 \
      && log "Redis uploaded to remote."
  fi

  # Prune remote backups older than REMOTE_RETAIN_DAYS
  rclone delete "b2:${B2_BUCKET:-verzchat-backups}" \
    --min-age "${REMOTE_RETAIN_DAYS}d" \
    --log-level ERROR 2>/dev/null || true

  log "Remote upload complete."
else
  log "WARNING: rclone not configured or no 'b2:' remote found. Skipping remote upload."
  log "         Run 'rclone config' and add a Backblaze B2 remote named 'b2'."
fi

# ── Local rotation ────────────────────────────────────────────────────────────

log "Rotating local backups older than $RETAIN_DAYS days..."
find "$BACKUP_DIR" -name "*.sql.gz" -mtime "+$RETAIN_DAYS" -delete
find "$BACKUP_DIR" -name "*.rdb"    -mtime "+$RETAIN_DAYS" -delete

log "=== Backup complete. Local files: ==="
ls -lh "$BACKUP_DIR" | tail -10
