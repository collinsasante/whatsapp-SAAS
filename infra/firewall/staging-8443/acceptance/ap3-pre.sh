#!/bin/bash
# AP-3 PRE-MAINTENANCE gate and state capture. Read-only (writes only evidence). Run it immediately before the window; any FAIL = NO-GO.
#   usage: ap3-pre.sh <EV>     env: PKG=<dir with install.sh> (optional: also checks installed files == package)
export EV=$1; . $EV/lib.sh; . $EV/ap2-lib.sh; . $EV/extra.sh; mkdir -p $EV/AP3-PRE; P=$EV/AP3-PRE
echo "== invariants (firewall, old layer, containers, UFW, fail2ban, production health)"; invariants > $P/invariants.txt; INV=$?; tail -1 $P/invariants.txt; PASS=0; FAIL=0
recovery_ok() { r=$($F status | python3 -c 'import sys,json;print(json.load(sys.stdin).get("recovery_snapshot") or "")'); [ -n "$r" ] && python3 - "$r" <<'PY'
import json,hashlib,sys; d="/var/lib/staging-8443/snapshots/"+sys.argv[1]; m=json.load(open(d+"/meta.json"))
assert hashlib.sha256(open(d+"/v4.txt","rb").read()).hexdigest()==m["v4_sha256"] and hashlib.sha256(open(d+"/v6.txt","rb").read()).hexdigest()==m["v6_sha256"]
PY
}
fresh_prod_dump() { f=$(find /root/backups/postgres -name 'waplatform_*.sql.gz' -mmin -120 | head -1); [ -n "$f" ] && gzip -t "$f"; }
staging_dump() { f=$(find /root/staging-release-backups /root/backups -name '*.dump' -mmin -1440 | head -1); [ -n "$f" ] && docker exec -i wa_staging_postgres pg_restore -l < "$f" | grep -q 'TABLE DATA'; }
no_cron_clash() { h=$(TZ=Europe/Berlin date +%H); m=$(TZ=Europe/Berlin date +%M); mm=$((10#$m)); hh=$((10#$h))
  [ "$hh" -ne 2 ] && [ "$hh" -ne 3 ] && [ $((mm % 5)) -ne 4 ] && [ $((mm % 5)) -ne 0 ]; }   # not in the backup (02:xx), certbot (03:xx) hours, nor within a minute of the */5 health-check tick
certbot_far() { n=$(date -d "$(systemctl show certbot.timer -p NextElapseUSecRealtime --value)" +%s 2>/dev/null) || return 0; [ $((n - $(date +%s))) -gt 1800 ]; }
refresh_far() { n=$(date -d "$(systemctl show staging-8443-fw-refresh.timer -p NextElapseUSecRealtime --value)" +%s); [ $((n - $(date +%s))) -gt 86400 ]; }
units_match() { [ -z "$PKG" ] || (cd "$PKG" && ./install.sh --check >/dev/null); }
verify_clean() { [ -z "$(systemd-analyze verify /etc/systemd/system/staging-8443-fw.service /etc/systemd/system/staging-8443-fw-verify.service /etc/systemd/system/staging-8443-fw-refresh.service /etc/systemd/system/staging-8443-alert@.service /etc/systemd/system/staging-8443-firewall.service 2>&1)" ]; }
chk "firewall/system invariants all hold" [ $INV = 0 ]
chk "a validated RECOVERY snapshot exists (staging-8443-fw snapshot)" recovery_ok
chk "a FRESH production database dump (< 2 h) exists and is a valid gzip; take one with backup.sh right before the window" fresh_prod_dump
chk "a staging database dump (< 24 h) exists and lists table data" staging_dump
chk "not inside the 02:xx backup / 03:xx certbot hours (Europe/Berlin) nor on a */5 health-check tick" no_cron_clash
chk "certbot.timer not within 30 min" certbot_far;  chk "weekly firewall refresh is > 24 h away" refresh_far
chk "nftables.service not enabled (its flush ruleset would delete every table)" bash -c '! systemctl is-enabled nftables.service 2>/dev/null | grep -q enabled'
chk "rollback marker absent" bash -c '[ ! -e /var/lib/staging-8443/disabled ]'
chk "systemd-analyze verify clean for the firewall units" verify_clean
chk "installed files identical to the deployed package (if PKG set)" units_match
chk "docker.service is ordered After the gate and has no Requires on it" bash -c 'systemctl show docker.service -p After --value | grep -q staging-8443-fw.service && ! systemctl show docker.service -p Requires -p BindsTo --value | grep -q staging-8443-fw'
chk "disk free >= 10 GB" bash -c '[ "$(df --output=avail -BG / | tail -1 | tr -dc 0-9)" -ge 10 ]'
cat /proc/sys/kernel/random/boot_id > $P/boot-id; date -u +%FT%TZ > $P/captured-at; uptime -s > $P/last-boot
{ echo "docker ActiveEnter(mono): $(systemctl show docker.service -p ActiveEnterTimestampMonotonic --value)"; echo "docker InactiveExit(mono): $(systemctl show docker.service -p InactiveExitTimestampMonotonic --value)"; echo "gate ExecMainExit(mono): $(systemctl show staging-8443-fw.service -p ExecMainExitTimestampMonotonic --value)"; } > $P/timeline.txt
for c in $(docker ps --format '{{.Names}}' | sort); do echo "$c $(docker inspect -f '{{.State.StartedAt}} restarts={{.RestartCount}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' $c)"; done > $P/containers.txt
{ for p in 22 80 443 8080 8443; do echo ":$p $(ss -ltnH "( sport = :$p )" | awk '{print $4}' | sort | tr '\n' ' ')"; done; } > $P/listeners.txt
snap AP3-pre 2>/dev/null; extra AP3-pre-extra 2>/dev/null; mv $EV/AP3-pre $P/snap 2>/dev/null; mv $EV/AP3-pre-extra $P/extra 2>/dev/null
echo "gate counters (gate fwd input): $(gc)" | tee $P/gate-counters.txt
echo "MANUAL gates (cannot be checked from the server): Contabo Customer Panel login confirmed (Reboot + Rescue System reachable); a named person on call; window announced."
echo "AP3-PRE: $PASS pass, $FAIL fail => $([ $FAIL = 0 ] && echo GO || echo NO-GO)" | tee $P/GO-NOGO.txt; [ $FAIL = 0 ]
