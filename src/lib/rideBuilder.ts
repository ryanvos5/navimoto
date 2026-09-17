// Maakt van een opgeslagen route een rijdbare RouteResult voor useNavigation.start().
// Contract: zie CLAUDE.md, sectie "src/lib/rideBuilder.ts". Getest in rideBuilder.test.ts (routing gemockt).
import type { LatLng, Maneuver, RouteResult, RoutingOptions, SavedRoute, Waypoint } from '@/types';
import { curvatureScore, haversineM } from '@/lib/geo';
import { concatRoutes, route, traceRoute } from '@/services/routing';

/**
 * Binnen deze afstand van het begin van de route wordt de opgeslagen geometrie hergebruikt
 * (planned/roundtrip) of geen aanrijroute gemaakt (gpx).
 */
export const REUSE_DISTANCE_M = 300;

/** Valhalla-manoeuvretypes voor veerponten (28 = oprijden, 29 = afrijden). */
const FERRY_TYPES: ReadonlySet<number> = new Set([28, 29]);

/** RouteResult uit de opgeslagen geometrie en manoeuvres (zonder nieuwe routeberekening). */
function fromSaved(saved: SavedRoute, maneuvers: Maneuver[]): RouteResult {
  const durationS = saved.durationS ?? maneuvers.reduce((sum, m) => sum + m.timeS, 0);
  return {
    geometry: saved.geometry,
    distanceKm: saved.distanceKm,
    durationS,
    maneuvers,
    hasHighway: false,
    hasToll: false,
    hasFerry: maneuvers.some((m) => FERRY_TYPES.has(m.type)),
    curvature: curvatureScore(saved.geometry),
  };
}

function hasManeuvers(saved: SavedRoute): saved is SavedRoute & { maneuvers: Maneuver[] } {
  return saved.maneuvers !== null && saved.maneuvers.length > 0 && saved.geometry.length >= 2;
}

function isNear(from: LatLng | null, point: LatLng | undefined): boolean {
  return from === null || point === undefined || haversineM(from, point) <= REUSE_DISTANCE_M;
}

/**
 * - planned/roundtrip met manoeuvres en `from` binnen 300 m van het begin (of onbekend): opgeslagen
 *   geometrie en manoeuvres hergebruiken.
 * - anders planned/roundtrip: route([from, ...waypoints]) (zonder `from`: route(waypoints); een rondrit
 *   eindigt al op de start).
 * - gpx: het spoor map-matchen met traceRoute (of de eerder gematchte manoeuvres hergebruiken) en als
 *   `from` meer dan 300 m van het begin ligt een aanrijroute ervoor plakken.
 */
export async function buildRideFromSavedRoute(
  saved: SavedRoute,
  from: LatLng | null,
  options: RoutingOptions,
  signal?: AbortSignal,
): Promise<RouteResult> {
  if (saved.kind === 'gpx') {
    const matched = hasManeuvers(saved) ? fromSaved(saved, saved.maneuvers) : await traceRoute(saved.geometry, options, signal);
    const begin = matched.geometry[0];
    if (from !== null && begin !== undefined && !isNear(from, begin)) {
      const approach = await route([from, begin], options, signal);
      return concatRoutes(approach, matched);
    }
    return matched;
  }

  if (hasManeuvers(saved) && isNear(from, saved.geometry[0])) return fromSaved(saved, saved.maneuvers);

  const locations: Waypoint[] = from !== null ? [from, ...saved.waypoints] : saved.waypoints;
  return route(locations, options, signal);
}
