// P14-2 : refus de démarrage en production sans mot de passe admin fort.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

function bootProd(extraEnv, port) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['server/index.js'], {
      cwd: '/home/Hsavatra/duelo',
      env: {
        ...process.env, NODE_ENV: 'production', PORT: String(port),
        DB_PATH: `/tmp/duelo-p14-boot${port}.db`, SESSION_SECRET: 'x'.repeat(40),
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    const t = setTimeout(() => { p.kill('SIGKILL'); resolve({ code: null, out, timeout: true }); }, 15000);
    p.on('exit', (code) => { clearTimeout(t); resolve({ code, out }); });
  });
}

test('prod : ADMIN_PASSWORD absent -> refus (code 1)', async () => {
  const r = await bootProd({ ADMIN_PASSWORD: '' }, 34611);
  assert.equal(r.code, 1, r.out.slice(-300));
  assert.ok(r.out.includes('ADMIN_PASSWORD'), 'message explicite');
});

test('prod : mot de passe faible -> refus', async () => {
  for (const faible of ['admin12345678', 'courte1', 'Motdepassefort', 'K7$mQ9#']) {
    const r = await bootProd({ ADMIN_PASSWORD: faible }, 34612);
    assert.equal(r.code, 1, faible + ' : ' + r.out.slice(-200));
  }
});

test('prod : mot de passe fort -> démarrage, aucun compte démo', async () => {
  const port = 34613;
  const p = spawn(process.execPath, ['server/index.js'], {
    cwd: '/home/Hsavatra/duelo',
    env: {
      ...process.env, NODE_ENV: 'production', PORT: String(port),
      DB_PATH: `/tmp/duelo-p14-boot${port}.db`, SESSION_SECRET: 'x'.repeat(40),
      ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'K7$mQ9#vX2@pLzRw!',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    const t0 = Date.now();
    for (;;) {
      try {
        const h = await fetch(`http://127.0.0.1:${port}/healthz`).then((x) => x.json());
        if (h.ok) break;
      } catch {}
      if (Date.now() - t0 > 20000) throw new Error('serveur non démarré');
      await new Promise((r) => setTimeout(r, 300));
    }
    // Aucun compte de démo : lecture concurrente (WAL) de la base du serveur.
    const { openDb, getDb } = await import('../../server/db/db.js');
    openDb(`/tmp/duelo-p14-boot${port}.db`);
    const roles = getDb().prepare('SELECT role,COUNT(*) c FROM users GROUP BY role').all();
    assert.ok(!roles.some((x) => x.role === 'user'), 'aucun joueur pré-créé : ' + JSON.stringify(roles));
  } finally {
    p.kill('SIGKILL');
  }
});
