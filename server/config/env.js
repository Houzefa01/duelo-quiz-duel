import fs from 'node:fs';

// Charge .env minimaliste sans dépendance (zéro coût, pas de dotenv).
// Chemin : racine du projet = deux niveaux au-dessus de server/config/.
export function loadEnv(envPath = new URL('../../.env', import.meta.url)) {
  try {
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#') || !t.includes('=')) continue;
      const i = t.indexOf('=');
      const k = t.slice(0, i).trim();
      if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim();
    }
  } catch { /* .env absent : variables d'environnement seules */ }
}

export const env = {
  get PORT() { return Number(process.env.PORT ?? 34567); },
  get HOST() { return process.env.HOST ?? '127.0.0.1'; }, // prod : localhost seul derrière nginx (P16)
  get SESSION_SECRET() { return process.env.SESSION_SECRET ?? 'dev-secret-change-me-32-chars-minimum!!'; },
  get TZ() { return process.env.TZ ?? 'Europe/Paris'; },
  get ADMIN_USERNAME() { return process.env.ADMIN_USERNAME ?? 'admin'; },
  get ADMIN_PASSWORD() { return process.env.ADMIN_PASSWORD ?? 'admin12345678'; },
  get BASE_URL() { return process.env.BASE_URL ?? 'http://localhost:3000'; },
  get DB_PATH() { return process.env.DB_PATH ?? './data/duelo.db'; },
};
