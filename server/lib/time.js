// Utilitaires temps (fuseau configurable, semaines lundi 00:00).
export function dayKey(d = new Date(), tz = process.env.TZ ?? 'Europe/Paris') {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
export function weekKey(d = new Date(), tz = process.env.TZ ?? 'Europe/Paris') {
  // Clé semaine ISO simplifiée : lundi de la semaine.
  const copy = new Date(d);
  const day = (copy.getUTCDay() + 6) % 7; // 0 = lundi
  copy.setUTCDate(copy.getUTCDate() - day);
  return dayKey(copy, tz);
}
export function nowMs() { return Date.now(); }
