// Passerelle temps réel : WebSocket `/live` (contrat §7.5).
// Auth par cookie de session. Messages JSON ≤ 2 Ko, validés (zod).
// Présence F-17 : déconnexion → 30 s de grâce puis forfait ; reconnexion → resync.
import { WebSocketServer } from 'ws';
import { z } from 'zod';
import { getDb } from '../db/db.js';
import { sha256 } from '../modules/auth/password.js';
import { queueJoin, queueLeave, tryMatch, ghostDue, queueWaiting } from '../modules/matchmaking/queue.js';
import { createDuel, startCountdown, submitAnswer, forfeit, active } from '../modules/duels/engine.js';
import { RULES } from '../config/rules.js';

const conns = new Map(); // userId -> Set<ws>
export function sendTo(userId, msg) {
  for (const ws of conns.get(userId) ?? []) {
    if (ws.readyState === 1) ws.send(JSON.stringify(msg));
  }
}
const hooks = { send: sendTo, onEnd: () => {} };
const lastEmote = new Map();
const rematchPending = new Map(); // duelId -> { p1, p2, at }
const timers = []; // intervalles à nettoyer (tests / arrêt propre)
let wssRef = null;

export function closeLive() {
  for (const t of timers) clearInterval(t);
  timers.length = 0;
  if (wssRef) { try { wssRef.close(); } catch {} wssRef = null; }
  for (const [, set] of conns) for (const ws of set) { try { ws.terminate(); } catch {} }
  conns.clear();
}

export function mountLive(server) {
  const wss = new WebSocketServer({ server: server.server, path: '/live' });
  wssRef = wss;
  // Latence (ping/pong) pour compensation (F-13)
  timers.push(setInterval(() => {
    for (const [, set] of conns) for (const ws of set) {
      if (ws.readyState === 1) { ws._pingAt = Date.now(); ws.send(JSON.stringify({ t: 'ping', at: ws._pingAt })); }
    }
  }, 15000));
  // Boucle 1 s : matchmaking + grâce de reconnexion 30 s (F-17) + expiry revanche.
  timers.push(setInterval(() => {
    presenceSweep();
    matchSweep(getDb()).catch((e) => console.error(JSON.stringify({ lvl: 'error', msg: 'sweep', e: String(e) })));
    const now = Date.now();
    for (const [k, r] of rematchPending) {
      if (now - r.at > 30000) { rematchPending.delete(k); sendTo(r.p1, { t: 'rematch.expired', duelId: k }); }
    }
  }, 1000));

  wss.on('connection', (ws, req) => {
    const user = authFromReq(req);
    if (!user) { ws.close(4401, 'non_connecte'); return; }
    if (!conns.has(user.id)) conns.set(user.id, new Set());
    conns.get(user.id).add(ws);
    // Reconnexion en cours de duel : reprend (F-17)
    for (const st of active.values()) {
      if ((st.p1 === user.id || st.p2 === user.id) && st.gone?.[user.id]) {
        delete st.gone[user.id];
        const other = st.p1 === user.id ? st.p2 : st.p1;
        sendTo(other, { t: 'presence.opponent', duelId: st.id, status: 'online' });
        ws.send(JSON.stringify({ t: 'resync', duelId: st.id, round: st.round, scores: { you: st.scores[user.id], opp: st.scores[other] }, status: st.status }));
      }
    }
    ws.on('message', (raw) => {
      if (raw.length > RULES.limits.wsMaxMessageBytes) return;
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      handle(user, ws, m).catch(() => {});
    });
    ws.on('close', () => {
      conns.get(user.id)?.delete(ws);
      if ((conns.get(user.id)?.size ?? 0) === 0) {
        // Dernière connexion fermée : marque l'absence, grâce 30 s (F-17)
        for (const st of active.values()) {
          if (st.p1 === user.id || st.p2 === user.id) {
            st.gone = st.gone ?? {};
            st.gone[user.id] = Date.now();
            const other = st.p1 === user.id ? st.p2 : st.p1;
            sendTo(other, { t: 'presence.opponent', duelId: st.id, status: 'reconnecting' });
          }
        }
      }
    });
  });
}

