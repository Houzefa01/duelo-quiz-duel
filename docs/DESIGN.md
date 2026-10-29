# Design Duelo — dessin animé (Phase 12, remplace la sérigraphie)

## Corrections des défauts §1 (captures connexion 360/768/1280)
| Défaut constaté | Correction livrée |
|---|---|
| Nav bureau répartie sur toute la hauteur, vides énormes | Rail latéral compact groupé en haut (logo + 5 liens), profil/thème en bas (`.bas`), contenu centré 1100 px |
| Pas de logo, barre bleue vide | Logo « pastille D + Duelo », bouton thème ☀/☾, chip joueur (avatar, pièces, niveau) |
| Contenu collé à gauche, vide à droite | `.layout{max-width:1100px;margin:auto}` |
| Case 13 ans native, énorme, mal alignée, toujours visible | `input.grosse` 44 px + `.ligne-check`, **onglet création uniquement** |
| Bouton unique ambigu | Onglets Connexion / Créer un compte, boutons « Se connecter » / « Créer mon compte » |
| Aucune identité | Mascotte fun-emoji + bulle BD sur connexion et accueil |
| Libellé/champ serrés, pas d'affichage mdp, pas d'autocomplete, pas de règles | `.fl` 16/6 px, bouton 👁, `autocomplete` username/current|new-password/email, `.regle-mdp` |
| Bouton 2 lignes à 360 px | Texte court par onglet, Lilita 22 px |
| « Duelo » petit texte sans logo (mobile/tablette) | Logo pastille + nom dans la barre haute |

## Tokens et contrastes mesurés (WCAG AA, calculés par luminance relative)
Clair : contour/blanc 16,63 · contour/soleil 10,75 · contour/ciel 7,53 · contour/menthe 8,32 ·
contour/tomate 5,45 · contour/rose 7,47 · contour/fond 14,52 (tous ≥ 4,5 ✓).
Blanc/violet 3,96 : réservé au grand texte (boutons Lilita ≥ 19 px, seuil 3:1 ✓).
Liens : couleur contour soulignés (le ciel #3FB8FF sur blanc ne fait que ~2,2:1, donc jamais en texte).
Sombre : texte/surface 12,72 · soleil/surface 9,01 · ciel/surface 6,31 (✓) ; cartes : contour + liseré blanc 18 %.
Règle : texte sur soleil/ciel/menthe/tomate/rose toujours `--contour`, jamais blanc.

## États par écran
Chargement : squelettes. Vide : « Aucun duel pour l’instant. Lance le premier. »
Erreurs : problème + solution (« Ce pseudo est déjà pris. Essaie-en un autre. »).
Mascotte : bulles < 12 mots, jamais seule porteuse d'info (aria-live répète l'info).

## Mouvement
120 ms appui, 260 ms états, 700 ms face-à-face max. Courbe rebond `cubic-bezier(.34,1.56,.64,1)`.
Bouton d'accueil « respire » 1 fois (pas de boucle). Confetti victoire : 60 particules CSS, 3,4 s.
`prefers-reduced-motion` + réglage « Animations réduites » (`data-motion="reduced"`, mémorisé en profil).
