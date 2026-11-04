#!/bin/bash
# B3-live (OPTIONAL): live-table admin set membership, expiry and pruning with RESERVED TEST ADDRESSES ONLY.
# Packet-level behaviour is NOT tested here: a source accepted by the new table is still dropped by the old layer unless the old layer also lists it.
# Guardrails: address allow-list, real-line byte check after every write, automatic restore from the root-only pre-copy.
export EV=$1; . $EV/lib.sh; . $EV/ap2-lib.sh
A=$EV/B3-live; mkdir -p $A; EVT=$A/events.txt; PROBE=$A/probe.log; : > $EVT; : > $PROBE; now() { date +%s.%N | cut -c1-14; }; trap 'ns_down; kill $PP 2>/dev/null' EXIT
T4=192.0.2.77; T6=fd00:8443:99::77
guard() { case "$1" in 192.0.2.*|fd00:8443:99::*) ;; *) echo "REFUSED: $1 is not a reserved test address"; exit 3;; esac; }
guard $T4; guard $T6
REAL_IP=$(awk '{print $1}' $ADMIN_BK/real.line); [ "$T4" != "$REAL_IP" ] && [ "$T6" != "$REAL_IP" ] || { echo "REFUSED: test address equals the real admin address"; exit 3; }
invariants || { echo "ABORT: invariants failed before B3-live"; exit 2; }
restore_real() { cp -p $ADMIN_BK/admin.txt.pre /etc/staging-8443/admin.txt.restore && mv /etc/staging-8443/admin.txt.restore /etc/staging-8443/admin.txt; killswitch "real admin line changed, restored from pre-copy"; }
snap B3L-before 2>/dev/null
ns_up || exit 2; ip netns exec stgacc python3 $EV/prober_live.py $PROBE 125 & PP=$!; sleep 6
echo "$(now) B3 inject" >> $EVT
$F admin add $T4 --ttl 60s;   admin_intact || { restore_real; exit 4; }
$F admin add $T6 --ttl 60s;   admin_intact || { restore_real; exit 4; }
PASS=0; FAIL=0
chk "test IPv4 present in set admin4"  nft get element inet staging8443 admin4 "{ $T4 }"
chk "test IPv6 present in set admin6"  nft get element inet staging8443 admin6 "{ $T6 }"
chk "status lists exactly 3 exceptions (real + 2 tests)" bash -c '[ "$('$F' status | python3 -c "import sys,json;print(len(json.load(sys.stdin)[\"admin_exceptions\"]))")" = 3 ]'
sleep 66
chk "test IPv4 expired from the set (kernel timeout)" bash -c "! nft get element inet staging8443 admin4 '{ $T4 }'"
chk "test IPv6 expired from the set"                  bash -c "! nft get element inet staging8443 admin6 '{ $T6 }'"
sleep 8
chk "verify pruned the file: only the real exception remains" bash -c '[ "$('$F' status | python3 -c "import sys,json;print(len(json.load(sys.stdin)[\"admin_exceptions\"]))")" = 1 ]'
chk "admin file byte-identical to the pre-AP-2 copy"  admin_file_identical
chk "real expiry unchanged" admin_exp_ok;  chk "real admin line intact" admin_intact
snap B3L-after 2>/dev/null
echo "$(now) B3 repaired" >> $EVT; wait $PP; python3 $EV/analyze.py $EVT $PROBE | tee $A/analysis.txt
v() { grep "^$1=" $A/analysis.txt | cut -d= -f2; }
chk "traffic: unauthorised IPv4 and IPv6 never open during every admin-set change" [ "$(v UNAUTH_EXPOSED_PROBES)" = 0 ]
chk "traffic: Cloudflare-range IPv4 and IPv6 never blocked (reloads are atomic)" bash -c "awk 'BEGIN{exit !($(v CF_BLOCKED_MAX_S) <= 0.5)}'"
chk "traffic: ports 80/443 never closed" [ "$(v PROD_PORT_CLOSED_PROBES)" = 0 ]
B3P=$PASS; B3F=$FAIL; invariants; echo "B3-live: $B3P pass, $B3F fail"; [ $B3F = 0 ]