// Grâce 30 s dépassée → forfait de l'absent, adversaire protégé (F-17).
export function presenceSweep(now = Date.now()) {
  for (const st of [...active.values()]) {
    if (!st.gone) continue;
    for (const pid of [st.p1, st.p2]) {
      if (st.gone[pid] && now - st.gone[pid] > RULES.duel.reconnectGraceSeconds * 1000) {
        forfeit(st, hooks, pid);
        break;
      }
    }
  }
}

function authFromReq(req) {
  try {
    const cookie = (req.headers.cookie ?? '').split(';').map((s) => s.trim()).find((s) => s.startsWith('session='));
    if (!cookie) return null;
    const tok = decodeURIComponent(cookie.slice(8));
    const db = getDb();
    const s = db.prepare('SELECT user_id,expires_at FROM sessions WHERE token_hash=?').get(sha256(tok));
    if (!s || s.expires_at < Date.now()) return null;
    return db.prepare('SELECT * FROM users WHERE id=?').get(s.user_id);
  } catch { return null; }
}

async function handle(user, ws, m) {
  const db = getDb();
  if (m.t === 'pong') {
    const st = [...active.values()].find((s) => s.p1 === user.id || s.p2 === user.id);
    if (st && m.at) st.lat[user.id] = Math.min(RULES.duel.latencyCompMaxMs, (Date.now() - m.at) / 2);
    return;
  }
  if (m.t === 'queue.join') {
    const p = z.object({ mode: z.enum(['ranked', 'friendly', 'training']).default('ranked') }).safeParse(m);
    if (!p.success) return;
    const { isMaintenance } = await import('../lib/maintenance.js');
    if (isMaintenance()) { ws.send(JSON.stringify({ t: 'error', error: 'maintenance' })); return; }
    queueJoin(p.data.mode, user.id, user.elo);
    ws.send(JSON.stringify({ t: 'queue.joined', mode: p.data.mode }));
    return;
  }
  if (m.t === 'queue.leave') { queueLeave(user.id); ws.send(JSON.stringify({ t: 'queue.left' })); return; }
  if (m.t === 'answer') {
    const p = z.object({ duelId: z.number(), round: z.number(), choice: z.number().nullable() }).safeParse(m);
    if (!p.success) return;
    const st = active.get(p.data.duelId);
    if (!st) return;
    submitAnswer(st, hooks, user.id, p.data.round, p.data.choice);
    return;
  }
  if (m.t === 'emote') {
    const p = z.object({ duelId: z.number(), icon: z.string().max(20) }).safeParse(m);
    if (!p.success) return;
    const k = user.id + ':' + p.data.duelId;
    if (Date.now() - (lastEmote.get(k) ?? 0) < RULES.limits.emoteCooldownMs) return; // F-19
    lastEmote.set(k, Date.now());
    const st = active.get(p.data.duelId);
    if (!st) return;
    sendTo(st.p1 === user.id ? st.p2 : st.p1, { t: 'emote', duelId: st.id, icon: p.data.icon });
    return;
  }
  if (m.t === 'forfeit') {
    const st = active.get(m.duelId);
    if (st) forfeit(st, hooks, user.id);
    return;
  }
  // Revanche en un clic, valable 30 s, avec acceptation (F-18).
  if (m.t === 'rematch') {
    const p = z.object({ duelId: z.number(), opponentId: z.number() }).safeParse(m);
    if (!p.success) return;
    rematchPending.set(p.data.duelId, { p1: user.id, p2: p.data.opponentId, at: Date.now() });
    db.prepare('INSERT INTO notifications(user_id,kind,text,action,created_at) VALUES(?,?,?,?,?)')
      .run(p.data.opponentId, 'rematch', `${user.username} propose une revanche.`, JSON.stringify({ duelId: p.data.duelId }), Date.now());
    sendTo(p.data.opponentId, { t: 'rematch.offer', duelId: p.data.duelId, from: user.username });
    ws.send(JSON.stringify({ t: 'rematch.sent', duelId: p.data.duelId }));
    return;
  }
  if (m.t === 'rematch.accept') {
    const pend = rematchPending.get(m.duelId);
    if (!pend || (pend.p1 !== user.id && pend.p2 !== user.id)) return;
    rematchPending.delete(m.duelId);
    const other = pend.p1 === user.id ? pend.p2 : pend.p1;
    const me = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
    const op = db.prepare('SELECT * FROM users WHERE id=?').get(other);
    if (!me || !op) return;
    const { duelId, state, error } = createDuel({ p1: pend.p1, p2: pend.p2, mode: 'ranked', });
    if (error) { sendTo(user.id, { t: 'rematch.denied', reason: error }); return; }
    const { avatarUrlFor } = await import('../modules/avatars/catalog.js');
    for (const [pid, opp] of [[pend.p1, op], [pend.p2, me]]) {
      sendTo(pid, { t: 'match.found', duelId, opponent: { name: opp.username, avatar: opp.avatar, avatarUrl: avatarUrlFor(opp), elo: opp.elo, frame: opp.frame }, ghost: false, rematch: true });
    }
    startCountdown(state, hooks);
    return;
  }
}

