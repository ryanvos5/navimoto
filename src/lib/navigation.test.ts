import { describe, expect, it } from 'vitest';
import type { LatLng, Maneuver, RouteResult, TrackPoint, Waypoint } from '@/types';
import { EARTH_RADIUS_KM, cumulativeKm, haversineM, pathLengthKm } from '@/lib/geo';
import {
  ARRIVAL_DISTANCE_M,
  ARRIVAL_REMAINING_KM,
  OFF_ROUTE_CONSECUTIVE,
  OFF_ROUTE_DISTANCE_M,
  SEARCH_WINDOW,
  buildTrackSummary,
  computeProgress,
  isArriveManeuver,
  isStartManeuver,
  maneuverIconName,
  remainingWaypoints,
  speechDistances,
  type ManeuverIconName,
} from '@/lib/navigation';

// ---------------------------------------------------------------------------
// Hulpfuncties: een lokaal vlak rond 52°N / 5°E in meters (x = oost, y = noord).
// ---------------------------------------------------------------------------

const LAT0 = 52.0;
const LON0 = 5.0;
const M_PER_DEG_LAT = (EARTH_RADIUS_KM * 1000 * Math.PI) / 180;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((LAT0 * Math.PI) / 180);

/** Punt `x` meter oostelijk en `y` meter noordelijk van de oorsprong. */
function xy(x: number, y = 0): LatLng {
  return { lat: LAT0 + y / M_PER_DEG_LAT, lon: LON0 + x / M_PER_DEG_LON };
}

/** Punten van (x0,y0) naar (x1,y1) met een vaste stap; het beginpunt wordt weggelaten als `skipFirst`. */
function line(x0: number, y0: number, x1: number, y1: number, stepM: number, skipFirst = false): LatLng[] {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(1, Math.round(len / stepM));
  const out: LatLng[] = [];
  for (let i = skipFirst ? 1 : 0; i <= n; i++) {
    const f = i / n;
    out.push(xy(x0 + f * (x1 - x0), y0 + f * (y1 - y0)));
  }
  return out;
}

function maneuver(type: number, beginIndex: number, endIndex: number, extra: Partial<Maneuver> = {}): Maneuver {
  return {
    type,
    instruction: `Instructie ${type} @${beginIndex}`,
    streetNames: [],
    lengthKm: 0,
    timeS: 0,
    beginIndex,
    endIndex,
    ...extra,
  };
}

function routeOf(geometry: LatLng[], maneuvers: Maneuver[] = [], durationS = 240): RouteResult {
  return {
    geometry,
    distanceKm: pathLengthKm(geometry),
    durationS,
    maneuvers,
    hasHighway: false,
    hasToll: false,
    hasFerry: false,
    curvature: 0,
  };
}

// Rechte route van 2 km naar het oosten: 21 punten om de 100 m, indexen 0..20.
const STRAIGHT = line(0, 0, 2000, 0, 100);
const START = maneuver(1, 0, 5, { instruction: 'Rijd richting het oosten.', verbalPre: 'Richting het oosten rijden.' });
const RIGHT = maneuver(10, 5, 12, { instruction: 'Sla rechtsaf naar A.', verbalPre: 'Rechts afslaan naar A.', verbalAlert: 'Over 300 meter rechts afslaan.' });
const LEFT = maneuver(15, 12, 20, { instruction: 'Sla linksaf naar B.', verbalPre: 'Links afslaan naar B.' });
const ARRIVE = maneuver(4, 20, 20, { instruction: 'Je bent op je bestemming.' });
const STRAIGHT_ROUTE = routeOf(STRAIGHT, [START, RIGHT, LEFT, ARRIVE]);
const STRAIGHT_CUM = cumulativeKm(STRAIGHT);
const STRAIGHT_TOTAL = STRAIGHT_CUM[STRAIGHT_CUM.length - 1];

