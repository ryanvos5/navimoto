// GPX-bestand omzetten naar een NewRoute voor useRides.saveRoute ("GPX importeren" op de Ritten-tab).
// Puur; parseGpx gebruikt DOMParser (browser + jsdom) - getest in gpxImport.test.ts.
import type { LatLng, Waypoint } from '@/types';
import { pathLengthKm, simplifyPath } from '@/lib/geo';
import { GpxError, parseGpx, type ParsedGpx } from '@/lib/gpx';
import type { NewRoute } from '@/store/useRides';

/** Boven dit aantal punten wordt de lijn eerst vereenvoudigd (Douglas-Peucker, 2 m). */
export const SIMPLIFY_ABOVE_POINTS = 5000;
/** Harde bovengrens voor het aantal punten van een geïmporteerde route. */
export const MAX_IMPORT_POINTS = 8000;
/** Bij meer benoemde via-punten in een <rte> worden ze niet overgenomen (alleen begin en eind). */
export const MAX_NAMED_WAYPOINTS = 10;
export const FALLBACK_ROUTE_NAME = 'Geïmporteerde route';
const SIMPLIFY_TOLERANCE_M = 2;

/** Bestandsnaam zonder map en zonder extensie: "C:\\ritten\\Veluwe-rit.GPX" → "Veluwe-rit". */
export function baseName(fileName: string): string {
  const withoutDir = (fileName ?? '').split(/[\\/]/).pop() ?? '';
  const trimmed = withoutDir.trim();
  const dot = trimmed.lastIndexOf('.');
  return (dot >= 0 ? trimmed.slice(0, dot) : trimmed).trim();
}

/** Gelijkmatig uitdunnen tot `max` punten, met behoud van begin- en eindpunt. */
export function downsampleEven<T>(points: T[], max: number): T[] {
  if (points.length <= max || max < 2) return points.slice();
  const out: T[] = [];
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]);
  return out;
}

const samePoint = (a: LatLng, b: LatLng): boolean => a.lat === b.lat && a.lon === b.lon;

/** Verwijdert opeenvolgende gelijke punten; een naam blijft behouden als een van beide er een heeft. */
export function dedupeConsecutive(points: Waypoint[]): Waypoint[] {
  const out: Waypoint[] = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (prev && samePoint(prev, p)) {
      if (!prev.name && p.name) out[out.length - 1] = { ...prev, name: p.name };
      continue;
    }
    out.push({ ...p });
  }
  return out;
}

/**
 * De benoemde <rtept>'s van een route, in routevolgorde. ParsedGpx.waypoints bevat ook losse <wpt>'s;
 * die onderscheiden we doordat een rtept precies op een lijnpunt ligt.
 */
function namedRoutePoints(parsed: ParsedGpx): Waypoint[] {
  const onLine = new Set(parsed.points.map((p) => `${p.lat},${p.lon}`));
  return parsed.waypoints.filter((w) => !!w.name?.trim() && onLine.has(`${w.lat},${w.lon}`));
}

/**
 * Zet GPX-tekst om naar een op te slaan route (kind 'gpx'). Gooit GpxError bij ongeldige invoer of als
 * het bestand alleen losse waypoints bevat (geen lijn om te tonen of te rijden).
 */
export function gpxToNewRoute(text: string, fileName: string): NewRoute {
  const parsed = parseGpx(text);
  if (parsed.points.length < 2) {
    throw new GpxError('Dit GPX-bestand bevat alleen losse waypoints, geen route of spoor.');
  }

  let geometry: LatLng[] = parsed.points;
  if (geometry.length > SIMPLIFY_ABOVE_POINTS) geometry = simplifyPath(geometry, SIMPLIFY_TOLERANCE_M);
  if (geometry.length > MAX_IMPORT_POINTS) geometry = downsampleEven(geometry, MAX_IMPORT_POINTS);

  const first = parsed.points[0];
  const last = parsed.points[parsed.points.length - 1];
  const vias = parsed.kind === 'route' ? namedRoutePoints(parsed) : [];
  const waypoints = dedupeConsecutive([{ ...first }, ...(vias.length <= MAX_NAMED_WAYPOINTS ? vias : []), { ...last }]);

  const name = parsed.name?.trim() || baseName(fileName) || FALLBACK_ROUTE_NAME;

  let durationS: number | null = null;
  if (parsed.hasTimes) {
    const tp = parsed.trackPoints;
    const span = (tp[tp.length - 1].t - tp[0].t) / 1000;
    durationS = span > 0 ? span : null;
  }

  return {
    name,
    kind: 'gpx',
    waypoints,
    style: null,
    avoid: null,
    geometry,
    distanceKm: pathLengthKm(geometry),
    durationS,
    maneuvers: null,
    gpx: text,
  };
}
