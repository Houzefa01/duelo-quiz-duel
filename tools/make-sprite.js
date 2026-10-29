// Assemble les SVG Phosphor téléchargés en un sprite <symbol> (assemblage
// mécanique : copie du contenu intérieur, aucun dessin). Usage :
// <svg class="ic"><use href="/assets/icons.svg#play"/></svg> (hérite currentColor).
// Usage : node tools/make-sprite.js
import fs from 'node:fs';
import path from 'node:path';
const dir = new URL('../web/assets/icons/', import.meta.url).pathname;
let out = '<svg xmlns="http://www.w3.org/2000/svg" style="display:none">\n';
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.svg')).sort()) {
  const id = path.basename(f, '.svg');
  const s = fs.readFileSync(path.join(dir, f), 'utf8');
  const inner = s.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  const vb = (s.match(/viewBox="([^"]+)"/) || [])[1] || '0 0 256 256';
  out += `<symbol id="${id}" viewBox="${vb}">${inner}</symbol>\n`;
}
fs.writeFileSync(path.join(new URL('../web/assets/', import.meta.url).pathname, 'icons.svg'), out + '</svg>\n');
console.log('sprite ok');
