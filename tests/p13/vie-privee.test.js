// P13-4 : suppression de compte — photo et copies effacées, historique anonymisé.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import sharp from 'sharp';
import { boot, mkUsersDirect } from '../integration/helper.js';

test('suppression : photo effacée du disque, pseudo anonymisé, historique conservé', async () => {
  const ctx = await boot({ port: 34602, db: '/tmp/duelo-p13-prive.db' });
  try {
    const { getDb } = await import('../../server/db/db.js');
    const db = getDb();
    const [u] = await mkUsersDirect(['EffaceMoi']);
    const png = await sharp({ create: { width: 80, height: 80, channels: 3, background: { r: 0, g: 200, b: 100 } } }).png().toBuffer();
    const fd = new FormData();
    fd.append('photo', new Blob([png]), 'moi.png');
    const up = await fetch(ctx.url + '/api/v1/me/avatar/upload', { method: 'POST', headers: { Cookie: u.cookie }, body: fd });
    assert.equal(up.status, 200);
    const uuid = db.prepare('SELECT path FROM uploads WHERE owner_id=?').get(u.id).path;
    const dir = process.env.AVATAR_DIR ?? './data/uploads/avatars';
    assert.ok(fs.existsSync(dir + '/' + uuid + '.webp'));
    assert.ok(fs.existsSync(dir + '/' + uuid + '-64.webp'));
    // La photo est servie avant suppression
    assert.equal(await fetch(ctx.url + `/api/v1/avatar/photo/${uuid}`).then((x) => x.status), 200);
    // Suppression du compte
    const r = await fetch(ctx.url + '/api/v1/me', { method: 'DELETE', headers: { Cookie: u.cookie } }).then((x) => x.json());
    assert.equal(r.ok, true);
    // Fichiers effacés du disque
    assert.equal(fs.existsSync(dir + '/' + uuid + '.webp'), false, '256 effacé');
    assert.equal(fs.existsSync(dir + '/' + uuid + '-64.webp'), false, '64 effacé');
    // Photo inserviable, sessions fermées
    assert.equal(await fetch(ctx.url + `/api/v1/avatar/photo/${uuid}`).then((x) => x.status), 404);
    assert.equal(await fetch(ctx.url + '/api/v1/me', { headers: { Cookie: u.cookie } }).then((x) => x.status), 401);
    // Historique anonymisé mais conservé
    const row = db.prepare('SELECT username,status FROM users WHERE id=?').get(u.id);
    assert.equal(row.username, 'Joueur-supprime-' + u.id);
    assert.equal(row.status, 'deleted');
    assert.equal(db.prepare('SELECT email FROM users WHERE id=?').get(u.id).email, null);
  } finally {
    await ctx.close();
  }
});
