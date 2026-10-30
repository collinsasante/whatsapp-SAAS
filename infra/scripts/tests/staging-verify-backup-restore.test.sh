#!/usr/bin/env bash
# Tests staging-verify-backup-restore.sh against a fake docker that models the postgres image's start-up: a temporary server that
# listens only on the Unix socket and then goes away, a gap, and only then the real server on TCP. Run: bash infra/scripts/tests/staging-verify-backup-restore.test.sh
# SCRIPT=/path/to/another/copy runs the same cases against that copy (used to show the cases fail on the pre-fix script).
set -u
HERE=$(cd "$(dirname "$0")/.." && pwd)
SCRIPT=${SCRIPT:-$HERE/staging-verify-backup-restore.sh}
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin"
echo dump > "$T/backup.dump"

# State: the number of pg_isready polls so far ($T/polls).
#   poll 1      temporary server: the socket answers, TCP does not
#   poll 2      restart gap: nothing answers
#   poll >= 3   real server: socket and TCP both answer
# A restore needs a server that is still there: over the socket only once the real server is up, over TCP likewise. A restore that
# follows a socket-only "ready" on poll 1 therefore finds nothing listening, exactly as on the staging host.
cat > "$T/bin/docker" <<'SHIM'
#!/usr/bin/env bash
all="$*"
polls() { cat "$FAKE_STATE/polls" 2>/dev/null || echo 0; }
case "$1" in
  image) [ -z "${FAKE_NO_IMAGE:-}" ];;
  run) echo 0 > "$FAKE_STATE/polls"; echo fake-container-id;;
  container|cp|rm) exit 0;;
  exec)
    case "$all" in
      *pg_isready*)
        n=$(( $(polls) + 1 )); echo "$n" > "$FAKE_STATE/polls"
        [ -n "${FAKE_NEVER_READY:-}" ] && exit 2
        case "$all" in
          *"-h 127.0.0.1"*) [ "$n" -ge 3 ];;
          *) [ "$n" -eq 1 ] || [ "$n" -ge 3 ];;
        esac;;
      *"pg_restore --list"*) exit 0;;
      *pg_restore*)
        [ -n "${FAKE_RESTORE_FAILS:-}" ] && { echo "pg_restore: error: relation already exists" >&2; exit 1; }
        n=$(polls)
        if [ "$n" -lt 3 ]; then
          echo 'pg_restore: error: connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed: No such file or directory' >&2
          exit 1
        fi
        exit 0;;
      *) exit 0;;
    esac;;
  *) exit 0;;
esac
SHIM
printf '#!/usr/bin/env bash\nexit 0\n' > "$T/bin/sleep"
chmod +x "$T/bin/"*

PASS=0; FAIL=0
run() { FAKE_STATE="$T" PATH="$T/bin:$PATH" bash "$SCRIPT" "$T/backup.dump" 2>&1; echo "exit=$?"; }
expect() { if printf '%s' "$3" | grep -qE -- "$2"; then PASS=$((PASS+1)); echo "ok    $1"; else FAIL=$((FAIL+1)); echo "FAIL  $1"; fi; }
expect_not() { if printf '%s' "$3" | grep -qE -- "$2"; then FAIL=$((FAIL+1)); echo "FAIL  $1"; else PASS=$((PASS+1)); echo "ok    $1"; fi; }

out=$(run)
expect "passes when the real server appears after the temporary one has gone (the staging race)" "PASS: PostgreSQL dump restored" "$out"
expect "...and exits 0" "exit=0" "$out"
expect_not "...without the socket error that failed the staging rehearsals" "No such file or directory" "$out"

out=$(FAKE_RESTORE_FAILS=1 run)
expect "a real restore error still fails the rehearsal" "exit=1" "$out"
expect_not "...and is not reported as a pass" "PASS: PostgreSQL" "$out"

out=$(FAKE_NEVER_READY=1 run)
expect "a server that never becomes ready aborts with a clear message" "ABORT: isolated PostgreSQL did not become ready" "$out"
expect "...and exits non-zero" "exit=1" "$out"

out=$(FAKE_NO_IMAGE=1 run)
expect "a missing postgres image aborts before starting anything" "ABORT: postgres:16-alpine must be available locally" "$out"

# The properties the fix relies on, so a later edit cannot quietly undo them.
expect "readiness is checked over TCP" "pg_isready -h 127\.0\.0\.1" "$(cat "$SCRIPT")"
expect "the restore connects over TCP" "pg_restore -h 127\.0\.0\.1" "$(cat "$SCRIPT")"
expect "the rehearsal container stays network-disabled" "--network none" "$(cat "$SCRIPT")"
expect "the restore still stops on the first error" "--exit-on-error --no-owner --no-acl" "$(cat "$SCRIPT")"

echo; echo "$PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
