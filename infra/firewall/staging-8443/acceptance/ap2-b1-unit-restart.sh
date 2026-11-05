#!/bin/bash
# B1: systemctl restart staging-8443-fw.service. The unit re-runs 'boot' = ONE atomic nft transaction from last-good. Expect: no blocked Cloudflare probe, no exposed unauthorised probe.
export EV=$1; . $EV/lib.sh; . $EV/ap2-lib.sh; trap 'ns_down' EXIT
A=$EV/B1; mkdir -p $A; EVT=$A/events.txt; PROBE=$A/probe.log; : > $EVT; : > $PROBE; now() { date +%s.%N | cut -c1-14; }
invariants || { echo "ABORT: invariants failed before B1"; exit 2; }
ns_up || exit 2; snap B1-before 2>/dev/null; echo "counters before: $(gc)"
ip netns exec stgacc python3 $EV/prober_live.py $PROBE 36 & PP=$!
sleep 8
echo "$(now) B1 inject" >> $EVT; systemctl restart staging-8443-fw.service; RC=$?; echo "$(now) B1 repaired" >> $EVT
sleep 8; snap B1-after 2>/dev/null; wait $PP
echo "counters after: $(gc)   (a reload resets them; that is expected)"
python3 $EV/analyze.py $EVT $PROBE | tee $A/analysis.txt
v() { grep "^$1=" $A/analysis.txt | cut -d= -f2; }
PASS=0; FAIL=0
chk "restart exit code 0" [ $RC = 0 ];  chk "unit active (exited)" bash -c '[ "$(systemctl is-active staging-8443-fw.service)" = active ]'
chk "journal shows 'loaded last-good snapshot ... signature 471c8a8d90cc'" bash -c 'journalctl -u staging-8443-fw.service --since "-90s" --no-pager -o cat | grep -q "loaded last-good snapshot.*signature 471c8a8d90cc"'
chk "no unauthorised probe open" [ "$(v UNAUTH_EXPOSED_PROBES)" = 0 ];  chk "ports 80/443 never closed" [ "$(v PROD_PORT_CLOSED_PROBES)" = 0 ]
chk "no Cloudflare-range probe blocked (the swap is atomic)" bash -c "awk 'BEGIN{exit !($(v CF_BLOCKED_MAX_S) <= 0.5)}'"
chk "state unchanged except counters" bash -c ". $EV/lib.sh; export EV=$EV; cmpsnap B1-before B1-after | grep -v -E 'old4.txt|old6.txt|containers.txt' | grep -c DIFF | grep -qx 0"
B1P=$PASS; B1F=$FAIL; invariants; echo "B1: $B1P pass, $B1F fail (invariants counted separately above)"; [ $B1F = 0 ]
