#!/usr/bin/env bash
set -euo pipefail

DATABASE_URL="${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/openclaw}"
STAMP="$(date +%Y%m%d-%H%M%S)"
TARGET="${BACKUP_DIR}/openclaw-${STAMP}.dump"

mkdir -p "${BACKUP_DIR}"
pg_dump --format=custom --dbname "${DATABASE_URL}" --file "${TARGET}"
echo "Created backup at ${TARGET}"
