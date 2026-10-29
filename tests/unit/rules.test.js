import test from 'node:test';
import assert from 'node:assert/strict';
import { RULES } from '../../server/config/rules.js';

test('règles : coffre 7 jours, plafond pièces, finale x2', () => {
  assert.equal(RULES.chest.days.length, 7);
  assert.equal(RULES.coins.dailyDuelCap, 300);
  assert.equal(RULES.duel.finalMultiplier, 2);
  assert.equal(RULES.duel.rounds, 10);
});
test('tournoi : tailles 8/16/32, finale best-of-3', () => {
  assert.deepEqual(RULES.tournament.sizes, [8, 16, 32]);
  assert.equal(RULES.tournament.finalBestOf, 3);
});
