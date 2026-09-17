import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LatLng, Maneuver, RouteResult, RoutingOptions, SavedRoute } from '@/types';
import { DEFAULT_AVOID } from '@/types';
import { EARTH_RADIUS_KM, curvatureScore, pathLengthKm } from '@/lib/geo';

vi.mock('@/services/routing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/routing')>();
  return { ...actual, route: vi.fn(), traceRoute: vi.fn() };
});

import { RoutingError, concatRoutes, route, traceRoute } from '@/services/routing';
import { REUSE_DISTANCE_M, buildRideFromSavedRoute } from '@/lib/rideBuilder';

const routeMock = vi.mocked(route);
const traceMock = vi.mocked(traceRoute);

// Lokaal vlak rond 52°N / 5°E in meters (x = oost, y = noord).
const LAT0 = 52.0;
const LON0 = 5.0;
const M_PER_DEG_LAT = (EARTH_RADIUS_KM * 1000 * Math.PI) / 180;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((LAT0 * Math.PI) / 180);
const xy = (x: number, y = 0): LatLng => ({ lat: LAT0 + y / M_PER_DEG_LAT, lon: LON0 + x / M_PER_DEG_LON });

const OPTIONS: RoutingOptions = { style: 'bochtig', avoid: { ...DEFAULT_AVOID }, riderType: 'street' };

function maneuver(type: number, beginIndex: number, endIndex: number, timeS = 30): Maneuver {
  return { type, instruction: `m${type}`, streetNames: [], lengthKm: 0, timeS, beginIndex, endIndex };
}

function result(geometry: LatLng[], maneuvers: Maneuver[] = [], durationS = 100): RouteResult {
  return {
    geometry,
    distanceKm: pathLengthKm(geometry),
    durationS,
    maneuvers,
    hasHighway: false,
    hasToll: false,
    hasFerry: false,
    curvature: curvatureScore(geometry),
  };
}

const GEOMETRY = [xy(0), xy(500), xy(1000), xy(1500), xy(2000)];
const MANEUVERS = [maneuver(1, 0, 2), maneuver(10, 2, 4), maneuver(4, 4, 4)];

function savedRoute(overrides: Partial<SavedRoute> = {}): SavedRoute {
  return {
    id: 'route-1',
    userId: 'user-1',
    name: 'Testroute',
    createdAt: 1000,
    updatedAt: 1000,
    kind: 'planned',
    waypoints: [
      { ...xy(0), name: 'Start' },
      { ...xy(1000), name: 'Via' },
      { ...xy(2000), name: 'Einde' },
    ],
    style: 'bochtig',
    avoid: { ...DEFAULT_AVOID },
    geometry: GEOMETRY,
    distanceKm: 2,
    durationS: 180,
    maneuvers: MANEUVERS,
    gpx: null,
    ...overrides,
  };
}

const NEAR = xy(0, 100); // 100 m van het begin
const FAR = xy(-5000, 0); // 5 km van het begin

beforeEach(() => {
  routeMock.mockReset();
  traceMock.mockReset();
});

