// P12-D : rôle, quotas, création/validation, privé, annulation, duplication, export, moteur réutilisé.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, mkUsersDirect } from '../integration/helper.js';
import { buildBracket, resolveMatch } from '../../server/modules/tournaments/routes.js';

test('organisateurs : 403, grant/revoke, quotas, audit', async () => {
  const ctx = await boot({ port: 34595, db: '/tmp/duelo-p12-orga.db' });
  try {
    const { getDb } = await import('../../server/db/db.js');
    const db = getDb();
    const [joueur] = await mkUsersDirect(['OrgJoueur']);
    const [futur] = await mkUsersDirect(['OrgFutur']);
    const [adm] = await mkUsersDirect(['OrgAdmin']);
    db.prepare(`UPDATE users SET role='admin' WHERE id=?`).run(adm.id);
    const post = (u, p, b) => fetch(ctx.url + p, { method: 'POST', headers: { ...(b ? { 'Content-Type': 'application/json' } : {}), Cookie: u.cookie }, body: b ? JSON.stringify(b) : undefined });

    // Joueur ordinaire : 403 partout
    let r = await post(joueur, '/api/v1/organizer/tournaments', { name: 'X', size: 8, startsAt: Date.now() + 36e5 });
    assert.equal(r.status, 403);
    r = await fetch(ctx.url + '/api/v1/organizer/tournaments', { headers: { Cookie: joueur.cookie } });
    assert.equal(r.status, 403);

    // Grant -> organisateur ; audit enregistré
    r = await post(adm, `/api/v1/admin/organizers/${futur.id}/grant`);
    assert.equal(r.status, 200);
    assert.equal(db.prepare('SELECT role FROM users WHERE id=?').get(futur.id).role, 'organizer');
    assert.ok(db.prepare(`SELECT id FROM audit_log WHERE action='orga_grant'`).get(), 'audit grant');
    const meO = await fetch(ctx.url + '/api/v1/me', { headers: { Cookie: futur.cookie } }).then((x) => x.json());
    assert.equal(meO.role, 'organizer');

    // Quotas
    r = await fetch(ctx.url + `/api/v1/admin/organizers/${futur.id}/quotas`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: adm.cookie }, body: JSON.stringify({ max_players: 16 }) }).then((x) => x.json());
    assert.equal(r.ok, true);
    assert.equal(db.prepare('SELECT max_players FROM organizer_profiles WHERE user_id=?').get(futur.id).max_players, 16);

    // Revoke -> simple joueur ; 403 à nouveau
    r = await post(adm, `/api/v1/admin/organizers/${futur.id}/revoke`);
    assert.equal(r.status, 200);
    r = await fetch(ctx.url + '/api/v1/organizer/tournaments', { headers: { Cookie: futur.cookie } });
    assert.equal(r.status, 403);
    assert.ok(db.prepare(`SELECT id FROM audit_log WHERE action='orga_revoke'`).get(), 'audit revoke');
  } finally {
    await ctx.close();
  }
});

