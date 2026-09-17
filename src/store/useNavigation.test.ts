import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeoPosition, LatLng, Maneuver, RouteResult, UserProfile } from '@/types';
import { DEFAULT_AVOID, defaultProfile } from '@/types';
import { EARTH_RADIUS_KM, pathLengthKm } from '@/lib/geo';

vi.mock('@/lib/speech', () => ({ speak: vi.fn(), cancelSpeech: vi.fn(), isSpeechAvailable: () => true }));
vi.mock('@/services/routing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/routing')>();
  return { ...actual, route: vi.fn() };
});

import { cancelSpeech, speak } from '@/lib/speech';
import { RoutingError, route } from '@/services/routing';
import { db } from '@/services/db';
import { useRides } from '@/store/useRides';
import { useSettings } from '@/store/useSettings';
import { useToast } from '@/store/useToast';
import { NAV_TEXT, REROUTE_COOLDOWN_MS, useNavigation, type RideMeta } from '@/store/useNavigation';

const routeMock = vi.mocked(route);
const speakMock = vi.mocked(speak);
const cancelMock = vi.mocked(cancelSpeech);

// Lokaal vlak rond 52°N / 5°E in meters (x = oost, y = noord).
const LAT0 = 52.0;
const LON0 = 5.0;
const M_PER_DEG_LAT = (EARTH_RADIUS_KM * 1000 * Math.PI) / 180;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((LAT0 * Math.PI) / 180);
const xy = (x: number, y = 0): LatLng => ({ lat: LAT0 + y / M_PER_DEG_LAT, lon: LON0 + x / M_PER_DEG_LON });

const T0 = 1_700_000_000_000;
let nowSpy: ReturnType<typeof vi.spyOn>;
let tick = 0;

function setNow(ms: number): void {
  nowSpy.mockReturnValue(ms);
}

function pos(x: number, y = 0, extra: Partial<GeoPosition> = {}): GeoPosition {
  tick += 1;
  return { ...xy(x, y), accuracyM: 5, headingDeg: 90, speedKmh: 50, altitudeM: null, t: T0 + tick * 1000, ...extra };
}

function maneuver(type: number, beginIndex: number, endIndex: number, extra: Partial<Maneuver> = {}): Maneuver {
  return { type, instruction: `Instructie ${type}`, streetNames: [], lengthKm: 0, timeS: 0, beginIndex, endIndex, ...extra };
}

function routeOf(geometry: LatLng[], maneuvers: Maneuver[], durationS = 240): RouteResult {
  return { geometry, distanceKm: pathLengthKm(geometry), durationS, maneuvers, hasHighway: false, hasToll: false, hasFerry: false, curvature: 0 };
}

/** Rechte route van 2 km naar het oosten, 21 punten om de 100 m. */
function straight(): LatLng[] {
  const out: LatLng[] = [];
  for (let i = 0; i <= 20; i++) out.push(xy(i * 100));
  return out;
}

const START = maneuver(1, 0, 5, { instruction: 'Rijd richting het oosten.', verbalPre: 'Richting het oosten rijden.' });
const RIGHT = maneuver(10, 5, 12, { instruction: 'Sla rechtsaf naar A.', verbalPre: 'Rechts afslaan naar A.', verbalAlert: 'Over 300 meter rechts afslaan.' });
const LEFT = maneuver(15, 12, 20, { instruction: 'Sla linksaf naar B.', verbalPre: 'Links afslaan naar B.' });
const ARRIVE = maneuver(4, 20, 20, { instruction: 'Je bent op je bestemming.', verbalPre: 'Je bent op je bestemming.' });

function testRoute(): RouteResult {
  return routeOf(straight(), [START, RIGHT, LEFT, ARRIVE]);
}

function testMeta(overrides: Partial<RideMeta> = {}): RideMeta {
  return {
    name: 'Testrit',
    routeId: 'route-1',
    waypoints: [
      { ...xy(0), name: 'Start' },
      { ...xy(1000), name: 'Via' },
      { ...xy(2000), name: 'Einde' },
    ],
    style: 'snel',
    avoid: null,
    ...overrides,
  };
}

/** Herberekende route: van het gegeven punt in een rechte lijn naar het einde (2000, 0). */
function reroutedFrom(p: LatLng): RouteResult {
  const end = xy(2000);
  const geometry: LatLng[] = [];
  for (let i = 0; i <= 10; i++) geometry.push({ lat: p.lat + ((end.lat - p.lat) * i) / 10, lon: p.lon + ((end.lon - p.lon) * i) / 10 });
  return routeOf(geometry, [maneuver(1, 0, 5, { verbalPre: 'Vertrek.' }), maneuver(10, 5, 10, { verbalPre: 'Rechts.' }), maneuver(4, 10, 10)]);
}

