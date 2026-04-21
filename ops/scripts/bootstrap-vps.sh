#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/openclaw/erg2}"
APP_USER="${APP_USER:-openclaw}"

sudo apt-get update
sudo apt-get install -y nginx postgresql postgresql-client certbot python3-certbot-nginx

if ! id "${APP_USER}" >/dev/null 2>&1; then
  sudo useradd --system --home /opt/openclaw --shell /usr/sbin/nologin "${APP_USER}"
fi

sudo mkdir -p /etc/openclaw /var/backups/openclaw
sudo chown -R "${APP_USER}:${APP_USER}" /etc/openclaw /var/backups/openclaw

cd "${REPO_DIR}"
npm ci
npm run build

echo "Bootstrap complete. Install the nginx and systemd templates from ops/ before enabling services."
