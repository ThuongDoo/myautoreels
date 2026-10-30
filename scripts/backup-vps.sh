#!/usr/bin/env bash
# Daily backup on the VPS (cron, 3am): snapshot the database, pack it with avatars and .env,
# keep the last KEEP_LOCAL archives locally and upload to Google Drive with rclone.
# Install: cp scripts/backup-vps.sh /usr/local/bin/autoreels-backup && chmod +x it, then crontab:
#   0 3 * * * /usr/local/bin/autoreels-backup >> /var/log/autoreels-backup.log 2>&1
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/autoreels}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/autoreels}"
REMOTE="${REMOTE:-gdrive:AutoReels-backup}"
KEEP_LOCAL="${KEEP_LOCAL:-7}"
KEEP_REMOTE_DAYS="${KEEP_REMOTE_DAYS:-30}"

stamp="$(date +%Y%m%d-%H%M)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$BACKUP_DIR"

echo "[$(date '+%F %T')] backup $stamp"
# VACUUM INTO gives a consistent copy while the app keeps writing.
cd "$APP_DIR"
node --disable-warning=ExperimentalWarning -e "
  new (require('node:sqlite').DatabaseSync)('data/app.db').exec(\"VACUUM INTO '$work/app.db'\")
"
cp .env "$work/env" 2>/dev/null || true
archive="$BACKUP_DIR/autoreels-$stamp.tar.gz"
tar -czf "$archive" -C "$work" app.db $( [ -f "$work/env" ] && echo env ) -C "$APP_DIR/data" avatars
echo "  saved $archive ($(du -h "$archive" | cut -f1))"

# Keep only the newest KEEP_LOCAL archives on the VPS.
ls -1t "$BACKUP_DIR"/autoreels-*.tar.gz | tail -n +"$((KEEP_LOCAL + 1))" | xargs -r rm -f

if command -v rclone >/dev/null && rclone listremotes | grep -q "^${REMOTE%%:*}:"; then
  rclone copy "$archive" "$REMOTE"
  rclone delete "$REMOTE" --min-age "${KEEP_REMOTE_DAYS}d" --include 'autoreels-*.tar.gz'
  echo "  uploaded to $REMOTE"
else
  echo "  rclone remote ${REMOTE%%:*} not configured, skipped upload" >&2
  exit 1
fi