describe('constanten', () => {
  it('hebben de afgesproken waarden', () => {
    expect(OFF_ROUTE_DISTANCE_M).toBe(60);
    expect(OFF_ROUTE_CONSECUTIVE).toBe(3);
    expect(ARRIVAL_DISTANCE_M).toBe(30);
    expect(SEARCH_WINDOW).toBe(200);
    expect(ARRIVAL_REMAINING_KM).toBe(0.03);
  });

  it('herkent vertrek- en bestemmingsmanoeuvres', () => {
    expect(isStartManeuver(START)).toBe(true);
    expect(isStartManeuver(RIGHT)).toBe(false);
    expect(isArriveManeuver(ARRIVE)).toBe(true);
    expect(isArriveManeuver(LEFT)).toBe(false);
  });
});

describe('computeProgress', () => {
  it('bij vertrek: begin van de route, vertrekmanoeuvre is de volgende, niets afgelegd', () => {
    const p = computeProgress(STRAIGHT_ROUTE, STRAIGHT_CUM, xy(0), null);
    expect(p.alongKm).toBeCloseTo(0, 6);
    expect(p.remainingKm).toBeCloseTo(STRAIGHT_TOTAL, 6);
    expect(p.remainingS).toBeCloseTo(240, 3);
    expect(p.nextManeuver).toBe(START);
    expect(p.maneuverIndex).toBe(0);
    expect(p.distanceToNextM).toBe(0);
    expect(p.snapIndex).toBe(0);
    expect(p.snapPoint.lat).toBeCloseTo(LAT0, 8);
    expect(p.distanceFromRouteM).toBeLessThan(0.01);
    expect(p.offRoute).toBe(false);
    expect(p.arrived).toBe(false);
  });

  it('na vertrek wordt de vertrekmanoeuvre overgeslagen en telt de afstand tot de eerste bocht', () => {
    const p = computeProgress(STRAIGHT_ROUTE, STRAIGHT_CUM, xy(250), 0);
    expect(p.snapIndex).toBe(2);
    expect(p.alongKm).toBeCloseTo(0.25, 4);
    expect(p.nextManeuver).toBe(RIGHT);
    expect(p.maneuverIndex).toBe(1);
    expect(p.distanceToNextM).toBeCloseTo(250, 0);
    expect(p.remainingKm).toBeCloseTo(STRAIGHT_TOTAL - 0.25, 4);
    expect(p.remainingS).toBeCloseTo(240 * ((STRAIGHT_TOTAL - 0.25) / STRAIGHT_TOTAL), 3);
    expect(p.arrived).toBe(false);
  });

  it('een klein stukje na het startpunt (t > 0 op segment 0) is de bocht al de volgende manoeuvre', () => {
    const p = computeProgress(STRAIGHT_ROUTE, STRAIGHT_CUM, xy(30), 0);
    expect(p.snapIndex).toBe(0);
    expect(p.nextManeuver).toBe(RIGHT);
    expect(p.distanceToNextM).toBeCloseTo(470, 0);
  });

  it('precies op en net voorbij het manoeuvrepunt blijft die manoeuvre de volgende (afstand 0)', () => {
    const exact = computeProgress(STRAIGHT_ROUTE, STRAIGHT_CUM, xy(500), 3);
    expect(exact.nextManeuver).toBe(RIGHT);
    expect(exact.distanceToNextM).toBeCloseTo(0, 0);

    const past = computeProgress(STRAIGHT_ROUTE, STRAIGHT_CUM, xy(530), 4);
    expect(past.snapIndex).toBe(5);
    expect(past.nextManeuver).toBe(RIGHT); // beginIndex === snapIndex en t < 1
    expect(past.distanceToNextM).toBe(0); // nooit negatief

    const next = computeProgress(STRAIGHT_ROUTE, STRAIGHT_CUM, xy(600), 5);
    expect(next.nextManeuver).toBe(LEFT);
    expect(next.maneuverIndex).toBe(2);
    expect(next.distanceToNextM).toBeCloseTo(600, 0);
  });

  it('vlak voor het einde is de bestemming de volgende manoeuvre; aankomst binnen 30 m of 30 m langs de route', () => {
    const before = computeProgress(STRAIGHT_ROUTE, STRAIGHT_CUM, xy(1960), 18);
    expect(before.nextManeuver).toBe(ARRIVE);
    expect(before.maneuverIndex).toBe(3);
    expect(before.distanceToNextM).toBeCloseTo(40, 0);
    expect(before.arrived).toBe(false);

    const near = computeProgress(STRAIGHT_ROUTE, STRAIGHT_CUM, xy(1975), 18);
    expect(near.arrived).toBe(true);

    const end = computeProgress(STRAIGHT_ROUTE, STRAIGHT_CUM, xy(2000), 19);
    expect(end.arrived).toBe(true);
    expect(end.remainingKm).toBeCloseTo(0, 6);
    expect(end.remainingS).toBe(0);

    // Voorbij het einde: alongKm blijft begrensd op de totale lengte.
    const beyond = computeProgress(STRAIGHT_ROUTE, STRAIGHT_CUM, xy(2100), 19);
    expect(beyond.alongKm).toBeCloseTo(STRAIGHT_TOTAL, 6);
    expect(beyond.remainingKm).toBe(0);
    expect(beyond.arrived).toBe(true);
  });

  it('naast de route: afstand tot de route wordt gemeld, offRoute wordt hier niet beslist', () => {
    const p = computeProgress(STRAIGHT_ROUTE, STRAIGHT_CUM, xy(700, -100), 5);
    expect(p.distanceFromRouteM).toBeCloseTo(100, 0);
    expect(p.offRoute).toBe(false);
    expect(p.alongKm).toBeCloseTo(0.7, 3);
    expect(p.snapPoint.lat).toBeCloseTo(LAT0, 8);
  });

  it('remainingS gebruikt de verhouding resterend/totaal en is 0 bij een route zonder lengte', () => {
    const p = computeProgress(STRAIGHT_ROUTE, STRAIGHT_CUM, xy(1000), 8);
    expect(p.remainingS).toBeCloseTo(120, 3);

    const degenerate = routeOf([xy(0), xy(0)], []);
    const q = computeProgress(degenerate, cumulativeKm(degenerate.geometry), xy(0), null);
    expect(q.remainingS).toBe(0);
    expect(q.remainingKm).toBe(0);
    expect(q.nextManeuver).toBeNull();
    expect(q.maneuverIndex).toBe(-1);
    expect(q.distanceToNextM).toBe(0);
  });

  it('werkt zonder te crashen op een geometrie met minder dan twee punten', () => {
    const single = routeOf([xy(0)], []);
    const p = computeProgress(single, cumulativeKm(single.geometry), xy(500), null);
    expect(p.snapIndex).toBe(0);
    expect(p.snapPoint).toEqual(xy(0));
    expect(p.distanceFromRouteM).toBeCloseTo(500, 0);
    expect(p.alongKm).toBe(0);

    const empty = routeOf([], []);
    const q = computeProgress(empty, [], xy(0), null);
    expect(q.snapPoint).toEqual(xy(0));
    expect(q.distanceFromRouteM).toBe(0);
  });

  describe('zoekvenster rond de vorige index', () => {
    // Heen 6 km naar het oosten (301 punten om de 20 m), terug 100 m noordelijker (300 punten).
    const OUT = line(0, 0, 6000, 0, 20);
    const BACK = line(6000, 100, 0, 100, 20);
    const U = routeOf([...OUT, ...BACK]);
    const U_CUM = cumulativeKm(U.geometry);
    const BACK_START = OUT.length; // index van het eerste punt op de terugweg

    it('blijft in het venster zolang de afstand binnen 60 m is, ook als de hele lijn iets dichterbij ligt', () => {
      // 55 m boven de heenweg: terugweg is 45 m weg (dichterbij), maar het venster rond index 100 wint.
      const p = computeProgress(U, U_CUM, xy(3000, 55), 100);
      expect(p.snapIndex).toBeGreaterThanOrEqual(149);
      expect(p.snapIndex).toBeLessThanOrEqual(150);
      expect(p.distanceFromRouteM).toBeCloseTo(55, 0);
      expect(p.alongKm).toBeCloseTo(3, 3);
    });

    it('zoekt over de hele lijn als het venster verder dan 60 m oplevert en neemt de dichtstbijzijnde', () => {
      // 95 m boven de heenweg: venster geeft 95 m, hele lijn geeft 5 m op de terugweg.
      const p = computeProgress(U, U_CUM, xy(3000, 95), 100);
      expect(p.snapIndex).toBeGreaterThanOrEqual(BACK_START);
      expect(p.distanceFromRouteM).toBeCloseTo(5, 0);
      expect(p.alongKm).toBeCloseTo(6 + 0.1 + 3, 2);
    });

    it('houdt het venster als de hele lijn niets beters oplevert', () => {
      // 200 m onder de heenweg: venster 200 m, hele lijn ook 200 m -> venster-resultaat blijft.
      const p = computeProgress(U, U_CUM, xy(3000, -200), 100);
      expect(p.snapIndex).toBeGreaterThanOrEqual(149);
      expect(p.snapIndex).toBeLessThanOrEqual(150);
      expect(p.distanceFromRouteM).toBeCloseTo(200, 0);
    });

    it('zoekt zonder vorige index over de hele lijn', () => {
      const p = computeProgress(U, U_CUM, xy(3000, 55), null);
      expect(p.snapIndex).toBeGreaterThanOrEqual(BACK_START);
      expect(p.distanceFromRouteM).toBeCloseTo(45, 0);
    });

    it('zoekt ook een stukje terug (GPS-sprong achteruit)', () => {
      const p = computeProgress(U, U_CUM, xy(2400, 0), 150); // index 120, 30 punten terug
      expect(p.snapIndex).toBeGreaterThanOrEqual(119);
      expect(p.snapIndex).toBeLessThanOrEqual(120);
      expect(p.distanceFromRouteM).toBeLessThan(0.01);
    });
  });

  describe('aankomst', () => {
    it('een rondrit (start = einde) is bij vertrek niet aangekomen', () => {
      // Vierkant van 4 x 500 m, terug naar het startpunt.
      const square = routeOf([
        ...line(0, 0, 500, 0, 50),
        ...line(500, 0, 500, 500, 50, true),
        ...line(500, 500, 0, 500, 50, true),
        ...line(0, 500, 0, 0, 50, true),
      ]);
      const cum = cumulativeKm(square.geometry);
      const lastIndex = square.geometry.length - 1;

      const atStartWindowed = computeProgress(square, cum, xy(0, 0), 0);
      expect(atStartWindowed.arrived).toBe(false);
      expect(atStartWindowed.alongKm).toBeCloseTo(0, 6);

      const atStartGlobal = computeProgress(square, cum, xy(0, 0), null);
      expect(atStartGlobal.arrived).toBe(false);
      expect(atStartGlobal.snapIndex).toBe(0);

      // 10 m voor het sluiten van de lus (op de laatste poot, van (0,500) naar (0,0)).
      const nearEnd = computeProgress(square, cum, xy(0, 10), lastIndex - 2);
      expect(nearEnd.remainingKm).toBeCloseTo(0.01, 3);
      expect(nearEnd.arrived).toBe(true);
    });

    it('binnen 30 m van het eindpunt telt als aankomst zolang er langs de route niet veel meer over is', () => {
      // Haarspeld: 1 km oost, 40 m noord, 80 m terug naar het westen (einde).
      const hairpin = routeOf([...line(0, 0, 1000, 0, 50), ...line(1000, 0, 1000, 40, 40, true), ...line(1000, 40, 920, 40, 20, true)]);
      const cum = cumulativeKm(hairpin.geometry);
      // 15 m boven de heenweg ter hoogte van het einde: snapt op de heenweg (15 m) in plaats van de terugweg (25 m).
      const p = computeProgress(hairpin, cum, xy(920, 15), 15);
      expect(p.distanceFromRouteM).toBeCloseTo(15, 0);
      expect(p.remainingKm).toBeCloseTo(0.2, 3);
      expect(haversineM(xy(920, 15), hairpin.geometry[hairpin.geometry.length - 1])).toBeCloseTo(25, 0);
      expect(p.arrived).toBe(true);
    });

    it('ver van het einde langs de route is het geen aankomst, ook niet hemelsbreed dichtbij', () => {
      // Zelfde haarspeld, maar de terugweg is 400 m: hemelsbreed 25 m van het einde, langs de route nog 840 m.
      const hairpin = routeOf([...line(0, 0, 1000, 0, 50), ...line(1000, 0, 1000, 40, 40, true), ...line(1000, 40, 600, 40, 20, true)]);
      const cum = cumulativeKm(hairpin.geometry);
      const p = computeProgress(hairpin, cum, xy(600, 15), 10);
      expect(p.remainingKm).toBeCloseTo(0.84, 2);
      expect(p.arrived).toBe(false);
    });
  });
});

