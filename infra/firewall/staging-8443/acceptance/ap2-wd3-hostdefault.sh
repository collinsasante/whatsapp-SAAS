#!/bin/bash
# Validates the watchdog's HOST-DEFAULT path (no namespace argument, no WD_* overrides, no STG8443_* overrides) with ZERO effect on the real host:
# the unit runs in a PRIVATE network namespace (own empty netfilter state, no network) with scratch state bind-mounted over the default paths.
#   usage: ap2-wd3-hostdefault.sh <EV> [outer|inner]
export EV=$1; MODE=${2:-outer}; . $EV/lib.sh; . $EV/ap2-lib.sh; PASS=0; FAIL=0
T=$EV/WD3; ID=20261103T191201Z-b42a; TESTIP=192.0.2.99; EXPIP=192.0.2.98; DRIFT_OK=3
norm() { awk '/^[ \t]*set admin[46] \{/{skip=1} !skip{print} skip && /^[ \t]*\}/{skip=0}' | sed -E 's/packets [0-9]+ bytes [0-9]+//; s/ expires [0-9a-z.]+//; s/ timeout [0-9dhms]+//g'; }
host_hash() { nft list table inet staging8443 | awk '/^[ \t]*set admin[46] \{/{skip=1} !skip{print} skip && /^[ \t]*\}/{skip=0}' | sed -E 's/packets [0-9]+ bytes [0-9]+//' | sha256sum | cut -c1-16; }
if [ "$MODE" = outer ]; then
  rm -rf $T; mkdir -p $T/state/snapshots $T/etc $T/log; : > $T/lock; : > $T/alerts.log
  cp -a /var/lib/staging-8443/snapshots/$ID $T/state/snapshots/; ln -sfn snapshots/$ID $T/state/last-good
  cp /etc/staging-8443/policy.conf $T/etc/policy.conf; install -m 640 /dev/null $T/etc/admin.txt
  snap WD3-host-before 2>/dev/null; wc -l < /var/log/staging-8443-alerts.log > $T/alerts-lines-before; HB=$(host_hash); echo "$HB" > $T/host-gate-before.sha; date -u +%FT%TZ > $T/window-start.txt
  systemd-run --unit=stg-ap2-wd3 --pipe --wait --collect -p Nice=5 -p PrivateNetwork=yes -p IPAddressDeny=any -p "RestrictAddressFamilies=AF_UNIX AF_NETLINK" --setenv=WATCHDOG="$WATCHDOG" \
    -p BindPaths=$T/state:/var/lib/staging-8443 -p BindPaths=$T/etc:/etc/staging-8443 -p BindPaths=$T/lock:/run/staging-8443.lock -p BindPaths=$T/alerts.log:/var/log/staging-8443-alerts.log \
    bash $EV/ap2-wd3-hostdefault.sh $EV inner 2>&1 | grep -v -E 'Running as unit|Finished with result|Main processes|Service runtime|CPU time|IO bytes|Memory peak|Memory swap'; RC=${PIPESTATUS[0]}
  date -u +%FT%TZ > $T/window-end.txt; snap WD3-host-after 2>/dev/null; PASS=0; FAIL=0
  chk "HOST: live gate (admin sets excluded) identical before/after" bash -c "[ \"$HB\" = \"$(host_hash)\" ]"
  chk "HOST: signature, admin expiry, old layer unchanged" bash -c ". $EV/ap2-lib.sh; sig_ok && admin_exp_ok && admin_intact && old_layer_ok && admin_file_identical"
  chk "HOST: no hash changes (iptables, ip6tables, other tables, DOCKER-USER, ufw)" bash -c "for f in iptables.sha ip6tables.sha other-tables.sha docker-user.sha ufw.md5 restarts.txt; do diff -q $EV/WD3-host-before/\$f $EV/WD3-host-after/\$f >/dev/null || exit 1; done"
  chk "HOST: real alerts log not touched (line count same as before)" bash -c "[ \$(wc -l < /var/log/staging-8443-alerts.log) = \$(cat $T/alerts-lines-before) ]"
  chk "no leftovers (units/processes)" bash -c "[ \"\$(systemctl list-units --no-legend 'stg-ap2-wd3*' | wc -l)\" = 0 ]"
  echo "WD3 outer: $PASS pass, $FAIL fail; sandbox exit code $RC"; [ $RC = 0 ] && [ $FAIL = 0 ]; exit $?
