// P11-1 : revanche en un clic (F-18) et duel fantôme à 20 s (F-16).
import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { boot, mkUser, collect, waitFor } from './helper.js';
import { shuffleForPlayer } from '../../server/modules/duels/picker.js';

test('revanche : offre + acceptation = nouveau duel en 30 s', async () => {
  const ctx = await boot({ port: 34585, db: '/tmp/duelo-p11-rematch.db' });
  try {
    const A = await mkUser(ctx.url, 'RevA');
    const B = await mkUser(ctx.url, 'RevB');
    const idA = await fetch(ctx.url + '/api/v1/me', { headers: { Cookie: A.cookie } }).then((r) => r.json()).then((j) => j.id);
    const idB = await fetch(ctx.url + '/api/v1/me', { headers: { Cookie: B.cookie } }).then((r) => r.json()).then((j) => j.id);
    const { active } = await import('../../server/modules/duels/engine.js');
    const wa = new WebSocket(ctx.wsUrl, { headers: { Cookie: A.cookie } });
    const wb = new WebSocket(ctx.wsUrl, { headers: { Cookie: B.cookie } });
    const ma = collect(wa), mb = collect(wb);
    await Promise.all([new Promise((r) => wa.on('open', r)), new Promise((r) => wb.on('open', r))]);
    wa.send(JSON.stringify({ t: 'queue.join', mode: 'ranked' }));
    wb.send(JSON.stringify({ t: 'queue.join', mode: 'ranked' }));
    const [f] = await waitFor(ma, (m) => m.t === 'match.found', 15000, 'match');
    const duelId = f.duelId;
    // Duel éclair : réponses immédiates (Elo neutralisé par l'anti-triche, on veut juste finir vite)
    const seen = new Set();
    const t0 = Date.now();
    for (;;) {
      for (const q of ma.filter((m) => m.t === 'question.show' && !seen.has('a' + m.round))) {
        seen.add('a' + q.round);
        const st = active.get(duelId);
        if (!st) continue;
        const qq = st.questions[q.round - 1];
        wa.send(JSON.stringify({ t: 'answer', duelId, round: q.round, choice: shuffleForPlayer(qq, idA * 31 + q.round * 7 + duelId).correctIndex }));
      }
      for (const q of mb.filter((m) => m.t === 'question.show' && !seen.has('b' + m.round))) {
        seen.add('b' + q.round);
        wb.send(JSON.stringify({ t: 'answer', duelId, round: q.round, choice: 0 }));
      }
      if (ma.some((m) => m.t === 'duel.end')) break;
      if (Date.now() - t0 > 90000) throw new Error('duel trop long');
      await new Promise((r) => setTimeout(r, 120));
    }
    // Revanche : A propose, B accepte
    wa.send(JSON.stringify({ t: 'rematch', duelId, opponentId: idB }));
    const [offer] = await waitFor(mb, (m) => m.t === 'rematch.offer', 10000, 'rematch.offer');
    assert.equal(offer.duelId, duelId);
    wb.send(JSON.stringify({ t: 'rematch.accept', duelId }));
    const [m2a] = await waitFor(ma, (m) => m.t === 'match.found' && m.rematch === true, 10000, 'rematch found A');
    const [m2b] = await waitFor(mb, (m) => m.t === 'match.found' && m.rematch === true, 10000, 'rematch found B');
    assert.equal(m2a.duelId, m2b.duelId);
    assert.ok(m2a.duelId !== duelId, 'nouveau duel créé');
    wa.terminate(); wb.terminate();
  } finally {
    await ctx.close();
  }
});

test('fantôme : seul en file 20 s -> adversaire fantôme identifié', async () => {
  const ctx = await boot({ port: 34586, db: '/tmp/duelo-p11-ghost.db' });
  try {
    const S = await mkUser(ctx.url, 'SoloG');
    const w = new WebSocket(ctx.wsUrl, { headers: { Cookie: S.cookie } });
    const ms = collect(w);
    await new Promise((r) => w.on('open', r));
    w.send(JSON.stringify({ t: 'queue.join', mode: 'ranked' }));
    await waitFor(ms, (m) => m.t === 'queue.joined', 5000, 'queue.joined');
    const t0 = Date.now();
    const [f] = await waitFor(ms, (m) => m.t === 'match.found', 30000, 'ghost found');
    const waited = Date.now() - t0;
    assert.equal(f.ghost, true, 'identifié comme fantôme');
    assert.ok(f.opponent.name.includes('fantôme'), 'nom explicite : ' + f.opponent.name);
    assert.ok(waited >= 19000, 'proposé après ~20 s, mesuré ' + waited + ' ms');
    // Le duel démarre vraiment (questions reçues)
    await waitFor(ms, (m) => m.t === 'question.show', 15000, 'ghost question');
    w.terminate();
  } finally {
    await ctx.close();
  }
});
