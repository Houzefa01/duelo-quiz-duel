import { getDb } from '../../db/db.js';
import { sha256 } from '../auth/password.js';
import { leagueOf } from '../../config/rules.js';

// Classements publics (F-30..F-34), visibles sans compte sauf "friends".
export function rankingRoutes(app) {
  app.get('/api/v1/leaderboard', (req, reply) => {
    const scope = String(req.query.scope ?? 'global');
    const page = Math.max(0, Number(req.query.page ?? 0));
    const db = getDb();
    const hide = Date.now() - 60 * 864e5; // inactifs 60 j masqués (F-34)
    if (scope === 'global') {
      const rows = db.prepare(`SELECT username,elo,level,avatar,avatar_kind,avatar_ref,frame,title FROM users WHERE role IN ('user','guest') AND elo_games>=5 AND last_seen_at>? ORDER BY elo DESC LIMIT 20 OFFSET ?`).all(hide, page * 20);
      return { scope, rows: rows.map((r) => ({ ...r, league: leagueOf(r.elo).slug })) };
    }
    if (scope === 'weekly') {
      const rows = db.prepare(`SELECT u.username,u.avatar,u.avatar_kind,u.avatar_ref,u.frame,SUM(l.amount_xp) pts FROM reward_ledger l JOIN users u ON u.id=l.user_id WHERE l.created_at>? AND u.role IN ('user','guest') GROUP BY l.user_id ORDER BY pts DESC LIMIT 20 OFFSET ?`).all(Date.now() - 7 * 864e5, page * 20);
      return { scope, rows };
    }
    if (scope === 'category') {
      const rows = db.prepare(`SELECT u.username,u.avatar,u.avatar_kind,u.avatar_ref,COUNT(*) ok FROM duel_answers a JOIN users u ON u.id=a.user_id WHERE a.correct=1 GROUP BY a.user_id ORDER BY ok DESC LIMIT 20 OFFSET ?`).all(page * 20);
      return { scope, rows };
    }
    if (scope === 'friends') {
      const tok = req.cookies?.session;
      if (!tok) return reply.code(401).send({ error: 'Connecte-toi pour voir le classement de tes amis.' });
      const s = db.prepare('SELECT user_id FROM sessions WHERE token_hash=?').get(sha256(tok));
      if (!s) return reply.code(401).send({ error: 'non_connecte' });
      const rows = db.prepare(`SELECT u.username,u.elo,u.avatar,u.avatar_kind,u.avatar_ref,u.frame FROM friends f JOIN users u ON u.id=f.friend_id WHERE f.user_id=? AND f.status='accepted' ORDER BY u.elo DESC LIMIT 100`).all(s.user_id);
      const me = db.prepare('SELECT username,elo,avatar,avatar_kind,avatar_ref,frame FROM users WHERE id=?').get(s.user_id);
      return { scope, rows: [...rows, { ...me, you: true }].sort((a, b) => b.elo - a.elo) };
    }
    return reply.code(400).send({ error: 'scope inconnu' });
  });
}
