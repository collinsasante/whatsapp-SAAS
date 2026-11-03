#!/bin/bash
# B4: two live fault injections on the REAL gate while the OLD layer stays active. Self-aborting.
#   (i)  nft delete table inet staging8443   -> expect: unauthorised NEVER open (old layer drops), Cloudflare-range NEVER blocked (old layer accepts)
#   (ii) nft flush chain inet staging8443 stg_gate -> expect: unauthorised NEVER open, Cloudflare-range blocked <= ~8 s (base-chain drop), counters prove it
# ABORT RULES (automatic): any unauthorised probe open  -> killswitch immediately;  no repair within 15 s -> killswitch;  invariants fail first -> do not start.
export EV=$1; . $EV/lib.sh; . $EV/ap2-lib.sh; trap 'ns_down; kill $PP 2>/dev/null' EXIT
A=$EV/B4; mkdir -p $A; EVT=$A/events.txt; PROBE=$A/probe.log; : > $EVT; : > $PROBE; now() { date +%s.%N | cut -c1-14; }
invariants || { echo "ABORT: invariants failed before B4"; exit 2; }
old_layer_ok || { echo "ABORT: old layer not intact; B4 relies on it"; exit 2; }
ns_up || exit 2; snap B4-before 2>/dev/null; ABORT=0; WATCHDOG=0; MAXF=0; MAXI=0
ip netns exec stgacc python3 $EV/prober_live.py $PROBE 75 & PP=$!
unauth_open() { awk '($2=="U4"||$2=="U6")&&$3==1' $PROBE | wc -l; }
gate_ok() { nft list chain inet staging8443 stg_gate 2>/dev/null | grep -q accept; }
wait_repair() { name=$1; max=$2; t0=$(date +%s.%N)
  while :; do gate_ok && break
    read -r g f i < <(gc 2>/dev/null); [ "${f:-0}" -gt "$MAXF" ] 2>/dev/null && MAXF=$f; [ "${i:-0}" -gt "$MAXI" ] 2>/dev/null && MAXI=$i
    [ "$(unauth_open)" -gt 0 ] && { killswitch "UNAUTHORISED PROBE OPEN during $name"; ABORT=1; break; }
    [ "$(echo "$(date +%s.%N) - $t0 > $max" | bc)" = 1 ] && { killswitch "no repair within ${max}s ($name)"; WATCHDOG=1; break; }
    sleep 0.1; done
  echo "$(now) $name repaired" >> $EVT; }
sleep 8                                                    # baseline: U closed, CF open, P open
echo "baseline probes: unauth open=$(unauth_open)"; [ "$(unauth_open)" = 0 ] || { echo "ABORT: baseline exposure"; exit 2; }
# ---- (i) table deleted
echo "$(now) D1-table-deleted inject" >> $EVT; nft delete table inet staging8443; wait_repair D1-table-deleted 15
sleep 10; chk "after (i): signature restored" sig_ok
[ $ABORT = 0 ] && [ $WATCHDOG = 0 ] || { echo "STOPPING after (i): ABORT=$ABORT WATCHDOG=$WATCHDOG"; sleep 1; }
# ---- (ii) gate chain flushed (only if (i) was clean)
if [ $ABORT = 0 ] && [ $WATCHDOG = 0 ]; then
  MAXF=0; MAXI=0
  echo "$(now) D2-gate-flushed inject" >> $EVT; nft flush chain inet staging8443 stg_gate; wait_repair D2-gate-flushed 15
  echo "base-chain drop counters seen during (ii): fwd=$MAXF input=$MAXI"; echo "$MAXF $MAXI" > $A/basechain-max.txt
  sleep 10; chk "after (ii): signature restored" sig_ok
fi
wait $PP; snap B4-after 2>/dev/null
python3 $EV/analyze.py $EVT $PROBE | tee $A/analysis.txt
v() { grep "^$1=" $A/analysis.txt | cut -d= -f2; }
t_of() { awk -v k="$1" '$0 ~ k {print $1}' $EVT; }
cfc() { awk -v a=$1 -v b=$2 '($2=="CF4"||$2=="CF6")&&$1>=a&&$1<=b&&$3==0' $PROBE | wc -l; }
D1A=$(t_of "D1-table-deleted inject"); D1B=$(t_of "D1-table-deleted repaired"); D2A=$(t_of "D2-gate-flushed inject"); D2B=$(t_of "D2-gate-flushed repaired")
chk "no abort and no watchdog" [ $ABORT = 0 -a $WATCHDOG = 0 ]
chk "UNAUTHORISED sources never open in either case (the old layer covered the gap)" [ "$(v UNAUTH_EXPOSED_PROBES)" = 0 ]
chk "ports 80/443 never closed" [ "$(v PROD_PORT_CLOSED_PROBES)" = 0 ]
chk "(i) Cloudflare-range sources never blocked while the table was absent" [ "$(cfc $D1A $D1B)" = 0 ]
chk "(ii) Cloudflare-range sources blocked for <= 8 s (base-chain drop)" bash -c "awk 'BEGIN{exit !($(v CF_BLOCKED_MAX_S) <= 8.0)}'"
chk "(ii) base-chain drop counters rose during the gap (fail-closed proven on the real table)" bash -c "[ \$(( $(cut -d' ' -f1 $A/basechain-max.txt 2>/dev/null || echo 0) + $(cut -d' ' -f2 $A/basechain-max.txt 2>/dev/null || echo 0) )) -gt 0 ]"
chk "no Cloudflare block outside the two windows" [ "$(v CF_BLOCKED_OUTSIDE_WINDOWS)" = 0 ]
chk "both repairs <= 8 s" bash -c "grep '^repair_time' $A/analysis.txt | awk '{gsub(\"s\",\"\",\$3); if (\$3+0>8.0) bad=1} END{exit bad}'"
B4P=$PASS; B4F=$FAIL; invariants; echo "B4: $B4P pass, $B4F fail"; [ $B4F = 0 ]
