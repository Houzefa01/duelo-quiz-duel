import { z } from 'zod';
import { getDb } from '../../db/db.js';
import { requireAuth } from '../auth/session.js';
import { RULES } from '../../config/rules.js';
import { dayKey, weekKey } from '../../lib/time.js';

// Défis quotidiens / hebdo / défi du jour / défis d'amis (F-50..F-54).
const DAILY_CODES = ['gagne-2-duels', 'huit-bonnes-suite', 'joue-sciences', 'joue-3-duels', 'revanche', 'parfait-7'];
const WEEKLY_CODES = ['gagne-10', 'cinquante-bonnes', 'tournoi-participe', 'serie-5-jours'];

export function challengeRoutes(app) {
  app.get('/api/v1/challenges', (req, reply) => {
    const db = getDb();
    const dk = dayKey(), wk = weekKey();
    // Tirage déterministe du jour : 3 parmi le catalogue selon la date.
    const dNum = Number(dk.replaceAll('-', '')) || 1;
    const daily = DAILY_CODES.slice(dNum % 4, (dNum % 4) + 3).map((code) => db.prepare('SELECT * FROM challenges WHERE code=?').get(code)).filter(Boolean);
    const weekly = WEEKLY_CODES.slice(0, 3).map((code) => db.prepare('SELECT * FROM challenges WHERE code=?').get(code)).filter(Boolean);
    let progress = {};
    const u = currentUser(req);
    if (u) {
      for (const c of [...daily, ...weekly]) {
        const period = c.scope === 'daily' ? dk : wk;
        progress[c.code] = db.prepare('SELECT progress,claimed_at FROM user_challenges WHERE user_id=? AND challenge_id=? AND period_key=?').get(u.id, c.id, period) ?? { progress: 0, claimed_at: null };
      }
    }
    return { daily, weekly, progress, periodDay: dk, periodWeek: wk };
  });

  app.post('/api/v1/challenges/:id/claim', (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const db = getDb();
    const c = db.prepare('SELECT * FROM challenges WHERE id=?').get(Number(req.params.id));
    if (!c) return reply.code(404).send({ error: 'Défi introuvable.' });
    const period = c.scope === 'daily' ? dayKey() : weekKey();
    const uc = db.prepare('SELECT * FROM user_challenges WHERE user_id=? AND challenge_id=? AND period_key=?').get(u.id, c.id, period);
    if (!uc || uc.progress < c.goal) return reply.code(400).send({ error: 'Défi pas encore terminé.' });
    if (uc.claimed_at) return reply.code(409).send({ error: 'Récompense déjà réclamée.' });
    db.transaction(() => {
      db.prepare('UPDATE user_challenges SET claimed_at=? WHERE user_id=? AND challenge_id=? AND period_key=?').run(Date.now(), u.id, c.id, period);
      db.prepare('UPDATE users SET coins=coins+?,xp=xp+? WHERE id=?').run(c.reward_coins, c.reward_xp, u.id);
      db.prepare('INSERT INTO reward_ledger(user_id,kind,amount_coins,amount_xp,ref_type,ref_id,created_at) VALUES(?,?,?,?,?,?,?)').run(u.id, 'challenge', c.reward_coins, c.reward_xp, 'challenge', c.id, Date.now());
    })();
    return { ok: true, coins: c.reward_coins, xp: c.reward_xp };
  });

  // Défi du jour (F-52) : 10 questions identiques pour tous, 1 fois/jour.
  app.get('/api/v1/daily-run', (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const db = getDb();
    const dk = dayKey();
    const run = db.prepare('SELECT * FROM daily_runs WHERE period_key=? AND user_id=?').get(dk, u.id);
    const board = db.prepare('SELECT u.username,d.score,d.total_time_ms FROM daily_runs d JOIN users u ON u.id=d.user_id WHERE d.period_key=? AND d.finished_at IS NOT NULL ORDER BY d.score DESC,d.total_time_ms ASC LIMIT 20').all(dk);
    return { run, board, period: dk };
  });
  app.post('/api/v1/daily-run/start', (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const db = getDb();
    const dk = dayKey();
    if (db.prepare('SELECT id FROM daily_runs WHERE period_key=? AND user_id=? AND finished_at IS NOT NULL').get(dk, u.id))
      return reply.code(409).send({ error: 'Défi du jour déjà joué. Reviens demain.' });
    // Questions du jour : seed = date → mêmes 10 pour tous.
    let h = 0; for (const ch of dk) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const pool = db.prepare('SELECT * FROM questions WHERE status=? ORDER BY id').all('live');
    const qs = Array.from({ length: 10 }, (_, i) => pool[(h + i * 61) % pool.length]);
    db.prepare('INSERT OR REPLACE INTO daily_runs(period_key,user_id,answers_json) VALUES(?,?,?)').run(dk, u.id, JSON.stringify(qs.map((q) => q.id)));
    return { questions: qs.map((q) => ({ id: q.id, text: q.text, answers: shuffle([q.a, q.b, q.c, q.d], h + q.id), category: q.category_id })) };
  });
  app.post('/api/v1/daily-run/answer', (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const p = z.object({ answers: z.array(z.number()), totalTimeMs: z.number() }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'donnees_invalides' });
    const db = getDb();
    const dk = dayKey();
    const run = db.prepare('SELECT * FROM daily_runs WHERE period_key=? AND user_id=?').get(dk, u.id);
    if (!run || run.finished_at) return reply.code(409).send({ error: 'Run terminé ou inexistant.' });
    const qids = JSON.parse(run.answers_json);
    let score = 0;
    qids.forEach((qid, i) => {
      const q = db.prepare('SELECT * FROM questions WHERE id=?').get(qid);
      const order = shuffle([q.a, q.b, q.c, q.d], [...dk].reduce((a, c) => a + c.charCodeAt(0), 0) + q.id);
      if (order[p.data.answers[i]] === [q.a, q.b, q.c, q.d][q.correct]) score += 100;
    });
    db.prepare('UPDATE daily_runs SET score=?,total_time_ms=?,finished_at=? WHERE id=?').run(score, p.data.totalTimeMs, Date.now(), run.id);
    // Bonus top 3 (F-52) attribué par job ; ici on crédite le ledger simple
    db.prepare('INSERT INTO reward_ledger(user_id,kind,amount_coins,amount_xp,created_at) VALUES(?,?,?,?,?)').run(u.id, 'daily-run', 10, 10, Date.now());
    return { ok: true, score };
  });

  // Défi d'ami avec mise (F-53)
  app.post('/api/v1/friend-challenges', (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const p = z.object({ username: z.string(), stake: z.number().int().min(0).max(200) }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'donnees_invalides' });
    if (p.data.stake > 0 && ![10, 20, 50, 100, 200].includes(p.data.stake)) return reply.code(400).send({ error: 'Mise autorisée : 10, 20, 50, 100 ou 200.' });
    const db = getDb();
    const other = db.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE').get(p.data.username);
    if (!other || other.id === u.id) return reply.code(404).send({ error: 'Ami introuvable.' });
    if (p.data.stake > 0 && u.coins < p.data.stake) return reply.code(402).send({ error: 'Pas assez de pièces pour cette mise.' });
    db.transaction(() => {
      if (p.data.stake > 0) db.prepare('UPDATE users SET coins=coins-? WHERE id=?').run(p.data.stake, u.id);
      db.prepare('INSERT INTO friend_challenges(from_id,to_id,stake,status,expires_at) VALUES(?,?,?,?,?)').run(u.id, other.id, p.data.stake, 'pending', Date.now() + 24 * 36e5);
      db.prepare('INSERT INTO notifications(user_id,kind,text,created_at) VALUES(?,?,?,?)').run(other.id, 'friend-challenge', `${u.username} te défie${p.data.stake ? ` (mise ${p.data.stake})` : ''}.`, Date.now());
    })();
    return { ok: true };
  });
  app.post('/api/v1/friend-challenges/:id/accept', (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const db = getDb();
    const fc = db.prepare('SELECT * FROM friend_challenges WHERE id=?').get(Number(req.params.id));
    if (!fc || fc.to_id !== u.id || fc.status !== 'pending') return reply.code(404).send({ error: 'Défi introuvable.' });
    if (fc.expires_at < Date.now()) {
      if (fc.stake > 0) db.prepare('UPDATE users SET coins=coins+? WHERE id=?').run(fc.stake, fc.from_id); // remboursement (F-53)
      db.prepare('UPDATE friend_challenges SET status=? WHERE id=?').run('expired', fc.id);
      return reply.code(410).send({ error: 'Défi expiré. Mise remboursée.' });
    }
    if (fc.stake > 0 && u.coins < fc.stake) return reply.code(402).send({ error: 'Pas assez de pièces pour accepter.' });
    db.transaction(() => {
      if (fc.stake > 0) db.prepare('UPDATE users SET coins=coins-? WHERE id=?').run(fc.stake, u.id);
      db.prepare('UPDATE friend_challenges SET status=? WHERE id=?').run('accepted', fc.id);
    })();
    return { ok: true, duelWith: fc.from_id };
  });
}

