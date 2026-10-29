// P15-3 : fabrique une base à restaurer ailleurs (1 lot secret + 1 gagnant + 1 compte réel).
// Usage : REWARD_KEY=<64hex> node tests/p15/source-restore.js  (affiche les identifiants à réutiliser)
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const PORT = 34620, DB = '/tmp/duelo-restore-src.db';
const KEY = process.env.REWARD_KEY;
if (!/^[0-9a-fA-F]{64}$/.test(KEY ?? '')) throw new Error('REWARD_KEY=64hex requis');
for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
process.env.DB_PATH = DB;
process.env.REWARD_KEY = KEY;
const { openDb, getDb } = await import('../../server/db/db.js');
openDb(DB);
await import('../../server/db/seed/index.js');
const db = getDb();
const now = Date.now();
// Compte réel (inscription HTTP possible après restauration).
const { hashPassword, newToken, sha256 } = await import('../../server/modules/auth/password.js');
const uid = db.prepare('INSERT INTO users(username,password_hash,created_at,last_seen_at,elo) VALUES(?,?,?,?,?)').run('RestoU', hashPassword('VraiMotDePasse!99'), now, now, 1200).lastInsertRowid;
// Orga + tournoi + lot secret, joué jusqu'au vainqueur RestoU.
const oid = db.prepare('INSERT INTO users(username,password_hash,role,created_at,last_seen_at) VALUES(?,?,?,?,?)').run('RestoOrg', '!', 'organizer', now, now).lastInsertRowid;
db.prepare('INSERT INTO organizer_profiles(user_id,requires_approval) VALUES(?,0)').run(oid);
const aids = [];
for (let i = 0; i < 7; i++) {
  aids.push(db.prepare('INSERT INTO users(username,password_hash,created_at,last_seen_at,elo) VALUES(?,?,?,?,?)').run('RestoJ' + i, '!', now, now, 1000 + i).lastInsertRowid);
}
const all = [Number(uid), ...aids.map(Number)];
const tid = db.prepare(`INSERT INTO tournaments(name,size,status,starts_at,checkin_at,organizer_id,approval_status) VALUES(?,?,?,?,?,?,?)`).run('Coupe restauration', 8, 'open', now + 36e5, now, oid, 'approved').lastInsertRowid;
for (const id of all) db.prepare('INSERT INTO tournament_players(tournament_id,user_id,seed,checked_in) VALUES(?,?,?,1)').run(tid, id, 1100);
const { buildBracket, resolveMatch, resolveFinalGame } = await import('../../server/modules/tournaments/routes.js');
buildBracket(db, Number(tid));
// RestoU gagne tout (p1 favorisé quand c'est lui, sinon p1 quand même puis on force la finale).
for (const round of ['R1', 'SF']) {
  for (const m of db.prepare('SELECT * FROM tournament_matches WHERE tournament_id=? AND round=? AND status=?').all(tid, round, 'ready')) {
    resolveMatch(db, m.id, (m.p1_id === Number(uid) || m.p2_id === Number(uid)) ? Number(uid) : m.p1_id);
  }
}
let fin = db.prepare(`SELECT * FROM tournament_matches WHERE tournament_id=? AND round='F'`).get(tid);
if (fin.p1_id !== Number(uid) && fin.p2_id !== Number(uid)) throw new Error('RestoU pas en finale, relancer');
// Finale truquée : RestoU gagne 2 manches via update direct puis resolve.
for (let k = 0; k < 2; k++) resolveFinalGame(db, fin.id, Number(uid));
const { seal } = await import('../../server/lib/crypto.js');
const s = seal('CODE-RESTAURATION-OK');
const rid = db.prepare(`INSERT INTO tournament_rewards(tournament_id,rank_from,rank_to,scope,public_label,kind,payload_enc,nonce,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(tid, 1, 1, 'rank', 'Code de test', 'secret', s.payload_enc, s.nonce, now).lastInsertRowid;
const { releaseTournamentRewards } = await import('../../server/modules/rewards/lots.js');
releaseTournamentRewards(db, Number(tid));
const claim = db.prepare('SELECT id FROM reward_claims WHERE user_id=?').get(Number(uid));
console.log(JSON.stringify({ user: 'RestoU', password: 'VraiMotDePasse!99', claimId: claim.id, tournament: Number(tid) }));
