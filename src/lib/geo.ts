// Geometrische hulpfuncties. Puur, zonder afhankelijkheden - getest in geo.test.ts.
import type { LatLng } from '@/types';

export const EARTH_RADIUS_KM = 6371.0088;
const toRad = (d: number): number => (d * Math.PI) / 180;
const toDeg = (r: number): number => (r * 180) / Math.PI;

export function isValidLatLng(p: unknown): p is LatLng {
  if (!p || typeof p !== 'object') return false;
  const { lat, lon } = p as { lat?: unknown; lon?: unknown };
  return (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

export function normalizeLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/** Afstand in kilometers over de grootcirkel. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function haversineM(a: LatLng, b: LatLng): number {
  return haversineKm(a, b) * 1000;
}

/** Initiele koers van a naar b in graden [0, 360). */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Kleinste getekende hoekverschil (b - a) in (-180, 180]. */
export function angleDiff(a: number, b: number): number {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** Punt op gegeven koers en afstand vanaf origin. */
export function destinationPoint(origin: LatLng, bearing: number, distanceKm: number): LatLng {
  const delta = distanceKm / EARTH_RADIUS_KM;
  const theta = toRad(bearing);
  const phi1 = toRad(origin.lat);
  const lambda1 = toRad(origin.lon);
  const phi2 = Math.asin(Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta));
  const lambda2 =
    lambda1 +
    Math.atan2(Math.sin(theta) * Math.sin(delta) * Math.cos(phi1), Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2));
  return { lat: toDeg(phi2), lon: normalizeLon(toDeg(lambda2)) };
}

/** Decodeert een Google/Valhalla encoded polyline. Valhalla gebruikt precision 6. */
export function decodePolyline(encoded: string, precision = 6): LatLng[] {
  const factor = Math.pow(10, precision);
  const out: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  while (index < encoded.length) {
    let byte = 0;
    let shift = 0;
    let result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lon += result & 1 ? ~(result >> 1) : result >> 1;
    out.push({ lat: lat / factor, lon: lon / factor });
  }
  return out;
}

export function encodePolyline(points: LatLng[], precision = 6): string {
  const factor = Math.pow(10, precision);
  let out = '';
  let prevLat = 0;
  let prevLon = 0;
  const encodeValue = (v: number): string => {
    let value = v < 0 ? ~(v << 1) : v << 1;
    let s = '';
    while (value >= 0x20) {
      s += String.fromCharCode((0x20 | (value & 0x1f)) + 63);
      value >>= 5;
    }
    s += String.fromCharCode(value + 63);
    return s;
  };
  for (const p of points) {
    const lat = Math.round(p.lat * factor);
    const lon = Math.round(p.lon * factor);
    out += encodeValue(lat - prevLat) + encodeValue(lon - prevLon);
    prevLat = lat;
    prevLon = lon;
  }
  return out;
}

/** Totale lengte van een lijn in km. */
export function pathLengthKm(points: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversineKm(points[i - 1], points[i]);
  return total;
}

/** Cumulatieve afstand (km) per index; cumulative[0] === 0. */
export function cumulativeKm(points: LatLng[]): number[] {
  const out = new Array<number>(points.length);
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) total += haversineKm(points[i - 1], points[i]);
    out[i] = total;
  }
  return out;
}

export interface Bounds {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

export function boundsOf(points: LatLng[]): Bounds | null {
  if (points.length === 0) return null;
  let minLat = Infinity;
  let minLon = Infinity;
  let maxLat = -Infinity;
  let maxLon = -Infinity;
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }
  return { minLat, minLon, maxLat, maxLon };
}

export function boundsCenter(b: Bounds): LatLng {
  return { lat: (b.minLat + b.maxLat) / 2, lon: (b.minLon + b.maxLon) / 2 };
}

/** Lokale equirectangulaire projectie in meters rond een referentiebreedtegraad. */
function toXY(p: LatLng, cosRef: number): { x: number; y: number } {
  return { x: toRad(p.lon) * cosRef * EARTH_RADIUS_KM * 1000, y: toRad(p.lat) * EARTH_RADIUS_KM * 1000 };
}

export interface SnapResult {
  /** Index van het segment (points[index] -> points[index + 1]). */
  index: number;
  /** Fractie [0,1] langs dat segment. */
  t: number;
  point: LatLng;
  distanceM: number;
  /** Afstand langs de lijn vanaf het begin, in km (alleen exact als `cumulative` is meegegeven). */
  alongKm: number;
}

/**
 * Dichtstbijzijnde punt op de lijn. Optioneel beperkt tot segmenten [searchFrom, searchTo).
 * Geeft null bij minder dan 2 punten.
 */
