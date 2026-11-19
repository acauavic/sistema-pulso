#!/usr/bin/env bash
# Backup diário do banco (cron da VPS: /etc/cron.d/pulso-backup, 3h30). Guarda 14 dias na VPS e manda uma cópia para o
# Backblaze (src/scripts/backupOffsite.js, que guarda 30 dias). Log: /var/log/pulso-backup.log
set -euo pipefail
cd "$(dirname "$0")"
DIR=/opt/pulso-backups
NAME="pulso-$(date +%F).sql.gz"
mkdir -p "$DIR" && chmod 700 "$DIR"
umask 077
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' | gzip > "$DIR/$NAME.tmp"
mv "$DIR/$NAME.tmp" "$DIR/$NAME"
docker compose exec -T web node src/scripts/backupOffsite.js "$NAME" < "$DIR/$NAME"
find "$DIR" -name 'pulso-*.sql.gz' -mtime +14 -delete
