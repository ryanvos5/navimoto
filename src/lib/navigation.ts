// Navigatielogica voor een actieve rit: snappen op de route, volgende manoeuvre, aankomst,
// resterende waypoints, spraakafstanden en de samenvatting van een opname.
// Puur en zonder React/stores - getest in navigation.test.ts. De store (useNavigation) beslist
// zelf over "van de route af" (daar is geschiedenis voor nodig) en over herberekenen.
import type { LatLng, Maneuver, RouteResult, TrackPoint, Waypoint } from '@/types';
import { cumulativeKm, haversineKm, haversineM, nearestPointOnPath, pathLengthKm, type SnapResult } from '@/lib/geo';

/** Verder dan dit van de lijn = (kandidaat) van de route af. */
export const OFF_ROUTE_DISTANCE_M = 60;
/** Zoveel opeenvolgende posities buiten OFF_ROUTE_DISTANCE_M = echt van de route af. */
export const OFF_ROUTE_CONSECUTIVE = 3;
/** Binnen deze afstand (hemelsbreed) van het eindpunt = aangekomen (zie ARRIVAL_SLACK_KM). */
export const ARRIVAL_DISTANCE_M = 30;
/** Aantal punten vooruit dat rond de vorige index wordt gezocht. */
export const SEARCH_WINDOW = 200;
/** Aantal punten achteruit dat rond de vorige index wordt gezocht (GPS-sprongen terug). */
export const SEARCH_BACK = 50;
/** Aangekomen zodra er langs de route minder dan dit overblijft. */
export const ARRIVAL_REMAINING_KM = 0.03;
/**
 * De hemelsbrede aankomstcontrole (ARRIVAL_DISTANCE_M) telt alleen als er langs de route ook niet veel
 * meer over is. Zonder deze marge zou een rondrit (start = einde) meteen bij vertrek "aangekomen" zijn.
 */
export const ARRIVAL_SLACK_KM = 0.25;
/** Waypoints die minder dan dit voor de huidige positie liggen gelden als bereikt. */
export const WAYPOINT_AHEAD_KM = 0.05;
/** Ondergrens (km/u) waarboven een opnamepunt als "rijdend" telt. */
export const MOVING_SPEED_KMH = 3;

/** Valhalla-manoeuvretypes: vertrek (1 = start, 2 = start rechts, 3 = start links). */
export const START_TYPES: ReadonlySet<number> = new Set([1, 2, 3]);
/** Valhalla-manoeuvretypes: bestemming (4 = recht, 5 = rechts, 6 = links). */
export const ARRIVE_TYPES: ReadonlySet<number> = new Set([4, 5, 6]);

export function isStartManeuver(m: Maneuver): boolean {
  return START_TYPES.has(m.type);
}

export function isArriveManeuver(m: Maneuver): boolean {
  return ARRIVE_TYPES.has(m.type);
}

export interface NavProgress {
  /** Afgelegde afstand langs de route (km). */
  alongKm: number;
  remainingKm: number;
  remainingS: number;
  /** Wordt hier altijd false gezet: de store beslist op basis van opeenvolgende posities. */
  offRoute: boolean;
  nextManeuver: Maneuver | null;
  /** Afstand tot nextManeuver in meters (nooit negatief); 0 als er geen volgende manoeuvre is. */
  distanceToNextM: number;
  /** Index van nextManeuver in route.maneuvers, of -1. */
  maneuverIndex: number;
  /** Segmentindex waarop is gesnapt (voor het zoekvenster van de volgende positie). */
  snapIndex: number;
  snapPoint: LatLng;
  /** Hemelsbrede afstand van de positie tot de route (m). */
  distanceFromRouteM: number;
  arrived: boolean;
}

function fallbackSnap(geometry: LatLng[], position: LatLng): SnapResult {
  const anchor = geometry[0];
  if (!anchor) return { index: 0, t: 0, point: position, distanceM: 0, alongKm: 0 };
  return { index: 0, t: 0, point: anchor, distanceM: haversineM(position, anchor), alongKm: 0 };
}

