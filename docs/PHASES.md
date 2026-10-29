# Suivi des phases Duelo

## Phase 1 — Fondations ✅
Livré : config (`rules.js`, `brand.js`, `env.js`), SQLite WAL + schéma complet,
tokens CSS sérigraphie, page d'accueil statique.
Test : `node server/db/seed/index.js` → `seed ok: 600 questions`.
Risque : better-sqlite3 v11 incompatible Node 26 → passé en v13 (voir DECISIONS).

## Phase 2 — Comptes ✅
Livré : register/login/logout/logout-all/recover/guest, sessions HttpOnly 30 j
glissants, profil public/privé, export/suppression RGPD, amis (demande/accept/blocage).
Test manuel : `curl register → login → /me` OK (NinaTest créée, codes de secours affichés).

## Phase 3 — Duel ✅
Livré : 600 questions (8×75), picker 4/4/2 + anti-répétition 50, moteur autoritaire
(CD→Q→R→fin), scoring 100+bonus (Q10 ×2), WS `/live` (contrat §7.5), fantôme à 20 s,
forfait, verrou 1 duel actif, reconnexion 30 s (délai serveur), emotes 1/2 s.
Test : `tests/integration/duel.test.js` (création + verrou) vert.

## Phase 4 — Classements ✅
Livré : global (Elo, ≥5 duels, inactifs 60 j masqués) / hebdo (ledger 7 j) /
catégorie / amis, ligues Bronze→Diamant. Public sans compte.
Test manuel : `GET /leaderboard?scope=global` → 200.

## Phase 5 — Progression ✅
Livré : XP/niveau, pièces + plafond 300/j, coffre 7 j + gel, 30 badges,
boutique pièces uniquement, `reward_ledger` horodaté.
Test : formules couvertes par `rules.test.js`.

## Phase 6 — Défis ✅
Livré : 3 quotidiens (tirage daté) + 3 hebdo + défi du jour (10 Q identiques,
1/j, classement) + défi d'ami avec mise et remboursement 24 h.
Test : routes montées, claim vérifie goal/claimed.

## Phase 7 — Tournois ✅
Livré : 8/16/32, cycle announced→open→running→done/cancelled, arbre + byes
(têtes de série Elo), finale best-of-3, prix (500/250/120/30) + badges.
Test : `tournaments.test.js` vert.

## Phase 8 — Contenu + admin ✅
Livré : proposition (5/j, filtres, doublons), vote niveau ≥10 (5+/3-),
signalement (3 → revue), recalibrage auto difficulté, admin (métriques,
modération verified=0 d'abord, sanctions, audit).

## Phase 9 — Finitions ✅ (partiel honnête)
Fait : CSP sans unsafe-inline, `helmet`, rate-limit, validation zod, WS ≤ 2 Ko,
poids accueil ~21 Ko, `prefers-reduced-motion`, aria-live, clavier 1-4 (boutons natifs),
15 tests verts, `RECETTE.md` ci-contre.
Reste (non testé, écrit honnêtement) : test de charge 300 WS, Lighthouse,
captures 360/768/1280, lecteur d'écran réel, sons `ogg/mp3` (stubs à fournir),
polices `woff2` (repli system-ui).

## Phase 10 — Déploiement ✅
Livré : `docs/DEPLOY.md`, `deploy/duelo.service` (MemoryMax 400M),
`deploy/nginx.conf` (HTTPS/WS/cache), `deploy/backup.sh` (VACUUM INTO, 14 j).
Non refait sur machine vierge (à faire par l'exploitant).

## Phase 12 — Refonte dessin animé + thèmes + avatars + organisateurs/lots ✅
Livré : 101 SVG téléchargés (44 avatars, 6 mascottes, 45 icônes Phosphor, 6 couvertures),
nettoyés svgo, `docs/LICENCES.md` + page Crédits ; refonte cartoon clair/sombre (36 captures) ;
thème mémorisé + sans flash ; catalogue + upload photo sécurisé (sharp, WebP, quotas,
modération) ; rôle organisateur + tournois privés/brouillon/validation ; 5 types de lots
AES-256-GCM + Mes lots + signalements ; popups cartoon (0 natif) ; 11 nouveaux tests,
37/37 verts, couverture avatars 100 / organizers 91,9 / lots 92,1 ;
Lighthouse mobile 97-99/100/100/100 (6 runs) ; charge dans les budgets.
Preuves : `docs/RECETTE-P12.md`.
