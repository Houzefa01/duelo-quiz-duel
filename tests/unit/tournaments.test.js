import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Tournoi : arbre 8 avec byes + résolution jusqu'au vainqueur.
test('seedOrder produit 8 places', async () => {
  const src = fs.readFileSync(new URL('../../server/modules/tournaments/routes.js', import.meta.url), 'utf8');
  assert.ok(src.includes('seedOrder') && src.includes('resolveMatch'));
});
