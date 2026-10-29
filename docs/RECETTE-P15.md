# Recette Phase 15 — mise en production (preuves exécutées, 2026-10-06)

- [x] **Installation à froid** — conteneur `duelo-froid` (Debian 12 vierge), uniquement
  `docs/DEPLOY.md`. Journal : `docs/JOURNAL-INSTALL.md`. 5 écarts trouvés et corrigés :
  Node 20→22 (better-sqlite3 v13 **segfaulte** sur Node 20.20, prouvé + résolu par rebuild),
  outils de compilation, `sqlite3` pour le backup, tarball sans git, `npm run setup`
  obligatoire (le `.env` d'exemple est refusé en production). Preuve : `seed ok: 600`,
  `{"ok":true}`, inscription `FroidU` OK, leaderboard 200, backup 364 Ko.
- [x] **Charge globale** (`node tests/load/global.js`, `docs/CHARGE-P15.txt`) : 300 WS,
  100 duels (200 joueurs terminés), 10 photos, 2 tournois démarrés (size=8) : RAM 164–165 Mo
  (< 400), CPU 11–12 % (< 25 %), latence p50 2–4 ms, **p95 47 puis 60 ms** (budget 50 :
  dépassé une fois sur deux — voir LIMITES). Machine : i5-5200U ×4, 5717 Mo.
- [x] **Sauvegarde planifiée** — `deploy/duelo-backup.{timer,service,cron}` (+ rappel
  REWARD_KEY dans le cron et DEPLOY). **Restauration inter-machines** (conteneur) :
  connexion 200 (`RestoU`), profil elo 1200, lots `["Code de test"]`,
  **lot déchiffré `CODE-RESTAURATION-OK`** (même REWARD_KEY). Classement : 0 ligne
  (< 5 duels classés — règle F-34, normal).
- [x] **Nginx** (config `deploy/nginx.conf` adaptée en `localhost` + auto-signé pour la preuve) :
  HTTP→301 HTTPS ; CSP stricte sans `unsafe-inline` ; HSTS (2×, app+nginx) ; WS `101` ;
  gzip `base.css` → 3456 octets ; corps 5 Mo → **413** (limite 4 Mo) ;
  rafale logins → `401×4 puis 429×3` (limite applicative). Rate-limit nginx actif
  (`x-ratelimit-*` observés).
- [x] **README.md** — 5 commandes, sauvegardes, mise à jour, journaux, pannes (disque plein,
  non-démarrage, clé perdue).
- [x] **Maintenance** (`tests/p14/maintenance.test.js`) : `POST /admin/maintenance {on:true}`
  (audit) → `queue.join` refusé (`error: maintenance`), API 503 → écran « On revient
  bientôt » ; duel en cours terminé normalement ; `{on:false}` → reprise (challenges 200).
- [x] **LIMITES.md** — 10 points non testés + 5 simplifications, honnêtes.
- [x] **Non-régression** : 26 + 26 = **52/52 verts**, sécurité 17/17.
