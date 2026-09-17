import { describe, expect, it } from 'vitest';
import {
  angleDiff,
  bearingDeg,
  boundsCenter,
  boundsOf,
  cumulativeKm,
  curvatureScore,
  decodePolyline,
  destinationPoint,
  encodePolyline,
  haversineKm,
  haversineM,
  isValidLatLng,
  nearestPointOnPath,
  newId,
  normalizeLon,
  pathLengthKm,
  pointAlong,
  seededRandom,
  simplifyPath,
} from '@/lib/geo';
import type { LatLng } from '@/types';

const UTRECHT: LatLng = { lat: 52.0907, lon: 5.1214 };
const ARNHEM: LatLng = { lat: 51.9851, lon: 5.8987 };

/** Lijn langs de evenaar: elk segment is ~1,112 km. */
const EQUATOR: LatLng[] = [
  { lat: 0, lon: 0 },
  { lat: 0, lon: 0.01 },
  { lat: 0, lon: 0.02 },
];

describe('haversineKm / haversineM', () => {
  it('Utrecht - Arnhem is ongeveer 54,4 km', () => {
    const d = haversineKm(UTRECHT, ARNHEM);
    // Eigen berekening (R = 6371,0088 km): 54,449 km. Marge 2 km.
    expect(Math.abs(d - 54.449)).toBeLessThan(2);
    expect(haversineKm(ARNHEM, UTRECHT)).toBeCloseTo(d, 9);
    expect(haversineM(UTRECHT, ARNHEM)).toBeCloseTo(d * 1000, 6);
  });

  it('afstand naar zichzelf is 0', () => {
    expect(haversineKm(UTRECHT, UTRECHT)).toBe(0);
  });
});

describe('bearingDeg', () => {
  it('noord is 0, oost is 90, zuid is 180, west is 270', () => {
    expect(bearingDeg({ lat: 52, lon: 5 }, { lat: 53, lon: 5 })).toBeCloseTo(0, 6);
    expect(bearingDeg({ lat: 0, lon: 5 }, { lat: 0, lon: 6 })).toBeCloseTo(90, 6);
    expect(bearingDeg({ lat: 53, lon: 5 }, { lat: 52, lon: 5 })).toBeCloseTo(180, 6);
    expect(bearingDeg({ lat: 0, lon: 6 }, { lat: 0, lon: 5 })).toBeCloseTo(270, 6);
  });

  it('op 52° NB is oost bijna 90', () => {
    const b = bearingDeg({ lat: 52, lon: 5 }, { lat: 52, lon: 5.01 });
    expect(Math.abs(b - 90)).toBeLessThan(0.1);
  });
});

describe('destinationPoint', () => {
  it('round-trip: haversine terug naar de oorsprong is gelijk aan de afstand (binnen 1 m)', () => {
    for (const bearing of [0, 45, 90, 137.5, 270]) {
      const dest = destinationPoint(UTRECHT, bearing, 10);
      expect(Math.abs(haversineKm(UTRECHT, dest) - 10)).toBeLessThan(0.001);
      expect(Math.abs(angleDiff(bearingDeg(UTRECHT, dest), bearing))).toBeLessThan(0.01);
    }
  });

  it('afstand 0 geeft de oorsprong', () => {
    const dest = destinationPoint(UTRECHT, 90, 0);
    expect(dest.lat).toBeCloseTo(UTRECHT.lat, 9);
    expect(dest.lon).toBeCloseTo(UTRECHT.lon, 9);
  });

  it('normaliseert de lengtegraad over de datumgrens', () => {
    const dest = destinationPoint({ lat: 0, lon: 179.9 }, 90, 50);
    expect(dest.lon).toBeLessThan(-179);
  });
});

