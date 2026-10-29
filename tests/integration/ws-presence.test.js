// P11-1 : reconnexion à 20 s (reprise) et forfait à 30 s (F-17).
import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { boot, mkUser, collect, waitFor } from './helper.js';
import { shuffleForPlayer } from '../../server/modules/duels/picker.js';

async function duelPair(ctx, nameA, nameB) {
  const A = await mkUser(ctx.url, nameA);
  const B = await mkUser(ctx.url, nameB);
  const idA = await fetch(ctx.url + '/api/v1/me', { headers: { Cookie: A.cookie } }).then((r) => r.json()).then((j) => j.id);
  const idB = await fetch(ctx.url + '/api/v1/me', { headers: { Cookie: B.cookie } }).then((r) => r.json()).then((j) => j.id);
  const wa = new WebSocket(ctx.wsUrl, { headers: { Cookie: A.cookie } });
  const wb = new WebSocket(ctx.wsUrl, { headers: { Cookie: B.cookie } });
  await Promise.all([new Promise((r) => wa.on('open', r)), new Promise((r) => wb.on('open', r))]);
  const ma = collect(wa), mb = collect(wb);
  wa.send(JSON.stringify({ t: 'queue.join', mode: 'friendly' }));
  wb.send(JSON.stringify({ t: 'queue.join', mode: 'friendly' }));
  const [f] = await waitFor(ma, (m) => m.t === 'match.found', 15000, 'match');
  return { A, B, idA, idB, wa, wb, ma, mb, duelId: f.duelId };
}

function autoPlay(ctx, w, msgs, pid, duelId, delayMs = 350) {
  const seen = new Set();
  return setInterval(async () => {
    const { active } = await import('../../server/modules/duels/engine.js');
    for (const q of msgs.filter((m) => m.t === 'question.show' && !seen.has(m.round))) {
      seen.add(q.round);
      const st = active.get(duelId);
      if (!st || st.status !== 'question' || q.round !== st.round) continue;
      const qq = st.questions[q.round - 1];
      const good = shuffleForPlayer(qq, pid * 31 + q.round * 7 + duelId).correctIndex;
      setTimeout(() => { try { w.send(JSON.stringify({ t: 'answer', duelId, round: q.round, choice: good })); } catch {} }, delayMs);
    }
  }, 200);
}

test('reconnexion à 20 s : le duel reprend sans pénalité', async () => {
  const ctx = await boot({ port: 34583, db: '/tmp/duelo-p11-reconnect.db' });
  let iv1, iv2;
  try {
    const d = await duelPair(ctx, 'RecoA', 'RecoB');
    iv1 = autoPlay(ctx, d.wa, d.ma, d.idA, d.duelId);
    iv2 = autoPlay(ctx, d.wb, d.mb, d.idB, d.duelId);
    await waitFor(d.ma, (m) => m.t === 'question.reveal' && m.round === 2, 30000, 'Q2');
    d.wb.terminate(); // B coupe à ~Q3
    const [pres] = await waitFor(d.ma, (m) => m.t === 'presence.opponent' && m.status === 'reconnecting', 10000, 'presence reconnecting');
    assert.equal(pres.duelId, d.duelId);
    await new Promise((r) => setTimeout(r, 20000)); // 20 s d'absence, dans la grâce 30 s
    clearInterval(iv2);
    const wb2 = new WebSocket(ctx.wsUrl, { headers: { Cookie: d.B.cookie } });
    const mb2 = collect(wb2); // attaché avant 'open' : le resync part dès la connexion
    await new Promise((r) => wb2.on('open', r));
    const [rs] = await waitFor(mb2, (m) => m.t === 'resync', 10000, 'resync');
    assert.equal(rs.duelId, d.duelId);
    await waitFor(d.ma, (m) => m.t === 'presence.opponent' && m.status === 'online', 10000, 'presence online');
    iv2 = autoPlay(ctx, wb2, mb2, d.idB, d.duelId);
    const [end] = await waitFor(d.ma, (m) => m.t === 'duel.end', 60000, 'duel.end après reco');
    assert.equal(end.forfeit, undefined, 'pas de forfait après reconnexion dans les délais');
    assert.ok(end.scores.you + end.scores.opp >= 0);
    d.wa.terminate(); wb2.terminate();
    clearInterval(iv1); clearInterval(iv2);
  } finally {
    clearInterval(iv1); clearInterval(iv2);
    await ctx.close();
  }
});

test('forfait à 30 s : l’absent perd, le présent est récompensé', async () => {
  const ctx = await boot({ port: 34584, db: '/tmp/duelo-p11-forfeit.db' });
  let iv;
  try {
    const d = await duelPair(ctx, 'ForfA', 'ForfB');
    iv = autoPlay(ctx, d.wa, d.ma, d.idA, d.duelId);
    const ivb = autoPlay(ctx, d.wb, d.mb, d.idB, d.duelId);
    await waitFor(d.ma, (m) => m.t === 'question.reveal' && m.round === 1, 30000, 'Q1');
    clearInterval(ivb);
    d.wb.terminate(); // B disparaît définitivement
    const [end] = await waitFor(d.ma, (m) => m.t === 'duel.end', 60000, 'duel.end forfait');
    assert.equal(end.forfeit, true);
    assert.equal(end.winner, d.idA);
    // Récompense complète du présent (F-17)
    const me = await fetch(ctx.url + '/api/v1/me', { headers: { Cookie: d.A.cookie } }).then((r) => r.json());
    assert.ok(me.ledger.some((l) => l.kind === 'duel-forfeit' && l.amount_coins > 0), 'ledger forfait : ' + JSON.stringify(me.ledger));
    d.wa.terminate();
    clearInterval(iv);
  } finally {
    clearInterval(iv);
    await ctx.close();
  }
});
