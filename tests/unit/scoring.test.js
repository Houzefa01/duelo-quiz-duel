import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreAnswer, tiebreakWinner } from '../../server/lib/scoring.js';

// F-12 : valeurs calculées à la main.
test('bonne réponse en 2 s => 100 + 80 = 180', () => {
  assert.equal(scoreAnswer({ correct: true, tSeconds: 2 }).points, 180);
});
test('bonne réponse en 9.5 s => 100 + 5 = 105', () => {
  assert.equal(scoreAnswer({ correct: true, tSeconds: 9.5 }).points, 105);
});
test('finale doublée en 2 s => 360', () => {
  assert.equal(scoreAnswer({ correct: true, tSeconds: 2, doubled: true }).points, 360);
});
test('mauvaise réponse => 0', () => {
  assert.equal(scoreAnswer({ correct: false, tSeconds: 1 }).points, 0);
});
test('départage : le plus proche gagne, sinon le plus rapide', () => {
  assert.equal(tiebreakWinner({ numeric: 42, timeMs: 5000 }, { numeric: 50, timeMs: 1000 }, 40), 'a');
  assert.equal(tiebreakWinner({ numeric: 45, timeMs: 5000 }, { numeric: 35, timeMs: 1000 }, 40), 'b');
});
