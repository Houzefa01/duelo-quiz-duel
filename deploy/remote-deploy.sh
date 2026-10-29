#!/bin/bash
# Exécuté SUR le VPS en un seul appel SSH (insensible aux coupures du tunnel).
# $1 = nouveau release dir (absolu), $2 = release précédent (absolu).
set -uo pipefail
NEW="$1"; PREV="$2"
log() { echo "[remote-deploy] $*"; }
sante() { curl -sf -m 10 http://127.0.0.1:34567/healthz > /dev/null; }
log "bascule $PREV -> $NEW"
sudo -n ln -sfn "$NEW" /opt/duelo/current
sudo -n systemctl restart duelo
sleep 8
if sante; then
  log "santé OK ($NEW)"
  exit 0
fi
log "santé en échec, retour à $PREV"
sudo -n ln -sfn "$PREV" /opt/duelo/current
sudo -n systemctl restart duelo
sleep 8
if sante; then
  log "retour arrière OK ($PREV)"
  exit 2
fi
log "ÉCHEC CRITIQUE : même $PREV ne répond plus"
exit 1
