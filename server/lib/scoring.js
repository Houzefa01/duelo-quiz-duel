import { RULES } from '../config/rules.js';

// Points d'une question. t en secondes (0..roundSeconds), doubled pour la Q10.
// Exemples vérifiés par tests : 2s -> 180 ; 9.5s -> 105 ; finale 2s -> 360.
export function scoreAnswer({ correct, tSeconds, doubled = false }) {
  if (!correct) return { points: 0, base: 0, bonus: 0 };
  const t = Math.max(0, Math.min(RULES.duel.roundSeconds, tSeconds));
  const bonus = Math.round(RULES.duel.speedBonusMax * (1 - t / RULES.duel.roundSeconds));
  const base = RULES.duel.basePoints;
  const mult = doubled ? RULES.duel.finalMultiplier : 1;
  return { points: (base + bonus) * mult, base: base * mult, bonus: bonus * mult };
}

// Départage (F-12) : réponse numérique la plus proche gagne ; à défaut le plus rapide.
export function tiebreakWinner(a, b, target) {
  const da = Math.abs(a.numeric - target);
  const db = Math.abs(b.numeric - target);
  if (da !== db) return da < db ? 'a' : 'b';
  return a.timeMs <= b.timeMs ? 'a' : 'b';
}
