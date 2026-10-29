import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { probePool, coverPool } from '../../lib/imgpool.js';
import { getDb } from '../../db/db.js';
import { requireAuth } from '../auth/session.js';
import { AVATARS, DEFAUT_AVATAR, isPreset, avatarUrlFor } from './catalog.js';

const MAX_BYTES = 3 * 1024 * 1024;      // F-104 : 3 Mo
const MAX_DIM = 6000;                    // F-105 : protection mémoire
const PER_DAY = 5;                       // F-110 : 5 changements/jour

function uploadDir() {
  const d = process.env.AVATAR_DIR ?? './data/uploads/avatars';
  fs.mkdirSync(d, { recursive: true });
  return d;
}
// Signatures binaires réelles (F-105) : JPEG, PNG, WebP. Ni GIF, ni SVG.
function sniff(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export function avatarRoutes(app) {
  // (multipart enregistré une fois dans app.js : limite 20 Mo, contrôle 3 Mo ci-dessous)

  app.get('/api/v1/avatars', () => ({ rows: AVATARS }));

  // Choix dans le catalogue (F-101)
  app.patch('/api/v1/me/avatar', (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const p = z.object({ ref: z.string().max(60) }).safeParse(req.body);
    if (!p.success || !isPreset(p.data.ref)) return reply.code(400).send({ error: 'Avatar inconnu.' });
    getDb().prepare(`UPDATE users SET avatar_kind='preset',avatar_ref=? WHERE id=?`).run(p.data.ref, u.id);
    return { ok: true, url: `/assets/avatars/${p.data.ref}` };
  });

  // Téléversement avec ré-encodage sécurisé (F-104..F-106)
  app.post('/api/v1/me/avatar/upload', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    if (u.upload_banned) return reply.code(403).send({ error: 'Téléversement suspendu pour ce compte.' });
    const db = getDb();
    const today = new Date().toISOString().slice(0, 10);
    const nDay = db.prepare(`SELECT COUNT(*) c FROM uploads WHERE owner_id=? AND kind='avatar' AND created_at>?`).get(u.id, Date.now() - 864e5).c;
    if (nDay >= PER_DAY) return reply.code(429).send({ error: 'Limite : 5 photos par jour.' });
    let file;
    try { file = await req.file(); } catch { return reply.code(400).send({ error: 'Aucun fichier reçu.' }); }
    if (!file) return reply.code(400).send({ error: 'Aucun fichier reçu.' });
    const buf = await file.toBuffer();
    if (buf.length > MAX_BYTES) return reply.code(413).send({ error: 'Image trop lourde (3 Mo maximum).' });
    const mime = sniff(buf);
    if (!mime) return reply.code(415).send({ error: 'Format refusé. Envoie un JPEG, PNG ou WebP (pas de GIF animé ni de SVG).' });
    let meta;
    try { meta = await probePool(buf); } catch { return reply.code(415).send({ error: 'Image illisible.' }); }
    if (meta.animated) return reply.code(415).send({ error: 'Pas de GIF animé.' });
    if ((meta.width ?? 0) > MAX_DIM || (meta.height ?? 0) > MAX_DIM)
      return reply.code(415).send({ error: 'Image refusée (dimensions ou animation).' });
    // Quota global (F-110)
    const quotaMb = Number(db.prepare('SELECT v FROM kv WHERE k=?').get('avatar_quota_mb')?.v ?? 1024);
    const usedMb = (db.prepare('SELECT COALESCE(SUM(bytes),0) s FROM uploads WHERE status!=?').get('removed').s ?? 0) / 1048576;
    if (usedMb + buf.length / 1048576 > quotaMb) return reply.code(507).send({ error: 'Quota de stockage atteint. Contacte un admin.' });
    // Ré-encodage : carré centré, 256 + 64, métadonnées supprimées (sharp: WebP, jimp: PNG).
    const uuid = crypto.randomUUID();
    const dir = uploadDir();
    const out256 = await coverPool(buf, 256, 256, 82);
    const out64 = await coverPool(buf, 64, 64, 75);
    const ext = out256.mime === 'image/webp' ? 'webp' : 'png';
    fs.writeFileSync(path.join(dir, uuid + '.' + ext), out256.data);
    fs.writeFileSync(path.join(dir, uuid + '-64.' + ext), out64.data);
    const approval = db.prepare('SELECT v FROM kv WHERE k=?').get('avatar_require_approval')?.v === '1';
    const h = crypto.createHash('sha256').update(out256.data).digest('hex');
    db.transaction(() => {
      // Supprime l'ancienne photo (F-107)
      if (u.avatar_kind === 'upload' && u.avatar_ref) {
        for (const e of ['webp', 'png']) {
          try { fs.unlinkSync(path.join(dir, u.avatar_ref + '.' + e)); } catch {}
          try { fs.unlinkSync(path.join(dir, u.avatar_ref + '-64.' + e)); } catch {}
        }
        db.prepare(`UPDATE uploads SET status='removed' WHERE owner_id=? AND path=?`).run(u.id, u.avatar_ref);
      }
      db.prepare(`INSERT INTO uploads(owner_id,kind,path,mime,bytes,sha256,status,created_at) VALUES(?,?,?,?,?,?,?,?)`)
        .run(u.id, 'avatar', uuid, out256.mime, out256.data.length, h, approval ? 'pending' : 'ok', Date.now());
      db.prepare(`UPDATE users SET avatar_kind='upload',avatar_ref=? WHERE id=?`).run(uuid, u.id);
    })();
    return { ok: true, url: `/api/v1/avatar/photo/${uuid}`, pending: approval };
  });

  // Retour au catalogue + suppression du fichier (F-107)
  app.delete('/api/v1/me/avatar/upload', (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const db = getDb();
    if (u.avatar_kind === 'upload' && u.avatar_ref) {
      const dir = uploadDir();
      for (const e of ['webp', 'png']) {
        try { fs.unlinkSync(path.join(dir, u.avatar_ref + '.' + e)); } catch {}
        try { fs.unlinkSync(path.join(dir, u.avatar_ref + '-64.' + e)); } catch {}
      }
      db.prepare(`UPDATE uploads SET status='removed' WHERE owner_id=? AND path=?`).run(u.id, u.avatar_ref);
    }
    db.prepare(`UPDATE users SET avatar_kind='preset',avatar_ref=? WHERE id=?`).run(DEFAUT_AVATAR, u.id);
    return { ok: true };
  });

  // Service d'image dédié (F-106) : nosniff, cache long, jamais d'exécution.
  app.get('/api/v1/avatar/photo/:uuid', (req, reply) => {
    const uuid = String(req.params.uuid);
    if (!/^[0-9a-f-]{36}$/.test(uuid)) return reply.code(404).send({ error: 'Photo introuvable.' });
    const db = getDb();
    const row = db.prepare(`SELECT * FROM uploads WHERE path=? AND kind='avatar'`).get(uuid);
    if (!row || row.status === 'removed') return reply.code(404).send({ error: 'Photo introuvable.' });
    const me = currentUser(req);
    if (row.status === 'pending' && (!me || me.id !== row.owner_id))
      return reply.code(404).send({ error: 'Photo introuvable.' }); // approbation préalable (F-109)
    const small = req.query.s === '64';
    const ext = row.mime === 'image/png' ? 'png' : 'webp';
    const fp = path.join(uploadDir(), uuid + (small ? '-64' : '') + '.' + ext);
    if (!fs.existsSync(fp)) return reply.code(404).send({ error: 'Photo introuvable.' });
    reply.header('Content-Type', row.mime);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Cache-Control', 'public, max-age=31536000, immutable');
    reply.header('Content-Disposition', `inline; filename="avatar.${ext}"`);
    return reply.send(fs.createReadStream(fp));
  });

  // Signalement d'avatar (F-109)
  app.post('/api/v1/avatars/:username/report', (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const db = getDb();
    const target = db.prepare('SELECT id FROM users WHERE username=? COLLATE NOCASE').get(req.params.username);
    if (!target) return reply.code(404).send({ error: 'Joueur introuvable.' });
    db.prepare('INSERT INTO avatar_reports(target_user_id,reporter_id,created_at) VALUES(?,?,?)').run(target.id, u.id, Date.now());
    return { ok: true, message: 'Avatar signalé. Merci.' };
  });

  // Thème du profil (F-91)
  app.patch('/api/v1/me/theme', (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const p = z.object({ theme: z.enum(['system', 'light', 'dark']) }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'Thème inconnu.' });
    getDb().prepare('UPDATE users SET theme_pref=? WHERE id=?').run(p.data.theme, u.id);
    return { ok: true };
  });
}

import { sha256 } from '../auth/password.js';
function currentUser(req) {
  try {
    const tok = req.cookies?.session;
    if (!tok) return null;
    const db = getDb();
    const s = db.prepare('SELECT user_id FROM sessions WHERE token_hash=?').get(sha256tok(tok));
    return s ? db.prepare('SELECT * FROM users WHERE id=?').get(s.user_id) : null;
  } catch { return null; }
}
function sha256tok(t) { return sha256(t); }
export { avatarUrlFor };
