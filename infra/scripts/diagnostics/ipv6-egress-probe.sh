#!/bin/bash
# Read-only diagnostic: separates DNS, TCP connect, TLS and ICMP behaviour of the VPS's OUTBOUND connections to a Cloudflare-proxied hostname over IPv6 and IPv4.
# It changes no configuration and sends only ordinary requests (one small GET per probe) to the hostname under test. Pair it with a header-only packet ring buffer (see docs/VPS_IPV6_EGRESS_INVESTIGATION.md).
#   usage: ipv6-egress-probe.sh <outdir> <duration_seconds> [interval_seconds] [hostname] [port] [path]
#   v6-cf-other / v6-non-cf   curl -6 to another Cloudflare address (1.1.1.1's IPv6, no staging hostname) and to a non-Cloudflare IPv6 host
# Per cycle, one line per probe in <outdir>/probes.log:   <epoch> <utc> <kind> key=value ...
#   dns-stub / dns-up1 / dns-up2   AAAA lookup through the local stub resolver and straight to each upstream resolver (ms, status)
#   v6-name   curl -6 by hostname (system resolution)      v6-pin   curl -6 to the pinned address (NO DNS involved)     v4-name  curl -4 by hostname
#   icmp6-edge / icmp6-gw / icmp4-edge   single echo (loss and rtt)
# A cycle with any phase slower than SLOW seconds or any failure also writes <outdir>/anomalies.log (resolver statistics, neighbour and route state, TCP retransmission counters).
set -uo pipefail
OUT=${1:?outdir}; DUR=${2:?seconds}; INT=${3:-15}; HOST=${4:-staging.verzchat.com}; PORT=${5:-8443}; PATHQ=${6:-/health}; SLOW=${SLOW:-1.0}
umask 077; mkdir -p "$OUT"; L=$OUT/probes.log; A=$OUT/anomalies.log; : >> "$L"; : >> "$A"
END=$(( $(date +%s) + DUR ))
EDGE6=$(getent ahostsv6 "$HOST" | awk 'NR==1{print $1}'); EDGE4=$(getent ahostsv4 "$HOST" | awk 'NR==1{print $1}')
GW6=$(ip -6 route show default | awk '/via/{print $3; exit}'); IFACE=$(ip -6 route show default | awk '/dev/{for(i=1;i<=NF;i++) if($i=="dev"){print $(i+1); exit}}')
UPS=$(resolvectl status 2>/dev/null | awk '/Current DNS Server:/{print $4; exit}'); UPS2=$(resolvectl status 2>/dev/null | awk '/DNS Servers:/{print $4 " " $3}' | tr ' ' '\n' | grep -v '^$' | sort -u | head -2 | tr '\n' ' ')
{ echo "# start $(date -u +%FT%TZ) host=$HOST:$PORT edge6=$EDGE6 edge4=$EDGE4 iface=$IFACE gw6=$GW6 resolvers=$UPS2"; uname -r; curl --version | head -1; } >> "$L"
now() { printf '%s %s' "$(date +%s.%N | cut -c1-14)" "$(date -u +%T.%3N)"; }
CW='code=%{http_code} dns=%{time_namelookup} conn=%{time_connect} tls=%{time_appconnect} ttfb=%{time_starttransfer} total=%{time_total} exit=%{exitcode} rip=%{remote_ip} err=%{errormsg}'
dnsq() { # dnsq <kind> <server> <type>
  o=$(dig +tries=1 +time=8 +noall +comments +stats "$3" "$HOST" ${2:+@$2} 2>&1); ms=$(echo "$o" | awk '/Query time:/{print $4}'); st=$(echo "$o" | grep -o 'status: [A-Z]*' | head -1 | cut -d' ' -f2)
  echo "$(now) $1 type=$3 ms=${ms:-timeout} status=${st:-none}"; }
cur() { # cur <kind> <curl args...>
  k=$1; shift; r=$(curl -sk --max-time 15 -o /dev/null -w "$CW" "$@" 2>&1 | tr '\n' ' '); echo "$(now) $k $r"; }
