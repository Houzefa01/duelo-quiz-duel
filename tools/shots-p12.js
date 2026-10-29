// Captures P12 : 6 écrans x 3 largeurs x 2 thèmes = 36 PNG dans docs/captures-p12/.
// Usage : node tools/shots-p12.js  (serveur attendu sur PORT/CAPTURE_PORT)
import { chromium } from '/home/Hsavatra/.npm-global/lib/node_modules/playwright/index.mjs';

const BASE = process.env.CAPTURE_URL ?? 'http://127.0.0.1:34592/';
const OUT = new URL('../docs/captures-p12/', import.meta.url).pathname;
const { default: fs } = await import('node:fs');
fs.mkdirSync(OUT, { recursive: true });

const screens = [
  ['accueil', '#/'], ['connexion', '#/connexion'], ['classement', '#/classement'],
  ['tournois', '#/tournois'], ['defis', '#/defis'], ['avatar', '#/avatar'],
];
const widths = [360, 768, 1280];
const themes = ['light', 'dark'];

const browser = await chromium.launch({
  executablePath: '/home/Hsavatra/.cache/puppeteer/chrome/linux-154.0.8037.57/chrome-linux64/chrome',
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
});
for (const theme of themes) {
  for (const w of widths) {
    const context = await browser.newContext({ viewport: { width: w, height: 800 } });
    await context.addInitScript((t) => localStorage.setItem('duelo-theme', t), theme);
    const page = await context.newPage();
    for (const [name, hash] of screens) {
      await page.goto(BASE + hash, { waitUntil: 'networkidle0', timeout: 30000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 1200));
      await page.screenshot({ path: `${OUT}${name}-${w}-${theme}.png` });
      console.log(`${name}-${w}-${theme}.png`);
    }
    await page.close();
    await context.close();
  }
}
await browser.close();
console.log('36 captures OK');