describe('maneuverIconName', () => {
  it.each<[number[], ManeuverIconName]>([
    [[1, 2, 3], 'start'],
    [[4, 5, 6], 'arrive'],
    [[7, 8, 17, 22], 'straight'],
    [[9, 23], 'slight-right'],
    [[10], 'right'],
    [[11], 'sharp-right'],
    [[12, 13], 'uturn'],
    [[14], 'sharp-left'],
    [[15], 'left'],
    [[16, 24], 'slight-left'],
    [[18], 'ramp-right'],
    [[19], 'ramp-left'],
    [[20], 'exit-right'],
    [[21], 'exit-left'],
    [[25, 37, 38], 'merge'],
    [[26, 27], 'roundabout'],
    [[28, 29], 'ferry'],
  ])('types %j -> %s', (types, expected) => {
    for (const t of types) expect(maneuverIconName(t)).toBe(expected);
  });

  it('onbekende types tonen rechtdoor', () => {
    expect(maneuverIconName(0)).toBe('straight');
    expect(maneuverIconName(30)).toBe('straight');
    expect(maneuverIconName(99)).toBe('straight');
    expect(maneuverIconName(-1)).toBe('straight');
  });
});

describe('remainingWaypoints', () => {
  const wp = (x: number, name: string, y = 0): Waypoint => ({ ...xy(x, y), name });
  const WAYPOINTS = [wp(0, 'Start'), wp(500, 'Via A'), wp(1500, 'Via B'), wp(2000, 'Einde')];

  it('geeft alleen de waypoints die nog voor de rijder liggen, altijd inclusief het laatste', () => {
    expect(remainingWaypoints(STRAIGHT_ROUTE, WAYPOINTS, 0).map((w) => w.name)).toEqual(['Via A', 'Via B', 'Einde']);
    expect(remainingWaypoints(STRAIGHT_ROUTE, WAYPOINTS, 0.4).map((w) => w.name)).toEqual(['Via A', 'Via B', 'Einde']);
    expect(remainingWaypoints(STRAIGHT_ROUTE, WAYPOINTS, 0.6).map((w) => w.name)).toEqual(['Via B', 'Einde']);
    expect(remainingWaypoints(STRAIGHT_ROUTE, WAYPOINTS, 1.9).map((w) => w.name)).toEqual(['Einde']);
    expect(remainingWaypoints(STRAIGHT_ROUTE, WAYPOINTS, 5).map((w) => w.name)).toEqual(['Einde']);
  });

  it('een waypoint binnen 50 m voor de positie geldt als bereikt', () => {
    expect(remainingWaypoints(STRAIGHT_ROUTE, WAYPOINTS, 0.46).map((w) => w.name)).toEqual(['Via B', 'Einde']);
    expect(remainingWaypoints(STRAIGHT_ROUTE, WAYPOINTS, 0.44).map((w) => w.name)).toEqual(['Via A', 'Via B', 'Einde']);
  });

  it('snapt via-punten die iets naast de lijn liggen', () => {
    const offLine = [wp(0, 'Start'), wp(500, 'Via', 12), wp(2000, 'Einde')];
    expect(remainingWaypoints(STRAIGHT_ROUTE, offLine, 0.3).map((w) => w.name)).toEqual(['Via', 'Einde']);
    expect(remainingWaypoints(STRAIGHT_ROUTE, offLine, 0.7).map((w) => w.name)).toEqual(['Einde']);
  });

  it('slaat het eerste waypoint altijd over en behandelt korte lijsten', () => {
    expect(remainingWaypoints(STRAIGHT_ROUTE, [], 0)).toEqual([]);
    expect(remainingWaypoints(STRAIGHT_ROUTE, [wp(0, 'Start'), wp(2000, 'Einde')], 0).map((w) => w.name)).toEqual(['Einde']);
    expect(remainingWaypoints(STRAIGHT_ROUTE, [wp(0, 'Alleen')], 0).map((w) => w.name)).toEqual(['Alleen']);
  });

  it('rondrit: het laatste waypoint (= start) blijft de bestemming', () => {
    const loop = [wp(0, 'Start'), wp(500, 'Via'), wp(0, 'Start')];
    const result = remainingWaypoints(STRAIGHT_ROUTE, loop, 1);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(loop[2]);
  });
});