function profileWith(patch: Partial<UserProfile> = {}): UserProfile {
  return { ...defaultProfile({ id: 'user-1', email: 'test@example.com', displayName: 'Test', isGuest: false }, 1000), ...patch };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function toastMessages(): string[] {
  return useToast.getState().toasts.map((t) => t.message);
}

/** Rijdt naar (x, y) met drie opeenvolgende posities: daarna geldt de rijder als van de route af. */
function driveOffRoute(x: number, y: number): GeoPosition {
  const nav = useNavigation.getState();
  nav.updatePosition(pos(x, y));
  nav.updatePosition(pos(x + 10, y));
  const third = pos(x + 20, y);
  nav.updatePosition(third);
  return third;
}

beforeEach(async () => {
  tick = 0;
  nowSpy = vi.spyOn(Date, 'now').mockReturnValue(T0);
  routeMock.mockReset();
  speakMock.mockClear();
  cancelMock.mockClear();
  await db.tracks.clear();
  useRides.setState({ routes: [], tracks: [], loaded: true, userId: 'user-1' });
  useSettings.setState({ profile: profileWith({ voiceEnabled: true, defaultStyle: 'bochtig', riderType: 'allroad', defaultAvoid: { ...DEFAULT_AVOID, highways: true } }) });
  useToast.setState({ toasts: [] });
});

afterEach(async () => {
  await useNavigation.getState().stop();
  nowSpy.mockRestore();
});

describe('useNavigation - status', () => {
  it('begint inactief', () => {
    expect(useNavigation.getState()).toMatchObject({
      active: false,
      route: null,
      meta: null,
      progress: null,
      recording: [],
      startedAt: null,
      rerouting: false,
      arrived: false,
      muted: false,
    });
  });

  it('start() zet de rit klaar en spreekt de vertrekinstructie uit', () => {
    const route = testRoute();
    const meta = testMeta();
    setNow(T0 + 5000);
    useNavigation.getState().start(route, meta);
    const s = useNavigation.getState();
    expect(s.active).toBe(true);
    expect(s.route).toBe(route);
    expect(s.meta).toBe(meta);
    expect(s.progress).toBeNull();
    expect(s.recording).toEqual([]);
    expect(s.startedAt).toBe(T0 + 5000);
    expect(s.rerouting).toBe(false);
    expect(s.arrived).toBe(false);
    expect(s.muted).toBe(false);
    expect(speakMock).toHaveBeenCalledTimes(1);
    expect(speakMock).toHaveBeenCalledWith('Richting het oosten rijden.', { interrupt: true });
  });

  it('start() zwijgt als de stem in het profiel uitstaat en valt terug op de instructietekst', () => {
    useSettings.setState({ profile: profileWith({ voiceEnabled: false }) });
    useNavigation.getState().start(testRoute(), testMeta());
    expect(speakMock).not.toHaveBeenCalled();

    useSettings.setState({ profile: profileWith({ voiceEnabled: true }) });
    const noPre = routeOf(straight(), [maneuver(1, 0, 5, { instruction: 'Rijd naar het oosten.' }), ARRIVE]);
    useNavigation.getState().start(noPre, testMeta());
    expect(speakMock).toHaveBeenLastCalledWith('Rijd naar het oosten.', { interrupt: true });
  });

  it('een nieuwe start() maakt een eerder gedempte rit weer hoorbaar', () => {
    useNavigation.getState().start(testRoute(), testMeta());
    useNavigation.getState().toggleMute();
    expect(useNavigation.getState().muted).toBe(true);
    useNavigation.getState().start(testRoute(), testMeta());
    expect(useNavigation.getState().muted).toBe(false);
  });

  it('toggleMute() wisselt en stopt lopende spraak bij dempen', () => {
    useNavigation.getState().start(testRoute(), testMeta());
    cancelMock.mockClear();
    useNavigation.getState().toggleMute();
    expect(useNavigation.getState().muted).toBe(true);
    expect(cancelMock).toHaveBeenCalledTimes(1);
    useNavigation.getState().toggleMute();
    expect(useNavigation.getState().muted).toBe(false);
    expect(cancelMock).toHaveBeenCalledTimes(1);
  });
});

describe('useNavigation - posities en voortgang', () => {
  it('negeert posities zonder actieve rit', () => {
    useNavigation.getState().updatePosition(pos(100));
    expect(useNavigation.getState().recording).toEqual([]);
    expect(useNavigation.getState().progress).toBeNull();
  });

  it('neemt posities op als spoorpunten en slaat punten binnen 2 m van het vorige over', () => {
    useNavigation.getState().start(testRoute(), testMeta());
    const nav = useNavigation.getState();
    const first = pos(0, 0, { altitudeM: 12, speedKmh: 0, headingDeg: null });
    nav.updatePosition(first);
    nav.updatePosition(pos(1)); // < 2 m: niet opgenomen
    nav.updatePosition(pos(10, 0, { speedKmh: null }));

    const recording = useNavigation.getState().recording;
    expect(recording).toHaveLength(2);
    expect(recording[0]).toEqual({ lat: first.lat, lon: first.lon, t: first.t, ele: 12, speedKmh: 0 });
    expect(recording[1]).toEqual({ lat: xy(10).lat, lon: xy(10).lon, t: T0 + 3000, headingDeg: 90 });
  });

  it('berekent de voortgang langs de route', () => {
    useNavigation.getState().start(testRoute(), testMeta());
    useNavigation.getState().updatePosition(pos(250));
    const p = useNavigation.getState().progress;
    expect(p).not.toBeNull();
    expect(p?.alongKm).toBeCloseTo(0.25, 3);
    expect(p?.remainingKm).toBeCloseTo(1.75, 3);
    expect(p?.remainingS).toBeCloseTo(210, 1);
    expect(p?.nextManeuver).toBe(RIGHT);
    expect(p?.maneuverIndex).toBe(1);
    expect(p?.distanceToNextM).toBeCloseTo(250, 0);
    expect(p?.offRoute).toBe(false);
    expect(useNavigation.getState().arrived).toBe(false);
  });

  it('spreekt de waarschuwing binnen 300 m en de instructie binnen 60 m, elk één keer per manoeuvre', () => {
    useNavigation.getState().start(testRoute(), testMeta());
    speakMock.mockClear();
    const nav = useNavigation.getState();

    nav.updatePosition(pos(150)); // 350 m voor de bocht
    expect(speakMock).not.toHaveBeenCalled();

    nav.updatePosition(pos(210)); // 290 m
    expect(speakMock).toHaveBeenCalledTimes(1);
    expect(speakMock).toHaveBeenLastCalledWith('Over 300 meter rechts afslaan.', { interrupt: false });

    nav.updatePosition(pos(230)); // 270 m: niet nog eens
    expect(speakMock).toHaveBeenCalledTimes(1);

    nav.updatePosition(pos(450)); // 50 m
    expect(speakMock).toHaveBeenCalledTimes(2);
    expect(speakMock).toHaveBeenLastCalledWith('Rechts afslaan naar A.', { interrupt: true });

    nav.updatePosition(pos(470));
    expect(speakMock).toHaveBeenCalledTimes(2);

    // Volgende manoeuvre (links, zonder verbalAlert): waarschuwing valt terug op verbalPre.
    nav.updatePosition(pos(1000)); // 200 m voor de bocht bij 1200
    expect(speakMock).toHaveBeenCalledTimes(3);
    expect(speakMock).toHaveBeenLastCalledWith('Links afslaan naar B.', { interrupt: false });
    nav.updatePosition(pos(1150)); // 50 m
    expect(speakMock).toHaveBeenCalledTimes(4);
    expect(speakMock).toHaveBeenLastCalledWith('Links afslaan naar B.', { interrupt: true });
  });

  it('waarschuwt boven 70 km/u al op 500 m en geeft de instructie op 100 m', () => {
    useNavigation.getState().start(testRoute(), testMeta());
    speakMock.mockClear();
    const nav = useNavigation.getState();
    nav.updatePosition(pos(50, 0, { speedKmh: 90 })); // 450 m
    expect(speakMock).toHaveBeenCalledTimes(1);
    expect(speakMock).toHaveBeenLastCalledWith('Over 300 meter rechts afslaan.', { interrupt: false });
    nav.updatePosition(pos(410, 0, { speedKmh: 90 })); // 90 m
    expect(speakMock).toHaveBeenCalledTimes(2);
    expect(speakMock).toHaveBeenLastCalledWith('Rechts afslaan naar A.', { interrupt: true });
  });

  it('zwijgt als de rit gedempt is of de stem in het profiel uitstaat (op het moment zelf gelezen)', () => {
    useNavigation.getState().start(testRoute(), testMeta());
    speakMock.mockClear();
    useNavigation.getState().toggleMute();
    useNavigation.getState().updatePosition(pos(210));
    expect(speakMock).not.toHaveBeenCalled();

    useNavigation.getState().toggleMute();
    useSettings.setState({ profile: profileWith({ voiceEnabled: false }) });
    useNavigation.getState().updatePosition(pos(1000));
    expect(speakMock).not.toHaveBeenCalled();
  });

  it('kondigt de bestemming niet op afstand aan, maar meldt aankomst één keer', () => {
    useNavigation.getState().start(testRoute(), testMeta());
    speakMock.mockClear();
    const nav = useNavigation.getState();

    nav.updatePosition(pos(1800)); // 200 m voor het einde: bestemming is de volgende manoeuvre
    expect(useNavigation.getState().progress?.nextManeuver).toBe(ARRIVE);
    expect(speakMock).not.toHaveBeenCalled();
    expect(useNavigation.getState().arrived).toBe(false);

    nav.updatePosition(pos(1990));
    expect(useNavigation.getState().arrived).toBe(true);
    expect(speakMock).toHaveBeenCalledTimes(1);
    expect(speakMock).toHaveBeenLastCalledWith(NAV_TEXT.arrived, { interrupt: true });

    nav.updatePosition(pos(1995));
    nav.updatePosition(pos(2000));
    expect(speakMock).toHaveBeenCalledTimes(1);
    expect(useNavigation.getState().arrived).toBe(true);
  });
});

describe('useNavigation - van de route af en herberekenen', () => {
  it('meldt pas na drie opeenvolgende posities buiten 60 m dat de rijder van de route af is', () => {
    useNavigation.getState().start(testRoute(), testMeta());
    routeMock.mockImplementation(async (locations) => reroutedFrom(locations[0]));
    const nav = useNavigation.getState();

    nav.updatePosition(pos(300, -100));
    expect(useNavigation.getState().progress?.offRoute).toBe(false);
    nav.updatePosition(pos(310, -100));
    expect(useNavigation.getState().progress?.offRoute).toBe(false);
    nav.updatePosition(pos(320, 0)); // even terug op de route: teller opnieuw
    nav.updatePosition(pos(330, -100));
    nav.updatePosition(pos(340, -100));
    expect(useNavigation.getState().progress?.offRoute).toBe(false);
    expect(routeMock).not.toHaveBeenCalled();
    nav.updatePosition(pos(350, -100));
    expect(useNavigation.getState().progress?.offRoute).toBe(true);
    expect(useNavigation.getState().rerouting).toBe(true);
    expect(routeMock).toHaveBeenCalledTimes(1);
  });

  it('herberekent vanaf de positie via de resterende waypoints met de opties van de rit', async () => {
    const meta = testMeta({ style: 'snel', avoid: { ...DEFAULT_AVOID, ferries: true } });
    useNavigation.getState().start(testRoute(), meta);
    speakMock.mockClear();
    let fresh: RouteResult | null = null;
    routeMock.mockImplementation(async (locations) => {
      fresh = reroutedFrom(locations[0]);
      return fresh;
    });

    const third = driveOffRoute(300, -100);
    expect(routeMock).toHaveBeenCalledTimes(1);
    const [locations, options, signal] = routeMock.mock.calls[0];
    expect(locations).toEqual([{ lat: third.lat, lon: third.lon }, meta.waypoints[1], meta.waypoints[2]]);
    expect(options).toEqual({ style: 'snel', avoid: { ...DEFAULT_AVOID, ferries: true }, riderType: 'allroad' });
    expect(signal).toBeInstanceOf(AbortSignal);

    await flush();
    const s = useNavigation.getState();
    expect(s.rerouting).toBe(false);
    expect(s.route).toBe(fresh);
    expect(s.progress?.offRoute).toBe(false);
    expect(s.progress?.alongKm).toBeCloseTo(0, 3);
    expect(s.progress?.distanceFromRouteM).toBeLessThan(1);
    expect(s.recording).toHaveLength(3); // de opname loopt gewoon door
    expect(speakMock).toHaveBeenCalledWith(NAV_TEXT.rerouted, { interrupt: true });
    expect(toastMessages()).toEqual([NAV_TEXT.reroutedToast]);
    expect(useToast.getState().toasts[0].type).toBe('success');
  });

  it('gebruikt profielstandaarden als de rit geen stijl/vermijden heeft, en anders bochtig/street', async () => {
    useNavigation.getState().start(testRoute(), testMeta({ style: null, avoid: null }));
    routeMock.mockImplementation(async (locations) => reroutedFrom(locations[0]));
    driveOffRoute(300, -100);
    expect(routeMock.mock.calls[0][1]).toEqual({ style: 'bochtig', avoid: { ...DEFAULT_AVOID, highways: true }, riderType: 'allroad' });
    await flush();

    useSettings.setState({ profile: null });
    useNavigation.getState().start(testRoute(), testMeta({ style: null, avoid: null }));
    driveOffRoute(300, -100);
    expect(routeMock).toHaveBeenCalledTimes(2);
    expect(routeMock.mock.calls[1][1]).toEqual({ style: 'bochtig', avoid: DEFAULT_AVOID, riderType: 'street' });
    await flush();
  });

  it('zonder waypoints wordt het eindpunt van de route de bestemming', async () => {
    useNavigation.getState().start(testRoute(), testMeta({ waypoints: [] }));
    routeMock.mockImplementation(async (locations) => reroutedFrom(locations[0]));
    const third = driveOffRoute(300, -100);
    expect(routeMock.mock.calls[0][0]).toEqual([{ lat: third.lat, lon: third.lon }, xy(2000)]);
    await flush();
  });

  it('mislukte herberekening: melding, oude route blijft, en pas na 10 s een nieuwe poging', async () => {
    const route = testRoute();
    useNavigation.getState().start(route, testMeta());
    routeMock.mockRejectedValue(new RoutingError('network'));

    setNow(T0 + 1000);
    driveOffRoute(300, -100);
    expect(useNavigation.getState().rerouting).toBe(true);
    await flush();

    let s = useNavigation.getState();
    expect(s.rerouting).toBe(false);
    expect(s.route).toBe(route);
    expect(s.progress?.offRoute).toBe(true);
    expect(toastMessages()).toEqual([NAV_TEXT.rerouteFailed]);
    expect(useToast.getState().toasts[0].type).toBe('error');
    expect(speakMock).not.toHaveBeenCalledWith(NAV_TEXT.rerouted, expect.anything());

    setNow(T0 + 1000 + REROUTE_COOLDOWN_MS - 1);
    useNavigation.getState().updatePosition(pos(360, -100));
    expect(routeMock).toHaveBeenCalledTimes(1);

    setNow(T0 + 1000 + REROUTE_COOLDOWN_MS + 1);
    useNavigation.getState().updatePosition(pos(370, -100));
    expect(routeMock).toHaveBeenCalledTimes(2);
    s = useNavigation.getState();
    expect(s.rerouting).toBe(true);
    await flush();
  });

  it('start geen tweede herberekening zolang er een loopt', async () => {
    useNavigation.getState().start(testRoute(), testMeta());
    let resolveRoute: ((r: RouteResult) => void) | null = null;
    routeMock.mockImplementation(
      (locations) =>
        new Promise<RouteResult>((resolve) => {
          resolveRoute = () => resolve(reroutedFrom(locations[0]));
        }),
    );

    driveOffRoute(300, -100);
    setNow(T0 + 60_000);
    useNavigation.getState().updatePosition(pos(330, -100));
    useNavigation.getState().updatePosition(pos(340, -100));
    expect(routeMock).toHaveBeenCalledTimes(1);
    expect(useNavigation.getState().rerouting).toBe(true);

    resolveRoute!(reroutedFrom(xy(300, -100)));
    await flush();
    expect(useNavigation.getState().rerouting).toBe(false);
    expect(useNavigation.getState().route?.geometry).toHaveLength(11);
  });

  it('stop() breekt een lopende herberekening af zonder foutmelding', async () => {
    useNavigation.getState().start(testRoute(), testMeta());
    routeMock.mockImplementation(
      (_locations, _options, signal) =>
        new Promise<RouteResult>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new RoutingError('aborted')));
        }),
    );
    driveOffRoute(300, -100);
    const [, , signal] = routeMock.mock.calls[0];
    expect(useNavigation.getState().rerouting).toBe(true);

    await useNavigation.getState().stop();
    expect(signal?.aborted).toBe(true);
    await flush();
    expect(useNavigation.getState().active).toBe(false);
    expect(useNavigation.getState().rerouting).toBe(false);
    expect(toastMessages()).toEqual([]);
  });

  it('een herberekening van een vorige rit raakt een nieuwe rit niet', async () => {
    useNavigation.getState().start(testRoute(), testMeta());
    let resolveRoute: ((r: RouteResult) => void) | null = null;
    routeMock.mockImplementation((locations) => new Promise<RouteResult>((resolve) => (resolveRoute = () => resolve(reroutedFrom(locations[0])))));
    driveOffRoute(300, -100);

    const second = testRoute();
    useNavigation.getState().start(second, testMeta({ name: 'Tweede rit' }));
    resolveRoute!(reroutedFrom(xy(300, -100)));
    await flush();

    const s = useNavigation.getState();
    expect(s.route).toBe(second);
    expect(s.rerouting).toBe(false);
    expect(toastMessages()).toEqual([]);
  });

  it('herberekent niet meer na aankomst', () => {
    useNavigation.getState().start(testRoute(), testMeta());
    routeMock.mockImplementation(async (locations) => reroutedFrom(locations[0]));
    useNavigation.getState().updatePosition(pos(1995));
    expect(useNavigation.getState().arrived).toBe(true);
    driveOffRoute(2100, -200);
    expect(routeMock).not.toHaveBeenCalled();
  });
});

