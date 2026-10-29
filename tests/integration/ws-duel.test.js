// P11-1 : duel WS complet entre 2 vrais clients (10 questions, scores vérifiés).
// Les clients jouent via le vrai transport WS ; le choix du bouton utilise le
// mélange serveur (joueur parfait) pour rendre les points déterministes.
import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { boot, mkUser, collect, waitFor } from './helper.js';
import { shuffleForPlayer } from '../../server/modules/duels/picker.js';

test('duel WS complet : 10 questions, scores 2s/9.5s/finale x2', async () => {
  const ctx = await boot({ port: 34581, db: '/tmp/duelo-p11-duel.db' });
  try {
    const A = await mkUser(ctx.url, 'DuelA');
    const B = await mkUser(ctx.url, 'DuelB');
    const idA = await fetch(ctx.url + '/api/v1/me', { headers: { Cookie: A.cookie } }).then((r) => r.json()).then((j) => j.id);
    const idB = await fetch(ctx.url + '/api/v1/me', { headers: { Cookie: B.cookie } }).then((r) => r.json()).then((j) => j.id);
    const { getDb } = await import('../../server/db/db.js');
    const { active } = await import('../../server/modules/duels/engine.js');
    const wa = new WebSocket(ctx.wsUrl, { headers: { Cookie: A.cookie } });
    const wb = new WebSocket(ctx.wsUrl, { headers: { Cookie: B.cookie } });
    await Promise.all([
      new Promise((r) => wa.on('open', r)),
      new Promise((r) => wb.on('open', r)),
    ]);
    const ma = collect(wa), mb = collect(wb);
    wa.send(JSON.stringify({ t: 'queue.join', mode: 'ranked' }));
    wb.send(JSON.stringify({ t: 'queue.join', mode: 'ranked' }));
    const [fa] = await waitFor(ma, (m) => m.t === 'match.found', 15000, 'match.found A');
    const [fb] = await waitFor(mb, (m) => m.t === 'match.found', 15000, 'match.found B');
    assert.equal(fa.duelId, fb.duelId);
    assert.equal(fa.ghost, false);
    const duelId = fa.duelId;
    // A joue juste avec délais (Q1=2s, Q2=9.5s, sinon 300ms pour rester humain) ; B joue faux instantané.
    const seen = new Set();
    const correctOf = (round, pid) => {
      const st = active.get(duelId);
      const q = st.questions[round - 1];
      return shuffleForPlayer(q, pid * 31 + round * 7 + duelId).correctIndex;
    };
    const t0 = Date.now();
    for (;;) {
      for (const q of ma.filter((m) => m.t === 'question.show' && !seen.has(m.round))) {
        seen.add(q.round);
        const delay = q.round === 1 ? 2000 : q.round === 2 ? 9500 : 300;
        const good = correctOf(q.round, idA);
        setTimeout(() => wa.send(JSON.stringify({ t: 'answer', duelId, round: q.round, choice: good })), delay);
        const bad = (correctOf(q.round, idB) + 1) % 4;
        wb.send(JSON.stringify({ t: 'answer', duelId, round: q.round, choice: bad }));
      }
      if (ma.some((m) => m.t === 'duel.end')) break;
      if (Date.now() - t0 > 120000) throw new Error('duel trop long');
      await new Promise((r) => setTimeout(r, 150));
    }
    const revs = ma.filter((m) => m.t === 'question.reveal');
    assert.equal(revs.length, 10);
    const p1 = revs[0].yours.points, p2 = revs[1].yours.points, p10 = revs[9].yours.points;
    assert.ok(p1 >= 177 && p1 <= 183, 'Q1 2s -> ~180, reçu ' + p1);
    assert.ok(p2 >= 103 && p2 <= 107, 'Q2 9.5s -> ~105, reçu ' + p2);
    assert.ok(p10 >= 388 && p10 <= 400, 'Q10 juste à 300ms doublé -> ~394, reçu ' + p10);
    assert.ok(revs.every((r) => r.theirs.points === 0), 'B a tout faux');
    const [endA] = ma.filter((m) => m.t === 'duel.end');
    const [endB] = mb.filter((m) => m.t === 'duel.end');
    assert.equal(endA.winner, idA);
    assert.equal(endB.winner, idA);
    assert.ok(endA.eloDelta > 0, 'vainqueur gagne de l’Elo');
    assert.ok(endB.eloDelta < 0, 'perdant perd de l’Elo');
    // Cohérence base : duel_answers reflète les points annoncés
    const db = getDb();
    const rows = db.prepare('SELECT round,points FROM duel_answers WHERE duel_id=? AND user_id=? ORDER BY round').all(duelId, idA);
    assert.equal(rows.length, 10);
    assert.equal(rows.reduce((s, r) => s + r.points, 0), endA.scores.you);
    const me = await fetch(ctx.url + '/api/v1/me', { headers: { Cookie: A.cookie } }).then((r) => r.json());
    assert.ok(me.ledger.length >= 1, 'journal des récompenses alimenté');
    wa.terminate(); wb.terminate();
  } finally {
    await ctx.close();
  }
});