CYC=0
while [ "$(date +%s)" -lt "$END" ]; do
  CYC=$((CYC+1))
  c0=$(nstat -az TcpRetransSegs TcpExtTCPSynRetrans 2>/dev/null | awk 'NR>1{printf "%s=%s ",$1,$2}')
  cyc=$(
    dnsq dns-stub 127.0.0.53 AAAA
    for s in $UPS2; do dnsq dns-up "$s" AAAA; done
    # the order of the three HTTP probes rotates every cycle so that "first connection after the pause" can be told apart from "by hostname" / "IPv6"
    ORDERS=("1 2 3" "2 3 1" "3 1 2")
    for k in ${ORDERS[$((CYC % 3))]}; do
      if [ "$k" = 1 ]; then cur v6-name -6 "https://$HOST:$PORT$PATHQ"; fi
      if [ "$k" = 2 ]; then cur v6-pin -6 --resolve "$HOST:$PORT:[$EDGE6]" "https://$HOST:$PORT$PATHQ"; fi
      if [ "$k" = 3 ]; then cur v4-name -4 "https://$HOST:$PORT$PATHQ"; fi
    done
    # destinations that are NOT the hostname under test: a different Cloudflare edge address (no DNS) and a non-Cloudflare IPv6 host. If these stall in the same cycles, the stall is on the VPS's IPv6 path, not in the hostname, the origin or Cloudflare's handling of it.
    cur v6-cf-other -6 "https://[2606:4700:4700::1111]/"
    cur v6-non-cf -6 "https://ipv6.google.com/"
    p=$(ping -6 -c1 -W2 "$EDGE6" 2>&1 | awk '/time=/{sub(/.*time=/,"");print $1} /100% packet loss/{print "LOSS"}' | head -1); echo "$(now) icmp6-edge rtt_ms=${p:-LOSS}"
    p=$(ping -6 -c1 -W2 -I "$IFACE" "$GW6" 2>&1 | awk '/time=/{sub(/.*time=/,"");print $1} /100% packet loss/{print "LOSS"}' | head -1); echo "$(now) icmp6-gw rtt_ms=${p:-LOSS}"
    p=$(ping -4 -c1 -W2 "$EDGE4" 2>&1 | awk '/time=/{sub(/.*time=/,"");print $1} /100% packet loss/{print "LOSS"}' | head -1); echo "$(now) icmp4-edge rtt_ms=${p:-LOSS}"
  )
  c1=$(nstat -az TcpRetransSegs TcpExtTCPSynRetrans 2>/dev/null | awk 'NR>1{printf "%s=%s ",$1,$2}')
  echo "# cycle $CYC order=$((CYC % 3))" >> "$L"; echo "$cyc" >> "$L"; echo "$(now) tcp-counters before: $c0| after: $c1" >> "$L"
  # (the default gateway never answers ICMP echo: its 100% loss is a baseline, so icmp6-gw is NOT an anomaly trigger)
  # anomaly: a curl/dig phase above SLOW seconds (or timeout), a curl exit code other than 0, an HTTP code other than 200, or a lost ping
  if echo "$cyc" | awk -v s="$SLOW" '/ v[46]-(name|pin) /{ for(i=1;i<=NF;i++){split($i,a,"="); if(a[1]=="dns"||a[1]=="conn"||a[1]=="tls"){ if(a[2]+0>s) bad=1 } if(a[1]=="exit"&&a[2]!="0") bad=1; if(a[1]=="code"&&a[2]!="200") bad=1 } } / dns-(stub|up) /{ for(i=1;i<=NF;i++){split($i,a,"="); if(a[1]=="ms"&&(a[2]=="timeout"||a[2]+0>s*1000)) bad=1} } /icmp6-edge .*LOSS|icmp4-edge .*LOSS/{bad=1} END{exit bad?0:1}'; then
    { echo "=== anomaly $(now)"; echo "$cyc" | grep -E 'exit=[1-9]|code=[^2]|conn=[1-9]|dns=[1-9]|tls=[1-9]|LOSS|ms=timeout|ms=[0-9]{4,}' | cut -c1-300
      echo "-- resolvectl statistics"; resolvectl statistics 2>/dev/null | sed -n '1,20p'
      echo "-- ip -6 neigh (default gw and edge route; lladdr shown)"; ip -6 neigh show dev "$IFACE" 2>/dev/null | head -5; ip -6 route get "$EDGE6" 2>/dev/null | head -2
      echo "-- tcp counters"; nstat -az TcpRetransSegs TcpExtTCPSynRetrans TcpExtTCPTimeouts TcpAttemptFails Ip6OutNoRoutes Ip6InDiscards Ip6OutDiscards 2>/dev/null | awk 'NR>1'; } >> "$A" 2>&1
  fi
  sleep "$INT"
done
echo "# end $(date -u +%FT%TZ)" >> "$L"
