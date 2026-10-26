#!/usr/bin/env bash
# One-time provisioning for a fresh Amazon Linux 2023 EC2 instance.
# Run as: sudo ./setup-ec2.sh
#
# Installs Node.js 20 LTS, nginx, certbot (+ nginx plugin), git, and PM2,
# then configures PM2 to relaunch the app on instance reboot under ec2-user.
#
# Does NOT open any ports — that's controlled by the EC2 Security Group in
# the AWS console/CLI. Before this instance is reachable, add inbound rules
# for TCP 80 and 443 (and 22 if not already present for SSH).

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this as root: sudo $0" >&2
  exit 1
fi

APP_USER="ec2-user"
APP_HOME="/home/${APP_USER}"

echo "==> Updating system packages"
dnf update -y

echo "==> Installing Node.js 20 LTS (NodeSource)"
curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
dnf install -y nodejs

echo "==> Installing git, nginx, python3/pip (for certbot)"
dnf install -y git nginx python3 python3-pip

echo "==> Installing certbot + nginx plugin (pip — AL2023 has no dnf package for these)"
# Don't try to upgrade pip itself — it was installed via dnf/rpm, and pip
# can't cleanly uninstall an rpm-managed package (no RECORD file), which
# aborts the whole script under set -e. --ignore-installed sidesteps the
# same conflict for any of certbot's dependencies that also came from rpm.
pip3 install --ignore-installed certbot certbot-nginx

echo "==> Installing PM2 globally"
npm install -g pm2

echo "==> Enabling nginx"
systemctl enable --now nginx

echo "==> Registering PM2 startup (relaunches PM2-managed apps on reboot)"
env PATH="$PATH:/usr/bin" pm2 startup systemd -u "${APP_USER}" --hp "${APP_HOME}" >/tmp/pm2-startup.out
# pm2 startup prints the exact systemd-enable command to run; execute it.
grep -Eo '^sudo .*$' /tmp/pm2-startup.out | bash || true

echo "==> Setting up certbot auto-renewal (daily cron, pip install has no systemd timer)"
CRON_LINE="0 3 * * * /usr/local/bin/certbot renew --quiet --deploy-hook 'systemctl reload nginx'"
( crontab -l 2>/dev/null | grep -v 'certbot renew' ; echo "$CRON_LINE" ) | crontab -

echo "==> Allowing ${APP_USER} to reload nginx without a password (deploy.sh needs this, nothing broader)"
echo "${APP_USER} ALL=(root) NOPASSWD: /usr/bin/systemctl reload nginx" > /etc/sudoers.d/japs-nginx-reload
chmod 440 /etc/sudoers.d/japs-nginx-reload
visudo -c -f /etc/sudoers.d/japs-nginx-reload

echo ""
echo "==> Provisioning complete."
echo "Next steps (as ${APP_USER}, not root):"
echo "  1. git clone <your-repo-url> ${APP_HOME}/japs"
echo "  2. Copy server/.env.production.example to ${APP_HOME}/japs/server/.env and fill in real values"
echo "  3. Run deploy/deploy.sh to install deps, build the client, and start the backend under PM2"
echo "  4. Run deploy/render-nginx-config.sh <elastic-ip> to install the Nginx config"
echo "  5. Run deploy/setup-ssl.sh <elastic-ip> to obtain the HTTPS cert"
