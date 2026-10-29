// Nettoie + vérifie les SVG téléchargés (règle §0.5) :
// svgo puis suppression/vérification de <script>, on*, <foreignObject>,
// références externes et styles inline dangereux.
// Usage : node tools/clean-svg.js
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const DIRS = ['web/assets/avatars', 'web/assets/mascotte', 'web/assets/covers', 'web/assets/icons'];
const ROOT = new URL('..', import.meta.url).pathname;

execSync(`./node_modules/.bin/svgo ${DIRS.join(' ')}`, { cwd: ROOT, stdio: 'inherit' });

const BAD = [
  [/<script/i, '<script>'],
  [/[\s(]on[a-z]+\s*=/i, 'attribut on*'],
  [/foreignobject/i, '<foreignObject>'],
  [/(href|xlink:href)\s*=\s*["']https?:/i, 'lien externe'],
  [/url\(\s*["']?https?:/i, 'url() externe'],
  [/data:text\/html/i, 'data:text/html'],
  [/<iframe/i, '<iframe>'],
  [/javascript:/i, 'javascript:'],
];
let fails = 0, n = 0;
for (const d of DIRS) {
  for (const f of fs.readdirSync(path.join(ROOT, d)).filter((f) => f.endsWith('.svg'))) {
    n++;
    const s = fs.readFileSync(path.join(ROOT, d, f), 'utf8');
    for (const [re, label] of BAD) {
      if (re.test(s)) { console.log(`DANGER ${d}/${f} : ${label}`); fails++; }
    }
    if (!s.includes('<svg')) { console.log(`INVALIDE ${d}/${f}`); fails++; }
  }
}
console.log(`vérifiés: ${n} SVG, problèmes: ${fails}`);
process.exit(fails ? 1 : 0);
