#!/bin/bash
# Isolated validation of the REVISED rollback watchdog. Everything happens in namespace stgwd with SCRATCH state, the real staging-8443-fw script,
# a reserved TEST admin address (192.0.2.99, 2 h TTL) and two decoy tables. The live firewall is only READ (host snapshot before/after).
#   usage: ap2-wd2-test.sh <EV> all | sl-arm | sl-check
export EV=$1; MODE=$2; . $EV/lib.sh; . $EV/ap2-lib.sh; PASS=0; FAIL=0
T=$EV/WD2; NS=stgwd; ID=20261103T191201Z-b42a; TESTIP=192.0.2.99; DRIFT_OK=3
ns() { ip netns exec $NS "$@"; }
iso() { ns env STG8443_CONF=$T/policy.conf STG8443_STATE=$T/state STG8443_LOCK=$T/lock STG8443_ADMIN=$T/admin.txt $F "$@"; }
norm() { sed -E 's/packets [0-9]+ bytes [0-9]+//; s/ expires [0-9a-z.]+//; s/ timeout [0-9dhms]+//g'; }
decoys() { for t in "inet decoy1" "ip decoy2"; do ns nft list table $t; done | sed -E 's/packets [0-9]+ bytes [0-9]+//' | sha256sum | cut -c1-16; }
kexp() { ns nft -j list set inet staging8443 admin4 2>/dev/null | python3 -c 'import sys,json,time
d=json.load(sys.stdin); s=[x for x in d["nftables"] if "set" in x][0]["set"]
e=[x["elem"] for x in s.get("elem",[]) if x["elem"]["val"]=="'$TESTIP'"]; print(int(time.time()+e[0]["expires"]) if e else 0)'; }
fexp() { python3 -c 'import datetime,sys
for l in open("'$T'/admin.txt"):
    if l.startswith("'$TESTIP' "): print(int(datetime.datetime.strptime(l.split("=")[1].strip(),"%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc).timestamp()))'; }
gate_ok() { ns nft list chain inet staging8443 stg_gate 2>/dev/null | grep -q accept; }
sig_iso() { iso status 2>/dev/null | python3 -c 'import sys,json;print(json.load(sys.stdin)["live_signature"])'; }
setup() {
  rm -rf $T; mkdir -p $T/state/snapshots; cp -a /var/lib/staging-8443/snapshots/$ID $T/state/snapshots/; ln -sfn snapshots/$ID $T/state/last-good
  sed -E "s#^LOG_FILE=.*#LOG_FILE=$T/alerts.log#; s#^ALERT_CMD=.*#ALERT_CMD=/bin/true#" /etc/staging-8443/policy.conf > $T/policy.conf
  grep -q '^ALERT_CMD' $T/policy.conf || echo 'ALERT_CMD=/bin/true' >> $T/policy.conf; grep -q '^LOG_FILE' $T/policy.conf || echo "LOG_FILE=$T/alerts.log" >> $T/policy.conf
  : > $T/admin.txt; : > $T/alerts.log
  printf '#!/bin/bash\nexec ip netns exec %s env STG8443_CONF=%s STG8443_STATE=%s STG8443_LOCK=%s STG8443_ADMIN=%s %s boot\n' $NS $T/policy.conf $T/state $T/lock $T/admin.txt $F > $T/boot-in-ns.sh; chmod 700 $T/boot-in-ns.sh
  ip netns add $NS; ip -n $NS link set lo up
  ns nft -f - <<'NFT'
table inet decoy1 {
  set s1 {
    type ipv4_addr
    elements = { 198.51.100.7, 198.51.100.8 }
  }
  chain c1 {
    type filter hook input priority 50; policy accept;
    ip saddr @s1 counter accept
  }
}
table ip decoy2 {
  chain c2 {
    type filter hook forward priority 60; policy accept;
    tcp dport 12345 counter drop
  }
}
NFT
  ns nft list table inet decoy1 >/dev/null 2>&1 && ns nft list table ip decoy2 >/dev/null 2>&1 || { echo "ABORT: decoy tables were not created (a vacuous test would follow)"; exit 3; }
  iso boot >/dev/null 2>&1; iso admin add $TESTIP --ttl 2h >/dev/null 2>&1
  ns nft list table inet staging8443 > $T/pre.nft; { echo "add table inet staging8443"; echo "delete table inet staging8443"; cat $T/pre.nft; } > $T/rollback.nft
  ns nft -c -f $T/rollback.nft && echo "  (rollback listing passes nft -c inside the namespace)"
  E0=$(kexp); EF=$(fexp); D0=$(decoys); [ "$D0" != e3b0c44298fc1c14 ] || { echo "ABORT: empty decoy hash"; exit 3; }; S0=$(sig_iso); echo "$E0 $EF $D0 $S0" > $T/baseline.txt
  echo "  baseline: kernel expiry epoch $E0, admin.txt expiry epoch $EF (diff $((E0-EF)) s), decoy hash $D0, signature $S0"
}
run_wd() { n=$1; dl=$2; noboot=$3; shift 3; d=$T/$n; mkdir -p $d; cp $T/pre.nft $T/rollback.nft $d/; for f in "$@"; do touch $d/$f; done
  systemd-run --unit=stg-ap2-wd2-$n --collect -p Nice=5 -p IPAddressDeny=any -p "RestrictAddressFamilies=AF_UNIX AF_NETLINK" --setenv=WD_BOOT_CMD=$T/boot-in-ns.sh ${noboot:+--setenv=WD_NO_BOOT=1} bash ${WATCHDOG:-$EV/ap2-b1-watchdog.sh} $d $dl $NS >/dev/null 2>&1
  for i in $(seq 1 60); do [ -e $d/result ] && break; sleep 1; done; }
verify_restored() { n=$1; read E0 EF D0 S0 < $T/baseline.txt; E1=$(kexp); drift=$((E1-E0)); fdiff=$((E1-EF))
  echo "  [$n] result=$(cat $T/$n/result 2>/dev/null) | gate restored: $(gate_ok && echo yes || echo NO) | signature: $(sig_iso) | kernel expiry drift vs baseline: ${drift} s | vs admin.txt: ${fdiff} s | decoys: $([ "$(decoys)" = $D0 ] && echo unchanged || echo CHANGED)"
  chk "$n: watchdog reported a verified rollback" bash -c "[ \"\$(cat $T/$n/result)\" = ROLLED_BACK_OK ]"
  chk "$n: gate and base chains restored" gate_ok;  chk "$n: signature equals the baseline signature ($S0)" bash -c "[ \"$(sig_iso)\" = $S0 ]"
  chk "$n: admin absolute expiry preserved (|drift| <= ${DRIFT_OK} s)" bash -c "[ ${drift#-} -le $DRIFT_OK ]"
  chk "$n: lifetime NOT extended beyond admin.txt (<= ${DRIFT_OK} s)" bash -c "[ $fdiff -le $DRIFT_OK ]"
  chk "$n: unrelated tables untouched" bash -c "[ \"$(decoys)\" = $D0 ]"; }
host_snap() { snap $1 2>/dev/null; nft list table inet staging8443 | norm | sha256sum | cut -c1-16 > $EV/$1/host-gate.sha; }
case $MODE in
all)
  trap 'ip netns del $NS 2>/dev/null' EXIT
  host_snap WD2-host-before; echo "== setup (isolated)"; setup; echo "== waiting 30 s so that time elapses between saving the listing and restoring it"; sleep 30
  echo "== T1 deadline-triggered restoration (gate chain flushed, no signal, deadline 6 s)"; ns nft flush chain inet staging8443 stg_gate; run_wd t1 6 ""; verify_restored t1
  echo "== T2 fail-signal restoration (base chains/hooks deleted, fail file present)"; ns nft delete chain inet staging8443 stg_forward; ns nft delete chain inet staging8443 stg_input; run_wd t2 300 "" fail; verify_restored t2
  echo "== T3 restoration after the TABLE was deleted (deadline 6 s)"; ns nft delete table inet staging8443; run_wd t3 6 ""; verify_restored t3
  echo "== T4 confirmation cancels the watchdog WITHOUT changing the firewall"; read E0 EF D0 S0 < $T/baseline.txt; ns nft flush chain inet staging8443 stg_gate; Ebefore=$(kexp); run_wd t4 300 "" confirm
  chk "T4 watchdog cancelled" bash -c "[ \"\$(cat $T/t4/result)\" = CANCELLED ]"; chk "T4 firewall NOT touched (gate still flushed, as left)" bash -c "! ip netns exec $NS nft list chain inet staging8443 stg_gate | grep -q accept"
  chk "T4 admin expiry unchanged by the cancelled watchdog" bash -c "[ $(( $(kexp) - Ebefore )) -le 1 ]"; chk "T4 no restore/boot lines in the log" bash -c "! grep -qE 'restored|re-ran boot' $T/t4/watchdog.log"; chk "T4 unrelated tables untouched" bash -c "[ \"$(decoys)\" = $D0 ]"
  iso boot >/dev/null 2>&1
  echo "== T5 DEMONSTRATION of the original flaw: restore WITHOUT the boot step (WD_NO_BOOT=1)"; ns nft flush chain inet staging8443 stg_gate; run_wd t5 6 1; E1=$(kexp); drift5=$((E1-E0)); fd5=$((E1-EF))
  echo "  [t5] without boot: kernel expiry drift vs baseline = ${drift5} s; vs admin.txt = ${fd5} s (the exception would outlive its stated expiry)"
  chk "T5 flaw reproduced (drift >= 25 s without the boot step)" bash -c "[ $fd5 -ge 25 ]"; iso boot >/dev/null 2>&1
  chk "after repair by boot the expiry is back to admin.txt (<= ${DRIFT_OK} s)" bash -c "[ $(( $(kexp) - EF )) -le $DRIFT_OK ] && [ $(( $(kexp) - EF )) -ge -$DRIFT_OK ]"
  echo "== T6 independence: the watchdog ran with IPAddressDeny=any and only AF_UNIX/AF_NETLINK sockets (T1-T5 all passed that way)"
  d=$T/t6; mkdir -p $d; cp $T/pre.nft $T/rollback.nft $d/
  systemd-run --unit=stg-ap2-wd2-t6 --collect -p IPAddressDeny=any -p "RestrictAddressFamilies=AF_UNIX AF_NETLINK" bash ${WATCHDOG:-$EV/ap2-b1-watchdog.sh} $d 300 $NS >/dev/null 2>&1; sleep 1
  ipd=$(systemctl show stg-ap2-wd2-t6 -p IPAddressDeny --value); raf=$(systemctl show stg-ap2-wd2-t6 -p RestrictAddressFamilies --value); cg=$(systemctl show stg-ap2-wd2-t6 -p ControlGroup --value)
  chk "unit denies all network traffic (IPAddressDeny: $(echo $ipd | tr '\n' ' '))" bash -c "echo '$ipd' | grep -q '0.0.0.0/0'"; chk "unit may only open $raf (no AF_INET/AF_INET6)" bash -c "echo '$raf' | grep -q AF_NETLINK && ! echo '$raf' | grep -qE 'AF_INET'"
  chk "unit lives outside any ssh session scope ($cg)" bash -c "echo '$cg' | grep -q '^/system.slice/' && ! echo '$cg' | grep -q session-"
  chk "script has no ssh/curl/wget/docker/ufw/iptables/systemctl calls" bash -c "! grep -v '^#' ${WATCHDOG:-$EV/ap2-b1-watchdog.sh} | grep -qE '\b(ssh|scp|curl|wget|docker|ufw|iptables|systemctl)\b'"
  touch $d/confirm; for i in 1 2 3 4 5; do [ -e $d/result ] && break; sleep 1; done
  echo "== HOST untouched?"; host_snap WD2-host-after; cmpsnap WD2-host-before WD2-host-after | grep -v -E 'old4|old6|containers' ; chk "live gate unchanged (normalised listing hash)" bash -c "[ \"$(cat $EV/WD2-host-before/host-gate.sha)\" = \"$(cat $EV/WD2-host-after/host-gate.sha)\" ]"; chk "live signature/admin expiry unchanged" bash -c ". $EV/ap2-lib.sh; sig_ok && admin_exp_ok && admin_intact && old_layer_ok"
  echo "WD2: $PASS pass, $FAIL fail"; [ $FAIL = 0 ] ;;
sl-arm)
  echo "== session-loss test, arm"; setup; sleep 5; ns nft flush chain inet staging8443 stg_gate; d=$T/sl; mkdir -p $d; cp $T/pre.nft $T/rollback.nft $d/
  systemd-run --unit=stg-ap2-wd2-sl --collect -p IPAddressDeny=any -p "RestrictAddressFamilies=AF_UNIX AF_NETLINK" --setenv=WD_BOOT_CMD=$T/boot-in-ns.sh bash ${WATCHDOG:-$EV/ap2-b1-watchdog.sh} $d 25 $NS >/dev/null 2>&1
  echo "  gate corrupted at $(date -u +%T)Z; watchdog unit $(systemctl is-active stg-ap2-wd2-sl) (deadline 25 s). NOW the client connection may be dropped." ;;
sl-check)
  echo "== session-loss test, check"; d=$T/sl; echo "  unit state: $(systemctl is-active stg-ap2-wd2-sl 2>&1)"; cat $d/watchdog.log | cut -c1-120
  verify_restored sl; ip netns del $NS 2>/dev/null; echo "SL: $PASS pass, $FAIL fail; namespaces left: $(ip netns list | wc -l)"; [ $FAIL = 0 ] ;;
esac
