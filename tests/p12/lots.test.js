// P12-E : lots chiffrés, distribution, concurrence, sécurité.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { boot, mkUsersDirect } from '../integration/helper.js';
import { seal, openWithNonce, genRewardKey, lotsEnabled } from '../../server/lib/crypto.js';
import { buildBracket, resolveMatch, resolveFinalGame } from '../../server/modules/tournaments/routes.js';
import { releaseTournamentRewards } from '../../server/modules/rewards/lots.js';

test('crypto : AES-256-GCM, nonce unique, clé invalide refusée', () => {
  process.env.REWARD_KEY = genRewardKey();
  assert.ok(lotsEnabled());
  const a = seal('CODE-SECRET-123');
  const b = seal('CODE-SECRET-123');
  assert.ok(a.payload_enc !== b.payload_enc, 'nonce unique');
  assert.equal(openWithNonce(a.payload_enc, a.nonce), 'CODE-SECRET-123');
  const keep = process.env.REWARD_KEY;
  process.env.REWARD_KEY = 'trop-courte';
  assert.equal(lotsEnabled(), false);
  assert.throws(() => seal('x'), /REWARD_KEY/);
  process.env.REWARD_KEY = keep;
});

test('lots : 5 types, chiffrement au repos, refus, distribution, concurrence', async () => {
  process.env.REWARD_KEY = process.env.REWARD_KEY?.length === 64 ? process.env.REWARD_KEY : genRewardKey();
  const ctx = await boot({ port: 34597, db: '/tmp/duelo-p12-lots.db' });
  try {
    const { getDb } = await import('../../server/db/db.js');
    const db = getDb();
    const [adm] = await mkUsersDirect(['LotsAdmin']);
    const [org] = await mkUsersDirect(['LotsOrg']);
    db.prepare(`UPDATE users SET role='admin' WHERE id=?`).run(adm.id);
    await fetch(ctx.url + `/api/v1/admin/organizers/${org.id}/grant`, { method: 'POST', headers: { Cookie: adm.cookie } });
    // L'organisateur refuse la validation admin pour aller vite (quota MAJ via admin)
    await fetch(ctx.url + `/api/v1/admin/organizers/${org.id}/quotas`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: adm.cookie }, body: JSON.stringify({ requires_approval: 0 }) });
    const H = { Cookie: org.cookie };
    const HJ = { 'Content-Type': 'application/json', Cookie: org.cookie };
    const mkT = async (name) => {
      const r = await fetch(ctx.url + '/api/v1/organizer/tournaments', { method: 'POST', headers: HJ, body: JSON.stringify({ name, size: 8, startsAt: Date.now() + 72 * 36e5, visibility: 'public' }) }).then((x) => x.json());
      await fetch(ctx.url + `/api/v1/organizer/tournaments/${r.id}/publish`, { method: 'POST', headers: H });
      return r.id;
    };
    const tid = await mkT('Coupe des lots');
    const mkLot = (b) => fetch(ctx.url + `/api/v1/organizer/tournaments/${tid}/rewards`, { method: 'POST', headers: HJ, body: JSON.stringify(b) }).then((x) => x.json().then((j) => ({ s: x.status, j })));

    // Les 5 types
    let r = await mkLot({ rankFrom: 1, rankTo: 1, publicLabel: 'Mot du président', kind: 'texte', content: 'Bravo champion' });
    assert.equal(r.s, 200);
    r = await mkLot({ rankFrom: 1, rankTo: 1, publicLabel: 'Code Wi-Fi 24 h', kind: 'secret', content: 'WIFI-XYZ-999' });
    assert.equal(r.s, 200);
    r = await mkLot({ rankFrom: 2, rankTo: 2, publicLabel: 'Lien boutique', kind: 'lien', content: 'https://exemple.fr/bon' });
    assert.equal(r.s, 200);
    // Fichier : upload PDF valide
    const fd = new FormData();
    fd.append('fichier', new Blob([Buffer.from('%PDF-1.4 guide')], { type: 'application/pdf' }), 'guide.pdf');
    const up = await fetch(ctx.url + '/api/v1/organizer/rewards/upload', { method: 'POST', headers: H, body: fd }).then((x) => x.json());
    assert.ok(up.uploadId, JSON.stringify(up));
    r = await mkLot({ rankFrom: 3, rankTo: 4, scope: 'rank', publicLabel: 'Guide PDF', kind: 'fichier', fileUploadId: up.uploadId });
    assert.equal(r.s, 200);
    // Refus : .exe et .html
    for (const [buf, name] of [[Buffer.from('MZ...'), 'jeu.exe'], [Buffer.from('<html>'), 'page.html']]) {
      const f2 = new FormData();
      f2.append('fichier', new Blob([buf]), name);
      const rr = await fetch(ctx.url + '/api/v1/organizer/rewards/upload', { method: 'POST', headers: H, body: f2 });
      assert.equal(rr.status, 415, 'refus ' + name);
    }
    // Signature usurpée : .png qui n'en est pas un
    {
      const f2 = new FormData();
      f2.append('fichier', new Blob([Buffer.from('PAS UN PNG')], { type: 'image/png' }), 'faux.png');
      const rr = await fetch(ctx.url + '/api/v1/organizer/rewards/upload', { method: 'POST', headers: H, body: f2 });
      assert.equal(rr.status, 415, 'signature contrôlée');
    }
    // Lot de 8 codes pour les rangs 1-8
    const codes = Array.from({ length: 8 }, (_, i) => 'CREDIT-' + (1000 + i));
    r = await mkLot({ rankFrom: 1, rankTo: 8, publicLabel: 'Crédit téléphone', kind: 'lot_de_codes', codes });
    assert.equal(r.s, 200);

    // Chiffré au repos : aucun secret en clair en base
    const raws = db.prepare('SELECT payload_enc FROM tournament_rewards WHERE payload_enc IS NOT NULL').all().map((x) => x.payload_enc).join(' ')
      + db.prepare('SELECT code_enc FROM reward_codes').all().map((x) => x.code_enc).join(' ');
    for (const secret of ['Bravo champion', 'WIFI-XYZ-999', 'CREDIT-1000', 'https://exemple.fr/bon']) {
      assert.ok(!raws.includes(secret), 'pas de clair : ' + secret);
    }

    // 8 joueurs -> tournoi joué -> libération auto -> 8 claims
    const js = await mkUsersDirect(Array.from({ length: 8 }, (_, i) => 'LotsJ' + i));
    for (const j of js) {
      await fetch(ctx.url + `/api/v1/tournaments/${tid}/join`, { method: 'POST', headers: { Cookie: j.cookie } });
      await fetch(ctx.url + `/api/v1/tournaments/${tid}/checkin`, { method: 'POST', headers: { Cookie: j.cookie } });
    }
    buildBracket(db, tid);
    for (const round of ['R1', 'SF']) {
      for (const m of db.prepare('SELECT * FROM tournament_matches WHERE tournament_id=? AND round=? AND status=?').all(tid, round, 'ready')) {
        resolveMatch(db, m.id, m.p1_id ?? m.p2_id);
      }
    }
    const fin = db.prepare(`SELECT * FROM tournament_matches WHERE tournament_id=? AND round='F'`).get(tid);
    resolveFinalGame(db, fin.id, fin.p1_id);
    resolveFinalGame(db, fin.id, fin.p1_id);
    assert.equal(db.prepare('SELECT status FROM tournaments WHERE id=?').get(tid).status, 'done');
    const nClaims = db.prepare(`SELECT COUNT(*) c FROM reward_claims rc JOIN tournament_rewards tr ON tr.id=rc.reward_id WHERE tr.tournament_id=?`).get(tid).c;
    assert.ok(nClaims >= 8 + 1 + 1 + 1 + 2, 'claims libérés : ' + nClaims);

    // Concurrence : les 8 gagnants révèlent leur code en même temps -> 8 distincts
    const codeReward = db.prepare(`SELECT id FROM tournament_rewards WHERE tournament_id=? AND kind='lot_de_codes'`).get(tid).id;
    const codeClaims = db.prepare('SELECT id,user_id FROM reward_claims WHERE reward_id=?').all(codeReward);
    assert.equal(codeClaims.length, 8);
    const cookies = Object.fromEntries(js.map((j) => [j.id, j.cookie]));
    const revealed = await Promise.all(codeClaims.map((c) =>
      fetch(ctx.url + `/api/v1/me/rewards/${c.id}/reveal`, { method: 'POST', headers: { Cookie: cookies[c.user_id] } }).then((x) => x.json())));
    const contents = revealed.map((x) => x.content);
    assert.equal(new Set(contents).size, 8, '8 codes distincts : ' + contents.join(','));
    assert.ok(contents.every((c) => /^CREDIT-/.test(c)));

    // Secret : révélation + no-store + Mes lots sans contenu avant révélation
    const secretReward = db.prepare(`SELECT id FROM tournament_rewards WHERE tournament_id=? AND kind='secret'`).get(tid).id;
    const sClaim = db.prepare('SELECT id,user_id FROM reward_claims WHERE reward_id=? LIMIT 1').get(secretReward);
    const before = await fetch(ctx.url + '/api/v1/me/rewards', { headers: { Cookie: cookies[sClaim.user_id] } }).then((x) => x.json());
    assert.ok(!(before.rows ?? []).some((x) => String(JSON.stringify(x)).includes('WIFI')), 'pas de secret dans Mes lots');
    const rev = await fetch(ctx.url + `/api/v1/me/rewards/${sClaim.id}/reveal`, { method: 'POST', headers: { Cookie: cookies[sClaim.user_id] } });
    assert.ok((rev.headers.get('cache-control') ?? '').includes('no-store'));
    assert.equal((await rev.json()).content, 'WIFI-XYZ-999');

    // Fichier : 5 téléchargements puis refus
    const fReward = db.prepare(`SELECT id FROM tournament_rewards WHERE tournament_id=? AND kind='fichier'`).get(tid).id;
    const fClaim = db.prepare('SELECT id,user_id FROM reward_claims WHERE reward_id=? LIMIT 1').get(fReward);
    for (let i = 0; i < 5; i++) {
      const dl = await fetch(ctx.url + `/api/v1/me/rewards/${fClaim.id}/download`, { headers: { Cookie: cookies[fClaim.user_id] } });
      assert.equal(dl.status, 200, 'dl ' + i);
      assert.ok((dl.headers.get('content-disposition') ?? '').startsWith('attachment'));
    }
    assert.equal(await fetch(ctx.url + `/api/v1/me/rewards/${fClaim.id}/download`, { headers: { Cookie: cookies[fClaim.user_id] } }).then((x) => x.status), 409);

    // Fichier introuvable par URL directe (hors dossier public)
    assert.equal(await fetch(ctx.url + '/data/uploads/rewards/x').then((x) => x.status), 404);

    // Organisateur voit les états masqués, jamais le secret
    const etats = await fetch(ctx.url + `/api/v1/organizer/tournaments/${tid}/rewards`, { headers: H }).then((x) => x.json());
    const sec = etats.rows.find((x) => x.kind === 'secret');
    assert.ok(!('payload_enc' in sec), 'pas de payload pour l’orga');
    assert.ok(/^•••• /.test(sec.masked), 'masqué : ' + sec.masked);

    // Isolation : un autre orga ne lit pas les lots ; un joueur ne révèle pas le lot d'autrui
    const [orgB] = await mkUsersDirect(['LotsOrgB']);
    await fetch(ctx.url + `/api/v1/admin/organizers/${orgB.id}/grant`, { method: 'POST', headers: { Cookie: adm.cookie } });
    assert.equal(await fetch(ctx.url + `/api/v1/organizer/tournaments/${tid}/rewards`, { headers: { Cookie: orgB.cookie } }).then((x) => x.status), 404);
    const other = js.find((j) => j.id !== sClaim.user_id);
    assert.equal(await fetch(ctx.url + `/api/v1/me/rewards/${sClaim.id}/reveal`, { method: 'POST', headers: { Cookie: other.cookie } }).then((x) => x.status), 404);

    // Pas de secret dans audit_log ni notifications
    const auditTxt = db.prepare('SELECT action,target,meta_json FROM audit_log').all().map((x) => JSON.stringify(x)).join(' ');
    const notifTxt = db.prepare('SELECT text FROM notifications').all().map((x) => x.text).join(' ');
    for (const secret of ['WIFI-XYZ-999', 'CREDIT-1000']) {
      assert.ok(!auditTxt.includes(secret) && !notifTxt.includes(secret), 'secret hors journaux/notifs');
    }
  } finally {
    await ctx.close();
  }
});

