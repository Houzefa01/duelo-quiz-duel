import test from 'node:test';
import assert from 'node:assert/strict';
import { eloDeltas, levelOf } from '../../server/lib/elo.js';

test('Elo : victoire rapporte des points, somme nulle', () => {
  const r = eloDeltas(1000, 1000, 30, 'win');
  assert.equal(r.dA, 12); assert.equal(r.dB, -12);
});
test('Elo : K=40 pour les nouveaux (< 20 parties)', () => {
  const r = eloDeltas(1000, 1000, 5, 'win');
  assert.equal(r.dA, 20);
});
test('Elo : plancher 100', () => {
  const r = eloDeltas(100, 1700, 30, 'loss');
  assert.ok(r.newA >= 100);
});
test('niveau = floor(sqrt(XP/100))+1, max 100', () => {
  assert.equal(levelOf(0), 1); assert.equal(levelOf(100), 2); assert.equal(levelOf(400), 3);
});
