#!/usr/bin/env bash
# Restore n8n from a backup produced by backup.sh. Stops n8n during restore.
# Usage: restore.sh /var/backups/loopmend/n8n-db-<stamp>.dump /var/backups/loopmend/n8n-data-<stamp>.tgz
set -euo pipefail
DB_DUMP="${1:?db dump path}"
DATA_TGZ="${2:?data archive path}"
cd "$(dirname "$0")/../docker"
read -r -p "This overwrites the current n8n database and data. Type 'restore' to continue: " ok
[ "$ok" = "restore" ] || { echo "aborted"; exit 1; }

docker compose stop n8n
docker compose exec -T postgres pg_restore -U n8n -d n8n --clean --if-exists --no-owner < "$DB_DUMP"
docker run --rm -v loopmend-n8n_n8n_data:/data -v "$(dirname "$DATA_TGZ")":/backup alpine:3.20 \
  sh -c "rm -rf /data/* && tar xzf /backup/$(basename "$DATA_TGZ") -C /data"
docker compose start n8n
echo "restore complete — verify workflows and credentials in the editor"
