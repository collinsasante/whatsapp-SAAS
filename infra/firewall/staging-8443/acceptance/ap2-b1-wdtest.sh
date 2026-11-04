#!/bin/bash
# Tests the watchdog in an ISOLATED namespace (stgwd) using the REAL pre-B1 listing. The host table is only READ (nft list).
export EV=$1; . $EV/lib.sh; . $EV/ap2-lib.sh; PASS=0; FAIL=0
T=$EV/WDTEST; mkdir -p $T; NS=stgwd; trap 'ip netns del $NS 2>/dev/null' EXIT; ip netns add $NS; ip -n $NS link set lo up
nft list table inet staging8443 > $T/pre.nft; { echo "add table inet staging8443"; echo "delete table inet staging8443"; cat $T/pre.nft; } > $T/rollback.nft
nft -c -f $T/rollback.nft && echo "dry-run of rollback.nft on the host: OK (check only, nothing loaded)"
norm() { sed -E 's/packets [0-9]+ bytes [0-9]+//; s/ expires [0-9a-z]+//; s/ timeout [0-9dhms]+//g'; }
ns() { ip netns exec $NS "$@"; }
load() { ns nft -f $T/rollback.nft; }
same() { diff <(norm < $T/pre.nft) <(ns nft list table inet staging8443 | norm) >/dev/null; }
run_wd() { n=$1; dl=$2; shift 2; d=$T/$n; mkdir -p $d; cp $T/pre.nft $T/rollback.nft $d/; for f in "$@"; do touch $d/$f; done
  systemd-run --unit=stg-ap2-wd-$n --collect -p Nice=5 bash ${WATCHDOG:-$EV/ap2-b1-watchdog.sh} $d $dl $NS >/dev/null 2>&1
  for i in $(seq 1 40); do [ -e $d/result ] && break; sleep 1; done; echo "  result: $(cat $d/result 2>/dev/null || echo none); log: $(tail -2 $d/watchdog.log | cut -c1-110 | tr '\n' '|')"; }
load; chk "isolated copy of the live table equals the live listing" same
echo "== T1: gate chain flushed, no signal -> deadline rollback (6 s)"; ns nft flush chain inet staging8443 stg_gate; chk "corruption applied (gate has no accept rule)" bash -c "! ip netns exec $NS nft list chain inet staging8443 stg_gate | grep -q accept"
run_wd t1 6; chk "T1 rolled back by the deadline and verified equal" bash -c "[ \"\$(cat $T/t1/result)\" = ROLLED_BACK_OK ]"; chk "T1 state equals the pre listing" same
echo "== T2: whole table deleted, immediate FAIL signal"; ns nft delete table inet staging8443; run_wd t2 300 fail
chk "T2 rolled back immediately on the fail signal" bash -c "[ \"\$(cat $T/t2/result)\" = ROLLED_BACK_OK ]"; chk "T2 state equals the pre listing (table recreated)" same
echo "== T3: gate flushed, CONFIRM present -> watchdog must cancel WITHOUT touching anything"; ns nft flush chain inet staging8443 stg_gate; run_wd t3 300 confirm
chk "T3 cancelled" bash -c "[ \"\$(cat $T/t3/result)\" = CANCELLED ]"; chk "T3 did NOT roll back (state still corrupted, as intended)" bash -c "! ip netns exec $NS nft list chain inet staging8443 stg_gate | grep -q accept"; load
echo "== T4: independence: watchdog unit is outside any SSH session scope and uses no network/gate"
systemd-run --unit=stg-ap2-wd-t4 --collect bash -c 'sleep 4' >/dev/null 2>&1; cg=$(systemctl show stg-ap2-wd-t4 -p ControlGroup --value)
chk "unit lives in system.slice, not in a session-*.scope ($cg)" bash -c "echo '$cg' | grep -q '^/system.slice/' && ! echo '$cg' | grep -q 'session-'"
chk "watchdog script contains no ssh/curl/docker/ufw/iptables calls" bash -c "! grep -v '^#' ${WATCHDOG:-$EV/ap2-b1-watchdog.sh} | grep -qE '\b(ssh|scp|curl|wget|docker|ufw|iptables|systemctl)\b'"
chk "HOST table untouched by the test (live signature unchanged)" sig_ok
echo "WDTEST: $PASS pass, $FAIL fail"; [ $FAIL = 0 ]
