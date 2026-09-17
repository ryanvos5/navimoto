// Genereert de PWA-iconen uit het officiële logo (public/brand/navimoto-logo-square.svg):
// een zwart vierkant met het witte woordmerk (rode i-punt) breed erover.
// Gebruik: node scripts/gen-icons.mjs   (vereist devDependency @resvg/resvg-js)
import { readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const SOURCE = 'public/brand/navimoto-logo-square.svg';
// Positie van het woordmerk binnen de 1050x1050 bron.
const WORDMARK = { x: 150, y: 445, w: 750, h: 160 };

const src = readFileSync(SOURCE, 'utf8');
const inner = src
  .replace(/<\?xml[^>]*>\s*/, '')
  .replace(/<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '')
  .replace(/<rect width="1050" height="1050"\/>\s*/, '');

/** Icoon-SVG: zwart vierkant, woordmerk gecentreerd op `safe` x de breedte (maskable: kleiner). */
function iconSvg(size, safe) {
  const scale = (size * safe) / WORDMARK.w;
  const w = WORDMARK.w * scale;
  const h = WORDMARK.h * scale;
  const tx = (size - w) / 2;
  const ty = (size - h) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="#000"/><g transform="translate(${tx} ${ty}) scale(${scale}) translate(${-WORDMARK.x} ${-WORDMARK.y})">${inner}</g></svg>`;
}

// Transparant woordmerk voor gebruik in de app (Logo-component).
const wordmark = src
  .replace(/<\?xml[^>]*>\s*/, '')
  .replace(/viewBox="0 0 1050 1050"/, `viewBox="${WORDMARK.x} ${WORDMARK.y} ${WORDMARK.w} ${WORDMARK.h}"`)
  .replace(/<rect width="1050" height="1050"\/>\s*/, '');
writeFileSync('public/brand/navimoto-wordmark.svg', wordmark);

for (const [name, size, safe] of [
  ['icon-192.png', 192, 0.88],
  ['icon-512.png', 512, 0.88],
  ['icon-512-maskable.png', 512, 0.72],
]) {
  const png = new Resvg(iconSvg(size, safe), { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(`public/icons/${name}`, png);
  console.log(`${name}: ${png.length} bytes`);
}
writeFileSync('public/icons/icon.svg', iconSvg(512, 0.88));
console.log('icon.svg geschreven');
