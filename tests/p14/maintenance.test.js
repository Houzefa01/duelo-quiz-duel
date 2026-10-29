// P15-6 : mode maintenance — page, fin propre des duels, toggle admin.
import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { boot, mkUsersDirect, collect, waitFor } from '../integration/helper.js';

test('maintenance : nouveaux duels bloqués, en cours terminés, reprise', async () => {
  const ctx = await boot({ port: 34609, db: '/tmp/duelo-p15-maintenance.db' });
  try {
    const [adm] = await mkUsersDirect(['MaintAdm']);
    const [a, b, c] = await mkUsersDirect(['MaintA', 'MaintB', 'MaintC']);
    const { getDb } = await import('../../server/db/db.js');
    getDb().prepare(`UPDATE users SET role='admin' WHERE id=?`).run(adm.id);
    const on = (v) => fetch(ctx.url + '/api/v1/admin/maintenance', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adm.cookie }, body: JSON.stringify({ on: v }) }).then((x) => x.json());
    // Duel A/B démarré avant la maintenance.
    const wa = new WebSocket(ctx.wsUrl, { headers: { Cookie: a.cookie } });
    const wb = new WebSocket(ctx.wsUrl, { headers: { Cookie: b.cookie } });
    const ma = collect(wa);
    await Promise.all([new Promise((r) => wa.on('open', r)), new Promise((r) => wb.on('open', r))]);
    wa.send(JSON.stringify({ t: 'queue.join', mode: 'friendly' }));
    wb.send(JSON.stringify({ t: 'queue.join', mode: 'friendly' }));
    const [f] = await waitFor(ma, (m) => m.t === 'match.found', 15000, 'match');
    // Activation : les nouveaux sont refusés, l'API répond 503.
    const st = await on(true);
    assert.equal(st.maintenance, true);
    assert.equal(st.duelsActifs, 1);
    const wc = new WebSocket(ctx.wsUrl, { headers: { Cookie: c.cookie } });
    const mc = collect(wc);
    await new Promise((r) => wc.on('open', r));
    wc.send(JSON.stringify({ t: 'queue.join', mode: 'friendly' }));
    const [err] = await waitFor(mc, (m) => m.t === 'error', 10000, 'refus file');
    assert.equal(err.error, 'maintenance');
    const r = await fetch(ctx.url + '/api/v1/challenges', { headers: { Cookie: c.cookie } });
    assert.equal(r.status, 503);
    // Le duel en cours se termine proprement (réponses auto).
    const { active } = await import('../../server/modules/duels/engine.js');
    const { shuffleForPlayer } = await import('../../server/modules/duels/picker.js');
    const idA = (await fetch(ctx.url + '/api/v1/me', { headers: { Cookie: a.cookie } }).then((x) => x.json())).id;
    const seen = new Set();
    const t0 = Date.now();
    for (;;) {
      for (const q of ma.filter((m) => m.t === 'question.show' && !seen.has(m.round))) {
        seen.add(q.round);
        const st2 = active.get(f.duelId);
        if (!st2) continue;
        wa.send(JSON.stringify({ t: 'answer', duelId: f.duelId, round: q.round, choice: shuffleForPlayer(st2.questions[q.round - 1], idA * 31 + q.round * 7 + f.duelId).correctIndex }));
        wb.send(JSON.stringify({ t: 'answer', duelId: f.duelId, round: q.round, choice: 0 }));
      }
      if (ma.some((m) => m.t === 'duel.end')) break;
      if (Date.now() - t0 > 90000) throw new Error('duel non terminé');
      await new Promise((x) => setTimeout(x, 150));
    }
    // Coupure : tout refonctionne.
    await on(false);
    const ok = await fetch(ctx.url + '/api/v1/challenges', { headers: { Cookie: c.cookie } });
    assert.equal(ok.status, 200);
    wa.terminate(); wb.terminate(); wc.terminate();
  } finally {
    await ctx.close();
  }
});
