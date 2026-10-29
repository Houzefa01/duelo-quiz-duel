import { RULES } from '../config/rules.js';

// Elo : le score final ne compte pas, seul W/L/D (F-32).
// expected = 1 / (1 + 10^((Rb-Ra)/400)) ; delta = round(K * (score - expected))
export function eloDeltas(ra, rb, gamesA, resultA) {
  const K = gamesA < RULES.elo.kNewGames ? RULES.elo.kNew : RULES.elo.kNormal;
  const expA = 1 / (1 + Math.pow(10, (rb - ra) / 400));
  const expB = 1 - expA;
  const scoreA = resultA === 'win' ? 1 : resultA === 'draw' ? 0.5 : 0;
  const dA = Math.round(K * (scoreA - expA));
  const dB = -dA; // somme nulle (K symétrique simplifié) ; plancher appliqué ci-dessous
  return {
    dA, dB,
    newA: Math.max(RULES.elo.floor, ra + dA),
    newB: Math.max(RULES.elo.floor, rb + dB),
  };
}

export function levelOf(xp) {
  return Math.min(100, Math.floor(Math.sqrt(xp / 100)) + 1);
}
