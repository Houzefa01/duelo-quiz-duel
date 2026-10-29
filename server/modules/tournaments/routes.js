import { z } from 'zod';
import { getDb } from '../../db/db.js';
import { requireAuth } from '../auth/session.js';
import { RULES, LEAGUES } from '../../config/rules.js';
import { releaseTournamentRewards } from '../rewards/lots.js';

// Tournois à élimination directe 8/16/32 (F-60..F-66) + tournois d'organisateurs (P12).
export function tournamentRoutes(app) {
  app.get('/api/v1/tournaments', (req, reply) => {
    const kind = String(req.query.kind ?? 'all');
    const db = getDb();
    // Officiels = organizer_id NULL ; privés jamais listés (accès par code, F-132).
    if (kind === 'organizer') {
      return { rows: db.prepare(`SELECT * FROM tournaments WHERE organizer_id IS NOT NULL AND visibility='public' AND approval_status='approved' AND status IN ('announced','open','running','done') ORDER BY starts_at DESC LIMIT 20`).all() };
    }
    if (kind === 'official') {
      return { rows: db.prepare(`SELECT * FROM tournaments WHERE organizer_id IS NULL ORDER BY starts_at DESC LIMIT 20`).all() };
    }
    return { rows: db.prepare(`SELECT * FROM tournaments WHERE visibility='public' AND approval_status='approved' ORDER BY starts_at DESC LIMIT 20`).all() };
  });
  // Tournoi privé par code d'invitation (F-132)
  app.get('/api/v1/tournaments/by-code/:code', (req, reply) => {
    const t = getDb().prepare(`SELECT id FROM tournaments WHERE invite_code=? AND visibility='private'`).get(String(req.params.code).toUpperCase());
    if (!t) return reply.code(404).send({ error: 'Code inconnu.' });
    return { id: t.id };
  });
  app.get('/api/v1/tournaments/:id', (req, reply) => {
    const db = getDb();
    const t = db.prepare('SELECT * FROM tournaments WHERE id=?').get(Number(req.params.id));
    if (!t) return reply.code(404).send({ error: 'Tournoi introuvable.' });
    if (t.visibility === 'private') {
      const u = currentTone(req);
      const inscrit = u ? db.prepare('SELECT user_id FROM tournament_players WHERE tournament_id=? AND user_id=?').get(t.id, u.id) : null;
      const code = String(req.query.code ?? '').toUpperCase();
      const staff = u && (u.role === 'admin' || t.organizer_id === u.id);
      if (!inscrit && !staff && code !== (t.invite_code ?? '')) return reply.code(403).send({ error: 'Tournoi privé : code requis.' });
    }
    const players = db.prepare('SELECT u.username,t.seed,t.checked_in FROM tournament_players t JOIN users u ON u.id=t.user_id WHERE t.tournament_id=? ORDER BY t.seed').all(t.id);
    const matches = db.prepare(`SELECT m.*,u1.username p1_name,u2.username p2_name FROM tournament_matches m
      LEFT JOIN users u1 ON u1.id=m.p1_id LEFT JOIN users u2 ON u2.id=m.p2_id
      WHERE m.tournament_id=? ORDER BY m.round,m.slot`).all(t.id);
    const rewards = db.prepare('SELECT id,public_label,kind,expires_at FROM tournament_rewards WHERE tournament_id=?').all(t.id);
    const { invite_code, ...pub } = t; // le code ne fuite jamais dans la fiche
    return { tournament: pub, players, matches, rewards };
  });
  app.post('/api/v1/tournaments/:id/join', (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const db = getDb();
    const t = db.prepare('SELECT * FROM tournaments WHERE id=?').get(Number(req.params.id));
    if (!t || t.status !== 'open' || t.approval_status !== 'approved') return reply.code(400).send({ error: 'Inscriptions fermées.' });
    if (t.visibility === 'private' && String(req.body?.code ?? '').toUpperCase() !== (t.invite_code ?? ''))
      return reply.code(403).send({ error: 'Code d’invitation requis.' });
    // Conditions d'accès (F-134)
    try {
      const rules = JSON.parse(t.rules_json ?? '{}');
      if (rules.minLevel && u.level < rules.minLevel) return reply.code(403).send({ error: `Niveau ${rules.minLevel} minimum.` });
      if (rules.minLeague) {
        const need = LEAGUES.find((l) => l.slug === rules.minLeague);
        if (need && u.elo < need.min) return reply.code(403).send({ error: `Ligue ${need.label} minimum.` });
      }
      if (rules.guests && rules.guests.length && !rules.guests.some((g) => String(g).toLowerCase() === u.username.toLowerCase()))
        return reply.code(403).send({ error: 'Tournoi sur invitation.' });
    } catch { /* règles illisibles : ouvert */ }
    const n = db.prepare('SELECT COUNT(*) c FROM tournament_players WHERE tournament_id=?').get(t.id).c;
    if (n >= t.size) return reply.code(409).send({ error: 'Tournoi complet.' });
    db.prepare('INSERT OR IGNORE INTO tournament_players(tournament_id,user_id,seed) VALUES(?,?,?)').run(t.id, u.id, u.elo);
    return { ok: true };
  });
  app.post('/api/v1/tournaments/:id/checkin', (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const db = getDb();
    db.prepare('UPDATE tournament_players SET checked_in=1 WHERE tournament_id=? AND user_id=?').run(Number(req.params.id), u.id);
    return { ok: true };
  });
  // Création admin
  app.post('/api/v1/tournaments', (req, reply) => {
    const u = requireAuth(req, reply); if (!u || u.role !== 'admin') return reply.code(403).send({ error: 'admin requis' });
    const p = z.object({ name: z.string().min(3), size: z.union([z.literal(8), z.literal(16), z.literal(32)]), startsAt: z.number() }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'donnees_invalides' });
    const db = getDb();
    const id = db.prepare('INSERT INTO tournaments(name,size,status,starts_at,checkin_at) VALUES(?,?,?,?,?)')
      .run(p.data.name, p.data.size, 'open', p.data.startsAt, p.data.startsAt - RULES.tournament.checkinMinutes * 6e4).lastInsertRowid;
    return { id: Number(id) };
  });
  // Résolution d'un match (gagnant déclaré par le moteur de duel de tournoi)
  app.post('/api/v1/tournaments/matches/:id/win', (req, reply) => {
    const u = requireAuth(req, reply); if (!u || u.role !== 'admin') return reply.code(403).send({ error: 'admin requis' });
    resolveMatch(getDb(), Number(req.params.id), Number(req.body.winnerId));
    return { ok: true };
  });
  // Manche de finale en best-of (F-63) : 2 manches gagnantes.
  app.post('/api/v1/tournaments/matches/:id/game', (req, reply) => {
    const u = requireAuth(req, reply); if (!u || u.role !== 'admin') return reply.code(403).send({ error: 'admin requis' });
    resolveFinalGame(getDb(), Number(req.params.id), Number(req.body.winnerId));
    return { ok: true };
  });
  // Démarrage : génère l'arbre avec les joueurs pointés (admin ou planificateur).
  app.post('/api/v1/tournaments/:id/start', (req, reply) => {
    const u = requireAuth(req, reply); if (!u || u.role !== 'admin') return reply.code(403).send({ error: 'admin requis' });
    return buildBracket(getDb(), Number(req.params.id));
  });
}

