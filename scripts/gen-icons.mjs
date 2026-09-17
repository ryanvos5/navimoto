#!/usr/bin/env node
// Genereert de PWA-iconen van Navimoto (public/icons/*.png) zonder externe afhankelijkheden.
//
//   node scripts/gen-icons.mjs
//
// Het tekent dezelfde vormen als public/icons/icon.svg: een donker afgerond vierkant,
// een rode S-bocht (route) en een witte pijlpunt die naar rechtsboven wijst.
// Rasterisatie gebeurt met afstandsfuncties per (sub)pixel; PNG's worden met zlib
// (deflateSync) en een eigen CRC32 geschreven (IHDR / IDAT / IEND, 8-bit RGBA, filter 0).

import { deflateSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// Ontwerp (in een 512 × 512 ontwerpruimte, identiek aan icon.svg)
// ---------------------------------------------------------------------------

export const DESIGN_SIZE = 512;
export const COLORS = {
  background: [0x0b, 0x12, 0x20], // #0b1220
  route: [0xf9, 0x73, 0x16], // #e2131d
  chevron: [0xff, 0xff, 0xff],
};
export const CORNER_RADIUS = 96;

/**
 * De route: twee aaneengesloten kubische Béziers (S-bocht). Start linksonder en gaat omhoog,
 * buigt naar rechts door het midden en buigt daarna omhoog naar rechtsboven (raaklijn 45°).
 * Zelfde coördinaten als het <path> in icon.svg.
 */
export const ROUTE_CURVES = [
  { p0: [132, 396], p1: [132, 236], p2: [136, 246], p3: [256, 246] },
  { p0: [256, 246], p1: [336, 246], p2: [336, 172], p3: [378, 130] },
];
export const ROUTE_WIDTH = 58;

/** Pijlpunt (chevron): twee armen vanuit de punt, naar links en naar beneden → wijst naar rechtsboven. */
export const CHEVRON = { tip: [391, 117], arm: 92, width: 50 };

/** Bij het maskable-icoon staat de tekening in de centrale 80 % (veilige zone). */
export const MASKABLE_SCALE = 0.8;

// ---------------------------------------------------------------------------
// CRC32 + PNG-encoder
// ---------------------------------------------------------------------------

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

/** CRC32 (IEEE 802.3, zoals PNG het vereist) over een byte-array. */
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Codeert een RGBA-buffer (width*height*4 bytes) als PNG (8-bit RGBA, geen interlace). */
export function encodePng(width, height, rgba) {
  if (rgba.length !== width * height * 4) throw new Error('rgba-buffer heeft een verkeerde lengte');

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // interlace

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filtertype 0 (None) per scanline
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), rowStart + 1);
  }
  const idat = deflateSync(raw, { level: 9 });

  return Buffer.concat([PNG_SIGNATURE, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

/** Leest signature en IHDR terug; gooit bij een ongeldig bestand. */
export function readPngHeader(bytes) {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('geen geldige PNG-signature');
  if (bytes.toString('ascii', 12, 16) !== 'IHDR') throw new Error('IHDR-chunk ontbreekt');
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    bitDepth: bytes[24],
    colorType: bytes[25],
  };
}

// ---------------------------------------------------------------------------
// Geometrie
// ---------------------------------------------------------------------------

function cubicPoint({ p0, p1, p2, p3 }, t) {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
}

/** Benadert aaneengesloten Béziers met één polylijn (`segments` stukken per curve). */
export function flattenCubics(curves, segments = 48) {
  const pts = [];
  curves.forEach((curve, c) => {
    for (let i = c === 0 ? 0 : 1; i <= segments; i++) pts.push(cubicPoint(curve, i / segments));
  });
  return pts;
}

export function chevronPoints({ tip, arm }) {
  return [
    [tip[0] - arm, tip[1]],
    [tip[0], tip[1]],
    [tip[0], tip[1] + arm],
  ];
}

function distanceSqToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const len2 = vx * vx + vy * vy;
  let t = len2 > 0 ? (wx * vx + wy * vy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = px - (ax + t * vx);
  const dy = py - (ay + t * vy);
  return dx * dx + dy * dy;
}

/** Een dikke polylijn met ronde uiteinden/hoeken: alle punten binnen `width/2` van de lijn. */
function makeStroke(points, width) {
  const r = width / 2;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const bbox = [minX - r, minY - r, maxX + r, maxY + r];
  const r2 = r * r;
  return {
    contains(x, y) {
      if (x < bbox[0] || x > bbox[2] || y < bbox[1] || y > bbox[3]) return false;
      for (let i = 0; i + 1 < points.length; i++) {
        const a = points[i];
        const b = points[i + 1];
        if (distanceSqToSegment(x, y, a[0], a[1], b[0], b[1]) <= r2) return true;
      }
      return false;
    },
  };
}

function insideRoundedSquare(x, y, size, radius) {
  if (x < 0 || y < 0 || x > size || y > size) return false;
  const cx = x < radius ? radius : x > size - radius ? size - radius : x;
  const cy = y < radius ? radius : y > size - radius ? size - radius : y;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

// ---------------------------------------------------------------------------
// Rasterisatie
// ---------------------------------------------------------------------------

/**
 * Rendert het icoon als RGBA-buffer van `size` × `size` pixels.
 * - normaal: afgerond vierkant met transparante hoeken;
 * - maskable: volledig gevulde donkere achtergrond, tekening geschaald naar de centrale 80 %.
 * `supersample` = aantal subsamples per as (3 → 9 samples per pixel) voor rustige randen.
 */
export function renderIcon(size, { maskable = false, supersample = 3 } = {}) {
  const artScale = maskable ? MASKABLE_SCALE : 1;
  const center = DESIGN_SIZE / 2;
  const art = ([x, y]) => [center + (x - center) * artScale, center + (y - center) * artScale];

  const route = makeStroke(flattenCubics(ROUTE_CURVES).map(art), ROUTE_WIDTH * artScale);
  const chevron = makeStroke(chevronPoints(CHEVRON).map(art), CHEVRON.width * artScale);

  const rgba = new Uint8Array(size * size * 4);
  const toDesign = DESIGN_SIZE / size;
  const samplesPerPixel = supersample * supersample;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let covered = 0;
      for (let sy = 0; sy < supersample; sy++) {
        for (let sx = 0; sx < supersample; sx++) {
          const x = (px + (sx + 0.5) / supersample) * toDesign;
          const y = (py + (sy + 0.5) / supersample) * toDesign;
          let color = null;
          if (chevron.contains(x, y)) color = COLORS.chevron;
          else if (route.contains(x, y)) color = COLORS.route;
          else if (maskable || insideRoundedSquare(x, y, DESIGN_SIZE, CORNER_RADIUS)) color = COLORS.background;
          if (color) {
            r += color[0];
            g += color[1];
            b += color[2];
            covered++;
          }
        }
      }
      const o = (py * size + px) * 4;
      if (covered > 0) {
        rgba[o] = Math.round(r / covered);
        rgba[o + 1] = Math.round(g / covered);
        rgba[o + 2] = Math.round(b / covered);
        rgba[o + 3] = Math.round((255 * covered) / samplesPerPixel);
      }
    }
  }
  return rgba;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export const OUTPUTS = [
  { file: 'icon-192.png', size: 192, maskable: false },
  { file: 'icon-512.png', size: 512, maskable: false },
  { file: 'icon-512-maskable.png', size: 512, maskable: true },
];

export function generateAll(outDir) {
  mkdirSync(outDir, { recursive: true });
  const results = [];
  for (const { file, size, maskable } of OUTPUTS) {
    const path = resolve(outDir, file);
    writeFileSync(path, encodePng(size, size, renderIcon(size, { maskable })));
    const bytes = readFileSync(path);
    const header = readPngHeader(bytes);
    if (header.width !== size || header.height !== size) throw new Error(`${file}: verkeerde afmetingen`);
    results.push({ file, path, bytes: bytes.length, ...header });
  }
  return results;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
  for (const r of generateAll(outDir)) {
    console.log(`${r.file}: ${r.width}x${r.height}, ${r.bitDepth}-bit RGBA, ${r.bytes} bytes`);
  }
}
