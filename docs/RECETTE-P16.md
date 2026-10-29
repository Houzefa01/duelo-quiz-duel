# Recette Phase 16 — production duel.enset.work (preuves exécutées, 2026-10-06)

- [x] **Connexion** : empreintes relevées sans authentification (RSA xpSK…, ECDSA 7ug1…,
  ED25519 ZPKH…) ; 2 tentatives clé (serveur, Hsavatra) refusées puis mot de passe
  (fourni par l'exploitant) sur `debian-ssh.enset.work` → `serveur@debian`.
  Clé privée jamais affichée ni copiée.
- [x] **Inventaire** : Debian 12 x86_64, 3,9 Go RAM (2,8 libres), 182 Go disque, Node 20
  système + MariaDB + Docker + Moodle/PHP + :3000/:4000 — tous laissés intacts ;
  ports 80/443/34567 libres, nginx absent. Node 22 installé à part (`/opt/node22`).
- [x] **Ressources** : mariadb 206 Mo, app :3000 ~89 Mo, Duelo mesuré 95–165 Mo
  (MemoryMax=500M). Rien d'arrêté.
- [x] **Setup/serveur** : rsync (exclusions OK), `npm ci`, `npm run setup` (admin créé,
  600 questions, 0 démo) ; systemd durci (NoNewPrivileges, ProtectSystem=strict,
  PrivateTmp, MemoryMax 500M, journald) actif ; écoute **127.0.0.1:34567** (preuve `ss`) ;
  refus de boot sans mot de passe fort vu dans journald (ADMIN_PASSWORD d'exemple).
- [x] **Bogue .env trouvé par la prod** : `loadEnv` cherchait `../../../.env` (jamais chargé
  nulle part) → corrigé en `../../.env`, prouvé en local, redéployé, service actif.
- [x] **Nginx + Tunnel** : tunnel `duel.enset.work` → corrigé de `https://…:34567` (502)
  vers `http://localhost:80` ; `nginx-tunnel.conf` (gzip, 4 Mo, débit, realip
  CF-Connecting-IP) ; HTTPS 200 à travers CF, CSP stricte, HSTS, WS `101`.
- [x] **IP réelle** : log nginx `129.222.109.8` = IP publique du testeur (pas Cloudflare) ;
  rate-limit applicatif prouvé à travers CF (429 après 5 logins).
- [x] **WS** : ping serveur 15 s (9 pings en 135 s) ; connexion tenue 135 s inactive puis
  `queue.joined` OK ; reconnexion auto côté client (`socket.js`, par code + test local).
- [x] **Duel distant** : 2 WS via `wss://duel.enset.work` → 199-199, Elo appliqué.
- [x] **Compte/photo/avatar** via domaine : register 200×2, avatar catalogue 200,
  photo 200 servie `image/png`.
- [x] **Ports** : 34567 injoignable de l'extérieur (timeout), IP directe :443 → 000.
- [x] **Sauvegardes** : timer actif, backup manuel 364 Ko, restauration inter-machines
  **lot déchiffré `CODE-RESTAURATION-OK`** ; test suppression dans dossier temporaire.
- [x] **deploy.sh** : vert (release 20261006-122203) ; cassé volontairement → rollback
  auto prouvé (retour 20261006-122203, santé OK) ; durci (appel distant unique +
  ServerAlive) ; 2e vert (20261006-213613).
- [x] **Reboot** : `reboot` → 17 min d'uptime au retour, duelo+nginx+timer actifs,
  health OK, domaine 200, tunnels reconnectés. (Chemin SSH d'admin revenu après ~20 min.)
- [x] **Maintenance** : ON → API 503 + écran, OFF → 200 ; `/admin/sante` (RAM 152 Mo,
  backup visible après correctif `BACKUP_DIR`).
- [ ] **Lecteur d'écran réel** : toujours à faire (procédure prête).
