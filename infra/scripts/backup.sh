#!/bin/bash
set -e

BACKUP_DIR="/opt/backups/whatsapp-platform"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RETAIN_DAYS=7

mkdir -p "$BACKUP_DIR"

# Load environment
source "$(dirname "$0")/../.env"

echo "[$TIMESTAMP] Starting backup..."

# PostgreSQL backup
echo "Backing up PostgreSQL..."
docker exec wa_postgres pg_dump \
    -U "$POSTGRES_USER" \
    -d "$POSTGRES_DB" \
    --no-password \
    | gzip > "$BACKUP_DIR/postgres_$TIMESTAMP.sql.gz"

echo "PostgreSQL backup complete: postgres_$TIMESTAMP.sql.gz"

# Redis backup (trigger BGSAVE)
echo "Backing up Redis..."
docker exec wa_redis redis-cli -a "$REDIS_PASSWORD" BGSAVE
sleep 2
docker cp wa_redis:/data/dump.rdb "$BACKUP_DIR/redis_$TIMESTAMP.rdb"

echo "Redis backup complete: redis_$TIMESTAMP.rdb"

# Remove old backups
echo "Cleaning backups older than $RETAIN_DAYS days..."
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +$RETAIN_DAYS -delete
find "$BACKUP_DIR" -name "*.rdb" -mtime +$RETAIN_DAYS -delete

echo "[$TIMESTAMP] Backup complete. Files in $BACKUP_DIR"
ls -lh "$BACKUP_DIR"
