#!/bin/bash
# Mac side. Runs through the SINGLE multiplexed SSH connection's forward (no extra connections to port 22). usage: mac-probes.sh <seconds> <logfile>
END=$(( $(date +%s) + ${1:-600} )); LOG=${2:-$HOME/verz-ap2-mac-probes-$(date -u +%Y%m%dT%H%M%SZ).log}; : > "$LOG"
while [ $(date +%s) -lt $END ]; do
  p=$(curl -s -o /dev/null --max-time 6 -w '%{http_code}' https://verzchat.com/)
  c=$(curl -s -o /dev/null --max-time 6 -w '%{http_code}' https://staging.verzchat.com:8443/health)
  t=$(curl -s -o /dev/null --max-time 6 -w '%{http_code}' http://127.0.0.1:18080/health)
  echo "$(date -u +%T.%N | cut -c1-12) production=$p cloudflare-staging=$c tunnel-8080=$t" >> "$LOG"; sleep 1
done
awk '{for(i=2;i<=NF;i++){split($i,a,"=");n[a[1]]++; if(a[2]!="200")b[a[1]]++}} END{for(k in n)printf "%s: %d probes, %d non-200\n",k,n[k],b[k]+0}' "$LOG"
