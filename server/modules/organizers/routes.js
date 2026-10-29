import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../../db/db.js';
import { requireAuth } from '../auth/session.js';
import { hitRate } from '../../lib/rateLimit.js';
import { buildBracket } from '../tournaments/routes.js';
import { sha256 } from '../auth/password.js';

function currentToneCover(req) {
  try {
    const tok = req.cookies?.session;
    if (!tok) return null;
    const s = getDb().prepare('SELECT user_id FROM sessions WHERE token_hash=?').get(sha256(tok));
    return s ? getDb().prepare('SELECT * FROM users WHERE id=?').get(s.user_id) : null;
  } catch { return null; }
}

// Rôle organisateur (F-120..F-123) + tournois personnalisés (F-130..F-137).
export function organizerAdminRoutes(app) {
  const needAdmin = (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return null;
    if (u.role !== 'admin') { reply.code(403).send({ error: 'admin requis' }); return null; }
    return u;
  };
  // Autoriser / retirer (F-120), audit enregistré.
  app.post('/api/v1/admin/organizers/:userId/grant', (req, reply) => {
    const admin = needAdmin(req, reply); if (!admin) return;
    const db = getDb();
    const target = db.prepare('SELECT id,role FROM users WHERE id=?').get(Number(req.params.userId));
    if (!target) return reply.code(404).send({ error: 'Joueur introuvable.' });
    db.transaction(() => {
      db.prepare(`UPDATE users SET role='organizer' WHERE id=?`).run(target.id);
      db.prepare(`INSERT INTO organizer_profiles(user_id,granted_by,granted_at) VALUES(?,?,?)
        ON CONFLICT(user_id) DO UPDATE SET revoked_at=NULL,granted_by=?,granted_at=?`)
        .run(target.id, admin.id, Date.now(), admin.id, Date.now());
      db.prepare('INSERT INTO audit_log(actor_id,action,target,created_at) VALUES(?,?,?,?)')
        .run(admin.id, 'orga_grant', 'u:' + target.id, Date.now());
    })();
    return { ok: true };
  });
  app.post('/api/v1/admin/organizers/:userId/revoke', (req, reply) => {
    const admin = needAdmin(req, reply); if (!admin) return;
    const db = getDb();
    db.transaction(() => {
      db.prepare(`UPDATE users SET role='user' WHERE id=? AND role='organizer'`).run(Number(req.params.userId));
      db.prepare(`UPDATE organizer_profiles SET revoked_at=? WHERE user_id=?`).run(Date.now(), Number(req.params.userId));
      db.prepare('INSERT INTO audit_log(actor_id,action,target,created_at) VALUES(?,?,?,?)')
        .run(admin.id, 'orga_revoke', 'u:' + req.params.userId, Date.now());
    })();
    // Les tournois en cours vont à leur terme (F-136) : on ne touche à rien.
    return { ok: true };
  });
  // Quotas (F-121)
  app.patch('/api/v1/admin/organizers/:userId/quotas', (req, reply) => {
    const admin = needAdmin(req, reply); if (!admin) return;
    const p = z.object({
      max_active_tournaments: z.number().int().min(1).max(20).optional(),
      max_players: z.number().int().min(8).max(32).optional(),
      storage_quota_mb: z.number().int().min(10).max(2000).optional(),
      requires_approval: z.number().int().min(0).max(1).optional(),
    }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'donnees_invalides' });
    const db = getDb();
    const prof = db.prepare('SELECT * FROM organizer_profiles WHERE user_id=?').get(Number(req.params.userId));
    if (!prof) return reply.code(404).send({ error: 'Pas organisateur.' });
    const q = { ...prof, ...Object.fromEntries(Object.entries(p.data).filter(([, v]) => v !== undefined)) };
    db.prepare(`UPDATE organizer_profiles SET max_active_tournaments=?,max_players=?,storage_quota_mb=?,requires_approval=? WHERE user_id=?`)
      .run(q.max_active_tournaments, q.max_players, q.storage_quota_mb, q.requires_approval, Number(req.params.userId));
    db.prepare('INSERT INTO audit_log(actor_id,action,target,created_at) VALUES(?,?,?,?)')
      .run(admin.id, 'orga_quotas', 'u:' + req.params.userId, Date.now());
    return { ok: true };
  });
  app.get('/api/v1/admin/organizers', (req, reply) => {
    const admin = needAdmin(req, reply); if (!admin) return;
    return { rows: getDb().prepare(`SELECT u.id,u.username,o.* FROM organizer_profiles o JOIN users u ON u.id=o.user_id`).all() };
  });
  // File de validation (F-135)
  app.get('/api/v1/admin/tournaments/pending', (req, reply) => {
    if (!needAdmin(req, reply)) return;
    return { rows: getDb().prepare(`SELECT t.*,u.username org FROM tournaments t LEFT JOIN users u ON u.id=t.organizer_id WHERE t.approval_status='pending'`).all() };
  });
  app.post('/api/v1/admin/tournaments/:id/approve', (req, reply) => {
    const admin = needAdmin(req, reply); if (!admin) return;
    const db = getDb();
    db.prepare(`UPDATE tournaments SET approval_status='approved',status='open' WHERE id=?`).run(Number(req.params.id));
    const t = db.prepare('SELECT organizer_id FROM tournaments WHERE id=?').get(Number(req.params.id));
    if (t?.organizer_id) db.prepare('INSERT INTO notifications(user_id,kind,text,created_at) VALUES(?,?,?,?)').run(t.organizer_id, 'tournament', 'Ton tournoi est publié.', Date.now());
    db.prepare('INSERT INTO audit_log(actor_id,action,target,created_at) VALUES(?,?,?,?)').run(admin.id, 'tournoi_approve', 't:' + req.params.id, Date.now());
    return { ok: true };
  });
  app.post('/api/v1/admin/tournaments/:id/reject', (req, reply) => {
    const admin = needAdmin(req, reply); if (!admin) return;
    const reason = String(req.body?.reason ?? '').slice(0, 300);
    const db = getDb();
    db.prepare(`UPDATE tournaments SET approval_status='rejected',rejection_reason=?,status='cancelled' WHERE id=?`).run(reason, Number(req.params.id));
    const t = db.prepare('SELECT organizer_id FROM tournaments WHERE id=?').get(Number(req.params.id));
    if (t?.organizer_id) db.prepare('INSERT INTO notifications(user_id,kind,text,created_at) VALUES(?,?,?,?)').run(t.organizer_id, 'tournament', 'Tournoi refusé : ' + reason, Date.now());
    db.prepare('INSERT INTO audit_log(actor_id,action,target,created_at) VALUES(?,?,?,?)').run(admin.id, 'tournoi_reject', 't:' + req.params.id, Date.now());
    return { ok: true };
  });
  // Retrait d'avatar + suspension d'upload (F-109)
  app.post('/api/v1/admin/avatars/:userId/remove', (req, reply) => {
    const admin = needAdmin(req, reply); if (!admin) return;
    const p = z.object({ banUpload: z.boolean().optional() }).safeParse(req.body ?? {});
    const db = getDb();
    const target = db.prepare('SELECT * FROM users WHERE id=?').get(Number(req.params.userId));
    if (!target) return reply.code(404).send({ error: 'Joueur introuvable.' });
    db.transaction(() => {
      if (target.avatar_kind === 'upload' && target.avatar_ref) {
        db.prepare(`UPDATE uploads SET status='removed' WHERE owner_id=? AND path=?`).run(target.id, target.avatar_ref);
      }
      db.prepare(`UPDATE users SET avatar_kind='preset',avatar_ref='personnage-a1.svg',upload_banned=? WHERE id=?`)
        .run(p.data?.banUpload ? 1 : target.upload_banned, target.id);
      db.prepare('UPDATE avatar_reports SET handled=1 WHERE target_user_id=?').run(target.id);
      db.prepare('INSERT INTO audit_log(actor_id,action,target,created_at) VALUES(?,?,?,?)')
        .run(admin.id, 'avatar_remove', 'u:' + target.id, Date.now());
    })();
    return { ok: true };
  });
  app.get('/api/v1/admin/avatars/reports', (req, reply) => {
    if (!needAdmin(req, reply)) return;
    return { rows: getDb().prepare('SELECT * FROM avatar_reports WHERE handled=0 LIMIT 50').all() };
  });
  // Validation d'un fichier de lot en attente (sans ClamAV).
  app.post('/api/v1/admin/uploads/:id/approve', (req, reply) => {
    const admin = needAdmin(req, reply); if (!admin) return;
    const db = getDb();
    const up = db.prepare('SELECT * FROM uploads WHERE id=?').get(Number(req.params.id));
    if (!up) return reply.code(404).send({ error: 'Fichier introuvable.' });
    db.prepare(`UPDATE uploads SET status='ok' WHERE id=?`).run(up.id);
    db.prepare('INSERT INTO audit_log(actor_id,action,target,created_at) VALUES(?,?,?,?)').run(admin.id, 'upload_approve', 'up:' + up.id, Date.now());
    return { ok: true };
  });
  app.get('/api/v1/admin/uploads/pending', (req, reply) => {
    if (!needAdmin(req, reply)) return;
    return { rows: getDb().prepare(`SELECT * FROM uploads WHERE status='pending-scan' LIMIT 50`).all() };
  });
}

