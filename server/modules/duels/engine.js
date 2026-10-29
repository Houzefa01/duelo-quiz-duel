import { getDb } from '../../db/db.js';
import { RULES } from '../../config/rules.js';
import { pickQuestions, shuffleForPlayer, recordSeen } from './picker.js';
import { scoreAnswer } from '../../lib/scoring.js';
import { eloDeltas, levelOf } from '../../lib/elo.js';

// Moteur de duel autoritaire (serveur). Les callbacks `send(userId, msg)` et
// `broadcast(duelId, msg)` sont injectés par realtime/gateway.js (testable sans WS).
export const active = new Map(); // duelId -> state

export function createDuel({ p1, p2, mode = 'ranked', isGhost = false, tournamentMatchId = null }) {
  const db = getDb();
  // Verrou un seul duel actif (F-20)
  for (const st of active.values()) {
    if (st.status !== 'finished' && (st.p1 === p1 || st.p1 === p2 || st.p2 === p1 || st.p2 === p2))
      return { error: 'duel_actif' };
  }
  // Anti-farming : >3 duels consécutifs même adversaire / heure → Elo 0 (marqué)
  const recent = db.prepare(`SELECT COUNT(*) c FROM duels WHERE ((player1_id=? AND player2_id=?) OR (player1_id=? AND player2_id=?)) AND started_at>?`).get(p1, p2, p2, p1, Date.now() - 36e5).c;
  const flaggedFarm = recent >= 3;
  const qs = pickQuestions(db, [p1, p2]);
  const now = Date.now();
  const duelId = db.prepare('INSERT INTO duels(mode,status,player1_id,player2_id,is_ghost,tournament_match_id,started_at,flagged) VALUES(?,?,?,?,?,?,?,?)')
    .run(mode, 'matched', p1, p2, isGhost ? 1 : 0, tournamentMatchId, now, flaggedFarm ? 1 : 0).lastInsertRowid;
  recordSeen(db, p1, qs.map((q) => q.id)); recordSeen(db, p2, qs.map((q) => q.id));
  const st = {
    id: Number(duelId), p1, p2, mode, isGhost, status: 'countdown', round: 0,
    questions: qs, shuffles: new Map(), answers: new Map(), scores: { [p1]: 0, [p2]: 0 },
    corrects: { [p1]: 0, [p2]: 0 }, times: { [p1]: 0, [p2]: 0 }, deadline: 0, timer: null,
    reconnectDeadline: null, gone: {}, rematch: {}, lat: {}, flaggedFarm, tournamentMatchId,
  };
  active.set(st.id, st);
  return { duelId: st.id, state: st };
}

// Démarre le compte à rebours puis la Q1. `hooks` = {send, onEnd}
export function startCountdown(st, hooks) {
  st.status = 'countdown';
  hooks.send(st.p1, { t: 'duel.countdown', startsAt: Date.now() + 3000, duelId: st.id });
  hooks.send(st.p2, { t: 'duel.countdown', startsAt: Date.now() + 3000, duelId: st.id });
  setTimeout(() => nextQuestion(st, hooks), 3000);
}

export function nextQuestion(st, hooks) {
  if (st.status === 'finished') return;
  st.round += 1;
  if (st.round > RULES.duel.rounds) return finishDuel(st, hooks);
  const q = st.questions[st.round - 1];
  st.answers.set(st.round, {});
  const doubled = st.round === RULES.duel.rounds;
  // Mélange par joueur (F-11)
  for (const pid of [st.p1, st.p2]) {
    const sh = shuffleForPlayer(q, pid * 31 + st.round * 7 + st.id);
    st.shuffles.set(`${st.round}:${pid}`, sh);
    const cats = getDb().prepare('SELECT slug FROM categories WHERE id=?').get(q.category_id);
    hooks.send(pid, {
      t: 'question.show', duelId: st.id, round: st.round, text: q.text,
      answers: sh.answers, deadline: Date.now() + RULES.duel.roundSeconds * 1000,
      category: cats?.slug ?? '', doubled,
    });
  }
  st.status = 'question';
  st.qStart = Date.now();
  st.deadline = st.qStart + RULES.duel.roundSeconds * 1000;
  clearTimeout(st.timer);
  st.timer = setTimeout(() => reveal(st, hooks), RULES.duel.roundSeconds * 1000 + 200);
  // Fantôme (F-16) : rejoue des réponses simulées de niveau proche
  if (st.isGhost) scheduleGhostAnswer(st, hooks);
}