function currentUser(req) {
  try {
    const tok = req.cookies?.session;
    if (!tok) return null;
    const db = getDb();
    const s = db.prepare('SELECT user_id FROM sessions WHERE token_hash=?').get(__sha(tok));
    return s ? db.prepare('SELECT * FROM users WHERE id=?').get(s.user_id) : null;
  } catch { return null; }
}
import crypto from 'node:crypto';
function __sha(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function shuffle(arr, seed) {
  let s = seed >>> 0 || 1;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Progression des défis après chaque duel (F-54) — appelée par jobs/engine.
export function progressChallenges(db, userId, { won, nCorrect, nDuels = 1 }) {
  const now = Date.now();
  const apply = (code, period, inc) => {
    const c = db.prepare('SELECT * FROM challenges WHERE code=?').get(code);
    if (!c) return;
    const row = db.prepare('SELECT * FROM user_challenges WHERE user_id=? AND challenge_id=? AND period_key=?').get(userId, c.id, period);
    if (!row) db.prepare('INSERT INTO user_challenges(user_id,challenge_id,period_key,progress) VALUES(?,?,?,?)').run(userId, c.id, period, Math.min(c.goal, inc));
    else if (!row.claimed_at) db.prepare('UPDATE user_challenges SET progress=MIN(?,?) WHERE user_id=? AND challenge_id=? AND period_key=?').run(row.progress + inc, 9999, userId, c.id, period);
  };
  const dk = dayKey(), wk = weekKey();
  if (won) { apply('gagne-2-duels', dk, 1); apply('gagne-10', wk, 1); }
  apply('huit-bonnes-suite', dk, nCorrect); apply('cinquante-bonnes', wk, nCorrect);
  apply('joue-3-duels', dk, nDuels);
}
