#!/bin/bash
# Automatic backups of the live server, run by cron (see DEPLOY.md, "Automatic backups"):
#   backup.sh nightly   the database                          keeps the newest 14
#   backup.sh weekly    the database + app files and photos   keeps the newest 8
# Backups go to ~/backups/auto/ and are copied to the shop file server when it's
# connected at /mnt/shopcontrol-backups (\\freenas11\Share\Data\ShopControl-Backups). Every run also trims the backups made before
# deploys to the newest 5. If anything fails, admins and owners get an email.
set -uo pipefail
shopt -s nullglob
KIND=${1:?nightly or weekly}
APP=/opt/concept-shop-control
ROOT=$HOME/backups
AUTO=$ROOT/auto
COPY=/mnt/shopcontrol-backups
TS=$(date -u +%Y%m%d-%H%M%S)
LOG=$AUTO/backup.log
mkdir -p "$AUTO/nightly" "$AUTO/weekly"
chmod 700 "$AUTO"
log() { echo "$(date -u '+%F %T') [$KIND] $*" >> "$LOG"; }

fail() {
  log "FAILED: $1"
  echo "{\"kind\":\"$KIND\",\"at\":\"$TS\",\"ok\":false,\"error\":\"$1\"}" > "$AUTO/last-$KIND.json"
  (cd "$APP/server" && node src/backupAlert.js "ShopControl $KIND backup failed" "$1" >> "$LOG" 2>&1)
  exit 1
}

keep_newest() { # keep_newest <count> <files...>: delete all but the newest <count>
  local n=$1; shift
  [ $# -gt 0 ] || return 0   # nothing matched: never fall back to listing the current folder
  ls -1td "$@" 2>/dev/null | tail -n +$((n + 1)) | while read -r f; do rm -rf -- "$f" && log "removed old $(basename "$f")"; done
}

DBURL=$(grep '^DATABASE_URL=' "$APP/server/.env" | cut -d= -f2- | tr -d '"' | tr -d "'")
[ -n "$DBURL" ] || fail "DATABASE_URL is missing from server/.env"
DIR=$AUTO/$KIND
DB=$DIR/shopcontrol-db-$KIND-$TS.dump
pg_dump "$DBURL" -Fc -f "$DB" 2>>"$LOG" || fail "pg_dump of the database failed"
pg_restore -l "$DB" > /dev/null 2>>"$LOG" || fail "the database backup can't be read back ($DB)"
log "database $(du -h "$DB" | cut -f1) -> $DB"

if [ "$KIND" = weekly ]; then
  FILES=$DIR/shopcontrol-files-weekly-$TS.tar.gz
  # The app, its settings (.env) and every uploaded photo and file; node_modules is reinstalled with npm install.
  tar czf "$FILES" --exclude=node_modules -C /opt concept-shop-control 2>>"$LOG" || fail "the app and photo backup failed"
  tar tzf "$FILES" > /dev/null 2>>"$LOG" || fail "the app and photo backup can't be read back ($FILES)"
  log "files $(du -h "$FILES" | cut -f1) -> $FILES"
  keep_newest 8 "$DIR"/shopcontrol-db-weekly-*.dump
  keep_newest 8 "$DIR"/shopcontrol-files-weekly-*.tar.gz
else
  keep_newest 14 "$DIR"/shopcontrol-db-nightly-*.dump
fi
chmod 600 "$DIR"/*

# Backups made before deploys: keep the newest 5 of each. The September 2026 cutover
# backups (the system before it moved to this server) are kept for good.
keep_newest 5 $(ls -d "$ROOT"/shopcontrol-app-pre* "$ROOT"/app-*-pre-*.tgz 2>/dev/null | grep -v precutover)
keep_newest 5 $(ls -d "$ROOT"/shopcontrol-db-pre* 2>/dev/null | grep -v precutover)

COPIED=false
if mountpoint -q "$COPY"; then
  # Files and times only: the share (SMB) doesn't keep Linux owners and permissions.
  rsync -rt --modify-window=2 --delete "$AUTO/nightly" "$AUTO/weekly" "$COPY/" 2>>"$LOG" || fail "copying to the shop file server ($COPY) failed"
  COPIED=true
  log "copied to the shop file server"
else
  log "shop file server not connected at $COPY; backup kept on this server only"
fi
echo "{\"kind\":\"$KIND\",\"at\":\"$TS\",\"ok\":true,\"copiedToFileServer\":$COPIED}" > "$AUTO/last-$KIND.json"
log "done"
