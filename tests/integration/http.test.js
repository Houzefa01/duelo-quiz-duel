// P11-3/5 : parcours HTTP complet (récompenses, défis, questions, admin, amis...).
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, mkUsersDirect } from './helper.js';

const J = (r) => r.json();

test('parcours HTTP : coffre, boutique, défis, run, amis, questions, admin', async () => {
  const ctx = await boot({ port: 34589, db: '/tmp/duelo-p11-http.db' });
  try {
    const { getDb } = await import('../../server/db/db.js');
    const db = getDb();
    const [h1, h2] = await mkUsersDirect(['HttpA', 'HttpB']);
    const [adm] = await mkUsersDirect(['HttpAdmin']);
    db.prepare(`UPDATE users SET role='admin' WHERE id=?`).run(adm.id);

    // Coffre : 1er OK, 2e refusé
    let r = await fetch(ctx.url + '/api/v1/chest/claim', { method: 'POST', headers: { Cookie: h1.cookie } }).then(J);
    assert.ok(r.coins > 0 && r.streak >= 1);
    r = await fetch(ctx.url + '/api/v1/chest/claim', { method: 'POST', headers: { Cookie: h1.cookie } });
    assert.equal(r.status, 409);

    // Boutique : sans pièces -> 402 ; avec pièces -> achat
    r = await fetch(ctx.url + '/api/v1/shop/buy', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: h2.cookie }, body: JSON.stringify({ slug: 'cadre-argent' }) });
    assert.equal(r.status, 402);
    db.prepare('UPDATE users SET coins=500 WHERE id=?').run(h2.id);
    r = await fetch(ctx.url + '/api/v1/shop/buy', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: h2.cookie }, body: JSON.stringify({ slug: 'cadre-argent' }) }).then(J);
    assert.equal(r.ok, true);
    assert.equal(db.prepare('SELECT frame FROM users WHERE id=?').get(h2.id).frame, 'cadre-argent');

    // Défis : liste + progression forcée + réclamation
    const ch = await fetch(ctx.url + '/api/v1/challenges', { headers: { Cookie: h1.cookie } }).then(J);
    assert.equal(ch.daily.length, 3);
    const first = ch.daily[0];
    const { dayKey } = await import('../../server/lib/time.js');
    db.prepare(`UPDATE user_challenges SET progress=? WHERE user_id=? AND challenge_id=? AND period_key=?`).run(999,
      h1.id, first.id, first.scope === 'daily' ? dayKey() : 'x');
    // (si la ligne n'existe pas encore, on l'insère)
    if (db.prepare('SELECT changes() c').get().c === 0) {
      const period = first.scope === 'daily' ? (await import('../../server/lib/time.js')).dayKey() : (await import('../../server/lib/time.js')).weekKey();
      db.prepare('INSERT OR IGNORE INTO user_challenges(user_id,challenge_id,period_key,progress) VALUES(?,?,?,?)').run(h1.id, first.id, period, 999);
    }
    r = await fetch(ctx.url + `/api/v1/challenges/${first.id}/claim`, { method: 'POST', headers: { Cookie: h1.cookie } }).then(J);
    assert.equal(r.ok, true);
    r = await fetch(ctx.url + `/api/v1/challenges/${first.id}/claim`, { method: 'POST', headers: { Cookie: h1.cookie } });
    assert.equal(r.status, 409);

    // Défi du jour : start -> 10 questions -> answer -> rejouer refusé
    const start = await fetch(ctx.url + '/api/v1/daily-run/start', { method: 'POST', headers: { Cookie: h1.cookie } }).then(J);
    assert.equal(start.questions.length, 10);
    const ans = await fetch(ctx.url + '/api/v1/daily-run/answer', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: h1.cookie }, body: JSON.stringify({ answers: start.questions.map(() => 0), totalTimeMs: 60000 }) }).then(J);
    assert.ok(typeof ans.score === 'number');
    r = await fetch(ctx.url + '/api/v1/daily-run/start', { method: 'POST', headers: { Cookie: h1.cookie } });
    assert.equal(r.status, 409);

    // Défi d'ami avec mise : création, acceptation
    db.prepare('UPDATE users SET coins=200 WHERE id IN (?,?)').run(h1.id, h2.id);
    r = await fetch(ctx.url + '/api/v1/friend-challenges', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: h1.cookie }, body: JSON.stringify({ username: 'HttpB', stake: 50 }) }).then(J);
    assert.equal(r.ok, true);
    const fc = db.prepare('SELECT * FROM friend_challenges ORDER BY id DESC LIMIT 1').get();
    r = await fetch(ctx.url + `/api/v1/friend-challenges/${fc.id}/accept`, { method: 'POST', headers: { Cookie: h2.cookie } }).then(J);
    assert.equal(r.ok, true);
    // Mise invalide refusée
    r = await fetch(ctx.url + '/api/v1/friend-challenges', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: h1.cookie }, body: JSON.stringify({ username: 'HttpB', stake: 33 }) });
    assert.equal(r.status, 400);

    // Amis : demande + acceptation + liste + blocage
    await fetch(ctx.url + '/api/v1/friends/request', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: h1.cookie }, body: JSON.stringify({ username: 'HttpB' }) });
    r = await fetch(ctx.url + '/api/v1/friends/accept', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: h2.cookie }, body: JSON.stringify({ username: 'HttpA' }) }).then(J);
    assert.equal(r.ok, true);
    const fl = await fetch(ctx.url + '/api/v1/friends', { headers: { Cookie: h1.cookie } }).then(J);
    assert.ok(fl.rows.some((x) => x.username === 'HttpB' && x.status === 'accepted'));
    const lbF = await fetch(ctx.url + '/api/v1/leaderboard?scope=friends', { headers: { Cookie: h1.cookie } }).then(J);
    assert.ok(lbF.rows.length >= 2);
    r = await fetch(ctx.url + '/api/v1/leaderboard?scope=friends');
    assert.equal(r.status, 401);

    // Questions : proposition OK / mot interdit / vote / signalement
    const qbody = { text: 'Quelle ville est la capitale de la France dans ce test ?', answers: ['Paris', 'Lyon', 'Nice', 'Nantes'], correct: 0, category: 'geographie', source: 'test' };
    const q = await fetch(ctx.url + '/api/v1/questions', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: h1.cookie }, body: JSON.stringify(qbody) }).then(J);
    assert.ok(q.id);
    r = await fetch(ctx.url + '/api/v1/questions', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: h1.cookie }, body: JSON.stringify({ ...qbody, text: 'Une vraie merde de question ?' }) });
    assert.equal(r.status, 400);
    // Vote : 5 joueurs niveau 10 -> live + auteur payé
    const voters = await mkUsersDirect(['V1', 'V2', 'V3', 'V4', 'V5']);
    voters.forEach((v) => db.prepare('UPDATE users SET level=10 WHERE id=?').run(v.id));
    for (const v of voters) {
      await fetch(ctx.url + `/api/v1/questions/${q.id}/vote`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: v.cookie }, body: JSON.stringify({ vote: 'good' }) });
    }
    assert.equal(db.prepare('SELECT status FROM questions WHERE id=?').get(q.id).status, 'live');
    // Signalement x3 -> revue
    const q2 = await fetch(ctx.url + '/api/v1/questions', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: h2.cookie }, body: JSON.stringify({ ...qbody, text: 'Question douteuse numéro deux pour test ?' }) }).then(J);
    for (const v of voters.slice(0, 3)) {
      await fetch(ctx.url + `/api/v1/questions/${q2.id}/report`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: v.cookie }, body: JSON.stringify({ reason: 'ambigue' }) });
    }
    assert.equal(db.prepare('SELECT status FROM questions WHERE id=?').get(q2.id).status, 'review');

    // Profil / patch / export / historique
    r = await fetch(ctx.url + '/api/v1/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: h1.cookie }, body: JSON.stringify({ avatar: 5 }) }).then(J);
    assert.equal(r.ok, true);
    const pub = await fetch(ctx.url + '/api/v1/users/HttpA').then(J);
    assert.equal(pub.username, 'HttpA');
    assert.ok(!('email' in pub) || pub.email === undefined, 'pas de données privées');

    // Admin : métriques, modération, sanction, audit (+ 403 pour non-admin)
    r = await fetch(ctx.url + '/api/v1/admin/metrics', { headers: { Cookie: h1.cookie } });
    assert.equal(r.status, 403);
    const met = await fetch(ctx.url + '/api/v1/admin/metrics', { headers: { Cookie: adm.cookie } }).then(J);
    assert.ok(met.users >= 3 && typeof met.memMB === 'number');
    const mod = await fetch(ctx.url + '/api/v1/admin/moderation', { headers: { Cookie: adm.cookie } }).then(J);
    assert.ok(Array.isArray(mod.queue));
    r = await fetch(ctx.url + '/api/v1/admin/sanction', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adm.cookie }, body: JSON.stringify({ username: 'HttpB', action: 'warn' }) }).then(J);
    assert.equal(r.ok, true);
    const audit = await fetch(ctx.url + '/api/v1/admin/audit', { headers: { Cookie: adm.cookie } }).then(J);
    assert.ok(audit.rows.length >= 1);

    // Coffre : gel de série + jour 7 (badge)
    const [g1, g2] = await mkUsersDirect(['GelU', 'SeptU']);
    const { dayKey: dk } = await import('../../server/lib/time.js');
    const yest = dk(new Date(Date.now() - 864e5));
    const avant = dk(new Date(Date.now() - 2 * 864e5));
    db.prepare(`UPDATE users SET last_chest_day=?,streak_days=3,freeze_tokens=1 WHERE id=?`).run(avant, g1.id);
    r = await fetch(ctx.url + '/api/v1/chest/claim', { method: 'POST', headers: { Cookie: g1.cookie } }).then(J);
    assert.equal(r.ok, true);
    assert.equal(db.prepare('SELECT freeze_tokens FROM users WHERE id=?').get(g1.id).freeze_tokens, 0, 'gel consommé');
    db.prepare(`UPDATE users SET last_chest_day=?,streak_days=6 WHERE id=?`).run(yest, g2.id);
    r = await fetch(ctx.url + '/api/v1/chest/claim', { method: 'POST', headers: { Cookie: g2.cookie } }).then(J);
    assert.equal(r.streak, 7);
    assert.ok(db.prepare(`SELECT b.slug FROM user_badges ub JOIN badges b ON b.id=ub.badge_id WHERE ub.user_id=? AND b.slug='coffre-7'`).get(g2.id), 'badge coffre-7');
    // Boutique : 404 + 400
    r = await fetch(ctx.url + '/api/v1/shop/buy', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: h2.cookie }, body: JSON.stringify({ slug: 'inexistant' }) });
    assert.equal(r.status, 404);
    r = await fetch(ctx.url + '/api/v1/shop/buy', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: h2.cookie }, body: JSON.stringify({}) });
    assert.equal(r.status, 400);

    // Récupération par code de secours
    const reg = await fetch(ctx.url + '/api/v1/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'RecupU', password: 'motdepasse12345', ageOk: true }) }).then(J);
    assert.ok(reg.recoveryCodes.length === 8);
    r = await fetch(ctx.url + '/api/v1/auth/recover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'RecupU', code: reg.recoveryCodes[0], newPassword: 'nouveaumotdepasse1' }) }).then(J);
    assert.equal(r.ok, true);
    r = await fetch(ctx.url + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'RecupU', password: 'nouveaumotdepasse1' }) });
    assert.equal(r.status, 200);
  } finally {
    await ctx.close();
  }
});
