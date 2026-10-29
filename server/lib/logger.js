// Logger JSON structuré minimal (stdout), sans secret.
export const logger = {
  info(o, msg = '') { console.log(JSON.stringify({ lvl: 'info', msg, ...o, t: new Date().toISOString() })); },
  warn(o, msg = '') { console.warn(JSON.stringify({ lvl: 'warn', msg, ...o, t: new Date().toISOString() })); },
  error(o, msg = '') { console.error(JSON.stringify({ lvl: 'error', msg, ...o, t: new Date().toISOString() })); },
};