describe('polyline', () => {
  it('round-trip op precisie 6 met negatieve coördinaten', () => {
    const pts: LatLng[] = [
      { lat: -33.868819, lon: 151.209296 },
      { lat: -34.603722, lon: -58.381592 },
      { lat: 52.0907, lon: 5.1214 },
      { lat: 0, lon: 0 },
      { lat: -0.000001, lon: -0.000001 },
    ];
    const decoded = decodePolyline(encodePolyline(pts, 6), 6);
    expect(decoded).toHaveLength(pts.length);
    decoded.forEach((p, i) => {
      expect(p.lat).toBeCloseTo(pts[i].lat, 6);
      expect(p.lon).toBeCloseTo(pts[i].lon, 6);
    });
  });

  it('decodeert het bekende Google-voorbeeld op precisie 5', () => {
    const decoded = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5);
    expect(decoded).toHaveLength(3);
    expect(decoded[0].lat).toBeCloseTo(38.5, 5);
    expect(decoded[0].lon).toBeCloseTo(-120.2, 5);
    expect(decoded[2].lat).toBeCloseTo(43.252, 5);
    expect(decoded[2].lon).toBeCloseTo(-126.453, 5);
    expect(encodePolyline(decoded, 5)).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  });

  it('lege invoer', () => {
    expect(encodePolyline([])).toBe('');
    expect(decodePolyline('')).toEqual([]);
  });
});

describe('pathLengthKm / cumulativeKm', () => {
  it('cumulatief begint op 0 en eindigt op de totale lengte', () => {
    const cum = cumulativeKm(EQUATOR);
    expect(cum).toHaveLength(3);
    expect(cum[0]).toBe(0);
    expect(cum[2]).toBeCloseTo(pathLengthKm(EQUATOR), 9);
    expect(cum[1]).toBeCloseTo(1.112, 2);
    expect(pathLengthKm([])).toBe(0);
    expect(pathLengthKm([UTRECHT])).toBe(0);
  });
});

describe('nearestPointOnPath', () => {
  const cum = cumulativeKm(EQUATOR);

  it('geeft null bij minder dan 2 punten', () => {
    expect(nearestPointOnPath([], UTRECHT)).toBeNull();
    expect(nearestPointOnPath([UTRECHT], UTRECHT)).toBeNull();
  });

  it('snapt midden op een segment', () => {
    const snap = nearestPointOnPath(EQUATOR, { lat: 0.001, lon: 0.005 });
    expect(snap).not.toBeNull();
    expect(snap!.index).toBe(0);
    expect(snap!.t).toBeCloseTo(0.5, 3);
    expect(snap!.point.lat).toBeCloseTo(0, 6);
    expect(snap!.point.lon).toBeCloseTo(0.005, 6);
    expect(Math.abs(snap!.distanceM - 111.2)).toBeLessThan(1);
  });

  it('klemt op de eindpunten', () => {
    const before = nearestPointOnPath(EQUATOR, { lat: 0.001, lon: -0.01 })!;
    expect(before.index).toBe(0);
    expect(before.t).toBe(0);
    expect(before.point).toEqual(EQUATOR[0]);

    const after = nearestPointOnPath(EQUATOR, { lat: 0, lon: 0.05 })!;
    expect(after.index).toBe(1);
    expect(after.t).toBe(1);
    expect(after.point).toEqual(EQUATOR[2]);
  });

  it('berekent alongKm met een cumulatieve lijst', () => {
    const snap = nearestPointOnPath(EQUATOR, { lat: 0, lon: 0.015 }, cum)!;
    expect(snap.index).toBe(1);
    expect(snap.t).toBeCloseTo(0.5, 3);
    expect(snap.alongKm).toBeCloseTo(cum[1] + 0.5 * (cum[2] - cum[1]), 6);
    expect(snap.alongKm).toBeCloseTo(1.5 * 1.11195, 3);
  });

  it('zonder cumulatieve lijst is alongKm alleen de afstand binnen het segment', () => {
    const snap = nearestPointOnPath(EQUATOR, { lat: 0, lon: 0.015 })!;
    expect(snap.alongKm).toBeCloseTo(0.5 * 1.11195, 3);
  });

  it('respecteert het zoekvenster searchFrom/searchTo', () => {
    // Het punt ligt op segment 0, maar we zoeken alleen vanaf segment 1.
    const fromOne = nearestPointOnPath(EQUATOR, { lat: 0.001, lon: 0.005 }, cum, 1)!;
    expect(fromOne.index).toBe(1);
    expect(fromOne.t).toBe(0);
    expect(fromOne.point).toEqual(EQUATOR[1]);

    // Het punt ligt op segment 1, maar we zoeken alleen in segment 0.
    const onlyZero = nearestPointOnPath(EQUATOR, { lat: 0, lon: 0.015 }, cum, 0, 1)!;
    expect(onlyZero.index).toBe(0);
    expect(onlyZero.t).toBe(1);

    // Een venster buiten bereik wordt geklemd.
    const clamped = nearestPointOnPath(EQUATOR, { lat: 0, lon: 0.015 }, cum, 50, 99)!;
    expect(clamped.index).toBe(1);
  });
});

