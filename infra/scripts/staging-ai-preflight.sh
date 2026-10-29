#!/usr/bin/env bash
# STAGING ONLY. One command for the checks that must pass before AI testing on staging. Run as root on the staging host:
#
#   bash infra/scripts/staging-ai-preflight.sh [--no-minio-test]
#
# Read-only, except the MinIO round trip: it writes ONE uniquely named object (preflight/<uuid>.txt), reads it back, compares it,
# and removes exactly that object. It never lists, overwrites or deletes anything else. Prints PASS / WARN / FAIL lines only: no
# secret values, no fingerprints, no message content. Exit 0 only when nothing FAILED.
set -u
FAILS=0; WARNS=0
pass() { echo "PASS  $*"; }
warn() { echo "WARN  $*"; WARNS=$((WARNS+1)); }
bad()  { echo "FAIL  $*"; FAILS=$((FAILS+1)); }
stop() { echo "FAIL  $*"; echo "STOP: this does not look like the staging host. Nothing else was checked."; exit 1; }

RUN_MINIO=true
for a in "$@"; do case "$a" in --no-minio-test) RUN_MINIO=false ;; *) echo "unknown argument: $a"; exit 2 ;; esac; done

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "run this from the staging release checkout"; exit 2; }
SFILE=${STAGING_ENV_FILE:-$ROOT/infra/.env.staging}
PFILE=${PROD_ENV_FILE:-$ROOT/infra/.env}

echo "== 1. Identity (stops here if this is not staging)"
[ "$(id -u)" = 0 ] || stop "not root"
[ -z "${DOCKER_HOST:-}" ] || stop "DOCKER_HOST is set"
for s in backend worker realtime whatsapp_web frontend postgres redis minio nginx; do
  c="wa_staging_$s"
  p=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$c" 2>/dev/null) || stop "$c does not exist"
  [ "$p" = "verzchat-staging" ] || stop "$c is in project '$p'"
  [ "$(docker inspect -f '{{.State.Running}}' "$c")" = "true" ] || stop "$c is not running"
done
DBNAME=$(docker exec wa_staging_postgres printenv POSTGRES_DB 2>/dev/null) || stop "cannot read the database name"
case "$DBNAME" in *_staging) pass "database name ends in _staging; nine wa_staging_* containers run in project verzchat-staging" ;; *) stop "database '$DBNAME' does not end in _staging" ;; esac
docker exec wa_staging_nginx grep -q 'server_name staging.verzchat.com' /etc/nginx/nginx.conf 2>/dev/null && pass "nginx serves staging.verzchat.com" || stop "nginx does not name staging.verzchat.com"

echo "== 2. Services"
for c in backend worker realtime whatsapp_web frontend; do
  r=$(docker inspect -f '{{.RestartCount}}' "wa_staging_$c")
  [ "$r" -le 2 ] && pass "wa_staging_$c running, restarts=$r" || bad "wa_staging_$c has restarted $r times"
done
for s in postgres redis; do
  h=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "wa_staging_$s")
  [ "$h" = healthy ] && pass "wa_staging_$s healthy" || bad "wa_staging_$s health is $h"