/**
 * Snapt de positie op de route: eerst in een venster [prevIndex - SEARCH_BACK, prevIndex + SEARCH_WINDOW],
 * en als dat verder dan OFF_ROUTE_DISTANCE_M oplevert ook over de hele lijn (de dichtstbijzijnde wint).
 */
function snapToRoute(geometry: LatLng[], cumulative: number[], position: LatLng, prevIndex: number | null): SnapResult {
  if (geometry.length < 2) return fallbackSnap(geometry, position);
  let best: SnapResult | null = null;
  if (prevIndex !== null) {
    best = nearestPointOnPath(geometry, position, cumulative, prevIndex - SEARCH_BACK, prevIndex + SEARCH_WINDOW);
  }
  if (best === null || best.distanceM > OFF_ROUTE_DISTANCE_M) {
    const global = nearestPointOnPath(geometry, position, cumulative);
    if (global && (best === null || global.distanceM < best.distanceM)) best = global;
  }
  return best ?? fallbackSnap(geometry, position);
}

/**
 * Volgende manoeuvre: de eerste met beginIndex > snap.index, of beginIndex === snap.index zolang t < 1.
 * Vertrekmanoeuvres (type 1/2/3) tellen alleen zolang er nog niet gereden is (t === 0).
 */
function findNextManeuver(maneuvers: Maneuver[], snap: SnapResult): { maneuver: Maneuver | null; index: number } {
  for (let i = 0; i < maneuvers.length; i++) {
    const m = maneuvers[i];
    if (m.beginIndex > snap.index) return { maneuver: m, index: i };
    if (m.beginIndex === snap.index && snap.t < 1) {
      if (START_TYPES.has(m.type) && snap.t > 0) continue;
      return { maneuver: m, index: i };
    }
  }
  return { maneuver: null, index: -1 };
}

/**
 * Voortgang van `position` langs `route`. `cumulative` is cumulativeKm(route.geometry) (door de aanroeper
 * gecachet); `prevIndex` is de snapIndex van de vorige positie of null bij de eerste.
 */
export function computeProgress(route: RouteResult, cumulative: number[], position: LatLng, prevIndex: number | null): NavProgress {
  const geometry = route.geometry;
  const n = geometry.length;
  const total = n > 0 ? (cumulative[n - 1] ?? 0) : 0;

  const snap = snapToRoute(geometry, cumulative, position, prevIndex);
  const alongKm = Math.min(total, Math.max(0, snap.alongKm));
  const remainingKm = Math.max(0, total - alongKm);
  const denominatorKm = route.distanceKm > 0 ? route.distanceKm : total;
  const remainingS = denominatorKm > 0 ? Math.max(0, (remainingKm / denominatorKm) * route.durationS) : 0;

  const { maneuver, index } = findNextManeuver(route.maneuvers, snap);
  const distanceToNextM = maneuver ? Math.max(0, ((cumulative[maneuver.beginIndex] ?? total) - alongKm) * 1000) : 0;

  const endDistanceM = n > 0 ? haversineM(position, geometry[n - 1]) : 0;
  const arrived = remainingKm <= ARRIVAL_REMAINING_KM || (endDistanceM <= ARRIVAL_DISTANCE_M && remainingKm <= ARRIVAL_SLACK_KM);

  return {
    alongKm,
    remainingKm,
    remainingS,
    offRoute: false,
    nextManeuver: maneuver,
    distanceToNextM,
    maneuverIndex: index,
    snapIndex: snap.index,
    snapPoint: snap.point,
    distanceFromRouteM: snap.distanceM,
    arrived,
  };
}

export type ManeuverIconName =
  | 'start'
  | 'straight'
  | 'slight-right'
  | 'right'
  | 'sharp-right'
  | 'uturn'
  | 'slight-left'
  | 'left'
  | 'sharp-left'
  | 'ramp-right'
  | 'ramp-left'
  | 'exit-right'
  | 'exit-left'
  | 'merge'
  | 'roundabout'
  | 'ferry'
  | 'arrive';

