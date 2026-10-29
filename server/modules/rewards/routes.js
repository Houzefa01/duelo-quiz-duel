import { z } from 'zod';
import { getDb } from '../../db/db.js';
import { requireAuth } from '../auth/session.js';
import { RULES } from '../../config/rules.js';
import { dayKey } from '../../lib/time.js';

// Coffre quotidien, boutique, badges (F-42..F-45).
export function rewardRoutes(app) {
  // Coffre quotidien (F-42) : série 7 jours, gel 1/semaine
  app.post('/api/v1/chest/claim', (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const db = getDb();
    const today = dayKey();
    if (u.last_chest_day === today) return reply.code(409).send({ error: 'Coffre déjà réclamé. Reviens demain.' });
    const y = dayKey(new Date(Date.now() - 864e5));
    let streak = 1;
    if (u.last_chest_day === y) streak = (u.streak_days % 7) + 1;
    else if (u.last_chest_day && u.last_chest_day !== y) {
      // Absence tolérée si gel disponible
      if (u.freeze_tokens > 0) { db.prepare('UPDATE users SET freeze_tokens=freeze_tokens-1 WHERE id=?').run(u.id); streak = (u.streak_days % 7) + 1; }
      else streak = 1;
    }
    const amount = RULES.chest.days[Math.min(streak, 7) - 1] ?? 20;
    const now = Date.now();
    db.transaction(() => {
      db.prepare('UPDATE users SET coins=coins+?,last_chest_day=?,streak_days=? WHERE id=?').run(amount, today, streak, u.id);
      db.prepare('INSERT INTO reward_ledger(user_id,kind,amount_coins,amount_xp,created_at) VALUES(?,?,?,?,?)').run(u.id, 'chest', amount, 5, now);
      if (streak === 7) grantBadge(db, u.id, 'coffre-7');
    })();
    return { ok: true, coins: amount, streak };
  });

  app.get('/api/v1/shop', () => {
    return { rows: getDb().prepare('SELECT * FROM cosmetics').all() };
  });
  // Boutique cosmétique, pièces uniquement (F-44)
  app.post('/api/v1/shop/buy', (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const p = z.object({ slug: z.string() }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'donnees_invalides' });
    const db = getDb();
    const c = db.prepare('SELECT * FROM cosmetics WHERE slug=?').get(p.data.slug);
    if (!c) return reply.code(404).send({ error: 'Objet introuvable.' });
    if (u.coins < c.price) return reply.code(402).send({ error: 'Pas assez de pièces. Joue des duels pour en gagner.' });
    db.transaction(() => {
      db.prepare('UPDATE users SET coins=coins-? WHERE id=?').run(c.price, u.id);
      db.prepare('INSERT OR IGNORE INTO user_cosmetics(user_id,cosmetic_id,acquired_at) VALUES(?,?,?)').run(u.id, c.id, Date.now());
      if (c.type === 'frame') db.prepare('UPDATE users SET frame=? WHERE id=?').run(c.slug, u.id);
      if (c.type === 'title') db.prepare('UPDATE users SET title=? WHERE id=?').run(c.label, u.id);
    })();
    return { ok: true };
  });
}

export function grantBadge(db, userId, slug) {
  const b = db.prepare('SELECT id FROM badges WHERE slug=?').get(slug);
  if (!b) return false;
  try {
    db.prepare('INSERT INTO user_badges(user_id,badge_id,earned_at) VALUES(?,?,?)').run(userId, b.id, Date.now());
    db.prepare('INSERT INTO notifications(user_id,kind,text,created_at) VALUES(?,?,?,?)').run(userId, 'badge', `Badge débloqué : ${slug}`, Date.now());
    return true;
  } catch { return false; }
}
