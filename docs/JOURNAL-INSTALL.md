# Journal d'installation à froid — Debian 12 bookworm-slim (conteneur `duelo-froid`)
Date : 2026-10-06. Méthode : uniquement `docs/DEPLOY.md`, sans improvisation.
Chaque commande `docker exec` est notée. Les écarts sont marqués [ÉCART] et corrigés dans DEPLOY.md.

## Commandes exécutées (dans l'ordre)
1. `docker run -d --name duelo-froid debian:bookworm-slim sleep infinity`
2. `apt-get update && apt-get install -y curl ca-certificates gnupg`
3. `curl -fsSL https://deb.nodesource.com/setup_20.x | bash -` puis
   `apt-get install -y nodejs nginx sqlite3` → node v20.20.2, nginx 1.22.1
   ([ÉCART-1] : `sqlite3` n'est pas dans DEPLOY.md mais `deploy/backup.sh` l'exige.)
4. `useradd -r -m duelo`
5. Copie des sources par tarball exclu (`node_modules`, `data`, `backups`) + `docker cp`,
   extraction dans `/opt/duelo`, `chown duelo:duelo`
   ([ÉCART-2] : pas de dépôt git ; DEPLOY.md ne parlait que de `git clone`.)
6. `npm ci --omit=dev` (utilisateur duelo) → **ÉCHEC** : `better-sqlite3` compile depuis
   les sources et il manque python3/make/g++.
   ([ÉCART-3] : outils de compilation absents de DEPLOY.md.)
7. `apt-get install -y python3 make g++` puis `npm ci --omit=dev` → OK.
8. `cp .env.example .env && npm run seed` → **segfault** (exit 139) sur `better-sqlite3`.
   Isolation : l'import passe, l'écriture segfaulte, même après `npm rebuild`.
   Cause : better-sqlite3 v13 incompatible avec Node 20.20 (API V8).
   ([ÉCART-4] : DEPLOY.md exigeait Node 20 ; il faut **Node 22**.)
9. `setup_22.x` + `apt-get install nodejs` → v22.23.3, `npm rebuild better-sqlite3` →
   écriture OK (`{"a":"x"}`).
10. `npm run seed` → `seed ok: 600 questions`. `node server/index.js` → `{"ok":true}`.
11. Smoke : `POST /auth/register` → OK FroidU ; `GET /leaderboard` → 200.
12. `bash deploy/backup.sh` → `backups/duelo-2026-10-06-0806.db` (364 Ko). OK.
13. Service systemd : **non testable** (pas de systemd dans un conteneur).
    Le fichier `deploy/duelo.service` est relu, pas exécuté. Noté honnêtement en LIMITES.

## Bogue bloquant découvert par cette procédure
- Avec `NODE_ENV=production` (posé par `duelo.service`), le serveur **refuse de démarrer**
  avec le `.env` issu de `.env.example` (`ADMIN_PASSWORD=admin12345678` contient « admin »).
  ([ÉCART-5] : DEPLOY.md doit imposer `npm run setup` au lieu de `cp .env.example`.)
