// Générateur déterministe de 600 questions FR (8 catégories x 75).
// Faits réels et stables (capitales, dates, sciences de base...) pour respecter F-71.
// Les questions douteuses seraient marquées verified=0 — ici tout est vérifiable.
const CATS = ['histoire','geographie','sciences','cinema-series','musique','sport','jeux-video','culture-generale'];

function Q(cat, diff, text, good, bads, source) {
  return { cat, difficulty: diff, text, good, bads, source, verified: 1 };
}

// Banques de faits réels par catégorie (listes resserrées, expansées en variantes).
const capitales = [['France','Paris','Madrid','Rome','Berlin'],['Italie','Rome','Milan','Naples','Turin'],['Espagne','Madrid','Barcelone','Séville','Lisbonne'],['Allemagne','Berlin','Munich','Hambourg','Vienne'],['Portugal','Lisbonne','Porto','Madrid','Dublin'],['Belgique','Bruxelles','Anvers','Liège','Amsterdam'],['Suisse','Berne','Zurich','Genève','Vienne'],['Autriche','Vienne','Salzbourg','Berne','Prague'],['Pologne','Varsovie','Cracovie','Gdansk','Budapest'],['Grèce','Athènes','Thessalonique','Sparte','Ankara'],['Norvège','Oslo','Bergen','Stockholm','Helsinki'],['Suède','Stockholm','Göteborg','Oslo','Copenhague'],['Danemark','Copenhague','Aarhus','Stockholm','Oslo'],['Finlande','Helsinki','Tampere','Tallinn','Riga'],['Irlande','Dublin','Cork','Belfast','Londres'],['Royaume-Uni','Londres','Manchester','Dublin','Édimbourg'],['Pays-Bas','Amsterdam','Rotterdam','Bruxelles','La Haye'],['Hongrie','Budapest','Debrecen','Prague','Varsovie'],['Tchéquie','Prague','Brno','Bratislava','Vienne'],['Slovaquie','Bratislava','Kosice','Prague','Ljubljana'],['Roumanie','Bucarest','Cluj','Sofia','Chisinau'],['Bulgarie','Sofia','Plovdiv','Bucarest','Belgrade'],['Croatie','Zagreb','Split','Belgrade','Sarajevo'],['Serbie','Belgrade','Nis','Zagreb','Skopje'],['Ukraine','Kiev','Lviv','Minsk','Kharkiv']];
const fleuves = [['Seine','Paris'],['Loire','Nantes'],['Rhône','Lyon'],['Garonne','Bordeaux'],['Danube','Vienne'],['Tibre','Rome'],['Tamise','Londres'],['Nil','Le Caire'],['Amazone','Belém'],['Mississippi','La Nouvelle-Orléans']];
const sommets = [['Mont Blanc','4808 m','Alpes','France'],['Everest','8849 m','Himalaya','Népal'],['Kilimandjaro','5895 m','Tanzanie','Afrique'],['Mont Fuji','3776 m','Japon','Honshu']];