describe('curvatureScore', () => {
  it('een rechte lijn scoort 0', () => {
    expect(curvatureScore(EQUATOR)).toBe(0);
    expect(curvatureScore([])).toBe(0);
    expect(curvatureScore([EQUATOR[0], EQUATOR[1]])).toBe(0);
  });

  it('een zigzag scoort hoger dan een rechte lijn', () => {
    const zigzag: LatLng[] = [];
    for (let i = 0; i <= 10; i++) zigzag.push({ lat: i % 2 === 0 ? 0 : 0.005, lon: i * 0.01 });
    const straight: LatLng[] = [];
    for (let i = 0; i <= 10; i++) straight.push({ lat: 0, lon: i * 0.01 });
    expect(curvatureScore(straight)).toBe(0);
    expect(curvatureScore(zigzag)).toBeGreaterThan(curvatureScore(straight));
    // 9 knikken van ~53° over ~12,4 km ≈ 38°/km.
    expect(curvatureScore(zigzag)).toBeGreaterThan(20);
    expect(curvatureScore(zigzag)).toBeLessThan(60);
  });

  it('negeert GPS-ruis in hele korte segmenten', () => {
    const noisy: LatLng[] = [
      { lat: 0, lon: 0 },
      { lat: 0.00002, lon: 0.00001 }, // ~2 m verderop, schuin
      { lat: 0, lon: 0.01 },
      { lat: 0, lon: 0.02 },
    ];
    expect(curvatureScore(noisy)).toBeLessThan(1);
  });
});

describe('simplifyPath', () => {
  const noisyLine: LatLng[] = [];
  for (let i = 0; i <= 100; i++) {
    // ~1 m ruis dwars op een rechte lijn van 11 km.
    noisyLine.push({ lat: (i % 2 === 0 ? 1 : -1) * 0.000009, lon: i * 0.001 });
  }

  it('behoudt de eindpunten en verwijdert punten binnen de tolerantie', () => {
    const simplified = simplifyPath(noisyLine, 20);
    expect(simplified.length).toBeLessThan(noisyLine.length);
    expect(simplified.length).toBeGreaterThanOrEqual(2);
    expect(simplified[0]).toEqual(noisyLine[0]);
    expect(simplified[simplified.length - 1]).toEqual(noisyLine[noisyLine.length - 1]);
  });

  it('behoudt een echte bocht', () => {
    const withBend = noisyLine.map((p, i) => (i === 50 ? { lat: 0.001, lon: p.lon } : p)); // ~110 m uitwijking
    const simplified = simplifyPath(withBend, 20);
    expect(simplified).toContainEqual({ lat: 0.001, lon: withBend[50].lon });
    expect(simplified.length).toBeLessThan(withBend.length);
  });

  it('tolerantie 0 geeft een kopie', () => {
    const copy = simplifyPath(noisyLine, 0);
    expect(copy).toEqual(noisyLine);
    expect(copy).not.toBe(noisyLine);
  });

  it('2 punten (of minder) geeft een kopie', () => {
    const two = [EQUATOR[0], EQUATOR[2]];
    const copy = simplifyPath(two, 50);
    expect(copy).toEqual(two);
    expect(copy).not.toBe(two);
    expect(simplifyPath([], 50)).toEqual([]);
  });
});

