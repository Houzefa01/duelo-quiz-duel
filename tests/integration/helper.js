// Aide aux tests d'intégration : démarre l'app sur un port + base jetable.
import fs from 'node:fs';

export async function boot({ port, db }) {
  for (const f of [db, db + '-wal', db + '-shm']) { try { fs.unlinkSync(f); } catch {} }
  process.env.DB_PATH = db;
  const { openDb } = await import('../../server/db/db.js');
  openDb(db);
  await import('../../server/db/seed/index.js');
  const { buildApp } = await import('../../server/app.js');
  const { resetRate } = await import('../../server/lib/rateLimit.js');
  resetRate(); // chaque serveur de test repart avec des compteurs vierges
  const app = await buildApp({ withLive: true, withJobs: false });
  await app.listen({ port, host: '127.0.0.1' });
  const url = `http://127.0.0.1:${port}`;
  return {
    app, url, wsUrl: `ws://127.0.0.1:${port}/live`,
    async close() {
      const eng = await import('../../server/modules/duels/engine.js');
      for (const st of eng.active.values()) clearTimeout(st.timer);
      eng.active.clear();
      const gw = await import('../../server/realtime/gateway.js');
      gw.closeLive();
      const pool = await import('../../server/lib/imgpool.js');
      await pool.fermePool();
      await app.close();
    },
  };
}

export async function mkUser(url, username, password = 'motdepasse12345') {
  let r = await fetch(url + '/api/v1/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, ageOk: true }),
  });
  if (r.status === 409) {
    r = await fetch(url + '/api/v1/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
  }
  if (!r.ok) throw new Error('mkUser ' + username + ': ' + (await r.text()));
  const set = r.headers.get('set-cookie') ?? '';
  const sess = (set.match(/session=([^;]+)/) ?? [])[1];
  if (!sess) throw new Error('pas de cookie session');
  return { username, cookie: 'session=' + sess };
}

export function collect(ws) {
  const arr = [];
  ws.on('message', (raw) => {
    try {
      const m = JSON.parse(raw.toString());
      if (m.t === 'ping') { ws.send(JSON.stringify({ t: 'pong', at: m.at })); return; }
      arr.push(m);
    } catch {}
  });
  return arr;
}

export async function waitFor(arr, pred, timeoutMs = 30000, label = '?') {
  const t0 = Date.now();
  for (;;) {
    const hit = arr.filter(pred);
    if (hit.length) return hit;
    if (Date.now() - t0 > timeoutMs) throw new Error('timeout attente ' + label);
    await new Promise((r) => setTimeout(r, 100));
  }
}

// Création directe en base (setup de test) : contourne volontairement le
// rate-limit d'inscription, qui est testé séparément (P11-5).
export async function mkUsersDirect(names, password = 'motdepasse12345') {
  const { getDb } = await import('../../server/db/db.js');
  const { hashPassword, newToken, sha256 } = await import('../../server/modules/auth/password.js');
  const db = getDb();
  const now = Date.now();
  const out = [];
  for (const username of names) {
    const id = db.prepare('INSERT INTO users(username,password_hash,created_at,last_seen_at) VALUES(?,?,?,?)')
      .run(username, hashPassword(password), now, now).lastInsertRowid;
    const tok = newToken();
    db.prepare('INSERT INTO sessions(user_id,token_hash,created_at,expires_at) VALUES(?,?,?,?)')
      .run(Number(id), sha256(tok), now, now + 30 * 864e5);
    out.push({ username, id: Number(id), cookie: 'session=' + tok });
  }
  return out;
}