describe('speechDistances', () => {
  it('300/60 m bij lage of onbekende snelheid, 500/100 m boven 70 km/u', () => {
    expect(speechDistances(null)).toEqual({ alertM: 300, preM: 60 });
    expect(speechDistances(0)).toEqual({ alertM: 300, preM: 60 });
    expect(speechDistances(50)).toEqual({ alertM: 300, preM: 60 });
    expect(speechDistances(70)).toEqual({ alertM: 300, preM: 60 });
    expect(speechDistances(70.5)).toEqual({ alertM: 500, preM: 100 });
    expect(speechDistances(120)).toEqual({ alertM: 500, preM: 100 });
    expect(speechDistances(Number.NaN)).toEqual({ alertM: 300, preM: 60 });
  });
});

describe('buildTrackSummary', () => {
  const T0 = 1_700_000_000_000;
  const tp = (x: number, dtS: number, speedKmh?: number): TrackPoint => ({
    ...xy(x),
    t: T0 + dtS * 1000,
    ...(speedKmh !== undefined ? { speedKmh } : {}),
  });

  it('telt alleen rijdende tijd (> 3 km/u) en middelt daarover', () => {
    const points = [tp(0, 0, 0), tp(150, 10, 50), tp(150, 20, 0), tp(300, 30, 40), tp(300, 40, 2)];
    const s = buildTrackSummary(points, T0, T0 + 60_000);
    expect(s.distanceKm).toBeCloseTo(0.3, 4);
    expect(s.durationS).toBe(60);
    expect(s.movingS).toBe(20);
    expect(s.avgSpeedKmh).toBeCloseTo(0.3 / (20 / 3600), 3);
    expect(s.maxSpeedKmh).toBe(50);
  });

  it('leidt de snelheid af uit afstand en tijd als een punt geen snelheid heeft', () => {
    // 150 m in 10 s = 54 km/u (rijdend); 5 m in 10 s = 1,8 km/u (stilstaand).
    const points = [tp(0, 0), tp(150, 10), tp(155, 20)];
    const s = buildTrackSummary(points, T0, T0 + 20_000);
    expect(s.movingS).toBe(10);
    expect(s.maxSpeedKmh).toBe(0); // alleen puntsnelheden tellen voor het maximum
    expect(s.avgSpeedKmh).toBeCloseTo(0.155 / (10 / 3600), 2);
  });

  it('negeert punten zonder tijdsverloop en negatieve duur', () => {
    const points = [tp(0, 0, 30), tp(100, 0, 30), tp(200, 5, 30)];
    const s = buildTrackSummary(points, T0 + 10_000, T0);
    expect(s.durationS).toBe(0);
    expect(s.movingS).toBe(5);
    expect(s.maxSpeedKmh).toBe(30);
  });

  it('geeft nullen voor een lege of eenpunts-opname', () => {
    expect(buildTrackSummary([], T0, T0 + 5000)).toEqual({ distanceKm: 0, durationS: 5, movingS: 0, avgSpeedKmh: 0, maxSpeedKmh: 0 });
    expect(buildTrackSummary([tp(0, 0, 12)], T0, T0 + 5000)).toEqual({ distanceKm: 0, durationS: 5, movingS: 0, avgSpeedKmh: 0, maxSpeedKmh: 12 });
  });
});
