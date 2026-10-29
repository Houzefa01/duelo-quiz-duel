export async function api(path, opts = {}) {
  const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const j = await r.json().catch(() => ({}));
  if (r.status === 503 && j.error === 'maintenance') {
    if (!location.hash.includes('maintenance')) location.hash = '#/maintenance';
    throw new Error(j.message ?? 'On revient bientôt.');
  }
  if (!r.ok) throw new Error(j.error ?? ('Erreur ' + r.status));
  return j;
}
