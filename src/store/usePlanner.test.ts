import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeoPosition, RouteResult, UserProfile, Waypoint } from '@/types';
import { DEFAULT_AVOID } from '@/types';
import { route, RoutingError } from '@/services/routing';
import { generateRoundTrip } from '@/services/roundtrip';
import { useLocationStore } from '@/store/useLocationStore';
import { useSettings } from '@/store/useSettings';
import { useToast } from '@/store/useToast';
import { clampTargetKm, ERR_NO_LOCATION, usePlanner, waypointLabel } from '@/store/usePlanner';

vi.mock('@/services/routing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/routing')>();
  return { ...actual, route: vi.fn() };
});

vi.mock('@/services/roundtrip', () => ({ generateRoundTrip: vi.fn() }));

const routeMock = vi.mocked(route);
const roundTripMock = vi.mocked(generateRoundTrip);

const UTRECHT = { lat: 52.0907, lon: 5.1214 };
const ARNHEM: Waypoint = { lat: 51.9851, lon: 5.8987, name: 'Arnhem' };
const VIA: Waypoint = { lat: 52.05, lon: 5.5, name: 'Via' };

function position(): GeoPosition {
  return { ...UTRECHT, accuracyM: 5, headingDeg: null, speedKmh: null, altitudeM: null, t: 1000 };
}

function result(distanceKm: number): RouteResult {
  return {
    geometry: [UTRECHT, ARNHEM],
    distanceKm,
    durationS: distanceKm * 60,
    maneuvers: [],
    hasHighway: false,
    hasToll: false,
    hasFerry: false,
    curvature: 0,
  };
}

function profile(patch: Partial<UserProfile> = {}): UserProfile {
  return {
    id: 'u1',
    email: 'r@example.com',
    displayName: 'Ryan',
    riderType: 'street',
    defaultStyle: 'bochtig',
    defaultAvoid: { ...DEFAULT_AVOID },
    voiceEnabled: true,
    mapStyle: 'osm',
    simulateRides: false,
    createdAt: 0,
    updatedAt: 0,
    ...patch,
  };
}

const initial = usePlanner.getInitialState();

