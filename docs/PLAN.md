# Plan Duelo — architecture, tokens, phases

## 1. Architecture
Monolithe Node 20 + Fastify, SQLite WAL (`better-sqlite3`), WebSocket `ws` sur `/live`,
front vanilla ES modules (aucun build, fichiers servis tels quels). Serveur autoritaire
pour les duels (machine à états `WAITING→MATCHED→COUNTDOWN→QUESTION→REVEAL→FINISHED`).
Jobs internes toutes les 30 s (tournoi du samedi, hebdo, défis d'amis, bonus défi du jour).

## 2. Modules serveur
`auth` (register/login/cookies/recovery/invité) · `users` (profil/export/suppression) ·
`friends` · `duels` (picker 4/4/2 + anti-répétition 50 + moteur + scoring) ·
`matchmaking` (fenêtre ±100 +50/5s → ±400, fantôme à 20 s) · `ranking` (4 scopes) ·
`rewards` (coffre/boutique/badges/ledger) · `challenges` (quotidiens/hebdo/run/amis) ·
`tournaments` (arbre + byes + best-of-3 finale) · `questions` (propose/vote/signalement) ·
`admin` (métriques/modération/sanctions/audit).

## 3. Tokens design
Voir `web/styles/tokens.css` : outremer #2338E0, encre #0B1033, citron #FFD93D,
glace #F3F5FF, menthe #2EE6A6, corail #FF5A4F. Coupe diagonale unique 12°,
bordures 3px + ombre dure 6px, grille 4px, Bricolage Grotesque + Instrument Sans
auto-hébergées. Barre de tension = élément mémorable.

## 4. Revue du plan vs cahier des charges (auto-critique)
- Risque "quiz générique" : la barre de tension + bandeaux diagonaux + duo citron/glace
  systématique sont imposés sur TOUS les écrans (pas seulement le duel) → changé :
  ajout de la règle "local=citron/adversaire=glace partout" dans base.css et le client.
- Risque "SaaS pastel" : interdit les ombres douces/dégradés dans le CSS (bordures
  épaisses + ombres dures uniquement).
- Risque "temps non mesuré serveur" : `qStart` serveur + compensation latence ping/pong
  plafonnée 150 ms, réponses hors fenêtre ignorées.
- Risque "600 questions bâclées" : générateur déterministe à base de faits stables
  (capitales, dates, sciences) avec sources ; `verified=1` car vérifiables.

## 5. Phases
Voir `docs/PHASES.md`. Chaque phase : tests verts + démo manuelle.