function scheduleGhostAnswer(st, hooks) {
  const ghost = st.p2; // p2 = fantôme
  const delay = 1500 + Math.random() * 6000;
  setTimeout(() => {
    if (st.status !== 'question') return;
    const roundAns = st.answers.get(st.round) ?? {};
    if (roundAns[ghost]) return;
    const q = st.questions[st.round - 1];
    const sh = st.shuffles.get(`${st.round}:${ghost}`);
    // Probabilité de bonne réponse selon difficulté : 75/55/35 %
    const pOk = q.difficulty === 1 ? 0.75 : q.difficulty === 2 ? 0.55 : 0.35;
    const ok = Math.random() < pOk;
    const choice = ok ? sh.correctIndex : (sh.correctIndex + 1 + Math.floor(Math.random() * 3)) % 4;
    submitAnswer(st, hooks, ghost, st.round, choice, delay);
  }, Math.min(delay, RULES.duel.roundSeconds * 1000 - 300));
}

// t mesuré serveur (F-13), compensation latence plafonnée 150 ms.
export function submitAnswer(st, hooks, userId, round, choice, simulatedDelay = 0) {
  if (st.status !== 'question' || round !== st.round) return { error: 'hors_fenetre' };
  const roundAns = st.answers.get(round);
  if (roundAns[userId]) return { error: 'deja_repondu' };
  if (choice != null && (choice < 0 || choice > 3)) return { error: 'choix_invalide' };
  let tMs = Date.now() - st.qStart;
  const comp = Math.min(RULES.duel.latencyCompMaxMs, st.lat[userId] ?? 0);
  tMs = Math.max(0, tMs - comp);
  if (tMs > RULES.duel.roundSeconds * 1000) return { error: 'hors_fenetre' };
  const sh = st.shuffles.get(`${round}:${userId}`);
  const correct = choice != null && choice === sh.correctIndex;
  // Anti-triche : < 250 ms répétés → marquage (F-82)
  st.fastCount = st.fastCount ?? {};
  if (tMs < 250 && correct) st.fastCount[userId] = (st.fastCount[userId] ?? 0) + 1;
  roundAns[userId] = { choice, correct, tMs };
  const other = userId === st.p1 ? st.p2 : st.p1;
  if (!st.isGhost) hooks.send(other, { t: 'opponent.answered', duelId: st.id, round });
  if (roundAns[st.p1] && (roundAns[st.p2] || st.isGhostGhostDone?.())) { /* noop */ }
  if (roundAns[st.p1] && roundAns[st.p2]) reveal(st, hooks);
  else if (st.isGhost && roundAns[st.p1] && roundAns[st.p2]) reveal(st, hooks);
  return { ok: true };
}

export function reveal(st, hooks) {
  if (st.status !== 'question') return;
  clearTimeout(st.timer);
  st.status = 'reveal';
  const round = st.round;
  const q = st.questions[round - 1];
  const roundAns = st.answers.get(round) ?? {};
  const doubled = round === RULES.duel.rounds;
  const db = getDb();
  const payload = {};
  for (const pid of [st.p1, st.p2]) {
    const a = roundAns[pid] ?? { choice: null, correct: false, tMs: RULES.duel.roundSeconds * 1000 };
    const { points } = scoreAnswer({ correct: !!a.correct, tSeconds: a.tMs / 1000, doubled });
    st.scores[pid] += points;
    if (a.correct) st.corrects[pid] += 1;
    st.times[pid] += a.tMs;
    payload[pid] = { choice: a.choice, points, timeMs: a.tMs, correct: !!a.correct };
    db.prepare('INSERT OR REPLACE INTO duel_answers(duel_id,round,user_id,answer,correct,time_ms,points) VALUES(?,?,?,?,?,?,?)')
      .run(st.id, round, pid, a.choice, a.correct ? 1 : 0, Math.round(a.tMs), points);
    // Stats question (F-74) + recalibrage
    db.prepare('UPDATE questions SET times_asked=times_asked+1,times_correct=times_correct+? WHERE id=?').run(a.correct ? 1 : 0, q.id);
    recalibrate(db, q.id);
  }
  const sh1 = st.shuffles.get(`${round}:${st.p1}`);
  for (const pid of [st.p1, st.p2]) {
    const other = pid === st.p1 ? st.p2 : st.p1;
    hooks.send(pid, {
      t: 'question.reveal', duelId: st.id, round, correct: sh1.correctIndex, // index joueur local recalculé côté client
      yours: payload[pid], theirs: payload[other],
      scores: { you: st.scores[pid], opp: st.scores[other] }, correctText: [q.a, q.b, q.c, q.d][q.correct],
    });
  }
  setTimeout(() => nextQuestion(st, hooks), 2600);
}

