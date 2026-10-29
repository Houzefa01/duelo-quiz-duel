# Duelo — Un duel de culture générale en moins de 3 minutes

Jeu de quiz en duel 1 contre 1 dans le navigateur. Français (structure i18n prête).
Node 22+, SQLite, WebSocket. Tient sur un vieux PC.

## Lancement en 5 commandes
```bash
npm install
npm run setup -- --admin-user=... --admin-password='...' --port=34567 --yes
npm start
# http://localhost:34567
npm test   # 51 tests (5e commande : vérifie que tout est vert)
```
Détail : `docs/DEPLOY.md` (installation à froid vérifiée le 2026-10-06, voir
`docs/JOURNAL-INSTALL.md`). Ne copie jamais `.env.example` tel quel en production :
le mot de passe d'exemple est refusé au démarrage.

## Ce qu'il faut sauvegarder
- `data/duelo.db` (comptes, duels, lots chiffrés) — `deploy/backup.sh` (tous les jours
  via `deploy/duelo-backup.timer` ou `deploy/duelo-backup.cron`).
- `data/uploads/` (photos, fichiers de lots) — inclus dans `backup.sh`.
- **`REWARD_KEY` hors machine** (coffre du responsable) : jamais dans les sauvegardes
  ni le dépôt. Sans elle, les lots chiffrés sont perdus.
- Restauration : `deploy/restore.sh` (prouvée inter-machines le 2026-10-06).

## Mettre à jour
```bash
sudo systemctl stop duelo          # (ou pm2 stop duelo)
cd /opt/duelo && git pull          # (ou dépose la nouvelle archive)
npm ci --omit=dev && npm test
sudo systemctl start duelo
```
Les duels en cours sont annulés sans pénalité au redémarrage ; les tournois
reprennent (arbre en base). Pour une intervention : active le mode maintenance
depuis `/admin/sante` (espace admin) — les duels en cours se terminent.

## Lire les journaux
- `journalctl -u duelo -f` (systemd) ou `pm2 logs duelo`.
- Santé : page `/admin/sante` (RAM, CPU, en ligne, duels actifs, disque, uploads,
  dernière sauvegarde). Audit admin : `GET /api/v1/admin/audit`.

## Pannes
- **Disque plein** : `du -sh data/uploads/*` ; purge `backups/` (>14 j auto) ;
  relève les quotas (`PATCH /admin/organizers/:id/quotas`, `avatar_quota_mb` en base).
- **Le serveur ne démarre plus** : lis le message — causes fréquentes :
  port occupé (changer `PORT`), `ADMIN_PASSWORD` faible en production,
  `REWARD_KEY` absente alors que des lots chiffrés existent, base verrouillée
  (`-wal` orphelin après kill -9 : SQLite rejoue le journal seul au redémarrage,
  vérifié le 2026-10-06).
- **Clé perdue** : `REWARD_KEY` perdue = lots perdus (pas de récupération possible).
