#!/bin/bash
# AP-2 PREFLIGHT. Changes nothing on the firewall. Writes only: evidence files, and a root-only COPY of admin.txt outside the evidence dir.
export EV=$1; . $EV/lib.sh; . $EV/ap2-lib.sh; PASS=0; FAIL=0; mkdir -p $EV/P0; umask 077
no_units() { [ "$(systemctl list-units --no-legend 'staging-8443-soak*' 'stg-acc-*' 'stg-ap2-*' | grep -v 'stg-ap2-pre' | wc -l)" = 0 ]; }   # excludes this script's own transient unit
no_procs() { [ "$(ps -eo args | grep -E 'http\.server|prober_|soak_monitor|a7\.sh|ap2-' | grep -v -E 'grep|ap2-00-preflight' | wc -l)" = 0 ]; }
marker_absent() { [ ! -e /var/lib/staging-8443/disabled ]; }
nftables_svc_off() { ! systemctl is-enabled nftables.service 2>/dev/null | grep -q enabled; }
refresh_far() { n=$(date -d "$(systemctl show staging-8443-fw-refresh.timer -p NextElapseUSecRealtime --value)" +%s); [ $((n - $(date +%s))) -gt 86400 ]; }
admin_far() { e=$(date -u -d "$EXPECT_ADMIN_EXP" +%s); [ $((e - $(date +%s))) -gt 86400 ]; }
verify_alive() { [ "$(journalctl -u staging-8443-fw-verify.service --since '-30s' --no-pager -o cat | grep -c Starting)" -ge 3 ]; }
disk_ok() { [ "$(df --output=avail -BG / | tail -1 | tr -dc 0-9)" -ge 10 ]; }
load_ok() { awk '{exit !($1<2)}' /proc/loadavg; }
one_admin() { [ "$(grep -Evc '^\s*(#|$)' /etc/staging-8443/admin.txt)" = 1 ]; }
chk "no soak/test units running" no_units;            chk "no leftover test processes" no_procs
chk "no leftover namespaces/veth/routes" no_scaffolding;  chk "rollback marker absent" marker_absent
chk "nftables.service not enabled (its 'flush ruleset' would delete every table)" nftables_svc_off
chk "next weekly refresh is more than 24 h away" refresh_far;  chk "admin exception expires more than 24 h from now" admin_far
chk "verify timer fired >=3 times in the last 30 s" verify_alive; chk "disk free >= 10 GB" disk_ok; chk "load < 2" load_ok
chk "admin file holds exactly one entry" one_admin
# Real admin line: a root-only COPY outside the evidence dir. The original is never modified by any AP-2 step.
if [ ! -e $ADMIN_BK/real.line ]; then mkdir -p $ADMIN_BK; chmod 700 $ADMIN_BK
  grep -E '^[0-9a-f.:]+ expires=' /etc/staging-8443/admin.txt | head -1 > $ADMIN_BK/real.line
  cp -p /etc/staging-8443/admin.txt $ADMIN_BK/admin.txt.pre; chmod 600 $ADMIN_BK/*; fi
sha256sum < /etc/staging-8443/admin.txt > $EV/P0/admin-file.sha256            # hash only; no address
chk "admin file identical to the pre-AP-2 copy" admin_file_identical
sig_ok_wrap() { sig_ok; };  chk "signature/mode/snapshot as expected" sig_ok;  chk "admin exception expiry as expected" admin_exp_ok
chk "admin line intact" admin_intact;  chk "old layer intact (21/13, both jumps, final DROP)" old_layer_ok
chk "18 containers, 0 restarts" containers_ok; chk "units active" units_ok;  chk "production health 200" prod_ok
chk "ufw active" bash -c 'ufw status | grep -q "Status: active"'
chk "4 fail2ban jails" bash -c '[ "$(fail2ban-client status | grep -o "nginx-botsearch\|nginx-http-auth\|nginx-limit-req\|sshd" | wc -l)" = 4 ]'
chk "gate references none of 22/80/443/8080" bash -c '! nft list table inet staging8443 | grep -qE "(dport|proto-dst) (22|80|443|8080)\b"'
chk "sshd, 80, 443 and 127.0.0.1:8080 listeners present" bash -c 'for p in 22 80 443; do ss -ltnH "( sport = :$p )" | grep -q . || exit 1; done; ss -ltnH "( sport = :8080 )" | grep -q 127.0.0.1:8080'
# Reference state to compare against: REF_DIR (a snap directory) or, by default, the end of AP-1. After a stage that legitimately moves counters (B4 raises the old layer's DROP counters), point REF_DIR at that stage's final snapshot.
mkdir -p $EV/AP1-AFINAL; cp -a ${REF_DIR:-$AP1/AFINAL}/. $EV/AP1-AFINAL/ 2>/dev/null; snap AP2-baseline 2>/dev/null
cmp_ap1() { for f in other-tables.sha iptables.sha ip6tables.sha docker-user.sha ufw.md5 restarts.txt fw.txt; do diff -q $EV/AP1-AFINAL/$f $EV/AP2-baseline/$f >/dev/null || { echo "differs: $f"; return 1; }; done
  [ "$(tail -1 $EV/AP1-AFINAL/old4.txt)" = "$(tail -1 $EV/AP2-baseline/old4.txt)" ] && [ "$(tail -1 $EV/AP1-AFINAL/old6.txt)" = "$(tail -1 $EV/AP2-baseline/old6.txt)" ]; }
chk "state identical to the reference snapshot (hashes; old-layer DROP counters)" cmp_ap1
echo "gate counters (gate fwd input) at baseline: $(gc)" | tee $EV/P0/gate-counters.txt
echo "PREFLIGHT: $PASS pass, $FAIL fail"; [ $FAIL = 0 ]
