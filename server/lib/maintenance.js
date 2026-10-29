import { getDb } from '../db/db.js';

export function isMaintenance() {
  try {
    return getDb().prepare('SELECT v FROM kv WHERE k=?').get('maintenance')?.v === '1';
  } catch { return false; }
}
export function setMaintenance(on) {
  getDb().prepare('INSERT OR REPLACE INTO kv(k,v) VALUES(?,?)').run('maintenance', on ? '1' : '0');
}
