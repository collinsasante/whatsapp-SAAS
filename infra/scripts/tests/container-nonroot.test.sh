#!/bin/bash
# Least-privilege checks for the server images.
#   container-nonroot.test.sh static                 no Docker needed: Dockerfiles and the entrypoint
#   container-nonroot.test.sh runtime <tag> [pgimage] built images tagged verz-local/<service>:<tag>
# Runtime mode runs the images on an isolated throwaway network with a throwaway PostgreSQL and Redis. Nothing is pushed or deployed.
set -u
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "ok   - $*"; }
bad()  { FAIL=$((FAIL+1)); echo "FAIL - $*"; }
check(){ local d="$1"; shift; if "$@" >/dev/null 2>&1; then ok "$d"; else bad "$d"; fi; }

static() {
  for s in backend worker realtime whatsapp-web frontend; do
    f="$ROOT/apps/$s/Dockerfile"
    runner="$(sed -n '/AS runner/,$p' "$f")"
    if [ "$s" = backend ]; then
      check "backend: runs through the privilege-dropping entrypoint" grep -q 'ENTRYPOINT \["/usr/local/bin/docker-entrypoint.sh"\]' "$f"
      check "backend: su-exec is installed in the runner" bash -c "echo '$runner' | grep -q su-exec"
    else
      check "$s: runner stage sets a non-root USER" bash -c "echo '$runner' | grep -Eq '^USER (node|nextjs|[0-9]+)\$' && ! echo '$runner' | grep -Eq '^USER (root|0)\$'"
    fi
  done
  E="$ROOT/apps/backend/docker-entrypoint.sh"
  check "entrypoint: valid sh syntax" sh -n "$E"
  check "entrypoint: executable" test -x "$E"
  check "entrypoint: ends in exec su-exec (PID 1 is the app, signals reach it)" grep -q 'exec su-exec node:node' "$E"
  check "entrypoint: the privilege drop comes before the app is exec'd (root never runs the app)" bash -c "a=\$(grep -n 'exec su-exec' '$E' | head -1 | cut -d: -f1); b=\$(grep -n '^exec \"\\\$@\"' '$E' | tail -1 | cut -d: -f1); [ -n \"\$a\" ] && [ -n \"\$b\" ] && [ \"\$a\" -lt \"\$b\" ]"
  # Behaviour of the entrypoint logic with a fake su-exec and a fake id/stat: root with a root-owned dir chowns once, then drops.
  T="$(mktemp -d)"; mkdir -p "$T/bin" "$T/uploads"
  cat > "$T/bin/id"      <<'X'
#!/bin/sh
[ "$1" = "-u" ] && [ -z "$2" ] && { echo 0; exit 0; }
[ "$1" = "-u" ] && { echo 1000; exit 0; }
X
  cat > "$T/bin/stat"    <<'X'
#!/bin/sh
cat "$FAKE_OWNER_FILE"
X
  cat > "$T/bin/chown"   <<'X'
#!/bin/sh
echo "$@" >> "$FAKE_LOG"; echo 1000 > "$FAKE_OWNER_FILE"
X
  cat > "$T/bin/su-exec" <<'X'
#!/bin/sh
echo "su-exec $1" >> "$FAKE_LOG"
X
  chmod +x "$T"/bin/*
  export FAKE_OWNER_FILE="$T/owner" FAKE_LOG="$T/log" LOCAL_UPLOAD_PATH="$T/uploads"; echo 0 > "$T/owner"; : > "$T/log"
  PATH="$T/bin:$PATH" sh "$E" true >/dev/null 2>&1; PATH="$T/bin:$PATH" sh "$E" true >/dev/null 2>&1
  check "entrypoint: chowns an old root-owned volume exactly once" test "$(grep -c '^-R' "$T/log")" = 1
  check "entrypoint: drops privileges on every start" test "$(grep -c '^su-exec node:node' "$T/log")" = 2
  rm -rf "$T"
}

runtime() {
  TAG="$1"; PG="${2:-pgvector/pgvector:pg16}"; NET=verznr-net; DBURL="postgresql://verz:nr-pass-0123@verznr-pg:5432/verz"
  docker rm -f verznr-pg verznr-redis verznr-backend verznr-worker verznr-realtime verznr-wa >/dev/null 2>&1; docker network rm $NET >/dev/null 2>&1; docker volume rm -f verznr-uploads >/dev/null 2>&1
  trap 'docker rm -f verznr-pg verznr-redis verznr-backend verznr-worker verznr-realtime verznr-wa >/dev/null 2>&1; docker network rm $NET >/dev/null 2>&1; docker volume rm -f verznr-uploads >/dev/null 2>&1' EXIT
  docker network create $NET >/dev/null
  docker run -d --name verznr-pg --network $NET -e POSTGRES_USER=verz -e POSTGRES_PASSWORD=nr-pass-0123 -e POSTGRES_DB=verz "$PG" >/dev/null
  docker run -d --name verznr-redis --network $NET redis:7-alpine redis-server --requirepass nr-redis-0123 >/dev/null
  for i in $(seq 1 40); do docker exec verznr-pg pg_isready -U verz >/dev/null 2>&1 && break; sleep 1; done
  local C=(-e NODE_ENV=production -e DATABASE_URL=$DBURL -e REDIS_HOST=verznr-redis -e REDIS_PORT=6379 -e REDIS_PASSWORD=nr-redis-0123)
  local SEC=(-e JWT_SECRET=nr-jwt-0123456789abcdef -e JWT_REFRESH_SECRET=nr-refresh-0123456789abcdef -e INTERNAL_SECRET=nr-internal-0123456789abcdef -e WHATSAPP_WEB_INTERNAL_API_KEY=nr-wa-0123456789abcdef -e WHATSAPP_APP_SECRET=nr-app-0123456789abcdef)

  # An uploads volume the way an existing install has it: populated by a root-run backend.
  docker volume create verznr-uploads >/dev/null
  docker run --rm -v verznr-uploads:/d alpine sh -c 'mkdir -p /d/tenant-old && echo old > /d/tenant-old/a.txt && chown -R 0:0 /d && chmod 755 /d /d/tenant-old'

  start_backend() {
    docker rm -f verznr-backend >/dev/null 2>&1
    docker run -d --name verznr-backend --network $NET "${C[@]}" "${SEC[@]}" -e FRONTEND_URL=http://localhost:3000 -e CORS_ORIGINS=http://localhost:3000 -e STORAGE_DRIVER=local -e LOCAL_UPLOAD_PATH=/app/uploads \
      -v verznr-uploads:/app/uploads --health-cmd 'wget -qO- http://localhost:3001/api/v1/health || exit 1' --health-interval 3s --health-retries 20 "verz-local/backend:$TAG" >/dev/null
    for i in $(seq 1 90); do [ "$(docker inspect -f '{{.State.Health.Status}}' verznr-backend 2>/dev/null)" = healthy ] && return 0; sleep 2; done; return 1
  }
  if start_backend; then ok "backend: healthy under the image's own start command (migrations ran as the node user)"; else bad "backend: did not become healthy"; docker logs verznr-backend 2>&1 | tail -15; fi
  check "backend: entrypoint reported the one-time ownership fix" bash -c "docker logs verznr-backend 2>&1 | grep -q 'giving /app/uploads to the node user'"
  check "backend: the node process is not root" bash -c "docker exec verznr-backend sh -c 'for p in /proc/[0-9]*; do n=\$(cat \$p/comm 2>/dev/null); u=\$(awk \"/^Uid:/{print \\\$2}\" \$p/status); [ \"\$n\" = node ] && [ \"\$u\" != 0 ] && exit 0; done; exit 1'"
  # docker exec starts as the image's default user (root for the backend, whose entrypoint drops privileges), so look at the app's own process tree, not at an exec'd shell.
  check "backend: PID 1 (the app, after the privilege drop) is not root" bash -c "[ \"\$(docker exec verznr-backend awk '/^Uid:/{print \$2}' /proc/1/status)\" != 0 ]"
  check "backend: no child of PID 1 is root either (migration, ffmpeg and node all run as node)" bash -c "[ \"\$(docker exec verznr-backend sh -c 'for p in /proc/[0-9]*; do pp=\$(awk \"/^PPid:/{print \\\$2}\" \$p/status 2>/dev/null); [ \"\$pp\" = 1 ] && awk \"/^Uid:/{print \\\$2}\" \$p/status; done | grep -cx 0')\" = 0 ]"
  check "backend: as the node user, can create a new tenant folder and file in the pre-existing volume" docker exec -u node verznr-backend node -e "const fs=require('fs');fs.mkdirSync('/app/uploads/tenant-new/sub',{recursive:true});fs.writeFileSync('/app/uploads/tenant-new/sub/f.bin','x');fs.writeFileSync('/app/uploads/tenant-old/b.txt','y')"
  check "backend: as the node user, can still read files the old root-run backend wrote" docker exec -u node verznr-backend cat /app/uploads/tenant-old/a.txt
  check "backend: as the node user, cannot modify its own code tree" bash -c "! docker exec -u node verznr-backend sh -c 'touch /app/dist/x' 2>/dev/null"
  check "backend: as the node user, cannot write to the root filesystem" bash -c "! docker exec -u node verznr-backend sh -c 'touch /etc/x' 2>/dev/null"
  S=$(date +%s); docker stop -t 30 verznr-backend >/dev/null; E=$(date +%s)
  check "backend: SIGTERM ends it cleanly (exit 0) within the grace period" bash -c "[ \"\$(docker inspect -f '{{.State.ExitCode}}' verznr-backend)\" = 0 ] && [ $((E-S)) -lt 25 ]"
  if start_backend; then ok "backend: restart on the already-fixed volume is healthy"; else bad "backend: restart unhealthy"; fi
  check "backend: second start does not re-run the recursive ownership fix" bash -c "! docker logs verznr-backend 2>&1 | tail -n +1 | awk '/giving/{c++} END{exit !(c>1)}'"

  # Stateless services: not root, start, stop cleanly
  svc() { # name image-service extra-env... ; wait-pattern
    local n="$1" im="$2" pat="$3"; shift 3
    docker run -d --name "verznr-$n" --network $NET "${C[@]}" "${SEC[@]}" "$@" "verz-local/$im:$TAG" >/dev/null
    for i in $(seq 1 60); do docker logs "verznr-$n" 2>&1 | grep -q "$pat" && break; [ "$(docker inspect -f '{{.State.Running}}' verznr-$n)" = true ] || break; sleep 1; done
    check "$im: started ('$pat')" bash -c "docker logs verznr-$n 2>&1 | grep -q '$pat'"
    check "$im: image USER is not root" bash -c "u=\$(docker image inspect verz-local/$im:$TAG --format '{{.Config.User}}'); [ -n \"\$u\" ] && [ \"\$u\" != root ] && [ \"\$u\" != 0 ]"
    check "$im: the running node process is not root" bash -c "[ \"\$(docker exec verznr-$n id -u)\" != 0 ]"
    check "$im: no error-level log lines" bash -c "! docker logs verznr-$n 2>&1 | grep -qiE '(^|[^a-z])error([^a-z]|\$)|EACCES|EPERM'"
    S=$(date +%s); docker stop -t 30 "verznr-$n" >/dev/null; E=$(date +%s)
    check "$im: SIGTERM ends it with exit 0 inside the grace period" bash -c "[ \"\$(docker inspect -f '{{.State.ExitCode}}' verznr-$n)\" = 0 ] && [ $((E-S)) -lt 28 ]"
  }
  svc worker worker "All workers started" -e INTERNAL_SECRET=nr-internal-0123456789abcdef
  svc realtime realtime "Realtime server running" -e CORS_ORIGINS=http://localhost:3000
  check "realtime: Docker's own HEALTHCHECK is defined" bash -c "[ -n \"\$(docker image inspect verz-local/realtime:$TAG --format '{{.Config.Healthcheck}}' | tr -d '<nil>[]')\" ]"
  svc wa whatsapp-web "listening\|running\|started\|3004"
}

case "${1:-}" in
  static) static ;;
  runtime) shift; static; runtime "$@" ;;
  *) echo "usage: $0 static | runtime <tag> [pgimage]"; exit 2 ;;
esac
echo; echo "$PASS passed, $FAIL failed"; [ "$FAIL" = 0 ]
