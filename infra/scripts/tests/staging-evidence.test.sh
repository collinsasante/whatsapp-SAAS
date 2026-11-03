#!/usr/bin/env bash
# The staging evidence collector must stay strictly read-only and must not leak secrets. Static checks plus a run against a fake `docker`.
# Run: bash infra/scripts/tests/staging-evidence.test.sh
set -u
ROOT=$(cd "$(dirname "$0")/../../.." && pwd); S="$ROOT/infra/scripts/staging-evidence.sh"
PASS=0; FAIL=0
ok() { PASS=$((PASS+1)); echo "ok    $1"; }
no() { FAIL=$((FAIL+1)); echo "FAIL  $1"; }
check() { if eval "$2"; then ok "$1"; else no "$1"; fi; }
CODE=$(grep -vE '^\s*#' "$S")

check "the script is valid bash" 'bash -n "$S"'
check "no state-changing command (file, container, service, compose or package operations)" '! grep -Eq "(^|[ ;|&(])(rm|mv|cp|chmod|chown|kill|pkill|tee|dd|mkdir|touch|apt|apt-get|yum|npm|pnpm|git (checkout|reset|clean|pull|push|merge|commit))( |$)" <<<"$CODE"'
check "no docker operation other than inspect, exec, ps, stats, image ls/inspect, system df, info, compose config and version" '! grep -Eo "docker (compose )?[a-z-]+( [a-z-]+)?" <<<"$CODE" | grep -Evq "^docker (inspect|exec|ps|stats|image (ls|inspect)|system df|info|compose (config|-p)|compose version|image)"'
check "no compose up/down/start/stop/restart/rm/build/pull/run/create" '! grep -Eq "(docker|docker compose|compose) (up|down|start|stop|restart|rm|build|pull|run|create|kill|pause|unpause|volume|network|system prune)" <<<"$CODE"'
check "no systemctl action other than listing" '! grep -Eq "systemctl (start|stop|restart|reload|enable|disable|mask|daemon)" <<<"$CODE"'
check "SQL is read-only: every session sets default_transaction_read_only" 'grep -q "default_transaction_read_only=on" "$S"'
check "no data-changing SQL keyword" '! grep -Eiq "^\s*(insert into|update [a-z_]+ set|delete from|drop |truncate |alter |create (table|extension|index|database)|grant |revoke )" <<<"$CODE"'
check "the preflights skip their one write (MinIO round trip)" 'grep -q -- "--no-minio-test" "$S"'
check "every place that prints file content goes through the secret filter" 'for what in "crontab -l" "/etc/cron.d" "staging-hybrid-rag" "release-status.txt" "staging-recreate.sh check" "staging-ai-preflight.sh"; do grep -F -A2 "$what" <<<"$CODE" | grep -q withhold || { echo "unfiltered: $what" >&2; exit 1; }; done'
check "it never reads the production database or checkout" '! grep -Eq "wa_postgres|wa_backend|/root/whatsapp-platform|infra/.env([^.]|$)" <<<"$CODE"'
check "no environment VALUE is printed except an explicit non-secret allow-list" '! grep -Eq "printenv [A-Z_]*(KEY|SECRET|TOKEN|PASSWORD)|docker inspect[^|]*\{\{\.Config\.Env\}\}" <<<"$CODE" && grep -q "cut -d= -f1" "$S"'
check "the body runs with stdin closed so it is safe to pipe in with bash -s" 'grep -q "^main </dev/null$" "$S"'

check "the feature_flags query uses the column the schema really has (enabled), not a guess" 'awk "/^model FeatureFlag \\{/,/^\\}/" "$ROOT/apps/backend/prisma/schema.prisma" | grep -Eq "^[[:space:]]+enabled[[:space:]]+Boolean[[:space:]]*(@default\\(false\\))?[[:space:]]*$" && grep -q "key || .=. || enabled::text" "$S" && ! grep -q "is_enabled" "$S"'

T=$(mktemp -d); trap 'rm -rf "$T"' EXIT; mkdir -p "$T/bin"
printf '#!/bin/sh\necho "$@" >> "%s/docker.calls"\nexit 1\n' "$T" > "$T/bin/docker"; chmod +x "$T/bin/docker"
OUT=$(PATH="$T/bin:$PATH" CHECKOUT=/nonexistent BK=/nonexistent bash -s < "$S" 2>&1)
check "piped through 'bash -s' it still reaches the final section" 'grep -q "^########## end" <<<"$OUT"'
check "every section is present" '[ "$(grep -c "^##########" <<<"$OUT")" -ge 17 ]'
check "against a Docker that refuses everything it only attempted read-only docker verbs" '! grep -Eq "^(run|rm|stop|start|restart|kill|pull|build|up|down|create|volume|network|system prune|image rm|compose (up|down|stop|start|restart|rm|build))( |$)" "$T/docker.calls"'

W='withhold() { awk '"'"'{ l=tolower($0); if (l ~ /secret|password|passwd|token|api_?key|private|credential|encrypt/) print "<line withheld: secret-like name>"; else print }'"'"'; }'
eval "$W"
SAMPLE=$(printf 'POSTGRES_PASSWORD=abc\nDEEPSEEK_API_KEY: sk-123\nimage: foo\nJWT_SECRET=x\nRAG_HYBRID_ENABLED=true\n# private note\n' | withhold)
check "the withhold filter hides secret-like lines and keeps the rest" '[ "$(grep -c "withheld" <<<"$SAMPLE")" = 4 ] && grep -q "image: foo" <<<"$SAMPLE" && grep -q "RAG_HYBRID_ENABLED=true" <<<"$SAMPLE" && ! grep -Eq "abc|sk-123" <<<"$SAMPLE"'

echo "---"; echo "passed: $PASS  failed: $FAIL"; [ "$FAIL" -eq 0 ]
