// P13-6 : autorisation croisée complète — orga A contre B, joueur contre lots d'autrui.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, mkUsersDirect } from '../integration/helper.js';
import { genRewardKey } from '../../server/lib/crypto.js';

test('autorisations croisées : A/B, joueurs, admin contenu', async () => {
  process.env.REWARD_KEY = process.env.REWARD_KEY?.length === 64 ? process.env.REWARD_KEY : genRewardKey();
  const ctx = await boot({ port: 34605, db: '/tmp/duelo-p13-xauth.db' });
  try {
    const { getDb } = await import('../../server/db/db.js');
    const db = getDb();
    const [adm] = await mkUsersDirect(['XAdm']);
    const [orgA] = await mkUsersDirect(['XOrgA']);
    const [orgB] = await mkUsersDirect(['XOrgB']);
    const [j1, j2] = await mkUsersDirect(['XJ1', 'XJ2']);
    db.prepare(`UPDATE users SET role='admin' WHERE id=?`).run(adm.id);
    for (const o of [orgA, orgB]) {
      await fetch(ctx.url + `/api/v1/admin/organizers/${o.id}/grant`, { method: 'POST', headers: { Cookie: adm.cookie } });
      await fetch(ctx.url + `/api/v1/admin/organizers/${o.id}/quotas`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: adm.cookie }, body: JSON.stringify({ requires_approval: 0 }) });
    }
    const A = { Cookie: orgA.cookie }, B = { Cookie: orgB.cookie };
    const AJ = { 'Content-Type': 'application/json', Cookie: orgA.cookie };
    const tid = await fetch(ctx.url + '/api/v1/organizer/tournaments', { method: 'POST', headers: AJ, body: JSON.stringify({ name: 'Tournoi de A', size: 8, startsAt: Date.now() + 72 * 36e5, visibility: 'public' }) }).then((x) => x.json()).then((j) => j.id);
    const contre = [
      ['PATCH tournoi', () => fetch(ctx.url + `/api/v1/organizer/tournaments/${tid}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: orgB.cookie }, body: JSON.stringify({ name: 'Volé' }) })],
      ['cancel tournoi', () => fetch(ctx.url + `/api/v1/organizer/tournaments/${tid}/cancel`, { method: 'POST', headers: B })],
      ['duplicate tournoi', () => fetch(ctx.url + `/api/v1/organizer/tournaments/${tid}/duplicate`, { method: 'POST', headers: B })],
      ['release lots', () => fetch(ctx.url + `/api/v1/organizer/tournaments/${tid}/release`, { method: 'POST', headers: B })],
      ['export csv', () => fetch(ctx.url + `/api/v1/organizer/tournaments/${tid}/export.csv`, { headers: B })],
      ['liste lots', () => fetch(ctx.url + `/api/v1/organizer/tournaments/${tid}/rewards`, { headers: B })],
      ['disqualify', () => fetch(ctx.url + `/api/v1/organizer/tournaments/${tid}/disqualify`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: orgB.cookie }, body: JSON.stringify({ userId: j1.id }) })],
      ['cover upload', () => fetch(ctx.url + `/api/v1/organizer/tournaments/${tid}/cover`, { method: 'POST', headers: B, body: 'x' })],
    ];
    for (const [nom, fn] of contre) {
      const r = await fn();
      assert.ok([404, 403, 400].includes(r.status), `${nom} bloqué (reçu ${r.status})`);
    }
    assert.equal(db.prepare('SELECT name FROM tournaments WHERE id=?').get(tid).name, 'Tournoi de A', 'non modifié par B');

    // Lot secret de A : joueur étranger ne révèle/télécharge/signale rien
    await fetch(ctx.url + `/api/v1/organizer/tournaments/${tid}/rewards`, { method: 'POST', headers: AJ, body: JSON.stringify({ rankFrom: 1, rankTo: 1, publicLabel: 'Secret A', kind: 'secret', content: 'CODE-A-999' }) });
    await fetch(ctx.url + `/api/v1/organizer/tournaments/${tid}/publish`, { method: 'POST', headers: A });
    // Attribution manuelle d'un claim à j1 (simulation de gain)
    const rid = db.prepare(`SELECT id FROM tournament_rewards WHERE tournament_id=?`).get(tid).id;
    const claimId = db.prepare('INSERT INTO reward_claims(reward_id,user_id,status,created_at) VALUES(?,?,?,?)').run(rid, j1.id, 'available', Date.now()).lastInsertRowid;
    for (const [nom, fn] of [
      ['reveal autrui', () => fetch(ctx.url + `/api/v1/me/rewards/${claimId}/reveal`, { method: 'POST', headers: { Cookie: j2.cookie } })],
      ['download autrui', () => fetch(ctx.url + `/api/v1/me/rewards/${claimId}/download`, { headers: { Cookie: j2.cookie } })],
      ['report autrui', () => fetch(ctx.url + `/api/v1/me/rewards/${claimId}/report`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: j2.cookie }, body: JSON.stringify({ reason: 'test' }) })],
    ]) {
      assert.equal(await fn().then((x) => x.status), 404, nom + ' bloqué');
    }
    // Le gagnant légitime révèle bien
    assert.equal(await fetch(ctx.url + `/api/v1/me/rewards/${claimId}/reveal`, { method: 'POST', headers: { Cookie: j1.cookie } }).then((x) => x.json()).then((j) => j.content), 'CODE-A-999');
    // Admin : isolation totale (aucune route de lecture du contenu, même masqué)
    assert.equal(await fetch(ctx.url + `/api/v1/organizer/tournaments/${tid}/rewards`, { headers: { Cookie: adm.cookie } }).then((x) => x.status), 404);
  } finally {
    await ctx.close();
  }
});
