# Test lecteur d'écran — procédure manuelle (à faire par l'exploitant)

Outil suggéré : NVDA (Windows, gratuit) ou Orca (Linux) + Firefox/Chrome.
Pré-requis : 2 comptes (`NVDA-A`, `NVDA-B`), serveur local `http://localhost:34567`.

## A. Flux de duel (10 questions)
1. Connecte `NVDA-A`, va sur Jouer, active « Lancer un duel ».
2. Connecte `NVDA-B` (autre navigateur/profil), même action → les 2 sont appariés.
3. Vérifie que le lecteur annonce, dans l'ordre :
   - « Duel trouvé contre … » ;
   - à chaque question : « Question N sur 10. … » (zone `aria-live="polite"` `#live`) ;
   - après réponse : « Bonne réponse. » ou « Mauvaise réponse. Bonne réponse : … » ;
   - à 5 s et 3 s restantes (si le temps dépasse) : annonces de temps ;
   - fin : « Victoire », scores, Elo, récompenses (contenu de l'écran, pas seulement visuel).
4. Navigue au clavier seul (Tab + Entrée, ou touches 1-2-3-4 sur les boutons) :
   chaque bouton de réponse reçoit le focus visible (contour violet 3 px).
5. Contrôle : aucune information n'est donnée uniquement par la couleur
   (chaque juste/faux a ✓/✗ + libellé), aucun contenu transmis par le seul son.

## B. « Mes lots » (gagnant de tournoi)
1. Fais gagner un tournoi d'organisateur à `NVDA-A` avec un lot `secret`.
2. Connecté en `NVDA-A`, ouvre Profil → « Mes lots ».
3. Vérifie : le libellé public est lu, le contenu secret n'apparaît nulle part
   avant activation de « Révéler mon lot » ; après activation, le contenu est lu
   et le bouton « Copier » est atteignable au clavier.
4. Vérifie que l'avertissement antivirus (lot fichier non scanné) est lu
   avant le bouton de téléchargement.

## C. Grille de succès
- [ ] Chaque étape ci-dessus annoncée sans aide visuelle.
- [ ] Focus toujours visible et logique (pas de piège clavier dans la modale :
  Échap ferme, le focus revient au bouton d'ouverture — à vérifier).
- [ ] Noter ici date, outil, version, verdict : …………………