// Une manche de finale : incrémente, et à 2 manches déclare le vainqueur.
export function resolveFinalGame(db, matchId, winnerId) {
  const m = db.prepare('SELECT * FROM tournament_matches WHERE id=?').get(matchId);
  if (!m || m.status === 'done' || m.round !== 'F') return;
  const col = winnerId === m.p1_id ? 'p1_wins' : 'p2_wins';
  const need = Math.ceil((m.best_of || 3) / 2);
  db.prepare(`UPDATE tournament_matches SET ${col}=${col}+1 WHERE id=?`).run(matchId);
  const upd = db.prepare('SELECT p1_wins,p2_wins FROM tournament_matches WHERE id=?').get(matchId);
  if (upd.p1_wins >= need) resolveMatch(db, matchId, m.p1_id);
  else if (upd.p2_wins >= need) resolveMatch(db, matchId, m.p2_id);
}

// Génère l'arbre avec têtes de série Elo + byes (F-62).
export function buildBracket(db, tournamentId) {
  const t = db.prepare('SELECT * FROM tournaments WHERE id=?').get(tournamentId);
  const players = db.prepare('SELECT user_id,seed FROM tournament_players WHERE tournament_id=? AND checked_in=1 ORDER BY seed DESC').all(tournamentId);
  if (players.length < 8) { // annulation + remboursement (F-61)
    db.prepare('UPDATE tournaments SET status=? WHERE id=?').run('cancelled', tournamentId);
    return { cancelled: true };
  }
  const size = players.length <= 8 ? 8 : players.length <= 16 ? 16 : 32;
  const seeded = [...players].sort((a, b) => b.seed - a.seed);
  // Ordre de seeding classique : 1v8, 4v5, 2v7, 3v6...
  const order = seedOrder(size);
  const placed = order.map((i) => seeded[i]?.user_id ?? null);
  db.transaction(() => {
    db.prepare('DELETE FROM tournament_matches WHERE tournament_id=?').run(tournamentId);
    const ins = db.prepare('INSERT INTO tournament_matches(tournament_id,round,slot,p1_id,p2_id,best_of,due_at,status) VALUES(?,?,?,?,?,?,?,?)');
    for (let s = 0; s < size / 2; s++) {
      ins.run(tournamentId, 'R1', s, placed[2 * s], placed[2 * s + 1], 1, Date.now() + RULES.tournament.matchStartMinutes * 6e4, 'ready');
    }
    db.prepare('UPDATE tournaments SET status=?,size=? WHERE id=?').run('running', size, tournamentId);
  })();
  // Byes : si un seul joueur, il avance (F-62)
  for (const m of db.prepare('SELECT * FROM tournament_matches WHERE tournament_id=? AND round=?').all(tournamentId, 'R1')) {
    if (m.p1_id && !m.p2_id) resolveMatch(db, m.id, m.p1_id);
    else if (m.p2_id && !m.p1_id) resolveMatch(db, m.id, m.p2_id);
  }
  return { size };
}
function seedOrder(n) {
  // Génère l'ordre des têtes de série pour n=8/16/32.
  let arr = [0, 1];
  while (arr.length < n) {
    const next = [];
    for (const x of arr) { next.push(x, arr.length * 2 - 1 - x); }
    arr = next;
  }
  return arr.slice(0, n);
}