function recalibrate(db, qid) {
  const q = db.prepare('SELECT times_asked,times_correct,difficulty FROM questions WHERE id=?').get(qid);
  if (!q || q.times_asked < 30) return;
  const rate = q.times_correct / q.times_asked;
  let d = q.difficulty;
  if (rate > 0.8 && d > 1) d -= 1; else if (rate < 0.35 && d < 3) d += 1; else return;
  db.prepare('UPDATE questions SET difficulty=? WHERE id=?').run(d, qid);
}

export function finishDuel(st, hooks) {
  st.status = 'finished'; clearTimeout(st.timer);
  const db = getDb();
  const s1 = st.scores[st.p1], s2 = st.scores[st.p2];
  let result = s1 === s2 ? 'draw' : s1 > s2 ? 'p1' : 'p2';
  const u1 = db.prepare('SELECT * FROM users WHERE id=?').get(st.p1);
  const u2 = db.prepare('SELECT * FROM users WHERE id=?').get(st.p2);
  // Égalité parfaite → départage simplifié : le plus rapide gagne (F-12)
  if (result === 'draw' && st.mode !== 'training') {
    result = st.times[st.p1] <= st.times[st.p2] ? 'p1' : 'p2';
  }
  const winnerId = result === 'draw' ? null : result === 'p1' ? st.p1 : st.p2;
  // Elo (F-32) sauf amical/entraînement/fantôme non classé
  let d1 = 0, d2 = 0, newElo1 = u1.elo, newElo2 = u2.elo;
  const ranked = st.mode === 'ranked' && !st.isGhost && !st.flaggedFarm && (st.fastCount?.[st.p1] ?? 0) < 5 && (st.fastCount?.[st.p2] ?? 0) < 5;
  if (ranked) {
    const r = eloDeltas(u1.elo, u2.elo, u1.elo_games, result === 'draw' ? 'draw' : result === 'p1' ? 'win' : 'loss');
    d1 = r.dA; d2 = r.dB; newElo1 = r.newA; newElo2 = r.newB;
  }
  const perfect1 = st.corrects[st.p1] === RULES.duel.rounds, perfect2 = st.corrects[st.p2] === RULES.duel.rounds;
  db.transaction(() => {
    db.prepare('UPDATE duels SET status=?,score1=?,score2=?,winner_id=?,elo_delta1=?,elo_delta2=?,ended_at=? WHERE id=?')
      .run('finished', s1, s2, winnerId, d1, d2, Date.now(), st.id);
    if (ranked) {
      db.prepare('UPDATE users SET elo=?,elo_games=elo_games+1 WHERE id=?').run(newElo1, st.p1);
      db.prepare('UPDATE users SET elo=?,elo_games=elo_games+1 WHERE id=?').run(newElo2, st.p2);
    }
    // Récompenses via module rewards (import dynamique pour éviter cycle)
    grant(st, db, winnerId, perfect1, perfect2);
  })();
  for (const pid of [st.p1, st.p2]) {
    const other = pid === st.p1 ? st.p2 : st.p1;
    hooks.send(pid, {
      t: 'duel.end', duelId: st.id,
      winner: winnerId, scores: { you: st.scores[pid], opp: st.scores[other] },
      eloDelta: pid === st.p1 ? d1 : d2, rewards: st.rewards?.[pid] ?? null,
    });
  }
  active.delete(st.id);
  hooks.onEnd?.(st);
}

