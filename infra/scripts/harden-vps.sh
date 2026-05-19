#!/bin/bash
# VPS hardening: UFW firewall, fail2ban, unattended security upgrades, backup cron.
# Run ONCE on a fresh or existing VPS: bash infra/scripts/harden-vps.sh
# Idempotent — safe to re-run.
set -euo pipefail

log() { echo "[$(date '+%H:%M:%S')] $*"; }

# ── 1. UFW Firewall ───────────────────────────────────────────────────────────

log "Configuring UFW..."
apt-get install -y ufw > /dev/null 2>&1

ufw --force reset

# Default policy: deny all inbound, allow all outbound
ufw default deny incoming
ufw default allow outgoing

# Allow SSH (critical — must be first)
ufw allow 22/tcp comment "SSH"

# Allow HTTP + HTTPS
ufw allow 80/tcp  comment "HTTP"
ufw allow 443/tcp comment "HTTPS"

# Block MinIO console from the internet (internal only via Docker network)
ufw deny 9000/tcp comment "Block MinIO API from internet"
ufw deny 9001/tcp comment "Block MinIO console from internet"

# Rate-limit SSH to slow brute-force
ufw limit 22/tcp comment "SSH rate-limit"

ufw --force enable
log "UFW enabled. Status:"
ufw status verbose

# ── 2. Fail2ban ───────────────────────────────────────────────────────────────

log "Installing and configuring fail2ban..."
apt-get install -y fail2ban > /dev/null 2>&1

cat > /etc/fail2ban/jail.d/verzchat.conf << 'EOF'
[DEFAULT]
bantime  = 3600
findtime = 600
maxretry = 5
backend  = systemd

[sshd]
enabled  = true
port     = ssh
maxretry = 4
bantime  = 86400

[nginx-http-auth]
enabled  = true
filter   = nginx-http-auth
logpath  = /var/log/nginx/error.log
maxretry = 5

[nginx-limit-req]
enabled  = true
filter   = nginx-limit-req
logpath  = /var/log/nginx/error.log
maxretry = 10
bantime  = 600

[nginx-botsearch]
enabled  = true
filter   = nginx-botsearch
logpath  = /var/log/nginx/access.log
maxretry = 2
bantime  = 86400
EOF

systemctl enable fail2ban
systemctl restart fail2ban
log "fail2ban running. Jails active:"
fail2ban-client status 2>/dev/null || true

# ── 3. Unattended security upgrades ──────────────────────────────────────────

log "Setting up unattended security upgrades..."
apt-get install -y unattended-upgrades > /dev/null 2>&1

cat > /etc/apt/apt.conf.d/20auto-upgrades << 'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF

cat > /etc/apt/apt.conf.d/50unattended-upgrades << 'EOF'
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}-security";
};
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Mail "support@verzchat.com";
EOF

log "Unattended security upgrades enabled."

# ── 4. Install rclone for remote backups ──────────────────────────────────────

if ! command -v rclone &>/dev/null; then
  log "Installing rclone..."
  curl -fsSL https://rclone.org/install.sh | bash > /dev/null 2>&1
  log "rclone installed. Run 'rclone config' to add a Backblaze B2 remote named 'b2'."
else
  log "rclone already installed: $(rclone --version | head -1)"
fi

# ── 5. Backup cron ────────────────────────────────────────────────────────────

CRON_LINE="0 2 * * * root bash /root/whatsapp-platform/infra/scripts/backup.sh >> /var/log/verzchat-backup.log 2>&1"
CRON_FILE="/etc/cron.d/verzchat-backup"

if [[ ! -f "$CRON_FILE" ]] || ! grep -qF "backup.sh" "$CRON_FILE"; then
  echo "$CRON_LINE" > "$CRON_FILE"
  chmod 644 "$CRON_FILE"
  log "Backup cron installed: $CRON_FILE"
else
  log "Backup cron already exists."
fi

