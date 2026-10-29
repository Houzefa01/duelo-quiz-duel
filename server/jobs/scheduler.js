import { getDb } from '../db/db.js';
import { RULES } from '../config/rules.js';
import { dayKey, weekKey } from '../lib/time.js';

// Tâches planifiées internes (pas de dépendance) : défis, tournoi du samedi, hebdo, nettoyage.
export function startJobs() {
  setInterval(tick, 30_000);
  tick();
}
function tick() {
  try {
    const db = getDb();
    ensureSaturdayTournament(db);
    weeklyResetNotice(db);
    expireFriendChallenges(db);
    dailyTopBonus(db);
  } catch (e) { console.error(JSON.stringify({ lvl: 'error', msg: 'jobs', e: String(e) })); }
}

function nextSaturday20h() {
  const d = new Date();
  d.setHours(20, 0, 0, 0);
  const add = (6 - d.getDay() + 7) % 7 || 7;
  if (add !== 7 || d.getTime() < Date.now()) d.setDate(d.getDate() + add);
  return d.getTime();
}

function ensureSaturdayTournament(db) {
  const startsAt = nextSaturday20h();
  const exists = db.prepare('SELECT id FROM tournaments WHERE starts_at=?').get(startsAt);
  if (exists) return;
  const lastSat = db.prepare("SELECT * FROM tournaments WHERE status='done' ORDER BY starts_at DESC LIMIT 1").get();
  const n = lastSat ? lastSat.size : 8;
  db.prepare('INSERT INTO tournaments(name,size,status,starts_at,checkin_at) VALUES(?,?,?,?,?)')
    .run('Tournoi du samedi', n, 'announced', startsAt, startsAt - RULES.tournament.checkinMinutes * 6e4);
  // Ouvre les inscriptions 48 h avant
  const t = db.prepare('SELECT * FROM tournaments WHERE starts_at=?').get(startsAt);
  if (startsAt - Date.now() < 48 * 36e5 && t.status === 'announced')
    db.prepare(`UPDATE tournaments SET status='open' WHERE id=?`).run(t.id);
}

function weeklyResetNotice(db) {
  // Remise à zéro hebdo logique (classement hebdo calculé sur 7 j glissants + period_key).
  // Notifie le lundi les joueurs connectés (résumé hebdo F-§9) — simple drapeau.
  const v = db.prepare('SELECT v FROM kv WHERE k=?').get('last_weekly');
  const wk = weekKey();
  if (!v || v.v !== wk) {
    db.prepare('INSERT OR REPLACE INTO kv(k,v) VALUES(?,?)').run('last_weekly', wk);
    // Gel de série hebdo (F-42)
    db.prepare(`UPDATE users SET freeze_tokens=freeze_tokens+? WHERE role='user'`).run(RULES.chest.freezeTokensPerWeek);
  }
}

function expireFriendChallenges(db) {
  const rows = db.prepare(`SELECT * FROM friend_challenges WHERE status='pending' AND expires_at<?`).all(Date.now());
  for (const r of rows) {
    db.transaction(() => {
      if (r.stake > 0) db.prepare('UPDATE users SET coins=coins+? WHERE id=?').run(r.stake, r.from_id);
      db.prepare(`UPDATE friend_challenges SET status='expired' WHERE id=?`).run(r.id);
    })();
  }
}

function dailyTopBonus(db) {
  // Bonus top 3 du défi du jour (F-52) : une fois le jour terminé.
  const done = db.prepare('SELECT v FROM kv WHERE k=?').get('daily_bonus_done');
  const dk = dayKey(new Date(Date.now() - 864e5));
  if (done?.v === dk) return;
  const top = db.prepare('SELECT user_id,score FROM daily_runs WHERE period_key=? AND finished_at IS NOT NULL ORDER BY score DESC LIMIT 3').all(dk);
  if (top.length) {
    top.forEach((r, i) => {
      const bonus = RULES.daily.runTopBonus[i];
      if (bonus) {
        db.prepare('UPDATE users SET coins=coins+? WHERE id=?').run(bonus, r.user_id);
        db.prepare('INSERT INTO reward_ledger(user_id,kind,amount_coins,amount_xp,created_at) VALUES(?,?,?,?,?)').run(r.user_id, 'daily-top', bonus, 0, Date.now());
      }
    });
    db.prepare('INSERT OR REPLACE INTO kv(k,v) VALUES(?,?)').run('daily_bonus_done', dk);
  }
}