const ICON_BY_TYPE: Record<number, ManeuverIconName> = {
  1: 'start',
  2: 'start',
  3: 'start',
  4: 'arrive',
  5: 'arrive',
  6: 'arrive',
  7: 'straight',
  8: 'straight',
  9: 'slight-right',
  10: 'right',
  11: 'sharp-right',
  12: 'uturn',
  13: 'uturn',
  14: 'sharp-left',
  15: 'left',
  16: 'slight-left',
  17: 'straight',
  18: 'ramp-right',
  19: 'ramp-left',
  20: 'exit-right',
  21: 'exit-left',
  22: 'straight',
  23: 'slight-right', // stay right
  24: 'slight-left', // stay left
  25: 'merge',
  26: 'roundabout', // roundabout enter
  27: 'roundabout', // roundabout exit
  28: 'ferry', // ferry enter
  29: 'ferry', // ferry exit
  37: 'merge', // merge right
  38: 'merge', // merge left
};

/** Icoonnaam voor een Valhalla-manoeuvretype; onbekende types tonen rechtdoor. */
export function maneuverIconName(type: number): ManeuverIconName {
  return ICON_BY_TYPE[type] ?? 'straight';
}

/**
 * De waypoints (zonder de eerste) die nog voor de rijder liggen: hun dichtstbijzijnde positie langs de
 * geometrie ligt voorbij alongKm + WAYPOINT_AHEAD_KM. Het laatste waypoint (de bestemming) zit er altijd in.
 */
export function remainingWaypoints(route: RouteResult, waypoints: Waypoint[], alongKm: number): Waypoint[] {
  if (waypoints.length === 0) return [];
  const last = waypoints[waypoints.length - 1];
  const middle = waypoints.slice(1, -1);
  if (middle.length === 0) return [last];
  const cumulative = cumulativeKm(route.geometry);
  const threshold = alongKm + WAYPOINT_AHEAD_KM;
  const ahead = middle.filter((wp) => {
    const snap = nearestPointOnPath(route.geometry, wp, cumulative);
    return snap !== null && snap.alongKm > threshold;
  });
  return [...ahead, last];
}

/** Afstanden waarop een manoeuvre wordt aangekondigd: vroege waarschuwing en de instructie vlak ervoor. */
export function speechDistances(speedKmh: number | null): { alertM: number; preM: number } {
  const fast = speedKmh !== null && Number.isFinite(speedKmh) && speedKmh > 70;
  return fast ? { alertM: 500, preM: 100 } : { alertM: 300, preM: 60 };
}

export interface TrackSummary {
  distanceKm: number;
  durationS: number;
  /** Tijd tussen opeenvolgende punten waarop sneller dan MOVING_SPEED_KMH werd gereden. */
  movingS: number;
  /** Gemiddelde over de rijdende tijd (0 als er niet is gereden). */
  avgSpeedKmh: number;
  /** Hoogste snelheid uit de puntsnelheden (0 als die ontbreken). */
  maxSpeedKmh: number;
}

/** Samenvatting van een opname voor RiddenTrack. Ontbreekt speedKmh op een punt, dan wordt die uit afstand/tijd afgeleid. */
export function buildTrackSummary(points: TrackPoint[], startedAt: number, endedAt: number): TrackSummary {
  const distanceKm = pathLengthKm(points);
  const durationS = Math.max(0, (endedAt - startedAt) / 1000);
  let movingS = 0;
  let maxSpeedKmh = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.speedKmh !== undefined && Number.isFinite(p.speedKmh) && p.speedKmh > maxSpeedKmh) maxSpeedKmh = p.speedKmh;
    if (i === 0) continue;
    const prev = points[i - 1];
    const dtS = (p.t - prev.t) / 1000;
    if (!(dtS > 0)) continue;
    const speedKmh = p.speedKmh !== undefined && Number.isFinite(p.speedKmh) ? p.speedKmh : (haversineKm(prev, p) / dtS) * 3600;
    if (speedKmh > MOVING_SPEED_KMH) movingS += dtS;
  }
  const avgSpeedKmh = movingS > 0 ? distanceKm / (movingS / 3600) : 0;
  return { distanceKm, durationS, movingS, avgSpeedKmh, maxSpeedKmh };
}
