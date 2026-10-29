# Recette Phase 14 — robustesse avant mise en ligne (preuves exécutées, 2026-10-06)

- [x] **Images non bloquantes** — client : `reduirePhoto()` (canvas, 512 px max, WebP/JPEG)
  utilisée aux 2 envois (vérification statique `tests/p14/nonblock.test.js`) ; serveur :
  `server/lib/imgpool.js` + `imgworker.js` (worker thread, file à 1 tâche, redémarrage auto).
  Preuve : `node --test tests/p14/nonblock.test.js` — pendant un upload **jimp** (pire cas),
  duel en cours : n=3, médiane 26 ms, **p95 46 ms < 100 ms**, upload abouti (200).
- [x] **Pas de compte démo / mot de passe faible en prod** — `server/index.js` refuse (code 1)
  si `ADMIN_PASSWORD` absent, < 12, mot courant ou égal au login, et si `SESSION_SECRET`
  absent/exemple. Preuve : `node --test tests/p14/boot.test.js` (absent→1, 4 faibles→1,
  fort `K7$mQ9#vX2@pLzRw!`→démarre) ; aucun `role='user'` après seed.
- [x] **`npm run setup`** — `scripts/setup.js` : refuse si `.env` existe (sans `--force`),
  génère `SESSION_SECRET` (96 hex) + `REWARD_KEY` (64 hex), `.env` en 600, crée l'admin,
  affiche le rappel de sauvegarde de la clé. Preuve : exécuté avec `--force` (PORT 34577,
  SECRET 96, REWARD 64, ADMIN root, « 2 compte(s) admin »), dépôt restauré après.
- [x] **kill -9** — `node --test tests/p14/kill9.test.js` : SIGKILL en plein duel ranked +
  tournoi à 8 (arbre R1) ; `PRAGMA integrity_check` = ok ; redémarrage : duel `cancelled`,
  Elo inchangé, 0 pièce, 0 ledger ; tournoi résolu jusqu'à `done` après reprise.
  (Reprise auto : `server/db/db.js` annule les duels non terminés au démarrage +
  `busy_timeout=5000` pour la concurrence multi-processus.)
- [x] **/admin/sante** — `GET /api/v1/admin/health` (403 sinon) : ramMo, heapMo,
  cpuPctDepuisDemarrage, enLigne5min, duelsActifs (`engine.active.size`), disque
  (`statfsSync`), uploads (tailles bornées), derniereSauvegarde ; redirection 302
  `/admin/sante` → `/#/admin-sante` ; écran SPA. Preuve : `tests/p14/sante.test.js`.
- [x] **Non-régression** : 26 (unit+intégration) + 18 (p12/p13) + 7 (p14) = **51/51 verts**.

## Lancement
```bash
npm run setup -- --admin-user=... --admin-password='...' --port=34567 --yes
npm start   # http://localhost:34567 (port 34567 vérifié libre au démarrage)
```
