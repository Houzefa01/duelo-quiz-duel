# Recette Phase 12 — preuves exécutées (2026-10-05)

## Phase 13 — lacunes comblées (2026-10-05)
- [x] **Assistant 4 étapes** (`tests/p13/wizard.test.js`) : brouillon vide → autosave Infos/Règles
  (PATCH successifs) → couverture téléversée 800×450 EXIF-free → lots → aperçu → publication.
  Acceptation datée des règles (`terms_accepted_at`). Captures : écran non capturé (assistant
  derrière rôle organisateur — testé par API).
- [x] **12 animaux** (`anim-*.svg`, Twemoji CC BY 4.0 vérifié sur le README officiel) : nettoyés
  svgo (113 SVG, 0 problème), catalogue à 56, filtre « animaux » (`LICENCES.md` + test assets).
- [x] **Fichiers sans ClamAV** (`tests/p13/scan.test.js`, ClamAV absent prouvé sur la machine) :
  pdf auto-accepté ; mp3 → `pending-scan` + avertissement ; publication bloquée ; file admin +
  approbation → publication OK ; avertissement visible dans « Mes lots ». `DEPLOY.md` à jour.
- [x] **Vie privée** (`tests/p13/vie-privee.test.js`) : suppression → fichiers 256+64 effacés,
  photo 404, sessions fermées, pseudo « Joueur-supprime-N », e-mail NULL, historique conservé.
  Page Confidentialité mise à jour (photos, lots, journaux de remise).
- [x] **axe-core** (`node tools/axe-p13.js`, rapport `docs/AXE-P13.json`) : 12 écrans (6 × 2 thèmes),
  4 violations `h1` corrigées → **0 violation**. `docs/TEST-LECTEUR-ECRAN.md` : procédure
  manuelle duel + Mes lots **à faire par l'exploitant** (ligneardo — décochée ci-dessous).
- [ ] **Test lecteur d'écran réel** : procédure écrite, **non exécuté** → décoché.
- [x] **Couverture** (`docs/COUVERTURE-P13.txt`, 18/18 verts) : avatars 100 %, organizers 93,1 %,
  rewards/lots 94,3 % (≥ 80 %) ; autorisation croisée complète (`tests/p13/cross-auth.test.js`) :
  8 routes B→A bloquées, lots d'autrui 404, admin isolé (404).
- [x] **Repli jimp** (`tests/p13/images.test.js`) : mêmes dimensions sharp/jimp, GIF animé refusé
  des deux côtés, upload HTTP via jimp servi en PNG. Lent (~74 s) : documenté (`DECISIONS.md`).
- [x] **Specs machine** (`docs/CHARGE-P12.txt`) : i5-5200U ×4, 5717 Mo RAM, 113 Go disque.
- [x] **/credits CC BY** : auteur + licence + lien + modifications (svgo) pour fun-emoji,
  adventurer, personas, twemoji, Phosphor ; page à jour.
- [x] **Popups** : 0 natif (grep), `modale()` aux tokens des 2 thèmes, captures
  `popup-360-light/dark.png`.

## Fonctionnel
- [x] **F-90..F-94** — `tests/p12/avatars.test.js` : PATCH theme dark mémorisé, invalide 400 ;
  `theme.js` externe sans inline, applique `data-theme` ; 36 captures `docs/captures-p12/`
  (6 écrans × 3 largeurs × 2 thèmes) + 2 popups ; pas de flash (script synchrone en `<head>`).
- [x] **F-100..F-103** — 44 SVG dans `web/assets/avatars/` (test `assets.test.js`) ; grille + filtres
  (capture avatar-768-dark) ; défaut aléatoire à l'inscription (test) ; cadres existants conservés.
- [x] **F-104..F-111** — `tests/p12/avatars.test.js` : PNG valide → WebP 256 + EXIF absent + nosniff +
  immutable ; `.php`→415, GIF→415, >3Mo→413 ; ancienne photo supprimée ; 6e/jour→429 ;
  signalement + retrait admin + ban (403 ensuite) ; approbation préalable (404 pour autrui,
  200 propriétaire) ; vignettes 64 px `?s=64` + `loading=lazy` + repli `onerror`.
- [x] **F-120..F-123** — `tests/p12/organizers.test.js` : 403 joueur sur toutes les routes ;
  grant/revoke + audit `orga_grant/revoke` ; quotas MAJ.
