#!/usr/bin/env bash
# Nightly backup of the n8n Postgres database and n8n data volume.
# Usage (cron): 15 2 * * * /opt/loopmend/infrastructure/scripts/backup.sh
# Copy backups OFF the VM (e.g. rclone to object storage) and test restores regularly.
set -euo pipefail
cd "$(dirname "$0")/../docker"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/loopmend}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"

docker compose exec -T postgres pg_dump -U n8n -d n8n --format=custom --no-owner > "$BACKUP_DIR/n8n-db-$STAMP.dump"
docker run --rm -v loopmend-n8n_n8n_data:/data:ro -v "$BACKUP_DIR":/backup alpine:3.20 \
  tar czf "/backup/n8n-data-$STAMP.tgz" -C /data .
sha256sum "$BACKUP_DIR"/*-"$STAMP".* > "$BACKUP_DIR/SHA256SUMS-$STAMP"

find "$BACKUP_DIR" -type f -mtime +"$RETENTION_DAYS" -delete
if [ -n "${RCLONE_REMOTE:-}" ]; then rclone copy "$BACKUP_DIR" "$RCLONE_REMOTE" --include "*$STAMP*"; fi
echo "backup $STAMP complete"
