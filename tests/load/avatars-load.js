// P12 : charge avatars photo — 50 photos servies en concurrence + mémoire.
// Usage : node tests/load/avatars-load.js (serveur de test dédié)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import sharp from 'sharp';

const PORT = 34599, DB = '/tmp/duelo-p12-photoload.db';
for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
process.env.DB_PATH = DB;
const { openDb, getDb } = await import('../../server/db/db.js');
openDb(DB);
await import('../../server/db/seed/index.js');
const db = getDb();
const dir = '/tmp/duelo-p12-photos';
fs.mkdirSync(dir, { recursive: true });
process.env.AVATAR_DIR = dir;
const webp = await sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 60, g: 120, b: 200 } } }).webp().toBuffer();
const now = Date.now();
const uuids = [];
db.transaction(() => {
  for (let i = 0; i < 50; i++) {
    const uid = db.prepare('INSERT INTO users(username,password_hash,created_at,last_seen_at) VALUES(?,?,?,?)').run('Photo' + i, '!', now, now).lastInsertRowid;
    const uuid = '00000000-0000-4000-8000-' + String(i).padStart(12, '0');
    fs.writeFileSync(`${dir}/${uuid}.webp`, webp);
    fs.writeFileSync(`${dir}/${uuid}-64.webp`, webp);
    db.prepare(`INSERT INTO uploads(owner_id,kind,path,mime,bytes,sha256,status,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(Number(uid), 'avatar', uuid, 'image/webp', webp.length, 'x', 'ok', now);
    db.prepare(`UPDATE users SET avatar_kind='upload',avatar_ref=? WHERE id=?`).run(uuid, Number(uid));
    uuids.push(uuid);
  }
})();
console.log('setup: 50 photos');

const srv = spawn(process.execPath, ['server/index.js'], {
  cwd: new URL('../..', import.meta.url).pathname,
  env: { ...process.env, PORT: String(PORT), DB_PATH: DB, AVATAR_DIR: dir },
  stdio: ['ignore', 'ignore', 'ignore'],
});
const t0 = Date.now();
for (;;) {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/healthz`).then((x) => x.json()); if (r.ok) break; } catch {}
  if (Date.now() - t0 > 30000) throw new Error('serveur non démarré');
  await new Promise((r) => setTimeout(r, 300));
}
const rssMB = () => Number(fs.readFileSync(`/proc/${srv.pid}/status`, 'utf8').match(/VmRSS:\s+(\d+)/)[1]) / 1024;
const t1 = Date.now();
const res = await Promise.all(uuids.flatMap((u) => [0, 1, 2, 3].map(() =>
  fetch(`http://127.0.0.1:${PORT}/api/v1/avatar/photo/${u}`).then((r) => r.status))));
const dt = Date.now() - t1;
const okCount = res.filter((s) => s === 200).length;
console.log(`photos: ${okCount}/${res.length} OK en ${dt} ms (200 requêtes concurrentes)`);
console.log(`RAM serveur: ${rssMB().toFixed(1)} Mo`);
srv.kill('SIGTERM');
if (okCount !== res.length) process.exit(1);
console.log('PHOTOS-LOAD OK');
