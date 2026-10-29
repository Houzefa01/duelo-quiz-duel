import { z } from 'zod';
import { getDb } from '../../db/db.js';
import { requireAuth } from '../auth/session.js';
import { hitRate } from '../../lib/rateLimit.js';

// Proposition, vote, signalement (F-72..F-73).
const BANNED_WORDS = ['putain', 'merde', 'connard', 'salope', 'hitler', 'nazi'];
export function questionRoutes(app) {
  app.post('/api/v1/questions', (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    if (!hitRate('qprop:' + u.id, 5, 864e5).allowed) return reply.code(429).send({ error: 'Limite : 5 propositions par jour.' });
    const p = z.object({
      text: z.string().min(12).max(300), answers: z.array(z.string().min(1).max(120)).length(4),
      correct: z.number().int().min(0).max(3), category: z.string(), source: z.string().min(2).max(200),
    }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'donnees_invalides' });
    if (BANNED_WORDS.some((w) => (p.data.text + p.data.answers.join(' ')).toLowerCase().includes(w)))
      return reply.code(400).send({ error: 'Contenu refusé. Reformule ta question.' });
    const db = getDb();
    const cat = db.prepare('SELECT id FROM categories WHERE slug=?').get(p.data.category);
    if (!cat) return reply.code(400).send({ error: 'Catégorie inconnue.' });
    const dup = db.prepare('SELECT id FROM questions WHERE text LIKE ? LIMIT 1').get(p.data.text.slice(0, 30) + '%');
    if (dup) return reply.code(409).send({ error: 'Question très proche déjà existante.' });
    const id = db.prepare('INSERT INTO questions(category_id,difficulty,text,a,b,c,d,correct,source,verified,status,author_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(cat.id, 2, p.data.text, p.data.answers[0], p.data.answers[1], p.data.answers[2], p.data.answers[3], p.data.correct, p.data.source, 0, 'pending', u.id, Date.now()).lastInsertRowid;
    return { id: Number(id), message: 'Question envoyée en validation communautaire.' };
  });
  // Vote communautaire niveau ≥ 10 (F-72) : 5 « bonne » → ajout, 3 « signalée » → retrait.
  app.post('/api/v1/questions/:id/vote', (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    if (u.level < 10) return reply.code(403).send({ error: 'Vote réservé au niveau 10 et plus.' });
    const p = z.object({ vote: z.enum(['good', 'bad']) }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'donnees_invalides' });
    const db = getDb();
    const qid = Number(req.params.id);
    db.prepare('INSERT OR REPLACE INTO question_votes(question_id,user_id,vote,created_at) VALUES(?,?,?,?)').run(qid, u.id, p.data.vote, Date.now());
    const good = db.prepare('SELECT COUNT(*) c FROM question_votes WHERE question_id=? AND vote=?').get(qid, 'good').c;
    const bad = db.prepare('SELECT COUNT(*) c FROM question_votes WHERE question_id=? AND vote=?').get(qid, 'bad').c;
    if (good >= 5) {
      db.prepare(`UPDATE questions SET status='live',verified=1 WHERE id=?`).run(qid);
      const q = db.prepare('SELECT author_id FROM questions WHERE id=?').get(qid);
      if (q?.author_id) { db.prepare('UPDATE users SET coins=coins+20 WHERE id=?').run(q.author_id); }
    }
    if (bad >= 3) db.prepare(`UPDATE questions SET status='review' WHERE id=?`).run(qid);
    return { ok: true, good, bad };
  });
  app.post('/api/v1/questions/:id/report', (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const p = z.object({ reason: z.enum(['erronee', 'ambigue', 'offensante']) }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'donnees_invalides' });
    const db = getDb();
    db.prepare('INSERT INTO question_reports(question_id,user_id,reason,created_at) VALUES(?,?,?,?)').run(Number(req.params.id), u.id, p.data.reason, Date.now());
    const n = db.prepare('SELECT COUNT(*) c FROM question_reports WHERE question_id=? AND handled=0').get(Number(req.params.id)).c;
    if (n >= 3) db.prepare('UPDATE questions SET status=? WHERE id=?').run('review', Number(req.params.id)); // F-73
    return { ok: true };
  });
  app.get('/api/v1/questions/pending', (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    return { rows: getDb().prepare(`SELECT q.*,c.slug cat FROM questions q JOIN categories c ON c.id=q.category_id WHERE q.status='pending' LIMIT 20`).all() };
  });
}