// Utilisateur courant sans exiger l'auth (fiche privée).
function currentTone(req) {
  try {
    const tok = req.cookies?.session;
    if (!tok) return null;
    const db = getDb();
    const s = db.prepare('SELECT user_id FROM sessions WHERE token_hash=?').get(sha256t(tok));
    return s ? db.prepare('SELECT * FROM users WHERE id=?').get(s.user_id) : null;
  } catch { return null; }
}
import crypto from 'node:crypto';
function sha256t(t) { return crypto.createHash('sha256').update(t).digest('hex'); }

// Séquence des tours selon la taille du tableau.
export function roundsFor(size) {
  if (size <= 8) return ['R1', 'SF', 'F'];
  if (size <= 16) return ['R1', 'R2', 'SF', 'F'];
  return ['R1', 'R2', 'QF', 'SF', 'F'];
}

// Avance le gagnant au tour suivant ; paie les prix en finale (F-66).
export function resolveMatch(db, matchId, winnerId) {
  const m = db.prepare('SELECT * FROM tournament_matches WHERE id=?').get(matchId);
  if (!m || m.status === 'done') return;
  db.prepare('UPDATE tournament_matches SET winner_id=?,status=? WHERE id=?').run(winnerId, 'done', matchId);
  const t = db.prepare('SELECT * FROM tournaments WHERE id=?').get(m.tournament_id);
  const seq = roundsFor(t.size);
  const i = seq.indexOf(m.round);
  const nxt = seq[i + 1];
  if (!nxt) { payPrizes(db, m, winnerId); return; } // match final résolu -> prix (F-66)
  if (nxt === 'F') {
    // Finale : meilleur des 3 manches (F-63), jouée via resolveFinalGame.
    const best = RULES.tournament.finalBestOf;
    const next = db.prepare('SELECT * FROM tournament_matches WHERE tournament_id=? AND round=? AND slot=?').get(m.tournament_id, 'F', Math.floor(m.slot / 2));
    if (!next) db.prepare('INSERT INTO tournament_matches(tournament_id,round,slot,p1_id,p2_id,best_of,status) VALUES(?,?,?,?,?,?,?)').run(m.tournament_id, 'F', Math.floor(m.slot / 2), m.slot % 2 === 0 ? winnerId : null, m.slot % 2 === 1 ? winnerId : null, best, 'ready');
    else db.prepare(`UPDATE tournament_matches SET ${m.slot % 2 === 0 ? 'p1_id' : 'p2_id'}=? WHERE id=?`).run(winnerId, next.id);
    return;
  }
  {
    const next = db.prepare('SELECT * FROM tournament_matches WHERE tournament_id=? AND round=? AND slot=?').get(m.tournament_id, nxt, Math.floor(m.slot / 2));
    if (!next) db.prepare('INSERT INTO tournament_matches(tournament_id,round,slot,p1_id,p2_id,best_of,status) VALUES(?,?,?,?,?,?,?)').run(m.tournament_id, nxt, Math.floor(m.slot / 2), m.slot % 2 === 0 ? winnerId : null, m.slot % 2 === 1 ? winnerId : null, 1, 'ready');
    else db.prepare(`UPDATE tournament_matches SET ${m.slot % 2 === 0 ? 'p1_id' : 'p2_id'}=? WHERE id=?`).run(winnerId, next.id);
    return;
  }
}

