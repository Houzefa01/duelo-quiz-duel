// P16-23 : duel complet via le domaine (2 clients WS distants, pas depuis le VPS).
import WebSocket from 'ws';
const J = (r) => r.json();
async function login(u, p) {
  const r = await fetch('https://duel.enset.work/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) });
  return r.headers.get('set-cookie').match(/session=[^;]+/)[0];
}
const ckA = await login('DomA', 'DomMotDePasse!99');
const ckB = await login('DomB', 'DomMotDePasse!99');
const wa = new WebSocket('wss://duel.enset.work/live', { headers: { Cookie: ckA } });
const wb = new WebSocket('wss://duel.enset.work/live', { headers: { Cookie: ckB } });
await Promise.all([new Promise((r) => wa.on('open', r)), new Promise((r) => wb.on('open', r))]);
console.log('2 WS distants connectés');
let duelId = null, fin = null;
const seen = new Set();
wa.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.t === 'match.found') duelId = m.duelId;
  if (m.t === 'question.show' && !seen.has(m.round)) {
    seen.add(m.round);
    wa.send(JSON.stringify({ t: 'answer', duelId, round: m.round, choice: 0 }));
  }
  if (m.t === 'duel.end') fin = m;
});
wb.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.t === 'question.show') wb.send(JSON.stringify({ t: 'answer', duelId: m.duelId, round: m.round, choice: 1 }));
});
wa.send(JSON.stringify({ t: 'queue.join', mode: 'ranked' }));
wb.send(JSON.stringify({ t: 'queue.join', mode: 'ranked' }));
const t0 = Date.now();
while (!fin && Date.now() - t0 < 120000) await new Promise((r) => setTimeout(r, 500));
console.log('duel via CF terminé :', fin ? `${fin.scores.you}-${fin.scores.opp} gagnant=${fin.winner} elo=${fin.eloDelta}` : 'ÉCHEC');
wa.terminate(); wb.terminate();
if (!fin) process.exit(1);