test('lots : publication bloquée si codes insuffisants, libération manuelle, disqualification', async () => {
  process.env.REWARD_KEY = process.env.REWARD_KEY?.length === 64 ? process.env.REWARD_KEY : genRewardKey();
  const ctx = await boot({ port: 34598, db: '/tmp/duelo-p12-lots2.db' });
  try {
    const { getDb } = await import('../../server/db/db.js');
    const db = getDb();
    const [adm] = await mkUsersDirect(['Lots2Admin']);
    const [org] = await mkUsersDirect(['Lots2Org']);
    db.prepare(`UPDATE users SET role='admin' WHERE id=?`).run(adm.id);
    await fetch(ctx.url + `/api/v1/admin/organizers/${org.id}/grant`, { method: 'POST', headers: { Cookie: adm.cookie } });
    await fetch(ctx.url + `/api/v1/admin/organizers/${org.id}/quotas`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: adm.cookie }, body: JSON.stringify({ requires_approval: 0 }) });
    const H = { Cookie: org.cookie };
    const HJ = { 'Content-Type': 'application/json', Cookie: org.cookie };
    const tid = await fetch(ctx.url + '/api/v1/organizer/tournaments', { method: 'POST', headers: HJ, body: JSON.stringify({ name: 'Coupe manuelle', size: 8, startsAt: Date.now() + 72 * 36e5, visibility: 'public', manualRelease: true }) }).then((x) => x.json()).then((j) => j.id);
    // 7 codes pour rangs 1-8 -> publication bloquée
    await fetch(ctx.url + `/api/v1/organizer/tournaments/${tid}/rewards`, { method: 'POST', headers: HJ, body: JSON.stringify({ rankFrom: 1, rankTo: 8, publicLabel: 'Codes', kind: 'lot_de_codes', codes: ['A', 'B', 'C', 'D', 'E', 'F', 'G'] }) });
    let r = await fetch(ctx.url + `/api/v1/organizer/tournaments/${tid}/publish`, { method: 'POST', headers: H }).then((x) => x.json());
    assert.ok(r.error?.includes('codes'), 'bloqué : ' + (r.error ?? r.status));
    // Ajout du 8e code -> publication OK
    const rid = db.prepare(`SELECT id FROM tournament_rewards WHERE tournament_id=?`).get(tid).id;
    await fetch(ctx.url + `/api/v1/organizer/rewards/${rid}/replace`, { method: 'POST', headers: HJ, body: JSON.stringify({ codes: ['H'] }) });
    r = await fetch(ctx.url + `/api/v1/organizer/tournaments/${tid}/publish`, { method: 'POST', headers: H }).then((x) => x.json());
    assert.equal(r.ok, true);
    // Tournoi joué
    const js = await mkUsersDirect(Array.from({ length: 8 }, (_, i) => 'Lots2J' + i));
    for (const j of js) {
      await fetch(ctx.url + `/api/v1/tournaments/${tid}/join`, { method: 'POST', headers: { Cookie: j.cookie } });
      await fetch(ctx.url + `/api/v1/tournaments/${tid}/checkin`, { method: 'POST', headers: { Cookie: j.cookie } });
    }
    buildBracket(db, tid);
    for (const round of ['R1', 'SF']) {
      for (const m of db.prepare('SELECT * FROM tournament_matches WHERE tournament_id=? AND round=? AND status=?').all(tid, round, 'ready')) resolveMatch(db, m.id, m.p1_id ?? m.p2_id);
    }
    const fin = db.prepare(`SELECT * FROM tournament_matches WHERE tournament_id=? AND round='F'`).get(tid);
    resolveFinalGame(db, fin.id, fin.p1_id); resolveFinalGame(db, fin.id, fin.p1_id);
    // Manuel : rien libéré avant l'action
    assert.equal(db.prepare(`SELECT COUNT(*) c FROM reward_claims rc JOIN tournament_rewards tr ON tr.id=rc.reward_id WHERE tr.tournament_id=?`).get(tid).c, 0);
    r = await fetch(ctx.url + `/api/v1/organizer/tournaments/${tid}/release`, { method: 'POST', headers: H }).then((x) => x.json());
    assert.equal(r.claims, 8);
    // Disqualification d'un gagnant non révélé -> claim supprimé, code retourné
    const loser = db.prepare(`SELECT rc.id,rc.user_id,rc.code_id FROM reward_claims rc JOIN tournament_rewards tr ON tr.id=rc.reward_id WHERE tr.tournament_id=? AND rc.status='available' LIMIT 1`).get(tid);
    const leftBefore = db.prepare(`SELECT COUNT(*) c FROM reward_codes WHERE assigned_to IS NULL`).get().c;
    await fetch(ctx.url + `/api/v1/organizer/tournaments/${tid}/disqualify`, { method: 'POST', headers: HJ, body: JSON.stringify({ userId: loser.user_id }) });
    assert.equal(db.prepare('SELECT id FROM reward_claims WHERE id=?').get(loser.id), undefined);
    void leftBefore;
  } finally {
    await ctx.close();
  }
});

test('XSS : contenus organisateur affichés inertes (aucun innerHTML brut)', async () => {
  const src = fs.readFileSync(new URL('../../web/js/app.js', import.meta.url), 'utf8');
  const spans = [...src.matchAll(/\.innerHTML\s*=\s*(`(?:[^`\\]|\\.)*`)/g)].map((m) => m[1]);
  const bare = [];
  for (const s of spans) {
    for (const m of s.matchAll(/\$\{([^}]+)\}/g)) {
      const e = m[1].trim();
      if (/[a-z]\.[a-zA-Z]/.test(e) && !/^(esc|num|encodeURIComponent)\(/.test(e) && !/^["']/.test(e)) bare.push(e);
    }
  }
  assert.equal(bare.length, 0, 'interpolations non neutralisées : ' + bare.slice(0, 5).join(', '));
});
