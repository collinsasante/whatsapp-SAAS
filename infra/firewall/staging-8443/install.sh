#!/usr/bin/env bash
# Installs (or upgrades) the staging 8443 gate from this directory. Idempotent. Never starts, stops or restarts anything unless --enable is given.
#   install.sh [--check] [--seed] [--enable]
#     --check   change nothing; report which installed files differ from this directory (exit 1 if any differ)
#     --seed    run one `refresh` to create the first validated snapshot (needs the Cloudflare feed to be reachable)
#     --enable  enable + start the boot unit and the two timers
# Files are replaced ATOMICALLY (written beside the target, then renamed), so a running verify never executes a half-written script.
set -eu
D=$(cd "$(dirname "$0")" && pwd)
BIN="staging-8443-fw staging-8443-alert staging-8443-fw-rollback staging-8443-fw-watchdog"
UNITS="staging-8443-fw.service staging-8443-fw-verify.service staging-8443-fw-verify.timer staging-8443-fw-refresh.service staging-8443-fw-refresh.timer staging-8443-alert@.service"
if [ "${1:-}" = --check ]; then rc=0
  for f in $BIN; do cmp -s "$D/$f" /usr/local/sbin/$f && echo "same   /usr/local/sbin/$f" || { echo "DIFFER /usr/local/sbin/$f"; rc=1; }; done
  for u in $UNITS; do cmp -s "$D/$u" /etc/systemd/system/$u && echo "same   /etc/systemd/system/$u" || { echo "DIFFER /etc/systemd/system/$u"; rc=1; }; done
  cmp -s "$D/logrotate-staging-8443" /etc/logrotate.d/staging-8443 && echo "same   /etc/logrotate.d/staging-8443" || { echo "DIFFER /etc/logrotate.d/staging-8443"; rc=1; }
  exit $rc
fi
put() { # put <src> <dst> <mode>
  if cmp -s "$1" "$2" 2>/dev/null; then echo "unchanged $2"; else install -m "$3" "$1" "$2.new.$$" && mv -f "$2.new.$$" "$2" && echo "installed $2"; fi; }
install -d -m 755 /etc/staging-8443 /usr/share/doc/staging-8443; install -d -m 700 /var/lib/staging-8443
for f in $BIN; do put "$D/$f" /usr/local/sbin/$f 755; done
for u in $UNITS; do put "$D/$u" /etc/systemd/system/$u 644; done
put "$D/logrotate-staging-8443" /etc/logrotate.d/staging-8443 644
[ -f /etc/staging-8443/policy.conf ] || install -m 644 "$D/policy.conf" /etc/staging-8443/policy.conf          # an existing policy is NEVER overwritten
[ -f /etc/staging-8443/admin.txt ] || install -m 640 /dev/null /etc/staging-8443/admin.txt
echo "Staging 8443 gate: see /usr/local/sbin/staging-8443-fw --help; policy /etc/staging-8443/policy.conf; rollback: /usr/local/sbin/staging-8443-fw-rollback" > /usr/share/doc/staging-8443/README
systemctl daemon-reload                                                                                           # reads unit files only; restarts nothing
for a in "$@"; do [ "$a" = --seed ] && /usr/local/sbin/staging-8443-fw refresh; done
for a in "$@"; do [ "$a" = --enable ] && systemctl enable --now staging-8443-fw.service staging-8443-fw-verify.timer staging-8443-fw-refresh.timer; done
echo "installed; unit enabled: $(systemctl is-enabled staging-8443-fw.service 2>&1 | head -1)"
