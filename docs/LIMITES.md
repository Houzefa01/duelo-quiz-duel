# Limites connues (honnête, au 2026-10-06)

## Non testé
- **Lecteur d'écran réel** : procédure écrite (`docs/TEST-LECTEUR-ECRAN.md`), axe-core à
  0 violation sur 12 écrans, mais aucun passage NVDA/Orca effectué.
- **Service systemd** : `deploy/duelo.service` relu, jamais exécuté (pas de systemd dans
  le conteneur d'essai) ; le timer `duelo-backup.timer` non plus (le `.cron` équivalent
  est fourni mais le déclenchement planifié réel n'a pas tourné 24 h).
- **Windows (PM2 + Caddy)** : section DEPLOY rédigée, jamais exécutée.
- **Certbot en conditions réelles** : HTTPS prouvé avec certificat auto-signé en conteneur ;
  Let's Encrypt sur vrai domaine non rejoué.
- **Montée en charge au-delà de 300 WS** : non mesurée ; p95 de latence 47–60 ms sous
  charge maximale combinée (budget 50 ms) — limite du dimensionnement actuel.
- **ClamAV présent** : tous les tests avec antivirus sont en mode « absent » ; le chemin
  `clamscan` existe dans le code mais n'a jamais scanné un vrai fichier ici.
- **Bascule hebdomadaire un vrai lundi** : logique `weekKey` testée, transition réelle non observée.
- **Moteur jimp en production** : prouvé fonctionnel mais ~10× plus lent que sharp ;
  le worker le rend non bloquant, pas rapide.
- **Navigateurs anciens** : testé sur Chrome moderne (captures, Lighthouse) et Firefox ;
  Safari et vieux mobiles non vérifiés.
- **Sauvegarde 14 jours de rétention** : la rotation est codée, pas observée sur 14 jours.

## Simplifications assumées
- Égalité parfaite : le plus rapide (temps cumulé) gagne, pas de question de départage numérique.
- Forfait : pas de changement Elo, récompense forfaitaire au présent.
- Rangs de lots : R1=5e (tableau 8), approximations sportives standard.
- 240 questions en 39 groupes de variantes (listées dans `docs/QUESTIONS_A_VERIFIER.md`).
- Pas d'avatars animaux au-delà des 12 Twemoji ; pas de GIF animé ; pas d'argent réel.