// Récompenses + XP + défis + badges (F-40..F-45, F-54) — appelé dans la transaction.
function grant(st, db, winnerId, perfect1, perfect2) {
  const now = Date.now();
  st.rewards = {};
  for (const pid of [st.p1, st.p2]) {
    const won = winnerId === pid, draw = winnerId === null;
    const nCorrect = st.corrects[pid];
    const xp = RULES.xp.perDuel + (won ? RULES.xp.perWin : 0) + Math.min(RULES.xp.perDuelCorrectCap, nCorrect * RULES.xp.perCorrect);
    let coins = won ? RULES.coins.win : draw ? RULES.coins.draw : RULES.coins.loss;
    if (nCorrect === RULES.duel.rounds) coins += RULES.coins.perfectBonus;
    if (st.mode !== 'ranked') coins = Math.floor(coins / 2); // amical/entraînement réduits (F-15)
    // Plafond journalier (F-41)
    const u = db.prepare('SELECT coins_day,coins_day_amount FROM users WHERE id=?').get(pid);
    const dk = new Date().toISOString().slice(0, 10);
    let granted = coins;
    if (u.coins_day !== dk) { db.prepare('UPDATE users SET coins_day=?,coins_day_amount=? WHERE id=?').run(dk, 0, pid); }
    const used = u.coins_day === dk ? u.coins_day_amount : 0;
    granted = Math.max(0, Math.min(coins, RULES.coins.dailyDuelCap - used));
    const newXp = db.prepare('SELECT xp FROM users WHERE id=?').get(pid).xp + xp;
    db.prepare('UPDATE users SET xp=?,level=?,coins=coins+?,coins_day_amount=coins_day_amount+? WHERE id=?')
      .run(newXp, levelOf(newXp), granted, granted, pid);
    db.prepare('INSERT INTO reward_ledger(user_id,kind,amount_coins,amount_xp,ref_type,ref_id,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(pid, 'duel', granted, xp, 'duel', st.id, now);
    st.rewards[pid] = { xp, coins: granted };
  }
}

export function forfeit(st, hooks, userId) {
  if (st.status === 'finished') return;
  const other = userId === st.p1 ? st.p2 : st.p1;
  st.scores[other] = Math.max(st.scores[other], st.scores[userId]);
  finishForfeit(st, hooks, other);
}
function finishForfeit(st, hooks, winnerId) {
  // Forfait : scores figés, gagnant = présent, récompense complète (F-17), pas d'Elo.
  const db = getDb();
  st.status = 'finished'; clearTimeout(st.timer);
  const coins = st.mode === 'ranked' ? RULES.coins.win : Math.floor(RULES.coins.win / 2);
  const xp = RULES.xp.perDuel + RULES.xp.perWin;
  db.transaction(() => {
    db.prepare('UPDATE duels SET status=?,score1=?,score2=?,winner_id=?,ended_at=? WHERE id=?')
      .run('finished', st.scores[st.p1], st.scores[st.p2], winnerId, Date.now(), st.id);
    const ux = db.prepare('SELECT xp FROM users WHERE id=?').get(winnerId);
    db.prepare('UPDATE users SET xp=?,level=?,coins=coins+? WHERE id=?').run(ux.xp + xp, levelOf(ux.xp + xp), coins, winnerId);
    db.prepare('INSERT INTO reward_ledger(user_id,kind,amount_coins,amount_xp,ref_type,ref_id,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(winnerId, 'duel-forfeit', coins, xp, 'duel', st.id, Date.now());
  })();
  for (const pid of [st.p1, st.p2]) hooks.send(pid, { t: 'duel.end', duelId: st.id, winner: winnerId, forfeit: true, scores: { you: st.scores[pid], opp: st.scores[pid === st.p1 ? st.p2 : st.p1] } });
  active.delete(st.id);
  hooks.onEnd?.(st);
}
