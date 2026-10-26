#!/usr/bin/env bash
# Repeatable deploy — run as ec2-user (NOT root) from anywhere, e.g.:
#   ~/japs/deploy/deploy.sh
#
# Pulls the latest code, installs deps, builds the Angular client, and
# (re)starts the backend under PM2 with zero-downtime reload.

set -euo pipefail

if [ "$(id -u)" -eq 0 ]; then
  echo "Run this as ec2-user, not root (PM2 processes should run as your app user)." >&2
  exit 1
fi

BRANCH="${1:-main}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${APP_DIR}"

echo "==> Pulling latest (${BRANCH})"
git fetch origin "${BRANCH}"
git checkout "${BRANCH}"
git pull origin "${BRANCH}"

echo "==> Installing server deps"
cd "${APP_DIR}/server"
npm install --omit=dev

if [ ! -f .env ]; then
  echo "!! server/.env is missing. Copy server/.env.production.example to server/.env and fill it in before continuing." >&2
  exit 1
fi

echo "==> Installing client deps and building (production)"
cd "${APP_DIR}/client"
# npm install, not ci: the lockfile is committed from a Windows dev machine,
# and npm ci's strict lockfile match can fail on Linux for platform-specific
# optional native deps (e.g. lightningcss's @emnapi/* WASM runtime shims)
# even though the lockfile is otherwise valid.
npm install
npm run build -- --configuration=production

echo "==> Starting/reloading backend under PM2"
cd "${APP_DIR}/server"
pm2 startOrReload ecosystem.config.js --env production
pm2 save

echo "==> Reloading nginx (picks up the freshly built client files)"
sudo systemctl reload nginx

echo ""
echo "==> Deploy complete."
pm2 status japs-server
