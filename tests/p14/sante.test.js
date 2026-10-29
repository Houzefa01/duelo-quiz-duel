// P14-5 : /admin/sante (API + redirection vers l'écran).
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, mkUsersDirect } from '../integration/helper.js';

test('sante : métriques admin, 403 sinon, redirection /admin/sante', async () => {
  const ctx = await boot({ port: 34608, db: '/tmp/duelo-p14-sante.db' });
  try {
    const [u] = await mkUsersDirect(['SantU']);
    const [adm] = await mkUsersDirect(['SantAdm']);
    const { getDb } = await import('../../server/db/db.js');
    getDb().prepare(`UPDATE users SET role='admin' WHERE id=?`).run(adm.id);
    let r = await fetch(ctx.url + '/api/v1/admin/health', { headers: { Cookie: u.cookie } });
    assert.equal(r.status, 403);
    const h = await fetch(ctx.url + '/api/v1/admin/health', { headers: { Cookie: adm.cookie } }).then((x) => x.json());
    for (const k of ['ramMo', 'heapMo', 'cpuPctDepuisDemarrage', 'enLigne5min', 'duelsActifs', 'disque', 'uploads', 'derniereSauvegarde']) {
      assert.ok(k in h, 'champ ' + k);
    }
    assert.ok(h.ramMo > 0 && h.enLigne5min >= 2, JSON.stringify(h));
    r = await fetch(ctx.url + '/admin/sante', { redirect: 'manual' });
    assert.equal(r.status, 302);
    assert.ok((r.headers.get('location') ?? '').includes('#/admin-sante'));
  } finally {
    await ctx.close();
  }
});
