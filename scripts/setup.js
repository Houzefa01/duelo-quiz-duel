#!/usr/bin/env node
// Mise en route : npm run setup
// Crée .env (secrets générés), crée l'admin, rappelle de sauvegarder REWARD_KEY.
// Options : --force (écrase .env), --admin-user=X, --admin-password=Y, --port=N, --yes
import fs from 'node:fs';
import crypto from 'node:crypto';
import readline from 'node:readline';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(=(.*))?$/);
  return m ? [m[1].replace(/-/g, '_'), m[3] ?? true] : [];
}));
const ask = (q, secret = false) => new Promise((res) => {
  const rl = readline.createInterface({ input: process.stdin, output: secret ? undefined : process.stdout });
  rl.question(q, (a) => { rl.close(); res(a.trim()); });
});
const gen = (n) => crypto.randomBytes(n).toString('hex');

if (fs.existsSync('.env') && !args.force) {
  console.error('.env existe déjà. Relance avec --force pour l’écraser (attention, REWARD_KEY changera).');
  process.exit(1);
}
const adminUser = args.admin_user ?? process.env.ADMIN_USERNAME ?? await ask('Pseudo admin [admin] : ') ?? 'admin';
const adminPw = args.admin_password ?? process.env.ADMIN_PASSWORD ?? (args.yes ? null : await ask('Mot de passe admin (12+ caractères) : ', true));
if (!adminPw || adminPw.length < 12) {
  console.error('Mot de passe admin trop court (12 minimum).');
  process.exit(1);
}
if (['admin', 'password', 'motdepasse', 'duelo', '123456', 'azerty', 'qwerty'].some((w) => adminPw.toLowerCase().includes(w))) {
  console.error('Mot de passe trop courant : il serait refusé en production.');
  process.exit(1);
}
const port = args.port ?? '34567';
const env = [
  `PORT=${port}`,
  `SESSION_SECRET=${gen(48)}`,
  `TZ=${process.env.TZ ?? 'Europe/Paris'}`,
  `ADMIN_USERNAME=${adminUser || 'admin'}`,
  `ADMIN_PASSWORD=${adminPw}`,
  `BASE_URL=http://localhost:${port}`,
  'DB_PATH=./data/duelo.db',
  `REWARD_KEY=${gen(32)}`,
  'AVATAR_DIR=./data/uploads/avatars',
  'REWARD_DIR=./data/uploads/rewards',
  '',
].join('\n');
fs.writeFileSync('.env', env, { mode: 0o600 });
console.log('.env créé (droits 600).');

// Charge le .env minimal puis seed (crée l'admin).
for (const line of env.split('\n')) {
  const i = line.indexOf('=');
  if (i > 0) process.env[line.slice(0, i)] = line.slice(i + 1);
}
process.env.DB_PATH = './data/duelo.db';
const { openDb, getDb } = await import('../server/db/db.js');
openDb('./data/duelo.db');
await import('../server/db/seed/index.js');
const n = getDb().prepare('SELECT COUNT(*) c FROM users WHERE role=?').get('admin').c;
console.log(`Admin « ${adminUser || 'admin'} » prêt (${n} compte(s) admin).`);
console.log('');
console.log('*** RAPPEL : sauvegarde REWARD_KEY hors machine (coffre du responsable).');
console.log('*** Sans elle, les lots chiffrés sont perdus. Elle ne figure dans aucune sauvegarde.');
console.log('Démarrage : npm start  (http://localhost:' + port + ')');
