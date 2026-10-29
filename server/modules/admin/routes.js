import { getDb } from '../../db/db.js';
import { requireAuth } from '../auth/session.js';
import fs from 'node:fs';
import path from 'node:path';
import { active } from '../duels/engine.js';
import { isMaintenance, setMaintenance } from '../../lib/maintenance.js';

const bootCpu = process.cpuUsage();
const bootTime = Date.now();
function dirBytes(dir, budget = 20000) {
  // Taille récursive bornée (ne bloque pas sur un dossier énorme).
  let total = 0, n = 0;
  const pile = [dir];
  while (pile.length && n < budget) {
    const d = pile.pop();
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const fp = path.join(d, e.name);
      try {
        if (e.isDirectory()) pile.push(fp);
        else { total += fs.statSync(fp).size; n++; }
      } catch { /* ignore */ }
    }
  }
  return { bytes: total, tronque: pile.length > 0 || n >= budget };
}

// Admin : métriques, modération, sanctions, audit (F-80..F-82).
export function adminRoutes(app) {
  const need = (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return null;
    if (u.role !== 'admin') { reply.code(403).send({ error: 'admin requis' }); return null; }
    return u;
  };
  app.get('/api/v1/admin/metrics', (req, reply) => {
    if (!need(req, reply)) return;
    const db = getDb();
    return {
      users: db.prepare('SELECT COUNT(*) c FROM users').get().c,
      onlineHour: db.prepare('SELECT COUNT(*) c FROM users WHERE last_seen_at>?').get(Date.now() - 36e5).c,
      duelsHour: db.prepare('SELECT COUNT(*) c FROM duels WHERE started_at>?').get(Date.now() - 36e5).c,
      questionsLive: db.prepare("SELECT COUNT(*) c FROM questions WHERE status='live'").get().c,
      pending: db.prepare("SELECT COUNT(*) c FROM questions WHERE status IN ('pending','review')").get().c,
      memMB: Math.round(process.memoryUsage().rss / 1048576),
    };
  });
  app.get('/api/v1/admin/moderation', (req, reply) => {
    if (!need(req, reply)) return;
    const db = getDb();
    return {
      // F-71 : non vérifiées d'abord
      queue: db.prepare(`SELECT q.*,c.slug cat FROM questions q JOIN categories c ON c.id=q.category_id WHERE q.status IN ('pending','review') OR q.verified=0 ORDER BY q.verified ASC LIMIT 50`).all(),
      reports: db.prepare('SELECT * FROM question_reports WHERE handled=0 LIMIT 50').all(),
    };
  });
  app.post('/api/v1/admin/questions/:id', (req, reply) => {
    const admin = need(req, reply); if (!admin) return;
    const db = getDb();
    const action = req.body?.action; // approve|reject|live
    if (action === 'approve') db.prepare(`UPDATE questions SET status='live',verified=1 WHERE id=?`).run(Number(req.params.id));
    else db.prepare(`UPDATE questions SET status='rejected' WHERE id=?`).run(Number(req.params.id));
    db.prepare('UPDATE question_reports SET handled=1 WHERE question_id=?').run(Number(req.params.id));
    db.prepare('INSERT INTO audit_log(actor_id,action,target,created_at) VALUES(?,?,?,?)').run(admin.id, 'mod_question_' + action, 'q:' + req.params.id, Date.now());
    return { ok: true };
  });
  app.post('/api/v1/admin/sanction', (req, reply) => {
    const admin = need(req, reply); if (!admin) return;
    const { username, action } = req.body ?? {}; // warn|mute|suspend
    const db = getDb();
    const u = db.prepare('SELECT id FROM users WHERE username=? COLLATE NOCASE').get(username);
    if (!u) return reply.code(404).send({ error: 'Joueur introuvable.' });
    if (action === 'suspend') db.prepare(`UPDATE users SET status='suspended' WHERE id=?`).run(u.id);
    db.prepare('INSERT INTO audit_log(actor_id,action,target,created_at) VALUES(?,?,?,?)').run(admin.id, 'sanction_' + action, 'u:' + username, Date.now());
    return { ok: true };
  });
  app.get('/api/v1/admin/audit', (req, reply) => {
    if (!need(req, reply)) return;
    return { rows: getDb().prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 100').all() };
  });
  // Mode maintenance : page « On revient bientôt », duels en cours terminés (F-§15.6).
  app.get('/api/v1/admin/maintenance', (req, reply) => {
    if (!need(req, reply)) return;
    return { maintenance: isMaintenance(), duelsActifs: active.size };
  });
  app.post('/api/v1/admin/maintenance', (req, reply) => {
    const admin = need(req, reply); if (!admin) return;
    const on = !!req.body?.on;
    setMaintenance(on);
    getDb().prepare('INSERT INTO audit_log(actor_id,action,target,created_at) VALUES(?,?,?,?)').run(admin.id, 'maintenance_' + (on ? 'on' : 'off'), '-', Date.now());
    return { ok: true, maintenance: on, duelsActifs: active.size };
  });
  app.get('/api/v1/admin/health', (req, reply) => {
    if (!need(req, reply)) return;
    const db = getDb();
    const mem = process.memoryUsage();
    const cpu = process.cpuUsage(bootCpu);
    const dtS = Math.max(1, (Date.now() - bootTime) / 1000);
    let disk = null;
    try {
      const st = fs.statfsSync('/');
      disk = { libreMo: Math.round((st.bavail * st.bsize) / 1048576), totalMo: Math.round((st.blocks * st.bsize) / 1048576) };
    } catch { /* non supporté */ }
    const upRoot = process.env.UPLOAD_ROOT ?? './data/uploads';
    const avDir = process.env.AVATAR_DIR ?? './data/uploads/avatars';
    const rwDir = process.env.REWARD_DIR ?? './data/uploads/rewards';
    let lastBackup = null;
    try {
      const bdir = process.env.BACKUP_DIR ?? '/var/lib/duelo/backups';
      const dirs = fs.existsSync(bdir) ? [bdir] : [];
      if (fs.existsSync('./backups')) dirs.push('./backups');
      const files = dirs.flatMap((d) => fs.readdirSync(d).filter((f) => f.startsWith('duelo-') && f.endsWith('.db'))
        .map((f) => ({ f, t: fs.statSync(d + '/' + f).mtimeMs }))).sort((a, b) => b.t - a.t);
      if (files.length) lastBackup = { fichier: files[0].f, date: new Date(files[0].t).toISOString() };
    } catch { /* pas de dossier */ }
    return {
      ramMo: Math.round(mem.rss / 1048576), heapMo: Math.round(mem.heapUsed / 1048576),
      cpuPctDepuisDemarrage: Math.round(((cpu.user + cpu.system) / 1000 / dtS) * 10) / 10,
      demarreDepuisS: Math.round(dtS),
      enLigne5min: db.prepare('SELECT COUNT(*) c FROM users WHERE last_seen_at>?').get(Date.now() - 3e5).c,
      duelsActifs: active.size,
      disque: disk,
      uploads: { avatars: dirBytes(avDir), rewards: dirBytes(rwDir), racine: dirBytes(upRoot) },
      derniereSauvegarde: lastBackup,
    };
  });
}
