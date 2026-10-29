import { getDb } from '../../db/db.js';
import { RULES } from '../../config/rules.js';

// Tire 10 questions équilibrées (4/4/2), sans doublon des 50 dernières vues (F-10).
export function pickQuestions(db, userIds) {
  const placeholders = userIds.map(() => '?').join(',');
  const seen = new Set(db.prepare(`SELECT question_id FROM duel_seen WHERE user_id IN (${placeholders}) ORDER BY seen_at DESC LIMIT ${RULES.duel.noRepeatLastN * userIds.length}`).all(...userIds).map((r) => r.question_id));
  const out = [];
  for (const [diff, want] of [[1, RULES.duel.mix.easy], [2, RULES.duel.mix.medium], [3, RULES.duel.mix.hard]]) {
    const pool = db.prepare('SELECT * FROM questions WHERE difficulty=? AND status=? ORDER BY RANDOM() LIMIT 60').all(diff, 'live');
    const fresh = pool.filter((q) => !seen.has(q.id));
    const take = (fresh.length >= want ? fresh : pool).slice(0, want);
    out.push(...take);
  }
  // Mélange final
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[out[i], out[j]] = [out[j], out[i]]; }
  return out.slice(0, RULES.duel.rounds);
}

// Mélange les réponses par joueur (F-11) : retourne {answers[4], correctIndex}
export function shuffleForPlayer(q, seedN) {
  const arr = [q.a, q.b, q.c, q.d];
  const good = [q.a, q.b, q.c, q.d][q.correct];
  let s = seedN;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1));[arr[i], arr[j]] = [arr[j], arr[i]]; }
  return { answers: arr, correctIndex: arr.indexOf(good) };
}

export function recordSeen(db, userId, qids) {
  const now = Date.now();
  const ins = db.prepare('INSERT OR REPLACE INTO duel_seen(user_id,question_id,seen_at) VALUES(?,?,?)');
  const del = db.prepare('DELETE FROM duel_seen WHERE user_id=? AND question_id NOT IN (SELECT question_id FROM duel_seen WHERE user_id=? ORDER BY seen_at DESC LIMIT 60)');
  for (const q of qids) ins.run(userId, q, now);
  try { del.run(userId, userId); } catch { /* petite base : ignore */ }
}
