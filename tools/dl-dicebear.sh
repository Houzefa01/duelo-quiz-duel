#!/bin/bash
# Télécharge les SVG DiceBear (styles aux licences vérifiées) + manifeste.
# CC BY 4.0 : adventurer (Lisa Wischofsky), personas (Draftbit), fun-emoji (Davis Uche)
# CC0 1.0   : notionists (Zoish), open-peeps (Pablo Stanley), lorelei (Lisa Wischofsky)
set -u
cd /home/Hsavatra/duelo
API="https://api.dicebear.com/10.x"
MANIFEST="web/assets/MANIFESTE-DICEBEAR.txt"
echo "# Manifeste DiceBear — téléchargé le $(date -u +%F)" > "$MANIFEST"
get() { # style seed fichier auteur licence categorie
  local url="$API/$1/svg?seed=$2"
  if curl -sfL --max-time 30 "$url" -o "$3"; then
    echo "$3 | style=$1 seed=$2 | auteur=$4 | licence=$5 | cat=$6 | $url" >> "$MANIFEST"
    echo "OK $3"
  else
    echo "ÉCHEC $3 ($url)" >&2
    return 1
  fi
  sleep 0.5
}
for i in $(seq 1 14); do get adventurer "Duel-A$i" "web/assets/avatars/personnage-a$i.svg" "Lisa Wischofsky" "CC BY 4.0" personnages || exit 1; done
for i in $(seq 1 6); do get personas "Duel-P$i" "web/assets/avatars/personnage-p$i.svg" "Draftbit" "CC BY 4.0" personnages || exit 1; done
for i in $(seq 1 8); do get notionists "Duel-N$i" "web/assets/avatars/clas-n$i.svg" "Zoish" "CC0 1.0" personnages || exit 1; done
for i in $(seq 1 8); do get open-peeps "Duel-O$i" "web/assets/avatars/fanta-o$i.svg" "Pablo Stanley" "CC0 1.0" fantaisie || exit 1; done
for i in $(seq 1 4); do get lorelei "Duel-L$i" "web/assets/avatars/fanta-l$i.svg" "Lisa Wischofsky" "CC0 1.0" fantaisie || exit 1; done
for i in $(seq 1 4); do get fun-emoji "Duel-E$i" "web/assets/avatars/creat-e$i.svg" "Davis Uche" "CC BY 4.0" creatures || exit 1; done
for i in $(seq 1 8); do get fun-emoji "Mascotte-$i" "web/assets/mascotte/candidat-$i.svg" "Davis Uche" "CC BY 4.0" mascotte || exit 1; done
for i in $(seq 1 6); do get open-peeps "Cover-$i" "web/assets/covers/couv-$i.svg" "Pablo Stanley" "CC0 1.0" couverture || exit 1; done
echo "TERMINÉ : $(ls web/assets/avatars/*.svg | wc -l) avatars, $(ls web/assets/mascotte/*.svg | wc -l) candidats mascotte, $(ls web/assets/covers/*.svg | wc -l) couvertures"
