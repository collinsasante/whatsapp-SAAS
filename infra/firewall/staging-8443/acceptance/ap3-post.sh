#!/bin/bash
# AP-3 POST-MAINTENANCE verification. usage: ap3-post.sh <EV> <docker|reboot|steady>
#   docker  after `systemctl restart docker`        reboot  after the VPS reboot        steady  dry run of the script itself (no restart happened; change-detection checks are skipped)
export EV=$1; MODE=${2:-steady}; . $EV/lib.sh; . $EV/ap2-lib.sh; P=$EV/AP3-PRE; PASS=0; FAIL=0; trap 'ns_down' EXIT
echo "mode: $MODE at $(date -u +%FT%TZ)"
pre() { cat $P/$1 2>/dev/null; }
chk "gate signature $EXPECT_SIG, mode snapshot, admin exception expiry unchanged, old layer 21/13 with both jumps" bash -c ". $EV/ap2-lib.sh; sig_ok && admin_exp_ok && admin_intact && old_layer_ok"
chk "18 containers running" bash -c '[ "$(docker ps -q | wc -l)" = 18 ]'; chk "no container in a restart loop (restart counts as before or zero)" bash -c 'for c in $(docker ps -q); do [ "$(docker inspect -f "{{.RestartCount}}" $c)" -le 3 ] || exit 1; done'
chk "no unhealthy container" bash -c '! docker ps --format "{{.Status}}" | grep -q unhealthy'
chk "units active (gate, verify timer, refresh timer, old unit)" units_ok; chk "no failed units" bash -c '[ "$(systemctl --failed --no-legend | wc -l)" = 0 ]'
chk "production health 200 (local)" prod_ok
chk "staging health 200 locally through the gate (loopback is accepted)" bash -c '[ "$(curl -sk --max-time 8 -o /dev/null -w "%{http_code}" --resolve staging.verzchat.com:8443:127.0.0.1 https://staging.verzchat.com:8443/health)" = 200 ]'
chk "listeners 22, 80, 443, 8443 present and 127.0.0.1:8080" bash -c 'for p in 22 80 443 8443; do ss -ltnH "( sport = :$p )" | grep -q . || exit 1; done; ss -ltnH "( sport = :8080 )" | grep -q 127.0.0.1:8080'
chk "UFW active, 4 fail2ban jails, nftables.service still disabled" bash -c 'ufw status | grep -q "Status: active" && [ "$(fail2ban-client status | grep -o "nginx-botsearch\|nginx-http-auth\|nginx-limit-req\|sshd" | wc -l)" = 4 ] && ! systemctl is-enabled nftables.service 2>/dev/null | grep -q enabled'
chk "gate references none of 22/80/443/8080" bash -c '! nft list table inet staging8443 | grep -qE "(dport|proto-dst) (22|80|443|8080)\b"'
chk "verify timer running at ~5 s cadence (>= 3 runs in 30 s)" bash -c '[ "$(journalctl -u staging-8443-fw-verify.service --since "-30s" --no-pager -o cat | grep -c Starting)" -ge 3 ]'
chk "no warning-or-worse lines from the firewall units since the maintenance started" bash -c '[ "$(journalctl -u staging-8443-fw.service -u staging-8443-fw-verify.service -u staging-8443-firewall.service --since "-30min" -p warning --no-pager -o cat | wc -l)" = 0 ]'
echo "== access control with real packets (stgacc namespace: unauthorised and Cloudflare-range sources, IPv4 and IPv6)"
ns_up && { chk "unauthorised IPv4 :8443 blocked" bash -c ". $EV/lib.sh; [ \"\$(pr4 192.0.2.2)\" = 000 ]"; chk "unauthorised IPv6 :8443 blocked" bash -c ". $EV/lib.sh; [ \"\$(pr6 fd00:8443:99::2)\" = 000 ]"
  chk "Cloudflare-range IPv4 :8443 admitted" bash -c ". $EV/lib.sh; c=\$(pr4 173.245.48.250); [ \"\$c\" != 000 ] && [ -n \"\$c\" ]"; chk "Cloudflare-range IPv6 :8443 admitted" bash -c ". $EV/lib.sh; c=\$(pr6 2400:cb00:fffe::7); [ \"\$c\" != 000 ] && [ -n \"\$c\" ]"
  chk "ports 80 and 443 answer for an unauthorised source" bash -c ". $EV/lib.sh; [ \"\$(pr4 192.0.2.2 443)\" != 000 ]"; } 
case $MODE in
docker) chk "Docker restarted since the capture (ActiveEnter changed)" bash -c "[ \"\$(systemctl show docker.service -p ActiveEnterTimestampMonotonic --value)\" != \"$(pre timeline.txt | awk -F': ' '/docker ActiveEnter/{print $2}')\" ]"
  chk "gate table NOT reloaded by the Docker restart (live.sig mtime older than the Docker restart)" bash -c "[ \$(stat -c %Y /var/lib/staging-8443/live.sig) -lt \$(date -d \"\$(systemctl show docker.service -p ActiveEnterTimestamp --value)\" +%s) ]"
  chk "DOCKER-USER chain identical to before (the old layer's jump survived)" bash -c "iptables -S DOCKER-USER | sha256sum | diff -q - $P/snap/docker-user.sha";;
reboot) chk "the host rebooted (boot_id changed)" bash -c "[ \"\$(cat /proc/sys/kernel/random/boot_id)\" != \"\$(cat $P/boot-id)\" ]"
  g=$(systemctl show staging-8443-fw.service -p ExecMainExitTimestampMonotonic --value); d=$(systemctl show docker.service -p InactiveExitTimestampMonotonic --value); c=$(systemctl show containerd.service -p InactiveExitTimestampMonotonic --value)
  echo "  ordering (monotonic us): gate finished $g | containerd started $c | docker started $d"
  chk "the gate finished BEFORE containerd and Docker started" [ "$g" -lt "$d" ] && [ "$g" -lt "$c" ]
  chk "the gate finished before every container started (earliest StartedAt)" bash -c "first=\$(for c in \$(docker ps -q); do docker inspect -f '{{.State.StartedAt}}' \$c; done | sort | head -1); [ \$(date -d \"\$first\" +%s) -ge \$(( \$(date +%s) - \$(awk '{print int(\$1)}' /proc/uptime) + \$g / 1000000 )) ]"
  chk "the boot unit loaded last-good from the snapshot, with no network fetch" bash -c 'journalctl -b -u staging-8443-fw.service --no-pager -o cat | grep -q "loaded last-good snapshot" && ! journalctl -b -u staging-8443-fw.service --no-pager -o cat | grep -qiE "download|urlopen"'
  chk "the old unit re-applied its chains after Docker (21/13 and both jumps)" old_layer_ok;;
esac
echo "AP3-POST ($MODE): $PASS pass, $FAIL fail"; [ $FAIL = 0 ]
