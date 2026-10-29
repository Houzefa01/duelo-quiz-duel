import { z } from 'zod';
import { getDb } from '../../db/db.js';
import { Username, Password, hashPassword, checkPassword, newToken, sha256, genRecoveryCodes, pseudoOk } from './password.js';
import { sessionUser } from './session.js';
import { hitRate } from '../../lib/rateLimit.js';
import { dayKey } from '../../lib/time.js';
import { randomAvatar } from '../avatars/catalog.js';

export function authRoutes(app) {
  // Inscription F-01/F-04
  app.post('/api/v1/auth/register', (req, reply) => {
    const ip = req.ip;
    const r = hitRate('reg:' + ip, 3, 36e5);
    if (!r.allowed) return reply.code(429).send({ error: 'trop_de_comptes' });
    const p = z.object({ username: Username, password: Password, email: z.string().email().optional().or(z.literal('')), ageOk: z.boolean() }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'donnees_invalides', details: p.error.issues });
    if (!p.data.ageOk) return reply.code(400).send({ error: 'Tu dois confirmer avoir 13 ans ou plus.' });
    if (!pseudoOk(p.data.username)) return reply.code(400).send({ error: 'Ce pseudo n’est pas autorisé. Essaie-en un autre.' });
    const db = getDb();
    if (db.prepare('SELECT id FROM users WHERE username=? COLLATE NOCASE').get(p.data.username))
      return reply.code(409).send({ error: 'Ce pseudo est déjà pris. Essaie-en un autre.' });
    const now = Date.now();
    const codes = genRecoveryCodes();
    const info = db.transaction(() => {
      const u = db.prepare('INSERT INTO users(username,password_hash,email,created_at,last_seen_at,last_login_day,avatar_ref) VALUES(?,?,?,?,?,?,?)')
        .run(p.data.username, hashPassword(p.data.password), p.data.email || null, now, now, dayKey(), randomAvatar()).lastInsertRowid;
      for (const c of codes) db.prepare('INSERT INTO recovery_codes(user_id,code_hash) VALUES(?,?)').run(u, sha256(c));
      const tok = newToken();
      db.prepare('INSERT INTO sessions(user_id,token_hash,created_at,expires_at,user_agent) VALUES(?,?,?,?,?)').run(u, sha256(tok), now, now + 30 * 864e5, req.headers['user-agent'] ?? '');
      return { id: u, tok };
    })();
    reply.setCookie('session', info.tok, { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 30 * 86400, secure: process.env.NODE_ENV === 'production' });
    return { id: Number(info.id), username: p.data.username, recoveryCodes: codes, message: 'Note ces 8 codes de secours. Ils ne seront plus affichés.' };
  });

  // Connexion F-03
  app.post('/api/v1/auth/login', (req, reply) => {
    const r = hitRate('login:' + req.ip, 5, 6e5);
    if (!r.allowed) return reply.code(429).send({ error: 'Trop d’essais. Réessaie dans 10 minutes.' });
    const p = z.object({ username: z.string(), password: z.string() }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'donnees_invalides' });
    const db = getDb();
    const u = db.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE').get(p.data.username);
    if (!u || !checkPassword(p.data.password, u.password_hash)) return reply.code(401).send({ error: 'Pseudo ou mot de passe incorrect.' });
    if (u.status === 'suspended') return reply.code(403).send({ error: 'Compte suspendu.' });
    const tok = newToken(); const now = Date.now();
    db.prepare('INSERT INTO sessions(user_id,token_hash,created_at,expires_at,user_agent) VALUES(?,?,?,?,?)').run(u.id, sha256(tok), now, now + 30 * 864e5, req.headers['user-agent'] ?? '');
    // Série de connexion (F-42) + résumé hebdo : calcul simple du jour
    const today = dayKey();
    let streak = u.streak_days;
    if (u.last_login_day !== today) {
      const y = new Date(Date.now() - 864e5);
      const yk = dayKey(y);
      streak = (u.last_login_day === yk || (!u.last_login_day && true)) ? streak + (u.last_login_day ? 1 : 1) : (u.daily_streak_frozen === '1' ? streak : 1);
      if (u.daily_streak_frozen === '1') db.prepare('UPDATE users SET daily_streak_frozen=? WHERE id=?').run('0', u.id);
      db.prepare('UPDATE users SET last_login_day=?,streak_days=?,best_streak=MAX(best_streak,?),last_seen_at=? WHERE id=?').run(today, streak, streak, now, u.id);
    } else db.prepare('UPDATE users SET last_seen_at=? WHERE id=?').run(now, u.id);
    reply.setCookie('session', tok, { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 30 * 86400, secure: process.env.NODE_ENV === 'production' });
    const monday = new Date(); const d = (monday.getDay() + 6) % 7; monday.setDate(monday.getDate() - d); monday.setHours(0, 0, 0, 0);
    const fresh = monday.getTime() <= u.last_seen_at ? false : true;
    return { id: u.id, username: u.username, streak, weeklySummary: fresh };
  });

  app.post('/api/v1/auth/logout', (req, reply) => {
    const t = req.cookies?.session;
    if (t) getDb().prepare('DELETE FROM sessions WHERE token_hash=?').run(sha256(t));
    reply.clearCookie('session', { path: '/' });
    return { ok: true };
  });

  // Déconnexion partout (F-03)
  app.post('/api/v1/auth/logout-all', (req, reply) => {
    const u = sessionUser(req); if (!u) return reply.code(401).send({ error: 'non_connecte' });
    getDb().prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
    reply.clearCookie('session', { path: '/' });
    return { ok: true };
  });

  // Récupération par code de secours (F-04)
  app.post('/api/v1/auth/recover', (req, reply) => {
    const p = z.object({ username: z.string(), code: z.string(), newPassword: Password }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'donnees_invalides' });
    const db = getDb();
    const u = db.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE').get(p.data.username);
    if (!u) return reply.code(404).send({ error: 'Compte introuvable.' });
    const row = db.prepare('SELECT * FROM recovery_codes WHERE user_id=? AND used_at IS NULL').all(u.id).find((c) => c.code_hash === sha256(p.data.code.trim().toUpperCase()));
    if (!row) return reply.code(401).send({ error: 'Code invalide ou déjà utilisé.' });
    db.transaction(() => {
      db.prepare('UPDATE recovery_codes SET used_at=? WHERE id=?').run(Date.now(), row.id);
      db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(p.data.newPassword), u.id);
    })();
    return { ok: true };
  });

  // Invité : 3 duels fantômes (F-05)
  app.post('/api/v1/auth/guest', (req, reply) => {
    const db = getDb(); const now = Date.now();
    const name = 'Invite-' + Math.random().toString(36).slice(2, 7);
    const id = db.prepare('INSERT INTO users(username,password_hash,role,created_at,last_seen_at) VALUES(?,?,?,?,?)').run(name, '!', 'guest', now, now).lastInsertRowid;
    const tok = newToken();
    db.prepare('INSERT INTO sessions(user_id,token_hash,created_at,expires_at) VALUES(?,?,?,?)').run(id, sha256(tok), now, now + 30 * 864e5);
    reply.setCookie('session', tok, { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 30 * 86400 });
    return { id: Number(id), username: name };
  });
}
