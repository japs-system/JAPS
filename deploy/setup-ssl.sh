#!/usr/bin/env bash
# Obtains a real Let's Encrypt cert for the free sslip.io hostname derived
# from your Elastic IP, and wires it into the nginx config certbot's nginx
# plugin edits in place (adds the 443 server block + cert paths + the
# 80->443 redirect).
#
# Run once, as root, AFTER render-nginx-config.sh has installed the
# HTTP-only config and nginx is serving it successfully:
#   sudo ./setup-ssl.sh <elastic-ip> <your-email>
#
# Example: sudo ./setup-ssl.sh 3.25.100.42 you@example.com

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this as root: sudo $0 <elastic-ip> <your-email>" >&2
  exit 1
fi

IP="${1:?Usage: $0 <elastic-ip> <your-email>}"
EMAIL="${2:?Usage: $0 <elastic-ip> <your-email>}"
DOMAIN="$(echo "$IP" | tr '.' '-').sslip.io"

echo "==> Requesting a Let's Encrypt cert for ${DOMAIN}"
certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos -m "${EMAIL}" --redirect

echo ""
echo "==> Done. Your site is now available at: https://${DOMAIN}"
echo "Update server/.env's CLIENT_URL to https://${DOMAIN} and restart the backend (pm2 restart japs-server) if you haven't already."
echo "Renewal is handled by the cron job setup-ec2.sh installed (daily, auto-reloads nginx)."
