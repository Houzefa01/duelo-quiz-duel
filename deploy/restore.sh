#!/bin/bash
# Restauration : base + uploads (teste-la après chaque sauvegarde importante).
# Usage : DB_PATH=./data/duelo.db ./deploy/restore.sh ./backups/duelo-AAAA-MM-JJ-HHMM.db [./backups/uploads-....tar.gz]
set -euo pipefail
DB="${DB_PATH:-./data/duelo.db}"
UPLOADS="${UPLOAD_ROOT:-./data/uploads}"
[ -f "${1:?fichier .db de sauvegarde requis}" ] || exit 1
cp "$1" "$DB"
if [ -n "${2:-}" ] && [ -f "$2" ]; then
  mkdir -p "$(dirname "$UPLOADS")"
  tar -xzf "$2" -C "$(dirname "$UPLOADS")"
fi
echo "restauration: $DB"
node -e "import('./server/db/db.js').then(async ({openDb,getDb})=>{openDb(process.env.DB_PATH||'./data/duelo.db');const db=getDb();console.log('questions:',db.prepare('SELECT COUNT(*) c FROM questions').get().c,'users:',db.prepare('SELECT COUNT(*) c FROM users').get().c)})"
