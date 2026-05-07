# WhatsApp Platform - Production Deployment Guide (Contabo VPS)

## Architecture Overview

```
Internet
    │
    ▼
[Nginx :80/:443]  ← SSL Termination, Rate Limiting
    │
    ├── / ────────────→ [Frontend :3000]  (Next.js)
    ├── /api/ ─────────→ [Backend :3001]  (NestJS)
    └── /socket.io/ ───→ [Realtime :3002] (Socket.IO)

Infrastructure:
  [PostgreSQL :5432]  ← Primary database
  [Redis :6379]       ← Cache + Queue broker
  [MinIO :9000]       ← File storage (S3-compatible)
  [Worker]            ← BullMQ campaign/automation workers
```

---

## 1. Initial Server Setup (Contabo VPS - Ubuntu 22.04)

```bash
# Update system
apt-get update && apt-get upgrade -y

# Install essentials
apt-get install -y curl git ufw htop unzip

# Configure firewall
ufw allow 22/tcp      # SSH
ufw allow 80/tcp      # HTTP
ufw allow 443/tcp     # HTTPS
ufw --force enable
ufw status
```

---

## 2. Install Docker & Docker Compose

```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Install Docker Compose plugin
apt-get install -y docker-compose-plugin

# Verify installation
docker --version
docker compose version

# Add current user to docker group (optional)
usermod -aG docker $USER
```

---

## 3. Install Node.js & pnpm (for local dev/migrations)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
npm install -g pnpm@9.1.0
```

---

## 4. Clone and Configure

```bash
# Clone repository
cd /opt
git clone https://github.com/your-org/whatsapp-platform.git
cd whatsapp-platform

# Create environment file
cp infra/.env.example infra/.env
nano infra/.env
```

### Required environment variables to configure:

| Variable | Description |
|---|---|
| `DOMAIN` | Your domain (e.g. `app.yourdomain.com`) |
| `FRONTEND_URL` | Full URL (`https://app.yourdomain.com`) |
| `PUBLIC_URL` | Same as FRONTEND_URL |
| `NEXT_PUBLIC_API_URL` | `https://app.yourdomain.com/api/v1` |
| `NEXT_PUBLIC_SOCKET_URL` | `https://app.yourdomain.com` |
| `POSTGRES_PASSWORD` | Strong PostgreSQL password |
| `REDIS_PASSWORD` | Strong Redis password |
| `JWT_SECRET` | 64+ char random string |
| `JWT_REFRESH_SECRET` | Different 64+ char random string |
| `MINIO_ACCESS_KEY` | MinIO access key |
| `MINIO_SECRET_KEY` | Strong MinIO secret key |

```bash
# Generate secure secrets
openssl rand -base64 64  # Use output for JWT_SECRET
openssl rand -base64 64  # Use output for JWT_REFRESH_SECRET
```

---

## 5. SSL Certificate Setup

```bash
# Option A: Let's Encrypt (recommended for production)
cd /opt/whatsapp-platform
bash infra/scripts/setup-ssl.sh your-domain.com your-email@example.com

# Option B: Self-signed (testing only)
mkdir -p infra/nginx/ssl
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout infra/nginx/ssl/privkey.pem \
    -out infra/nginx/ssl/fullchain.pem \
    -subj "/C=US/O=WhatsApp Platform/CN=localhost"
```

---

## 6. Deploy

```bash
cd /opt/whatsapp-platform

# Build and start all services
docker compose -f infra/docker-compose.yml up -d --build

# Watch logs during startup
docker compose -f infra/docker-compose.yml logs -f

# Check all containers are healthy
docker compose -f infra/docker-compose.yml ps
```

### Expected container status after ~2 minutes:
```
wa_postgres   → healthy
wa_redis      → healthy
wa_minio      → healthy
wa_backend    → running (migrations auto-applied)
wa_realtime   → running
wa_worker     → running
wa_frontend   → running
wa_nginx      → running
```

---

