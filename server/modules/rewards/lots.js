import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getDb } from '../../db/db.js';
import { requireAuth } from '../auth/session.js';
import { seal, openWithNonce, lotsEnabled } from '../../lib/crypto.js';
import { hitRate } from '../../lib/rateLimit.js';

// Garde locale (évite un cycle d'imports avec organizers/routes.js).
function requireOrganizer(req, reply) {
  const u = requireAuth(req, reply); if (!u) return null;
  if (u.role !== 'organizer' && u.role !== 'admin') {
    reply.code(403).send({ error: 'Espace réservé aux organisateurs autorisés.' });
    return null;
  }
  return u;
}

// Lots de tournois : types, chiffrement, distribution, Mes lots (F-140..F-163).
const KINDS = ['texte', 'secret', 'fichier', 'lien', 'lot_de_codes'];
const FILE_EXT = { pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', mp3: 'audio/mpeg', mp4: 'video/mp4', zip: 'application/zip', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
const FORCED_CT = { // Content-Type forcés au téléchargement (jamais d'exécution)
  pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', mp3: 'audio/mpeg', mp4: 'video/mp4', zip: 'application/zip',
  docx: 'application/octet-stream', xlsx: 'application/octet-stream', pptx: 'application/octet-stream',
};
function rewardDir() {
  const d = process.env.REWARD_DIR ?? './data/uploads/rewards';
  fs.mkdirSync(d, { recursive: true });
  return d;
}
function sniffReward(buf, ext) {
  const sig = {
    pdf: (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46,
    png: (b) => b[0] === 0x89 && b[1] === 0x50,
    jpg: (b) => b[0] === 0xff && b[1] === 0xd8, jpeg: (b) => b[0] === 0xff && b[1] === 0xd8,
    webp: (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
    gif: (b) => b.toString('ascii', 0, 6) === 'GIF87a' || b.toString('ascii', 0, 6) === 'GIF89a',
    zip: (b) => b[0] === 0x50 && b[1] === 0x4b, docx: (b) => b[0] === 0x50 && b[1] === 0x4b,
    xlsx: (b) => b[0] === 0x50 && b[1] === 0x4b, pptx: (b) => b[0] === 0x50 && b[1] === 0x4b,
    mp3: () => true, mp4: (b) => b.toString('ascii', 4, 8) === 'ftyp',
    txt: () => true, csv: () => true,
  }[ext];
  try { return sig ? sig(buf) : false; } catch { return false; }
}
function hasClamav() {
  try { fs.accessSync('/usr/bin/clamscan'); return true; } catch { return false; }
}
// Sans ClamAV (prouvé absent) : acceptés d'office, les autres exigent une
// validation admin avant publication + avertissement au gagnant (cf. DEPLOY).
const AUTO_EXT = ['txt', 'png', 'jpg', 'jpeg', 'webp', 'pdf'];
const REVIEW_EXT = ['zip', 'docx', 'xlsx', 'pptx', 'mp3', 'mp4', 'csv', 'gif'];

export function rewardUploadRoutes(app) {
  // (multipart enregistré une fois dans app.js)
  // Téléversement d'un fichier de lot (F-143) : 20 Mo, liste blanche, signature.
  app.post('/api/v1/organizer/rewards/upload', async (req, reply) => {
    const u = requireOrganizer(req, reply); if (!u) return;
    const db = getDb();
    let file;
    try { file = await req.file(); } catch { return reply.code(400).send({ error: 'Aucun fichier reçu.' }); }
    if (!file) return reply.code(400).send({ error: 'Aucun fichier reçu.' });
    const ext = (file.filename ?? '').split('.').pop()?.toLowerCase();
    if (!ext || !(ext in FILE_EXT)) return reply.code(415).send({ error: `Extension refusée. Autorisées : ${Object.keys(FILE_EXT).join(', ')}.` });
    const buf = await file.toBuffer();
    if (buf.length > 20 * 1024 * 1024) return reply.code(413).send({ error: 'Fichier trop lourd (20 Mo maximum).' });
    if (!sniffReward(buf, ext)) return reply.code(415).send({ error: 'Signature du fichier invalide (extension usurpée ?).' });
    if (hasClamav()) {
      const tmp = path.join(rewardDir(), 'scan-' + crypto.randomUUID());
      fs.writeFileSync(tmp, buf);
      const { execSync } = await import('node:child_process');
      try { execSync(`clamscan --no-summary "${tmp}"`, { timeout: 60000 }); }
      catch { try { fs.unlinkSync(tmp); } catch {} return reply.code(422).send({ error: 'Fichier refusé par l’antivirus.' }); }
      try { fs.unlinkSync(tmp); } catch {}
    }
    const prof = db.prepare('SELECT * FROM organizer_profiles WHERE user_id=?').get(u.id);
    const quota = (prof?.storage_quota_mb ?? 200) * 1048576;
    const used = db.prepare(`SELECT COALESCE(SUM(bytes),0) s FROM uploads WHERE owner_id=? AND kind='reward' AND status!='removed'`).get(u.id).s;
    if (used + buf.length > quota) return reply.code(507).send({ error: 'Quota de stockage dépassé.' });
    const uuid = crypto.randomUUID();
    fs.writeFileSync(path.join(rewardDir(), uuid + '.' + ext), buf);
    const needsReview = !hasClamav() && REVIEW_EXT.includes(ext);
    const id = db.prepare(`INSERT INTO uploads(owner_id,kind,path,mime,bytes,sha256,status,created_at) VALUES(?,?,?,?,?,?,?,?)`)
      .run(u.id, 'reward', uuid + '.' + ext, FILE_EXT[ext], buf.length, crypto.createHash('sha256').update(buf).digest('hex'), needsReview ? 'pending-scan' : 'ok', Date.now()).lastInsertRowid;
    return { ok: true, uploadId: Number(id), scanned: hasClamav(), pendingReview: needsReview, warning: needsReview ? 'Sans antivirus, ce type de fichier exige une validation admin avant publication.' : (hasClamav() ? undefined : 'ClamAV absent : fichier accepté sans scan antivirus.') };
  });
}

export function organizerRewardRoutes(app) {
  // Créer un lot (F-140..F-144)
  app.post('/api/v1/organizer/tournaments/:id/rewards', (req, reply) => {
    const u = requireOrganizer(req, reply); if (!u) return;
    if (!lotsEnabled()) return reply.code(503).send({ error: 'Lots désactivés : REWARD_KEY manquante.' });
    const p = z.object({
      rankFrom: z.number().int().min(1).max(32), rankTo: z.number().int().min(1).max(32),
      scope: z.enum(['rank', 'participation']).default('rank'),
      publicLabel: z.string().min(3).max(80), kind: z.enum(KINDS),
      instructions: z.string().max(500).default(''), expiresAt: z.number().optional(),
      content: z.string().max(2000).optional(), codes: z.array(z.string().min(1).max(200)).max(64).optional(),
      fileUploadId: z.number().optional(),
    }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'donnees_invalides' });
    const db = getDb();
    const t = db.prepare('SELECT * FROM tournaments WHERE id=? AND organizer_id=?').get(Number(req.params.id), u.id);
    if (!t) return reply.code(404).send({ error: 'Tournoi introuvable.' });
    if (['running', 'done'].includes(t.status)) return reply.code(409).send({ error: 'Tournoi démarré.' });
    const d = p.data;
    let payload_enc = null, nonce = null, fileId = null;
    if (['texte', 'secret', 'lien'].includes(d.kind)) {
      if (!d.content) return reply.code(400).send({ error: 'Contenu requis.' });
      const s = seal(d.content); payload_enc = s.payload_enc; nonce = s.nonce;
    } else if (d.kind === 'lot_de_codes') {
      if (!d.codes?.length) return reply.code(400).send({ error: 'Colle au moins un code.' });
    } else if (d.kind === 'fichier') {
      const up = db.prepare(`SELECT * FROM uploads WHERE id=? AND owner_id=? AND kind='reward'`).get(d.fileUploadId, u.id);
      if (!up) return reply.code(400).send({ error: 'Fichier introuvable.' });
      fileId = up.id;
    }
    const id = db.prepare(`INSERT INTO tournament_rewards(tournament_id,rank_from,rank_to,scope,public_label,kind,instructions,expires_at,payload_enc,nonce,file_upload_id,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(t.id, d.rankFrom, d.rankTo, d.scope, d.publicLabel, d.kind, d.instructions, d.expiresAt ?? null, payload_enc, nonce, fileId, Date.now()).lastInsertRowid;
    if (d.kind === 'lot_de_codes') {
      const ins = db.prepare('INSERT INTO reward_codes(reward_id,code_enc,nonce) VALUES(?,?,?)');
      for (const code of d.codes) { const s = seal(code); ins.run(id, s.payload_enc, s.nonce); }
    }
    return { id: Number(id) };
  });

  // Remplacer un contenu (F-153) : nouveau secret, jamais ré-affiché.
  app.post('/api/v1/organizer/rewards/:id/replace', (req, reply) => {
    const u = requireOrganizer(req, reply); if (!u) return;
    if (!lotsEnabled()) return reply.code(503).send({ error: 'Lots désactivés.' });
    const p = z.object({ content: z.string().min(1).max(2000).optional(), codes: z.array(z.string().min(1).max(200)).max(64).optional() }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'donnees_invalides' });
    const db = getDb();
    const r = db.prepare(`SELECT tr.* FROM tournament_rewards tr JOIN tournaments t ON t.id=tr.tournament_id WHERE tr.id=? AND t.organizer_id=?`).get(Number(req.params.id), u.id);
    if (!r) return reply.code(404).send({ error: 'Lot introuvable.' });
    if (['secret', 'texte', 'lien'].includes(r.kind) && p.data.content) {
      const s = seal(p.data.content);
      db.prepare('UPDATE tournament_rewards SET payload_enc=?,nonce=? WHERE id=?').run(s.payload_enc, s.nonce, r.id);
    } else if (r.kind === 'lot_de_codes' && p.data.codes?.length) {
      const ins = db.prepare('INSERT INTO reward_codes(reward_id,code_enc,nonce) VALUES(?,?,?)');
      for (const code of p.data.codes) { const s = seal(code); ins.run(r.id, s.payload_enc, s.nonce); }
    } else return reply.code(400).send({ error: 'Rien à remplacer.' });
    db.prepare('UPDATE reward_reports SET handled=1 WHERE claim_id IN (SELECT id FROM reward_claims WHERE reward_id=?)').run(r.id);
    return { ok: true };
  });

  // État des lots sans jamais ré-afficher un secret (F-161) : masque •••• + 2 derniers.
  app.get('/api/v1/organizer/tournaments/:id/rewards', (req, reply) => {
    const u = requireOrganizer(req, reply); if (!u) return;
    const db = getDb();
    const t = db.prepare('SELECT * FROM tournaments WHERE id=? AND organizer_id=?').get(Number(req.params.id), u.id);
    if (!t) return reply.code(404).send({ error: 'Tournoi introuvable.' });
    const rows = db.prepare('SELECT * FROM tournament_rewards WHERE tournament_id=?').all(t.id);
    for (const r of rows) {
      r.stats = db.prepare(`SELECT status,COUNT(*) c FROM reward_claims WHERE reward_id=? GROUP BY status`).all(r.id);
      r.reports = db.prepare(`SELECT COUNT(*) c FROM reward_reports WHERE handled=0 AND claim_id IN (SELECT id FROM reward_claims WHERE reward_id=?)`).get(r.id).c;
      r.codes_total = db.prepare('SELECT COUNT(*) c FROM reward_codes WHERE reward_id=?').get(r.id).c;
      r.codes_left = db.prepare('SELECT COUNT(*) c FROM reward_codes WHERE reward_id=? AND assigned_to IS NULL').get(r.id).c;
      if (r.payload_enc && lotsEnabled()) {
        try { const plain = openWithNonce(r.payload_enc, r.nonce); r.masked = '•••• ' + plain.slice(-2); }
        catch { r.masked = '•••• (illisible)'; }
      } else r.masked = null;
      delete r.payload_enc; delete r.nonce; // jamais en clair, même pour l'organisateur (F-161)
    }
    return { rows };
  });

  // Libération manuelle (F-150)
  app.post('/api/v1/organizer/tournaments/:id/release', (req, reply) => {
    const u = requireOrganizer(req, reply); if (!u) return;
    const db = getDb();
    const t = db.prepare('SELECT * FROM tournaments WHERE id=? AND organizer_id=?').get(Number(req.params.id), u.id);
    if (!t) return reply.code(404).send({ error: 'Tournoi introuvable.' });
    if (t.status !== 'done') return reply.code(409).send({ error: 'Tournoi non terminé.' });
    const n = releaseTournamentRewards(db, t.id);
    return { ok: true, claims: n };
  });

  // Disqualification avant révélation (F-155)
  app.post('/api/v1/organizer/tournaments/:id/disqualify', (req, reply) => {
    const u = requireOrganizer(req, reply); if (!u) return;
    const p = z.object({ userId: z.number() }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'donnees_invalides' });
    const db = getDb();
    const t = db.prepare('SELECT * FROM tournaments WHERE id=? AND organizer_id=?').get(Number(req.params.id), u.id);
    if (!t) return reply.code(404).send({ error: 'Tournoi introuvable.' });
    const claims = db.prepare(`SELECT rc.* FROM reward_claims rc JOIN tournament_rewards tr ON tr.id=rc.reward_id WHERE tr.tournament_id=? AND rc.user_id=? AND rc.status!='revealed'`).all(t.id, p.data.userId);
    db.transaction(() => {
      for (const c of claims) {
        if (c.code_id) db.prepare('UPDATE reward_codes SET assigned_to=NULL,assigned_at=NULL WHERE id=?').run(c.code_id); // retour en réserve
        db.prepare('DELETE FROM reward_claims WHERE id=?').run(c.id);
      }
      db.prepare('INSERT INTO audit_log(actor_id,action,target,created_at) VALUES(?,?,?,?)').run(u.id, 'disqualify', `t:${t.id}/u:${p.data.userId}`, Date.now());
    })();
    return { ok: true, removed: claims.length };
  });
}

// Libère les lots d'un tournoi terminé : rangs figés -> claims (F-150).
// Rangs : 1 vainqueur, 2 finaliste, 3-4 demis, 5-8 quarts, etc. (par tour d'élimination).
export function releaseTournamentRewards(db, tournamentId) {
  const t = db.prepare('SELECT * FROM tournaments WHERE id=?').get(tournamentId);
  if (!t || t.status !== 'done') return 0;
  if (db.prepare('SELECT COUNT(*) c FROM reward_claims rc JOIN tournament_rewards tr ON tr.id=rc.reward_id WHERE tr.tournament_id=?').get(tournamentId).c > 0) return 0; // déjà libéré
  const ranks = computeRanks(db, tournamentId);
  const rewards = db.prepare('SELECT * FROM tournament_rewards WHERE tournament_id=?').all(tournamentId);
  let n = 0;
  const ins = db.prepare('INSERT INTO reward_claims(reward_id,user_id,status,created_at) VALUES(?,?,?,?)');
  for (const r of rewards) {
    const winners = [...ranks.entries()].filter(([uid, rank]) =>
      r.scope === 'participation' ? true : rank >= r.rank_from && rank <= r.rank_to).map(([uid]) => uid);
    for (const uid of winners) {
      if (db.prepare('SELECT id FROM reward_claims WHERE reward_id=? AND user_id=?').get(r.id, uid)) continue;
      ins.run(r.id, uid, 'available', Date.now()); n++;
      db.prepare('INSERT INTO notifications(user_id,kind,text,created_at) VALUES(?,?,?,?)')
        .run(uid, 'reward', `Tu as un lot à récupérer : ${r.public_label}.`, Date.now());
    }
  }
  return n;
}
function computeRanks(db, tournamentId) {
  // Vainqueur = 1 ; perdant de la finale = 2 ; éliminés par tour (rangs sportifs réels).
  const t = db.prepare('SELECT winner_id,size FROM tournaments WHERE id=?').get(tournamentId);
  const ranks = new Map();
  if (t?.winner_id) ranks.set(t.winner_id, 1);
  const order = t && t.size <= 8 ? { F: 2, SF: 3, R1: 5 }
    : t && t.size <= 16 ? { F: 2, SF: 3, R2: 5, R1: 9 }
    : { F: 2, SF: 3, QF: 5, R2: 9, R1: 17 };
  const ms = db.prepare('SELECT * FROM tournament_matches WHERE tournament_id=? AND status=?').all(tournamentId, 'done');
  for (const m of ms) {
    for (const pid of [m.p1_id, m.p2_id]) {
      if (!pid || pid === m.winner_id || ranks.has(pid)) continue;
      ranks.set(pid, order[m.round] ?? 9);
    }
  }
  return ranks;
}

export function myRewardRoutes(app) {
  // Mes lots (F-151) : métadonnées seulement, jamais le contenu.
  app.get('/api/v1/me/rewards', (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const db = getDb();
    const rows = db.prepare(`SELECT rc.id,rc.status,rc.revealed_at,rc.downloads_count,
      tr.public_label,tr.kind,tr.instructions,tr.expires_at,t.name tournament_name,up.path upath
      FROM reward_claims rc JOIN tournament_rewards tr ON tr.id=rc.reward_id
      JOIN tournaments t ON t.id=tr.tournament_id LEFT JOIN uploads up ON up.id=tr.file_upload_id
      WHERE rc.user_id=? ORDER BY rc.created_at DESC`).all(u.id);
    for (const r of rows) {
      const ext = (r.upath ?? '').split('.').pop()?.toLowerCase();
      r.warning = (r.kind === 'fichier' && REVIEW_EXT.includes(ext) && !hasClamav())
        ? 'Fichier non scanné par antivirus : ne l’ouvre que si tu fais confiance à l’organisateur.' : null;
      delete r.upath;
    }
    return { rows };
  });

  // Révélation (F-151) : no-store, attribution atomique des codes (F-142).
  app.post('/api/v1/me/rewards/:claimId/reveal', (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    if (!hitRate('reveal:' + u.id, 10, 6e4).allowed) return reply.code(429).send({ error: 'Doucement. Réessaie dans une minute.' });
    if (!lotsEnabled()) return reply.code(503).send({ error: 'Lots désactivés.' });
    const db = getDb();
    const c = db.prepare(`SELECT rc.*,tr.kind,tr.payload_enc,tr.nonce,tr.expires_at FROM reward_claims rc
      JOIN tournament_rewards tr ON tr.id=rc.reward_id WHERE rc.id=? AND rc.user_id=?`).get(Number(req.params.claimId), u.id);
    if (!c) return reply.code(404).send({ error: 'Lot introuvable.' }); // isolation : pas le sien -> 404 (F-§5.6)
    if (c.expires_at && c.expires_at < Date.now()) return reply.code(410).send({ error: 'Lot expiré.' });
    let content;
    if (c.kind === 'lot_de_codes') {
      // Attribution atomique : une seule ligne non assignée, même en concurrence (F-142).
      const row = db.prepare('SELECT id FROM reward_codes WHERE reward_id=? AND assigned_to IS NULL LIMIT 1').get(c.reward_id);
      if (!row) return reply.code(409).send({ error: 'Plus de codes disponibles. Signale-le.' });
      const upd = db.prepare('UPDATE reward_codes SET assigned_to=?,assigned_at=? WHERE id=? AND assigned_to IS NULL').run(u.id, Date.now(), row.id);
      if (upd.changes === 0) return reply.code(409).send({ error: 'Code attribué à l’instant à un autre gagnant. Réessaie.' });
      const code = db.prepare('SELECT code_enc,nonce FROM reward_codes WHERE id=?').get(row.id);
      content = openWithNonce(code.code_enc, code.nonce);
      db.prepare('UPDATE reward_claims SET status=?,revealed_at=?,code_id=? WHERE id=?').run('revealed', Date.now(), row.id, c.id);
    } else {
      if (!c.payload_enc) return reply.code(404).send({ error: 'Contenu indisponible.' });
      content = openWithNonce(c.payload_enc, c.nonce);
      db.prepare('UPDATE reward_claims SET status=?,revealed_at=? WHERE id=?').run('revealed', Date.now(), c.id);
    }
    reply.header('Cache-Control', 'no-store');
    return { content };
  });

  // Téléchargement : 5 fois max (F-152), attachment + nosniff + type forcé.
  app.get('/api/v1/me/rewards/:claimId/download', (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    if (!hitRate('dl:' + u.id, 10, 6e4).allowed) return reply.code(429).send({ error: 'Doucement.' });
    const db = getDb();
    const c = db.prepare(`SELECT rc.*,tr.kind,tr.file_upload_id FROM reward_claims rc
      JOIN tournament_rewards tr ON tr.id=rc.reward_id WHERE rc.id=? AND rc.user_id=?`).get(Number(req.params.claimId), u.id);
    if (!c || c.kind !== 'fichier') return reply.code(404).send({ error: 'Fichier introuvable.' });
    if (c.downloads_count >= 5) return reply.code(409).send({ error: 'Limite de 5 téléchargements atteinte.' });
    const up = db.prepare('SELECT * FROM uploads WHERE id=?').get(c.file_upload_id);
    if (!up || up.status === 'removed') return reply.code(404).send({ error: 'Fichier introuvable.' });
    if (up.status === 'pending-scan') return reply.code(409).send({ error: 'Fichier en attente de validation admin.' });
    const dir = process.env.REWARD_DIR ?? './data/uploads/rewards';
    const fp = path.join(dir, up.path);
    if (!fs.existsSync(fp)) return reply.code(404).send({ error: 'Fichier introuvable.' });
    const ext = up.path.split('.').pop();
    db.prepare('UPDATE reward_claims SET downloads_count=downloads_count+1 WHERE id=?').run(c.id);
    reply.header('Content-Type', forcedCt(ext));
    reply.header('Content-Disposition', `attachment; filename="lot-${c.id}.${ext}"`);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Cache-Control', 'no-store');
    return reply.send(fs.createReadStream(fp));
  });
  function forcedCt(ext) {
    return { pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', mp3: 'audio/mpeg', mp4: 'video/mp4', zip: 'application/zip' }[ext] ?? 'application/octet-stream';
  }

  // Signalement d'un lot défectueux (F-153)
  app.post('/api/v1/me/rewards/:claimId/report', (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const p = z.object({ reason: z.string().min(3).max(300) }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'donnees_invalides' });
    const db = getDb();
    const c = db.prepare(`SELECT rc.*,tr.tournament_id FROM reward_claims rc JOIN tournament_rewards tr ON tr.id=rc.reward_id WHERE rc.id=? AND rc.user_id=?`).get(Number(req.params.claimId), u.id);
    if (!c) return reply.code(404).send({ error: 'Lot introuvable.' });
    db.transaction(() => {
      db.prepare('INSERT INTO reward_reports(claim_id,user_id,reason,created_at) VALUES(?,?,?,?)').run(c.id, u.id, p.data.reason, Date.now());
      db.prepare('UPDATE reward_claims SET status=? WHERE id=?').run('reported', c.id);
      const org = db.prepare('SELECT organizer_id FROM tournaments WHERE id=?').get(c.tournament_id)?.organizer_id;
      if (org) db.prepare('INSERT INTO notifications(user_id,kind,text,created_at) VALUES(?,?,?,?)').run(org, 'reward', 'Un gagnant signale un lot défectueux.', Date.now());
    })();
    return { ok: true };
  });
}
