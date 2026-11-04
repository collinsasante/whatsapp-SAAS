#!/bin/bash
# Isolated test of `staging-8443-fw snapshot` and `staging-8443-fw recover`. Namespace + SCRATCH state; the real host is only READ (before/after hashes).
#   usage: ap3-snapshot-test.sh <EV>        FW=<path to the script under test> (default: the installed one)
export EV=$1; . $EV/lib.sh; . $EV/ap2-lib.sh; PASS=0; FAIL=0
F=${FW:-/usr/local/sbin/staging-8443-fw}; T=$EV/SNAP; NS=stgsn; ID=20261103T191201Z-b42a; TESTIP=192.0.2.99; DRIFT_OK=3
ns() { ip netns exec $NS "$@"; }
iso() { ns env STG8443_CONF=$T/policy.conf STG8443_STATE=$T/state STG8443_LOCK=$T/lock STG8443_ADMIN=$T/admin.txt python3 $F "$@"; }
st() { iso status 2>/dev/null | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get(sys.argv[1]))' "$1"; }
kexp() { ns nft -j list set inet staging8443 admin4 2>/dev/null | python3 -c 'import sys,json,time
d=json.load(sys.stdin); s=[x for x in d["nftables"] if "set" in x][0]["set"]
e=[x["elem"] for x in s.get("elem",[]) if x["elem"]["val"]=="'$TESTIP'"]; print(int(time.time()+e[0]["expires"]) if e else 0)'; }
fexp() { python3 -c 'import datetime
for l in open("'$T'/admin.txt"):
    if l.startswith("'$TESTIP' "): print(int(datetime.datetime.strptime(l.split("=")[1].strip(),"%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc).timestamp()))'; }
decoys() { { ns nft list table inet decoy1; ns nft list table ip decoy2; } 2>/dev/null | sed -E 's/packets [0-9]+ bytes [0-9]+//' | sha256sum | cut -c1-16; }
gate() { ns nft list table inet staging8443 | sed -E 's/packets [0-9]+ bytes [0-9]+//; s/ expires [0-9a-z.]+//; s/ timeout [0-9dhms]+//g' | awk '/^[ \t]*set admin[46] \{/{skip=1} !skip{print} skip && /^[ \t]*\}/{skip=0}' | sha256sum | cut -c1-16; }
flip() { python3 -c 'import sys; p=sys.argv[1]; b=open(p,"rb").read(); open(p,"wb").write((b"9" if b[:1]!=b"9" else b"8")+b[1:])' "$1"; }
mkdir -p $T; rm -rf $T/state; mkdir -p $T/state/snapshots; trap 'ip netns del $NS 2>/dev/null' EXIT
cp -a /var/lib/staging-8443/snapshots/$ID $T/state/snapshots/; ln -sfn snapshots/$ID $T/state/last-good
sed -E "s#^LOG_FILE=.*#LOG_FILE=$T/alerts.log#; s#^ALERT_CMD=.*#ALERT_CMD=/bin/true#" /etc/staging-8443/policy.conf > $T/policy.conf; grep -q '^ALERT_CMD' $T/policy.conf || echo 'ALERT_CMD=/bin/true' >> $T/policy.conf; grep -q '^LOG_FILE' $T/policy.conf || echo "LOG_FILE=$T/alerts.log" >> $T/policy.conf
: > $T/admin.txt; : > $T/alerts.log; ip netns add $NS; ip -n $NS link set lo up
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
ns nft list table inet decoy1 >/dev/null 2>&1 || { echo "ABORT: decoys missing"; exit 3; }
hostgate() { nft list table inet staging8443 2>/dev/null | awk '/^[ \t]*set admin[46] \{/{skip=1} !skip{print} skip && /^[ \t]*\}/{skip=0}' | sed -E 's/packets [0-9]+ bytes [0-9]+//' | sha256sum | cut -c1-16; }   # admin sets excluded: their expiry countdown legitimately ticks
HB=$(hostgate)
HSNAP=$(ls -l --time-style=+%s /var/lib/staging-8443/snapshots /var/lib/staging-8443 2>/dev/null | awk '{print $NF}' | sort | sha256sum | cut -c1-16); HLS=$(readlink /var/lib/staging-8443/last-good); iso boot >/dev/null 2>&1; iso admin add $TESTIP --ttl 2h >/dev/null 2>&1
LG0=$(st last_good); S0=$(st live_signature); E0=$(kexp); D0=$(decoys); G0=$(gate); P0=$(sha256sum < $T/policy.conf | cut -c1-16)
echo "baseline: last-good $LG0, signature $S0, recovery snapshot: $(st recovery_snapshot), previous: $(st previous_snapshot)"; [ "$D0" != e3b0c44298fc1c14 ] || exit 3
sleep 4
echo "== T1 snapshot: a second, independent recovery snapshot, nothing live touched"
iso snapshot; RC=$?; R1=$(st recovery_snapshot)
chk "T1: exit 0" [ $RC = 0 ]; chk "T1: a NEW snapshot id ($R1) different from last-good" bash -c "[ -n '$R1' ] && [ '$R1' != None ] && [ '$R1' != '$LG0' ]"
chk "T1: existing snapshot NOT overwritten (last-good dir still present and last_good unchanged)" bash -c "[ -d $T/state/snapshots/$LG0 ] && [ '$(st last_good)' = '$LG0' ]"
chk "T1: copy content identical to last-good (same v4/v6 hashes)" bash -c "cmp $T/state/snapshots/$LG0/v4.txt $T/state/snapshots/$R1/v4.txt && cmp $T/state/snapshots/$LG0/v6.txt $T/state/snapshots/$R1/v6.txt"
chk "T1: meta records provenance (recovery-copy-of:$LG0)" grep -q "recovery-copy-of:$LG0" $T/state/snapshots/$R1/meta.json
chk "T1: copy validates independently (hashes recorded and matching)" python3 -c "import json,hashlib,sys; d='$T/state/snapshots/$R1'; m=json.load(open(d+'/meta.json')); assert hashlib.sha256(open(d+'/v4.txt','rb').read()).hexdigest()==m['v4_sha256'] and hashlib.sha256(open(d+'/v6.txt','rb').read()).hexdigest()==m['v6_sha256']"
chk "T1: live signature unchanged ($S0)" bash -c "[ '$(st live_signature)' = '$S0' ]"; chk "T1: live gate rules identical (no reload)" bash -c "[ '$(gate)' = '$G0' ]"
chk "T1: admin expiry unchanged (kernel) " bash -c "d=\$(( $(kexp) - $E0 )); [ \${d#-} -le 1 ]"; chk "T1: policy untouched" bash -c "[ '$(sha256sum < $T/policy.conf | cut -c1-16)' = '$P0' ]"; chk "T1: unrelated tables untouched" bash -c "[ '$(decoys)' = '$D0' ]"
chk "T1: status reports the recovery snapshot" bash -c "[ '$(st recovery_snapshot)' = '$R1' ]"
echo "== T2 repeatable: a second snapshot run creates another copy and re-pins"; sleep 1; iso snapshot; R2=$(st recovery_snapshot); chk "T2: new id again, both copies present and valid" bash -c "[ '$R2' != '$R1' ] && [ -d $T/state/snapshots/$R1 ] && [ -d $T/state/snapshots/$R2 ]"
echo "== T3 restore in isolation: last-good is corrupted, the box fails closed, then recover"
flip $T/state/snapshots/$LG0/v4.txt; iso boot >/dev/null 2>&1; FB=$(st live_signature); chk "T3: corrupt last-good => fail-closed fallback (signature $FB != $S0)" bash -c "[ '$FB' != '$S0' ] && [ '$(st mode)' = fallback ]"
sleep 3; iso recover; RC=$?; chk "T3: recover exit 0" [ $RC = 0 ]
chk "T3: signature back to $S0 and mode snapshot" bash -c "[ '$(st live_signature)' = '$S0' ] && [ '$(st mode)' = snapshot ]"; chk "T3: last-good is now the recovery snapshot ($R2)" bash -c "[ '$(st last_good)' = '$R2' ]"
E1=$(kexp); EF=$(fexp); chk "T3: admin absolute expiry PRESERVED (kernel vs baseline <= ${DRIFT_OK}s; vs admin.txt <= ${DRIFT_OK}s)" bash -c "a=\$(( $E1 - $E0 )); b=\$(( $E1 - $EF )); [ \${a#-} -le $DRIFT_OK ] && [ \${b#-} -le $DRIFT_OK ]"
chk "T3: gate rules identical to the original" bash -c "[ '$(gate)' = '$G0' ]"; chk "T3: unrelated tables untouched" bash -c "[ '$(decoys)' = '$D0' ]"; chk "T3: policy untouched" bash -c "[ '$(sha256sum < $T/policy.conf | cut -c1-16)' = '$P0' ]"
chk "T3: the corrupt snapshot is kept for forensics (previous points at it)" bash -c "[ '$(st previous_snapshot)' = '$LG0' ] && [ -d $T/state/snapshots/$LG0 ]"
echo "== T4 a TAMPERED recovery snapshot is refused and nothing changes"; iso snapshot >/dev/null 2>&1; R3=$(st recovery_snapshot); LGb=$(st last_good); Sb=$(st live_signature); Gb=$(gate)
flip $T/state/snapshots/$R3/v6.txt; iso recover >/dev/null 2>$T/t4.err; RC=$?
chk "T4: recover refused (non-zero exit)" [ $RC != 0 ]; chk "T4: error says the snapshot does not match its recorded hashes" grep -qi "does not match\|recorded hashes\|corrupt" $T/alerts.log $T/t4.err
chk "T4: last-good, signature and live rules unchanged" bash -c "[ '$(st last_good)' = '$LGb' ] && [ '$(st live_signature)' = '$Sb' ] && [ '$(gate)' = '$Gb' ]"
echo "== T5 recover is refused while the rollback marker is present"; touch $T/state/disabled; iso recover >/dev/null 2>&1; RC=$?; chk "T5: refused (exit != 0)" [ $RC != 0 ]; rm -f $T/state/disabled
echo "== T6 pruning never removes the recovery snapshot (more than SNAPSHOTS_KEEP newer snapshots)"
iso snapshot >/dev/null 2>&1; RP=$(st recovery_snapshot)
ns env STG8443_CONF=$T/policy.conf STG8443_STATE=$T/state STG8443_LOCK=$T/lock STG8443_ADMIN=$T/admin.txt python3 - <<PY
import importlib.machinery, importlib.util
l=importlib.machinery.SourceFileLoader("fw","$F"); sp=importlib.util.spec_from_loader("fw",l); fw=importlib.util.module_from_spec(sp); l.exec_module(fw); fw.load_policy()
v4,v6,meta=fw.read_snapshot("last-good")
import time
for i in range(13):
    time.sleep(1.05); sid=fw.write_snapshot(v4,v6,"prune-test"); fw.promote(sid)
PY
chk "T6: recovery snapshot ($RP) survived 13 newer promotions" bash -c "[ -d $T/state/snapshots/$RP ] && [ '$(st recovery_snapshot)' = '$RP' ]"
chk "T6: pruning still bounded (<= SNAPSHOTS_KEEP + pinned)" bash -c "[ \$(ls $T/state/snapshots | wc -l) -le 12 ]"
echo "== T7 refresh end-to-end through a LOCAL feed (promote() is on this path): unchanged, then a changed list, then recover"
iso recover >/dev/null 2>&1; Sr=$(st live_signature); Rr=$(st recovery_snapshot); mkdir -p $T/feed; cp $T/state/snapshots/$(st last_good)/v4.txt $T/feed/v4; cp $T/state/snapshots/$(st last_good)/v6.txt $T/feed/v6
( cd $T/feed && ns python3 -m http.server 8099 --bind 127.0.0.1 >/dev/null 2>&1 ) & FP=$!; sleep 1
sed -i -E "s#^FEED_V4=.*#FEED_V4=http://127.0.0.1:8099/v4#; s#^FEED_V6=.*#FEED_V6=http://127.0.0.1:8099/v6#; s#^POSTCHECK_CMD=.*##" $T/policy.conf
iso refresh >/dev/null 2>&1; chk "T7a: unchanged feed => 'unchanged', last-good and recovery pointer untouched" bash -c "[ '$(st last_refresh_result)' = unchanged ] && [ '$(st recovery_snapshot)' = '$Rr' ]"
LGc=$(st last_good); echo "8.8.8.0/24" >> $T/feed/v4; sleep 1; iso refresh >/dev/null 2>&1; LGn=$(st last_good)
chk "T7b: changed feed => applied (+1), new last-good" bash -c "[ '$LGn' != '$LGc' ] && echo '$(st last_refresh_result)' | grep -q 'applied +1'"
chk "T7b: previous = the former last-good, and the RECOVERY snapshot is still pinned and valid" bash -c "[ '$(st previous_snapshot)' = '$LGc' ] && [ '$(st recovery_snapshot)' = '$Rr' ] && [ -d $T/state/snapshots/$Rr ]"
chk "T7b: signature changed as expected (new range loaded)" bash -c "[ '$(st live_signature)' != '$Sr' ]"
Ex=$(kexp); chk "T7b: admin absolute expiry preserved across the refresh reload (<= ${DRIFT_OK}s vs admin.txt)" bash -c "d=\$(( $Ex - $(fexp) )); [ \${d#-} -le $DRIFT_OK ]"
iso recover >/dev/null 2>&1; chk "T7c: recover returns to the pinned snapshot content (signature $Sr)" bash -c "[ '$(st live_signature)' = '$Sr' ] && [ '$(st last_good)' = '$Rr' ]"
chk "T7c: unrelated tables untouched" bash -c "[ '$(decoys)' = '$D0' ]"; kill $FP 2>/dev/null
echo "== HOST untouched"; HA=$(hostgate); chk "HOST: live gate listing unchanged (counters ignored)" [ "$HA" = "$HB" ]; chk "HOST: signature/admin/old layer intact" bash -c ". $EV/ap2-lib.sh; sig_ok && admin_exp_ok && old_layer_ok"
chk "HOST: live snapshot store untouched (same entries, last-good still $HLS)" bash -c "[ \"\$(ls -l --time-style=+%s /var/lib/staging-8443/snapshots /var/lib/staging-8443 2>/dev/null | awk '{print \$NF}' | sort | sha256sum | cut -c1-16)\" = \"$HSNAP\" ] && [ \"\$(readlink /var/lib/staging-8443/last-good)\" = \"$HLS\" ]"
echo "SNAPSHOT TESTS: $PASS pass, $FAIL fail"; [ $FAIL = 0 ]