describe('useNavigation - stop()', () => {
  it('slaat de rit op als er meer dan 100 m is gereden en zet de status terug', async () => {
    const route = testRoute();
    useNavigation.getState().start(route, testMeta());
    const nav = useNavigation.getState();
    nav.updatePosition(pos(0, 0, { speedKmh: 0, t: T0 }));
    nav.updatePosition(pos(100, 0, { speedKmh: 36, t: T0 + 10_000 }));
    nav.updatePosition(pos(200, 0, { speedKmh: 36, t: T0 + 20_000 }));
    cancelMock.mockClear();

    setNow(T0 + 30_000);
    const track = await useNavigation.getState().stop();
    expect(track).not.toBeNull();
    expect(track).toMatchObject({
      userId: 'user-1',
      name: 'Testrit (gereden)',
      startedAt: T0,
      endedAt: T0 + 30_000,
      durationS: 30,
      movingS: 20,
      maxSpeedKmh: 36,
      routeId: 'route-1',
    });
    expect(track?.points).toHaveLength(3);
    expect(track?.distanceKm).toBeCloseTo(0.2, 3);
    expect(track?.avgSpeedKmh).toBeCloseTo(36, 1);
    expect(useRides.getState().tracks.map((t) => t.id)).toEqual([track?.id]);
    expect(await db.tracks.get(track!.id)).toBeDefined();
    expect(cancelMock).toHaveBeenCalled();

    const s = useNavigation.getState();
    expect(s).toMatchObject({ active: false, route: null, meta: null, progress: null, recording: [], startedAt: null, rerouting: false, arrived: false, muted: false });
  });

  it('geeft null en slaat niets op bij minder dan 100 m', async () => {
    useNavigation.getState().start(testRoute(), testMeta());
    useNavigation.getState().updatePosition(pos(0));
    useNavigation.getState().updatePosition(pos(80));
    const track = await useNavigation.getState().stop();
    expect(track).toBeNull();
    expect(useRides.getState().tracks).toEqual([]);
    expect(useNavigation.getState().active).toBe(false);
  });

  it('geeft null zonder actieve rit', async () => {
    expect(await useNavigation.getState().stop()).toBeNull();
  });

  it('meldt een mislukte opslag en geeft dan null, maar de rit is wel beëindigd', async () => {
    useNavigation.getState().start(testRoute(), testMeta());
    useNavigation.getState().updatePosition(pos(0));
    useNavigation.getState().updatePosition(pos(200));
    useRides.setState({ userId: null }); // saveTrack gooit 'Niet ingelogd'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const track = await useNavigation.getState().stop();
    expect(track).toBeNull();
    expect(toastMessages()).toEqual([NAV_TEXT.saveFailed]);
    expect(useNavigation.getState().active).toBe(false);
    warn.mockRestore();
  });

  it('posities tijdens het opslaan horen niet meer bij de rit', async () => {
    useNavigation.getState().start(testRoute(), testMeta());
    useNavigation.getState().updatePosition(pos(0));
    useNavigation.getState().updatePosition(pos(200));
    const pending = useNavigation.getState().stop();
    useNavigation.getState().updatePosition(pos(300));
    expect(useNavigation.getState().recording).toEqual([]);
    const track = await pending;
    expect(track?.points).toHaveLength(2);
  });
});