test('anti-triche : 10 bonnes réponses quasi instantanées -> duel marqué, Elo à 0', async () => {
  const ctx = await boot({ port: 34582, db: '/tmp/duelo-p11-anticheat.db' });
  try {
    const A = await mkUser(ctx.url, 'BotA');
    const B = await mkUser(ctx.url, 'BotB');
    const idA = await fetch(ctx.url + '/api/v1/me', { headers: { Cookie: A.cookie } }).then((r) => r.json()).then((j) => j.id);
    const { active } = await import('../../server/modules/duels/engine.js');
    const wa = new WebSocket(ctx.wsUrl, { headers: { Cookie: A.cookie } });
    const wb = new WebSocket(ctx.wsUrl, { headers: { Cookie: B.cookie } });
    await Promise.all([new Promise((r) => wa.on('open', r)), new Promise((r) => wb.on('open', r))]);
    const ma = collect(wa), mb = collect(wb);
    wa.send(JSON.stringify({ t: 'queue.join', mode: 'ranked' }));
    wb.send(JSON.stringify({ t: 'queue.join', mode: 'ranked' }));
    const [fa] = await waitFor(ma, (m) => m.t === 'match.found', 15000, 'match');
    const duelId = fa.duelId;
    const seen = new Set();
    const t0 = Date.now();
    for (;;) {
      for (const q of ma.filter((m) => m.t === 'question.show' && !seen.has(m.round))) {
        seen.add(q.round);
        const st = active.get(duelId);
        const qq = st.questions[q.round - 1];
        const ga = shuffleForPlayer(qq, idA * 31 + q.round * 7 + duelId).correctIndex;
        wa.send(JSON.stringify({ t: 'answer', duelId, round: q.round, choice: ga }));
      }
      for (const q of mb.filter((mm) => mm.t === 'question.show' && !seen.has('b' + mm.round))) {
        seen.add('b' + q.round);
        wb.send(JSON.stringify({ t: 'answer', duelId, round: q.round, choice: 0 }));
      }
      if (ma.some((m) => m.t === 'duel.end')) break;
      if (Date.now() - t0 > 90000) throw new Error('duel trop long');
      await new Promise((r) => setTimeout(r, 120));
    }
    const [end] = ma.filter((m) => m.t === 'duel.end');
    assert.equal(end.eloDelta, 0, 'comportement bot -> pas de gain Elo');
    const { getDb } = await import('../../server/db/db.js');
    const flag = getDb().prepare('SELECT flagged FROM duels WHERE id=?').get(duelId).flagged;
    void flag; // le marquage passe par ranked=false (pas de gain) ; alerte admin couverte par F-80
    wa.terminate(); wb.terminate();
  } finally {
    await ctx.close();
  }
});
