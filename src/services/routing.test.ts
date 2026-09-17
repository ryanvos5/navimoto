import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LatLng, RouteResult, RoutingOptions } from '@/types';
import { DEFAULT_AVOID } from '@/types';
import { decodePolyline, encodePolyline, haversineM, pathLengthKm } from '@/lib/geo';
import {
  RoutingError,
  buildCostingOptions,
  concatRoutes,
  parseValhallaTrip,
  prepareTraceShape,
  route,
  routeWithAlternatives,
  stripExcludeFlags,
  traceRoute,
  valhallaUrl,
} from '@/services/routing';
import route2Legs from './__fixtures__/route-3loc-break.json';
import routeThrough from './__fixtures__/route-3loc.json';
import routeAlternates from './__fixtures__/route-alternates.json';
import traceFixture from './__fixtures__/trace-route.json';
import traceShape from './__fixtures__/trace-shape.json';
import error442 from './__fixtures__/valhalla-error-442.json';

type Rec = Record<string, unknown>;

const UTRECHT = { lat: 52.0907, lon: 5.1214 };
const AMERSFOORT = { lat: 52.1562, lon: 5.3897 };
const ARNHEM = { lat: 51.9851, lon: 5.8987 };

const BOCHTIG: RoutingOptions = { style: 'bochtig', avoid: { ...DEFAULT_AVOID }, riderType: 'street' };
const SNEL: RoutingOptions = { style: 'snel', avoid: { ...DEFAULT_AVOID }, riderType: 'allroad' };
const AVONTUURLIJK: RoutingOptions = { style: 'avontuurlijk', avoid: { ...DEFAULT_AVOID }, riderType: 'allroad' };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function abortRejection(): Error {
  return new DOMException('The operation was aborted.', 'AbortError');
}

const fetchMock = vi.fn<typeof fetch>();

function requestBody(call = 0): Rec {
  const init = fetchMock.mock.calls[call][1];
  return JSON.parse(String(init?.body)) as Rec;
}

function fakeResult(points: LatLng[], extra: Partial<RouteResult> = {}): RouteResult {
  return {
    geometry: points,
    distanceKm: pathLengthKm(points),
    durationS: 60,
    maneuvers: [],
    hasHighway: false,
    hasToll: false,
    hasFerry: false,
    curvature: 0,
    ...extra,
  };
}

interface SyntheticLeg {
  points: LatLng[];
  maneuvers: Rec[];
  summary?: Rec;
}

function syntheticTrip(legs: SyntheticLeg[], summary?: Rec): Rec {
  return {
    legs: legs.map((l) => ({ shape: encodePolyline(l.points), maneuvers: l.maneuvers, ...(l.summary ? { summary: l.summary } : {}) })),
    ...(summary ? { summary } : {}),
  };
}

