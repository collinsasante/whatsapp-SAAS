#!/bin/bash
# B2: create and remove ONE throwaway Docker bridge. NOT a Docker restart. Subnet 198.51.100.0/29 (TEST-NET-2). Label ap2.owner=b2 marks it as ours.
# Expectation (observed on three existing EMPTY bridges on this host): creating a bridge adds exactly 5 iptables rules and no ip6tables rules:
#   filter: DOCKER ! -i BR -o BR -j DROP | DOCKER-BRIDGE -o BR -j DOCKER | DOCKER-CT -o BR ... RELATED,ESTABLISHED -j ACCEPT | DOCKER-FORWARD -i BR -j ACCEPT
#   nat:    POSTROUTING -s 198.51.100.0/29 ! -o BR -j MASQUERADE
export EV=$1; . $EV/lib.sh; . $EV/ap2-lib.sh
A=$EV/B2; mkdir -p $A; NAME=stg-acc-probe; SUBNET=198.51.100.0/29; REAL=$(awk '{print $1}' $ADMIN_BK/real.line)
dump() { d=$A/$1; mkdir -p $d   # normalised rule text, counters stripped, the admin address masked
  for t in filter nat raw mangle; do iptables-save -t $t | grep -E '^-A|^:' | sed -E 's/ \[[0-9]+:[0-9]+\]//' | sed "s#${REAL//./\\.}#<admin>#g" | sort > $d/v4-$t.txt; done
  ip6tables-save | grep -E '^-A|^:' | sed -E 's/ \[[0-9]+:[0-9]+\]//' | sort > $d/v6.txt
  ip -o link show | awk '{print $2}' | sort > $d/links.txt; ip route show | sort > $d/routes.txt; docker network ls --format '{{.Name}}' | sort > $d/networks.txt; }
invariants || { echo "ABORT: invariants failed before B2"; exit 2; }
# Preconditions that make the cleanup safe: never remove (or collide with) something we did not create.
docker network ls --format '{{.Name}}' | grep -qx $NAME && { echo "ABORT: a network named $NAME already exists; refusing (not ours)"; exit 2; }
{ ip route show; ip addr show; } | grep -q '198\.51\.100\.' && { echo "ABORT: 198.51.100.x is already in use on the host"; exit 2; }
for n in $(docker network ls -q); do docker network inspect $n --format '{{range .IPAM.Config}}{{.Subnet}}{{"\n"}}{{end}}'; done | grep -q '^198\.51\.100\.' && { echo "ABORT: subnet overlaps an existing Docker network"; exit 2; }
snap B2-before 2>/dev/null; dump before; echo "B2 create at $(date -u +%T.%N | cut -c1-12)Z"
docker network create --driver bridge --subnet $SUBNET --label ap2.owner=b2 $NAME >/dev/null || exit 2
cleanup() { [ "$(docker network inspect --format '{{index .Labels "ap2.owner"}}' $NAME 2>/dev/null)" = b2 ] && docker network rm $NAME >/dev/null 2>&1; }
trap cleanup EXIT      # installed only now, and it only ever removes a network carrying OUR label
sleep 3; snap B2-mid 2>/dev/null; dump mid
BR=br-$(docker network inspect $NAME --format '{{.Id}}' | cut -c1-12); echo "bridge: $BR"
printf '%s\n' "-A DOCKER ! -i $BR -o $BR -j DROP" "-A DOCKER-BRIDGE -o $BR -j DOCKER" "-A DOCKER-CT -o $BR -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT" "-A DOCKER-FORWARD -i $BR -j ACCEPT" | sort > $A/expected-filter-added.txt
printf '%s\n' "-A POSTROUTING -s $SUBNET ! -o $BR -j MASQUERADE" > $A/expected-nat-added.txt
gained() { diff $A/before/$1.txt $A/mid/$1.txt | grep '^>' | sed 's/^> //' | sort; }
PASS=0; FAIL=0
chk "mid: gate signature unchanged" sig_ok;  chk "mid: old layer intact" old_layer_ok
chk "mid: DOCKER-USER chain unchanged" diff -q $EV/B2-before/docker-user.sha $EV/B2-mid/docker-user.sha
chk "mid: the bridge exists and carries our label" bash -c "[ \"\$(docker network inspect --format '{{index .Labels \"ap2.owner\"}}' $NAME)\" = b2 ]"
chk "mid: filter table gained EXACTLY the 4 expected rules" bash -c "diff $A/expected-filter-added.txt <(diff $A/before/v4-filter.txt $A/mid/v4-filter.txt | grep '^>' | sed 's/^> //' | sort)"
chk "mid: nat table gained EXACTLY the MASQUERADE rule" bash -c "diff $A/expected-nat-added.txt <(diff $A/before/v4-nat.txt $A/mid/v4-nat.txt | grep '^>' | sed 's/^> //' | sort)"
chk "mid: no rule was removed in any v4 table" bash -c "for t in filter nat raw mangle; do [ -z \"\$(diff $A/before/v4-\$t.txt $A/mid/v4-\$t.txt | grep '^<')\" ] || exit 1; done"
chk "mid: raw, mangle and ip6tables unchanged" bash -c "diff -q $A/before/v4-raw.txt $A/mid/v4-raw.txt && diff -q $A/before/v4-mangle.txt $A/mid/v4-mangle.txt && diff -q $A/before/v6.txt $A/mid/v6.txt"
chk "mid: the old chains (STG-8443, STG-8443-V6) are byte-identical" bash -c "diff <(grep -F 'STG-8443' $A/before/v4-filter.txt) <(grep -F 'STG-8443' $A/mid/v4-filter.txt) && diff <(grep -F 'STG-8443-V6' $A/before/v6.txt) <(grep -F 'STG-8443-V6' $A/mid/v6.txt)"
chk "mid: bridge link and the 198.51.100.0/29 route exist" bash -c "grep -q '^$BR' $A/mid/links.txt && grep -q '^198.51.100.0/29' $A/mid/routes.txt"
docker network rm $NAME >/dev/null; sleep 3; snap B2-after 2>/dev/null; dump after; echo "B2 removed at $(date -u +%T.%N | cut -c1-12)Z"
chk "after: bridge removed" bash -c "! docker network ls --format '{{.Name}}' | grep -qx $NAME"
chk "after: every dump (filter, nat, raw, mangle, v6, links, routes, networks) identical to before" bash -c "for f in v4-filter v4-nat v4-raw v4-mangle v6 links routes networks; do diff -q $A/before/\$f.txt $A/after/\$f.txt >/dev/null || { echo differs: \$f; exit 1; }; done"
chk "after: iptables/ip6tables/other-tables/DOCKER-USER hashes identical to before" bash -c "for f in iptables.sha ip6tables.sha other-tables.sha docker-user.sha; do diff -q $EV/B2-before/\$f $EV/B2-after/\$f >/dev/null || exit 1; done"
chk "after: containers untouched (StartedAt and restart counts)" diff -q $EV/B2-before/restarts.txt $EV/B2-after/restarts.txt
B2P=$PASS; B2F=$FAIL; invariants; echo "B2: $B2P pass, $B2F fail"; [ $B2F = 0 ]
