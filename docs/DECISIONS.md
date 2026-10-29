# Décisions (options par défaut du cahier des charges)

1. **bcryptjs coût 12** au lieu d'argon2 natif : pas de compilation sur vieux PC,
   coût identique (≥12), documenté ici.
2. **`ws` au lieu de Socket.IO** : 5× plus léger, protocole JSON maison identique au contrat §7.5.
3. **Pas d'étape build** : front vanilla servi tel quel (esbuild non nécessaire, 0 dépendance).
4. **Planificateur interne** (`setInterval` 30 s) au lieu de `node-cron` : une dépendance en moins.
5. **Port 34567** : vérifié libre (`ss` + `node:net`) avant écoute ; le serveur refuse de démarrer si occupé.
6. **Fantôme** : adversaire `role='ghost'` nommé `Fantome-<elo>`, réponses simulées 75/55/35 % selon difficulté, identifié `(fantôme)`.
7. **Égalité parfaite** : le plus rapide (temps cumulé) gagne — variante documentée du départage.
8. **Polices** : Bricolage Grotesque + Instrument Sans **téléchargées une fois** (instances
   statiques latines woff2, licences OFL) et auto-hébergées dans `web/assets/fonts/`
   (voir `LISEZMOI.txt`). Aucune requête Google Fonts à l'exécution. Poids total 93 Ko.
9. **Sons** : stubs `ogg/mp3` à fournir ; structurés dans `web/assets/sounds/`, désactivés par défaut.
10. **better-sqlite3 v13** (au lieu de v11) : la v11 ne compile pas sous Node 26
    (API V8 `GetPrototype`/`This` supprimées, constaté au build). La v13 fournit
    des prebuilds Node 26. API inchangée pour notre usage.
11. **Phase 12 — catégories d'avatars** : le cahier suggère personnages/animaux/fantaisie ;
    les styles SVG à licence claire disponibles donnent des humains et créatures :
    filtres = personnages (adventurer, personas, notionists), fantaisie (open-peeps, lorelei),
    créatures (fun-emoji). Pas d'animaux : aucun style animalier SVG en CC0/CC BY trouvé.
12. **Phase 12 — refus de démarrage sans clé** : si des lots chiffrés existent en base et que
    `REWARD_KEY` est absente/invalide, `server/index.js` quitte (code 1). Sans lots, simple
    avertissement + lots désactivés (503).
13. **Phase 12 — rangs de tournoi pour les lots** : tableau de 8 → R1=5e, SF=3e, F=2e ;
    16 → R1=9e, R2=5e ; 32 → R1=17e, R2=9e, QF=5e.
14. **Phase 12 — popups** : `alert/confirm/prompt` natifs interdits ; `modale()` cartoon
    (carte surface, contour, mascotte optionnelle, focus + Échap, `window.__duelo` pour tests).
15. **Phase 13 — repli jimp** : `server/lib/images.js` (`AVATAR_ENGINE=sharp|jimp|auto`).
    jimp prouvé fonctionnel mais **~10× plus lent** (upload 100 px : ~74 s en test contre ~2 s
    sharp). Sortie PNG (pas de WebP chez jimp). Recommandé : sharp en production.
16. **Phase 13 — animaux** : 12 Twemoji (CC BY 4.0, graphismes). Rien d'autre à licence claire
    trouvé en SVG (Kenney = PNG, OpenClipart/OpenGameArt = licences par fichier floues).
