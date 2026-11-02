#!/usr/bin/env bash
# Checks the staging Compose file passes each service the settings its code reads. Names only; no values are read or printed.
# Run: bash infra/scripts/tests/staging-compose-env.test.sh
set -u
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
COMPOSE="$ROOT/infra/docker-compose.staging.yml"
EXAMPLE="$ROOT/infra/.env.staging.example"
PASS=0; FAIL=0
ok() { PASS=$((PASS+1)); echo "ok    $1"; }
no() { FAIL=$((FAIL+1)); echo "FAIL  $1"; }

# Text of one service block (from "  name:" to the next two-space-indented key).
block() { awk -v svc="  $1:" '$0 == svc {on=1; next} on && /^  [A-Za-z0-9_-]+:/ {exit} on {print}' "$COMPOSE"; }
has() { block "$1" | grep -Eq "^      $2:"; }

need() { # service, names...
  local svc=$1; shift
  for k in "$@"; do has "$svc" "$k" && ok "$svc passes $k" || no "$svc passes $k"; done
}
forbid() { # service, names...
  local svc=$1; shift
  for k in "$@"; do has "$svc" "$k" && no "$svc must not set $k" || ok "$svc does not set $k"; done
}

need backend JWT_SECRET JWT_REFRESH_SECRET INTERNAL_SECRET WHATSAPP_WEB_INTERNAL_API_KEY WHATSAPP_APP_SECRET CREDENTIALS_ENCRYPTION_KEY \
  RESEND_WEBHOOK_SECRET PAYSTACK_SECRET_KEY PAYSTACK_PUBLIC_KEY FACEBOOK_APP_SECRET REALTIME_URL WHATSAPP_WEB_INTERNAL_URL
need worker INTERNAL_SECRET WHATSAPP_WEB_INTERNAL_API_KEY WHATSAPP_WEB_INTERNAL_URL CREDENTIALS_ENCRYPTION_KEY PAYSTACK_SECRET_KEY PUBLIC_BASE_URL BACKEND_URL
need realtime JWT_SECRET INTERNAL_SECRET REDIS_PASSWORD
need whatsapp-web WHATSAPP_WEB_INTERNAL_API_KEY CREDENTIALS_ENCRYPTION_KEY BACKEND_INTERNAL_URL DATABASE_URL

block worker | grep -Eq '^      BACKEND_URL: http://backend:3001/api/v1$' && ok "worker BACKEND_URL includes the /api/v1 prefix" || no "worker BACKEND_URL includes the /api/v1 prefix"
block worker | grep -Eq '^      PUBLIC_BASE_URL: .*/api/v1$' && ok "worker PUBLIC_BASE_URL is the staging address with /api/v1 (not production)" || no "worker PUBLIC_BASE_URL is the staging address with /api/v1"
block worker | grep -Eq 'verzchat\.com' && no "worker has no hard-coded production address" || ok "worker has no hard-coded production address"

# These weaken authentication or SSRF protection, or are test-only. They must never be set on staging.
for svc in backend worker realtime whatsapp-web; do
  forbid "$svc" SKIP_2FA SKIP_EMAIL_VERIFICATION WEBHOOK_ALLOW_PRIVATE_URLS TENANT_ISOLATION_TEST_DATABASE_URL MEDIA_TEST_DATABASE_URL RAG_TEST_DATABASE_URL
done

# Every secret a service needs must be listed in the example file so an operator knows to set it.
for k in INTERNAL_SECRET WHATSAPP_WEB_INTERNAL_API_KEY WHATSAPP_APP_SECRET CREDENTIALS_ENCRYPTION_KEY RESEND_WEBHOOK_SECRET PAYSTACK_SECRET_KEY PAYSTACK_PUBLIC_KEY; do
  grep -Eq "^$k=" "$EXAMPLE" && ok ".env.staging.example lists $k" || no ".env.staging.example lists $k"
done

# A ${VAR} reference with no default makes Compose print a warning and use an empty string; flag any not documented in the example.
undocumented=$(grep -oE '\$\{[A-Z0-9_]+\}' "$COMPOSE" | tr -d '${}' | sort -u | while read -r v; do grep -Eq "^$v=" "$EXAMPLE" || echo "$v"; done | tr '\n' ' ')
[ -z "$undocumented" ] && ok "every default-less \${VAR} is documented in the example" || no "undocumented default-less variables: $undocumented"

echo "---"; echo "passed: $PASS  failed: $FAIL"; [ "$FAIL" -eq 0 ]
