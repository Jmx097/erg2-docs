#!/usr/bin/env bash
set -euo pipefail

DATABASE_URL="${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_FILE="${1:?Usage: restore-postgres.sh <backup-file>}"

pg_restore --clean --if-exists --no-owner --dbname "${DATABASE_URL}" "${BACKUP_FILE}"
echo "Restored ${BACKUP_FILE}"
