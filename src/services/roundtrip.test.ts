import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RouteResult, RoundTripOptions, Waypoint } from '@/types';
import { DEFAULT_AVOID } from '@/types';
import { angleDiff, bearingDeg, haversineKm } from '@/lib/geo';
import { RoutingError, route } from '@/services/routing';
import { estimateLoopRadiusKm, generateRoundTrip } from '@/services/roundtrip';

vi.mock('@/services/routing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/routing')>();
  return { ...actual, route: vi.fn() };
});

const routeMock = vi.mocked(route);
const START = { lat: 52.0907, lon: 5.1214 };

function baseOptions(extra: Partial<RoundTripOptions> = {}): RoundTripOptions {
  return { start: START, targetDistanceKm: 100, style: 'bochtig', avoid: { ...DEFAULT_AVOID }, riderType: 'street', ...extra };
}

function result(distanceKm: number, waypoints: Waypoint[]): RouteResult {
  return {
    geometry: waypoints.map((w) => ({ lat: w.lat, lon: w.lon })),
    distanceKm,
    durationS: distanceKm * 60,
    maneuvers: [],
    hasHighway: false,
    hasToll: false,
    hasFerry: false,
    curvature: 0,
  };
}

/**
 * Met deze factor is de gesimuleerde lus precies 100 km voor doel 100 km (binnen 12 %): één poging.
 * Straal 100/7,5 = 13,33 km -> tweede via op 1,1 x 13,33 = 14,67 km -> (7,5/1,1) x 14,67 = 100.
 */
const ONE_SHOT = 7.5 / 1.1;

/** Route-lengte = factor x afstand start->tweede via (die op precies 1,1 x straal ligt). */
function mockByRadius(factor: number): void {
  routeMock.mockImplementation(async (locations) => result(factor * haversineKm(locations[0], locations[2]), locations));
}

function calledWaypoints(call: number): Waypoint[] {
  return routeMock.mock.calls[call][0];
}

