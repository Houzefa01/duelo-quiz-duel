import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../../db/db.js';
import { requireAuth, publicProfile } from '../auth/session.js';
import { leagueOf } from '../../config/rules.js';

export function userRoutes(app) {
  app.get('/api/v1/me', (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const db = getDb();
    const ledger = db.prepare('SELECT kind,amount_coins,amount_xp,created_at FROM reward_ledger WHERE user_id=? ORDER BY id DESC LIMIT 10').all(u.id);
    const badges = db.prepare('SELECT b.slug,b.label,b.rarity FROM user_badges ub JOIN badges b ON b.id=ub.badge_id WHERE ub.user_id=?').all(u.id);
    const notifs = db.prepare('SELECT * FROM notifications WHERE user_id=? AND read_at IS NULL ORDER BY id DESC LIMIT 20').all(u.id);
    return { ...strip(u), league: leagueOf(u.elo), ledger, badges, notifications: notifs };
  });
  app.patch('/api/v1/me', (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const p = z.object({ avatar: z.number().int().min(1).max(24).optional(), frame: z.string().max(30).optional(), title: z.string().max(40).optional(), reduced_motion: z.boolean().optional() }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'donnees_invalides' });
    getDb().prepare('UPDATE users SET avatar=COALESCE(?,avatar),frame=COALESCE(?,frame),title=COALESCE(?,title),reduced_motion=COALESCE(?,reduced_motion) WHERE id=?').run(p.data.avatar ?? null, p.data.frame ?? null, p.data.title ?? null, p.data.reduced_motion === undefined ? null : (p.data.reduced_motion ? 1 : 0), u.id);
    return { ok: true };
  });
  app.get('/api/v1/users/:username', (req, reply) => {
    const prof = publicProfile(getDb(), req.params.username);
    if (!prof) return reply.code(404).send({ error: 'Joueur introuvable.' });
    return { ...prof, league: leagueOf(prof.elo) };
  });
  // Export RGPD (F-07)
  app.get('/api/v1/me/export', (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const db = getDb();
    return { user: strip(u), duels: db.prepare('SELECT * FROM duels WHERE player1_id=? OR player2_id=? LIMIT 500').all(u.id, u.id), ledger: db.prepare('SELECT * FROM reward_ledger WHERE user_id=?').all(u.id) };
  });
  // Suppression (F-07) : anonymisation + effacement des photos et fichiers (vie privée).
  app.delete('/api/v1/me', (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const db = getDb();
    const dir = process.env.AVATAR_DIR ?? './data/uploads/avatars';
    const ups = db.prepare(`SELECT path FROM uploads WHERE owner_id=? AND kind='avatar'`).all(u.id);
    db.transaction(() => {
      db.prepare('UPDATE users SET username=?,password_hash=?,email=NULL,status=?,avatar_kind=?,avatar_ref=? WHERE id=?').run('Joueur-supprime-' + u.id, '!', 'deleted', 'preset', 'personnage-a1.svg', u.id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
      db.prepare(`UPDATE uploads SET status='removed' WHERE owner_id=?`).run(u.id);
    })();
    for (const f of ups) {
      for (const e of ['webp', 'png']) {
        try { fs.unlinkSync(path.join(dir, f.path + '.' + e)); } catch {}
        try { fs.unlinkSync(path.join(dir, f.path + '-64.' + e)); } catch {}
      }
    }
    reply.clearCookie('session', { path: '/' });
    return { ok: true };
  });
  app.get('/api/v1/history', (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const rows = getDb().prepare('SELECT * FROM duels WHERE (player1_id=? OR player2_id=?) AND status=? ORDER BY ended_at DESC LIMIT 30').all(u.id, u.id, 'finished');
    return { rows };
  });
}
function strip(u) {
  const { password_hash, ...rest } = u; return rest;
}