function maneuver(type: number, begin: number, end: number, extra: Rec = {}): Rec {
  return { type, instruction: `m${type}`, begin_shape_index: begin, end_shape_index: end, length: 1, time: 10, ...extra };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('buildCostingOptions', () => {
  it('snel + street: snelwegen en tol toegestaan, onverhard uitgesloten', () => {
    expect(buildCostingOptions({ style: 'snel', avoid: DEFAULT_AVOID, riderType: 'street' })).toEqual({
      use_highways: 1,
      use_tolls: 1,
      use_trails: 0,
      exclude_unpaved: true,
    });
  });

  it('bochtig + allroad: geen snelwegen, woonerven beperkt, onverhard toegestaan', () => {
    expect(buildCostingOptions({ style: 'bochtig', avoid: DEFAULT_AVOID, riderType: 'allroad' })).toEqual({
      use_highways: 0,
      use_tolls: 0.3,
      use_trails: 0,
      use_living_streets: 0.3,
      exclude_unpaved: false,
    });
  });

  it('avontuurlijk: use_trails per rijderstype', () => {
    expect(buildCostingOptions({ style: 'avontuurlijk', avoid: DEFAULT_AVOID, riderType: 'allroad' })).toMatchObject({
      use_highways: 0,
      use_tolls: 0.2,
      use_trails: 0.6,
      exclude_unpaved: false,
    });
    expect(buildCostingOptions({ style: 'avontuurlijk', avoid: DEFAULT_AVOID, riderType: 'offroad' })).toMatchObject({
      use_trails: 1,
      exclude_unpaved: false,
    });
    expect(buildCostingOptions({ style: 'avontuurlijk', avoid: DEFAULT_AVOID, riderType: 'street' })).toMatchObject({
      use_trails: 0.2,
      exclude_unpaved: true,
    });
  });

  it('bij snel/bochtig bepaalt het rijderstype alleen exclude_unpaved (use_trails blijft 0)', () => {
    expect(buildCostingOptions({ style: 'bochtig', avoid: DEFAULT_AVOID, riderType: 'offroad' })).toEqual({
      use_highways: 0,
      use_tolls: 0.3,
      use_trails: 0,
      use_living_streets: 0.3,
      exclude_unpaved: false,
    });
    expect(buildCostingOptions({ style: 'snel', avoid: DEFAULT_AVOID, riderType: 'offroad' })).toEqual({
      use_highways: 1,
      use_tolls: 1,
      use_trails: 0,
      exclude_unpaved: false,
    });
    expect(buildCostingOptions({ style: 'bochtig', avoid: DEFAULT_AVOID, riderType: 'street' })).toMatchObject({
      use_trails: 0,
      exclude_unpaved: true,
    });
  });

  it('vermijd-opties overschrijven de stijl', () => {
    const all = { ferries: true, highways: true, tolls: true, unpaved: true };
    expect(buildCostingOptions({ style: 'snel', avoid: all, riderType: 'allroad' })).toEqual({
      use_highways: 0,
      exclude_highways: true,
      use_tolls: 0,
      exclude_tolls: true,
      use_trails: 0,
      use_ferry: 0,
      exclude_ferries: true,
      exclude_unpaved: true,
    });
    expect(buildCostingOptions({ style: 'bochtig', avoid: { ...DEFAULT_AVOID, ferries: true }, riderType: 'allroad' })).toMatchObject({
      use_ferry: 0,
      exclude_ferries: true,
      exclude_unpaved: false,
    });
  });

  it('stripExcludeFlags verwijdert alleen exclude_* en laat het origineel intact', () => {
    const costing = { use_highways: 0, exclude_highways: true, exclude_unpaved: false, use_tolls: 0.3 };
    expect(stripExcludeFlags(costing)).toEqual({ use_highways: 0, use_tolls: 0.3 });
    expect(costing.exclude_highways).toBe(true);
  });
});

describe('parseValhallaTrip', () => {
  it('plakt twee legs aaneen zonder dubbel grenspunt en met globale indices', () => {
    const result = parseValhallaTrip(route2Legs.trip);
    const leg0 = decodePolyline(route2Legs.trip.legs[0].shape);
    const leg1 = decodePolyline(route2Legs.trip.legs[1].shape);
    expect(haversineM(leg0[leg0.length - 1], leg1[0])).toBeLessThan(1);
    expect(result.geometry).toHaveLength(leg0.length + leg1.length - 1);
    // Dezelfde route via "through" heeft precies dezelfde lijn.
    expect(result.geometry).toHaveLength(decodePolyline(routeThrough.trip.legs[0].shape).length);
    expect(result.geometry[0]).toEqual(leg0[0]);
    expect(result.geometry[result.geometry.length - 1]).toEqual(leg1[leg1.length - 1]);

    const count0 = route2Legs.trip.legs[0].maneuvers.length;
    const count1 = route2Legs.trip.legs[1].maneuvers.length;
    expect(result.maneuvers).toHaveLength(count0 - 1 + count1);
    // Alleen de allerlaatste manoeuvre is een bestemming.
    result.maneuvers.slice(0, -1).forEach((m) => expect([4, 5, 6]).not.toContain(m.type));
    expect([4, 5, 6]).toContain(result.maneuvers[result.maneuvers.length - 1].type);
    // Eerste manoeuvre van leg 2 begint op het grenspunt (index leg0.length - 1).
    expect(result.maneuvers[count0 - 1].beginIndex).toBe(leg0.length - 1);
    expect(result.maneuvers[result.maneuvers.length - 1].endIndex).toBe(result.geometry.length - 1);
    for (let i = 1; i < result.maneuvers.length; i++) {
      expect(result.maneuvers[i].beginIndex).toBeGreaterThanOrEqual(result.maneuvers[i - 1].beginIndex);
    }

    expect(result.distanceKm).toBeCloseTo(77.833, 3);
    expect(result.durationS).toBeCloseTo(7147.062, 3);
    expect(result.hasHighway).toBe(false);
    expect(result.hasToll).toBe(false);
    expect(result.hasFerry).toBe(false);
    expect(result.curvature).toBeGreaterThan(0);
  });

  it('zet de manoeuvrevelden om', () => {
    const result = parseValhallaTrip(route2Legs.trip);
    const raw = route2Legs.trip.legs[0].maneuvers[1] as Rec;
    expect(result.maneuvers[1]).toEqual({
      type: raw.type,
      instruction: raw.instruction,
      verbalPre: raw.verbal_pre_transition_instruction,
      verbalPost: raw.verbal_post_transition_instruction,
      verbalAlert: raw.verbal_transition_alert_instruction,
      streetNames: raw.street_names,
      lengthKm: raw.length,
      timeS: raw.time,
      beginIndex: raw.begin_shape_index,
      endIndex: raw.end_shape_index,
      bearingAfter: raw.bearing_after,
    });
    expect(result.maneuvers[1].instruction).toBe('Sla rechtsaf naar Mariaplaats.');
    expect(result.maneuvers[1].roundaboutExitCount).toBeUndefined();
  });

  it('neemt roundabout_exit_count en lege straatnamen over', () => {
    const points = [UTRECHT, { lat: 52.1, lon: 5.13 }, { lat: 52.11, lon: 5.14 }];
    const trip = syntheticTrip(
      [{ points, maneuvers: [maneuver(1, 0, 1), maneuver(26, 1, 2, { roundabout_exit_count: 2, bearing_after: 45 }), maneuver(4, 2, 2)] }],
      { length: 2.5, time: 100, has_highway: true, has_toll: false, has_ferry: true },
    );
    const result = parseValhallaTrip(trip);
    expect(result.maneuvers[1]).toMatchObject({ type: 26, roundaboutExitCount: 2, bearingAfter: 45, streetNames: [] });
    expect(result.maneuvers[0].verbalPre).toBeUndefined();
    expect(result).toMatchObject({ distanceKm: 2.5, durationS: 100, hasHighway: true, hasToll: false, hasFerry: true });
  });

  it('verwijdert het grenspunt alleen als het echt hetzelfde punt is', () => {
    const a = [UTRECHT, { lat: 52.1, lon: 5.13 }];
    const bSame = [{ lat: 52.1, lon: 5.13 }, { lat: 52.11, lon: 5.14 }];
    const bOther = [{ lat: 52.2, lon: 5.2 }, { lat: 52.21, lon: 5.21 }];
    const same = parseValhallaTrip(
      syntheticTrip([
        { points: a, maneuvers: [maneuver(1, 0, 1), maneuver(5, 1, 1)] },
        { points: bSame, maneuvers: [maneuver(2, 0, 1), maneuver(6, 1, 1)] },
      ]),
    );
    expect(same.geometry).toHaveLength(3);
    expect(same.maneuvers.map((m) => [m.type, m.beginIndex, m.endIndex])).toEqual([
      [1, 0, 1],
      [2, 1, 2],
      [6, 2, 2],
    ]);
    const other = parseValhallaTrip(
      syntheticTrip([
        { points: a, maneuvers: [maneuver(1, 0, 1), maneuver(4, 1, 1)] },
        { points: bOther, maneuvers: [maneuver(2, 0, 1), maneuver(4, 1, 1)] },
      ]),
    );
    expect(other.geometry).toHaveLength(4);
    expect(other.maneuvers.map((m) => [m.type, m.beginIndex, m.endIndex])).toEqual([
      [1, 0, 1],
      [2, 2, 3],
      [4, 3, 3],
    ]);
  });

  it('valt terug op leg-samenvattingen of de lijnlengte als trip.summary ontbreekt', () => {
    const points = [UTRECHT, { lat: 52.1, lon: 5.13 }];
    const withLegSummary = parseValhallaTrip(
      syntheticTrip([{ points, maneuvers: [maneuver(1, 0, 1), maneuver(4, 1, 1)], summary: { length: 3, time: 30, has_toll: true } }]),
    );
    expect(withLegSummary).toMatchObject({ distanceKm: 3, durationS: 30, hasToll: true });
    const bare = parseValhallaTrip(syntheticTrip([{ points, maneuvers: [maneuver(1, 0, 1), maneuver(4, 1, 1)] }]));
    expect(bare.distanceKm).toBeCloseTo(pathLengthKm(points), 6);
    expect(bare.durationS).toBe(20);
  });

  it('gooit RoutingError(server) bij een onverwachte structuur', () => {
    const bad: unknown[] = [
      null,
      'trip',
      {},
      { legs: [] },
      { legs: [{ shape: 42, maneuvers: [] }] },
      { legs: [{ shape: encodePolyline([UTRECHT, ARNHEM]) }] },
      { legs: [{ shape: encodePolyline([UTRECHT, ARNHEM]), maneuvers: [{ type: 1 }] }] },
      { legs: [{ shape: '', maneuvers: [] }] },
    ];
    for (const trip of bad) {
      expect(() => parseValhallaTrip(trip)).toThrowError(RoutingError);
      try {
        parseValhallaTrip(trip);
      } catch (e) {
        expect((e as RoutingError).code).toBe('server');
        expect((e as RoutingError).message).toMatch(/routeserver/);
      }
    }
  });
});

describe('route / routeWithAlternatives', () => {
  it('stuurt een correcte aanvraag naar de standaardserver', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(route2Legs));
    const result = await route([UTRECHT, { ...AMERSFOORT, name: 'Amersfoort' }, ARNHEM], BOCHTIG);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://valhalla1.openstreetmap.de/route');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(requestBody()).toEqual({
      locations: [
        { lat: UTRECHT.lat, lon: UTRECHT.lon, type: 'break' },
        { lat: AMERSFOORT.lat, lon: AMERSFOORT.lon, type: 'through' },
        { lat: ARNHEM.lat, lon: ARNHEM.lon, type: 'break' },
      ],
      costing: 'motorcycle',
      costing_options: { motorcycle: buildCostingOptions(BOCHTIG) },
      units: 'kilometers',
      language: 'nl-NL',
      alternates: 3,
    });
    expect(result.distanceKm).toBeCloseTo(77.833, 3);
    expect(result.maneuvers.length).toBeGreaterThan(10);
  });

  it('snel vraagt geen alternatieven; avontuurlijk wel', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(route2Legs));
    await route([UTRECHT, ARNHEM], SNEL);
    expect(requestBody(0).alternates).toBe(0);
    await route([UTRECHT, ARNHEM], AVONTUURLIJK);
    expect(requestBody(1).alternates).toBe(3);
  });

  it('gebruikt VITE_VALHALLA_URL als die gezet is', async () => {
    vi.stubEnv('VITE_VALHALLA_URL', 'https://valhalla.example.test/');
    expect(valhallaUrl('/route')).toBe('https://valhalla.example.test/route');
    fetchMock.mockResolvedValueOnce(jsonResponse(route2Legs));
    await route([UTRECHT, ARNHEM], BOCHTIG);
    expect(fetchMock.mock.calls[0][0]).toBe('https://valhalla.example.test/route');
  });

  it('bochtig kiest de bochtigste van trip + alternatieven', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(routeAlternates));
    const all = await routeWithAlternatives([UTRECHT, ARNHEM], BOCHTIG);
    const parsed = [routeAlternates.trip, ...routeAlternates.alternates.map((a) => a.trip)].map(parseValhallaTrip);
    const maxCurvature = Math.max(...parsed.map((r) => r.curvature));
    expect(all).toHaveLength(3);
    expect(all[0].curvature).toBe(maxCurvature);
    all.slice(1).forEach((r) => expect(r.curvature).toBeLessThanOrEqual(maxCurvature));
    expect(new Set(all.map((r) => r.distanceKm))).toEqual(new Set(parsed.map((r) => r.distanceKm)));
    const single = await (fetchMock.mockResolvedValueOnce(jsonResponse(routeAlternates)), route([UTRECHT, ARNHEM], BOCHTIG));
    expect(single.curvature).toBe(maxCurvature);
  });

  it('snel kiest de kortste reistijd', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(routeAlternates));
    const all = await routeWithAlternatives([UTRECHT, ARNHEM], SNEL);
    const parsed = [routeAlternates.trip, ...routeAlternates.alternates.map((a) => a.trip)].map(parseValhallaTrip);
    expect(all[0].durationS).toBe(Math.min(...parsed.map((r) => r.durationS)));
  });

  it('avontuurlijk kiest bij gelijke bochtigheid de langste route', async () => {
    const points = [UTRECHT, { lat: 52.1, lon: 5.13 }, { lat: 52.11, lon: 5.15 }, { lat: 52.12, lon: 5.15 }];
    const legs = [{ points, maneuvers: [maneuver(1, 0, 1), maneuver(4, 3, 3)] }];
    const trip = syntheticTrip(legs, { length: 5, time: 300 });
    const longer = syntheticTrip(legs, { length: 6, time: 400 });
    const shorter = syntheticTrip(legs, { length: 4, time: 200 });
    fetchMock.mockResolvedValueOnce(jsonResponse({ trip, alternates: [{ trip: shorter }, { trip: longer }] }));
    const all = await routeWithAlternatives([UTRECHT, ARNHEM], AVONTUURLIJK);
    expect(all.map((r) => r.distanceKm)).toEqual([6, 5, 4]);
  });

  it('negeert een kapot alternatief maar houdt de hoofdroute', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ trip: route2Legs.trip, alternates: [{ trip: { legs: [] } }, { nonsense: true }] }));
    const all = await routeWithAlternatives([UTRECHT, ARNHEM], BOCHTIG);
    expect(all).toHaveLength(1);
  });

  it('valideert de invoer zonder verzoek', async () => {
    await expect(route([UTRECHT], BOCHTIG)).rejects.toMatchObject({ code: 'invalid' });
    await expect(route([UTRECHT, { lat: 95, lon: 5 }], BOCHTIG)).rejects.toMatchObject({ code: 'invalid' });
    await expect(route([UTRECHT, { lat: Number.NaN, lon: 5 }], BOCHTIG)).rejects.toBeInstanceOf(RoutingError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('probeert bij fout 442 opnieuw zonder exclude_*-vlaggen', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(error442, 400)).mockResolvedValueOnce(jsonResponse(route2Legs));
    const options: RoutingOptions = { style: 'bochtig', avoid: { ...DEFAULT_AVOID, highways: true, ferries: true }, riderType: 'street' };
    const result = await route([UTRECHT, ARNHEM], options);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = (requestBody(0).costing_options as Rec).motorcycle as Rec;
    const second = (requestBody(1).costing_options as Rec).motorcycle as Rec;
    expect(first).toMatchObject({ exclude_highways: true, exclude_ferries: true, exclude_unpaved: true });
    expect(Object.keys(second).some((k) => k.startsWith('exclude_'))).toBe(false);
    expect(second).toMatchObject({ use_highways: 0, use_ferry: 0 });
    expect(result.distanceKm).toBeCloseTo(77.833, 3);
  });

  it('geeft no_route als ook de tweede poging 442 geeft', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(error442, 400));
    const options: RoutingOptions = { style: 'snel', avoid: { ...DEFAULT_AVOID, tolls: true }, riderType: 'allroad' };
    await expect(route([UTRECHT, ARNHEM], options)).rejects.toMatchObject({
      code: 'no_route',
      message: 'Geen route gevonden tussen deze punten.',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('probeert niet opnieuw als er geen exclude_*-vlaggen actief waren', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(error442, 400));
    await expect(route([UTRECHT, ARNHEM], SNEL)).rejects.toMatchObject({ code: 'no_route' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('vertaalt andere HTTP-fouten naar server', async () => {
    fetchMock.mockResolvedValueOnce(new Response('kapot', { status: 503 }));
    await expect(route([UTRECHT, ARNHEM], BOCHTIG)).rejects.toMatchObject({ code: 'server', message: expect.stringContaining('503') });
    fetchMock.mockResolvedValueOnce(jsonResponse({ error_code: 171, error: 'No suitable edges near location', status_code: 400 }, 400));
    await expect(route([UTRECHT, ARNHEM], BOCHTIG)).rejects.toMatchObject({
      code: 'server',
      message: expect.stringContaining('No suitable edges'),
    });
    fetchMock.mockResolvedValueOnce(new Response('<html>', { status: 200 }));
    await expect(route([UTRECHT, ARNHEM], BOCHTIG)).rejects.toMatchObject({ code: 'server' });
  });

  it('vertaalt een netwerkfout', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(route([UTRECHT, ARNHEM], BOCHTIG)).rejects.toMatchObject({
      code: 'network',
      message: 'Geen verbinding met de routeserver.',
    });
  });

  it('geeft aborted bij een (al) afgebroken signaal', async () => {
    const pre = new AbortController();
    pre.abort();
    await expect(route([UTRECHT, ARNHEM], BOCHTIG, pre.signal)).rejects.toMatchObject({ code: 'aborted' });
    expect(fetchMock).not.toHaveBeenCalled();

    const controller = new AbortController();
    fetchMock.mockImplementationOnce(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(abortRejection()));
        }),
    );
    const pending = route([UTRECHT, ARNHEM], BOCHTIG, controller.signal);
    const expectation = expect(pending).rejects.toMatchObject({ code: 'aborted' });
    controller.abort();
    await expectation;
  });

  it('breekt na 25 s af met een netwerkfout (time-out)', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementationOnce(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(abortRejection()));
        }),
    );
    const pending = route([UTRECHT, ARNHEM], BOCHTIG);
    const expectation = expect(pending).rejects.toMatchObject({ code: 'network', message: expect.stringContaining('time-out') });
    await vi.advanceTimersByTimeAsync(24_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_500);
    await expectation;
  });
});

