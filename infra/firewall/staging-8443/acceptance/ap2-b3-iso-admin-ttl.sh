#!/bin/bash
# B3-iso: admin-exception TTL lifecycle (add, use, expire, prune) with the REAL script in a scratch namespace using a SCRATCH admin file.
# The real /etc/staging-8443/admin.txt is never opened for writing. Packet-level proof (no old layer in the namespace).
export EV=$1; . $EV/lib.sh; . $EV/ap2-lib.sh; . $EV/ap2-topo.sh; trap topo_down EXIT
A=$EV/B3-iso; mkdir -p $A; EVT=$A/events.txt; PROBE=$A/probe.log; : > $EVT; : > $PROBE; now() { date +%s.%N | cut -c1-14; }
invariants || { echo "ABORT: invariants failed before B3-iso"; exit 2; }
ISO=/root/stg-iso-ap2-$(date -u +%H%M%S); iso_setup $ISO; echo $ISO > $A/iso-dir.txt
H0=$(sha256sum < /etc/staging-8443/admin.txt); S0=$($F status | md5sum)
topo_up || exit 2; iso boot >/dev/null 2>&1
( while :; do iso verify >/dev/null 2>&1; sleep 5; done ) & VPID=$!      # emulates the 5-second timer
ip netns exec isoc python3 $EV/prober_iso.py $PROBE 56 & PPID_=$!
sleep 8
echo "$(now) B3 add" >> $EVT;  iso admin add 10.88.1.2 --ttl 20s;  iso admin add fd00:88:1::2 --ttl 20s
sleep 10; echo "$(now) B3 mid-lifetime" >> $EVT
sleep 24; echo "$(now) B3 after-expiry" >> $EVT
sleep 8; kill $VPID 2>/dev/null; wait $PPID_
win() { awk -v t=$1 -v a=$2 -v b=$3 -v v=$4 '$2==t && $1>=a && $1<=b && $3==v' $PROBE | wc -l; }
T_ADD=$(awk '$2=="B3"&&$3=="add"{print $1}' $EVT); T_MID=$(awk '$2=="B3"&&$3=="mid-lifetime"{print $1}' $EVT); T_EXP=$(awk '$2=="B3"&&$3=="after-expiry"{print $1}' $EVT)
PASS=0; FAIL=0
chk "before the add: both test sources closed"        bash -c "[ $(win U4 0 $T_ADD 1) = 0 ] && [ $(win U6 0 $T_ADD 1) = 0 ]"
chk "mid-lifetime (add+4..+10 s): both test sources open" bash -c "[ $(win U4 $(echo "$T_ADD+4"|bc) $T_MID 0) -le 1 ] && [ $(win U4 $(echo "$T_ADD+4"|bc) $T_MID 1) -gt 10 ] && [ $(win U6 $(echo "$T_ADD+4"|bc) $T_MID 1) -gt 10 ]"
chk "after expiry (+26 s): both closed again"         bash -c "[ $(win U4 $(echo "$T_ADD+26"|bc) 9999999999 1) = 0 ] && [ $(win U6 $(echo "$T_ADD+26"|bc) 9999999999 1) = 0 ]"
chk "scratch admin FILE was pruned by verify (no live entries left)" bash -c "[ \"\$(grep -Evc '^\\s*(#|\$)' $ISO/admin.txt)\" = 0 ]"
chk "REAL admin file byte-identical"                    bash -c "[ \"\$(sha256sum < /etc/staging-8443/admin.txt)\" = \"$H0\" ]"
chk "REAL status unchanged"                             bash -c "[ \"\$($F status | md5sum)\" = \"$S0\" ]"
chk "REAL admin line intact"                            admin_intact
B3P=$PASS; B3F=$FAIL; invariants; echo "B3-iso: $B3P pass, $B3F fail"; echo "scratch dir kept: $ISO"; [ $B3F = 0 ]
