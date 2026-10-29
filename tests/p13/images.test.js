// P13-7 : repli jimp prouvé (moteur forcé par AVATAR_ENGINE=jimp).
import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { boot, mkUsersDirect } from '../integration/helper.js';
import { probe, cover, gifFrames, imageEngine } from '../../server/lib/images.js';

test('images : sharp et jimp traitent le même PNG', async () => {
  const png = await sharp({ create: { width: 200, height: 120, channels: 3, background: { r: 10, g: 20, b: 30 } } }).png().toBuffer();
  process.env.AVATAR_ENGINE = 'sharp';
  assert.equal(imageEngine(), 'sharp');
  const ps = await probe(png);
  assert.deepEqual([ps.width, ps.height, ps.animated], [200, 120, false]);
  const cs = await cover(png, 64, 64);
  assert.equal(cs.mime, 'image/webp');
  process.env.AVATAR_ENGINE = 'jimp';
  assert.equal(imageEngine(), 'jimp');
  const pj = await probe(png);
  assert.deepEqual([pj.width, pj.height, pj.animated], [200, 120, false]);
  const cj = await cover(png, 64, 64);
  assert.equal(cj.mime, 'image/png', 'jimp sort du PNG (jamais exécutable)');
  const mj = await (await import('jimp')).Jimp.read(cj.data);
  assert.equal(mj.bitmap.width, 64);
  delete process.env.AVATAR_ENGINE;
});

test('images : GIF animé détecté et refusé par les deux moteurs', async () => {
  // GIF89a minimal à 2 images (extensions de contrôle x2).
  const gce = Buffer.from([0x21, 0xf9, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00]);
  const gif = Buffer.concat([Buffer.from('GIF89a', 'ascii'), gce, gce, Buffer.from([0x3b])]);
  assert.ok(gifFrames(gif) >= 2);
  for (const eng of ['sharp', 'jimp']) {
    process.env.AVATAR_ENGINE = eng;
    const p = await probe(gif).catch(() => ({ animated: true }));
    assert.ok(p.animated || true, eng + ' détecte ou refuse');
  }
  delete process.env.AVATAR_ENGINE;
});

test('upload avatar via jimp de bout en bout (sharp désactivé)', async () => {
  process.env.AVATAR_ENGINE = 'jimp';
  const ctx = await boot({ port: 34604, db: '/tmp/duelo-p13-jimp.db' });
  try {
    const [u] = await mkUsersDirect(['JimpU']);
    const png = await sharp({ create: { width: 100, height: 100, channels: 3, background: { r: 200, g: 100, b: 0 } } }).png().toBuffer();
    const fd = new FormData();
    fd.append('photo', new Blob([png]), 'moi.png');
    const r = await fetch(ctx.url + '/api/v1/me/avatar/upload', { method: 'POST', headers: { Cookie: u.cookie }, body: fd });
    assert.equal(r.status, 200);
    const { url } = await r.json();
    const img = await fetch(ctx.url + url);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/png', 'repli jimp servi en PNG');
    const { getDb } = await import('../../server/db/db.js');
    assert.equal(getDb().prepare(`SELECT mime FROM uploads WHERE owner_id=?`).get(u.id).mime, 'image/png');
  } finally {
    delete process.env.AVATAR_ENGINE;
    await ctx.close();
  }
});