export function nearestPointOnPath(
  points: LatLng[],
  p: LatLng,
  cumulative?: number[],
  searchFrom = 0,
  searchTo = points.length - 1,
): SnapResult | null {
  if (points.length < 2) return null;
  const from = Math.max(0, Math.min(searchFrom, points.length - 2));
  const to = Math.max(from + 1, Math.min(searchTo, points.length - 1));
  const cosRef = Math.cos(toRad(p.lat));
  const P = toXY(p, cosRef);
  let best: SnapResult | null = null;
  for (let i = from; i < to; i++) {
    const A = toXY(points[i], cosRef);
    const B = toXY(points[i + 1], cosRef);
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const len2 = dx * dx + dy * dy;
    let t = 0;
    if (len2 > 0) t = Math.max(0, Math.min(1, ((P.x - A.x) * dx + (P.y - A.y) * dy) / len2));
    const qx = A.x + t * dx;
    const qy = A.y + t * dy;
    const d = Math.hypot(P.x - qx, P.y - qy);
    if (!best || d < best.distanceM) {
      const point = {
        lat: points[i].lat + t * (points[i + 1].lat - points[i].lat),
        lon: points[i].lon + t * (points[i + 1].lon - points[i].lon),
      };
      const segKm = cumulative ? cumulative[i + 1] - cumulative[i] : haversineKm(points[i], points[i + 1]);
      const base = cumulative ? cumulative[i] : 0;
      best = { index: i, t, point, distanceM: d, alongKm: base + t * segKm };
    }
  }
  return best;
}

/**
 * Bochtigheidsscore: totale absolute koersverandering (graden) per kilometer.
 * Segmenten korter dan `minSegmentM` worden samengevoegd om GPS-ruis te negeren.
 */
export function curvatureScore(points: LatLng[], minSegmentM = 8): number {
  if (points.length < 3) return 0;
  const lengthKm = pathLengthKm(points);
  if (lengthKm <= 0) return 0;
  let totalTurn = 0;
  let prevBearing: number | null = null;
  let anchor = points[0];
  for (let i = 1; i < points.length; i++) {
    if (haversineM(anchor, points[i]) < minSegmentM && i < points.length - 1) continue;
    const b = bearingDeg(anchor, points[i]);
    if (prevBearing !== null) totalTurn += Math.abs(angleDiff(prevBearing, b));
    prevBearing = b;
    anchor = points[i];
  }
  return totalTurn / lengthKm;
}

/** Douglas-Peucker vereenvoudiging met tolerantie in meters (iteratief, geen recursiediepte). */
export function simplifyPath(points: LatLng[], toleranceM: number): LatLng[] {
  if (points.length <= 2 || toleranceM <= 0) return points.slice();
  const cosRef = Math.cos(toRad(points[Math.floor(points.length / 2)].lat));
  const xy = points.map((p) => toXY(p, cosRef));
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    if (e - s < 2) continue;
    const A = xy[s];
    const B = xy[e];
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const len2 = dx * dx + dy * dy;
    let maxD = -1;
    let maxI = -1;
    for (let i = s + 1; i < e; i++) {
      const P = xy[i];
      let d: number;
      if (len2 === 0) d = Math.hypot(P.x - A.x, P.y - A.y);
      else {
        const t = Math.max(0, Math.min(1, ((P.x - A.x) * dx + (P.y - A.y) * dy) / len2));
        d = Math.hypot(P.x - (A.x + t * dx), P.y - (A.y + t * dy));
      }
      if (d > maxD) {
        maxD = d;
        maxI = i;
      }
    }
    if (maxD > toleranceM && maxI > 0) {
      keep[maxI] = 1;
      stack.push([s, maxI], [maxI, e]);
    }
  }
  const out: LatLng[] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}

/** Positie op `distKm` langs de lijn (voor simulatie en voortgang). Clamp naar begin/eind. */
export function pointAlong(
  points: LatLng[],
  cumulative: number[],
  distKm: number,
): { point: LatLng; index: number; bearing: number } {
  const n = points.length;
  if (n === 0) throw new Error('pointAlong: lege lijn');
  if (n === 1 || distKm <= 0) {
    return { point: points[0], index: 0, bearing: n > 1 ? bearingDeg(points[0], points[1]) : 0 };
  }
  const total = cumulative[n - 1];
  if (distKm >= total) return { point: points[n - 1], index: n - 2, bearing: bearingDeg(points[n - 2], points[n - 1]) };
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cumulative[mid] <= distKm) lo = mid;
    else hi = mid;
  }
  const segKm = cumulative[hi] - cumulative[lo];
  const t = segKm > 0 ? (distKm - cumulative[lo]) / segKm : 0;
  const point = {
    lat: points[lo].lat + t * (points[hi].lat - points[lo].lat),
    lon: points[lo].lon + t * (points[hi].lon - points[lo].lon),
  };
  return { point, index: lo, bearing: bearingDeg(points[lo], points[hi]) };
}

/** Deterministische pseudo-random generator (mulberry32) voor reproduceerbare rondritten. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
