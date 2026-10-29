// Capture des popups dans les deux thèmes (preuve visuelle P12).
import { chromium } from '/home/Hsavatra/.npm-global/lib/node_modules/playwright/index.mjs';
const browser = await chromium.launch({
  executablePath: '/home/Hsavatra/.cache/puppeteer/chrome/linux-154.0.8037.57/chrome-linux64/chrome',
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
});
for (const theme of ['light', 'dark']) {
  const context = await browser.newContext({ viewport: { width: 360, height: 800 } });
  await context.addInitScript((t) => localStorage.setItem('duelo-theme', t), theme);
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:34592/#/', { waitUntil: 'networkidle0', timeout: 30000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1000));
  await page.evaluate(() => { void window.__duelo.modale({ titre: 'Abandonner ce duel ?', texte: 'Ton adversaire gagnera par forfait.', humeur: 'mauvaise', boutons: [{ id: 'non', label: 'Non' }, { id: 'oui', label: 'Oui', classe: 'principal' }] }); });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: `/home/Hsavatra/duelo/docs/captures-p12/popup-360-${theme}.png` });
  console.log(`popup-360-${theme}.png`);
  await context.close();
}
await browser.close();
