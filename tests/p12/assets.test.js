// P12 : intégrité des assets téléchargés (sprite, avatars, mascotte, couvertures, licences).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../../', import.meta.url).pathname;
test('sprite : toutes les icônes utilisées existent', () => {
  const sprite = fs.readFileSync(root + 'web/assets/icons.svg', 'utf8');
  const ids = new Set([...sprite.matchAll(/<symbol id="([^"]+)"/g)].map((m) => m[1]));
  assert.ok(ids.size >= 40, ids.size + ' symboles');
  const src = fs.readFileSync(root + 'web/index.html', 'utf8') + fs.readFileSync(root + 'web/js/app.js', 'utf8');
  const used = new Set([...src.matchAll(/icons\.svg#([a-z-]+)/g)].map((m) => m[1]));
  assert.ok(used.size > 0);
  for (const u of used) assert.ok(ids.has(u), 'icône manquante dans le sprite : ' + u);
});
test('avatars/mascotte/covers : fichiers présents, aucun SVG maison', () => {
  const av = fs.readdirSync(root + 'web/assets/avatars').filter((f) => f.endsWith('.svg'));
  assert.equal(av.length, 56);
  for (const f of ['mascotte-accueil', 'mascotte-bonne', 'mascotte-mauvaise', 'mascotte-victoire', 'mascotte-defaite', 'mascotte-coffre']) {
    assert.ok(fs.existsSync(`${root}web/assets/mascotte/${f}.svg`), f);
  }
  assert.equal(fs.readdirSync(root + 'web/assets/covers').filter((f) => f.endsWith('.svg')).length, 6);
  const lic = fs.readFileSync(root + 'docs/LICENCES.md', 'utf8');
  for (const f of [...av, 'mascotte-accueil.svg', 'couv-1.svg']) {
    const short = f.replace(/[0-9]/g, '').replace('.svg', '');
    assert.ok(lic.includes(f) || lic.includes(short) || lic.includes(f.split('.')[0]), 'licence manquante : ' + f);
  }
});
test('aucune couleur en dur dans les CSS', () => {
  for (const f of ['tokens.css', 'base.css', 'fonts.css']) {
    const css = fs.readFileSync(root + 'web/styles/' + f, 'utf8');
    const durs = css.match(/#[0-9a-fA-F]{3,8}/g) ?? [];
    // Seules les déclarations de tokens (fichier tokens.css) peuvent contenir des hex.
    if (f !== 'tokens.css') assert.equal(durs.length, 0, f + ' : ' + durs.slice(0, 3).join(','));
  }
});
