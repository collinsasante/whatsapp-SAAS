#!/usr/bin/env bash
# Data-free alert through the ntfy topic the existing health check uses (read at run time from that script; not copied here). No-op if it cannot be found.
set -uo pipefail
MSG=${1:?message}; HC=${HEALTHCHECK_SCRIPT:-/usr/local/bin/verzchat-healthcheck.sh}
if [ -n "${NOTIFY_CAPTURE:-}" ]; then echo "$MSG" >> "$NOTIFY_CAPTURE"; exit 0; fi
topic=$(sed -n 's/^NTFY_TOPIC="\(.*\)"$/\1/p' "$HC" 2>/dev/null | head -1)
[ -n "$topic" ] || { echo "notify: no ntfy topic found; alert not sent: $MSG" >&2; exit 0; }
curl -s -m 10 -H "Title: VerzChat backup" -H "Priority: high" -d "$MSG" "https://ntfy.sh/$topic" >/dev/null 2>&1 || echo "notify: ntfy delivery failed" >&2
