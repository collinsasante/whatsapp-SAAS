# Isolated three-namespace topology (proven in AP-1 run 3). Sourced after lib.sh and ap2-lib.sh. Touches nothing on the host.
#   stgiso = the "firewall host" (its own netfilter state)   isoc = client   isob = IPv4 backend behind DNAT
#   isoc identities: 10.88.1.2 / fd00:88:1::2 (NOT allowed)   173.245.48.250 / 2400:cb00:fffe::7 (Cloudflare-range, exist only on this veth)
ID=20261103T191201Z-b42a; PRISTINE=/var/lib/staging-8443/snapshots/$ID
topo_down() { kill $L1 $L2 $PPID_ $VPID 2>/dev/null; ip netns del isoc 2>/dev/null; ip netns del isob 2>/dev/null; ip netns del stgiso 2>/dev/null
              ip link del vi-c 2>/dev/null; ip link del vi-b 2>/dev/null; true; }
topo_up() {
  for n in stgiso isoc isob; do ip netns add $n; ip -n $n link set lo up; done
  ip link add vi-c type veth peer name vc-i; ip link set vi-c netns stgiso; ip link set vc-i netns isoc
  ip link add vi-b type veth peer name vb-i; ip link set vi-b netns stgiso; ip link set vb-i netns isob
  ip -n stgiso addr add 10.88.1.1/24 dev vi-c; ip -n stgiso -6 addr add fd00:88:1::1/64 dev vi-c nodad; ip -n stgiso link set vi-c up
  ip -n stgiso addr add 10.88.2.1/24 dev vi-b; ip -n stgiso link set vi-b up
  ip -n isoc link set vc-i up; ip -n isoc addr add 10.88.1.2/24 dev vc-i; ip -n isoc -6 addr add fd00:88:1::2/64 dev vc-i nodad
  ip -n isoc addr add 173.245.48.250/32 dev vc-i; ip -n isoc -6 addr add 2400:cb00:fffe::7/128 dev vc-i nodad
  ip -n stgiso route add 173.245.48.250/32 dev vi-c; ip -n stgiso -6 route add 2400:cb00:fffe::7/128 dev vi-c
  ip -n isob link set vb-i up; ip -n isob addr add 10.88.2.2/24 dev vb-i; ip -n isob route add default via 10.88.2.1
  ip netns exec stgiso sysctl -qw net.ipv4.ip_forward=1 net.ipv4.conf.all.rp_filter=0
  ip netns exec stgiso nft -f - <<NFT
table ip stgnat {
  chain pre {
    type nat hook prerouting priority -100; policy accept;
    tcp dport 8443 dnat to 10.88.2.2:8080
  }
}
NFT
  [ "$(ip netns exec stgiso nft list table ip stgnat | grep -c dnat)" = 1 ] || { echo "DNAT NOT INSTALLED"; return 1; }
  ip netns exec isob python3 -m http.server 8080 --bind 10.88.2.2 >/dev/null 2>&1 & L1=$!
  ip netns exec stgiso python3 -m http.server 8443 --bind :: >/dev/null 2>&1 & L2=$!
  sleep 1
  [ "$(ip netns exec stgiso ss -ltnH '( sport = :8443 )' | wc -l)" -ge 1 ] && [ "$(ip netns exec isob ss -ltnH '( sport = :8080 )' | wc -l)" -ge 1 ] || { echo "LISTENERS NOT UP"; return 1; }
}
# scratch state for running the REAL script in stgiso without touching host state
iso_setup() { ISO=$1; mkdir -p $ISO/state/snapshots; cp -a $PRISTINE $ISO/state/snapshots/; ln -sfn snapshots/$ID $ISO/state/last-good
  sed -E "s#^LOG_FILE=.*#LOG_FILE=$ISO/alerts.log#; s#^ALERT_CMD=.*#ALERT_CMD=/bin/true#" /etc/staging-8443/policy.conf > $ISO/policy.conf
  grep -q '^ALERT_CMD' $ISO/policy.conf || echo 'ALERT_CMD=/bin/true' >> $ISO/policy.conf; grep -q '^LOG_FILE' $ISO/policy.conf || echo "LOG_FILE=$ISO/alerts.log" >> $ISO/policy.conf
  : > $ISO/admin.txt; : > $ISO/alerts.log; }
iso() { ip netns exec stgiso env STG8443_CONF=$ISO/policy.conf STG8443_STATE=$ISO/state STG8443_LOCK=$ISO/lock STG8443_ADMIN=$ISO/admin.txt $F "$@"; }