describe('pointAlong', () => {
  const cum = cumulativeKm(EQUATOR);
  const total = cum[cum.length - 1];

  it('begin', () => {
    const r = pointAlong(EQUATOR, cum, 0);
    expect(r.point).toEqual(EQUATOR[0]);
    expect(r.index).toBe(0);
    expect(r.bearing).toBeCloseTo(90, 6);
    expect(pointAlong(EQUATOR, cum, -5).point).toEqual(EQUATOR[0]);
  });

  it('midden', () => {
    const quarter = pointAlong(EQUATOR, cum, total / 4);
    expect(quarter.index).toBe(0);
    expect(quarter.point.lat).toBeCloseTo(0, 9);
    expect(quarter.point.lon).toBeCloseTo(0.005, 6);
    expect(quarter.bearing).toBeCloseTo(90, 6);

    // Precies op een knooppunt: het punt is het knooppunt zelf (de index mag 0 of 1 zijn).
    const half = pointAlong(EQUATOR, cum, total / 2);
    expect(half.point.lat).toBeCloseTo(0, 9);
    expect(half.point.lon).toBeCloseTo(0.01, 6);
    expect([0, 1]).toContain(half.index);

    const threeQuarter = pointAlong(EQUATOR, cum, total * 0.75);
    expect(threeQuarter.index).toBe(1);
    expect(threeQuarter.point.lon).toBeCloseTo(0.015, 6);
  });

  it('einde en voorbij het einde', () => {
    const end = pointAlong(EQUATOR, cum, total);
    expect(end.point).toEqual(EQUATOR[2]);
    expect(end.index).toBe(1);
    const beyond = pointAlong(EQUATOR, cum, total + 100);
    expect(beyond.point).toEqual(EQUATOR[2]);
    expect(beyond.index).toBe(1);
    expect(beyond.bearing).toBeCloseTo(90, 6);
  });

  it('één punt en lege lijn', () => {
    expect(pointAlong([UTRECHT], [0], 3).point).toEqual(UTRECHT);
    expect(() => pointAlong([], [], 0)).toThrow();
  });
});

describe('seededRandom', () => {
  it('is deterministisch per seed', () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).toEqual(seqB);
    const c = seededRandom(43);
    expect(Array.from({ length: 10 }, () => c())).not.toEqual(seqA);
  });

  it('geeft waarden in [0, 1)', () => {
    const rnd = seededRandom(7);
    for (let i = 0; i < 1000; i++) {
      const v = rnd();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('angleDiff', () => {
  it('kleinste getekende verschil', () => {
    expect(angleDiff(350, 10)).toBe(20);
    expect(angleDiff(10, 350)).toBe(-20);
    expect(angleDiff(90, 90)).toBe(0);
    expect(angleDiff(0, 180)).toBe(180);
    expect(angleDiff(180, 0)).toBe(180);
    expect(angleDiff(0, 270)).toBe(-90);
  });
});

describe('normalizeLon', () => {
  it('brengt lengtegraden terug naar [-180, 180)', () => {
    expect(normalizeLon(190)).toBe(-170);
    expect(normalizeLon(-190)).toBe(170);
    expect(normalizeLon(5)).toBe(5);
    expect(normalizeLon(365)).toBe(5);
    expect(normalizeLon(-180)).toBe(-180);
  });
});

describe('overige helpers', () => {
  it('isValidLatLng', () => {
    expect(isValidLatLng(UTRECHT)).toBe(true);
    expect(isValidLatLng({ lat: 91, lon: 0 })).toBe(false);
    expect(isValidLatLng({ lat: 0, lon: 181 })).toBe(false);
    expect(isValidLatLng({ lat: Number.NaN, lon: 0 })).toBe(false);
    expect(isValidLatLng({ lat: '52', lon: 5 })).toBe(false);
    expect(isValidLatLng(null)).toBe(false);
  });

  it('boundsOf / boundsCenter', () => {
    expect(boundsOf([])).toBeNull();
    const b = boundsOf([UTRECHT, ARNHEM])!;
    expect(b).toEqual({ minLat: ARNHEM.lat, minLon: UTRECHT.lon, maxLat: UTRECHT.lat, maxLon: ARNHEM.lon });
    const c = boundsCenter(b);
    expect(c.lat).toBeCloseTo((UTRECHT.lat + ARNHEM.lat) / 2, 9);
    expect(c.lon).toBeCloseTo((UTRECHT.lon + ARNHEM.lon) / 2, 9);
  });

  it('newId geeft unieke, niet-lege strings', () => {
    const ids = new Set(Array.from({ length: 100 }, () => newId()));
    expect(ids.size).toBe(100);
    for (const id of ids) expect(id.length).toBeGreaterThan(8);
  });
});