// Vainqueur : prix + badge (F-66).
function payPrizes(db, m, winnerId) {
    const P = RULES.tournament.prizes;
    const now = Date.now();
    const loser = m.p1_id === winnerId ? m.p2_id : m.p1_id;
    db.prepare('UPDATE tournaments SET status=?,winner_id=? WHERE id=?').run('done', winnerId, m.tournament_id);
    const pay = (uid, coins, badge) => {
      if (!uid) return;
      db.prepare('UPDATE users SET coins=coins+? WHERE id=?').run(coins, uid);
      db.prepare('INSERT INTO reward_ledger(user_id,kind,amount_coins,amount_xp,ref_type,ref_id,created_at) VALUES(?,?,?,?,?,?,?)').run(uid, 'tournament', coins, 50, 'tournament', m.tournament_id, now);
      if (badge) { const b = db.prepare('SELECT id FROM badges WHERE slug=?').get(badge); if (b) { try { db.prepare('INSERT INTO user_badges(user_id,badge_id,earned_at) VALUES(?,?,?)').run(uid, b.id, now); } catch {} } }
    };
    pay(winnerId, P.winner, 'vainqueur-tournoi');
    pay(loser, P.finalist, 'finaliste');
    // Lots d'organisateur : libération automatique sauf mode manuel (F-150).
    try {
      const tt = db.prepare('SELECT reward_release FROM tournaments WHERE id=?').get(m.tournament_id);
      if (tt && tt.reward_release !== 'manual') releaseTournamentRewards(db, m.tournament_id);
    } catch { /* lots désactivés sans clé : on continue */ }
}
