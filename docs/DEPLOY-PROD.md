# Duelo en production — duel.enset.work (sans aucun secret)

## Adresses
- Jeu : https://duel.enset.work (HTTPS via tunnel Cloudflare, certificat Cloudflare).
- SSH : via `cloudflared access tcp` (voir commande type dans `deploy.sh`).
- App : 127.0.0.1:34567 uniquement (jamais exposée). Santé locale : `/healthz`.

## Fichiers sur le VPS
- Code : `/opt/duelo/releases/<date>/`, actif via `/opt/duelo/current` (lien).
- Données : `/var/lib/duelo/duelo.db`, `/var/lib/duelo/uploads/`, `/var/lib/duelo/backups/`.
- `.env` : dans la release active (`/opt/duelo/releases/<date>/.env`, 600, conservé
  par `deploy.sh` d'une release à l'autre).
- REWARD_KEY : uniquement dans ce `.env` — **à copier hors du VPS** (voir scp ci-dessous).
- systemd : `duelo.service`, `duelo-backup.{service,timer}`. Node : `/opt/node22`
  (le Node système en /usr/local est aux autres projets — ne pas y toucher).
- nginx : `/etc/nginx/sites-enabled/duelo.conf` (variante tunnel : `deploy/nginx-tunnel.conf`).

## Exploitation
```bash
# Journaux / état
sudo journalctl -u duelo -f
sudo systemctl status duelo nginx
# Santé (admin) : https://duel.enset.work/#/admin-sante
# Redémarrage : sudo systemctl restart duelo
# Sauvegarde manuelle : sudo systemctl start duelo-backup.service
# Restauration : DB_PATH=... UPLOAD_ROOT=... bash /opt/duelo/current/deploy/restore.sh <db> [uploads.tgz]
# Déploiement : SSHPASS=... ./deploy.sh   (rollback auto si santé KO)
# Maintenance : POST /api/v1/admin/maintenance {"on":true|false}
# Surveillance externe gratuite : UptimeRobot/Checkly sur https://duel.enset.work/healthz
# (200 + {"ok":true} ; noter : /healthz n'est pas exposé publiquement par nginx —
#  surveiller https://duel.enset.work/ (200) à la place.)
```
Attention : `/healthz` n'existe qu'en local (127.0.0.1:34567). La surveillance externe
doit viser `https://duel.enset.work/` (code 200).

## Rappel Cloudflare (côté dashboard, déjà fait le 2026-10-06)
- Tunnel : `duel.enset.work` → `http://localhost:80` (nginx). Ne jamais remettre `https://…:34567`
  (l'appli parle HTTP ; le HTTPS visiteurs reste chez Cloudflare).
- SSL : « Complet (strict) ».
