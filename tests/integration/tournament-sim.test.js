// P11-2 : tournoi de 8 de l'inscription au vainqueur, horloge simulée.
// Couvre : inscriptions, pointage, R1 (dont un forfait), demies,
// finale en 3 manches (best-of-3), récompenses versées, badge, arbre public,
// + cas limites : exemptions (tableau 16) et annulation (< 8 pointés).
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, mkUsersDirect } from './helper.js';
import { buildBracket, resolveMatch, resolveFinalGame, roundsFor } from '../../server/modules/tournaments/routes.js';

test('roundsFor : séquences par taille', () => {
  assert.deepEqual(roundsFor(8), ['R1', 'SF', 'F']);
  assert.deepEqual(roundsFor(16), ['R1', 'R2', 'SF', 'F']);
  assert.deepEqual(roundsFor(32), ['R1', 'R2', 'QF', 'SF', 'F']);
});

test('tournoi 8 joueurs : inscription -> vainqueur (forfait, finale BO3, prix)', async () => {
  const ctx = await boot({ port: 34587, db: '/tmp/duelo-p11-tournament.db' });
  // Horloge simulée : cycle de vie compressé (inscriptions -> 20:00 -> fin).
  let T = new Date('2026-04-11T12:00:00+02:00').getTime(); // samedi 12:00
  const realNow = Date.now;
  Date.now = () => T;
  try {
    const { getDb } = await import('../../server/db/db.js');
    const db = getDb();
    const created = await mkUsersDirect(Array.from({ length: 8 }, (_, i) => 'TourJ' + i));
    const users = created.map((u, i) => ({ ...u, elo: 1700 - i * 100 }));
    users.forEach((u) => db.prepare('UPDATE users SET elo=? WHERE id=?').run(u.elo, u.id));
    const startsAt = new Date('2026-04-11T20:00:00+02:00').getTime();
    const tid = db.prepare('INSERT INTO tournaments(name,size,status,starts_at,checkin_at) VALUES(?,?,?,?,?)')
      .run('Tournoi du samedi', 8, 'open', startsAt, startsAt - 15 * 6e4).lastInsertRowid;
    for (const u of users) {
      const r = await fetch(ctx.url + `/api/v1/tournaments/${tid}/join`, { method: 'POST', headers: { Cookie: u.cookie } });
      assert.equal(r.status, 200, 'inscription ' + u.username);
    }
    for (const u of users) {
      await fetch(ctx.url + `/api/v1/tournaments/${tid}/checkin`, { method: 'POST', headers: { Cookie: u.cookie } });
    }
    T = startsAt; // 20:00, coup de sifflet
    const { size } = buildBracket(db, Number(tid));
    assert.equal(size, 8);
    const r1 = db.prepare('SELECT * FROM tournament_matches WHERE tournament_id=? AND round=? ORDER BY slot').all(tid, 'R1');
    assert.equal(r1.length, 4);
    // Têtes de série : le n°1 ne rencontre pas le n°2 au premier tour
    const seeds = r1.flatMap((m) => [m.p1_id, m.p2_id]);
    assert.ok(seeds.includes(users[0].id) && seeds.includes(users[1].id));
    const mTop = r1.find((m) => m.p1_id === users[0].id || m.p2_id === users[0].id);
    const mSecond = r1.find((m) => m.p1_id === users[1].id || m.p2_id === users[1].id);
    assert.ok(mTop.id !== mSecond.id, '1 et 2 séparés au R1');
    // R1 : les favoris passent ; dernier match = forfait de l'absent (p2 absent)
    for (const m of r1.slice(0, 3)) resolveMatch(db, m.id, m.p1_id);
    const last = r1[3];
    resolveMatch(db, last.id, last.p1_id); // forfait de last.p2_id
    // Demies
    const sf = db.prepare('SELECT * FROM tournament_matches WHERE tournament_id=? AND round=? ORDER BY slot').all(tid, 'SF');
    assert.equal(sf.length, 2);
    for (const m of sf) resolveMatch(db, m.id, m.p1_id);
    // Finale best-of-3 : 1-0, 1-1, 2-1
    const fin = db.prepare('SELECT * FROM tournament_matches WHERE tournament_id=? AND round=?').get(tid, 'F');
    assert.ok(fin, 'finale créée');
    assert.equal(fin.best_of, 3);
    resolveFinalGame(db, fin.id, fin.p1_id);
    assert.equal(db.prepare('SELECT status FROM tournament_matches WHERE id=?').get(fin.id).status, 'ready');
    resolveFinalGame(db, fin.id, fin.p2_id);
    resolveFinalGame(db, fin.id, fin.p1_id);
    assert.equal(db.prepare('SELECT status FROM tournament_matches WHERE id=?').get(fin.id).status, 'done');
    const t = db.prepare('SELECT * FROM tournaments WHERE id=?').get(tid);
    assert.equal(t.status, 'done');
    assert.equal(t.winner_id, fin.p1_id);
    // Prix (F-66)
    assert.ok(db.prepare('SELECT coins FROM users WHERE id=?').get(fin.p1_id).coins >= 500, 'vainqueur 500');
    assert.ok(db.prepare('SELECT coins FROM users WHERE id=?').get(fin.p2_id).coins >= 250, 'finaliste 250');
    assert.ok(db.prepare(`SELECT COUNT(*) c FROM reward_ledger WHERE ref_type='tournament' AND ref_id=?`).get(tid).c >= 2, 'ledger tournoi');
    assert.ok(db.prepare(`SELECT b.slug FROM user_badges ub JOIN badges b ON b.id=ub.badge_id WHERE ub.user_id=? AND b.slug='vainqueur-tournoi'`).get(fin.p1_id), 'badge vainqueur');
    // Arbre public sans compte
    const pub = await fetch(ctx.url + `/api/v1/tournaments/${tid}`).then((r) => r.json());
    assert.ok(pub.matches.length >= 7, 'arbre complet : ' + pub.matches.length);
  } finally {
    Date.now = realNow;
    await ctx.close();
  }
});

