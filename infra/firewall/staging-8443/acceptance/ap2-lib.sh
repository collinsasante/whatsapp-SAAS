# AP-2 helpers. Sourced on the VPS AFTER lib.sh (the proven AP-1 helpers: snap, cmpsnap, gc, pr4, pr6, ns_up, ns_down).
#   export EV=/root/staging-8443-accept-ap2-<ts>; . $EV/lib.sh; . $EV/ap2-lib.sh
# Environment-specific acceptance constants: override them from the environment for a new run (defaults = the 2026-11-03 staging acceptance).
AP1=${AP1:-/root/staging-8443-accept-20261103T213420Z}
ADMIN_BK=${ADMIN_BK:-/root/staging-8443-ap2-admin-backup}      # OUTSIDE the evidence dir: holds the real admin line; never copied off the server
EXPECT_SIG=${EXPECT_SIG:-471c8a8d90ccad70}; EXPECT_SNAP=${EXPECT_SNAP:-20261103T191201Z-b42a}; EXPECT_ADMIN_EXP=${EXPECT_ADMIN_EXP:-2026-11-10T19:13:50Z}
PASS=0; FAIL=0
chk() { l=$1; shift; if "$@" >/dev/null 2>&1; then echo "PASS  $l"; PASS=$((PASS+1)); else echo "FAIL  $l"; FAIL=$((FAIL+1)); fi; }
sigline() { $F status | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d["live_signature"],d["mode"],d["last_good"],d["table_present"],d["disabled"])'; }
sig_ok() { [ "$(sigline)" = "$EXPECT_SIG snapshot $EXPECT_SNAP True False" ]; }
admin_exp_ok() { [ "$($F status | python3 -c 'import sys,json;print(",".join(e["expires"] for e in json.load(sys.stdin)["admin_exceptions"]))')" = "$EXPECT_ADMIN_EXP" ]; }
# the real admin line, compared byte for byte, never printed
admin_intact() { [ -s $ADMIN_BK/real.line ] && grep -qxF -f $ADMIN_BK/real.line /etc/staging-8443/admin.txt; }
admin_file_identical() { [ "$(sha256sum < /etc/staging-8443/admin.txt)" = "$(sha256sum < $ADMIN_BK/admin.txt.pre)" ]; }
old_layer_ok() {
  [ "$(iptables -S STG-8443 | wc -l)" = 21 ] && [ "$(ip6tables -S STG-8443-V6 | wc -l)" = 13 ] &&
  iptables -S DOCKER-USER | grep -qF -- '-A DOCKER-USER -p tcp -m conntrack --ctorigdstport 8443 --ctdir ORIGINAL -j STG-8443' &&
  [ "$(ip6tables -S INPUT | sed -n 2p)" = '-A INPUT -p tcp -m tcp --dport 8443 -j STG-8443-V6' ] &&
  iptables -S STG-8443 | tail -1 | grep -qF -- '-j DROP' && ip6tables -S STG-8443-V6 | tail -1 | grep -qF -- '-j DROP'; }
no_scaffolding() { [ "$(ip netns list | wc -l)" = 0 ] && ! ip link show vstg0 >/dev/null 2>&1 && ! ip link show vi-c >/dev/null 2>&1 &&
  [ "$(ip route show | grep -c 173.245.48.250)" = 0 ] && [ "$(ip -6 route show | grep -c 2400:cb00:fffe)" = 0 ]; }
prod_ok() { [ "$(curl -sk --max-time 8 -o /dev/null -w '%{http_code}' --resolve verzchat.com:443:127.0.0.1 https://verzchat.com/)" = 200 ]; }
containers_ok() { [ "$(docker ps -q | wc -l)" = 18 ] && [ "$(for c in $(docker ps -q); do docker inspect -f '{{.RestartCount}}' $c; done | awk '$1!=0' | wc -l)" = 0 ]; }
units_ok() { [ "$(systemctl is-active staging-8443-fw.service staging-8443-fw-verify.timer staging-8443-fw-refresh.timer staging-8443-firewall.service | sort -u | tr -d '\n')" = active ]; }
# Everything that must hold between any two steps. Prints one PASS/FAIL line per property.
invariants() { PASS=0; FAIL=0
  chk "signature/mode/snapshot as expected" sig_ok;      chk "real admin exception unchanged (expiry)" admin_exp_ok
  chk "real admin line intact (byte-identical)" admin_intact;  chk "old iptables layer intact (21/13, jumps, final DROP)" old_layer_ok
  chk "units active" units_ok;   chk "18 containers, 0 restarts" containers_ok;  chk "production health 200" prod_ok
  chk "ufw active" bash -c 'ufw status | grep -q "Status: active"'
  chk "4 fail2ban jails" bash -c '[ "$(fail2ban-client status | grep -o "nginx-botsearch\|nginx-http-auth\|nginx-limit-req\|sshd" | wc -l)" = 4 ]'
  chk "gate references none of 22/80/443/8080" bash -c '! nft list table inet staging8443 | grep -qE "(dport|proto-dst) (22|80|443|8080)\b"'
  echo "invariants: $PASS pass, $FAIL fail"; [ $FAIL = 0 ]; }
# The kill switch: reload the gate from last-good (atomic), then show state. Used by every rollback trigger.
killswitch() { echo "KILLSWITCH $(date -u +%T)Z: $*"; $F boot; sleep 2; sigline; }
