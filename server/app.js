import Fastify from 'fastify';
import fStatic from '@fastify/static';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authRoutes } from './modules/auth/routes.js';
import { userRoutes } from './modules/users/routes.js';
import { friendRoutes } from './modules/friends/routes.js';
import { rankingRoutes } from './modules/ranking/routes.js';
import { rewardRoutes } from './modules/rewards/routes.js';
import { challengeRoutes } from './modules/challenges/routes.js';
import { tournamentRoutes } from './modules/tournaments/routes.js';
import { questionRoutes } from './modules/questions/routes.js';
import { adminRoutes } from './modules/admin/routes.js';
import { avatarRoutes } from './modules/avatars/routes.js';
import { organizerAdminRoutes, organizerTournamentRoutes } from './modules/organizers/routes.js';
import { rewardUploadRoutes, organizerRewardRoutes, myRewardRoutes } from './modules/rewards/lots.js';
import { mountLive } from './realtime/gateway.js';
import { startJobs } from './jobs/scheduler.js';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dir, '..');

// Fabrique testable : mêmes routes que la prod (utilisée par index.js et les tests).
export async function buildApp({ withLive = true, withJobs = true } = {}) {
  const app = Fastify({ logger: false, trustProxy: true });
  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'], fontSrc: ["'self'"], connectSrc: ["'self'", 'ws:', 'wss:'],
        objectSrc: ["'none'"], baseUri: ["'self'"],
      },
    },
  });
  await app.register(rateLimit, { max: Number(process.env.RATE_MAX ?? 300), timeWindow: '1 minute' });
  const { default: multipart } = await import('@fastify/multipart');
  await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024, files: 1 } });
  await app.register(fStatic, { root: path.join(root, 'web'), prefix: '/' });

  // Mode maintenance : tout /api/v1 est fermé sauf admin + health ; les duels
  // en cours se terminent (moteur non touché), aucun nouveau duel ne démarre.
  const { isMaintenance } = await import('./lib/maintenance.js');
  app.addHook('onRequest', (req, reply, done) => {
    if (isMaintenance() && req.url.startsWith('/api/v1/') && !req.url.startsWith('/api/v1/admin/') && req.url !== '/api/v1/meta') {
      reply.code(503).send({ error: 'maintenance', message: 'On revient bientôt.' });
      return;
    }
    done();
  });

  authRoutes(app); userRoutes(app); friendRoutes(app); rankingRoutes(app);
  rewardRoutes(app); challengeRoutes(app); tournamentRoutes(app);
  questionRoutes(app); adminRoutes(app);
  avatarRoutes(app); organizerAdminRoutes(app); organizerTournamentRoutes(app);
  rewardUploadRoutes(app); organizerRewardRoutes(app); myRewardRoutes(app);

  app.get('/healthz', () => ({ ok: true, t: Date.now() }));
  app.get('/admin/sante', (req, reply) => reply.redirect('/#/admin-sante'));
  app.get('/api/v1/meta', async () => {
    const { BRAND } = await import('./config/brand.js');
    return { brand: BRAND };
  });

  if (withLive) mountLive(app);
  if (withJobs) startJobs();
  return app;
}
