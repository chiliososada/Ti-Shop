#!/bin/sh
# Nightly logical backup of the self-hosted database. Keeps 30 days locally;
# copy the directory off-box (rsync/rclone) for disaster recovery.
set -eu
PROJECT_DIR="${PROJECT_DIR:-$HOME/flintmarrow}"
BACKUP_DIR="$PROJECT_DIR/backups"
KEEP_DAYS="${KEEP_DAYS:-30}"
mkdir -p "$BACKUP_DIR"
TS="$(date +%Y%m%d_%H%M%S)"
OUT="$BACKUP_DIR/ti_shop_${TS}.dump"
cd "$PROJECT_DIR"
docker compose exec -T db pg_dump -U postgres -d ti_shop -n app -Fc > "$OUT"
gzip -f "$OUT"
find "$BACKUP_DIR" -name 'ti_shop_*.dump.gz' -mtime +"$KEEP_DAYS" -delete
echo "$(date -Iseconds): backup ok -> $(basename "$OUT").gz ($(du -h "$OUT.gz" | cut -f1))"
