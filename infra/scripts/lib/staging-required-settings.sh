#!/usr/bin/env bash
# Settings the staging stack cannot run safely without. Sourced by staging-release-deploy.sh; tested by
# tests/staging-required-settings.test.sh. Reads the env file as text (never sources it) and prints setting NAMES only.
#
# The last four are enforced by the application itself in production mode (staging runs NODE_ENV=production):
#   INTERNAL_SECRET, WHATSAPP_WEB_INTERNAL_API_KEY, WHATSAPP_APP_SECRET -> the backend refuses to start without them.
#   CREDENTIALS_ENCRYPTION_KEY -> without it the worker cannot open encrypted WhatsApp credentials and campaign sends fail.
STAGING_REQUIRED_SETTINGS=(
  POSTGRES_PASSWORD REDIS_PASSWORD JWT_SECRET JWT_REFRESH_SECRET MINIO_ACCESS_KEY MINIO_SECRET_KEY
  INTERNAL_SECRET WHATSAPP_WEB_INTERNAL_API_KEY WHATSAPP_APP_SECRET CREDENTIALS_ENCRYPTION_KEY
)

# 0 when KEY has a non-empty value in FILE.
staging_setting_present() {
  awk -F= -v key="$2" '$1 == key && length(substr($0, index($0, "=") + 1)) > 0 { found=1 } END { exit !found }' "$1"
}

# Prints the names of required settings that are missing or empty, one per line.
staging_missing_settings() {
  local file=$1 key
  for key in "${STAGING_REQUIRED_SETTINGS[@]}"; do
    staging_setting_present "$file" "$key" || printf '%s\n' "$key"
  done
}

# 0 when CREDENTIALS_ENCRYPTION_KEY is base64 that decodes to exactly 32 bytes. Prints nothing; the value is never echoed.
staging_encryption_key_valid() {
  local value bytes
  value=$(grep -E '^CREDENTIALS_ENCRYPTION_KEY=' "$1" 2>/dev/null | tail -n1 | cut -d= -f2- | tr -d '\r\n"'"'")
  [ -n "$value" ] || return 1
  bytes=$(printf '%s' "$value" | (base64 -d 2>/dev/null || base64 -D 2>/dev/null) | wc -c | tr -d ' ')
  [ "$bytes" = "32" ]
}
