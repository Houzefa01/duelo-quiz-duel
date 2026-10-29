import { loadEnv, env } from './config/env.js';
import { openDb, getDb } from './db/db.js';
import { logger } from './lib/logger.js';
import { buildApp } from './app.js';

loadEnv();

// Vérifie le port libre avant d'écouter (demande explicite).
async function portFree(port) {
  const net = await import('node:net');
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, () => s.close(() => resolve(true)));
  });
}

const PORT = env.PORT;
if (!(await portFree(PORT))) {
  console.error(`Port ${PORT} occupé. Change PORT dans .env (ex : 34568) puis relance.`);
  process.exit(1);
}

// Garde-fous production : aucun compte par défaut, aucun secret faible (prouvé en P14).
if (process.env.NODE_ENV === 'production') {
  const pw = process.env.ADMIN_PASSWORD ?? '';
  const faibles = ['admin', 'password', 'motdepasse', 'duelo', '123456', 'azerty', 'qwerty'];
  const faible = pw.length < 12 || faibles.some((w) => pw.toLowerCase().includes(w))
    || pw.toLowerCase() === String(process.env.ADMIN_USERNAME ?? 'admin').toLowerCase();
  if (!pw || faible) {
    console.error('REFUS DE DÉMARRAGE (production) : ADMIN_PASSWORD absent ou faible (12 caractères minimum, ni identique au login ni mot courant).');
    process.exit(1);
  }
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32 || /change-moi|change-me/i.test(process.env.SESSION_SECRET)) {
    console.error('REFUS DE DÉMARRAGE (production) : SESSION_SECRET absent ou valeur d’exemple.');
    process.exit(1);
  }
}

openDb(process.env.DB_PATH ?? './data/duelo.db');
// Seed/migration à chaque démarrage (idempotent : ne reconstruit que si version obsolète).
await import('./db/seed/index.js');

// Lots chiffrés : refuse de démarrer si des secrets existent sans clé valide (§5.6).
{
  const { lotsEnabled } = await import('./lib/crypto.js');
  if (!lotsEnabled()) {
    const n = getDb().prepare(`SELECT COUNT(*) c FROM tournament_rewards WHERE payload_enc IS NOT NULL`).get().c
      + getDb().prepare(`SELECT COUNT(*) c FROM reward_codes`).get().c;
    if (n > 0) {
      console.error('REFUS DE DÉMARRAGE : des lots chiffrés existent mais REWARD_KEY est absente ou invalide. Renseigne REWARD_KEY (64 hex) dans .env.');
      process.exit(1);
    }
    logger.info({}, 'lots désactivés (REWARD_KEY absente) : création/révélation indisponibles');
  }
}

const app = await buildApp({ withLive: true, withJobs: true });

// Arrêt propre (F-§11) : duels en cours annulés sans pénalité.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => {
    logger.info({}, 'arret ' + sig);
    const { active } = await import('./modules/duels/engine.js');
    for (const st of active.values()) {
      getDb().prepare(`UPDATE duels SET status='cancelled' WHERE id=?`).run(st.id);
    }
    const { fermePool } = await import('./lib/imgpool.js');
    await fermePool();
    await app.close();
    process.exit(0);
  });
}

await app.listen({ port: PORT, host: env.HOST });
logger.info({ port: PORT, host: env.HOST }, `Duelo en ligne sur ${env.HOST}:${PORT}`);
