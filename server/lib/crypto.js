import crypto from 'node:crypto';

// Chiffrement des lots sensibles (AES-256-GCM, nonce unique par valeur).
// Clé : REWARD_KEY = 64 caractères hexadécimaux (32 octets) dans .env.
// Le serveur refuse de démarrer si des lots chiffrés existent sans clé valide.
export function rewardKey() {
  const raw = (process.env.REWARD_KEY ?? '').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) return null;
  return Buffer.from(raw, 'hex');
}
export function lotsEnabled() { return !!rewardKey(); }

export function seal(plain) {
  const key = rewardKey();
  if (!key) throw new Error('REWARD_KEY manquante ou invalide');
  const nonce = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, nonce);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return { payload_enc: enc.toString('base64') + '.' + c.getAuthTag().toString('base64'), nonce: nonce.toString('base64') };
}
export function openWithNonce(payload_enc, nonceB64) {
  const key = rewardKey();
  if (!key) throw new Error('REWARD_KEY manquante ou invalide');
  const [data, tag] = String(payload_enc).split('.');
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(nonceB64, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
}
export function genRewardKey() { return crypto.randomBytes(32).toString('hex'); }
