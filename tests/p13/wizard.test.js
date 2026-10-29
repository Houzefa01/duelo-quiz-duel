// P13-1 : assistant 4 étapes — brouillon vide, sauvegarde auto, couverture, publication.
import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { boot, mkUsersDirect } from '../integration/helper.js';

test('assistant : brouillon, étapes, couverture, publication', async () => {
  const ctx = await boot({ port: 34601, db: '/tmp/duelo-p13-wizard.db' });
  try {
    const { getDb } = await import('../../server/db/db.js');
    const db = getDb();
    const [adm] = await mkUsersDirect(['WizAdmin']);
    const [org] = await mkUsersDirect(['WizOrg']);
    db.prepare(`UPDATE users SET role='admin' WHERE id=?`).run(adm.id);
    await fetch(ctx.url + `/api/v1/admin/organizers/${org.id}/grant`, { method: 'POST', headers: { Cookie: adm.cookie } });
    await fetch(ctx.url + `/api/v1/admin/organizers/${org.id}/quotas`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: adm.cookie }, body: JSON.stringify({ requires_approval: 0 }) });
    const H = { Cookie: org.cookie };
    const HJ = { 'Content-Type': 'application/json', Cookie: org.cookie };

    // Étape 0 : brouillon vide
    let r = await fetch(ctx.url + '/api/v1/organizer/tournaments/draft', { method: 'POST', headers: H }).then((x) => x.json());
    const tid = r.id;
    assert.ok(tid);
    assert.equal(db.prepare('SELECT approval_status FROM tournaments WHERE id=?').get(tid).approval_status, 'draft');

    // Étape 1 (Infos) : sauvegardes successives (autosave)
    await fetch(ctx.url + `/api/v1/organizer/tournaments/${tid}`, { method: 'PATCH', headers: HJ, body: JSON.stringify({ name: 'Coupe Assistant' }) });
    await fetch(ctx.url + `/api/v1/organizer/tournaments/${tid}`, { method: 'PATCH', headers: HJ, body: JSON.stringify({ description: 'Un tournoi monté pas à pas.' }) });
    await fetch(ctx.url + `/api/v1/organizer/tournaments/${tid}`, { method: 'PATCH', headers: HJ, body: JSON.stringify({ size: 16, visibility: 'public' }) });
    let t = db.prepare('SELECT * FROM tournaments WHERE id=?').get(tid);
    assert.equal(t.name, 'Coupe Assistant');
    assert.equal(t.size, 16);

    // Couverture téléversée (même traitement que les avatars)
    const png = await sharp({ create: { width: 900, height: 500, channels: 3, background: { r: 255, g: 200, b: 61 } } }).png().toBuffer();
    const fd = new FormData();
    fd.append('photo', new Blob([png]), 'couv.png');
    r = await fetch(ctx.url + `/api/v1/organizer/tournaments/${tid}/cover`, { method: 'POST', headers: H, body: fd });
    assert.equal(r.status, 200);
    t = db.prepare('SELECT cover_ref FROM tournaments WHERE id=?').get(tid);
    assert.ok(t.cover_ref.startsWith('upload:cover-'), t.cover_ref);
    const img = await fetch(ctx.url + `/api/v1/cover/photo/${t.cover_ref.slice(7)}`);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/webp');
    const meta = await sharp(Buffer.from(await img.arrayBuffer())).metadata();
    assert.equal(meta.width, 800);
    assert.equal(meta.exif, undefined);

    // Étape 2 (Règles) + acceptation datée
    await fetch(ctx.url + `/api/v1/organizer/tournaments/${tid}`, { method: 'PATCH', headers: HJ, body: JSON.stringify({ rules: { categories: ['sciences'], difficulty: 'mixte', finalBestOf: 3, minLevel: 2 }, manualRelease: false }) });
    await fetch(ctx.url + `/api/v1/organizer/tournaments/${tid}/terms`, { method: 'POST', headers: H });
    assert.ok(db.prepare('SELECT terms_accepted_at FROM organizer_profiles WHERE user_id=?').get(org.id).terms_accepted_at > 0);

    // Étape 3 (Lots) : un lot texte
    process.env.REWARD_KEY = process.env.REWARD_KEY?.length === 64 ? process.env.REWARD_KEY : (await import('../../server/lib/crypto.js')).genRewardKey();
    r = await fetch(ctx.url + `/api/v1/organizer/tournaments/${tid}/rewards`, { method: 'POST', headers: HJ, body: JSON.stringify({ rankFrom: 1, rankTo: 1, publicLabel: 'Bravo', kind: 'texte', content: 'Bien joué' }) }).then((x) => x.json());
    assert.ok(r.id);

    // Étape 4 (Aperçu + publication) : fiche complète puis publication directe (sans validation)
    const fiche = await fetch(ctx.url + `/api/v1/tournaments/${tid}`, { headers: H }).then((x) => x.json());
    assert.equal(fiche.tournament.name, 'Coupe Assistant');
    assert.equal(fiche.rewards.length, 1);
    r = await fetch(ctx.url + `/api/v1/organizer/tournaments/${tid}/publish`, { method: 'POST', headers: H }).then((x) => x.json());
    assert.equal(r.status, 'open');
  } finally {
    await ctx.close();
  }
});
