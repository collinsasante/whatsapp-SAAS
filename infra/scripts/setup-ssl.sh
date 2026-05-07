#!/bin/bash
set -e

DOMAIN=${1:-"yourdomain.com"}
EMAIL=${2:-"admin@yourdomain.com"}
SSL_DIR="$(dirname "$0")/../nginx/ssl"

echo "Setting up SSL for domain: $DOMAIN"

# Install certbot if not present
if ! command -v certbot &> /dev/null; then
    apt-get update
    apt-get install -y certbot
fi

# Stop nginx temporarily if running
docker compose -f "$(dirname "$0")/../docker-compose.yml" stop nginx 2>/dev/null || true

# Obtain certificate
certbot certonly \
    --standalone \
    --non-interactive \
    --agree-tos \
    --email "$EMAIL" \
    -d "$DOMAIN" \
    -d "www.$DOMAIN"

# Copy certs to nginx ssl directory
mkdir -p "$SSL_DIR"
cp "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" "$SSL_DIR/fullchain.pem"
cp "/etc/letsencrypt/live/$DOMAIN/privkey.pem" "$SSL_DIR/privkey.pem"
chmod 644 "$SSL_DIR/fullchain.pem"
chmod 600 "$SSL_DIR/privkey.pem"

echo "SSL certificates installed successfully!"
echo "Certs location: $SSL_DIR"

# Restart nginx
docker compose -f "$(dirname "$0")/../docker-compose.yml" start nginx

echo "Nginx restarted with SSL"
