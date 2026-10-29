// P11-5 : audit d'en-têtes/CSP, injections SQL/XSS, rate-limit.
// Usage : node tests/security/check.js  (serveur de test dédié, base jetable)
import fs from 'node:fs';

const PORT = 34591, DB = '/tmp/duelo-p11-sec.db';
for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }
process.env.DB_PATH = DB;
const { openDb } = await import('../../server/db/db.js');
openDb(DB);
await import('../../server/db/seed/index.js');
const { buildApp } = await import('../../server/app.js');
const app = await buildApp({ withLive: false, withJobs: false });
await app.listen({ port: PORT, host: '127.0.0.1' });
const U = `http://127.0.0.1:${PORT}`;
const ok = [];
const check = (name, cond, extra = '') => { ok.push([name, !!cond]); console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra ? ' — ' + extra : '')); };

try {
  // 1. En-têtes + CSP
  const h = await fetch(U + '/').then((r) => r.headers);
  const csp = h.get('content-security-policy') ?? '';
  check('CSP présente sans unsafe-inline', csp.includes("default-src 'self'") && !csp.includes('unsafe-inline'), csp.slice(0, 80));
  check('X-Frame-Options', (h.get('x-frame-options') ?? '').length > 0, h.get('x-frame-options'));
  check('X-Content-Type-Options nosniff', h.get('x-content-type-options') === 'nosniff');
  // Cookie de session : HttpOnly + SameSite
  let r = await fetch(U + '/api/v1/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'SecU', password: 'motdepasse12345', ageOk: true }) });
  const set = r.headers.get('set-cookie') ?? '';
  check('cookie HttpOnly', /httponly/i.test(set), set.slice(0, 60));
  check('cookie SameSite=Lax', /samesite=lax/i.test(set));

  // 2. Injections SQL : doivent être rejetées, tables intactes
  const payloads = [`' OR '1'='1`, `admin'--`, `'; DROP TABLE users--`, `" OR ""="`];
  for (const p of payloads) {
    r = await fetch(U + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: p, password: p }) });
    check(`SQLi login rejeté ${JSON.stringify(p.slice(0, 12))}`, r.status === 400 || r.status === 401 || r.status === 429);
  }
  const { getDb } = await import('../../server/db/db.js');
  const n = getDb().prepare('SELECT COUNT(*) c FROM users').get().c;
  check('table users intacte après SQLi', n >= 1, n + ' utilisateurs');
  r = await fetch(U + '/api/v1/leaderboard?scope=' + encodeURIComponent(`global' OR '1'='1`));
  check('SQLi scope leaderboard sans fuite', r.status === 400 || (await r.json()).scope !== undefined);

  // 3. XSS : pseudo <script> refusé ; question piégée stockée mais neutralisée côté client
  r = await fetch(U + '/api/v1/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: '<script>alert(1)</script>', password: 'motdepasse12345', ageOk: true }) });
  check('pseudo <script> refusé (400)', r.status === 400);
  const login = await fetch(U + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'SecU', password: 'motdepasse12345' }) });
  const ck = login.headers.get('set-cookie').match(/session=([^;]+)/)[0];
  const xss = '<img src=x onerror=alert(1)>';
  r = await fetch(U + '/api/v1/questions', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: ck }, body: JSON.stringify({ text: 'Question test ' + xss + ' avec assez de longueur ?', answers: ['a', 'b', 'c', 'd'], correct: 0, category: 'culture-generale', source: 'sec' }) });
  check('question piégée acceptée en stockage (modération a posteriori)', r.status === 200);
  const pend = await fetch(U + '/api/v1/questions/pending', { headers: { Cookie: ck } }).then((x) => x.json());
  const stored = (pend.rows ?? []).find((q) => q.text.includes('onerror'));
  check('payload retrouvé brut en JSON (contexte non exécutable)', !!stored);
  const clientJs = fs.readFileSync(new URL('../../web/js/app.js', import.meta.url), 'utf8');
  // Règle stricte : dans les templates assignés à innerHTML, toute
  // interpolation ${obj.prop} doit passer par esc(), num() ou encodeURIComponent().
  // (textContent / alert / URL ne sont pas des puits HTML et sont hors scope.)
  const spans = [...clientJs.matchAll(/\.innerHTML\s*=\s*(`(?:[^`\\]|\\.)*`)/g)].map((m) => m[1]);
  const bare = [];
  for (const s of spans) {
    for (const m of s.matchAll(/\$\{([^}]+)\}/g)) {
      const e = m[1].trim();
      if (/[a-z]\.[a-zA-Z]/.test(e) && !/^(esc|num|encodeURIComponent)\(/.test(e) && !/^["']/.test(e)) bare.push(e);
    }
  }
  check('client : interpolations innerHTML toutes neutralisées (esc/num/encode)', bare.length === 0, bare.slice(0, 5).join(', '));

  // 4. Rate-limit : connexion (5/10min) et inscription (3/h/IP)
  for (let i = 0; i < 6; i++) {
    await fetch(U + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'SecU', password: 'mauvais' }) });
  }
  r = await fetch(U + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'SecU', password: 'mauvais' }) });
  check('connexion limitée après 5 essais (429)', r.status === 429, 'statut ' + r.status);
  let blocked = 0;
  for (let i = 0; i < 3; i++) {
    r = await fetch(U + '/api/v1/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'Rl' + i + Date.now() % 100000, password: 'motdepasse12345', ageOk: true }) });
    if (r.status === 429) blocked++;
  }
  check('inscription limitée (429 observé)', blocked >= 1, blocked + ' blocage(s)');
} finally {
  await app.close();
}
const fails = ok.filter(([, c]) => !c);
console.log(`---- ${ok.length - fails.length}/${ok.length} contrôles PASS ----`);
process.exit(fails.length ? 1 : 0);