describe('buildRideFromSavedRoute - planned/roundtrip', () => {
  it('hergebruikt de opgeslagen geometrie en manoeuvres als de rijder bij het begin staat', async () => {
    const saved = savedRoute();
    const ride = await buildRideFromSavedRoute(saved, NEAR, OPTIONS);
    expect(ride.geometry).toBe(saved.geometry);
    expect(ride.maneuvers).toBe(saved.maneuvers);
    expect(ride.distanceKm).toBe(2);
    expect(ride.durationS).toBe(180);
    expect(ride.hasFerry).toBe(false);
    expect(ride.curvature).toBe(curvatureScore(saved.geometry));
    expect(routeMock).not.toHaveBeenCalled();
    expect(traceMock).not.toHaveBeenCalled();
  });

  it('hergebruikt de opgeslagen route ook zonder bekende positie', async () => {
    const saved = savedRoute({ kind: 'roundtrip' });
    const ride = await buildRideFromSavedRoute(saved, null, OPTIONS);
    expect(ride.geometry).toBe(saved.geometry);
    expect(routeMock).not.toHaveBeenCalled();
  });

  it('precies op de grens van 300 m telt nog als bij het begin', async () => {
    const saved = savedRoute();
    const ride = await buildRideFromSavedRoute(saved, xy(0, REUSE_DISTANCE_M - 1), OPTIONS);
    expect(ride.geometry).toBe(saved.geometry);
    expect(routeMock).not.toHaveBeenCalled();
  });

  it('gebruikt de duur van de manoeuvres als de opgeslagen duur ontbreekt en herkent veerponten', async () => {
    const saved = savedRoute({ durationS: null, maneuvers: [maneuver(1, 0, 1, 10), maneuver(28, 1, 3, 600), maneuver(4, 4, 4, 0)] });
    const ride = await buildRideFromSavedRoute(saved, null, OPTIONS);
    expect(ride.durationS).toBe(610);
    expect(ride.hasFerry).toBe(true);
  });

  it('berekent een nieuwe route vanaf de positie via alle waypoints als de rijder ver weg staat', async () => {
    const saved = savedRoute();
    const fresh = result([FAR, ...GEOMETRY], [maneuver(1, 0, 1), maneuver(4, 5, 5)]);
    routeMock.mockResolvedValue(fresh);
    const controller = new AbortController();

    const ride = await buildRideFromSavedRoute(saved, FAR, OPTIONS, controller.signal);
    expect(ride).toBe(fresh);
    expect(routeMock).toHaveBeenCalledTimes(1);
    expect(routeMock).toHaveBeenCalledWith([FAR, ...saved.waypoints], OPTIONS, controller.signal);
    expect(traceMock).not.toHaveBeenCalled();
  });

  it('rondrit ver weg: waypoints eindigen al op de start, de positie komt ervoor', async () => {
    const start = { ...xy(0), name: 'Start' };
    const saved = savedRoute({ kind: 'roundtrip', waypoints: [start, { ...xy(1000, 800), name: 'Via' }, start] });
    const fresh = result([FAR, xy(0), xy(1000, 800), xy(0)]);
    routeMock.mockResolvedValue(fresh);

    const ride = await buildRideFromSavedRoute(saved, FAR, OPTIONS);
    expect(ride).toBe(fresh);
    expect(routeMock).toHaveBeenCalledWith([FAR, start, saved.waypoints[1], start], OPTIONS, undefined);
  });

  it('zonder manoeuvres wordt altijd opnieuw gerouteerd: met positie ervoor, anders alleen de waypoints', async () => {
    const saved = savedRoute({ maneuvers: null });
    const fresh = result(GEOMETRY);
    routeMock.mockResolvedValue(fresh);

    await buildRideFromSavedRoute(saved, NEAR, OPTIONS);
    expect(routeMock).toHaveBeenLastCalledWith([NEAR, ...saved.waypoints], OPTIONS, undefined);

    await buildRideFromSavedRoute(saved, null, OPTIONS);
    expect(routeMock).toHaveBeenLastCalledWith(saved.waypoints, OPTIONS, undefined);

    const empty = savedRoute({ maneuvers: [] });
    await buildRideFromSavedRoute(empty, null, OPTIONS);
    expect(routeMock).toHaveBeenCalledTimes(3);
  });

  it('geeft routeringsfouten door', async () => {
    routeMock.mockRejectedValue(new RoutingError('no_route'));
    await expect(buildRideFromSavedRoute(savedRoute(), FAR, OPTIONS)).rejects.toMatchObject({ code: 'no_route' });
  });
});

