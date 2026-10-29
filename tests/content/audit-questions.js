// P11-7 : audit qualité des questions -> docs/QUESTIONS_A_VERIFIER.md
import fs from 'node:fs';
process.env.DB_PATH = process.env.DB_PATH ?? './data/duelo.db';
const { openDb } = await import('../../server/db/db.js');
openDb(process.env.DB_PATH);
const { getDb } = await import('../../server/db/db.js');
const db = getDb();

const norm = (s) => (s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/\s*\((variante|édition|n°|série|manche|tour) [^)]*\)\s*/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const rows = db.prepare(`SELECT q.id,c.slug cat,q.difficulty,q.text,q.a,q.b,q.c,q.d,q.correct,q.source,q.verified,q.status,q.times_asked
  FROM questions q JOIN categories c ON c.id=q.category_id WHERE q.status='live'`).all();

const out = [];
out.push(`# Questions à vérifier (généré le ${new Date().toISOString().slice(0, 10)})`);
out.push(`Base auditée : ${rows.length} questions live.`);
out.push('');

// 1. verified = false
const unv = rows.filter((q) => !q.verified);
out.push(`## 1. Non vérifiées (verified=0) : ${unv.length}`);
unv.slice(0, 50).forEach((q) => out.push(`- #${q.id} [${q.cat}] ${q.text}`));
out.push('');

// 2. Réponses ambiguës : doublons parmi les 4 options, ou bonne réponse dupliquée
const amb = rows.filter((q) => {
  const opts = [q.a, q.b, q.c, q.d].map(norm);
  return new Set(opts).size < 4 || opts.some((o) => !o);
});
out.push(`## 2. Réponses ambiguës (options dupliquées/vides) : ${amb.length}`);
amb.slice(0, 50).forEach((q) => out.push(`- #${q.id} [${q.cat}] ${q.text} || options: ${[q.a, q.b, q.c, q.d].join(' / ')}`));
out.push('');

// 3. Doublons proches : même énoncé normalisé (suffixes de variante retirés)
const groups = new Map();
for (const q of rows) {
  const k = q.cat + '|' + norm(q.text);
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(q);
}
const dups = [...groups.values()].filter((g) => g.length > 1);
const dupCount = dups.reduce((s, g) => s + g.length, 0);
out.push(`## 3. Doublons proches (même énoncé normalisé) : ${dupCount} questions en ${dups.length} groupes`);
out.push('> Contexte : le générateur décline chaque fait en variantes numérotées (même bonne réponse,');
out.push('> distracteurs identiques). Volontaire pour atteindre 600, mais à enrichir en priorité.');
dups.slice(0, 12).forEach((g) => {
  out.push(`- Groupe (${g.length}) [${g[0].cat}] : ${g[0].text}`);
  out.push(`  ids: ${g.map((q) => q.id).join(', ')}`);
});
if (dups.length > 12) out.push(`- … et ${dups.length - 12} autres groupes (voir base).`);
out.push('');

// 4. Jamais jouées / stats
const never = rows.filter((q) => q.times_asked === 0).length;
out.push(`## 4. Jamais jouées : ${never}/${rows.length} (recalibrage auto après 30 expositions)`);
out.push('');
out.push('## Recommandations');
out.push('- Enrichir les variantes : distracteurs tournants par variante (fait pour la géographie, à étendre).');
out.push('- Faire relire par un humain les groupes ci-dessus avant tout tournoi officiel.');
out.push('- Marquer verified=0 toute question signalée 1 fois, revue à 3 (déjà automatique).');

fs.writeFileSync(new URL('../../docs/QUESTIONS_A_VERIFIER.md', import.meta.url), out.join('\n'));
console.log(`OK: ${rows.length} questions, verified=0: ${unv.length}, ambiguës: ${amb.length}, doublons: ${dupCount} (${dups.length} groupes), jamais jouées: ${never}`);