async function matchSweep(db) {
  // Maintenance : aucun nouveau duel, ceux en cours se terminent.
  const { isMaintenance } = await import('../lib/maintenance.js');
  if (isMaintenance()) return;
  for (const mode of ['ranked', 'friendly', 'training']) {
    for (const e of queueWaiting(mode)) {
      const other = tryMatch(mode, e.userId);
      if (other) {
        const me = db.prepare('SELECT * FROM users WHERE id=?').get(e.userId);
        const op = db.prepare('SELECT * FROM users WHERE id=?').get(other.userId);
        if (!me || !op) { queueLeave(e.userId); continue; }
        const { duelId, state, error } = createDuel({ p1: e.userId, p2: other.userId, mode });
        if (error) continue;
        const { avatarUrlFor } = await import('../modules/avatars/catalog.js');
        for (const [pid, opp] of [[e.userId, op], [other.userId, me]]) {
          sendTo(pid, { t: 'match.found', duelId, opponent: { name: opp.username, avatar: opp.avatar, avatarUrl: avatarUrlFor(opp), elo: opp.elo, frame: opp.frame }, ghost: false });
        }
        startCountdown(state, hooks);
      } else if (ghostDue(mode, e.userId)) {
        // Duel fantôme : adversaire simulé transparent (F-16)
        queueLeave(e.userId);
        const me = db.prepare('SELECT * FROM users WHERE id=?').get(e.userId);
        if (!me) continue;
        let ghost = db.prepare('SELECT * FROM users WHERE username=?').get('Fantome-' + Math.max(900, Math.min(1500, Math.round(me.elo / 100) * 100)));
        if (!ghost) {
          const gid = db.prepare('INSERT INTO users(username,password_hash,role,elo,created_at,last_seen_at) VALUES(?,?,?,?,?,?)').run('Fantome-' + Math.round(me.elo / 100) * 100, '!', 'ghost', me.elo, Date.now(), Date.now()).lastInsertRowid;
          ghost = db.prepare('SELECT * FROM users WHERE id=?').get(gid);
        }
        const { duelId, state } = createDuel({ p1: e.userId, p2: ghost.id, mode, isGhost: true });
        sendTo(e.userId, { t: 'match.found', duelId, opponent: { name: ghost.username + ' (fantôme)', avatar: 7, elo: ghost.elo, frame: 'base' }, ghost: true });
        startCountdown(state, hooks);
      }
    }
  }
}
