// Cloud-synchronisatie met Supabase (tabellen navimoto_profiles / navimoto_routes / navimoto_tracks).
// Local-first: IndexedDB blijft de bron voor de UI; deze module spiegelt wijzigingen naar de cloud en
// haalt bij het laden de cloudrijen op zodat ritten op elk toestel beschikbaar zijn.
// Alle functies zijn no-ops (of geven null/[] terug) als Supabase niet is geconfigureerd of de
// gebruiker een gast is.
import type { AvoidOptions, Maneuver, MapStyleId, RiddenTrack, RiderType, RouteKind, RouteStyle, SavedRoute, TrackPoint, UserProfile, Waypoint, LatLng } from '@/types';
import { DEFAULT_AVOID } from '@/types';
import { getSupabaseClient } from './supabaseClient';

const GUEST_ID = 'guest';

export function cloudEnabledFor(userId: string | null | undefined): boolean {
  return !!userId && userId !== GUEST_ID && getSupabaseClient() !== null;
}

const toIso = (ms: number): string => new Date(ms).toISOString();
const fromIso = (value: unknown, fallback = 0): number => {
  if (typeof value !== 'string') return fallback;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : fallback;
};

// ---------------------------------------------------------------------------
// Rij-mapping
// ---------------------------------------------------------------------------

interface ProfileRow {
  id: string;
  email: string;
  display_name: string;
  rider_type: RiderType;
  default_style: RouteStyle;
  default_avoid: AvoidOptions;
  voice_enabled: boolean;
  map_style: MapStyleId;
  simulate_rides: boolean;
  created_at: string;
  updated_at: string;
}

interface RouteRow {
  id: string;
  user_id: string;
  name: string;
  kind: RouteKind;
  waypoints: Waypoint[];
  style: RouteStyle | null;
  avoid: AvoidOptions | null;
  geometry: LatLng[];
  distance_km: number;
  duration_s: number | null;
  maneuvers: Maneuver[] | null;
  gpx: string | null;
  created_at: string;
  updated_at: string;
}

interface TrackRow {
  id: string;
  user_id: string;
  name: string;
  started_at: string;
  ended_at: string;
  points: TrackPoint[];
  distance_km: number;
  duration_s: number;
  moving_s: number;
  avg_speed_kmh: number;
  max_speed_kmh: number;
  route_id: string | null;
  created_at?: string;
  updated_at?: string;
}

export function profileToRow(p: UserProfile): ProfileRow {
  return {
    id: p.id,
    email: p.email,
    display_name: p.displayName,
    rider_type: p.riderType,
    default_style: p.defaultStyle,
    default_avoid: p.defaultAvoid,
    voice_enabled: p.voiceEnabled,
    map_style: p.mapStyle,
    simulate_rides: p.simulateRides,
    created_at: toIso(p.createdAt),
    updated_at: toIso(p.updatedAt),
  };
}

export function rowToProfile(r: ProfileRow): UserProfile {
  return {
    id: r.id,
    email: r.email ?? '',
    displayName: r.display_name ?? '',
    riderType: r.rider_type ?? 'street',
    defaultStyle: r.default_style ?? 'bochtig',
    defaultAvoid: { ...DEFAULT_AVOID, ...(r.default_avoid ?? {}) },
    voiceEnabled: r.voice_enabled ?? true,
    mapStyle: r.map_style ?? 'light',
    simulateRides: r.simulate_rides ?? false,
    createdAt: fromIso(r.created_at, Date.now()),
    updatedAt: fromIso(r.updated_at, Date.now()),
  };
}

export function routeToRow(r: SavedRoute): RouteRow {
  return {
    id: r.id,
    user_id: r.userId,
    name: r.name,
    kind: r.kind,
    waypoints: r.waypoints,
    style: r.style,
    avoid: r.avoid,
    geometry: r.geometry,
    distance_km: r.distanceKm,
    duration_s: r.durationS,
    maneuvers: r.maneuvers,
    gpx: r.gpx,
    created_at: toIso(r.createdAt),
    updated_at: toIso(r.updatedAt),
  };
}