test('tournoi organisateur : brouillon -> validation -> publication -> moteur -> vainqueur', async () => {
  const ctx = await boot({ port: 34596, db: '/tmp/duelo-p12-orga2.db' });
  try {
    const { getDb } = await import('../../server/db/db.js');
    const db = getDb();
    const [adm] = await mkUsersDirect(['Org2Admin']);
    const [org] = await mkUsersDirect(['Org2']);
    db.prepare(`UPDATE users SET role='admin' WHERE id=?`).run(adm.id);
    await fetch(ctx.url + `/api/v1/admin/organizers/${org.id}/grant`, { method: 'POST', headers: { Cookie: adm.cookie } });
    const H = { Cookie: org.cookie };
    const HJ = { 'Content-Type': 'application/json', Cookie: org.cookie };
    const post = (p, b) => fetch(ctx.url + p, { method: 'POST', headers: b ? HJ : H, body: b ? JSON.stringify(b) : undefined }).then((x) => x.json().then((j) => ({ s: x.status, j })).catch(() => ({ s: x.status, j: {} })));

    // Création brouillon privé avec règles
    let r = await post('/api/v1/organizer/tournaments', {
      name: 'Coupe du <b>club</b>', description: 'Tournoi amical.', size: 8,
      startsAt: Date.now() + 72 * 36e5, visibility: 'private',
      rules: { minLevel: 1, finalBestOf: 1 },
    });
    assert.equal(r.s, 200);
    const tid = r.j.id;
    assert.equal(r.j.inviteCode?.length, 6, 'code 6 caractères');
    const code = db.prepare('SELECT invite_code FROM tournaments WHERE id=?').get(tid).invite_code;

    // Fiche : le code ne fuite pas ; nom brut stocké (échappé à l'affichage)
    let fiche = await fetch(ctx.url + `/api/v1/tournaments/${tid}`, { headers: H }).then((x) => x.json());
    assert.ok(!('invite_code' in fiche.tournament), 'code absent de la fiche');
    // Privé : 403 anonyme sans code
    r = await fetch(ctx.url + `/api/v1/tournaments/${tid}`);
    assert.equal(r.status, 403);

    // Publication -> validation requise par défaut
    r = await post(`/api/v1/organizer/tournaments/${tid}/publish`);
    assert.equal(r.j.status, 'pending');
    const pend = await fetch(ctx.url + '/api/v1/admin/tournaments/pending', { headers: { Cookie: adm.cookie } }).then((x) => x.json());
    assert.ok(pend.rows.some((t) => t.id === tid), 'file admin');
    // Refus avec motif -> notifié
    await fetch(ctx.url + `/api/v1/admin/tournaments/${tid}/reject`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adm.cookie }, body: JSON.stringify({ reason: 'Nom à revoir.' }) });
    assert.equal(db.prepare('SELECT approval_status FROM tournaments WHERE id=?').get(tid).approval_status, 'rejected');
    // Nouveau brouillon -> approbation
    r = await post('/api/v1/organizer/tournaments', { name: 'Coupe du club', size: 8, startsAt: Date.now() + 72 * 36e5, visibility: 'public' });
    const tid2 = r.j.id;
    await post(`/api/v1/organizer/tournaments/${tid2}/publish`);
    await fetch(ctx.url + `/api/v1/admin/tournaments/${tid2}/approve`, { method: 'POST', headers: { Cookie: adm.cookie } });
    assert.equal(db.prepare(`SELECT status FROM tournaments WHERE id=?`).get(tid2).status, 'open');

    // 8 joueurs, moteur réutilisé jusqu'au vainqueur (F-137)
    const js = await mkUsersDirect(Array.from({ length: 8 }, (_, i) => 'Org2J' + i));
    for (const j of js) {
      const rr = await fetch(ctx.url + `/api/v1/tournaments/${tid2}/join`, { method: 'POST', headers: { Cookie: j.cookie } });
      assert.equal(rr.status, 200);
      await fetch(ctx.url + `/api/v1/tournaments/${tid2}/checkin`, { method: 'POST', headers: { Cookie: j.cookie } });
    }
    buildBracket(db, tid2);
    for (const round of ['R1', 'SF']) {
      for (const m of db.prepare('SELECT * FROM tournament_matches WHERE tournament_id=? AND round=? AND status=?').all(tid2, round, 'ready')) {
        resolveMatch(db, m.id, m.p1_id ?? m.p2_id);
      }
    }
    const fin = db.prepare(`SELECT * FROM tournament_matches WHERE tournament_id=? AND round='F'`).get(tid2);
    const { resolveFinalGame } = await import('../../server/modules/tournaments/routes.js');
    resolveFinalGame(db, fin.id, fin.p1_id);
    resolveFinalGame(db, fin.id, fin.p1_id);
    assert.equal(db.prepare('SELECT status FROM tournaments WHERE id=?').get(tid2).status, 'done');

    // Tableau de bord : inscrits, pointage, lots
    const dash = await fetch(ctx.url + '/api/v1/organizer/tournaments', { headers: H }).then((x) => x.json());
    const row = dash.rows.find((t) => t.id === tid2);
    assert.equal(row.inscrits, 8);
    // Export CSV
    const csv = await fetch(ctx.url + `/api/v1/organizer/tournaments/${tid2}/export.csv`, { headers: H }).then((x) => x.text());
    assert.ok(csv.startsWith('tour;slot;joueur1;joueur2;vainqueur;statut'));
    // Duplication
    r = await post(`/api/v1/organizer/tournaments/${tid2}/duplicate`);
    assert.ok(r.j.id !== tid2);
    // Annulation avant démarrage + isolation : un autre orga ne touche pas
    const [orgB] = await mkUsersDirect(['Org2B']);
    await fetch(ctx.url + `/api/v1/admin/organizers/${orgB.id}/grant`, { method: 'POST', headers: { Cookie: adm.cookie } });
    r = await fetch(ctx.url + `/api/v1/organizer/tournaments/${tid2}/cancel`, { method: 'POST', headers: { Cookie: orgB.cookie } });
    assert.equal(r.status, 404, 'isolation A/B');
    void code;
  } finally {
    await ctx.close();
  }
});