done
code=$(curl -s -o /dev/null -m 10 -w '%{http_code}' http://127.0.0.1:8080/api/v1/health); [ "$code" = 200 ] && pass "ingress health 200" || bad "ingress health returned $code"
code=$(curl -s -o /dev/null -m 10 -w '%{http_code}' http://127.0.0.1:8080/api/v1/ai/test-chat/usage); [ "$code" = 401 ] && pass "AI usage endpoint refuses an unauthenticated caller (401)" || bad "AI usage endpoint returned $code without a token (expected 401)"
n=$(docker logs --since 30m wa_staging_backend 2>&1 | grep -ciE "can't resolve|UnknownDependencies"); [ "$n" = 0 ] && pass "no dependency-injection errors in the last 30 minutes" || bad "$n dependency-injection errors in the backend log"
n=$(docker logs --since 30m wa_staging_backend 2>&1 | grep -c "MinIO init failed"); [ "$n" = 0 ] && pass "no MinIO init failure in the last 30 minutes of the backend log" || warn "the backend logged a MinIO init failure in the last 30 minutes (check the round trip below)"

echo "== 3. Network exposure"
p=$(docker port wa_staging_minio 2>/dev/null); [ -z "$p" ] && pass "staging MinIO publishes no host ports" || bad "staging MinIO publishes host ports (see docker port wa_staging_minio)"
ss -ltn 2>/dev/null | grep -qE ':(9002|9003)\b' && bad "something listens on 9002 or 9003" || pass "nothing listens on 9002 or 9003"

echo "== 4. Settings (names and yes/no only)"
[ -f "$SFILE" ] && pass "staging settings file present" || bad "staging settings file $SFILE is missing"
for k in POSTGRES_PASSWORD REDIS_PASSWORD JWT_SECRET JWT_REFRESH_SECRET MINIO_ACCESS_KEY MINIO_SECRET_KEY DEEPSEEK_API_KEY; do
  awk -F= -v k="$k" '$1==k && length(substr($0,index($0,"=")+1))>0 {f=1} END{exit !f}' "$SFILE" 2>/dev/null && pass "$k is set" || bad "$k is missing or empty"
done
val() { sed -n "s/^$2=//p" "$1" 2>/dev/null | tail -n1 | tr -d '\r"'"'"; }
if [ -f "$PFILE" ]; then
  s=$(val "$SFILE" DEEPSEEK_API_KEY); p=$(val "$PFILE" DEEPSEEK_API_KEY)
  if [ -n "$s" ] && [ "$s" = "$p" ]; then bad "DEEPSEEK_API_KEY is the SAME in staging and production: staging model calls would bill production. Give staging its own key before any live evaluation."
  elif [ -n "$s" ]; then pass "DEEPSEEK_API_KEY differs from production's"; fi
  for k in JWT_SECRET JWT_REFRESH_SECRET; do
    s=$(val "$SFILE" "$k"); p=$(val "$PFILE" "$k")
    [ -n "$s" ] && [ "$s" = "$p" ] && bad "$k is identical in staging and production" || pass "$k differs from production's"
  done
  unset s p
else
  warn "production settings file not found at $PFILE, so the shared-secret comparison was skipped"
fi
# A settings file is only read when a container is CREATED, so also check the keys the RUNNING backend and worker actually hold.
sk=$(val "$SFILE" DEEPSEEK_API_KEY); pk=$(val "$PFILE" DEEPSEEK_API_KEY)
for c in backend worker; do
  ck=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "wa_staging_$c" | sed -n 's/^DEEPSEEK_API_KEY=//p')
  if [ -z "$ck" ]; then warn "the running $c has no DEEPSEEK_API_KEY"
  elif [ -n "$pk" ] && [ "$ck" = "$pk" ]; then bad "the RUNNING $c still uses production's model key: recreate it (backend and worker) after setting the staging key"
  elif [ -n "$sk" ] && [ "$ck" != "$sk" ]; then bad "the RUNNING $c holds a different model key than the settings file: recreate it to apply the file"
  else pass "the running $c uses the staging model key from the settings file"; fi
done
unset sk pk ck
ak=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' wa_staging_backend | sed -n 's/^MINIO_ACCESS_KEY=//p')
mk=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' wa_staging_minio | sed -n 's/^MINIO_ROOT_USER=//p')
[ -n "$ak" ] && [ "$ak" = "$mk" ] && pass "the backend's MinIO key matches MinIO's root user" || bad "the backend's MinIO key does NOT match MinIO's root user"
[ "$mk" = minioadmin ] && bad "MinIO is using the built-in default login"
unset ak mk

echo "== 5. Prompt state (must not have changed by itself)"
docker exec wa_staging_postgres sh -c 'psql -X -At -F " | " -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT t.key, v.version, v.status FROM ai_prompt_versions v JOIN ai_prompt_templates t ON t.id=v.template_id ORDER BY v.created_at"' 2>/dev/null \
  | sed 's/^/INFO  /' || warn "could not read the prompt versions"

echo "== 6. MinIO round trip (one temporary object, removed afterwards)"
if [ "$RUN_MINIO" = true ]; then
  out=$(docker exec -i wa_staging_backend node - <<'NODE' 2>&1
const M = require('minio');
const crypto = require('crypto');
(async () => {
  const c = new M.Client({ endPoint: process.env.MINIO_ENDPOINT, port: Number(process.env.MINIO_PORT), useSSL: false, accessKey: process.env.MINIO_ACCESS_KEY, secretKey: process.env.MINIO_SECRET_KEY });
  const bucket = process.env.MINIO_BUCKET;
  if (!(await c.bucketExists(bucket))) { console.log('RESULT bucket-missing'); return; }
  const key = `preflight/${crypto.randomUUID()}.txt`;
  const body = Buffer.from(`preflight ${crypto.randomBytes(16).toString('hex')}`);
  let state = 'start';
  try {
    await c.putObject(bucket, key, body, body.length, { 'Content-Type': 'text/plain' });
    state = 'written';
    const chunks = [];
    for await (const ch of await c.getObject(bucket, key)) chunks.push(ch);
    state = Buffer.concat(chunks).equals(body) ? 'matched' : 'mismatch';
  } catch (e) { state = `error-${e.code || 'unknown'}`; }
  try { await c.removeObject(bucket, key); } catch (e) { state += `+cleanup-failed`; }
  console.log('RESULT ' + state);
})();
NODE
)
  case "$out" in
    *"RESULT matched") pass "uploaded, read back and removed one temporary object; contents matched" ;;
    *"RESULT bucket-missing") bad "the staging bucket does not exist" ;;
    *) bad "MinIO round trip did not succeed ($(echo "$out" | grep -o 'RESULT .*' | head -1))" ;;
  esac
else
  warn "MinIO round trip skipped (--no-minio-test)"
fi

echo
echo "summary: $FAILS failed, $WARNS warnings"
[ "$FAILS" = 0 ] && echo "STAGING AI PREFLIGHT: OK" || echo "STAGING AI PREFLIGHT: NOT READY"
[ "$FAILS" = 0 ]
