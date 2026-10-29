// P15-2 : charge globale — 300 WS + 100 duels + 10 photos + 2 tournois en même temps.
// Usage : node tests/load/global.js
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import WebSocket from 'ws';

const PORT = 34610;
const DB = '/tmp/duelo-load-global.db';
const N = 320;
process.env.DB_PATH = DB;
process.env.RATE_MAX = '100000';
process.env.REWARD_KEY = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');

for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
const { openDb } = await import('../../server/db/db.js');
openDb(DB);
await import('../../server/db/seed/index.js');
const { getDb } = await import('../../server/db/db.js');
const db = getDb();
const now = Date.now();
const { sha256 } = await import('../../server/modules/auth/password.js');
const cookies = [];
db.transaction(() => {
  const insU = db.prepare('INSERT INTO users(username,password_hash,created_at,last_seen_at) VALUES(?,?,?,?)');
  const insS = db.prepare('INSERT INTO sessions(user_id,token_hash,created_at,expires_at) VALUES(?,?,?,?)');
  for (let i = 0; i < N; i++) {
    const id = insU.run('Glob' + i, '!', now, now).lastInsertRowid;
    insS.run(Number(id), sha256('gtok' + i), now, now + 30 * 864e5);
    cookies.push('session=gtok' + i);
  }
  // Admin pour les tournois.
  const aid = insU.run('GlobAdm', '!', now, now).lastInsertRowid;
  insS.run(Number(aid), sha256('gtokadm'), now, now + 30 * 864e5);
  db.prepare(`UPDATE users SET role='admin' WHERE id=?`).run(Number(aid));
})();
console.log('setup: 320 utilisateurs, 600 questions');

const srv = spawn(process.execPath, ['server/index.js'], {
  cwd: new URL('../..', import.meta.url).pathname,
  env: { ...process.env, PORT: String(PORT), DB_PATH: DB },
  stdio: ['ignore', 'pipe', 'pipe'],
});
srv.stdout.on('data', () => {});
srv.stderr.on('data', () => {});
const t0 = Date.now();
for (;;) {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/healthz`).then((x) => x.json());
    if (r.ok) break;
  } catch {}
  if (Date.now() - t0 > 30000) throw new Error('serveur non démarré');
  await new Promise((r) => setTimeout(r, 300));
}
const rssMB = () => Number(fs.readFileSync(`/proc/${srv.pid}/status`, 'utf8').match(/VmRSS:\s+(\d+)/)[1]) / 1024;
const cpuTimes = () => fs.readFileSync(`/proc/${srv.pid}/stat`, 'utf8').split(' ').slice(13, 15).map(Number);
console.log(`repos: RSS=${rssMB().toFixed(1)} Mo`);

const clients = [];
const lat = [];
let finished = 0, matched = 0;
function connect(i) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/live`, { headers: { Cookie: cookies[i] } });
    const c = { ws, i, tAns: 0 };
    ws.on('open', () => resolve(c));
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.t === 'ping') { ws.send(JSON.stringify({ t: 'pong', at: m.at })); return; }
      if (m.t === 'match.found') { matched++; return; }
      if (m.t === 'question.show') {
        c.tAns = Date.now();
        ws.send(JSON.stringify({ t: 'answer', duelId: m.duelId, round: m.round, choice: m.round % 4 }));
        return;
      }
      if (m.t === 'opponent.answered') { lat.push(Date.now() - c.tAns); return; }
      if (m.t === 'duel.end') { finished++; }
    });
    ws.on('error', () => {});
    clients.push(c);
  });
}
for (let b = 0; b < 300; b += 50) {
  await Promise.all(Array.from({ length: 50 }, (_, k) => connect(b + k)));
  await new Promise((r) => setTimeout(r, 200));
}
console.log(`connectés: ${clients.length} WS`);
for (let i = 0; i < 200; i++) clients[i].ws.send(JSON.stringify({ t: 'queue.join', mode: 'ranked' }));

// 2 tournois : création admin, 8+8 inscrits (joueurs 200..215), checkin, démarrage.
const admCk = 'session=gtokadm';
const tids = [];
for (let k = 0; k < 2; k++) {
  const t = await fetch(`http://127.0.0.1:${PORT}/api/v1/tournaments`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: admCk }, body: JSON.stringify({ name: 'Charge T' + k, size: 8, startsAt: Date.now() + 36e5 }) }).then((x) => x.json());
  tids.push(t.id);
  for (let i = 0; i < 8; i++) {
    const ck = cookies[200 + k * 8 + i];
    await fetch(`http://127.0.0.1:${PORT}/api/v1/tournaments/${t.id}/join`, { method: 'POST', headers: { Cookie: ck } });
    await fetch(`http://127.0.0.1:${PORT}/api/v1/tournaments/${t.id}/checkin`, { method: 'POST', headers: { Cookie: ck } });
  }
  console.log('tournoi ' + t.id + ' :', await fetch(`http://127.0.0.1:${PORT}/api/v1/tournaments/${t.id}/start`, { method: 'POST', headers: { Cookie: admCk } }).then((x) => x.json()).then((j) => 'size=' + j.size));
}
// 10 photos pendant la charge (PNG 200 px générés via sharp local).
const { default: sharp } = await import('sharp');
const photos = [];
for (let i = 0; i < 10; i++) {
  const png = await sharp({ create: { width: 200, height: 200, channels: 3, background: { r: i * 20, g: 100, b: 150 } } }).png().toBuffer();
  const fd = new FormData();
  fd.append('photo', new Blob([png]), `p${i}.png`);
  photos.push(fetch(`http://127.0.0.1:${PORT}/api/v1/me/avatar/upload`, { method: 'POST', headers: { Cookie: cookies[300 + i] }, body: fd }).then((x) => x.status));
}

const HZ = Number(execSync('getconf CLK_TCK').toString().trim());
let lastCpu = cpuTimes(), lastT = Date.now(), cpuSum = 0, cpuN = 0, peak = 0;
const tEnd = Date.now() + 150000;
while (Date.now() < tEnd && finished < 200) {
  await new Promise((r) => setTimeout(r, 2000));
  peak = Math.max(peak, rssMB());
  const c = cpuTimes(), nowT = Date.now();
  cpuSum += ((c[0] + c[1] - lastCpu[0] - lastCpu[1]) / HZ) / ((nowT - lastT) / 1000) * 100;
  cpuN++; lastCpu = c; lastT = nowT;
}
const up = await Promise.all(photos);
lat.sort((a, b) => a - b);
const q = (p) => lat[Math.min(lat.length - 1, Math.floor(lat.length * p))] ?? -1;
console.log('---- RÉSULTATS ----');
console.log(`connexions: ${clients.length} (cible 300)`);
console.log(`duels appariés: ${matched / 2} (cible 100)`);
console.log(`duels terminés (joueurs): ${finished} (cible 200)`);
console.log(`photos: ${up.filter((s) => s === 200).length}/10 OK`);
console.log(`RAM repos/pic: ${peak.toFixed(1)} Mo (budget < 400)`);
console.log(`CPU moyen: ${(cpuSum / Math.max(1, cpuN)).toFixed(1)} % d'un cœur (budget < 25)`);
console.log(`latence événement: p50 ${q(0.5)} ms, p95 ${q(0.95)} ms (budget < 50), n=${lat.length}`);
for (const c of clients) { try { c.ws.terminate(); } catch {} }
srv.kill('SIGTERM');
process.exit(0);
