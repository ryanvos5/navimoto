// Valhalla-routering voor motoren (publieke server valhalla1.openstreetmap.de).
// Contract: zie CLAUDE.md, sectie "src/services/routing.ts".
import type { LatLng, Maneuver, RouteResult, RouteStyle, RoutingOptions, Waypoint } from '@/types';
import { curvatureScore, decodePolyline, haversineM, isValidLatLng, pathLengthKm, simplifyPath } from '@/lib/geo';

export type RoutingErrorCode = 'no_route' | 'network' | 'invalid' | 'server' | 'aborted';

export const ROUTING_MESSAGES: Record<RoutingErrorCode, string> = {
  no_route: 'Geen route gevonden tussen deze punten.',
  network: 'Geen verbinding met de routeserver.',
  invalid: 'Ongeldige invoer voor de routeberekening.',
  server: 'Onverwacht antwoord van de routeserver.',
  aborted: 'Routeberekening afgebroken.',
};

export class RoutingError extends Error {
  code: RoutingErrorCode;

  constructor(code: RoutingErrorCode, message: string = ROUTING_MESSAGES[code]) {
    super(message);
    this.name = 'RoutingError';
    this.code = code;
  }
}

export const VALHALLA_DEFAULT_URL = 'https://valhalla1.openstreetmap.de';
/** Maximale wachttijd per Valhalla-verzoek. */
export const ROUTE_TIMEOUT_MS = 25_000;
/** Maximaal aantal punten in een /trace_route-verzoek. */
export const MAX_TRACE_POINTS = 1000;
const TRACE_TOLERANCES_M = [5, 10, 20, 50];
/** Valhalla: "No path could be found for input". */
const NO_PATH_CODE = 442;
/** Valhalla: map matching kon geen pad vinden (442) of mislukte (444). */
const TRACE_NO_ROUTE_CODES: ReadonlySet<number> = new Set([442, 444]);
const ROUTE_NO_ROUTE_CODES: ReadonlySet<number> = new Set([NO_PATH_CODE]);
/** Manoeuvretypes voor de bestemming (4 = recht, 5 = rechts, 6 = links). */
const ARRIVE_TYPES: ReadonlySet<number> = new Set([4, 5, 6]);
/** Afstand waarbinnen twee grenspunten als hetzelfde punt gelden. */
const SAME_POINT_M = 1;

export function valhallaUrl(path: string): string {
  const base = (import.meta.env.VITE_VALHALLA_URL || VALHALLA_DEFAULT_URL).replace(/\/+$/, '');
  return base + path;
}

// ---------------------------------------------------------------------------
// Costing
// ---------------------------------------------------------------------------

/**
 * Bouwt `costing_options.motorcycle` op volgens de tabel in CLAUDE.md: de stijl bepaalt
 * use_highways/use_tolls/use_trails, het rijderstype bepaalt exclude_unpaved (en alleen bij
 * avontuurlijk ook use_trails), en de vermijd-opties overschrijven alles.
 */
export function buildCostingOptions(options: RoutingOptions): Record<string, unknown> {
  const { style, riderType, avoid } = options;
  const c: Record<string, unknown> = {};

  switch (style) {
    case 'snel':
      c.use_highways = 1.0;
      c.use_tolls = 1.0;
      c.use_trails = 0.0;
      break;
    case 'bochtig':
      c.use_highways = 0.0;
      c.use_tolls = 0.3;
      c.use_trails = 0.0;
      c.use_living_streets = 0.3;
      break;
    case 'avontuurlijk':
      c.use_highways = 0.0;
      c.use_tolls = 0.2;
      c.use_trails = riderType === 'offroad' ? 1.0 : riderType === 'allroad' ? 0.6 : 0.2;
      break;
  }

  // Street: onverhard altijd uitsluiten. Allroad/offroad: toegestaan (hoe actief het wordt opgezocht
  // volgt uit use_trails, dat alleen bij avontuurlijk van het rijderstype afhangt - snel blijft snel).
  c.exclude_unpaved = riderType === 'street';

  if (avoid.ferries) {
    c.use_ferry = 0;
    c.exclude_ferries = true;
  }
  if (avoid.highways) {
    c.use_highways = 0;
    c.exclude_highways = true;
  }
  if (avoid.tolls) {
    c.use_tolls = 0;
    c.exclude_tolls = true;
  }
  if (avoid.unpaved) c.exclude_unpaved = true;

  return c;
}

