// axe-core sur 6 écrans x 2 thèmes (P13-5). Serveur attendu sur CAPTURE_URL.
// Usage : node tools/axe-p13.js
import { chromium } from '/home/Hsavatra/.npm-global/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs';
const axeSrc = fs.readFileSync('/home/Hsavatra/duelo/tools/.axe/node_modules/axe-core/axe.min.js', 'utf8');

const BASE = process.env.CAPTURE_URL ?? 'http://127.0.0.1:34592/';
const screens = [['accueil', '#/'], ['connexion', '#/connexion'], ['classement', '#/classement'], ['tournois', '#/tournois'], ['defis', '#/defis'], ['avatar', '#/avatar']];
const browser = await chromium.launch({
  executablePath: '/home/Hsavatra/.cache/puppeteer/chrome/linux-154.0.8037.57/chrome-linux64/chrome',
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--force-prefers-reduced-motion'],
});
let total = 0;
const rapport = [];
for (const theme of ['light', 'dark']) {
  for (const [name, hash] of screens) {
    const context = await browser.newContext({ viewport: { width: 360, height: 800 } });
    await context.addInitScript((t) => localStorage.setItem('duelo-theme', t), theme);
    const page = await context.newPage();
    await page.goto(BASE + hash, { waitUntil: 'networkidle0', timeout: 30000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1200));
    await page.evaluate(axeSrc);
    const res = await page.evaluate(async () => axe.run({ resultTypes: ['violations'] }));
    const label = `${name}-360-${theme}`;
    if (res.violations.length) {
      console.log(`--- ${label} : ${res.violations.length} violation(s) ---`);
      for (const v of res.violations) {
        console.log(`  [${v.impact}] ${v.id} : ${v.help} (${v.nodes.length} nœud(s))`);
        for (const n of v.nodes.slice(0, 3)) console.log('    cible: ' + n.target.join(' ') + ' | ' + (n.html ?? '').slice(0, 120));
      }
    } else console.log(`OK ${label}`);
    rapport.push({ ecran: label, violations: res.violations.map((v) => ({ id: v.id, impact: v.impact, aide: v.help, cibles: v.nodes.flatMap((n) => n.target).slice(0, 5) })) });
    total += res.violations.length;
    await context.close();
  }
}
await browser.close();
fs.writeFileSync('/home/Hsavatra/duelo/docs/AXE-P13.json', JSON.stringify(rapport, null, 1));
console.log(`TOTAL violations: ${total}`);
process.exit(0);
