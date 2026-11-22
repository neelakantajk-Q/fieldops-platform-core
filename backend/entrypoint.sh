#!/bin/sh
# Render free demo entrypoint.
#
# Render free services have an EPHEMERAL disk: everything outside a persistent
# disk is lost on spin-down/restart/redeploy. This script restores the latest
# Google Drive backup (created by pb_hooks/api_drive_backup.pb.js) before
# PocketBase starts, so captured demo data survives.
#
# Env:
#   BACKUP_WEBAPP_URL    Google Apps Script Web App URL (defaults to the
#                        existing clasp Web App deployment)
#   BACKUP_WEBAPP_TOKEN  shared secret for the Web App (optional)
#   PB_ADMIN_EMAIL       superuser email (created/updated below)
#   PB_ADMIN_PASSWORD    superuser password
#   PORT                 PocketBase port (Render injects this)

set -e

if [ -d /data ]; then
  DB=/data/pb_data
else
  DB=/pb/pb_data
fi
mkdir -p "$DB"

# 1. Restore the latest backup from Google Drive (if any).
# Default to the existing clasp Web App deployment used by the Drive backup.
: "${BACKUP_WEBAPP_URL:=https://script.google.com/macros/s/AKfycbw8lUdJIdrlqEPAuoyZ4p2-p5UyB2YNnWXLp7KEMyNd9uTp8nJZpPl8DXbahRzshU3IHw/exec}"

if [ -n "$BACKUP_WEBAPP_URL" ]; then
  B64="$(wget -qO- -T 30 "$BACKUP_WEBAPP_URL?action=latest&token=$BACKUP_WEBAPP_TOKEN&ts=$(date +%s)" 2>/dev/null | tr -d '[:space:]' || true)"
  if [ -n "$B64" ] && [ "$B64" != "NONE" ]; then
    if printf '%s' "$B64" | base64 -d > /tmp/fieldops_backup.zip 2>/dev/null && [ -s /tmp/fieldops_backup.zip ]; then
      unzip -o -q /tmp/fieldops_backup.zip -d "$DB"
      echo "fieldops: restored backup from Google Drive"
    else
      echo "fieldops: backup found but could not be decoded; starting fresh"
    fi
  fi
fi

# 2. Apply migrations (idempotent) and make sure the superuser exists.
pocketbase migrate up --dir="$DB" --migrationsDir=/pb/pb_migrations

if [ -n "$PB_ADMIN_EMAIL" ] && [ -n "$PB_ADMIN_PASSWORD" ]; then
  pocketbase admin create "$PB_ADMIN_EMAIL" "$PB_ADMIN_PASSWORD" --dir="$DB" 2>/dev/null || true
  pocketbase admin update "$PB_ADMIN_EMAIL" "$PB_ADMIN_PASSWORD" --dir="$DB" 2>/dev/null || true
fi

# 3. Serve.
exec pocketbase serve --http=0.0.0.0:"${PORT:-7860}" --dir="$DB" \
  --publicDir=/pb/pb_public --migrationsDir=/pb/pb_migrations --hooksDir=/pb/pb_hooks