/** Kopie van de costing-opties zonder `exclude_*`-vlaggen (voor de tweede poging na fout 442). */
export function stripExcludeFlags(costing: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(costing)) {
    if (!key.startsWith('exclude_')) out[key] = value;
  }
  return out;
}

function hasActiveExcludeFlags(costing: Record<string, unknown>): boolean {
  return Object.entries(costing).some(([key, value]) => key.startsWith('exclude_') && value === true);
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

interface ValhallaReply {
  ok: boolean;
  status: number;
  json: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isAbortError(e: unknown): boolean {
  return e !== null && typeof e === 'object' && (e as { name?: unknown }).name === 'AbortError';
}

/**
 * POST naar Valhalla met een time-out van ROUTE_TIMEOUT_MS, gecombineerd met het signaal van de aanroeper.
 * Netwerkfouten en time-outs worden `network`, een afgebroken verzoek `aborted`. HTTP-fouten worden
 * teruggegeven (niet gegooid) zodat de aanroeper 442 kan afhandelen.
 */
async function postValhalla(path: string, body: unknown, signal?: AbortSignal): Promise<ValhallaReply> {
  if (signal?.aborted) throw new RoutingError('aborted');
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ROUTE_TIMEOUT_MS);
  const onAbort = (): void => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(valhallaUrl(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    return { ok: res.ok, status: res.status, json };
  } catch (e) {
    if (signal?.aborted) throw new RoutingError('aborted');
    if (timedOut) throw new RoutingError('network', 'De routeserver reageert niet (time-out).');
    if (isAbortError(e)) throw new RoutingError('aborted');
    throw new RoutingError('network');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

function errorCodeOf(reply: ValhallaReply): number | null {
  const code = asRecord(reply.json)?.error_code;
  return typeof code === 'number' ? code : null;
}

function isNoRoute(reply: ValhallaReply, codes: ReadonlySet<number>): boolean {
  const code = errorCodeOf(reply);
  return code !== null && codes.has(code);
}

/** Geeft de JSON van een geslaagd antwoord, of gooit no_route/server. */
function unwrapReply(reply: ValhallaReply, noRouteCodes: ReadonlySet<number>): unknown {
  if (reply.ok) return reply.json;
  if (isNoRoute(reply, noRouteCodes)) throw new RoutingError('no_route');
  const detail = asRecord(reply.json)?.error;
  const suffix = typeof detail === 'string' && detail ? `: ${detail}` : '';
  throw new RoutingError('server', `De routeserver gaf een fout (HTTP ${reply.status})${suffix}.`);
}

// ---------------------------------------------------------------------------
// Antwoord parsen
// ---------------------------------------------------------------------------

function malformed(): RoutingError {
  return new RoutingError('server');
}

function maneuverType(raw: unknown): number | undefined {
  return num(asRecord(raw)?.type);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function parseManeuver(raw: unknown, indexOffset: number, maxIndex: number): Maneuver {
  const m = asRecord(raw);
  const type = num(m?.type);
  const begin = num(m?.begin_shape_index);
  const end = num(m?.end_shape_index);
  if (!m || type === undefined || begin === undefined || end === undefined) throw malformed();
  const clamp = (i: number): number => Math.max(0, Math.min(maxIndex, Math.round(i) + indexOffset));
  const out: Maneuver = {
    type,
    instruction: typeof m.instruction === 'string' ? m.instruction : '',
    streetNames: Array.isArray(m.street_names) ? m.street_names.filter((s): s is string => typeof s === 'string') : [],
    lengthKm: num(m.length) ?? 0,
    timeS: num(m.time) ?? 0,
    beginIndex: clamp(begin),
    endIndex: clamp(end),
  };
  const verbalPre = optionalString(m.verbal_pre_transition_instruction);
  const verbalPost = optionalString(m.verbal_post_transition_instruction);
  const verbalAlert = optionalString(m.verbal_transition_alert_instruction);
  const bearingAfter = num(m.bearing_after);
  const roundaboutExitCount = num(m.roundabout_exit_count);
  if (verbalPre !== undefined) out.verbalPre = verbalPre;
  if (verbalPost !== undefined) out.verbalPost = verbalPost;
  if (verbalAlert !== undefined) out.verbalAlert = verbalAlert;
  if (bearingAfter !== undefined) out.bearingAfter = bearingAfter;
  if (roundaboutExitCount !== undefined) out.roundaboutExitCount = roundaboutExitCount;
  return out;
}

function flagOf(summary: Record<string, unknown> | null, key: string): boolean {
  return summary?.[key] === true;
}

function sumOf(summaries: Array<Record<string, unknown> | null>, key: string): number | undefined {
  let total = 0;
  for (const s of summaries) {
    const v = num(s?.[key]);
    if (v === undefined) return undefined;
    total += v;
  }
  return total;
}

/**
 * Zet een Valhalla `trip` om in een RouteResult: legs aaneen (dubbel grenspunt weg), manoeuvre-indices
 * globaal, bestemming-manoeuvres van niet-laatste legs weg. Gooit RoutingError('server') bij een
 * onverwachte structuur.
 */
export function parseValhallaTrip(trip: unknown): RouteResult {
  const t = asRecord(trip);
  const legsRaw = t && Array.isArray(t.legs) ? (t.legs as unknown[]) : null;
  if (!t || !legsRaw || legsRaw.length === 0) throw malformed();

  interface ParsedLeg {
    points: LatLng[];
    maneuvers: unknown[];
    summary: Record<string, unknown> | null;
    isLast: boolean;
  }
  const legs: ParsedLeg[] = legsRaw.map((legRaw, i) => {
    const leg = asRecord(legRaw);
    if (!leg || typeof leg.shape !== 'string' || !Array.isArray(leg.maneuvers)) throw malformed();
    const points = decodePolyline(leg.shape);
    if (points.length === 0) throw malformed();
    return { points, maneuvers: leg.maneuvers as unknown[], summary: asRecord(leg.summary), isLast: i === legsRaw.length - 1 };
  });

  // Geometrie aaneen: bepaal per leg de offset (globale index = offset + lokale index).
  const geometry: LatLng[] = [];
  const offsets: number[] = [];
  for (const leg of legs) {
    let points = leg.points;
    let offset = geometry.length;
    if (geometry.length > 0 && haversineM(geometry[geometry.length - 1], points[0]) < SAME_POINT_M) {
      points = points.slice(1);
      offset -= 1;
    }
    offsets.push(offset);
    for (const p of points) geometry.push(p);
  }
  const maxIndex = geometry.length - 1;

  const maneuvers: Maneuver[] = [];
  legs.forEach((leg, li) => {
    let end = leg.maneuvers.length;
    if (!leg.isLast) {
      while (end > 0) {
        const type = maneuverType(leg.maneuvers[end - 1]);
        if (type === undefined || !ARRIVE_TYPES.has(type)) break;
        end -= 1;
      }
    }
    for (let i = 0; i < end; i++) maneuvers.push(parseManeuver(leg.maneuvers[i], offsets[li], maxIndex));
  });

  const summary = asRecord(t.summary);
  const legSummaries = legs.map((l) => l.summary);
  const distanceKm = num(summary?.length) ?? sumOf(legSummaries, 'length') ?? pathLengthKm(geometry);
  const durationS = num(summary?.time) ?? sumOf(legSummaries, 'time') ?? maneuvers.reduce((s, m) => s + m.timeS, 0);
  const flag = (key: string): boolean => flagOf(summary, key) || legSummaries.some((s) => flagOf(s, key));

  return {
    geometry,
    distanceKm,
    durationS,
    maneuvers,
    hasHighway: flag('has_highway'),
    hasToll: flag('has_toll'),
    hasFerry: flag('has_ferry'),
    curvature: curvatureScore(geometry),
  };
}

/** [trip, ...alternates[].trip] uit een /route-antwoord. Het hoofdtrip is verplicht, alternatieven mogen ontbreken. */
function collectTrips(json: unknown): unknown[] {
  const root = asRecord(json);
  if (!root || !root.trip) throw malformed();
  const alternates = Array.isArray(root.alternates) ? (root.alternates as unknown[]) : [];
  return [root.trip, ...alternates.map((a) => asRecord(a)?.trip).filter((t) => t !== undefined)];
}

function chooseRouteIndex(results: RouteResult[], style: RouteStyle): number {
  let best = 0;
  for (let i = 1; i < results.length; i++) {
    const a = results[best];
    const b = results[i];
    if (style === 'snel') {
      if (b.durationS < a.durationS) best = i;
    } else if (
      b.curvature > a.curvature ||
      (style === 'avontuurlijk' && b.curvature === a.curvature && b.distanceKm > a.distanceKm)
    ) {
      best = i;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// /route
// ---------------------------------------------------------------------------

function buildRouteBody(locations: Waypoint[], style: RouteStyle, costing: Record<string, unknown>): Record<string, unknown> {
  const last = locations.length - 1;
  return {
    locations: locations.map((l, i) => ({ lat: l.lat, lon: l.lon, type: i === 0 || i === last ? 'break' : 'through' })),
    costing: 'motorcycle',
    costing_options: { motorcycle: costing },
    units: 'kilometers',
    language: 'nl-NL',
    alternates: style === 'snel' ? 0 : 3,
  };
}

/**
 * Berekent een route en geeft [beste, ...overige] terug. Bochtig/avontuurlijk vragen alternatieven en
 * kiezen op bochtigheid; snel kiest de kortste tijd.
 */
export async function routeWithAlternatives(
  locations: Waypoint[],
  options: RoutingOptions,
  signal?: AbortSignal,
): Promise<RouteResult[]> {
  if (locations.length < 2 || !locations.every((l) => isValidLatLng(l))) {
    throw new RoutingError('invalid', 'Minimaal twee geldige locaties nodig.');
  }
  const costing = buildCostingOptions(options);
  let reply = await postValhalla('/route', buildRouteBody(locations, options.style, costing), signal);
  if (!reply.ok && isNoRoute(reply, ROUTE_NO_ROUTE_CODES) && hasActiveExcludeFlags(costing)) {
    // Tweede poging zonder harde uitsluitingen (alleen use_* = 0).
    reply = await postValhalla('/route', buildRouteBody(locations, options.style, stripExcludeFlags(costing)), signal);
  }
  const json = unwrapReply(reply, ROUTE_NO_ROUTE_CODES);
  const [main, ...alternates] = collectTrips(json);
  const results: RouteResult[] = [parseValhallaTrip(main)];
  for (const alt of alternates) {
    try {
      results.push(parseValhallaTrip(alt));
    } catch {
      // Een kapot alternatief mag de hoofdroute niet kosten.
    }
  }
  const best = chooseRouteIndex(results, options.style);
  return [results[best], ...results.filter((_, i) => i !== best)];
}

export async function route(locations: Waypoint[], options: RoutingOptions, signal?: AbortSignal): Promise<RouteResult> {
  const [best] = await routeWithAlternatives(locations, options, signal);
  return best;
}

// ---------------------------------------------------------------------------
// /trace_route (map matching van een GPX-spoor)
// ---------------------------------------------------------------------------

function downsampleEven(points: LatLng[], max: number): LatLng[] {
  if (points.length <= max) return points;
  const out: LatLng[] = [];
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]);
  return out;
}

/**
 * Vereenvoudigt een spoor tot maximaal `maxPoints` punten: Douglas-Peucker met oplopende tolerantie
 * (5, 10, 20, 50 m), daarna gelijkmatig uitdunnen met behoud van begin- en eindpunt.
 */
export function prepareTraceShape(points: LatLng[], maxPoints = MAX_TRACE_POINTS): LatLng[] {
  if (points.length <= maxPoints) return points.slice();
  let simplified = points;
  for (const tolerance of TRACE_TOLERANCES_M) {
    simplified = simplifyPath(points, tolerance);
    if (simplified.length <= maxPoints) return simplified;
  }
  return downsampleEven(simplified, maxPoints);
}

function buildTraceBody(
  points: LatLng[],
  costing: Record<string, unknown>,
  shapeMatch: 'map_snap' | 'walk_or_snap',
): Record<string, unknown> {
  return {
    shape: points.map((p) => ({ lat: p.lat, lon: p.lon })),
    costing: 'motorcycle',
    costing_options: { motorcycle: costing },
    shape_match: shapeMatch,
    units: 'kilometers',
    language: 'nl-NL',
  };
}

export async function traceRoute(shape: LatLng[], options: RoutingOptions, signal?: AbortSignal): Promise<RouteResult> {
  if (shape.length < 2 || !shape.every((p) => isValidLatLng(p))) {
    throw new RoutingError('invalid', 'Een spoor heeft minimaal twee geldige punten nodig.');
  }
  const points = prepareTraceShape(shape);
  const costing = buildCostingOptions(options);
  let reply = await postValhalla('/trace_route', buildTraceBody(points, costing, 'map_snap'), signal);
  if (!reply.ok && reply.status >= 400 && reply.status < 500) {
    // map_snap is streng; walk_or_snap accepteert sporen met gaten of ruis.
    reply = await postValhalla('/trace_route', buildTraceBody(points, costing, 'walk_or_snap'), signal);
  }
  const json = unwrapReply(reply, TRACE_NO_ROUTE_CODES);
  return parseValhallaTrip(asRecord(json)?.trip);
}

// ---------------------------------------------------------------------------
// Samenvoegen
// ---------------------------------------------------------------------------

/** Plakt route b achter route a (bijv. aanrijroute + gematcht GPX-spoor). */
export function concatRoutes(a: RouteResult, b: RouteResult): RouteResult {
  const geometry = a.geometry.slice();
  let bPoints = b.geometry;
  let offset = geometry.length;
  if (geometry.length > 0 && bPoints.length > 0 && haversineM(geometry[geometry.length - 1], bPoints[0]) < SAME_POINT_M) {
    bPoints = bPoints.slice(1);
    offset -= 1;
  }
  for (const p of bPoints) geometry.push(p);

  const aManeuvers = a.maneuvers.slice();
  const lastA = aManeuvers[aManeuvers.length - 1];
  if (lastA && ARRIVE_TYPES.has(lastA.type)) aManeuvers.pop();
  const bManeuvers = b.maneuvers.map((m) => ({ ...m, beginIndex: m.beginIndex + offset, endIndex: m.endIndex + offset }));

  return {
    geometry,
    distanceKm: a.distanceKm + b.distanceKm,
    durationS: a.durationS + b.durationS,
    maneuvers: [...aManeuvers, ...bManeuvers],
    hasHighway: a.hasHighway || b.hasHighway,
    hasToll: a.hasToll || b.hasToll,
    hasFerry: a.hasFerry || b.hasFerry,
    curvature: curvatureScore(geometry),
  };
}
