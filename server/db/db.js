import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
let db = null;

export function openDb(dbPath) {
  if (db) return db;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000'); // concurrence (sauvegarde, outils, tests)
  const schema = fs.readFileSync(path.join(__dir, 'schema.sql'), 'utf8');
  db.exec(schema);
  // Migrations numérotées, idempotentes (table _migrations).
  db.exec('CREATE TABLE IF NOT EXISTS _migrations(name TEXT PRIMARY KEY, applied_at INTEGER)');
  const done = new Set(db.prepare('SELECT name FROM _migrations').all().map((r) => r.name));
  const migDir = path.join(__dir, 'migrations');
  if (fs.existsSync(migDir)) {
    for (const f of fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()) {
      if (done.has(f)) continue;
      const sql = fs.readFileSync(path.join(migDir, f), 'utf8');
      // Retire les lignes de commentaire, découpe par ';' (les ADD COLUMN répétés sont ignorés).
      const clean = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
      for (const stmt of clean.split(';')) {
        if (!stmt.trim()) continue;
        try { db.exec(stmt); }
        catch (e) {
          if (!/duplicate column/i.test(String(e.message))) throw e;
        }
      }
      db.prepare('INSERT INTO _migrations(name,applied_at) VALUES(?,?)').run(f, Date.now());
    }
  }
  // Reprise après arrêt brutal (kill -9) : les duels non terminés ne peuvent pas
  // reprendre (état en mémoire) → annulés sans pénalité (ni Elo, ni pièces).
  try {
    const r = db.prepare(`UPDATE duels SET status='cancelled',ended_at=? WHERE status NOT IN ('finished','cancelled')`).run(Date.now());
    if (r.changes > 0) console.log(`reprise: ${r.changes} duel(s) interrompu(s) annulé(s) sans pénalité`);
  } catch { /* base toute neuve */ }
  return db;
}
export function getDb() {
  if (!db) throw new Error('DB non ouverte');
  return db;
}
