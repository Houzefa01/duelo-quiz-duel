# Déploiement Duelo (port 34567)
> Procédure vérifiée par installation à froid le 2026-10-06 dans un conteneur
> Debian 12 vierge (journal : `docs/JOURNAL-INSTALL.md`). 5 écarts corrigés ici.

## 1. Debian/Ubuntu
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -   # Node 22 exigé (better-sqlite3 v13 segfaulte sur Node 20)
sudo apt install -y nodejs nginx sqlite3 python3 make g++           # sqlite3 pour backup.sh ; python3/make/g++ pour compiler better-sqlite3
sudo useradd -r -m duelo
# Sources : git clone OU tarball :
sudo -u duelo git clone <repo> /opt/duelo && cd /opt/duelo
# (sans git : tarball exclu de node_modules/, data/, backups/, puis chown duelo:duelo)
sudo -u duelo npm ci --omit=dev
sudo -u duelo npm run setup -- --admin-user=... --admin-password='...' --port=34567 --yes
# (ne JAMAIS copier .env.example tel quel : le mot de passe d'exemple est refusé en production)
sudo cp deploy/duelo.service /etc/systemd/system/
sudo systemctl enable --now duelo
```

## 2. systemd
Voir `deploy/duelo.service` (redémarrage auto, `MemoryMax=400M`).

## 3. Nginx (HTTPS + WS + cache)
Voir `deploy/nginx.conf`. Remplacer `duelo.example.com`, certificats Let's Encrypt :
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d duelo.example.com
```
Foyer sans IP fixe : tunnel Cloudflare (`cloudflared tunnel --url http://localhost:34567`).

## 4. Windows : PM2 + Caddy
`npm i -g pm2 && pm2 start server/index.js --name duelo && pm2-save`.
Caddyfile : `duelo.example.com { reverse_proxy localhost:34567 }`.

## 5. Sauvegarde/restauration
`deploy/backup.sh` (VACUUM INTO, rétention 14 j). Restauration : stop, copie, start.

## 6. Variables `.env`
`PORT=34567`, `SESSION_SECRET` (32+ chars), `TZ`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`,
`BASE_URL`, `DB_PATH`.

## 7. Phase 12 — clé des lots, antivirus, uploads
- **REWARD_KEY** (obligatoire dès qu'un lot chiffré existe, sinon refus de démarrage) :
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  # coller dans .env : REWARD_KEY=<64 hex>
  ```
  **Sauvegarde la clé hors machine** (coffre du responsable) : si elle est perdue, les lots
  sont perdus. Elle ne figure ni dans le dépôt, ni dans les sauvegardes, ni dans les journaux.
- **Rotation de clé** : 1) ajoute `REWARD_KEY_NEW` + redémarre avec un script de rechiffrement
  (à écrire : déchiffre chaque `payload_enc`/`code_enc` avec l'ancienne, rechiffre avec la
  nouvelle) ; 2) remplace `REWARD_KEY`, supprime l'ancienne. Sans script, crée de nouveaux lots.
- **ClamAV (facultatif)** : si `clamscan` est installé, chaque fichier de lot est scanné avant
  acceptation ; sinon l'organisateur voit « accepté sans scan » et l'admin est averti
  (compteur dans les métriques à venir). Installation : `sudo apt install clamav`.
  **Sans ClamAV** (comportement automatique, prouvé par `tests/p13/scan.test.js`) : seuls
  `txt, png, jpg, webp, pdf` sont acceptés d'office ; `zip, docx, xlsx, pptx, mp3, mp4, csv, gif`
  passent en `pending-scan` : la publication du tournoi est bloquée tant qu'un admin ne les
  valide pas (`POST /admin/uploads/:id/approve`, file `GET /admin/uploads/pending`), et le
  gagnant voit un avertissement antivirus avant de télécharger.
- **Uploads** : `deploy/backup.sh` sauvegarde `data/uploads/` (photos 256/64 px, fichiers de lots)
  avec la base ; `deploy/restore.sh` restaure les deux. Testé le 2026-10-05 (600 questions,
  2 utilisateurs, dossiers avatars/rewards restaurés).
- **Rappel légal** : tournois gratuits à l'entrée, pas d'argent réel sur la plateforme ;
  l'organisateur est responsable de ses lots ; vérifier la réglementation locale des concours.
- **HTTPS/cache** (`deploy/nginx.conf`) : ajouter `location /assets/` en cache immutable
  (avatars catalogue, sprite, polices) ; les photos `/api/v1/avatar/photo/` portent déjà
  `Cache-Control: immutable` (nom UUID unique par photo).
