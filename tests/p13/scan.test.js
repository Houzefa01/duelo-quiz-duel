// P13-3 : sans ClamAV — 5 types auto, le reste en validation admin + avertissement.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, mkUsersDirect } from '../integration/helper.js';
import { genRewardKey } from '../../server/lib/crypto.js';

test('fichiers : auto (pdf) vs validation admin (mp3), avertissement gagnant', async () => {
  process.env.REWARD_KEY = process.env.REWARD_KEY?.length === 64 ? process.env.REWARD_KEY : genRewardKey();
  const ctx = await boot({ port: 34603, db: '/tmp/duelo-p13-scan.db' });
  try {
    const { getDb } = await import('../../server/db/db.js');
    const db = getDb();
    const [adm] = await mkUsersDirect(['ScanAdmin']);
    const [org] = await mkUsersDirect(['ScanOrg']);
    const [joueur] = await mkUsersDirect(['ScanJoueur']);
    db.prepare(`UPDATE users SET role='admin' WHERE id=?`).run(adm.id);
    db.prepare('UPDATE users SET level=10 WHERE id IN (?,?,?)').run(org.id, adm.id, joueur.id);
    await fetch(ctx.url + `/api/v1/admin/organizers/${org.id}/grant`, { method: 'POST', headers: { Cookie: adm.cookie } });
    await fetch(ctx.url + `/api/v1/admin/organizers/${org.id}/quotas`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: adm.cookie }, body: JSON.stringify({ requires_approval: 0 }) });
    const H = { Cookie: org.cookie };
    const HJ = { 'Content-Type': 'application/json', Cookie: org.cookie };
    const upFile = (buf, name, type) => {
      const fd = new FormData();
      fd.append('fichier', new Blob([buf], { type }), name);
      return fetch(ctx.url + '/api/v1/organizer/rewards/upload', { method: 'POST', headers: H, body: fd }).then((x) => x.json().then((j) => ({ s: x.status, j })));
    };
    // PDF : accepté d'office
    let r = await upFile(Buffer.from('%PDF-1.4 auto'), 'doc.pdf', 'application/pdf');
    assert.equal(r.s, 200);
    assert.equal(r.j.pendingReview, false);
    // MP3 : en attente de validation (pas de clamscan ici)
    r = await upFile(Buffer.from('ID3' + 'x'.repeat(100)), 'son.mp3', 'audio/mpeg');
    assert.equal(r.s, 200);
    assert.equal(r.j.pendingReview, true, JSON.stringify(r.j));
    assert.ok(r.j.warning?.includes('validation admin'));
    // Tournoi avec lot mp3 : publication bloquée
    const tid = await fetch(ctx.url + '/api/v1/organizer/tournaments', { method: 'POST', headers: HJ, body: JSON.stringify({ name: 'Coupe scan', size: 8, startsAt: Date.now() + 72 * 36e5, visibility: 'public' }) }).then((x) => x.json()).then((j) => j.id);
    const upId = db.prepare(`SELECT id FROM uploads WHERE owner_id=? AND kind='reward' AND path LIKE '%.mp3'`).get(org.id).id;
    await fetch(ctx.url + `/api/v1/organizer/tournaments/${tid}/rewards`, { method: 'POST', headers: HJ, body: JSON.stringify({ rankFrom: 1, rankTo: 1, publicLabel: 'Hymne', kind: 'fichier', fileUploadId: upId }) });
    r = await fetch(ctx.url + `/api/v1/organizer/tournaments/${tid}/publish`, { method: 'POST', headers: H }).then((x) => x.json());
    assert.ok(r.error?.includes('validation admin'), 'bloqué : ' + JSON.stringify(r));
    // File admin : validation puis publication OK
    const pend = await fetch(ctx.url + '/api/v1/admin/uploads/pending', { headers: { Cookie: adm.cookie } }).then((x) => x.json());
    assert.ok(pend.rows.some((u) => u.id === upId), 'file admin');
    await fetch(ctx.url + `/api/v1/admin/uploads/${upId}/approve`, { method: 'POST', headers: { Cookie: adm.cookie } });
    r = await fetch(ctx.url + `/api/v1/organizer/tournaments/${tid}/publish`, { method: 'POST', headers: H }).then((x) => x.json());
    assert.equal(r.ok, true);
    // Gagnant averti : le lot mp3 porte un avertissement dans Mes lots
    const rid = db.prepare(`SELECT id FROM tournament_rewards WHERE tournament_id=?`).get(tid).id;
    db.prepare('INSERT INTO reward_claims(reward_id,user_id,status,created_at) VALUES(?,?,?,?)').run(rid, joueur.id, 'available', Date.now());
    const lots = await fetch(ctx.url + '/api/v1/me/rewards', { headers: { Cookie: joueur.cookie } }).then((x) => x.json());
    const lot = lots.rows.find((x) => x.id && x.public_label === 'Hymne');
    assert.ok(lot?.warning?.includes('antivirus'), 'avertissement : ' + lot?.warning);
  } finally {
    await ctx.close();
  }
});
