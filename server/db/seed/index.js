import { openDb } from '../db.js';
import { env, loadEnv } from '../../config/env.js';
import { QUESTIONS, CATS } from './questions.js';
import bcrypt from 'bcryptjs';

loadEnv();
const arg = process.argv[2];
const dbPath = (arg && arg.endsWith('.db')) ? arg : (env.DB_PATH ?? './data/duelo.db');
const db = openDb(dbPath);
const now = Date.now();

const labels = { histoire: 'Histoire', geographie: 'Géographie', sciences: 'Sciences', 'cinema-series': 'Cinéma et séries', musique: 'Musique', sport: 'Sport', 'jeux-video': 'Jeux vidéo', 'culture-generale': 'Culture générale' };
const SEED_VERSION = '2'; // incrémenter quand le générateur change → reconstruction
db.transaction(() => {
  const v = db.prepare('SELECT v FROM kv WHERE k=?').get('seed_version');
  if (!v || v.v !== SEED_VERSION) {
    db.prepare(`DELETE FROM questions WHERE status='live'`).run();
    db.prepare('INSERT OR REPLACE INTO kv(k,v) VALUES(?,?)').run('seed_version', SEED_VERSION);
  }
  for (const slug of CATS) {
    db.prepare('INSERT OR IGNORE INTO categories(slug,label) VALUES(?,?)').run(slug, labels[slug]);
  }
  const catId = Object.fromEntries(db.prepare('SELECT id,slug FROM categories').all().map((r) => [r.slug, r.id]));
  const n = db.prepare('SELECT COUNT(*) c FROM questions WHERE status=?').get('live').c;
  if (n < 600) {
    db.prepare('DELETE FROM questions WHERE status=?').run('live');
    const ins = db.prepare('INSERT INTO questions(category_id,difficulty,text,a,b,c,d,correct,source,verified,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
    for (const q of QUESTIONS) {
      const answers = [q.good, ...q.bads];
      // Ordre de stockage fixe ; mélange fait à l'envoi par joueur (F-11).
      ins.run(catId[q.cat], q.difficulty, q.text, answers[0], answers[1], answers[2], answers[3], 0, q.source, q.verified, 'live', now);
    }
  }
  // Badges (30+, F-43)
  const badges = [
    ['premiere-victoire', 'Première victoire', 'commun'], ['serie-3', 'Série de 3', 'commun'],
    ['serie-5', 'Série de 5', 'rare'], ['serie-10', 'Série de 10', 'épique'],
    ['cent-duels', '100 duels', 'rare'], ['mille-xp', '1000 XP', 'commun'],
    ['parfait', 'Duel parfait', 'épique'], ['fantome-tueur', 'Chasseur de fantômes', 'commun'],
    ['revenant', 'Revanche gagnée', 'commun'], ['titulaire-5', '5 duels classés', 'commun'],
    ['expert-histoire', 'Expert Histoire', 'rare'], ['expert-geographie', 'Expert Géographie', 'rare'],
    ['expert-sciences', 'Expert Sciences', 'rare'], ['expert-cinema', 'Expert Cinéma', 'rare'],
    ['expert-musique', 'Expert Musique', 'rare'], ['expert-sport', 'Expert Sport', 'rare'],
    ['expert-jv', 'Expert Jeux vidéo', 'rare'], ['expert-culture', 'Expert Culture G', 'rare'],
    ['vainqueur-tournoi', 'Vainqueur de tournoi', 'légendaire'], ['finaliste', 'Finaliste', 'épique'],
    ['defi-quotidien', 'Défi validé', 'commun'], ['triple-defi', '3/3 du jour', 'rare'],
    ['coffre-7', 'Série de coffres 7 jours', 'épique'], ['parrain', 'Parrain', 'rare'],
    ['fidele-30', '30 jours de jeu', 'épique'], ['eclair', 'Réponse en moins d’1 s', 'commun'],
    ['marathon', '10 duels en un jour', 'rare'], ['invincible-samedi', 'Champion du samedi', 'légendaire'],
    ['ami-fidele', '5 défis d’amis gagnés', 'rare'], ['curieux', 'Question proposée', 'commun'],
  ];
  for (const [slug, label, rarity] of badges) {
    db.prepare('INSERT OR IGNORE INTO badges(slug,label,rarity,condition_json) VALUES(?,?,?,?)').run(slug, label, rarity, '{}');
  }
  // Cosmétiques (F-44)
  const cos = [
    ['cadre-bronze', 'frame', 50, 'commun', 'Cadre Bronze'], ['cadre-argent', 'frame', 150, 'rare', 'Cadre Argent'],
    ['cadre-or', 'frame', 400, 'épique', 'Cadre Or'], ['cadre-diamant', 'frame', 1000, 'légendaire', 'Cadre Diamant'],
    ['titre-novice', 'title', 0, 'commun', 'Titre : Novice'], ['titre-duelliste', 'title', 200, 'rare', 'Titre : Duelliste'],
    ['titre-champion', 'title', 800, 'légendaire', 'Titre : Champion'],
    ['theme-nuit', 'theme', 300, 'rare', 'Thème plateau nuit'],
  ];
  for (const [slug, type, price, rarity, label] of cos) {
    db.prepare('INSERT OR IGNORE INTO cosmetics(slug,type,price,rarity,label) VALUES(?,?,?,?,?)').run(slug, type, price, rarity, label);
  }
  // Défis catalogue (quotidiens x6, hebdo x4)
  const ch = [
    ['daily', 'gagne-2-duels', 2, 30, 20, 'Gagne 2 duels'], ['daily', 'huit-bonnes-suite', 8, 25, 15, '8 bonnes réponses au total'],
    ['daily', 'joue-sciences', 2, 20, 10, 'Réponds à 2 questions de Sciences'], ['daily', 'joue-3-duels', 3, 25, 15, 'Termine 3 duels'],
    ['daily', 'revanche', 1, 20, 10, 'Demande une revanche'], ['daily', 'parfait-7', 7, 40, 25, '7 bonnes réponses en un duel'],
    ['weekly', 'gagne-10', 10, 150, 80, 'Gagne 10 duels'], ['weekly', 'cinquante-bonnes', 50, 120, 60, '50 bonnes réponses'],
    ['weekly', 'tournoi-participe', 1, 100, 50, 'Participe à un tournoi'], ['weekly', 'serie-5-jours', 5, 200, 100, 'Joue 5 jours différents'],
  ];
  for (const [scope, code, goal, rc, rx, label] of ch) {
    db.prepare('INSERT OR IGNORE INTO challenges(scope,code,goal,reward_coins,reward_xp,label) VALUES(?,?,?,?,?,?)').run(scope, code, goal, rc, rx, label);
  }
  // Admin par défaut
  const adminName = process.env.ADMIN_USERNAME ?? 'admin';
  const adminPw = process.env.ADMIN_PASSWORD ?? 'admin12345678';
  if (!db.prepare('SELECT id FROM users WHERE username=?').get(adminName)) {
    db.prepare(`INSERT INTO users(username,password_hash,role,created_at,last_seen_at) VALUES(?,?,?, ?,?)`)
      .run(adminName, bcrypt.hashSync(adminPw, 12), 'admin', now, now);
  }
}).call(null);
console.log('seed ok:', db.prepare('SELECT COUNT(*) c FROM questions').get().c, 'questions');