beforeEach(() => {
  routeMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('estimateLoopRadiusKm', () => {
  it('rekent omtrek om naar straal met correctie voor kronkelende wegen', () => {
    expect(estimateLoopRadiusKm(100)).toBeCloseTo(100 / 7.5, 6);
    expect(estimateLoopRadiusKm(0)).toBe(0);
  });
});

describe('generateRoundTrip', () => {
  it('zet drie via-punten rond de start en routeert start -> vias -> start', async () => {
    mockByRadius(ONE_SHOT);
    const out = await generateRoundTrip(baseOptions({ seed: 7, bearingDeg: 45 }));
    expect(routeMock).toHaveBeenCalledTimes(1);
    const [locations, options, signal] = routeMock.mock.calls[0];
    expect(options).toEqual({ style: 'bochtig', avoid: DEFAULT_AVOID, riderType: 'street' });
    expect(signal).toBeUndefined();
    expect(locations).toHaveLength(5);
    expect(locations[0]).toEqual(START);
    expect(locations[4]).toEqual(START);
    expect(locations[4]).not.toBe(locations[0]);
    expect(out.waypoints).toBe(locations);
    expect(out.seed).toBe(7);
    expect(out.bearingDeg).toBe(45);

    const radius = estimateLoopRadiusKm(100);
    expect(haversineKm(START, locations[1])).toBeCloseTo(radius * 0.9, 3);
    expect(haversineKm(START, locations[2])).toBeCloseTo(radius * 1.1, 3);
    expect(haversineKm(START, locations[3])).toBeCloseTo(radius * 0.9, 3);
    [45, 165, 285].forEach((expected, i) => {
      const actual = bearingDeg(START, locations[i + 1]);
      expect(Math.abs(angleDiff(expected, actual))).toBeLessThanOrEqual(25.0001);
    });
    expect(out.route.distanceKm).toBeCloseTo(ONE_SHOT * radius * 1.1, 6);
  });

  it('is reproduceerbaar per seed en verschilt per seed', async () => {
    mockByRadius(ONE_SHOT);
    const a = await generateRoundTrip(baseOptions({ seed: 42 }));
    const b = await generateRoundTrip(baseOptions({ seed: 42 }));
    const c = await generateRoundTrip(baseOptions({ seed: 43 }));
    expect(a.waypoints).toEqual(b.waypoints);
    expect(a.bearingDeg).toBe(b.bearingDeg);
    expect(a.bearingDeg).toBeGreaterThanOrEqual(0);
    expect(a.bearingDeg).toBeLessThan(360);
    expect(c.bearingDeg).not.toBe(a.bearingDeg);
    expect(c.waypoints[1]).not.toEqual(a.waypoints[1]);
  });

  it('kiest zonder seed een willekeurig 32-bits geheel getal', async () => {
    mockByRadius(ONE_SHOT);
    const out = await generateRoundTrip(baseOptions());
    expect(Number.isInteger(out.seed)).toBe(true);
    expect(out.seed).toBeGreaterThanOrEqual(0);
    expect(out.seed).toBeLessThan(2 ** 32);
  });

  it('schaalt de straal met doel/werkelijk en stopt binnen 12 %', async () => {
    mockByRadius(10); // eerste poging ~147 km voor doel 100
    const out = await generateRoundTrip(baseOptions({ seed: 1, bearingDeg: 0 }));
    expect(routeMock).toHaveBeenCalledTimes(2);
    const d1 = haversineKm(START, calledWaypoints(0)[2]);
    const d2 = haversineKm(START, calledWaypoints(1)[2]);
    const first = 10 * d1;
    expect(d2 / d1).toBeCloseTo(100 / first, 6);
    expect(out.route.distanceKm).toBeCloseTo(100, 3);
    expect(out.waypoints).toBe(calledWaypoints(1));
    // De hoeken blijven gelijk bij het schalen: dezelfde lus, alleen kleiner.
    expect(bearingDeg(START, calledWaypoints(0)[1])).toBeCloseTo(bearingDeg(START, calledWaypoints(1)[1]), 3);
  });

  it('beperkt de schaalfactor tot [0.5, 2] en doet maximaal 3 pogingen', async () => {
    mockByRadius(40); // veel te lang: factor zou 0,17 zijn
    const out = await generateRoundTrip(baseOptions({ seed: 1, bearingDeg: 0 }));
    expect(routeMock).toHaveBeenCalledTimes(3);
    const d = [0, 1, 2].map((i) => haversineKm(START, calledWaypoints(i)[2]));
    expect(d[1] / d[0]).toBeCloseTo(0.5, 6);
    expect(d[2] / d[1]).toBeCloseTo(0.5, 6);
    expect(out.route.distanceKm).toBeCloseTo(40 * d[2], 6);

    routeMock.mockReset();
    mockByRadius(0.5); // veel te kort: factor zou 5+ zijn
    await generateRoundTrip(baseOptions({ seed: 1, bearingDeg: 0 }));
    expect(routeMock).toHaveBeenCalledTimes(3);
    const up = [0, 1, 2].map((i) => haversineKm(START, calledWaypoints(i)[2]));
    expect(up[1] / up[0]).toBeCloseTo(2, 6);
    expect(up[2] / up[1]).toBeCloseTo(2, 6);
  });

  it('geeft de poging terug die het dichtst bij het doel ligt', async () => {
    const lengths = [80, 130, 125];
    routeMock.mockImplementation(async (locations) => result(lengths[routeMock.mock.calls.length - 1], locations));
    const out = await generateRoundTrip(baseOptions({ seed: 3 }));
    expect(routeMock).toHaveBeenCalledTimes(3);
    expect(out.route.distanceKm).toBe(80);
    expect(out.waypoints).toBe(calledWaypoints(0));
  });

  it('probeert bij no_route een andere richting (+90 graden), maximaal 3 keer extra', async () => {
    routeMock
      .mockRejectedValueOnce(new RoutingError('no_route'))
      .mockRejectedValueOnce(new RoutingError('no_route'))
      .mockImplementationOnce(async (locations) => result(ONE_SHOT * haversineKm(START, locations[2]), locations));
    const out = await generateRoundTrip(baseOptions({ seed: 5, bearingDeg: 30 }));
    expect(routeMock).toHaveBeenCalledTimes(3);
    expect(out.bearingDeg).toBe(210);
    expect(Math.abs(angleDiff(210, bearingDeg(START, calledWaypoints(2)[1])))).toBeLessThanOrEqual(25.0001);
    expect(Math.abs(angleDiff(30, bearingDeg(START, calledWaypoints(0)[1])))).toBeLessThanOrEqual(25.0001);
    expect(Math.abs(angleDiff(120, bearingDeg(START, calledWaypoints(1)[1])))).toBeLessThanOrEqual(25.0001);
  });

  it('geeft no_route door als alle richtingen mislukken', async () => {
    routeMock.mockRejectedValue(new RoutingError('no_route'));
    await expect(generateRoundTrip(baseOptions({ seed: 5, bearingDeg: 30 }))).rejects.toMatchObject({ code: 'no_route' });
    expect(routeMock).toHaveBeenCalledTimes(4);
  });

  it('geeft andere fouten direct door', async () => {
    routeMock.mockRejectedValue(new RoutingError('network'));
    await expect(generateRoundTrip(baseOptions({ seed: 5 }))).rejects.toMatchObject({ code: 'network' });
    expect(routeMock).toHaveBeenCalledTimes(1);
  });

  it('valideert start en doelafstand', async () => {
    await expect(generateRoundTrip(baseOptions({ targetDistanceKm: 0 }))).rejects.toMatchObject({ code: 'invalid' });
    await expect(generateRoundTrip(baseOptions({ start: { lat: 100, lon: 5 } }))).rejects.toMatchObject({ code: 'invalid' });
    expect(routeMock).not.toHaveBeenCalled();
  });

  it('geeft het signaal door en stopt bij een afgebroken signaal', async () => {
    mockByRadius(ONE_SHOT);
    const controller = new AbortController();
    await generateRoundTrip(baseOptions({ seed: 1 }), controller.signal);
    expect(routeMock.mock.calls[0][2]).toBe(controller.signal);
    controller.abort();
    await expect(generateRoundTrip(baseOptions({ seed: 1 }), controller.signal)).rejects.toMatchObject({ code: 'aborted' });
    expect(routeMock).toHaveBeenCalledTimes(1);
  });
});
