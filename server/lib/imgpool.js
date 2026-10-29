import { Worker } from 'node:worker_threads';
import { logger } from './logger.js';

// File d'images : 1 tâche à la fois dans un worker dédié.
// Les duels (boucle d'événements) ne sont jamais bloqués par sharp/jimp.
let worker = null;
const file = [];
let actif = false;
let seq = 0;
const attentes = new Map();

function demarre() {
  worker = new Worker(new URL('./imgworker.js', import.meta.url));
  worker.on('message', (m) => {
    const p = attentes.get(m.id);
    if (!p) return;
    attentes.delete(m.id);
    actif = false;
    if (m.ok) p.res(m.res);
    else p.rej(new Error(m.error ?? 'traitement image impossible'));
    suivante();
  });
  worker.on('error', (e) => {
    logger.error({ e: String(e).slice(0, 200) }, 'worker image en erreur, redémarrage');
    for (const [, p] of attentes) p.rej(new Error('worker image redémarré'));
    attentes.clear();
    actif = false;
    try { worker.terminate(); } catch {}
    worker = null;
    suivante();
  });
}
function suivante() {
  if (actif || !file.length) return;
  if (!worker) demarre();
  const t = file.shift();
  actif = true;
  attentes.set(t.id, { res: t.res, rej: t.rej });
  worker.postMessage({ id: t.id, op: t.op, buf: t.buf, w: t.w, h: t.h, q: t.q });
}
function fileTache(op, buf, w, h, q) {
  return new Promise((res, rej) => {
    file.push({ id: ++seq, op, buf, w, h, q, res, rej });
    suivante();
  });
}
export async function probePool(buf) {
  return fileTache('probe', buf);
}
export async function coverPool(buf, w, h, q = 82) {
  const r = await fileTache('cover', buf, w, h, q);
  return { data: Buffer.from(r.data, 'base64'), mime: r.mime };
}
export function fileLongueur() { return file.length + (actif ? 1 : 0); }
export async function fermePool() {
  for (const [, p] of attentes) p.rej(new Error('arrêt'));
  attentes.clear();
  file.length = 0;
  if (worker) { try { await worker.terminate(); } catch {} worker = null; }
  actif = false;
}
