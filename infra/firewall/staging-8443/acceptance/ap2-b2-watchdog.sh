#!/bin/bash
# B2 cleanup watchdog (run as a TRANSIENT SYSTEMD UNIT). Removes the throwaway Docker bridge ONLY if it carries our ownership label, then re-checks the old iptables layer
# and re-applies it if damaged. Cancel: touch <dir>/confirm.  Immediate cleanup: touch <dir>/fail.  Otherwise acts when the deadline passes.
#   usage: ap2-b2-watchdog.sh <dir> <deadline-seconds>       Test overrides: WD_DOCKER, WD_OLD_FW, WD_OLD_CHECK
D=$1; DL=$2; NAME=stg-acc-probe; WANT=b2; DOCKER=${WD_DOCKER:-docker}; OLDFW=${WD_OLD_FW:-/usr/local/sbin/staging-8443-firewall}
LOG=$D/watchdog.log; log() { echo "$(date -u +%FT%TZ) $*" >> "$LOG"; }
old_ok() {
  if [ -n "$WD_OLD_CHECK" ]; then "$WD_OLD_CHECK"; return $?; fi
  [ "$(iptables -S STG-8443 | wc -l)" = 21 ] && [ "$(ip6tables -S STG-8443-V6 | wc -l)" = 13 ] &&
  iptables -S DOCKER-USER | grep -qF -- '-A DOCKER-USER -p tcp -m conntrack --ctorigdstport 8443 --ctdir ORIGINAL -j STG-8443' &&
  [ "$(ip6tables -S INPUT | sed -n 2p)" = '-A INPUT -p tcp -m tcp --dport 8443 -j STG-8443-V6' ]; }
END=$(( $(date +%s) + DL )); log "armed: deadline ${DL}s"
while :; do
  [ -e "$D/confirm" ] && { log "CONFIRMED: no action taken"; echo CANCELLED > "$D/result"; exit 0; }
  [ -e "$D/fail" ] && { log "FAIL signal: cleaning up now"; break; }
  [ "$(date +%s)" -ge "$END" ] && { log "DEADLINE reached: cleaning up"; break; }
  sleep 1
done
CLEAN=1
# Never mistake "Docker is unreachable" for "the network is absent".
timeout 30 "$DOCKER" info >/dev/null 2>&1 || { log "Docker is NOT reachable: cannot verify or remove the network"; CLEAN=0; }
if [ $CLEAN = 1 ] && timeout 30 "$DOCKER" network inspect "$NAME" >/dev/null 2>&1; then
  owner=$(timeout 30 "$DOCKER" network inspect --format '{{index .Labels "ap2.owner"}}' "$NAME" 2>/dev/null)
  if [ "$owner" = "$WANT" ]; then timeout 60 "$DOCKER" network rm "$NAME" >> "$LOG" 2>&1 && log "removed network $NAME (ours: label ap2.owner=$WANT)" || { log "FAILED to remove $NAME"; CLEAN=0; }
  else log "REFUSING to remove $NAME: it exists but is NOT ours (label '$owner')"; fi
elif [ $CLEAN = 1 ]; then log "network $NAME already absent"; fi
if old_ok; then log "old layer intact"; else
  log "old layer NOT intact: re-applying with $OLDFW apply"; timeout 60 "$OLDFW" apply >> "$LOG" 2>&1; sleep 1
  if old_ok; then log "old layer restored"; else log "old layer STILL not intact"; CLEAN=0; fi
fi
[ $CLEAN = 1 ] && echo CLEAN > "$D/result" || echo NOT_CLEAN > "$D/result"
