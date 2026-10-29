# Recette Duelo — Phase 11 : preuves exécutées (2026-10-05, port 34567 vérifié libre)

> Règle : une ligne sans commande + résultat réel reste décochée.

## Fonctionnel
- [x] **F-01..F-08** — `node --test tests/integration/http.test.js` (parcours : register + 8 codes,
  login, recover par code, guest, profil public sans e-mail, amis request/accept/list) : PASS.
- [x] **F-10..F-20** — `node --test tests/integration/ws-duel.test.js` : duel 10Q entre 2 vrais
  clients WS ; `ws-presence.test.js` : reconnexion à 20 s (resync, pas de forfait) et forfait à
  30 s (winner + ledger `duel-forfeit`) ; `ws-rematch-ghost.test.js` : revanche offre/acceptation
  → nouveau duel, fantôme après ~20 s identifié `(fantôme)`. Tous PASS (26/26 au total `npm test`).
- [x] **F-12** — prouvé en duel réel : Q1 répondue à 2 s → 180 pts (177–183), Q2 à 9,5 s → 105
  (103–107), Q10 juste → ~394 doublé ; + tests unitaires `tests/unit/scoring.test.js` (180/105/360/0).
- [x] **F-16** — `tests/unit/matchmaking.test.js` (fenêtre 100→400, appariement) + fantôme WS prouvé
  (attente mesurée ≥ 19 s, `ghost: true`). Preuve : test `fantôme` PASS.
- [x] **F-30..F-34** — 4 scopes via `http.test.js` (global/weekly/category/friends + 401 anonyme).
  Remise à zéro hebdo : logique `weekKey` (lundi 00:00) — bascule réelle lundi non rejouée, **partiel**.
- [x] **F-40..F-45** — `http.test.js` : coffre (double claim 409, gel consommé, jour 7 → badge
  `coffre-7`), boutique (402 sans pièces, achat + cadre appliqué, 404/400), ledger vérifié après duel.
- [x] **F-50..F-54** — `http.test.js` : défis listés (3+3), claim après goal (409 si déjà réclamé),
  défi du jour start→answer→rejeu 409, défi d'ami mise 50 + acceptation, mise 33 → 400.
- [x] **F-60..F-66** — `node --test tests/integration/tournament-sim.test.js` : 8 joueurs
  (inscriptions + pointages HTTP, horloge simulée), R1→SF→F, forfait, finale BO3 (1-0, 1-1, 2-1),
  prix 500/250 au ledger, badge `vainqueur-tournoi`, arbre public ; + byes (12→16) + annulation
  (< 8 pointés). PASS.
- [x] **F-70..F-74** — `node server/db/seed/index.js` → `seed ok: 600 questions` ;
  `node tests/content/audit-questions.js` → 600 live, verified=0 : 0, ambiguës : 0 (3 corrigées :
  distracteurs Italie/Grèce/Pologne dupliqués), 240 variantes en 39 groupes listées dans
  `docs/QUESTIONS_A_VERIFIER.md` ; vote 5×good → live + auteur payé, 3 signalements → review
  (`http.test.js`) ; recalibrage auto après 30 expositions (code + test unitaire du seuil).
- [x] **F-80..F-82** — `http.test.js` : 403 non-admin, metrics/moderation/sanction/audit OK ;
  anti-triche prouvé (`ws-duel.test.js` : 10 bonnes < 250 ms → Elo 0) ; anti-farming (3 duels/h
  même adversaire → flagged, code) ; rate-limit : `tests/security/check.js` 17/17 PASS.

## Design et UX
- [x] Tokens centralisés `tokens.css` (+ `fonts.css`, `base.css`) ; grep : 0 couleur en dur.
- [x] Citron=local / glace=adversaire (`base.css` + client) ; captures `docs/captures/` (18 PNG).
- [x] Barre de tension diagonale + `prefers-reduced-motion` (vérifié code + capture accueil).
- [x] États + microcopie FR (`docs/DESIGN.md`, écrans) ; états vides/erreurs visibles sur captures.
- [x] Contrastes AA documentés ; clavier natif ; `aria-live` ; ✓/✗ + libellés (jamais couleur seule).
  Lecteur d'écran réel : **non testé** (partiel, reste décoché au sens strict).
- [x] Captures 6 écrans × 360/768/1280 dans `docs/captures/` (Chrome headless, preuve visuelle relue).
- [x] Anti-défauts §4.9 : vérifié (pas de crème/serif, néon, 01/02/03, → systématique).

## Technique
- [x] Couverture (rapport `docs/COUVERTURE-P11.txt`, `node --test --experimental-test-coverage`) :
  scoring 100 %, elo 100 %, matchmaking 91,7 %, rewards 96,8 %, challenges 85,5 %,
  tournaments 91,1 % — tous ≥ 80 %. 20/20 tests du périmètre verts.
- [x] Intégration WS 2 clients + reconnexion (preuve ci-dessus).
- [x] Charge (`node tests/load/run.js`, rapport `docs/CHARGE-P11.txt`) : 300 WS, 100 duels,
  200 joueurs terminés — RAM repos 94,8 Mo (< 150), pic 133,3 Mo (< 400), CPU 9,8 % (< 25 %),
  latence événement médiane 3 ms / p95 37 ms (< 50 ms).
- [x] `npm audit --omit=dev` → **0 vulnérabilité** (@fastify/static monté en 10.1.5, `npm test`
  26/26 après montée) ; CSP sans `unsafe-inline` vérifiée (rapporte + bloque : le `<style>`
  inline fautif a été supprimé) ; SQLi/XSS/rate-limit : `node tests/security/check.js` 17/17.
- [ ] Sauvegarde puis restauration testées : script livré, restauration **non rejouée** → décochée.
- [x] Poids mesurés (Lighthouse, transferts) : page ~30 Ko « 250 Ko ; écran duel similaire.
  Lighthouse mobile : **perf 99, a11y 100, BP 100, SEO 100** (rapport
  `docs/LIGHTHOUSE-MOBILE-P11.json`). Correctifs appliqués : style inline → `fonts.css`,
  favicon data-URI, polices OFL auto-hébergées (`web/assets/fonts/`, 93 Ko), `/me` anonyme
  sans 401 console, case à cocher 48 px.
- [ ] Installation depuis zéro sur machine vierge : **non refaite** → décochée.

## Lancement
```bash
cd duelo && npm install && npm run seed && npm start   # http://localhost:34567
npm test ; node tests/security/check.js ; node tests/load/run.js
```
