#!/usr/bin/env bash
# Sets one KEY in infra/.env.staging. The value comes from the VALUE environment variable or a hidden prompt, never from
# the command line, so it does not appear in the process list. Prints the key and the length, never the value.
#   VALUE=$(openssl rand -hex 32) bash staging-env-set.sh JWT_SECRET
#   bash staging-env-set.sh FACEBOOK_APP_SECRET        (asks for the value, hidden)
set -u
KEY=${1:-}
[[ "$KEY" =~ ^[A-Z][A-Z0-9_]*$ ]] || { echo "usage: staging-env-set.sh KEY   (value from \$VALUE or a hidden prompt)"; exit 1; }
FILE=${STAGING_ENV_FILE:-/root/whatsapp-platform/infra/.env.staging}
[ -f "$FILE" ] || { echo "ABORT: $FILE does not exist"; exit 1; }
if [ -z "${VALUE:-}" ]; then read -r -s -p "Value for $KEY: " VALUE; echo; fi
[ -n "$VALUE" ] || { echo "ABORT: empty value, nothing changed"; exit 1; }
KEY="$KEY" VALUE="$VALUE" FILE="$FILE" python3 - <<'PY'
import os, re
k, v, p = os.environ["KEY"], os.environ["VALUE"], os.environ["FILE"]
s = open(p).read()
line = f"{k}={v}"
pat = re.compile(rf"^{re.escape(k)}=.*$", re.M)
s = pat.sub(lambda m: line, s) if pat.search(s) else s.rstrip("\n") + "\n" + line + "\n"
open(p, "w").write(s)
print(f"set {k} in {p} (length {len(v)})")
PY
