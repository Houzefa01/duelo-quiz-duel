#!/bin/bash
# Sauvegarde chaude SQLite (VACUUM INTO) + dossier uploads (photos, fichiers de lots).
# Rétention 14 jours. La REWARD_KEY n'est JAMAIS sauvegardée ici (voir docs/DEPLOY.md).
set -euo pipefail
DB="${DB_PATH:-./data/duelo.db}"
UPLOADS="${UPLOAD_ROOT:-./data/uploads}"
DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$DIR"
DATE=$(date +%F-%H%M)
F="$DIR/duelo-$DATE.db"
sqlite3 "$DB" "VACUUM INTO '$F';" 2>/dev/null || cp "$DB" "$F"
if [ -d "$UPLOADS" ]; then
  tar -czf "$DIR/uploads-$DATE.tar.gz" -C "$(dirname "$UPLOADS")" "$(basename "$UPLOADS")"
else
  echo "pas de dossier uploads, ignoré"
fi
find "$DIR" -name 'duelo-*.db' -mtime +14 -delete
find "$DIR" -name 'uploads-*.tar.gz' -mtime +14 -delete
echo "backup: $F"