describe('traceRoute', () => {
  const shape = traceShape as LatLng[];

  it('stuurt het spoor met map_snap en geeft de gematchte route', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(traceFixture));
    const result = await traceRoute(shape, BOCHTIG);
    expect(fetchMock.mock.calls[0][0]).toBe('https://valhalla1.openstreetmap.de/trace_route');
    expect(requestBody()).toEqual({
      shape: shape.map((p) => ({ lat: p.lat, lon: p.lon })),
      costing: 'motorcycle',
      costing_options: { motorcycle: buildCostingOptions(BOCHTIG) },
      shape_match: 'map_snap',
      units: 'kilometers',
      language: 'nl-NL',
    });
    expect(result.distanceKm).toBeCloseTo(0.931, 3);
    expect(result.maneuvers).toHaveLength(4);
    expect(result.geometry.length).toBeGreaterThan(10);
  });

  it('probeert bij een 4xx opnieuw met walk_or_snap', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error_code: 444, error: 'map match failed', status_code: 400 }, 400))
      .mockResolvedValueOnce(jsonResponse(traceFixture));
    const result = await traceRoute(shape, BOCHTIG);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestBody(0).shape_match).toBe('map_snap');
    expect(requestBody(1).shape_match).toBe('walk_or_snap');
    expect(requestBody(1).shape).toEqual(requestBody(0).shape);
    expect(result.distanceKm).toBeCloseTo(0.931, 3);
  });

  it('geeft no_route als ook walk_or_snap niets vindt, en server bij 5xx', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(error442, 400)).mockResolvedValueOnce(jsonResponse(error442, 400));
    await expect(traceRoute(shape, BOCHTIG)).rejects.toMatchObject({ code: 'no_route' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockResolvedValueOnce(new Response('', { status: 502 }));
    await expect(traceRoute(shape, BOCHTIG)).rejects.toMatchObject({ code: 'server' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('valideert het spoor', async () => {
    await expect(traceRoute([UTRECHT], BOCHTIG)).rejects.toMatchObject({ code: 'invalid' });
    await expect(traceRoute([UTRECHT, { lat: 1, lon: 200 }], BOCHTIG)).rejects.toMatchObject({ code: 'invalid' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('vereenvoudigt lange sporen tot maximaal 1000 punten met behoud van begin en eind', async () => {
    const long: LatLng[] = [];
    for (let i = 0; i < 3000; i++) {
      // Zigzag met grote uitslag zodat Douglas-Peucker niet genoeg wegneemt.
      long.push({ lat: 52 + i * 0.0002, lon: 5 + (i % 2 === 0 ? 0 : 0.002) });
    }
    fetchMock.mockResolvedValueOnce(jsonResponse(traceFixture));
    await traceRoute(long, BOCHTIG);
    const sent = requestBody().shape as LatLng[];
    expect(sent.length).toBeLessThanOrEqual(1000);
    expect(sent.length).toBeGreaterThan(900);
    expect(sent[0]).toEqual(long[0]);
    expect(sent[sent.length - 1]).toEqual(long[long.length - 1]);
  });

  it('prepareTraceShape: rechte lijnen worden met de kleinste tolerantie al klein', () => {
    const straight: LatLng[] = [];
    for (let i = 0; i < 1500; i++) straight.push({ lat: 52 + i * 0.0001, lon: 5 + i * 0.0001 });
    const out = prepareTraceShape(straight);
    expect(out.length).toBeLessThan(10);
    expect(out[0]).toEqual(straight[0]);
    expect(out[out.length - 1]).toEqual(straight[straight.length - 1]);
    const short = [UTRECHT, ARNHEM];
    expect(prepareTraceShape(short)).toEqual(short);
    expect(prepareTraceShape(short)).not.toBe(short);
  });
});

describe('concatRoutes', () => {
  const aPoints = [UTRECHT, { lat: 52.1, lon: 5.13 }, { lat: 52.11, lon: 5.14 }];
  const a = fakeResult(aPoints, {
    distanceKm: 2,
    durationS: 100,
    hasToll: true,
    maneuvers: [
      { type: 1, instruction: 'start', streetNames: [], lengthKm: 2, timeS: 100, beginIndex: 0, endIndex: 2 },
      { type: 5, instruction: 'aankomst', streetNames: [], lengthKm: 0, timeS: 0, beginIndex: 2, endIndex: 2 },
    ],
  });

  it('plakt b achter a, laat het dubbele punt en de tussenaankomst vallen', () => {
    const bPoints = [{ lat: 52.11, lon: 5.14 }, { lat: 52.12, lon: 5.16 }, { lat: 52.13, lon: 5.16 }];
    const b = fakeResult(bPoints, {
      distanceKm: 3,
      durationS: 200,
      hasFerry: true,
      maneuvers: [
        { type: 2, instruction: 'verder', streetNames: ['A'], lengthKm: 3, timeS: 200, beginIndex: 0, endIndex: 2 },
        { type: 4, instruction: 'aankomst', streetNames: [], lengthKm: 0, timeS: 0, beginIndex: 2, endIndex: 2 },
      ],
    });
    const joined = concatRoutes(a, b);
    expect(joined.geometry).toEqual([...aPoints, ...bPoints.slice(1)]);
    expect(joined.maneuvers.map((m) => [m.type, m.beginIndex, m.endIndex])).toEqual([
      [1, 0, 2],
      [2, 2, 4],
      [4, 4, 4],
    ]);
    expect(joined).toMatchObject({ distanceKm: 5, durationS: 300, hasHighway: false, hasToll: true, hasFerry: true });
    expect(joined.curvature).toBeGreaterThan(0);
    // Invoer blijft onaangetast.
    expect(a.maneuvers).toHaveLength(2);
    expect(b.maneuvers[0].beginIndex).toBe(0);
  });

  it('houdt alle punten als b elders begint', () => {
    const bPoints = [{ lat: 52.2, lon: 5.2 }, { lat: 52.21, lon: 5.21 }];
    const b = fakeResult(bPoints, {
      maneuvers: [{ type: 1, instruction: 's', streetNames: [], lengthKm: 1, timeS: 1, beginIndex: 0, endIndex: 1 }],
    });
    const joined = concatRoutes(a, b);
    expect(joined.geometry).toHaveLength(5);
    expect(joined.maneuvers.map((m) => [m.type, m.beginIndex, m.endIndex])).toEqual([
      [1, 0, 2],
      [1, 3, 4],
    ]);
  });
});
