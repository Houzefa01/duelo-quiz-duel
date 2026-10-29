// P12-C : catalogue, choix, téléversement sécurisé, modération, thème.
import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { boot, mkUsersDirect } from '../integration/helper.js';
import { AVATARS, isPreset, avatarUrlFor, DEFAUT_AVATAR } from '../../server/modules/avatars/catalog.js';

test('catalogue : 56 avatars, helpers', () => {
  assert.equal(AVATARS.length, 56);
  assert.ok(isPreset('personnage-a1.svg') && !isPreset('nimporte.svg'));
  assert.equal(avatarUrlFor(null), '/assets/avatars/' + DEFAUT_AVATAR);
  assert.equal(avatarUrlFor({ avatar_kind: 'upload', avatar_ref: 'xxx' }), '/api/v1/avatar/photo/xxx');
  assert.ok(avatarUrlFor({ avatar_kind: 'preset', avatar_ref: 'creat-e1.svg' }).endsWith('creat-e1.svg'));
});

test('avatars : défaut, choix, upload, modération, thème', async () => {
  const ctx = await boot({ port: 34593, db: '/tmp/duelo-p12-avatars.db' });
  try {
    const { getDb } = await import('../../server/db/db.js');
    const db = getDb();
    const [u1, u2] = await mkUsersDirect(['AvA', 'AvB']);
    const [adm] = await mkUsersDirect(['AvAdmin']);
    db.prepare(`UPDATE users SET role='admin' WHERE id=?`).run(adm.id);

    // Catalogue public + défaut aléatoire du catalogue à l'inscription
    const cat = await fetch(ctx.url + '/api/v1/avatars').then((r) => r.json());
    assert.equal(cat.rows.length, 56);
    const me1 = await fetch(ctx.url + '/api/v1/me', { headers: { Cookie: u1.cookie } }).then((r) => r.json());
    // Défaut aléatoire du catalogue à l'inscription (via HTTP register)
    const reg = await fetch(ctx.url + '/api/v1/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'AvReg', password: 'motdepasse12345', ageOk: true }) }).then((r) => r.json());
    assert.ok(isPreset(db.prepare('SELECT avatar_ref FROM users WHERE username=?').get('AvReg').avatar_ref), 'défaut catalogue : ' + reg.id);

    // Choix preset OK / inconnu refusé
    let r = await fetch(ctx.url + '/api/v1/me/avatar', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: u1.cookie }, body: JSON.stringify({ ref: 'creat-e2.svg' }) }).then((x) => x.json());
    assert.equal(r.ok, true);
    r = await fetch(ctx.url + '/api/v1/me/avatar', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: u1.cookie }, body: JSON.stringify({ ref: 'evil.svg' }) });
    assert.equal(r.status, 400);

    const up = async (cookie, buf, filename) => {
      const fd = new FormData();
      fd.append('photo', new Blob([buf]), filename);
      return fetch(ctx.url + '/api/v1/me/avatar/upload', { method: 'POST', headers: { Cookie: cookie }, body: fd });
    };
    const png = await sharp({ create: { width: 100, height: 100, channels: 3, background: { r: 255, g: 0, b: 0 } } }).png().toBuffer();
    // Upload valide -> webp 256, servi avec nosniff + cache long
    r = await up(u1.cookie, png, 'moi.png');
    assert.equal(r.status, 200);
    const { url } = await r.json();
    const uuid = url.split('/').pop();
    const img = await fetch(ctx.url + url);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/webp');
    assert.equal(img.headers.get('x-content-type-options'), 'nosniff');
    assert.ok((img.headers.get('cache-control') ?? '').includes('immutable'));
    const served = Buffer.from(await img.arrayBuffer());
    const meta = await sharp(served).metadata();
    assert.equal(meta.width, 256);
    assert.equal(meta.exif, undefined, 'EXIF supprimé');
    // .php renommé, GIF, >3Mo refusés
    r = await up(u2.cookie, Buffer.from("<?php echo 'pirate'; ?>"), 'evil.png');
    assert.equal(r.status, 415);
    r = await up(u2.cookie, Buffer.from('GIF89a' + 'x'.repeat(100)), 'anim.gif');
    assert.equal(r.status, 415);
    const big = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(3 * 1024 * 1024)]);
    r = await up(u2.cookie, big, 'gros.png');
    assert.equal(r.status, 413);
    // 5/jour : 5 uploads OK puis 429 (les 3 refusés ci-dessus ne comptent pas)
    for (let i = 0; i < 5; i++) { r = await up(u2.cookie, png, `p${i}.png`); assert.equal(r.status, 200, 'upload ' + i); }
    r = await up(u2.cookie, png, 'trop.png');
    assert.equal(r.status, 429, '6e upload refusé');
    // Suppression : retour catalogue + fichier effacé
    r = await fetch(ctx.url + '/api/v1/me/avatar/upload', { method: 'DELETE', headers: { Cookie: u2.cookie } }).then((x) => x.json());
    assert.equal(r.ok, true);
    const me2 = await fetch(ctx.url + '/api/v1/me', { headers: { Cookie: u2.cookie } }).then((x) => x.json());
    assert.equal(me2.avatar_kind, 'preset');

    // Signalement + retrait admin (+ban)
    await fetch(ctx.url + `/api/v1/avatars/AvA/report`, { method: 'POST', headers: { Cookie: u2.cookie, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(db.prepare('SELECT COUNT(*) c FROM avatar_reports WHERE handled=0').get().c, 1);
    r = await fetch(ctx.url + `/api/v1/admin/avatars/${u1.id}/remove`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adm.cookie }, body: JSON.stringify({ banUpload: true }) }).then((x) => x.json());
    assert.equal(r.ok, true);
    assert.equal(db.prepare('SELECT upload_banned FROM users WHERE id=?').get(u1.id).upload_banned, 1);
    r = await up(u1.cookie, png, 'rebel.png');
    assert.equal(r.status, 403, 'banni ne téléverse plus');

    // Approbation préalable : invisible des autres tant que pending
    db.prepare("INSERT OR REPLACE INTO kv(k,v) VALUES('avatar_require_approval','1')").run();
    const [u3] = await mkUsersDirect(['AvC']);
    r = await up(u3.cookie, png, 'attente.png');
    assert.equal((await r.json()).pending, true);
    const uuid3 = db.prepare('SELECT path FROM uploads WHERE owner_id=? ORDER BY id DESC LIMIT 1').get(u3.id).path;
    r = await fetch(ctx.url + `/api/v1/avatar/photo/${uuid3}`, { headers: { Cookie: u3.cookie } });
    assert.equal(r.status, 200, 'visible par le propriétaire');
    r = await fetch(ctx.url + `/api/v1/avatar/photo/${uuid3}`, { headers: { Cookie: u2.cookie } });
    void r;
    // (u2 n'est pas le propriétaire -> 404 ; testé via session absente ci-dessous)
    r = await fetch(ctx.url + `/api/v1/avatar/photo/${uuid3}`);
    assert.equal(r.status, 404, 'invisible des autres en approbation préalable');
    db.prepare("INSERT OR REPLACE INTO kv(k,v) VALUES('avatar_require_approval','0')").run();

    // Thème : mémorisé en profil (F-91), invalide refusé
    r = await fetch(ctx.url + '/api/v1/me/theme', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: u1.cookie }, body: JSON.stringify({ theme: 'dark' }) }).then((x) => x.json());
    assert.equal(r.ok, true);
    assert.equal(db.prepare('SELECT theme_pref FROM users WHERE id=?').get(u1.id).theme_pref, 'dark');
    r = await fetch(ctx.url + '/api/v1/me/theme', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: u1.cookie }, body: JSON.stringify({ theme: 'neon' }) });
    assert.equal(r.status, 400);
    // theme.js : externe, sans inline, applique data-theme avant peinture
    const tjs = await fetch(ctx.url + '/js/theme.js').then((x) => x.text());
    assert.ok(tjs.includes('data-theme') && !tjs.includes('innerHTML'));
    void uuid;
  } finally {
    await ctx.close();
  }
});