beforeEach(() => {
  routeMock.mockReset();
  roundTripMock.mockReset();
  usePlanner.setState({ ...initial, avoid: { ...DEFAULT_AVOID }, roundTrip: { ...initial.roundTrip } });
  useLocationStore.setState({ position: null, status: 'idle', error: null });
  useSettings.setState({ profile: null });
  useToast.setState({ toasts: [] });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('usePlanner', () => {
  it('start in idle met standaardwaarden', () => {
    const s = usePlanner.getState();
    expect(s.mode).toBe('idle');
    expect(s.start).toBeNull();
    expect(s.destination).toBeNull();
    expect(s.vias).toEqual([]);
    expect(s.roundTrip).toEqual({ targetKm: 100, seed: null, bearingDeg: null });
    expect(s.pickTarget).toBeNull();
  });

  it('openPlan/openRoundTrip zetten de modus en onthouden die als previousMode', () => {
    usePlanner.getState().openPlan();
    expect(usePlanner.getState()).toMatchObject({ mode: 'plan', previousMode: 'plan' });
    usePlanner.getState().openRoundTrip();
    expect(usePlanner.getState()).toMatchObject({ mode: 'roundtrip', previousMode: 'roundtrip' });
  });

  it('beheert via-punten en klemt de rondritafstand', () => {
    const s = usePlanner.getState();
    s.addVia(VIA);
    s.addVia({ lat: 1, lon: 1 });
    s.updateVia(1, { lat: 2, lon: 2, name: 'Twee' });
    expect(usePlanner.getState().vias).toEqual([VIA, { lat: 2, lon: 2, name: 'Twee' }]);
    s.removeVia(0);
    expect(usePlanner.getState().vias).toEqual([{ lat: 2, lon: 2, name: 'Twee' }]);

    s.setTargetKm(5);
    expect(usePlanner.getState().roundTrip.targetKm).toBe(20);
    s.setTargetKm(1000);
    expect(usePlanner.getState().roundTrip.targetKm).toBe(400);
    s.setTargetKm(133);
    expect(usePlanner.getState().roundTrip.targetKm).toBe(130);
    expect(clampTargetKm(Number.NaN)).toBe(100);
  });

  it('neemt stijl en vermijden eenmalig uit het profiel over', () => {
    const s = usePlanner.getState();
    s.initFromProfile(profile({ defaultStyle: 'snel', defaultAvoid: { ...DEFAULT_AVOID, tolls: true } }));
    expect(usePlanner.getState().style).toBe('snel');
    expect(usePlanner.getState().avoid.tolls).toBe(true);
    s.setStyle('avontuurlijk');
    s.initFromProfile(profile({ defaultStyle: 'snel' }));
    expect(usePlanner.getState().style).toBe('avontuurlijk');
  });

  it('berekent een route van de huidige locatie naar de bestemming (street forceert onverhard vermijden)', async () => {
    useLocationStore.setState({ position: position() });
    useSettings.setState({ profile: profile({ riderType: 'street' }) });
    routeMock.mockResolvedValue(result(42.3));

    const s = usePlanner.getState();
    s.openPlan();
    s.addVia(VIA);
    s.setDestination(ARNHEM);
    s.setStyle('bochtig');
    await s.calculate();

    expect(routeMock).toHaveBeenCalledTimes(1);
    const [locations, options, signal] = routeMock.mock.calls[0];
    expect(locations).toEqual([{ ...UTRECHT, name: 'Huidige locatie' }, VIA, ARNHEM]);
    expect(options).toEqual({ style: 'bochtig', avoid: { ...DEFAULT_AVOID, unpaved: true }, riderType: 'street' });
    expect(signal).toBeInstanceOf(AbortSignal);

    const after = usePlanner.getState();
    expect(after.mode).toBe('preview');
    expect(after.previousMode).toBe('plan');
    expect(after.result?.distanceKm).toBe(42.3);
    expect(after.resultWaypoints).toEqual(locations);
    expect(after.resultName).toBe('Huidige locatie → Arnhem');
    expect(after.loading).toBe(false);
    expect(after.error).toBeNull();
    expect(after.savedRouteId).toBeNull();
  });

  it('gebruikt een gekozen startpunt en laat onverhard vrij voor allroad', async () => {
    useSettings.setState({ profile: profile({ riderType: 'allroad' }) });
    routeMock.mockResolvedValue(result(10));

    const s = usePlanner.getState();
    s.openPlan();
    s.setStart({ lat: 52.1, lon: 5.2 });
    s.setDestination(ARNHEM);
    s.setAvoid({ ...DEFAULT_AVOID, highways: true });
    await s.calculate();

    const [locations, options] = routeMock.mock.calls[0];
    expect(locations[0]).toEqual({ lat: 52.1, lon: 5.2 });
    expect(options).toEqual({ style: 'bochtig', avoid: { ...DEFAULT_AVOID, highways: true }, riderType: 'allroad' });
    expect(usePlanner.getState().resultName).toBe('52.10000, 5.20000 → Arnhem');
  });

  it('geeft een fout als er geen locatie en geen startpunt is', async () => {
    const s = usePlanner.getState();
    s.openPlan();
    s.setDestination(ARNHEM);
    await s.calculate();

    expect(routeMock).not.toHaveBeenCalled();
    expect(usePlanner.getState()).toMatchObject({ mode: 'plan', loading: false, error: ERR_NO_LOCATION });
    expect(useToast.getState().toasts.map((t) => t.message)).toEqual([ERR_NO_LOCATION]);
  });

  it('zet de foutmelding van RoutingError in error en toont een toast', async () => {
    useLocationStore.setState({ position: position() });
    routeMock.mockRejectedValue(new RoutingError('no_route'));

    const s = usePlanner.getState();
    s.openPlan();
    s.setDestination(ARNHEM);
    await s.calculate();

    const after = usePlanner.getState();
    expect(after.mode).toBe('plan');
    expect(after.result).toBeNull();
    expect(after.loading).toBe(false);
    expect(after.error).toBe('Geen route gevonden tussen deze punten.');
    expect(useToast.getState().toasts[0]).toMatchObject({ message: 'Geen route gevonden tussen deze punten.', type: 'error' });
  });

  it('genereert een rondrit en onthoudt seed en richting', async () => {
    useLocationStore.setState({ position: position() });
    const loop: Waypoint[] = [UTRECHT, { lat: 52.2, lon: 5.3 }, { lat: 52.3, lon: 5.1 }, UTRECHT];
    roundTripMock.mockResolvedValue({ route: result(98.6), waypoints: loop, seed: 12345, bearingDeg: 90 });

    const s = usePlanner.getState();
    s.openRoundTrip();
    s.setTargetKm(100);
    await s.calculate();

    expect(roundTripMock).toHaveBeenCalledTimes(1);
    const [opts, signal] = roundTripMock.mock.calls[0];
    expect(opts).toEqual({
      start: UTRECHT,
      targetDistanceKm: 100,
      style: 'bochtig',
      avoid: { ...DEFAULT_AVOID, unpaved: true },
      riderType: 'street',
    });
    expect(signal).toBeInstanceOf(AbortSignal);

    const after = usePlanner.getState();
    expect(after.mode).toBe('preview');
    expect(after.previousMode).toBe('roundtrip');
    expect(after.resultName).toBe('Rondreis 99 km');
    expect(after.roundTrip).toEqual({ targetKm: 100, seed: 12345, bearingDeg: 90 });
    expect(after.resultWaypoints).toHaveLength(4);
    expect(after.resultWaypoints[0]).toEqual({ ...UTRECHT, name: 'Huidige locatie' });
    expect(after.resultWaypoints[3]).toEqual({ ...UTRECHT, name: 'Huidige locatie' });
  });

  it('regenerate kiest een nieuwe seed en rekent opnieuw', async () => {
    useLocationStore.setState({ position: position() });
    roundTripMock.mockImplementation(async (opts) => ({
      route: result(100),
      waypoints: [UTRECHT, UTRECHT],
      seed: opts.seed ?? 1,
      bearingDeg: 0,
    }));

    const s = usePlanner.getState();
    s.openRoundTrip();
    await s.calculate();
    const firstSeed = usePlanner.getState().roundTrip.seed;
    expect(roundTripMock.mock.calls[0][0].seed).toBeUndefined();

    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    await s.regenerate();
    expect(roundTripMock).toHaveBeenCalledTimes(2);
    const secondSeed = roundTripMock.mock.calls[1][0].seed;
    expect(secondSeed).toBe(0x80000000);
    expect(secondSeed).not.toBe(firstSeed);
    expect(usePlanner.getState()).toMatchObject({ mode: 'preview', roundTrip: { seed: 0x80000000 } });
  });

  it('close breekt een lopende berekening af en zet alles terug naar idle', async () => {
    useLocationStore.setState({ position: position() });
    let capturedSignal: AbortSignal | undefined;
    routeMock.mockImplementation(
      (_locations, _options, signal) =>
        new Promise<RouteResult>((_resolve, reject) => {
          capturedSignal = signal;
          signal?.addEventListener('abort', () => reject(new RoutingError('aborted')));
        }),
    );

    const s = usePlanner.getState();
    s.openPlan();
    s.setDestination(ARNHEM);
    s.addVia(VIA);
    s.setPickTarget('via');
    const pending = s.calculate();
    expect(usePlanner.getState().loading).toBe(true);

    s.close();
    await pending;

    expect(capturedSignal?.aborted).toBe(true);
    const after = usePlanner.getState();
    expect(after).toMatchObject({
      mode: 'idle',
      previousMode: null,
      start: null,
      destination: null,
      vias: [],
      result: null,
      resultWaypoints: [],
      resultName: '',
      loading: false,
      error: null,
      pickTarget: null,
      savedRouteId: null,
    });
    expect(useToast.getState().toasts).toEqual([]);
  });

  it('backToForm gaat terug naar het formulier en markSaved/setResultName werken', async () => {
    useLocationStore.setState({ position: position() });
    routeMock.mockResolvedValue(result(5));
    const s = usePlanner.getState();
    s.openPlan();
    s.setDestination(ARNHEM);
    await s.calculate();
    expect(usePlanner.getState().mode).toBe('preview');

    s.setResultName('Mijn rit');
    s.markSaved('route-1');
    expect(usePlanner.getState()).toMatchObject({ resultName: 'Mijn rit', savedRouteId: 'route-1' });

    s.backToForm();
    expect(usePlanner.getState()).toMatchObject({ mode: 'plan', destination: ARNHEM });
  });

  it('waypointLabel geeft naam, coördinaten of "Huidige locatie"', () => {
    expect(waypointLabel(null)).toBe('Huidige locatie');
    expect(waypointLabel(ARNHEM)).toBe('Arnhem');
    expect(waypointLabel({ lat: 52.0907, lon: 5.1214, name: '  ' })).toBe('52.09070, 5.12140');
  });
});