# ── 6. SSL certificate auto-renew cron ───────────────────────────────────────

RENEW_FILE="/etc/cron.d/verzchat-ssl-renew"
RENEW_LINE="0 3 * * * root certbot renew --quiet --post-hook 'docker exec wa_nginx nginx -s reload'"

if [[ ! -f "$RENEW_FILE" ]]; then
  echo "$RENEW_LINE" > "$RENEW_FILE"
  chmod 644 "$RENEW_FILE"
  log "SSL auto-renew cron installed."
else
  log "SSL auto-renew cron already exists."
fi

# ── 7. Health-monitor cron ────────────────────────────────────────────────────
# Pings the health endpoint every 5 minutes; emails on failure

MONITOR_FILE="/etc/cron.d/verzchat-health"
cat > "$MONITOR_FILE" << 'CRONEOF'
*/5 * * * * root /usr/local/bin/verzchat-healthcheck.sh >> /var/log/verzchat-health.log 2>&1
CRONEOF
chmod 644 "$MONITOR_FILE"

cat > /usr/local/bin/verzchat-healthcheck.sh << 'SCRIPTEOF'
#!/bin/bash
ENDPOINT="https://verzchat.com/api/v1/health"
ALERT_EMAIL="support@verzchat.com"
LOCK_FILE="/tmp/verzchat-health-down"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

STATUS=$(curl -sf --max-time 10 --retry 2 "$ENDPOINT" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status',''))" 2>/dev/null || echo "unreachable")

if [[ "$STATUS" != "ok" ]]; then
  if [[ ! -f "$LOCK_FILE" ]]; then
    touch "$LOCK_FILE"
    echo "[$TIMESTAMP] ALERT: Health check failed ($STATUS)" >&2
    if command -v mail &>/dev/null; then
      echo "VerzChat health check failed at $TIMESTAMP. Status: $STATUS. Check https://verzchat.com" \
        | mail -s "[VerzChat ALERT] Production down" "$ALERT_EMAIL"
    fi
  fi
else
  if [[ -f "$LOCK_FILE" ]]; then
    rm -f "$LOCK_FILE"
    echo "[$TIMESTAMP] RECOVERED: Health check passed"
    if command -v mail &>/dev/null; then
      echo "VerzChat is back online at $TIMESTAMP." \
        | mail -s "[VerzChat RECOVERED] Production back up" "$ALERT_EMAIL"
    fi
  fi
fi
SCRIPTEOF
chmod +x /usr/local/bin/verzchat-healthcheck.sh

log "Health-monitor cron installed (every 5 min)."

# ── 8. Kernel hardening via sysctl ───────────────────────────────────────────

cat > /etc/sysctl.d/99-verzchat-hardening.conf << 'EOF'
# Disable IP forwarding (not a router)
net.ipv4.ip_forward = 0

# SYN flood protection
net.ipv4.tcp_syncookies = 1
net.ipv4.tcp_max_syn_backlog = 2048
net.ipv4.tcp_synack_retries = 2

# Ignore ICMP redirects
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0

# Ignore source-routed packets
net.ipv4.conf.all.accept_source_route = 0

# Log suspicious packets
net.ipv4.conf.all.log_martians = 1

# Increase file descriptor limit for high concurrency
fs.file-max = 100000
EOF

sysctl --system > /dev/null 2>&1
log "Kernel hardening applied."

log "=== VPS hardening complete ==="
log ""
log "NEXT STEPS:"
log "  1. Run 'rclone config' to add a Backblaze B2 remote named 'b2'"
log "     (https://rclone.org/b2/ — create a B2 bucket: verzchat-backups)"
log "  2. Add B2_BUCKET=verzchat-backups to infra/.env"
log "  3. Test backup: bash /root/whatsapp-platform/infra/scripts/backup.sh"
log "  4. Install mailutils if alerts are needed: apt-get install -y mailutils"
log "  5. Add SENTRY_DSN to infra/.env and redeploy (see docs below)"