fi
# ------------------------------------------------------------------ inner (inside the sandbox)
F=/usr/local/sbin/staging-8443-fw; D0=
kexp() { nft -j list set inet staging8443 admin4 2>/dev/null | python3 -c 'import sys,json,time
d=json.load(sys.stdin); s=[x for x in d["nftables"] if "set" in x][0]["set"]
e=[x["elem"] for x in s.get("elem",[]) if x["elem"]["val"]=="'$1'"]; print(int(time.time()+e[0]["expires"]) if e else 0)'; }
fexp() { python3 -c 'import datetime
for l in open("/etc/staging-8443/admin.txt"):
    if l.startswith("'$1' "): print(int(datetime.datetime.strptime(l.split("=")[1].strip(),"%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc).timestamp()))'; }
decoys() { { nft list table inet decoy1; nft list table ip decoy2; } 2>/dev/null | sed -E 's/packets [0-9]+ bytes [0-9]+//' | sha256sum | cut -c1-16; }
gate_ok() { nft list chain inet staging8443 stg_gate 2>/dev/null | grep -q accept; }
sigv() { $F status 2>/dev/null | python3 -c 'import sys,json;print(json.load(sys.stdin)["live_signature"])'; }
run_wd() { n=$1; dl=$2; shift 2; d=$T/$n; rm -rf $d; mkdir -p $d; cp $T/pre.nft $T/rollback.nft $d/; for f in "$@"; do touch $d/$f; done
  t0=$(date +%s.%N); bash ${WATCHDOG:-$EV/ap2-b1-watchdog.sh} $d $dl; t1=$(date +%s.%N); EL=$(echo "$t1 - $t0" | bc); }
mkpre() { nft list table inet staging8443 > $T/pre.nft; { echo "add table inet staging8443"; echo "delete table inet staging8443"; cat $T/pre.nft; } > $T/rollback.nft; }
check_state() { n=$1; E1=$(kexp $TESTIP); EF=$(fexp $TESTIP); drift=$((E1-E0)); fd=$((E1-EF))
  echo "  [$n] elapsed ${EL}s | result=$(cat $T/$n/result 2>/dev/null) | gate: $(gate_ok && echo restored || echo NOT) | expiry drift ${drift}s, vs admin.txt ${fd}s | decoys $([ "$(decoys)" = "$D0" ] && echo same || echo CHANGED)"
  chk "$n: verified rollback result" bash -c "[ \"\$(cat $T/$n/result)\" = ROLLED_BACK_OK ]"; chk "$n: gate restored" gate_ok
  chk "$n: signature equals baseline ($S0)" bash -c "[ \"$(sigv)\" = $S0 ]"; chk "$n: absolute expiry preserved (|drift| <= $DRIFT_OK s)" bash -c "[ ${drift#-} -le $DRIFT_OK ]"
  chk "$n: lifetime not extended beyond admin.txt" bash -c "[ $fd -le $DRIFT_OK ]"; chk "$n: unrelated tables untouched" bash -c "[ \"$(decoys)\" = \"$D0\" ]"
  chk "$n: HOST-DEFAULT boot path was the one used (log says re-ran 'staging-8443-fw boot')" grep -q "re-ran 'staging-8443-fw boot'" $T/$n/watchdog.log
  chk "$n: no WD_BOOT_CMD/override involved" bash -c "! grep -q WD_BOOT_CMD $T/$n/watchdog.log"; }
echo "== H0 sandbox facts"
chk "private network namespace (differs from PID 1's)" bash -c '[ "$(readlink /proc/self/ns/net)" != "$(readlink /proc/1/ns/net)" ]'
chk "only loopback exists in the sandbox" bash -c '[ "$(ls /sys/class/net | tr "\n" " ")" = "lo " ]'
chk "no STG8443_* overrides in the environment (true defaults)" bash -c '! env | grep -q "^STG8443_"'
chk "default admin file is the SCRATCH one (no entries yet)" bash -c '[ "$(grep -Evc "^\s*(#|$)" /etc/staging-8443/admin.txt)" = 0 ]'
chk "network is unusable (cannot open an inet socket)" bash -c '! timeout 3 bash -c "exec 3<>/dev/tcp/1.1.1.1/53" 2>/dev/null'
chk "unit outside any ssh session scope ($(cut -d: -f3 /proc/self/cgroup | head -1))" bash -c 'grep -q "^0::/system.slice/" /proc/self/cgroup && ! grep -q session- /proc/self/cgroup'
nft list tables | grep -q staging8443 && { echo "ABORT: sandbox is not empty"; exit 3; }
echo "== setup with the DEFAULT command: staging-8443-fw boot + admin add (scratch state)"
$F boot >/dev/null 2>&1; $F admin add $TESTIP --ttl 2h >/dev/null 2>&1
nft -f - <<'NFT'
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
nft list table inet decoy1 >/dev/null 2>&1 && nft list table ip decoy2 >/dev/null 2>&1 || { echo "ABORT: decoys missing"; exit 3; }
mkpre; E0=$(kexp $TESTIP); D0=$(decoys); S0=$(sigv); [ "$D0" != e3b0c44298fc1c14 ] || exit 3; AH=$(sha256sum < /etc/staging-8443/admin.txt)
echo "  baseline: signature $S0, test-exception expiry drift vs file $((E0-$(fexp $TESTIP))) s, decoys $D0"
echo "== waiting 30 s (time must elapse between saving the listing and restoring it)"; sleep 30
echo "== H1 deadline-triggered restore (gate flushed, deadline 6 s)"; nft flush chain inet staging8443 stg_gate; run_wd h1 6; check_state h1
chk "h1: bounded: elapsed between the deadline and deadline+4 s" bash -c "awk 'BEGIN{exit !($EL>=5.5 && $EL<=10)}'"
chk "h1: watchdog did not write admin.txt (hash unchanged)" bash -c "[ \"\$(sha256sum < /etc/staging-8443/admin.txt)\" = \"$AH\" ]"
echo "== H2 fail-signal restore (base chains deleted)"; nft delete chain inet staging8443 stg_forward; nft delete chain inet staging8443 stg_input; run_wd h2 300 fail; check_state h2
chk "h2: bounded: finished within 5 s of the fail signal" bash -c "awk 'BEGIN{exit !($EL<=5)}'"
echo "== H3 restore after the table was DELETED (deadline 6 s)"; nft delete table inet staging8443; run_wd h3 6; check_state h3
echo "== H4 idempotency: the watchdog run three more times on a HEALTHY table, then boot twice"
for i in 1 2 3; do run_wd h4$i 300 fail; check_state h4$i; done
$F boot >/dev/null 2>&1; s1=$(sigv); $F boot >/dev/null 2>&1; s2=$(sigv); chk "boot is idempotent (signature $s1 == $s2 == baseline)" bash -c "[ $s1 = $s2 ] && [ $s1 = $S0 ]"
echo "== H5 bounded under lock contention: another process holds the script lock, LOCK_WAIT=5"
echo 'LOCK_WAIT=5' >> /etc/staging-8443/policy.conf; nft flush chain inet staging8443 stg_gate
( flock /run/staging-8443.lock sleep 40 ) & LP=$!; sleep 1; run_wd h5 300 fail; kill $LP 2>/dev/null; wait $LP 2>/dev/null
echo "  [h5] elapsed ${EL}s; result=$(cat $T/h5/result); gate $(gate_ok && echo restored || echo NOT); log tail: $(tail -3 $T/h5/watchdog.log | cut -c1-90 | tr '\n' '|')"
chk "h5: gate restored immediately by the listing even though boot could not run" gate_ok
chk "h5: bounded (<= LOCK_WAIT + 6 s), not the 120 s default" bash -c "awk 'BEGIN{exit !($EL<=11)}'"
sed -i '/^LOCK_WAIT=5/d' /etc/staging-8443/policy.conf; $F boot >/dev/null 2>&1
echo "== H6 an exception that EXPIRES between save and restore must NOT be resurrected"
$F admin add $EXPIP --ttl 15s >/dev/null 2>&1; mkpre; sleep 20; nft flush chain inet staging8443 stg_gate; run_wd h6 300 fail
echo "  [h6] expired test exception present in kernel after restore: $([ "$(kexp $EXPIP)" != 0 ] && echo YES || echo no); still in admin.txt: $(grep -c "^$EXPIP " /etc/staging-8443/admin.txt); long-lived test exception expiry vs file: $(( $(kexp $TESTIP) - $(fexp $TESTIP) )) s"
chk "h6: expired exception NOT resurrected in the kernel set" bash -c "[ $(kexp $EXPIP) = 0 ]"; chk "h6: expired entry pruned from admin.txt by boot" bash -c "[ $(grep -c "^$EXPIP " /etc/staging-8443/admin.txt) = 0 ]"
chk "h6: the long-lived exception kept its absolute expiry (<= $DRIFT_OK s)" bash -c "d=\$(( $(kexp $TESTIP) - $(fexp $TESTIP) )); [ \${d#-} -le $DRIFT_OK ]"; chk "h6: gate restored" gate_ok; chk "h6: unrelated tables untouched" bash -c "[ \"$(decoys)\" = \"$D0\" ]"
echo "WD3 inner: $PASS pass, $FAIL fail"; [ $FAIL = 0 ]
