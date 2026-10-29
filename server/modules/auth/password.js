import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';

export const Username = z.string().min(3).max(16).regex(/^[A-Za-z0-9_-]+$/, 'Pseudo invalide');
export const Password = z.string().min(10).max(200);

export function hashPassword(pw) { return bcrypt.hashSync(pw, 12); } // F-02 : bcrypt coût ≥ 12
export function checkPassword(pw, hash) { return bcrypt.compareSync(pw, hash); }
export function newToken() { return crypto.randomBytes(32).toString('hex'); }
export function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
// 8 codes de secours lisibles (F-04)
export function genRecoveryCodes() {
  return Array.from({ length: 8 }, () => crypto.randomBytes(5).toString('hex').toUpperCase());
}
export const BANNED = ['admin', 'modo', 'hitler', 'nazi', 'putain', 'merde', 'connard', 'salope'];
export function pseudoOk(p) {
  const low = p.toLowerCase();
  return !BANNED.some((w) => low.includes(w));
}
