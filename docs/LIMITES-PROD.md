# Limites production (honnête, 2026-10-06)

- **p95 latence sous charge maximale combinée** : 47–60 ms pour un budget de 50 ms
  (mesuré hors prod). En usage réel (quelques dizaines de joueurs), marge large.
- **Tunnel Cloudflare** : le chemin SSH et le tunnel jeu dépendent du démon `cloudflared`
  (service actif, mais géré hors dépôt). Après le reboot du 2026-10-06, le site est
  revenu seul ; le chemin SSH d'admin a mis ~20 min à revenir (cause non identifiée,
  probablement reconnexion lente du tunnel d'accès).
- **Tokens de tunnels visibles** dans `ps aux` (lancés avec `--token` en ligne de
  commande par l'exploitant précédent). Recommandé : passer aux fichiers de secrets
  (`cloudflared tunnel --credentials-file`) puis révoquer/regénérer les tokens.
- **Mot de passe SSH en clair** (`123456789`) : fourni par l'exploitant pendant
  l'installation, simple et devinable. Recommandé : basculer sur clé uniquement
  (déjà testé : la clé `debian_control` ne passe pas — à configurer côté serveur).
- **Sauvegarde 14 jours** : rotation codée, non observée sur 14 jours.
- **Montée en charge réelle** : dimensionné pour 300 joueurs simultanés (testé) ;
  au-delà, non mesuré.
- **Reprise après crash applicatif** : systemd relance (Restart=always) ; duels
  annulés sans pénalité (prouvé par kill -9 en pré-prod, pas encore en prod).
- **ClamAV absent** : fichiers `zip/docx/xlsx/pptx/mp3/mp4/csv/gif` en validation
  admin manuelle (prouvé) ; pas de scan antivirus réel.
- **Navigateurs anciens / Safari** : non vérifiés.
