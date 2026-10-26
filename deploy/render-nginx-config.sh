#!/usr/bin/env bash
# Substitutes the placeholders in nginx.japs.conf and installs it.
# Run as: sudo ./render-nginx-config.sh <elastic-ip> [app-dir]
#
# Example: sudo ./render-nginx-config.sh 3.25.100.42 /home/ec2-user/japs

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this as root: sudo $0 <elastic-ip> [app-dir]" >&2
  exit 1
fi

IP="${1:?Usage: $0 <elastic-ip> [app-dir]}"
APP_DIR="${2:-/home/ec2-user/japs}"
DOMAIN="$(echo "$IP" | tr '.' '-').sslip.io"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Rendering nginx config for ${DOMAIN} (app dir: ${APP_DIR})"
sed -e "s|__SSLIP_DOMAIN__|${DOMAIN}|g" -e "s|__APP_DIR__|${APP_DIR}|g" \
  "${SCRIPT_DIR}/nginx.japs.conf" > /etc/nginx/conf.d/japs.conf

echo "==> Testing nginx config"
nginx -t

echo "==> Reloading nginx"
systemctl reload nginx

echo ""
echo "==> Done. Site is live over HTTP at: http://${DOMAIN}"
echo "Run setup-ssl.sh ${IP} next to get a real HTTPS cert."
