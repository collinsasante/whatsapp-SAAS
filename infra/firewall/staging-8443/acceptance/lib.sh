# AP-1 helpers (read-only except for local namespace scaffolding). Sourced on the VPS.
export F=/usr/local/sbin/staging-8443-fw
snap() { d=$EV/$1; mkdir -p $d
  $F status | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d["live_signature"],d["expected_signature"],d["last_good"],d["mode"],[e["expires"] for e in d["admin_exceptions"]])' > $d/fw.txt
  nft list table inet staging8443 | grep -E 'counter packets' | sed -E 's/^\s+//' > $d/counters.txt
  nft list ruleset | awk '/^table /{s=($3=="staging8443")} !s' | sed -E 's/packets [0-9]+ bytes [0-9]+//' | grep -v -E '^\s*elements = ' | sha256sum > $d/other-tables.sha
  iptables-save  | grep -Ev '^[#:]' | sha256sum > $d/iptables.sha
  ip6tables-save | grep -Ev '^[#:]' | sha256sum > $d/ip6tables.sha
  iptables -S DOCKER-USER | sha256sum > $d/docker-user.sha
  ufw status verbose | md5sum > $d/ufw.md5;  fail2ban-client status > $d/f2b.txt
  docker ps --format '{{.Names}} {{.Status}}' | sort > $d/containers.txt
  for c in $(docker ps -q); do docker inspect -f '{{.Name}} {{.RestartCount}} {{.State.StartedAt}}' $c; done | sort > $d/restarts.txt
  iptables -vnxL STG-8443 | awk 'NR>2{print $1,$3}' > $d/old4.txt; ip6tables -vnxL STG-8443-V6 | awk 'NR>2{print $1,$3}' > $d/old6.txt
  systemctl is-active staging-8443-fw.service staging-8443-fw-verify.timer staging-8443-fw-refresh.timer staging-8443-firewall.service > $d/units.txt
}
cmpsnap() { for f in other-tables.sha iptables.sha ip6tables.sha docker-user.sha ufw.md5 containers.txt restarts.txt units.txt old4.txt old6.txt; do
  diff -q $EV/$1/$f $EV/$2/$f >/dev/null && echo "same  $f" || echo "DIFF  $f"; done; diff $EV/$1/fw.txt $EV/$2/fw.txt >/dev/null && echo "same  fw.txt" || echo "DIFF  fw.txt"; }
# gate counters as "gate fwd input"
gc() { nft list table inet staging8443 | python3 -c '
import sys,re
c={"g":None,"f":None,"i":None}
for l in sys.stdin:
    m=re.search(r"counter packets (\d+) bytes (\d+) drop",l)
    if not m: continue
    k="f" if "proto-dst 8443" in l else ("i" if "tcp dport 8443" in l else "g"); c[k]=int(m.group(1))
print(c["g"],c["f"],c["i"])'; }
pr4() { ip netns exec stgacc curl -sk --max-time 6 --interface "$1" -o /dev/null -w '%{http_code}' "https://192.0.2.1:${2:-8443}/health" 2>/dev/null; }
pr6() { ip netns exec stgacc curl -6sk --max-time 6 --interface "$1" -o /dev/null -w '%{http_code}' "https://[fd00:8443:99::1]:${2:-8443}/health" 2>/dev/null; }
ns_up() {
  ip netns add stgacc; ip link add vstg0 type veth peer name vstg1; ip link set vstg1 netns stgacc
  ip addr add 192.0.2.1/30 dev vstg0; ip -6 addr add fd00:8443:99::1/64 dev vstg0 nodad; ip link set vstg0 up
  ip -n stgacc link set lo up; ip -n stgacc link set vstg1 up
  ip -n stgacc addr add 192.0.2.2/30 dev vstg1; ip -n stgacc -6 addr add fd00:8443:99::2/64 dev vstg1 nodad
  ip -n stgacc route add default via 192.0.2.1; ip -n stgacc -6 route add default via fd00:8443:99::1
  nft get element inet staging8443 cf4 { 173.245.48.250 } >/dev/null && nft get element inet staging8443 cf6 { 2400:cb00:fffe::7 } >/dev/null || { echo "CF test addresses not in the sets"; return 1; }
  ip -n stgacc addr add 173.245.48.250/32 dev vstg1; ip route add 173.245.48.250/32 dev vstg0
  ip -n stgacc -6 addr add 2400:cb00:fffe::7/128 dev vstg1 nodad; ip -6 route add 2400:cb00:fffe::7/128 dev vstg0
  sleep 2
}
ns_down() {
  ip route del 173.245.48.250/32 dev vstg0 2>/dev/null; ip -6 route del 2400:cb00:fffe::7/128 dev vstg0 2>/dev/null
  ip netns del stgacc 2>/dev/null; ip link del vstg0 2>/dev/null; true
}