describe('buildRideFromSavedRoute - gpx', () => {
  const TRACK = [xy(0), xy(300, 20), xy(600, -10), xy(900, 0)];
  const matched = result([xy(0), xy(300, 25), xy(600, -5), xy(900, 0)], [maneuver(1, 0, 1), maneuver(10, 1, 3), maneuver(4, 3, 3)]);

  function gpxRoute(overrides: Partial<SavedRoute> = {}): SavedRoute {
    return savedRoute({
      kind: 'gpx',
      waypoints: [{ ...TRACK[0], name: 'Begin' }, { ...TRACK[TRACK.length - 1], name: 'Einde' }],
      style: null,
      avoid: null,
      geometry: TRACK,
      distanceKm: pathLengthKm(TRACK),
      durationS: null,
      maneuvers: null,
      gpx: '<gpx/>',
      ...overrides,
    });
  }

  it('map-matcht het spoor met traceRoute zonder positie', async () => {
    traceMock.mockResolvedValue(matched);
    const controller = new AbortController();

    const ride = await buildRideFromSavedRoute(gpxRoute(), null, OPTIONS, controller.signal);
    expect(ride).toBe(matched);
    expect(traceMock).toHaveBeenCalledTimes(1);
    expect(traceMock).toHaveBeenCalledWith(TRACK, OPTIONS, controller.signal);
    expect(routeMock).not.toHaveBeenCalled();
  });

  it('bij het begin: alleen het gematchte spoor, geen aanrijroute', async () => {
    traceMock.mockResolvedValue(matched);
    const ride = await buildRideFromSavedRoute(gpxRoute(), xy(50, 50), OPTIONS);
    expect(ride).toBe(matched);
    expect(routeMock).not.toHaveBeenCalled();
  });

  it('ver van het begin: aanrijroute naar het gematchte begin, aaneengeplakt met het spoor', async () => {
    traceMock.mockResolvedValue(matched);
    const approach = result([FAR, xy(-2000, 100), matched.geometry[0]], [maneuver(1, 0, 1), maneuver(15, 1, 2), maneuver(4, 2, 2)], 400);
    routeMock.mockResolvedValue(approach);
    const controller = new AbortController();

    const ride = await buildRideFromSavedRoute(gpxRoute(), FAR, OPTIONS, controller.signal);
    expect(routeMock).toHaveBeenCalledTimes(1);
    expect(routeMock).toHaveBeenCalledWith([FAR, matched.geometry[0]], OPTIONS, controller.signal);
    expect(ride).toEqual(concatRoutes(approach, matched));
    // Sanity: de aanrijroute staat vooraan, het spoor erachter, manoeuvres van het spoor zijn verschoven.
    expect(ride.geometry.slice(0, 3)).toEqual(approach.geometry);
    expect(ride.geometry.length).toBe(approach.geometry.length + matched.geometry.length - 1);
    expect(ride.maneuvers.map((m) => m.type)).toEqual([1, 15, 1, 10, 4]);
    expect(ride.maneuvers[2].beginIndex).toBe(2);
    expect(ride.durationS).toBe(500);
  });

  it('hergebruikt eerder gematchte manoeuvres in plaats van opnieuw te matchen', async () => {
    const saved = gpxRoute({ geometry: matched.geometry, maneuvers: matched.maneuvers, durationS: 120 });

    const near = await buildRideFromSavedRoute(saved, xy(20, 0), OPTIONS);
    expect(near.geometry).toBe(matched.geometry);
    expect(near.maneuvers).toBe(matched.maneuvers);
    expect(near.durationS).toBe(120);
    expect(traceMock).not.toHaveBeenCalled();

    const approach = result([FAR, matched.geometry[0]], [maneuver(1, 0, 1), maneuver(4, 1, 1)]);
    routeMock.mockResolvedValue(approach);
    const far = await buildRideFromSavedRoute(saved, FAR, OPTIONS);
    expect(traceMock).not.toHaveBeenCalled();
    expect(routeMock).toHaveBeenCalledWith([FAR, matched.geometry[0]], OPTIONS, undefined);
    expect(far.geometry[0]).toEqual(FAR);
    expect(far.geometry.length).toBe(approach.geometry.length + matched.geometry.length - 1);
  });

  it('geeft fouten van het map-matchen en van de aanrijroute door', async () => {
    traceMock.mockRejectedValue(new RoutingError('no_route'));
    await expect(buildRideFromSavedRoute(gpxRoute(), null, OPTIONS)).rejects.toMatchObject({ code: 'no_route' });

    traceMock.mockResolvedValue(matched);
    routeMock.mockRejectedValue(new RoutingError('network'));
    await expect(buildRideFromSavedRoute(gpxRoute(), FAR, OPTIONS)).rejects.toMatchObject({ code: 'network' });
  });
});
