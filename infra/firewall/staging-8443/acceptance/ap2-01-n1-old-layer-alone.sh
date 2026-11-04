#!/bin/bash
# N1: prove, in isolation, that the OLD iptables layer alone blocks unauthorised sources and admits Cloudflare-range sources.
# Copies the old chains' rules from the live host (admin /32 rule removed) into a scratch namespace. Writes nothing to host firewall state.
export EV=$1; . $EV/lib.sh; . $EV/ap2-lib.sh; . $EV/ap2-topo.sh; trap topo_down EXIT
A=$EV/N1; mkdir -p $A; PROBE=$A/probe.log; : > $PROBE; PASS=0; FAIL=0
topo_up || exit 2
iptables-save -t filter  | grep -E '^-A STG-8443 '    | grep -v -E -- '-s [0-9.]+/32 -j RETURN' > $A/v4.rules
ip6tables-save -t filter | grep -E '^-A STG-8443-V6 ' > $A/v6.rules
{ echo '*filter'; echo ':STG-8443 - [0:0]'; echo ':DOCKER-USER - [0:0]'; cat $A/v4.rules
  echo '-A DOCKER-USER -p tcp -m conntrack --ctorigdstport 8443 --ctdir ORIGINAL -j STG-8443'; echo '-A FORWARD -j DOCKER-USER'; echo COMMIT; } | ip netns exec stgiso iptables-restore -w --noflush
{ echo '*filter'; echo ':STG-8443-V6 - [0:0]'; cat $A/v6.rules; echo '-A INPUT -p tcp -m tcp --dport 8443 -j STG-8443-V6'; echo COMMIT; } | ip netns exec stgiso ip6tables-restore -w --noflush
chk "old chains loaded in the namespace (v4 rules / v6 rules)" bash -c "[ \$(ip netns exec stgiso iptables -S STG-8443 | wc -l) -ge 19 ] && [ \$(ip netns exec stgiso ip6tables -S STG-8443-V6 | wc -l) -ge 12 ]"
chk "the NEW table is NOT present in the namespace" bash -c '[ "$(ip netns exec stgiso nft list tables | grep -c staging8443)" = 0 ]'
ip netns exec isoc python3 $EV/prober_iso.py $PROBE 14 & PPID_=$!
wait $PPID_
n() { awk -v t=$1 -v v=$2 '$2==t && $3==v' $PROBE | wc -l; }
echo "probes: U4 open=$(n U4 1) closed=$(n U4 0) | CF4 open=$(n CF4 1) closed=$(n CF4 0) | U6 open=$(n U6 1) closed=$(n U6 0) | CF6 open=$(n CF6 1) closed=$(n CF6 0)"
chk "old layer alone: unauthorised IPv4 never open"  bash -c "[ $(n U4 1) = 0 ] && [ $(n U4 0) -gt 20 ]"
chk "old layer alone: unauthorised IPv6 never open"  bash -c "[ $(n U6 1) = 0 ] && [ $(n U6 0) -gt 20 ]"
chk "old layer alone: Cloudflare-range IPv4 never blocked" bash -c "[ $(n CF4 0) = 0 ] && [ $(n CF4 1) -gt 20 ]"
chk "old layer alone: Cloudflare-range IPv6 never blocked" bash -c "[ $(n CF6 0) = 0 ] && [ $(n CF6 1) -gt 20 ]"
chk "old DROP counters in the namespace rose (the old layer did the dropping)" bash -c '[ "$(ip netns exec stgiso iptables -vnxL STG-8443 | tail -1 | awk "{print \$1}")" -gt 0 ] && [ "$(ip netns exec stgiso ip6tables -vnxL STG-8443-V6 | tail -1 | awk "{print \$1}")" -gt 0 ]'
chk "host untouched (old layer 21/13, signature)" bash -c '. '$EV'/ap2-lib.sh; old_layer_ok && sig_ok'
echo "N1: $PASS pass, $FAIL fail"; [ $FAIL = 0 ]
