import { getDb } from '../../db/db.js';
import { sha256 } from './password.js';

// Lit la session depuis le cookie `session`. Retourne user ou null.
export function sessionUser(req) {
  const token = req.cookies?.session;
  if (!token) return null;
  const db = getDb();
  const s = db.prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash=?').get(sha256(token));
  if (!s || s.expires_at < Date.now()) return null;
  // Glissant 30 jours (F-03) : prolonge si < 15 j restants.
  if (s.expires_at - Date.now() < 15 * 864e5) {
    db.prepare('UPDATE sessions SET expires_at=? WHERE token_hash=?').run(Date.now() + 30 * 864e5, sha256(token));
  }
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(s.user_id);
  return u && u.status !== 'suspended' ? u : null;
}
export function requireAuth(req, reply) {
  const u = sessionUser(req);
  if (!u) { reply.code(401).send({ error: 'non_connecte' }); return null; }
  return u;
}
export function publicProfile(db, username) {
  const u = db.prepare(`SELECT id,username,avatar,avatar_kind,avatar_ref,frame,title,xp,level,elo,elo_games,streak_days,best_streak,created_at FROM users WHERE username=? COLLATE NOCASE`).get(username);
  if (!u) return null;
  const stats = db.prepare(`SELECT COUNT(*) n, SUM(CASE WHEN winner_id=? THEN 1 ELSE 0 END) w FROM duels WHERE (player1_id=? OR player2_id=?) AND status='finished'`).get(u.id, u.id, u.id);
  const badges = db.prepare('SELECT b.slug,b.label,b.rarity FROM user_badges ub JOIN badges b ON b.id=ub.badge_id WHERE ub.user_id=?').all(u.id);
  const last = db.prepare('SELECT id,score1,score2,winner_id,mode,ended_at FROM duels WHERE (player1_id=? OR player2_id=?) AND status=? ORDER BY ended_at DESC LIMIT 6').all(u.id, u.id, 'finished');
  return { ...u, wins: stats.w ?? 0, duels: stats.n, losses: stats.n - (stats.w ?? 0), winRate: stats.n ? Math.round((100 * (stats.w ?? 0)) / stats.n) : 0, badges, lastDuels: last };
}
