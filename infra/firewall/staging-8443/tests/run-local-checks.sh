#!/usr/bin/env bash
# Checks that need no server: shell syntax, Python compilation, the validator unit tests, the policy file sanity, and (on Linux with coreutils `timeout`) the B2 watchdog self-test.
cd "$(dirname "$0")/.." || exit 1; rc=0; ok() { echo "PASS  $1"; }; bad() { echo "FAIL  $1"; rc=1; }
for f in install.sh staging-8443-fw-watchdog staging-8443-fw-rollback legacy-iptables/staging-8443-firewall legacy-iptables/staging-8443-firewall-rollback acceptance/*.sh tests/*.sh; do bash -n "$f" 2>/dev/null && ok "bash -n $f" || bad "bash -n $f"; done
for f in staging-8443-fw staging-8443-alert acceptance/*.py tests/unit-tests.py; do head -1 "$f" | grep -q python && { python3 -B -c "import sys; compile(open(sys.argv[1]).read(), sys.argv[1], 'exec')" "$f" 2>/dev/null && ok "py_compile $f" || bad "py_compile $f"; }; done
PYTHONDONTWRITEBYTECODE=1 python3 tests/unit-tests.py > /tmp/stg8443-unit.out 2>&1 && ok "validator unit tests ($(grep -c '^PASS' /tmp/stg8443-unit.out) cases)" || { bad "validator unit tests"; tail -5 /tmp/stg8443-unit.out; }
grep -q '^PORT=8443' policy.conf && grep -q '^REQUIRE_GLOBAL=yes' policy.conf && ok "policy.conf defaults (PORT=8443, REQUIRE_GLOBAL=yes)" || bad "policy.conf defaults"
if command -v timeout >/dev/null 2>&1; then bash tests/b2-watchdog-selftest.sh "$PWD/acceptance" >/tmp/stg8443-b2.out 2>&1 && ok "B2 watchdog self-test" || { bad "B2 watchdog self-test"; tail -5 /tmp/stg8443-b2.out; }; else echo "SKIP  B2 watchdog self-test (needs GNU coreutils timeout; run it on Linux)"; fi
! grep -rlE '(^|[^0-9.])154\.160\.[0-9]+\.[0-9]+' . >/dev/null 2>&1 && ok "no admin address in the tree" || bad "admin address found in the tree"
exit $rc
