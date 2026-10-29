// P14-4 : kill -9 pendant des duels + un tournoi, redémarrage sans corruption.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const PORT = 34607, DB = '/tmp/duelo-p14-kill9.db';
for (const f of [DB, DB + '-wal', DB + '-shm']) { try { (await import('node:fs')).unlinkSync(f); } catch {} }

function lanceServeur() {
  const p = spawn(process.execPath, ['server/index.js'], {
    cwd: '/home/Hsavatra/duelo',
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  p.stdout.resume(); p.stderr.resume();
  return p;
}
async function attendPret() {
  const t0 = Date.now();
  for (;;) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/healthz`).then((x) => x.json())).ok) return; } catch {}
    if (Date.now() - t0 > 25000) throw new Error('serveur non démarré');
    await new Promise((r) => setTimeout(r, 300));
  }
}

test('kill -9 pendant duel + tournoi : reprise propre, sans pénalité', async () => {
  const { openDb, getDb } = await import('../../server/db/db.js');
  openDb(DB); // le parent lit/écrit en concurrence WAL avec le serveur fils
  const db = getDb();
  const { sha256, newToken } = await import('../../server/modules/auth/password.js');
  const login = (username) => {
    const now = Date.now();
    const id = db.prepare('INSERT INTO users(username,password_hash,created_at,last_seen_at,elo) VALUES(?,?,?,?,?)').run(username, '!', now, now, 1100).lastInsertRowid;
    const tok = newToken();
    db.prepare('INSERT INTO sessions(user_id,token_hash,created_at,expires_at) VALUES(?,?,?,?)').run(Number(id), sha256(tok), now, now + 30 * 864e5);
    return { id: Number(id), cookie: 'session=' + tok };
  };
  let srv = lanceServeur();
  await attendPret();
  const A = login('KillA');
  const B = login('KillB');
  const wa = new WebSocket(`ws://127.0.0.1:${PORT}/live`, { headers: { Cookie: A.cookie } });
  const wb = new WebSocket(`ws://127.0.0.1:${PORT}/live`, { headers: { Cookie: B.cookie } });
  await Promise.all([new Promise((r) => wa.on('open', r)), new Promise((r) => wb.on('open', r))]);
  let duelId = null;
  wa.on('message', (raw) => { try { const m = JSON.parse(raw.toString()); if (m.t === 'match.found') duelId = m.duelId; } catch {} });
  wa.send(JSON.stringify({ t: 'queue.join', mode: 'ranked' }));
  wb.send(JSON.stringify({ t: 'queue.join', mode: 'ranked' }));
  const t0 = Date.now();
  while (!duelId && Date.now() - t0 < 15000) await new Promise((r) => setTimeout(r, 200));
  assert.ok(duelId, 'duel démarré avant le crash');
  // Tournoi en cours (arbre R1 prêt).
  const now = Date.now();
  const tid = db.prepare('INSERT INTO tournaments(name,size,status,starts_at,checkin_at) VALUES(?,?,?,?,?)').run('Coupe crash', 8, 'running', now - 36e5, now - 36e5).lastInsertRowid;
  for (let i = 0; i < 8; i++) {
    const u = login('KillJ' + i);
    db.prepare('INSERT INTO tournament_players(tournament_id,user_id,seed,checked_in) VALUES(?,?,?,1)').run(tid, u.id, 1200 - i * 10);
  }
  const { buildBracket, resolveMatch, resolveFinalGame } = await import('../../server/modules/tournaments/routes.js');
  buildBracket(db, Number(tid));
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM tournament_matches WHERE tournament_id=?`).get(tid).c, 4);
  const eloAvant = db.prepare('SELECT elo FROM users WHERE id=?').get(A.id).elo;

  // ARRÊT BRUTAL au milieu du duel.
  srv.kill('SIGKILL');
  await new Promise((r) => srv.on('exit', r));
  try { wa.terminate(); wb.terminate(); } catch {}

  // Redémarrage : WAL rejoué, reprise automatique.
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok', 'intégrité SQLite');
  srv = lanceServeur();
  await attendPret();

  // Duel interrompu annulé sans pénalité (ni Elo, ni pièces, ni ledger).
  assert.equal(db.prepare('SELECT status FROM duels WHERE id=?').get(duelId).status, 'cancelled', 'duel annulé');
  assert.equal(db.prepare('SELECT elo FROM users WHERE id=?').get(A.id).elo, eloAvant, 'Elo inchangé');
  assert.equal(db.prepare('SELECT coins FROM users WHERE id=?').get(A.id).coins, 0, 'aucune pièce');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM reward_ledger').get().c, 0, 'aucune récompense');

  // Tournoi : l'arbre a survécu, terminable après reprise.
  for (const round of ['R1', 'SF']) {
    for (const m of db.prepare('SELECT * FROM tournament_matches WHERE tournament_id=? AND round=? AND status=?').all(tid, round, 'ready')) {
      resolveMatch(db, m.id, m.p1_id ?? m.p2_id);
    }
  }
  const fin = db.prepare(`SELECT * FROM tournament_matches WHERE tournament_id=? AND round='F'`).get(tid);
  resolveFinalGame(db, fin.id, fin.p1_id);
  resolveFinalGame(db, fin.id, fin.p1_id);
  assert.equal(db.prepare('SELECT status FROM tournaments WHERE id=?').get(tid).status, 'done', 'tournoi terminé après reprise');
  srv.kill('SIGKILL');
});