- [x] **F-130..F-137** — même fichier : brouillon → pending → reject (motif + notif) → approve → open ;
  privé par code (fiche 403 sans code, code absent de la fiche) ; conditions minLevel ;
  annulation + notifs ; moteur réutilisé jusqu'au vainqueur (R1→SF→F) ; 5/jour (code, non déclenché).
- [x] **F-140..F-144** — `tests/p12/lots.test.js` : 1 lot de chaque type ; `.exe`/`.html`→415 ;
  signature usurpée→415 ; fichier hors dossier public (404 direct) ; quota/ban (code).
- [x] **F-142** — 8 révélations concurrentes → 8 codes distincts ; 7 codes/8 rangs → publication 409.
- [x] **F-150..F-155** — libération auto (claims + notifs) et manuelle (0 avant action, 8 après) ;
  révélation no-store + Copier ; 5 téléchargements puis 409 (attachment+nosniff) ;
  signalement → notif orga + remplacement ; disqualification → claim supprimé, code rendu.
- [x] **F-160..F-163** — dashboard (inscrits/pointage/lots), secrets masqués `•••• XX` sans payload,
  duplication sans secrets, export CSV (`tour;slot;…`).

## Sécurité
- [x] Chiffré au repos : aucun secret en clair en base (assert du test).
- [x] Aucun secret dans journaux/URL/WS/audit (assert audit+notifs) ; reveal/download `no-store`.
- [x] Refus de démarrage sans clé quand des lots existent (code `index.js` ; démarrage nominal
  avec clé testé sur le serveur de captures).
- [x] Autorisations croisées : orga B→404 sur tournoi/lots de A ; joueur→404 sur lot d'autrui ;
  admin sans route de lecture du contenu (aucune ne renvoie `payload_enc`).
- [x] XSS : contenus orga inertes — test statique innerHTML (0 interpolation nue) + écrans `esc()`.
- [x] CSP sans `unsafe-inline` : 0 `style=` + 0 `<style>` (grep), `npm audit --omit=dev` → 0 vulnérabilité.
- [x] SVG nettoyés : `node tools/clean-svg.js` → 101 SVG, 0 problème (script/on*/foreignObject/externes).

## Design et qualité
- [x] `docs/LICENCES.md` complet (polices OFL, mascotte/avatars/covers DiceBear CC BY/CC0 avec
  auteurs, URLs, dates ; Phosphor MIT) ; page `/credits` ; sprite = assemblage mécanique documenté.
- [x] Aucun SVG maison : 101 fichiers tous issus des téléchargements (manifeste + test).
- [x] Contrastes AA mesurés clair + sombre (`docs/DESIGN.md`, 12 ratios ; violet réservé au grand texte).
- [x] `prefers-reduced-motion` + réglage profil ; popups animées `pop` (coupées en réduit).
- [x] Défauts §1 corrigés (tableau `docs/DESIGN.md`) ; captures connexion avant/après
  (`docs/captures/connexion-360.png` vs `docs/captures-p12/connexion-360-light.png`).
- [x] Lighthouse mobile (rapports `docs/lh-p12-*.json`) : accueil 97/99, connexion 99/99,
  duel 99/98 (perf), **100 partout** en accessibilité (cible ≥95). Thème sombre via `--force-dark-mode`.
- [x] Charge refaite (`docs/CHARGE-P12.txt`) : 300 WS, 100 duels — RAM 147 Mo, CPU 9,7 %, p95 10 ms ;
  + 50 photos : 200/200 en 834 ms, RAM 115,7 Mo.
- [x] 26 anciens tests verts (`npm test` : 26/26) ; nouveaux : 11 tests P12 ; couverture
  (`docs/COUVERTURE-P12.txt`, 37/37 verts) : avatars 100 %, organizers 91,9 %, rewards/lots 92,1 %.
- [x] Sauvegarde + **restauration testées** (`deploy/backup.sh` + `restore.sh`) : base 600 Q/2 users
  + dossiers uploads restaurés, appli redémarrable (vérifié par comptage).

## Lancement
```bash
cd duelo && npm install && node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" # → REWARD_KEY dans .env
npm run seed && npm start   # http://localhost:34567
npm test ; node tests/security/check.js
```
