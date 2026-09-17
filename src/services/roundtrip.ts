// Rondritgenerator: zet via-punten op een ruwe driehoek rond de start en laat Valhalla de lus routeren.
// Contract: zie CLAUDE.md, sectie "src/services/roundtrip.ts".
import type { LatLng, RouteResult, RoundTripOptions, RoutingOptions, Waypoint } from '@/types';
import { destinationPoint, isValidLatLng, seededRandom } from '@/lib/geo';
import { RoutingError, route } from '@/services/routing';

export interface RoundTripResult {
  route: RouteResult;
  waypoints: Waypoint[];
  seed: number;
  bearingDeg: number;
}

/** Maximaal aantal routeberekeningen met een aangepaste straal. */
export const MAX_RADIUS_ATTEMPTS = 3;
/** Extra pogingen met een andere richting als er geen route gevonden wordt. */
export const MAX_BEARING_RETRIES = 3;
/** Afwijking van de doelafstand die we accepteren zonder opnieuw te proberen. */
export const ACCEPTABLE_DEVIATION = 0.12;
/** Maximale hoekafwijking (+/-) per via-punt, in graden. */
export const BEARING_JITTER_DEG = 25;
const RADIUS_SCALE_MIN = 0.5;
const RADIUS_SCALE_MAX = 2;
/** Hoeken van de via-punten ten opzichte van de hoofdrichting, en hun afstandsfactor. */
const VIA_LAYOUT: ReadonlyArray<{ angle: number; radiusFactor: number }> = [
  { angle: 0, radiusFactor: 0.9 },
  { angle: 120, radiusFactor: 1.1 },
  { angle: 240, radiusFactor: 0.9 },
];

/**
 * Straal van de lus in km voor een gewenste omtrek. Empirisch bepaald op de Valhalla-server
 * (17-09-2026, Utrecht/Arnhem/Eindhoven, 60-200 km): met de via-indeling hieronder is de gereden
 * lus ~7-8x de straal, dus target/7.5 geeft een eerste poging die binnen ~10-20% van het doel zit.
 */
export const LOOP_LENGTH_PER_RADIUS = 7.5;
export function estimateLoopRadiusKm(targetKm: number): number {
  return targetKm / LOOP_LENGTH_PER_RADIUS;
}

function randomSeed(): number {
  return Math.floor(Math.random() * 0x100000000);
}

function normalizeBearing(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** start -> v1 -> v2 -> v3 -> start; de via's krijgen in de routeringsdienst automatisch type "through". */
function buildLoopWaypoints(start: LatLng, bearing: number, radiusKm: number, jitters: number[]): Waypoint[] {
  const startWp: Waypoint = { lat: start.lat, lon: start.lon };
  const vias = VIA_LAYOUT.map(({ angle, radiusFactor }, i) =>
    destinationPoint(start, normalizeBearing(bearing + angle + jitters[i]), radiusKm * radiusFactor),
  );
  return [startWp, ...vias, { ...startWp }];
}

interface Attempt {
  route: RouteResult;
  waypoints: Waypoint[];
  bearingDeg: number;
  deviation: number;
}

export async function generateRoundTrip(opts: RoundTripOptions, signal?: AbortSignal): Promise<RoundTripResult> {
  const target = opts.targetDistanceKm;
  if (!isValidLatLng(opts.start) || !Number.isFinite(target) || target <= 0) {
    throw new RoutingError('invalid', 'Ongeldig startpunt of ongeldige afstand voor de rondrit.');
  }
  const routingOptions: RoutingOptions = { style: opts.style, avoid: opts.avoid, riderType: opts.riderType };
  const seed = opts.seed ?? randomSeed();
  const rng = seededRandom(seed);
  let bearing = normalizeBearing(opts.bearingDeg ?? rng() * 360);
  // De jitter per via-punt staat vast per seed, zodat schalen van de straal de vorm van de lus behoudt.
  const jitters = VIA_LAYOUT.map(() => (rng() * 2 - 1) * BEARING_JITTER_DEG);
  let radiusKm = estimateLoopRadiusKm(target);

  let best: Attempt | null = null;
  let attempts = 0;
  let bearingRetries = 0;
  while (attempts < MAX_RADIUS_ATTEMPTS) {
    if (signal?.aborted) throw new RoutingError('aborted');
    const waypoints = buildLoopWaypoints(opts.start, bearing, radiusKm, jitters);
    let result: RouteResult;
    try {
      result = await route(waypoints, routingOptions, signal);
    } catch (e) {
      if (e instanceof RoutingError && e.code === 'no_route' && bearingRetries < MAX_BEARING_RETRIES) {
        bearingRetries += 1;
        bearing = normalizeBearing(bearing + 90);
        continue;
      }
      throw e;
    }
    attempts += 1;
    const deviation = Math.abs(result.distanceKm - target) / target;
    if (!best || deviation < best.deviation) best = { route: result, waypoints, bearingDeg: bearing, deviation };
    if (deviation <= ACCEPTABLE_DEVIATION) break;
    const actual = result.distanceKm > 0 ? result.distanceKm : target;
    radiusKm *= clamp(target / actual, RADIUS_SCALE_MIN, RADIUS_SCALE_MAX);
  }

  if (!best) throw new RoutingError('no_route', 'Geen rondrit gevonden vanaf dit punt.');
  return { route: best.route, waypoints: best.waypoints, seed, bearingDeg: best.bearingDeg };
}
