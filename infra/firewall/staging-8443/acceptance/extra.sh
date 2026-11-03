# extra state capture (services, timers, tables, old-chain counters, ufw, fail2ban). usage: . lib.sh; . extra.sh; extra <label>
extra() { d=$EV/$1; mkdir -p $d
  systemctl list-units --no-legend --type=service,timer,socket,target --all | awk '{print $1,$3,$4}' | grep -v -E 'stg-ap2|run-|session-|user@|systemd-tmpfiles|apt-daily|motd|dpkg' | sort > $d/services.txt
  systemctl list-timers --all --no-legend | awk '{print $(NF-1)}' | sort > $d/timers.txt
  iptables -vnxL STG-8443 | awk 'NR>2' | sed -E 's/ +/ /g' | sed -E 's/[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+(\/[0-9]+)?/<addr>/g' > $d/old4-full.txt
  ip6tables -vnxL STG-8443-V6 | awk 'NR>2' | sed -E 's/ +/ /g' | sed -E 's/[0-9a-f:]+:[0-9a-f:]*(\/[0-9]+)?/<addr6>/g' > $d/old6-full.txt
  nft list tables | sort > $d/tables.txt; iptables -S DOCKER-USER > $d/docker-user-rules.txt
  ufw status verbose | grep -v -E '^\s*$' | md5sum > $d/ufw-full.md5
  for j in sshd nginx-botsearch nginx-http-auth nginx-limit-req; do echo $j $(fail2ban-client status $j | grep -E 'Currently banned|Total banned' | tr -s ' \t' ' ' | tr '\n' ' '); done > $d/f2b-jails.txt
  nft list table inet staging8443 > $d/gate-listing.nft; }
