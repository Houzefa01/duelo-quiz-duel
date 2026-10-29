import { parentPort } from 'node:worker_threads';

// Exécute probe/cover hors de la boucle d'événements (sharp et surtout jimp
// sont synchrones et gourmands). Une seule tâche à la fois : la file absorbe
// les rafales sans jamais empiler le CPU.
parentPort.on('message', async (m) => {
  try {
    const { probe, cover } = await import('./images.js');
    if (m.op === 'probe') {
      const r = await probe(Buffer.from(m.buf));
      parentPort.postMessage({ id: m.id, ok: true, res: r });
    } else if (m.op === 'cover') {
      const r = await cover(Buffer.from(m.buf), m.w, m.h, m.q);
      parentPort.postMessage({ id: m.id, ok: true, res: { data: r.data.toString('base64'), mime: r.mime } });
    } else parentPort.postMessage({ id: m.id, ok: false, error: 'op inconnue' });
  } catch (e) {
    parentPort.postMessage({ id: m.id, ok: false, error: String(e.message ?? e).slice(0, 200) });
  }
});
