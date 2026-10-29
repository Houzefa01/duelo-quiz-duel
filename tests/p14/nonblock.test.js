// P14-1 : le traitement d'image ne bloque jamais les duels.
// Moteur jimp (le pire cas : synchrone, lent) dans un worker à file unique.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import WebSocket from 'ws';
import sharp from 'sharp';
import { boot, mkUsersDirect, collect, waitFor } from '../integration/helper.js';
import { shuffleForPlayer } from '../../server/modules/duels/picker.js';

test('client : photo réduite à 512 px avant envoi (vérification statique)', () => {
  const src = fs.readFileSync(new URL('../../web/js/app.js', import.meta.url), 'utf8');
  assert.ok(src.includes('512'), 'borne 512 px');
  assert.ok(src.includes('createImageBitmap') && src.includes('toBlob'), 'canvas + toBlob');
  assert.ok(src.includes('reduirePhoto(f)'), 'utilisé aux 2 envois');
});

test('pendant un upload jimp, la latence p95 des duels reste < 100 ms', async () => {
  process.env.AVATAR_ENGINE = 'jimp';
  const ctx = await boot({ port: 34606, db: '/tmp/duelo-p14-nonblock.db' });
  let joue = null, espion = null, wa = null, wb = null;
  try {
    const [A, B] = await mkUsersDirect(['NB_A', 'NB_B']);
    const idA = (await fetch(ctx.url + '/api/v1/me', { headers: { Cookie: A.cookie } }).then((r) => r.json())).id;
    const { active } = await import('../../server/modules/duels/engine.js');
    wa = new WebSocket(ctx.wsUrl, { headers: { Cookie: A.cookie } });
    wb = new WebSocket(ctx.wsUrl, { headers: { Cookie: B.cookie } });
    const ma = collect(wa), mb = collect(wb);
    await Promise.all([new Promise((r) => wa.on('open', r)), new Promise((r) => wb.on('open', r))]);
    wa.send(JSON.stringify({ t: 'queue.join', mode: 'friendly' }));
    wb.send(JSON.stringify({ t: 'queue.join', mode: 'friendly' }));
    const [f] = await waitFor(ma, (m) => m.t === 'match.found', 15000, 'match');
    const duelId = f.duelId;
    const lat = [];
    let tAns = 0;
    const seen = new Set();
    joue = setInterval(async () => {
      for (const q of ma.filter((m) => m.t === 'question.show' && !seen.has(m.round))) {
        seen.add(q.round);
        const st = active.get(duelId);
        if (!st) continue;
        const good = shuffleForPlayer(st.questions[q.round - 1], idA * 31 + q.round * 7 + duelId).correctIndex;
        tAns = Date.now();
        wa.send(JSON.stringify({ t: 'answer', duelId, round: q.round, choice: good }));
      }
      for (const q of mb.filter((m) => m.t === 'question.show' && !seen.has('b' + m.round))) {
        seen.add('b' + q.round);
        // B répond après A : chaque manche donne un échantillon de latence côté B.
        setTimeout(() => { try { wb.send(JSON.stringify({ t: 'answer', duelId, round: q.round, choice: 0 })); } catch {} }, 400);
      }
    }, 150);
    // Latence : chaque 'opponent.answered' vu par B suit la réponse de A.
    let vus = 0;
    espion = setInterval(() => {
      const tous = mb.filter((m) => m.t === 'opponent.answered');
      while (vus < tous.length) { vus++; lat.push(Date.now() - tAns); }
    }, 50);
    // Image 512 px qui occupe jimp plusieurs secondes dans le worker.
    const big = await sharp({ create: { width: 512, height: 512, channels: 3, background: { r: 30, g: 60, b: 90 } } }).png().toBuffer();
    const fd = new FormData();
    fd.append('photo', new Blob([big]), 'grosse.png');
    const upP = fetch(ctx.url + '/api/v1/me/avatar/upload', { method: 'POST', headers: { Cookie: B.cookie }, body: fd });
    // Pendant l'upload, le duel continue : on attend 3 révélations.
    await waitFor(ma, (m) => m.t === 'question.reveal' && m.round >= 3, 120000, '3 révélations pendant upload');
    const up = await upP;
    assert.equal(up.status, 200, 'upload aboutit malgré la file à 1');
    clearInterval(joue);
    clearInterval(espion);
    lat.sort((a, b) => a - b);
    const p95 = lat[Math.floor(lat.length * 0.95)] ?? 9999;
    console.log(`    latences duel pendant upload jimp : n=${lat.length}, médiane=${lat[Math.floor(lat.length / 2)]} ms, p95=${p95} ms`);
    assert.ok(lat.length >= 3, 'échantillons suffisants');
    assert.ok(p95 < 100, `p95 < 100 ms (reçu ${p95})`);
    wa.terminate(); wb.terminate();
  } finally {
    clearInterval(joue); clearInterval(espion);
    try { wa?.terminate(); wb?.terminate(); } catch {}
    delete process.env.AVATAR_ENGINE;
    await ctx.close();
  }
});
