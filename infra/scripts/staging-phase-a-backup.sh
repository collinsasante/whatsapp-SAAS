#!/usr/bin/env bash
# Read-only against staging (creates files under /root/staging-release-backups only). Prints no secrets.
set -u
TS=$(date +%Y%m%d-%H%M%S); B=/root/staging-release-backups/$TS
mkdir -p "$B" && chmod 700 "$B" || { echo "ABORT: cannot create $B"; exit 1; }
fail() { echo "ABORT: $*"; exit 1; }
SERVICES="backend worker whatsapp_web frontend"

echo "== 1. Prove this is STAGING"
for s in $SERVICES postgres; do
  c=wa_staging_$s
  docker inspect -f '{{.Name}} state={{.State.Status}} project={{index .Config.Labels "com.docker.compose.project"}}' "$c" || fail "$c not found"
  [ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$c")" = "verzchat-staging" ] || fail "$c is not in compose project verzchat-staging"
done
DBNAME=$(docker exec wa_staging_backend printenv DATABASE_URL | sed -E 's#.*/([^/?]+).*#\1#')
echo "backend database name: $DBNAME"; case "$DBNAME" in *_staging) ;; *) fail "database '$DBNAME' does not look like staging";; esac
echo "other (non-staging) containers on this host, listed only, never touched:"
docker ps --format '{{.Names}}' | grep -v '^wa_staging_' | sed 's/^/  /'

echo "== 2. Recovery points (image tag by NAME first -- tagging by id failed last time)"
{
for s in $SERVICES; do
  c=wa_staging_$s
  name=$(docker inspect -f '{{.Config.Image}}' "$c") || fail "$c"
  tag="wa-staging-backup/${s}:$TS"
  docker tag "$name" "$tag" || fail "could not tag $name"
  docker image inspect "$tag" >/dev/null || fail "backup tag $tag unreadable"
  docker save "$tag" -o "$B/$s.tar" || fail "docker save $s"
  [ -s "$B/$s.tar" ] || fail "$B/$s.tar empty"
  tar -tf "$B/$s.tar" >/dev/null || fail "$B/$s.tar is not a readable archive"
  echo "$s image=$name backup_tag=$tag sha256=$(sha256sum "$B/$s.tar" | cut -d' ' -f1) bytes=$(stat -c %s "$B/$s.tar")"
  # prove the backup image is usable: create (not start) a container from it, then remove it
  docker create --name "chk-$s-$TS" "$tag" >/dev/null && docker rm "chk-$s-$TS" >/dev/null || fail "backup image $tag cannot create a container"
done
} | tee "$B/MANIFEST.txt"

echo "== 3. Copies of the deployed code (used by the hot-swap rollback)"
for s in backend worker whatsapp_web; do
  docker cp "wa_staging_$s:/app/dist" "$B/dist-$s" || fail "docker cp dist from $s"
  [ -n "$(ls -A "$B/dist-$s")" ] || fail "dist-$s empty"
  echo "dist-$s: $(find "$B/dist-$s" -type f | wc -l) files"
done
docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' wa_staging_frontend | grep '^NEXT_PUBLIC_' > "$B/frontend-build-args.env"; chmod 600 "$B/frontend-build-args.env"
echo "frontend build args captured: $(wc -l < "$B/frontend-build-args.env") (names: $(cut -d= -f1 "$B/frontend-build-args.env" | tr '\n' ' '))"

echo "== 4. Staging database dump (no schema change is planned; this protects data written by the new code)"
PGUSER_=$(docker exec wa_staging_postgres printenv POSTGRES_USER)
docker exec wa_staging_postgres pg_dump -U "$PGUSER_" -Fc "$DBNAME" > "$B/db.dump" || fail "pg_dump"
docker exec -i wa_staging_postgres pg_restore -l < "$B/db.dump" | head -3 | grep -q . || fail "db.dump is not a readable dump"
echo "db.dump bytes=$(stat -c %s "$B/db.dump") table-of-contents entries=$(docker exec -i wa_staging_postgres pg_restore -l < "$B/db.dump" | grep -c TABLE)"
echo "migrations applied: $(docker exec wa_staging_postgres psql -U "$PGUSER_" -d "$DBNAME" -tAc 'select count(*) from _prisma_migrations')"

echo; echo "BACKUP COMPLETE: $B"; ls -la "$B"; df -h /root | tail -1