export function rowToRoute(r: RouteRow): SavedRoute {
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    kind: r.kind,
    waypoints: r.waypoints ?? [],
    style: r.style ?? null,
    avoid: r.avoid ?? null,
    geometry: r.geometry ?? [],
    distanceKm: r.distance_km ?? 0,
    durationS: r.duration_s ?? null,
    maneuvers: r.maneuvers ?? null,
    gpx: r.gpx ?? null,
    createdAt: fromIso(r.created_at),
    updatedAt: fromIso(r.updated_at),
  };
}

export function trackToRow(t: RiddenTrack): TrackRow {
  return {
    id: t.id,
    user_id: t.userId,
    name: t.name,
    started_at: toIso(t.startedAt),
    ended_at: toIso(t.endedAt),
    points: t.points,
    distance_km: t.distanceKm,
    duration_s: t.durationS,
    moving_s: t.movingS,
    avg_speed_kmh: t.avgSpeedKmh,
    max_speed_kmh: t.maxSpeedKmh,
    route_id: t.routeId,
    updated_at: toIso(Date.now()),
  };
}

export function rowToTrack(r: TrackRow): RiddenTrack {
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    startedAt: fromIso(r.started_at),
    endedAt: fromIso(r.ended_at),
    points: r.points ?? [],
    distanceKm: r.distance_km ?? 0,
    durationS: r.duration_s ?? 0,
    movingS: r.moving_s ?? 0,
    avgSpeedKmh: r.avg_speed_kmh ?? 0,
    maxSpeedKmh: r.max_speed_kmh ?? 0,
    routeId: r.route_id ?? null,
  };
}

// ---------------------------------------------------------------------------
// Cloud-operaties (gooien bij fouten; de stores vangen dat op)
// ---------------------------------------------------------------------------

async function client() {
  const p = getSupabaseClient();
  if (!p) throw new Error('Supabase is niet geconfigureerd');
  return p;
}

function check<T>(result: { data: T | null; error: { message: string } | null }): T | null {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export async function pullProfile(userId: string): Promise<UserProfile | null> {
  const c = await client();
  const data = check(await c.from('navimoto_profiles').select('*').eq('id', userId).maybeSingle<ProfileRow>());
  return data ? rowToProfile(data) : null;
}

export async function pushProfile(profile: UserProfile): Promise<void> {
  const c = await client();
  check(await c.from('navimoto_profiles').upsert(profileToRow(profile), { onConflict: 'id' }));
}

export async function pullRoutes(userId: string): Promise<SavedRoute[]> {
  const c = await client();
  const rows = check(await c.from('navimoto_routes').select('*').eq('user_id', userId).returns<RouteRow[]>());
  return (rows ?? []).map(rowToRoute);
}

export async function pushRoute(route: SavedRoute): Promise<void> {
  const c = await client();
  check(await c.from('navimoto_routes').upsert(routeToRow(route), { onConflict: 'id' }));
}

export async function pushRoutes(routes: SavedRoute[]): Promise<void> {
  if (routes.length === 0) return;
  const c = await client();
  check(await c.from('navimoto_routes').upsert(routes.map(routeToRow), { onConflict: 'id' }));
}

export async function removeRoute(id: string): Promise<void> {
  const c = await client();
  check(await c.from('navimoto_routes').delete().eq('id', id));
}

export async function pullTracks(userId: string): Promise<RiddenTrack[]> {
  const c = await client();
  const rows = check(await c.from('navimoto_tracks').select('*').eq('user_id', userId).returns<TrackRow[]>());
  return (rows ?? []).map(rowToTrack);
}

export async function pushTrack(track: RiddenTrack): Promise<void> {
  const c = await client();
  check(await c.from('navimoto_tracks').upsert(trackToRow(track), { onConflict: 'id' }));
}

export async function pushTracks(tracks: RiddenTrack[]): Promise<void> {
  if (tracks.length === 0) return;
  const c = await client();
  check(await c.from('navimoto_tracks').upsert(tracks.map(trackToRow), { onConflict: 'id' }));
}

export async function removeTrack(id: string): Promise<void> {
  const c = await client();
  check(await c.from('navimoto_tracks').delete().eq('id', id));
}

/** Vuur-en-vergeet: fouten worden gelogd, de UI blokkeert nooit op de cloud. */
export function background(label: string, op: () => Promise<void>): void {
  op().catch((err: unknown) => {
    console.warn(`Cloud-sync mislukt (${label})`, err);
  });
}
