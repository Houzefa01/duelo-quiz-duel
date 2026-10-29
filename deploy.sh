#!/bin/bash
# Déploiement Duelo sur le VPS avec retour arrière automatique.
# Le .env de production est conservé d'une release à l'autre (jamais commité,
# jamais copié depuis la machine locale). Les migrations SQL s'appliquent
# seules au démarrage (server/db/db.js), après la sauvegarde automatique.
# Usage : SSHPASS=... ./deploy.sh
# Variables : SSH_HOST SSH_PORT SSH_USER SSH_KEY (voir têtes ci-dessous).
set -euo pipefail
SSH_HOST="${SSH_HOST:-debian-ssh.enset.work}"
SSH_PORT="${SSH_PORT:-2223}"   # informatif : l'accès passe par le tunnel Cloudflare
SSH_USER="${SSH_USER:-serveur}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/debian_control}"
RELEASE="$(date +%Y%m%d-%H%M%S)"
if [ -z "${SSHPASS:-}" ]; then echo "SSHPASS requis (exporté, jamais commité)"; exit 1; fi
SSH_ARGS=(-F /dev/null -i "$SSH_KEY" -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=4 -o "ProxyCommand=cloudflared access tcp --hostname %h")
R() { timeout 600 sshpass -e ssh "${SSH_ARGS[@]}" "$SSH_USER@$SSH_HOST" "$@"; }
RSYNC_RSH="ssh -F /dev/null -i $SSH_KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o ProxyCommand='cloudflared access tcp --hostname %h'"

echo "== release $RELEASE"
R "mkdir -p /opt/duelo/releases/$RELEASE"
timeout 900 sshpass -e rsync -az --rsh="$RSYNC_RSH" \
  --exclude node_modules --exclude .git --exclude .env --exclude data/ --exclude uploads/ \
  --exclude backups/ --exclude 'docs/captures/' --exclude 'docs/captures-p12/' --exclude tests/ \
  --exclude tools/.lighthouse --exclude tools/.axe \
  ./ "$SSH_USER@$SSH_HOST:/opt/duelo/releases/$RELEASE/"
PREV=$(R "readlink /opt/duelo/current")
R "sudo -n chown -R duelo:duelo /opt/duelo/releases/$RELEASE"
R "sudo -u duelo env PATH=/opt/node22/bin:/usr/bin:/bin bash -c 'cd /opt/duelo/releases/$RELEASE && npm ci --omit=dev'"
echo "== sauvegarde avant bascule"
R "sudo -n systemctl start duelo-backup.service && sleep 5 && ls -t /var/lib/duelo/backups/duelo-*.db | head -1"
echo "== .env de production conservé ($PREV -> $RELEASE)"
R "sudo -n cp $PREV/.env /opt/duelo/releases/$RELEASE/.env && sudo -n chown duelo:duelo /opt/duelo/releases/$RELEASE/.env"
echo "== bascule + restart + santé (un seul appel distant, insensible aux coupures)"
timeout 900 sshpass -e scp "${SSH_ARGS[@]}" deploy/remote-deploy.sh "$SSH_USER@$SSH_HOST:/tmp/remote-deploy.sh"
if R "bash /tmp/remote-deploy.sh /opt/duelo/releases/$RELEASE $PREV"; then
  echo "== santé OK, déploiement terminé ($RELEASE)"
else
  code=$?
  if [ $code -eq 2 ]; then echo "== retour arrière effectué (release cassée)"; else echo "== ÉCHEC CRITIQUE, intervention manuelle"; fi
  exit $code
fi
