import { logger } from './logger.js';

// Traitement d'images avec repli : sharp (rapide, natif) puis jimp (pur JS, lent).
// AVATAR_ENGINE=sharp|jimp|auto (défaut auto). Si sharp ne se charge pas
// (vieux CPU, binaire absent), jimp prend le relais avec les mêmes garanties :
// carré/cover, redimensionnement, WebP*, métadonnées supprimées, refus des animés.
// * jimp n'encode pas WebP : le repli sort en PNG (mime image/png, extension conservée
//   en .png, jamais exécutable).
let sharpMod = null, jimpMod = null, sharpFailed = false;

export function imageEngine() {
  const f = process.env.AVATAR_ENGINE ?? 'auto'; // lu à chaque appel (tests, repli)
  if (f === 'jimp') return 'jimp';
  if (f === 'sharp') return 'sharp';
  return sharpFailed ? 'jimp' : 'sharp';
}

async function getSharp() {
  if (sharpMod) return sharpMod;
  try {
    sharpMod = (await import('sharp')).default;
    return sharpMod;
  } catch (e) {
    sharpFailed = true;
    logger.warn({ e: String(e).slice(0, 120) }, 'sharp indisponible, repli jimp');
    return null;
  }
}
async function getJimp() {
  if (!jimpMod) jimpMod = (await import('jimp')).Jimp ?? (await import('jimp')).default;
  return jimpMod;
}

// Détecte un GIF animé (plusieurs images) par les extensions de contrôle graphique.
export function gifFrames(buf) {
  let n = 0;
  for (let i = 0; i + 5 < buf.length; i++) {
    if (buf[i] === 0x21 && buf[i + 1] === 0xf9 && buf[i + 2] === 0x04) n++;
  }
  return n;
}

export async function probe(buf) {
  // Retourne {width, height, animated} ou lève si illisible.
  if (imageEngine() === 'sharp') {
    const sharp = await getSharp();
    if (sharp) {
      const meta = await sharp(buf).metadata();
      return { width: meta.width ?? 0, height: meta.height ?? 0, animated: (meta.pages ?? 1) > 1 };
    }
  }
  const Jimp = await getJimp();
  const img = await Jimp.read(buf);
  return { width: img.bitmap.width, height: img.bitmap.height, animated: gifFrames(buf) > 1 };
}

// Redimensionne en cover WxH. Retourne {data, mime} (webp via sharp, png via jimp).
export async function cover(buf, w, h, quality = 82) {
  if (imageEngine() === 'sharp') {
    const sharp = await getSharp();
    if (sharp) {
      const data = await sharp(buf).resize(w, h, { fit: 'cover', position: 'centre' }).webp({ quality }).toBuffer();
      return { data, mime: 'image/webp' };
    }
  }
  const Jimp = await getJimp();
  const img = await Jimp.read(buf);
  img.cover({ w, h });
  const data = await img.getBuffer('image/png');
  return { data, mime: 'image/png' };
}