export function requireOrganizer(req, reply) {
  const u = requireAuth(req, reply); if (!u) return null;
  if (u.role !== 'organizer' && u.role !== 'admin') {
    reply.code(403).send({ error: 'Espace réservé aux organisateurs autorisés.' }); // F-123
    return null;
  }
  return u;
}

const RulesJson = z.object({
  categories: z.array(z.string().max(30)).max(8).optional(),
  difficulty: z.enum(['mixte', 'facile', 'moyen', 'difficile']).optional(),
  finalBestOf: z.union([z.literal(1), z.literal(3)]).optional(),
  minLevel: z.number().int().min(1).max(100).optional(),
  minLeague: z.string().max(20).optional(),
  guests: z.array(z.string().max(16)).max(100).optional(),
  disqualifyPolicy: z.enum(['reserve', 'next']).optional(), // F-155
}).strict().partial();

export function organizerTournamentRoutes(app) {
  // Tableau de bord (F-160..F-162)
  app.get('/api/v1/organizer/tournaments', (req, reply) => {
    const u = requireOrganizer(req, reply); if (!u) return;
    const db = getDb();
    const rows = db.prepare('SELECT * FROM tournaments WHERE organizer_id=? ORDER BY starts_at DESC').all(u.id);
    for (const t of rows) {
      t.inscrits = db.prepare('SELECT COUNT(*) c FROM tournament_players WHERE tournament_id=?').get(t.id).c;
      t.pointes = db.prepare('SELECT COUNT(*) c FROM tournament_players WHERE tournament_id=? AND checked_in=1').get(t.id).c;
      t.lots_reclames = db.prepare(`SELECT COUNT(*) c FROM reward_claims rc JOIN tournament_rewards tr ON tr.id=rc.reward_id WHERE tr.tournament_id=?`).get(t.id).c;
    }
    return { rows };
  });

  // Création (brouillon), 5/jour (F-130..F-136)
  app.post('/api/v1/organizer/tournaments', (req, reply) => {
    const u = requireOrganizer(req, reply); if (!u) return;
    if (!hitRate('tcreate:' + u.id, 5, 864e5).allowed)
      return reply.code(429).send({ error: 'Limite : 5 tournois par jour.' });
    const p = z.object({
      name: z.string().min(3).max(60), description: z.string().max(500).default(''),
      size: z.union([z.literal(8), z.literal(16), z.literal(32)]),
      startsAt: z.number(), regOpenAt: z.number().optional(), regCloseAt: z.number().optional(),
      visibility: z.enum(['public', 'private']).default('public'),
      cover: z.string().max(40).optional(), rules: RulesJson.optional(),
      manualRelease: z.boolean().optional(),
    }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'donnees_invalides' });
    const db = getDb();
    const prof = db.prepare('SELECT * FROM organizer_profiles WHERE user_id=?').get(u.id) ?? { max_active_tournaments: 3, max_players: 32 };
    if (p.data.size > prof.max_players) return reply.code(400).send({ error: `Quota : ${prof.max_players} participants maximum.` });
    const active = db.prepare(`SELECT COUNT(*) c FROM tournaments WHERE organizer_id=? AND status IN ('announced','open','running')`).get(u.id).c;
    if (active >= prof.max_active_tournaments) return reply.code(409).send({ error: 'Quota de tournois actifs atteint.' });
    // Conditions d'accès : vérifiées à l'inscription (texte brut, échappé à l'affichage).
    const invite = p.data.visibility === 'private' ? crypto6() : null;
    const id = db.prepare(`INSERT INTO tournaments(name,size,status,starts_at,checkin_at,organizer_id,description,cover_ref,visibility,invite_code,approval_status,rules_json,manual_release,reward_release)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      p.data.name, p.data.size, 'draft', p.data.startsAt, p.data.startsAt - 15 * 6e4,
      u.id, p.data.description, p.data.cover ?? null, p.data.visibility, invite,
      'draft', JSON.stringify(p.data.rules ?? {}), p.data.manualRelease ? 1 : 0,
      p.data.manualRelease ? 'manual' : 'auto',
    ).lastInsertRowid;
    return { id: Number(id), inviteCode: invite };
  });

  app.patch('/api/v1/organizer/tournaments/:id', (req, reply) => {
    const u = requireOrganizer(req, reply); if (!u) return;
    const db = getDb();
    const t = ownTournament(db, u.id, Number(req.params.id));
    if (!t) return reply.code(404).send({ error: 'Tournoi introuvable.' });
    if (!['draft', 'announced', 'open'].includes(t.status)) return reply.code(409).send({ error: 'Tournoi déjà démarré : modification impossible.' }); // F-136
    const p = z.object({
      name: z.string().min(3).max(60).optional(), description: z.string().max(500).optional(),
      startsAt: z.number().optional(), size: z.union([z.literal(8), z.literal(16), z.literal(32)]).optional(),
      visibility: z.enum(['public', 'private']).optional(), cover: z.string().max(60).nullable().optional(),
      rules: RulesJson.optional(), manualRelease: z.boolean().optional(),
    }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'donnees_invalides' });
    const d = p.data;
    const prof = db.prepare('SELECT * FROM organizer_profiles WHERE user_id=?').get(u.id);
    if (d.size && prof && d.size > prof.max_players) return reply.code(400).send({ error: 'Quota dépassé.' });
    const sets = [];
    if (d.name) sets.push(['name', d.name]);
    if (d.description !== undefined) sets.push(['description', d.description]);
    if (d.startsAt) { sets.push(['starts_at', d.startsAt]); sets.push(['checkin_at', d.startsAt - 15 * 6e4]); }
    if (d.size) sets.push(['size', d.size]);
    if (d.cover !== undefined) sets.push(['cover_ref', d.cover]);
    if (d.rules) sets.push(['rules_json', JSON.stringify(d.rules)]);
    if (d.manualRelease !== undefined) { sets.push(['manual_release', d.manualRelease ? 1 : 0]); sets.push(['reward_release', d.manualRelease ? 'manual' : 'auto']); }
    if (d.visibility && d.visibility !== t.visibility) {
      sets.push(['visibility', d.visibility]);
      if (d.visibility === 'private' && !t.invite_code) sets.push(['invite_code', crypto6()]);
      if (d.visibility === 'public') sets.push(['invite_code', null]);
    }
    for (const [col, val] of sets) db.prepare(`UPDATE tournaments SET ${col}=? WHERE id=?`).run(val, t.id);
    return { ok: true, inviteCode: db.prepare('SELECT invite_code FROM tournaments WHERE id=?').get(t.id)?.invite_code ?? null };
  });

  // Brouillon vide pour l'assistant (F-130) : l'assistant sauvegarde au fil des étapes.
  app.post('/api/v1/organizer/tournaments/draft', (req, reply) => {
    const u = requireOrganizer(req, reply); if (!u) return;
    if (!hitRate('tcreate:' + u.id, 5, 864e5).allowed)
      return reply.code(429).send({ error: 'Limite : 5 tournois par jour.' });
    const db = getDb();
    const id = db.prepare(`INSERT INTO tournaments(name,size,status,starts_at,checkin_at,organizer_id,description,visibility,approval_status,rules_json,manual_release,reward_release)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run('Nouveau tournoi', 8, 'draft', Date.now() + 7 * 864e5, Date.now() + 7 * 864e5 - 9e5, u.id, '', 'public', 'draft', '{}', 0, 'auto').lastInsertRowid;
    return { id: Number(id) };
  });

  // Couverture téléversée : même traitement sécurisé que les avatars (F-130).
  app.post('/api/v1/organizer/tournaments/:id/cover', async (req, reply) => {
    const u = requireOrganizer(req, reply); if (!u) return;
    const db = getDb();
    const t = ownTournament(db, u.id, Number(req.params.id));
    if (!t) return reply.code(404).send({ error: 'Tournoi introuvable.' });
    if (['running', 'done'].includes(t.status)) return reply.code(409).send({ error: 'Tournoi démarré.' });
    let file;
    try { file = await req.file(); } catch { return reply.code(400).send({ error: 'Aucun fichier reçu.' }); }
    if (!file) return reply.code(400).send({ error: 'Aucun fichier reçu.' });
    const buf = await file.toBuffer();
    if (buf.length > 3 * 1024 * 1024) return reply.code(413).send({ error: 'Image trop lourde (3 Mo maximum).' });
    const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
    const isPng = buf[0] === 0x89 && buf[1] === 0x50;
    const isWebp = buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';
    if (!isJpeg && !isPng && !isWebp) return reply.code(415).send({ error: 'JPEG, PNG ou WebP uniquement.' });
    const { probePool, coverPool } = await import('../../lib/imgpool.js');
    let meta;
    try { meta = await probePool(buf); } catch { return reply.code(415).send({ error: 'Image illisible.' }); }
    if (meta.animated) return reply.code(415).send({ error: 'Pas de GIF animé.' });
    if ((meta.width ?? 0) > 6000 || (meta.height ?? 0) > 6000) return reply.code(415).send({ error: 'Image trop grande.' });
    const uuid = crypto.randomUUID();
    const dir = process.env.REWARD_DIR ?? './data/uploads/rewards';
    fs.mkdirSync(dir, { recursive: true });
    const out = await coverPool(buf, 800, 450, 80);
    const cext = out.mime === 'image/webp' ? 'webp' : 'png';
    fs.writeFileSync(path.join(dir, 'cover-' + uuid + '.' + cext), out.data);
    db.prepare(`INSERT INTO uploads(owner_id,kind,path,mime,bytes,sha256,status,created_at) VALUES(?,?,?,?,?,?,?,?)`)
      .run(u.id, 'cover', 'cover-' + uuid + '.' + cext, out.mime, out.data.length, 'x', 'ok', Date.now());
    db.prepare('UPDATE tournaments SET cover_ref=? WHERE id=?').run('upload:cover-' + uuid + '.' + cext, t.id);
    return { ok: true };
  });

  // Acceptation datée des règles d'organisation (F-122).
  app.post('/api/v1/organizer/tournaments/:id/terms', (req, reply) => {
    const u = requireOrganizer(req, reply); if (!u) return;
    const db = getDb();
    db.prepare('UPDATE organizer_profiles SET terms_accepted_at=COALESCE(terms_accepted_at,?) WHERE user_id=?').run(Date.now(), u.id);
    return { ok: true };
  });

  // Service des couvertures téléversées (règles d'accès du tournoi).
  app.get('/api/v1/cover/photo/:name', (req, reply) => {
    const name = String(req.params.name);
    if (!/^cover-[0-9a-f-]{36}\.(webp|png)$/.test(name)) return reply.code(404).send({ error: 'Introuvable.' });
    const db = getDb();
    const t = db.prepare('SELECT visibility,approval_status,organizer_id,id FROM tournaments WHERE cover_ref=?').get('upload:' + name);
    if (!t) return reply.code(404).send({ error: 'Introuvable.' });
    if (t.visibility === 'private') {
      const me = currentToneCover(req);
      const inscrit = me ? db.prepare('SELECT user_id FROM tournament_players WHERE tournament_id=? AND user_id=?').get(t.id, me.id) : null;
      if (!inscrit && (!me || (me.role !== 'admin' && me.id !== t.organizer_id))) return reply.code(403).send({ error: 'Privé.' });
    }
    const dir = process.env.REWARD_DIR ?? './data/uploads/rewards';
    const fp = path.join(dir, name);
    if (!fs.existsSync(fp)) return reply.code(404).send({ error: 'Introuvable.' });
    reply.header('Content-Type', name.endsWith('.png') ? 'image/png' : 'image/webp');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Cache-Control', 'public, max-age=31536000, immutable');
    return reply.send(fs.createReadStream(fp));
  });

  // Publication : validation admin si requise (F-135), sinon ouverture directe.
  app.post('/api/v1/organizer/tournaments/:id/publish', (req, reply) => {
    const u = requireOrganizer(req, reply); if (!u) return;
    const db = getDb();
    const t = ownTournament(db, u.id, Number(req.params.id));
    if (!t) return reply.code(404).send({ error: 'Tournoi introuvable.' });
    if (t.approval_status !== 'draft') return reply.code(409).send({ error: 'Déjà publié.' });
    // F-142 : assez de codes pour les gagnants avant publication.
    const need = db.prepare(`SELECT tr.id,tr.public_label,COUNT(rc.id) n FROM tournament_rewards tr LEFT JOIN reward_codes rc ON rc.reward_id=tr.id WHERE tr.tournament_id=? AND tr.kind='lot_de_codes' GROUP BY tr.id`).all(t.id);
    for (const r of need) {
      const eligible = eligibleCount(t, r.id);
      if (r.n < eligible) return reply.code(409).send({ error: `Lot « ${r.public_label} » : ${r.n} codes pour ${eligible} gagnants. Ajoute des codes.` });
    }
    // Fichiers en attente de validation (sans ClamAV) : publication bloquée.
    const pend = db.prepare(`SELECT tr.public_label FROM tournament_rewards tr JOIN uploads u ON u.id=tr.file_upload_id WHERE tr.tournament_id=? AND u.status='pending-scan'`).all(t.id);
    if (pend.length) return reply.code(409).send({ error: `Fichiers en attente de validation admin : ${pend.map((p) => p.public_label).join(', ')}.` });
    const prof = db.prepare('SELECT * FROM organizer_profiles WHERE user_id=?').get(u.id);
    if (prof?.requires_approval) {
      db.prepare(`UPDATE tournaments SET approval_status='pending',status='announced' WHERE id=?`).run(t.id);
      return { ok: true, status: 'pending', message: 'Envoyé en validation admin.' };
    }
    db.prepare(`UPDATE tournaments SET approval_status='approved',status='open' WHERE id=?`).run(t.id);
    return { ok: true, status: 'open' };
  });

  // Annulation avant démarrage + notification (F-136)
  app.post('/api/v1/organizer/tournaments/:id/cancel', (req, reply) => {
    const u = requireOrganizer(req, reply); if (!u) return;
    const db = getDb();
    const t = ownTournament(db, u.id, Number(req.params.id));
    if (!t) return reply.code(404).send({ error: 'Tournoi introuvable.' });
    if (['running', 'done'].includes(t.status)) return reply.code(409).send({ error: 'Tournoi démarré : annulation impossible.' });
    db.transaction(() => {
      db.prepare(`UPDATE tournaments SET status='cancelled' WHERE id=?`).run(t.id);
      const ps = db.prepare('SELECT user_id FROM tournament_players WHERE tournament_id=?').all(t.id);
      const ins = db.prepare('INSERT INTO notifications(user_id,kind,text,created_at) VALUES(?,?,?,?)');
      for (const p of ps) ins.run(p.user_id, 'tournament', `Tournoi « ${t.name} » annulé par l’organisateur.`, Date.now());
    })();
    return { ok: true };
  });

  // Duplication sans les secrets (F-163)
  app.post('/api/v1/organizer/tournaments/:id/duplicate', (req, reply) => {
    const u = requireOrganizer(req, reply); if (!u) return;
    const db = getDb();
    const t = ownTournament(db, u.id, Number(req.params.id));
    if (!t) return reply.code(404).send({ error: 'Tournoi introuvable.' });
    const id = db.prepare(`INSERT INTO tournaments(name,size,status,starts_at,checkin_at,organizer_id,description,cover_ref,visibility,rules_json,manual_release,reward_release,approval_status)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('Copie de ' + t.name, t.size, 'draft', Date.now() + 7 * 864e5, Date.now() + 7 * 864e5 - 9e5, u.id, t.description, t.cover_ref, t.visibility, t.rules_json, t.manual_release, t.reward_release, 'draft').lastInsertRowid;
    // Lots : libellés seulement, aucun contenu (F-163).
    const rewards = db.prepare('SELECT rank_from,rank_to,scope,public_label,kind,instructions,expires_at FROM tournament_rewards WHERE tournament_id=?').all(t.id);
    const ins = db.prepare('INSERT INTO tournament_rewards(tournament_id,rank_from,rank_to,scope,public_label,kind,instructions,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)');
    for (const r of rewards) ins.run(id, r.rank_from, r.rank_to, r.scope, r.public_label, r.kind, r.instructions, r.expires_at, Date.now());
    return { id: Number(id) };
  });

  // Export CSV des résultats (F-163)
  app.get('/api/v1/organizer/tournaments/:id/export.csv', (req, reply) => {
    const u = requireOrganizer(req, reply); if (!u) return;
    const db = getDb();
    const t = ownTournament(db, u.id, Number(req.params.id));
    if (!t) return reply.code(404).send({ error: 'Tournoi introuvable.' });
    const ms = db.prepare('SELECT round,slot,p1_id,p2_id,winner_id,status FROM tournament_matches WHERE tournament_id=? ORDER BY round,slot').all(t.id);
    const name = (id) => id ? db.prepare('SELECT username FROM users WHERE id=?').get(id)?.username ?? id : '';
    let csv = 'tour;slot;joueur1;joueur2;vainqueur;statut\n';
    for (const m of ms) csv += `${m.round};${m.slot};${name(m.p1_id)};${name(m.p2_id)};${name(m.winner_id)};${m.status}\n`;
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="tournoi-${t.id}.csv"`);
    return csv;
  });
}

function ownTournament(db, userId, tid) {
  const t = db.prepare('SELECT * FROM tournaments WHERE id=?').get(tid);
  if (!t || (t.organizer_id !== userId)) return null; // isolation (A ne touche pas B)
  return t;
}
function eligibleCount(t, rewardId) {
  // Gagnants éligibles d'un lot de codes : rangs couverts (simplifié : taille de la plage).
  const db = getDb();
  const r = db.prepare('SELECT rank_from,rank_to,scope FROM tournament_rewards WHERE id=?').get(rewardId);
  if (!r) return 0;
  if (r.scope === 'participation') return t.size;
  return Math.max(0, r.rank_to - r.rank_from + 1);
}
function crypto6() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  const b = new Uint8Array(6);
  crypto.getRandomValues(b);
  for (const x of b) s += abc[x % abc.length];
  return s;
}
import crypto from 'node:crypto';
