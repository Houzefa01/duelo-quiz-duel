import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../server/db/db.js';
import { createDuel, submitAnswer, active } from '../../server/modules/duels/engine.js';

// Duel complet simulé sans WebSocket (hooks injectés).
test('duel : création + verrou un seul duel actif', async () => {
  process.env.DB_PATH = '/tmp/duelo-test.db';
  try { (await import('node:fs')).unlinkSync('/tmp/duelo-test.db'); } catch {}
  openDb('/tmp/duelo-test.db');
  await import('../../server/db/seed/index.js');
  const db = (await import('../../server/db/db.js')).getDb();
  const a = db.prepare('INSERT INTO users(username,password_hash,created_at,last_seen_at) VALUES(?,?,?,?)').run('TestA', '!', Date.now(), Date.now()).lastInsertRowid;
  const b = db.prepare('INSERT INTO users(username,password_hash,created_at,last_seen_at) VALUES(?,?,?,?)').run('TestB', '!', Date.now(), Date.now()).lastInsertRowid;
  const msgs = [];
  const hooks = { send: (u, m) => msgs.push([u, m]), onEnd: () => {} };
  const { duelId, state, error } = createDuel({ p1: Number(a), p2: Number(b), mode: 'friendly' });
  assert.ok(!error);
  assert.equal(state.questions.length, 10);
  // 2e duel avec même joueur bloqué (F-20)
  const c = db.prepare('INSERT INTO users(username,password_hash,created_at,last_seen_at) VALUES(?,?,?,?)').run('TestC', '!', Date.now(), Date.now()).lastInsertRowid;
  const r2 = createDuel({ p1: Number(a), p2: Number(c), mode: 'friendly' });
  assert.equal(r2.error, 'duel_actif');
  active.delete(duelId);
});