test('tournoi : exemptions (12 pointés -> tableau 16, byes) et annulation (< 8)', async () => {
  const ctx = await boot({ port: 34588, db: '/tmp/duelo-p11-tournament2.db' });
  try {
    const { getDb } = await import('../../server/db/db.js');
    const db = getDb();
    const users = await mkUsersDirect(Array.from({ length: 12 }, (_, i) => 'ByeJ' + i));
    users.forEach((u, i) => db.prepare('UPDATE users SET elo=? WHERE id=?').run(1500 - i * 10, u.id));
    const now = Date.now();
    const tid = db.prepare('INSERT INTO tournaments(name,size,status,starts_at,checkin_at) VALUES(?,?,?,?,?)')
      .run('T16', 16, 'open', now + 36e5, now).lastInsertRowid;
    users.forEach((u) => db.prepare('INSERT INTO tournament_players(tournament_id,user_id,seed,checked_in) VALUES(?,?,?,1)').run(tid, u.id, 1500));
    const { size } = buildBracket(db, Number(tid));
    assert.equal(size, 16);
    const byes = db.prepare(`SELECT * FROM tournament_matches WHERE tournament_id=? AND round='R1' AND (p1_id IS NULL OR p2_id IS NULL)`).all(tid);
    assert.equal(byes.length, 4, '16 places - 12 joueurs = 4 byes');
    assert.ok(byes.every((b) => b.status === 'done' && b.winner_id), 'byes auto-qualifiés');
    // Annulation sous 8 pointés (F-61)
    const t2 = db.prepare('INSERT INTO tournaments(name,size,status,starts_at,checkin_at) VALUES(?,?,?,?,?)')
      .run('T8annule', 8, 'open', now + 36e5, now).lastInsertRowid;
    users.slice(0, 5).forEach((u) => db.prepare('INSERT INTO tournament_players(tournament_id,user_id,seed,checked_in) VALUES(?,?,?,1)').run(t2, u.id, 1200));
    const r = buildBracket(db, Number(t2));
    assert.equal(r.cancelled, true);
    assert.equal(db.prepare('SELECT status FROM tournaments WHERE id=?').get(t2).status, 'cancelled');
  } finally {
    await ctx.close();
  }
});
