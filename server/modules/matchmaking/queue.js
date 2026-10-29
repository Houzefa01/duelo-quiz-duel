import { RULES } from '../../config/rules.js';

// File d'attente par mode. Fenêtre ±100, +50/5s jusqu'à ±400 (F-16).
// Retourne paires [a,b] à appairer.
const queues = new Map(); // mode -> [{userId, elo, at}]
export function queueJoin(mode, userId, elo) {
  if (!queues.has(mode)) queues.set(mode, []);
  const q = queues.get(mode);
  if (!q.find((e) => e.userId === userId)) q.push({ userId, elo, at: Date.now() });
}
export function queueLeave(userId) {
  for (const q of queues.values()) { const i = q.findIndex((e) => e.userId === userId); if (i >= 0) q.splice(i, 1); }
}
export function queueWaiting(mode) { return [...(queues.get(mode) ?? [])]; }
export function windowFor(waitMs) {
  return Math.min(RULES.matchmaking.maxWindow, RULES.matchmaking.startWindow + Math.floor(waitMs / RULES.matchmaking.widenEveryMs) * RULES.matchmaking.widenBy);
}
// Essaie d'apparier un joueur ; retourne l'adversaire ou null.
export function tryMatch(mode, userId) {
  const q = queues.get(mode) ?? [];
  const me = q.find((e) => e.userId === userId);
  if (!me) return null;
  const w = windowFor(Date.now() - me.at);
  // Anti-farming : on évite le même adversaire 3x/heure — géré au niveau duel (compteur), ici simple filtre Elo.
  const cands = q.filter((e) => e.userId !== userId && Math.abs(e.elo - me.elo) <= w)
    .sort((a, b) => Math.abs(a.elo - me.elo) - Math.abs(b.elo - me.elo));
  if (!cands.length) return null;
  const other = cands[0];
  queueLeave(userId); queueLeave(other.userId);
  return other;
}
export function ghostDue(mode, userId) {
  const q = (queues.get(mode) ?? []).find((e) => e.userId === userId);
  return q ? (Date.now() - q.at) >= RULES.matchmaking.ghostAfterMs : false;
}
export function resetQueues() { queues.clear(); }