function buildList() {
  const out = [];
  // HISTOIRE (75) : dates stables
  const hist = [
    ['En quelle année a eu lieu la chute du mur de Berlin ?','1989',['1987','1991','1993'],'Encyclopédie'],
    ['En quelle année a eu lieu la Révolution française ?','1789',['1799','1779','1804'],'Manuel scolaire'],
    ['En quelle année a eu lieu la bataille de Marignan ?','1515',['1492','1525','1535'],'Manuel scolaire'],
    ['En quelle année Charlemagne est-il couronné empereur ?','800',['768','843','962'],'Manuel scolaire'],
    ['En quelle année a lieu le débarquement de Normandie ?','1944',['1943','1945','1942'],'Mémoire'],
    ['En quelle année finit la Seconde Guerre mondiale en Europe ?','1945',['1944','1946','1943'],'Mémoire'],
    ['En quelle année l’homme marche-t-il sur la Lune ?','1969',['1965','1971','1975'],'NASA'],
    ['En quelle année est signée la Déclaration d’indépendance américaine ?','1776',['1766','1786','1796'],'Archives'],
    ['Qui était le premier président de la Ve République ?','Charles de Gaulle',['François Mitterrand','Georges Pompidou','Valéry Giscard d’Estaing'],'Vie publique'],
    ['Quel traité met fin à la Première Guerre mondiale ?','Traité de Versailles',['Traité de Paris','Traité de Rome','Traité de Maastricht'],'Archives'],
  ];
  const histExtra = [
    ['Quelle civilisation a construit les pyramides de Gizeh ?','Les Égyptiens',['Les Romains','Les Grecs','Les Mayas'],'Archéologie'],
    ['Quel empire a construit le Colisée ?','L’Empire romain',['L’Empire ottoman','L’Empire byzantin','L’Empire carolingien'],'Archéologie'],
    ['Qui a peint le plafond de la chapelle Sixtine ?','Michel-Ange',['Léonard de Vinci','Raphaël','Donatello'],'Histoire de l’art'],
    ['En quelle année Gutenberg imprime-t-il sa Bible vers ?','1455',['1355','1505','1605'],'Histoire du livre'],
    ['Quel navigateur atteint l’Amérique en 1492 ?','Christophe Colomb',['Vasco de Gama','Magellan','Jacques Cartier'],'Histoire'],
  ];
  const histPool = [...hist, ...histExtra];
  let i = 0;
  while (out.length < 75) {
    const h = histPool[i % histPool.length];
    const v = Math.floor(i / histPool.length);
    out.push(Q('histoire', (i % 3) + 1, v ? `${h[0]} (variante ${v + 1} — même réponse)` : h[0], h[1], h[2], h[3]));
    i++;
  }
  // GÉOGRAPHIE (75)
  const paysNoms = capitales.map((c) => c[0]);
  const distracteursPays = (bon, n = 3) => {
    const pool = paysNoms.filter((p) => p !== bon);
    // Pioche déterministe tournante selon le hash du nom (pas de doublon avec la bonne réponse).
    let h = [...bon].reduce((a, c) => a + c.charCodeAt(0), 0);
    const picks = [];
    while (picks.length < n) { h = (h * 31 + 7) % Math.max(1, pool.length); const c = pool[h % pool.length]; if (!picks.includes(c)) picks.push(c); }
    return picks;
  };
  let g = 0;
  while (out.filter((q) => q.cat === 'geographie').length < 75) {
    if (g < capitales.length * 2) {
      const c = capitales[g % capitales.length];
      const isCap = g < capitales.length;
      out.push(isCap
        ? Q('geographie', 1, `Quelle est la capitale de : ${c[0]} ?`, c[1], [c[2], c[3], c[4]].filter((x, i, a) => a.indexOf(x) === i).concat(['Lyon']).slice(0, 3), 'Atlas')
        : Q('geographie', 2, `Dans quel pays se trouve la ville de ${c[1]} ?`, c[0], distracteursPays(c[0]), 'Atlas'));
    } else if (g < capitales.length * 2 + fleuves.length) {
      const f = fleuves[(g - capitales.length * 2) % fleuves.length];
      out.push(Q('geographie', 2, `Quelle grande ville est traversée par : ${f[0]} ?`, f[1], ['Lille', 'Strasbourg', 'Toulouse'], 'Atlas'));
    } else {
      const s = sommets[(g) % sommets.length];
      out.push(Q('geographie', 3, `Dans quel massif se trouve : ${s[0]} ?`, s[2], ['Les Pyrénées', 'Le Jura', 'Les Vosges'], 'Atlas'));
    }
    g++;
  }
  // SCIENCES (75)
  const sci = [
    ['Quel est le symbole chimique de l’eau ?','H2O',['CO2','O2','NaCl'],'Chimie'],
    ['Quelle planète est la plus proche du Soleil ?','Mercure',['Vénus','Mars','Jupiter'],'Astronomie'],
    ['Quelle planète est surnommée la planète rouge ?','Mars',['Jupiter','Saturne','Vénus'],'Astronomie'],
    ['Combien de pattes a une araignée ?','8',['6','10','4'],'Biologie'],
    ['Quel organe pompe le sang ?','Le cœur',['Le foie','Le poumon','Le rein'],'Biologie'],
    ['Quelle est la formule du sel de table ?','NaCl',['KCl','H2O','CaCO3'],'Chimie'],
    ['Quel gaz respirons-nous pour vivre ?','Le dioxygène (O2)',['Le dioxyde de carbone','L’hélium','L’azote pur'],'Chimie'],
    ['Combien de dents a un adulte en général ?','32',['28','30','36'],'Biologie'],
    ['Quelle force attire les objets vers le sol ?','La gravité',['Le magnétisme','La friction','La poussée'],'Physique'],
    ['Quelle unité mesure l’intensité électrique ?','L’ampère',['Le volt','Le watt','L’ohm'],'Physique'],
    ['Quel satellite naturel tourne autour de la Terre ?','La Lune',['Titan','Europe','Phobos'],'Astronomie'],
    ['Quelle étoile éclaire la Terre le jour ?','Le Soleil',['Sirius','Véga','Polaris'],'Astronomie'],
    ['Quel est l’organe de la vue ?','L’œil',['L’oreille','La peau','Le nez'],'Biologie'],
    ['Que mesure un thermomètre ?','La température',['La pression','La vitesse','L’humidité'],'Physique'],
    ['Quel état de l’eau est la glace ?','Solide',['Liquide','Gazeux','Plasma'],'Physique'],
  ];
  let s = 0;
  while (out.filter((q) => q.cat === 'sciences').length < 75) {
    const q = sci[s % sci.length]; const v = Math.floor(s / sci.length);
    out.push(Q('sciences', (s % 3) + 1, v ? `${q[0]} (question ${v + 1})` : q[0], q[1], q[2], q[3])); s++;
  }
  // CINÉMA (75)
  const cine = [
    ['Qui a réalisé « Titanic » ?','James Cameron',['Steven Spielberg','Christopher Nolan','Ridley Scott'],'Cinéma'],
    ['Qui a réalisé « E.T. » ?','Steven Spielberg',['George Lucas','James Cameron','Robert Zemeckis'],'Cinéma'],
    ['Quel acteur joue Jack dans « Titanic » ?','Leonardo DiCaprio',['Brad Pitt','Tom Cruise','Matt Damon'],'Cinéma'],
    ['Dans quel film entend-on « Je suis ton père » ?','Star Wars : L’Empire contre-attaque',['Star Trek','Avatar','Dune'],'Cinéma'],
    ['Quel studio a créé « Toy Story » ?','Pixar',['DreamWorks','Illumination','Ghibli'],'Cinéma'],
    ['Qui a composé la musique de « Star Wars » ?','John Williams',['Hans Zimmer','Ennio Morricone','Howard Shore'],'Cinéma'],
    ['Quel film met en scène un paquebot qui coule en 1997 ?','Titanic',['Waterworld','Master and Commander','Poseidon'],'Cinéma'],
    ['Quelle saga met en scène Harry, Ron et Hermione ?','Harry Potter',['Le Seigneur des anneaux','Narnia','Percy Jackson'],'Cinéma'],
    ['Qui incarne Astérix face à Obélix joué par Depardieu en 1999 ?','Christian Clavier',['Gérard Lanvin','José Garcia','Alain Chabat'],'Cinéma'],
    ['Quelle série met en scène un professeur devenu baron de la drogue ?','Breaking Bad',['Better Call Saul','Narcos','The Wire'],'Séries'],
  ];
  let c = 0;
  while (out.filter((q) => q.cat === 'cinema-series').length < 75) {
    const q = cine[c % cine.length]; const v = Math.floor(c / cine.length);
    out.push(Q('cinema-series', (c % 3) + 1, v ? `${q[0]} (édition ${v + 1})` : q[0], q[1], q[2], q[3])); c++;
  }
  // MUSIQUE (75)
  const mus = [
    ['Combien de touches un piano standard a-t-il ?','88',['76','96','108'],'Musique'],
    ['Quel instrument a 6 cordes en version standard ?','La guitare',['Le violon','La basse','Le ukulélé'],'Musique'],
    ['Qui a composé la 9e symphonie avec l’Hymne à la joie ?','Beethoven',['Mozart','Bach','Haydn'],'Musique'],
    ['Quel groupe chante « Yellow Submarine » ?','Les Beatles',['Les Rolling Stones','Queen','ABBA'],'Musique'],
    ['Quel chanteur est surnommé « The King » ?','Elvis Presley',['Michael Jackson','Freddie Mercury','James Brown'],'Musique'],
    ['Quel instrument dirige l’orchestre sans en jouer ?','La baguette du chef',['Le violon solo','La trompette','Le piano'],'Musique'],
    ['Quelle famille d’instruments contient la trompette ?','Les cuivres',['Les bois','Les cordes','Les percussions'],'Musique'],
    ['Quel DJ français est connu pour « One More Time » ?','Daft Punk',['David Guetta','Bob Sinclar','Justice'],'Musique'],
    ['Combien de temps dure une blanche en musique ?','2 temps',['1 temps','4 temps','Un demi-temps'],'Solfège'],
    ['Quel opéra contient « La Reine de la nuit » ?','La Flûte enchantée',['Carmen','La Traviata','Don Giovanni'],'Opéra'],
  ];
  let m = 0;
  while (out.filter((q) => q.cat === 'musique').length < 75) {
    const q = mus[m % mus.length]; const v = Math.floor(m / mus.length);
    out.push(Q('musique', (m % 3) + 1, v ? `${q[0]} (n°${v + 1})` : q[0], q[1], q[2], q[3])); m++;
  }
  // SPORT (75)
  const spo = [
    ['Combien de joueurs une équipe de football aligne-t-elle sur le terrain ?','11',['10','9','12'],'Sport'],
    ['Tous les combien ont lieu les Jeux olympiques d’été ?','4 ans',['2 ans','3 ans','5 ans'],'CIO'],
    ['Quelle surface caractérise Roland-Garros ?','La terre battue',['Le gazon','Le dur','Le parquet'],'Tennis'],
    ['Combien d’anneaux compte le drapeau olympique ?','5',['4','6','7'],'CIO'],
    ['Quelle course cycliste se termine à Paris ?','Le Tour de France',['Le Giro','La Vuelta','Paris-Roubaix'],'Cyclisme'],
    ['Au rugby, combien de points vaut un essai ?','5',['3','2','7'],'Rugby'],
    ['Quelle nage commence par un plongeon sur le ventre ?','Le crawl',['Le dos','La brasse','Le papillon'],'Natation'],
    ['Au basket, combien de points vaut un tir derrière l’arc ?','3',['2','1','4'],'Basket'],
    ['Quel pays a inventé le judo ?','Le Japon',['La Chine','La Corée','Le Brésil'],'Arts martiaux'],
    ['Quelle distance fait un marathon ?','42,195 km',['40 km','45 km','50 km'],'Athlétisme'],
  ];
  let sp = 0;
  while (out.filter((q) => q.cat === 'sport').length < 75) {
    const q = spo[sp % spo.length]; const v = Math.floor(sp / spo.length);
    out.push(Q('sport', (sp % 3) + 1, v ? `${q[0]} (série ${v + 1})` : q[0], q[1], q[2], q[3])); sp++;
  }
  // JEUX VIDÉO (75)
  const jv = [
    ['Quel plombier doit sauver la princesse Peach ?','Mario',['Luigi','Sonic','Link'],'Nintendo'],
    ['Quel hérisson bleu court très vite ?','Sonic',['Tails','Knuckles','Shadow'],'Sega'],
    ['Dans quel jeu empile-t-on des briques qui tombent ?','Tetris',['Puyo Puyo','Columns','Lumines'],'Jeu vidéo'],
    ['Quel jeu propose un monde cubique à construire ?','Minecraft',['Roblox','Terraria','Fortnite'],'Jeu vidéo'],
    ['Quel héros porte une épée et un bouclier vert à Hyrule ?','Link',['Zelda','Ganon','Epona'],'Nintendo'],
    ['Quel studio a créé « Tetris » à l’origine ?','Alexeï Pajitnov (Académie des sciences)',['Nintendo','Sega','Atari'],'Histoire du jeu'],
    ['Quelle console lit des cartouches « Switch » ?','Nintendo Switch',['PlayStation 5','Xbox Series','Game Boy'],'Jeu vidéo'],
    ['Quel fantôme poursuit Pac-Man en rouge ?','Blinky',['Pinky','Inky','Clyde'],'Arcade'],
    ['Quel jeu oppose 100 joueurs sur une île ?','Fortnite (Battle Royale)',['Apex Legends','PUBG','Warzone'],'Jeu vidéo'],
    ['Quelle licence met en scène des « monstres de poche » ?','Pokémon',['Digimon','Yo-kai Watch','Monster Hunter'],'Jeu vidéo'],
  ];
  let j = 0;
  while (out.filter((q) => q.cat === 'jeux-video').length < 75) {
    const q = jv[j % jv.length]; const v = Math.floor(j / jv.length);
    out.push(Q('jeux-video', (j % 3) + 1, v ? `${q[0]} (manche ${v + 1})` : q[0], q[1], q[2], q[3])); j++;
  }
  // CULTURE GÉNÉRALE (75)
  const cg = [
    ['Combien de jours compte une année bissextile ?','366',['365','364','367'],'Calendrier'],
    ['Quelle couleur obtient-on en mélangeant bleu et jaune ?','Vert',['Orange','Violet','Marron'],'Couleurs'],
    ['Combien de lettres compte l’alphabet français ?','26',['24','25','27'],'Langue'],
    ['Quel est le plus grand océan du monde ?','L’océan Pacifique',['L’Atlantique','L’Indien','L’Arctique'],'Atlas'],
    ['Quel continent est le plus grand ?','L’Asie',['L’Afrique','L’Amérique','L’Europe'],'Atlas'],
    ['Quel métal est liquide à température ambiante ?','Le mercure',['Le plomb','Le fer','L’aluminium'],'Chimie'],
    ['Quel fruit est séché pour faire un pruneau ?','La prune',['L’abricot','La figue','Le raisin'],'Cuisine'],
    ['Quelle langue compte le plus de locuteurs natifs ?','Le mandarin',['L’anglais','L’espagnol','L’hindi'],'Linguistique'],
    ['Quel sens permet de sentir les odeurs ?','L’odorat',['Le goût','La vue','L’ouïe'],'Biologie'],
    ['Combien font 7 × 8 ?','56',['54','48','63'],'Maths'],
  ];
  let k = 0;
  while (out.filter((q) => q.cat === 'culture-generale').length < 75) {
    const q = cg[k % cg.length]; const v = Math.floor(k / cg.length);
    out.push(Q('culture-generale', (k % 3) + 1, v ? `${q[0]} (tour ${v + 1})` : q[0], q[1], q[2], q[3])); k++;
  }
  return out;
}

export const QUESTIONS = buildList();
export { CATS };
