// P11-4 : 300 connexions WS + 100 duels en parallèle. Mesures vs budgets §2.2.
// Usage : node tests/load/run.js  (serveur lancé en processus fils dédié)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import WebSocket from 'ws';

const PORT = 34590;
const DB = '/tmp/duelo-load.db';
const N = 300, DUELISTS = 200;
process.env.DB_PATH = DB;
process.env.RATE_MAX = '100000';

for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
const { openDb } = await import('../../server/db/db.js');
openDb(DB);
await import('../../server/db/seed/index.js');
{
  const { getDb } = await import('../../server/db/db.js');
  const db = getDb();
  const now = Date.now();
  const insU = db.prepare('INSERT INTO users(username,password_hash,created_at,last_seen_at) VALUES(?,?,?,?)');
  const insS = db.prepare('INSERT INTO sessions(user_id,token_hash,created_at,expires_at) VALUES(?,?,?,?)');
  const { sha256 } = await import('../../server/modules/auth/password.js');
  db.transaction(() => {
    for (let i = 0; i < N; i++) {
      const id = insU.run('Load' + i, '!', now, now).lastInsertRowid;
      insS.run(Number(id), sha256('tok' + i), now, now + 30 * 864e5);
    }
  })();
  console.log('setup: 300 utilisateurs+sessions,', db.prepare('SELECT COUNT(*) c FROM questions').get().c, 'questions');
}

const srv = spawn(process.execPath, ['server/index.js'], {
  cwd: new URL('../..', import.meta.url).pathname,
  env: { ...process.env, PORT: String(PORT), DB_PATH: DB },
  stdio: ['ignore', 'pipe', 'pipe'],
});
srv.stdout.on('data', (d) => process.stdout.write('[srv] ' + d));
srv.stderr.on('data', (d) => process.stdout.write('[srv:err] ' + d));
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
console.log(`repos: RSS=${rssMB().toFixed(1)} Mo (budget < 150)`);

const clients = [];
const lat = []; // latence événement : answer -> opponent.answered (traitement serveur)
let finished = 0, matched = 0;
function connect(i) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/live`, { headers: { Cookie: 'session=tok' + i } });
    const c = { ws, i, duel: null, tAns: 0 };
    ws.on('open', () => resolve(c));
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.t === 'ping') { ws.send(JSON.stringify({ t: 'pong', at: m.at })); return; }
      if (m.t === 'match.found') { c.duel = m.duelId; matched++; return; }
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
for (let b = 0; b < N; b += 50) {
  await Promise.all(Array.from({ length: 50 }, (_, k) => connect(b + k)));
  await new Promise((r) => setTimeout(r, 200));
}
console.log(`connectés: ${clients.length} WS`);
// 200 premiers en file ranked -> 100 duels ; 100 restent connectés (présence)
for (let i = 0; i < DUELISTS; i++) clients[i].ws.send(JSON.stringify({ t: 'queue.join', mode: 'ranked' }));

const HZ = Number((await import('node:child_process')).execSync('getconf CLK_TCK').toString().trim());
let lastCpu = cpuTimes(), lastT = Date.now(), cpuSum = 0, cpuN = 0, peak = 0;
const tEnd = Date.now() + 150000;
while (Date.now() < tEnd && finished < DUELISTS) {
  await new Promise((r) => setTimeout(r, 2000));
  peak = Math.max(peak, rssMB());
  const c = cpuTimes(), nowT = Date.now();
  const pct = ((c[0] + c[1] - lastCpu[0] - lastCpu[1]) / HZ) / ((nowT - lastT) / 1000) * 100;
  cpuSum += pct; cpuN++; lastCpu = c; lastT = nowT;
}
lat.sort((a, b) => a - b);
const med = lat[Math.floor(lat.length / 2)] ?? -1;
const p95 = lat[Math.floor(lat.length * 0.95)] ?? -1;
console.log('---- RÉSULTATS ----');
console.log(`connexions: ${clients.length} (cible 300)`);
console.log(`duels appariés: ${matched / 2} (cible 100)`);
console.log(`duels terminés (joueurs): ${finished} (cible 200)`);
console.log(`RAM repos: ${rssMB().toFixed(1)} Mo | pic charge: ${peak.toFixed(1)} Mo (budget < 400)`);
console.log(`CPU moyen: ${(cpuSum / Math.max(1, cpuN)).toFixed(1)} % d'un cœur (budget < 25)`);
console.log(`latence événement answer->adversaire: médiane ${med} ms, p95 ${p95} ms (budget < 50), n=${lat.length}`);
for (const c of clients) { try { c.ws.terminate(); } catch {} }
srv.kill('SIGTERM');
process.exit(0);
