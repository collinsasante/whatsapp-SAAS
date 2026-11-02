#!/usr/bin/env bash
# Behavioural test of the staging required-settings check. Uses throwaway fake values and prints only setting NAMES and verdicts.
# Run: bash infra/scripts/tests/staging-required-settings.test.sh
set -u
HERE=$(cd "$(dirname "$0")/.." && pwd)
# shellcheck source=../lib/staging-required-settings.sh
source "$HERE/lib/staging-required-settings.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
PASS=0; FAIL=0
ok() { PASS=$((PASS+1)); echo "ok    $1"; }
no() { FAIL=$((FAIL+1)); echo "FAIL  $1"; }
KEY32=$(head -c 32 /dev/zero | base64)   # 32 zero bytes: a structurally valid key that is not a real secret

full() { # writes a complete env file
  : > "$T/env"
  for k in "${STAGING_REQUIRED_SETTINGS[@]}"; do
    if [ "$k" = CREDENTIALS_ENCRYPTION_KEY ]; then echo "$k=$KEY32" >> "$T/env"; else echo "$k=fake-$k-value" >> "$T/env"; fi
  done
}

full
[ -z "$(staging_missing_settings "$T/env")" ] && ok "a complete file reports nothing missing" || no "a complete file reports nothing missing"
staging_encryption_key_valid "$T/env" && ok "a 32-byte base64 key is accepted" || no "a 32-byte base64 key is accepted"

for k in "${STAGING_REQUIRED_SETTINGS[@]}"; do
  full; grep -v "^$k=" "$T/env" > "$T/env2"
  [ "$(staging_missing_settings "$T/env2")" = "$k" ] && ok "missing $k is reported by name" || no "missing $k is reported by name"
  full; sed "s/^$k=.*/$k=/" "$T/env" > "$T/env2"
  [ "$(staging_missing_settings "$T/env2")" = "$k" ] && ok "empty $k is reported by name" || no "empty $k is reported by name"
done

for k in INTERNAL_SECRET WHATSAPP_WEB_INTERNAL_API_KEY WHATSAPP_APP_SECRET CREDENTIALS_ENCRYPTION_KEY; do
  printf '%s\n' "${STAGING_REQUIRED_SETTINGS[@]}" | grep -qx "$k" && ok "$k is in the required list" || no "$k is in the required list"
done

full; sed 's/^CREDENTIALS_ENCRYPTION_KEY=.*/CREDENTIALS_ENCRYPTION_KEY=c2hvcnQ=/' "$T/env" > "$T/env2"
staging_encryption_key_valid "$T/env2" && no "a key that decodes to the wrong length is rejected" || ok "a key that decodes to the wrong length is rejected"
full; grep -v '^CREDENTIALS_ENCRYPTION_KEY=' "$T/env" > "$T/env2"
staging_encryption_key_valid "$T/env2" && no "an absent key is rejected" || ok "an absent key is rejected"

# Output hygiene: no check may echo a value. Fake values contain the marker "fake-", the real-looking key is all zeros.
full; out=$(staging_missing_settings "$T/env"; staging_encryption_key_valid "$T/env" 2>&1)
printf '%s' "$out" | grep -q "fake-" && no "no value is ever printed" || ok "no value is ever printed"
full; grep -v '^INTERNAL_SECRET=' "$T/env" > "$T/env2"; out=$(staging_missing_settings "$T/env2" 2>&1)
{ printf '%s' "$out" | grep -q "fake-" || printf '%s' "$out" | grep -q "$KEY32"; } && no "a report of missing names prints no values either" || ok "a report of missing names prints no values either"

# The deploy script must actually use the list and the key check.
grep -Fq 'for key in "${STAGING_REQUIRED_SETTINGS[@]}"' "$HERE/staging-release-deploy.sh" && ok "staging-release-deploy.sh enforces the list" || no "staging-release-deploy.sh enforces the list"
grep -Fq 'staging_encryption_key_valid "$ENV_FILE"' "$HERE/staging-release-deploy.sh" && ok "staging-release-deploy.sh checks the encryption key format" || no "staging-release-deploy.sh checks the encryption key format"

echo "---"; echo "passed: $PASS  failed: $FAIL"; [ "$FAIL" -eq 0 ]
