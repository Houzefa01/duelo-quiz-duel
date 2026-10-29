// Règles de jeu chiffrées — SEULE source de vérité (cf. §8 du cahier des charges).
// Toute logique métier importe RULES depuis ce fichier, jamais de constante en dur ailleurs.
export const RULES = {
  duel: {
    rounds: 10, roundSeconds: 10, finalMultiplier: 2,
    basePoints: 100, speedBonusMax: 100,
    latencyCompMaxMs: 150, reconnectGraceSeconds: 30,
    mix: { easy: 4, medium: 4, hard: 2 }, noRepeatLastN: 50,
  },
  elo: { start: 1000, kNew: 40, kNewGames: 20, kNormal: 24, floor: 100, rankedAfter: 5 },
  matchmaking: { startWindow: 100, widenBy: 50, widenEveryMs: 5000, maxWindow: 400, ghostAfterMs: 20000 },
  xp: { perDuel: 20, perWin: 25, perCorrect: 5, perDuelCorrectCap: 50 },
  coins: { win: 40, draw: 20, loss: 10, perfectBonus: 20, dailyDuelCap: 300 },
  chest: { days: [20, 30, 40, 50, 70, 90, 150], freezeTokensPerWeek: 1 },
  daily: { quests: 3, completeAllBonus: 50, runTopBonus: [100, 60, 30] },
  tournament: {
    sizes: [8, 16, 32], checkinMinutes: 15, matchStartMinutes: 3, finalBestOf: 3,
    prizes: { winner: 500, finalist: 250, semi: 120, participant: 30 },
  },
  friends: { challengeStakes: [10, 20, 50, 100, 200], requestExpiryHours: 24 },
  limits: {
    loginPerIp: 5, registerPerIpHour: 3, questionProposalsPerDay: 5,
    emoteCooldownMs: 2000, wsMaxMessageBytes: 2048,
  },
};

// Ligues visuelles (F-33)
export const LEAGUES = [
  { slug: 'bronze', label: 'Bronze', min: 0, max: 1099, icon: 'league-bronze' },
  { slug: 'argent', label: 'Argent', min: 1100, max: 1299, icon: 'league-argent' },
  { slug: 'or', label: 'Or', min: 1300, max: 1499, icon: 'league-or' },
  { slug: 'platine', label: 'Platine', min: 1500, max: 1699, icon: 'league-platine' },
  { slug: 'diamant', label: 'Diamant', min: 1700, max: 99999, icon: 'league-diamant' },
];

export function leagueOf(elo) {
  return LEAGUES.find((l) => elo >= l.min && elo <= l.max) ?? LEAGUES[0];
}
