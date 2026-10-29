import { z } from 'zod';
import { getDb } from '../../db/db.js';
import { requireAuth } from '../auth/session.js';

export function friendRoutes(app) {
  const db = () => getDb();
  app.post('/api/v1/friends/request', (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const p = z.object({ username: z.string() }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'donnees_invalides' });
    const other = db().prepare('SELECT id FROM users WHERE username=? COLLATE NOCASE').get(p.data.username);
    if (!other || other.id === u.id) return reply.code(404).send({ error: 'Joueur introuvable.' });
    if (db().prepare('SELECT * FROM friends WHERE user_id=? AND friend_id=?').get(other.id, u.id)?.status === 'blocked')
      return reply.code(403).send({ error: 'Demande impossible.' });
    db().prepare('INSERT OR REPLACE INTO friends(user_id,friend_id,status,created_at) VALUES(?,?,?,?)').run(u.id, other.id, 'pending', Date.now());
    db().prepare('INSERT INTO notifications(user_id,kind,text,created_at) VALUES(?,?,?,?)').run(other.id, 'friend', `${u.username} veut devenir ton ami.`, Date.now());
    return { ok: true };
  });
  app.post('/api/v1/friends/accept', (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const p = z.object({ username: z.string() }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'donnees_invalides' });
    const other = db().prepare('SELECT id FROM users WHERE username=? COLLATE NOCASE').get(p.data.username);
    if (!other) return reply.code(404).send({ error: 'Joueur introuvable.' });
    const rel = db().prepare('SELECT * FROM friends WHERE user_id=? AND friend_id=?').get(other.id, u.id);
    if (!rel) return reply.code(404).send({ error: 'Aucune demande.' });
    db().transaction(() => {
      db().prepare('UPDATE friends SET status=? WHERE user_id=? AND friend_id=?').run('accepted', other.id, u.id);
      db().prepare('INSERT OR IGNORE INTO friends(user_id,friend_id,status,created_at) VALUES(?,?,?,?)').run(u.id, other.id, 'accepted', Date.now());
      db().prepare('UPDATE friends SET status=? WHERE user_id=? AND friend_id=?').run('accepted', u.id, other.id);
    })();
    return { ok: true };
  });
  app.post('/api/v1/friends/block', (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const p = z.object({ username: z.string() }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'donnees_invalides' });
    const other = db().prepare('SELECT id FROM users WHERE username=? COLLATE NOCASE').get(p.data.username);
    if (!other) return reply.code(404).send({ error: 'Joueur introuvable.' });
    db().prepare('INSERT OR REPLACE INTO friends(user_id,friend_id,status,created_at) VALUES(?,?,?,?)').run(u.id, other.id, 'blocked', Date.now());
    return { ok: true };
  });
  app.get('/api/v1/friends', (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const rows = db().prepare('SELECT us.username,f.status FROM friends f JOIN users us ON us.id=f.friend_id WHERE f.user_id=?').all(u.id);
    return { rows };
  });
}