## 7. Verify Deployment

```bash
# Check API health
curl https://your-domain.com/api/v1/health

# Check Nginx
curl -I https://your-domain.com

# Check backend logs
docker logs wa_backend --tail 50

# Check worker logs
docker logs wa_worker --tail 50
```

---

## 8. WhatsApp Business API Configuration

1. **Log in** to your platform at `https://your-domain.com`
2. **Create workspace** via `/register`
3. Navigate to **Settings**
4. Enter your WhatsApp Business API credentials:
   - **Phone Number ID** (from Meta Developer Dashboard)
   - **WABA ID** (WhatsApp Business Account ID)
   - **Permanent Access Token**
5. Copy the **Webhook URL** shown in settings
6. In Meta Developer Dashboard → WhatsApp → Configuration:
   - Set Webhook URL: `https://your-domain.com/api/v1/webhook/whatsapp/{your-workspace-slug}`
   - Set Verify Token: (shown in settings page)
   - Subscribe to: `messages`, `message_status`

---

## 9. Configure Automated Backups

```bash
# Make backup script executable
chmod +x /opt/whatsapp-platform/infra/scripts/backup.sh

# Add to crontab (runs daily at 2 AM)
crontab -e
# Add this line:
0 2 * * * /opt/whatsapp-platform/infra/scripts/backup.sh >> /var/log/wa-platform-backup.log 2>&1
```

---

## 10. SSL Certificate Auto-Renewal

```bash
# Test renewal (dry run)
certbot renew --dry-run

# Add to crontab (checks twice daily, renews if expiring)
crontab -e
# Add this line:
0 0,12 * * * certbot renew --quiet && \
    cp /etc/letsencrypt/live/YOUR_DOMAIN/fullchain.pem /opt/whatsapp-platform/infra/nginx/ssl/fullchain.pem && \
    cp /etc/letsencrypt/live/YOUR_DOMAIN/privkey.pem /opt/whatsapp-platform/infra/nginx/ssl/privkey.pem && \
    docker exec wa_nginx nginx -s reload
```

---

## Common Operations

### Update the Platform
```bash
cd /opt/whatsapp-platform
git pull origin main
docker compose -f infra/docker-compose.yml up -d --build
```

### View Logs
```bash
# All services
docker compose -f infra/docker-compose.yml logs -f

# Specific service
docker logs wa_backend -f
docker logs wa_worker -f
docker logs wa_realtime -f
```

### Database Access
```bash
# Connect to PostgreSQL
docker exec -it wa_postgres psql -U waplatform waplatform

# Run Prisma Studio (port forward required)
docker exec -it wa_backend npx prisma studio
```

### Scale Workers
```bash
# Add more worker instances
docker compose -f infra/docker-compose.yml up -d --scale worker=3
```

### Redis CLI
```bash
docker exec -it wa_redis redis-cli -a $REDIS_PASSWORD
```

---

## Troubleshooting

### Backend won't start
```bash
docker logs wa_backend
# Common: DATABASE_URL incorrect, postgres not ready
```

### WebSocket connections failing
```bash
# Verify nginx config has websocket upgrade headers
docker exec wa_nginx nginx -t
# Check realtime service
docker logs wa_realtime
```

### Campaign messages not sending
```bash
# Check worker is running
docker logs wa_worker
# Check Redis queues
docker exec -it wa_redis redis-cli -a $REDIS_PASSWORD KEYS "bull:*"
```

### Out of disk space
```bash
# Check Docker disk usage
docker system df
# Clean unused images
docker system prune -f
```

---

## Resource Requirements

| Config | RAM | CPU | Storage |
|---|---|---|---|
| Minimum | 2 GB | 2 vCPU | 40 GB |
| Recommended | 4 GB | 4 vCPU | 80 GB |
| High Volume | 8 GB | 8 vCPU | 200 GB |

**Contabo recommended plan:** VPS S (4 GB RAM, 4 vCPU, 100 GB SSD)
