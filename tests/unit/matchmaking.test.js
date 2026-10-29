import test from 'node:test';
import assert from 'node:assert/strict';
import { queueJoin, tryMatch, windowFor, resetQueues, ghostDue } from '../../server/modules/matchmaking/queue.js';

test('fenêtre : 100 au départ, +50/5s, max 400', () => {
  assert.equal(windowFor(0), 100);
  assert.equal(windowFor(5000), 150);
  assert.equal(windowFor(60000), 400);
});
test('matchmaking appaire dans la fenêtre', () => {
  resetQueues();
  queueJoin('ranked', 1, 1000); queueJoin('ranked', 2, 1050);
  const m = tryMatch('ranked', 1);
  assert.equal(m.userId, 2);
});
test('pas d’appariement hors fenêtre', () => {
  resetQueues();
  queueJoin('ranked', 1, 1000); queueJoin('ranked', 2, 1500);
  assert.equal(tryMatch('ranked', 1), null);
});
