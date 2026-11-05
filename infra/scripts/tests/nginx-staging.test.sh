#!/bin/bash
# Tests infra/nginx/nginx.staging.conf: real client address, trusted-proxy handling, header overwrite, rate limits, preserved settings.
# Needs Docker (nginx:1.27-alpine, node:20-alpine, openssl). Runs on a throwaway network; nothing leaves the machine except an optional
# read of Cloudflare's public range lists to check ours.
set -u
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CONF="$ROOT/infra/nginx/nginx.staging.conf"
HERE="$(cd "$(dirname "$0")" && pwd)"
NET=verznx-net; PASS=0; FAIL=0
ok(){ PASS=$((PASS+1)); echo "ok   - $*"; }; bad(){ FAIL=$((FAIL+1)); echo "FAIL - $*"; }
chk(){ local d="$1"; shift; if "$@" >/dev/null 2>&1; then ok "$d"; else bad "$d"; fi; }
cleanup(){ docker rm -f verznx-tools verznx-strict verznx-trust >/dev/null 2>&1; docker network rm $NET >/dev/null 2>&1; rm -rf "$TMP"; }
# Under the home folder: the Docker VM cannot bind-mount macOS temp dirs (/var/folders).
mkdir -p "$HOME/.cache"; TMP="$(mktemp -d "$HOME/.cache/verznx.XXXXXX")"; trap cleanup EXIT

# ---- static properties of the file
chk "real_ip_header is CF-Connecting-IP (a single value Cloudflare overwrites)" grep -q '^    real_ip_header CF-Connecting-IP;' "$CONF"
chk "real_ip_recursive is off" grep -q '^    real_ip_recursive off;' "$CONF"
chk "no catch-all trusted range (0.0.0.0/0, ::/0, private ranges)" bash -c "! grep -E 'set_real_ip_from (0\.0\.0\.0/0|::/0|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|127\.|::1)' '$CONF'"
chk "client address is replaced, never appended (no proxy_add_x_forwarded_for)" bash -c "! grep -q proxy_add_x_forwarded_for '$CONF'"
chk "every proxied location overwrites X-Forwarded-For with \$remote_addr" bash -c "[ \$(grep -c 'proxy_set_header X-Forwarded-For \$remote_addr;' '$CONF') = \$(grep -c 'proxy_pass ' '$CONF') ]"
chk "client body limit preserved (512M)" grep -q 'client_max_body_size 512M;' "$CONF"
chk "TLS protocols preserved (1.2 and 1.3 only)" grep -q 'ssl_protocols       TLSv1.2 TLSv1.3;' "$CONF"
chk "socket.io upgrade headers preserved" bash -c "grep -q 'proxy_set_header Upgrade \$http_upgrade;' '$CONF' && grep -q 'proxy_set_header Connection \"upgrade\";' '$CONF'"
chk "both servers rate limit webhook, auth and api" bash -c "[ \$(grep -c 'limit_req zone=' '$CONF') = 6 ]"
chk "X-Forwarded-Proto stays https on the TLS listener" grep -q 'proxy_set_header X-Forwarded-Proto https;' "$CONF"

# ---- Cloudflare range lists match Cloudflare's published ones (skipped when offline)
ours() { grep -oE 'set_real_ip_from [^;]+' "$CONF" | awk '{print $2}' | sort; }
for fam in 4 6; do
  live="$(curl -fsS --max-time 15 "https://www.cloudflare.com/ips-v$fam" 2>/dev/null | sort)"
  if [ -z "$live" ]; then echo "skip - could not read Cloudflare's IPv$fam list (offline)"; continue; fi
  mine="$(ours | grep $([ $fam = 6 ] && echo ':' || echo -v) $([ $fam = 6 ] && echo '' || echo ':'))"
  if [ "$mine" = "$live" ]; then ok "IPv$fam trusted ranges equal Cloudflare's published list"; else bad "IPv$fam trusted ranges differ from Cloudflare's list: $(diff <(echo "$mine") <(echo "$live") | tr '\n' ' ')"; fi
done

# ---- nginx accepts the file (self-signed certificate stands in for the Let's Encrypt one)
mkdir -p "$TMP/le/live/staging.verzchat.com"
docker run --rm -v "$TMP/le:/le" nginx:1.27-alpine sh -c 'apk add --no-cache openssl >/dev/null 2>&1; cd /le/live/staging.verzchat.com && openssl req -x509 -newkey rsa:2048 -nodes -keyout privkey.pem -out fullchain.pem -subj "/CN=staging.verzchat.com" -days 2 >/dev/null 2>&1 && cp fullchain.pem chain.pem' >/dev/null 2>&1
docker network rm $NET >/dev/null 2>&1; docker network create $NET >/dev/null
SUBNET="$(docker network inspect $NET -f '{{(index .IPAM.Config 0).Subnet}}')"
cp "$CONF" "$TMP/strict.conf"
# The trusted variant adds this harness's own subnet as a trusted proxy, standing in for a Cloudflare peer.
sed "s|^    real_ip_header CF-Connecting-IP;|    set_real_ip_from $SUBNET;\n    real_ip_header CF-Connecting-IP;|" "$CONF" > "$TMP/trust.conf"
chk "nginx -t accepts the staging configuration" docker run --rm --network $NET -v "$TMP/strict.conf:/etc/nginx/nginx.conf:ro" -v "$TMP/le:/etc/letsencrypt:ro" nginx:1.27-alpine nginx -t

docker run -d --name verznx-tools --network $NET --network-alias backend --network-alias frontend --network-alias realtime -v "$HERE/nginx-staging.driver.js:/driver.js:ro" -e STRICT=verznx-strict -e TRUST=verznx-trust node:20-alpine sh -c 'sleep 600' >/dev/null
docker run -d --name verznx-strict --network $NET -v "$TMP/strict.conf:/etc/nginx/nginx.conf:ro" -v "$TMP/le:/etc/letsencrypt:ro" nginx:1.27-alpine >/dev/null
docker run -d --name verznx-trust  --network $NET -v "$TMP/trust.conf:/etc/nginx/nginx.conf:ro"  -v "$TMP/le:/etc/letsencrypt:ro" nginx:1.27-alpine >/dev/null
sleep 3
# Rate-limit state lives in nginx's memory, so each mode starts against freshly started nginx containers.
run_mode() {
  docker restart verznx-strict verznx-trust >/dev/null; sleep 2
  OUT="$(docker exec -e MODE=$1 verznx-tools node /driver.js 2>&1)"; RC=$?
  echo "$OUT"
  P=$(echo "$OUT" | grep -c '^ok'); F=$(echo "$OUT" | grep -c '^FAIL')
  PASS=$((PASS+P)); FAIL=$((FAIL+F))
  [ $RC -ne 0 ] && [ $F = 0 ] && bad "driver ($1) exited $RC"
}
run_mode headers
run_mode limits
echo; echo "$PASS passed, $FAIL failed"; [ "$FAIL" = 0 ]
