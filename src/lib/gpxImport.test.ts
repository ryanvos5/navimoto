// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { GpxError, parseGpx, type ParsedGpx } from '@/lib/gpx';
import { pathLengthKm } from '@/lib/geo';
import type { LatLng } from '@/types';
import {
  baseName,
  dedupeConsecutive,
  downsampleEven,
  FALLBACK_ROUTE_NAME,
  gpxToNewRoute,
  MAX_IMPORT_POINTS,
  SIMPLIFY_ABOVE_POINTS,
} from '@/lib/gpxImport';

// parseGpx blijft echt, maar kan per test een groot spoor teruggeven zonder duizenden <trkpt>'s door jsdom te jagen
// (het parsen zelf is al getest in gpx.test.ts; hier gaat het om de drempels van gpxToNewRoute).
vi.mock('@/lib/gpx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/gpx')>();
  return { ...actual, parseGpx: vi.fn(actual.parseGpx) };
});

function fakeTrack(points: LatLng[]): ParsedGpx {
  return { name: null, kind: 'track', points, trackPoints: points.map((p) => ({ ...p, t: 0 })), waypoints: [], hasTimes: false };
}

const HEADER = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Test" xmlns="http://www.topografix.com/GPX/1/1">';

const TRACK_WITH_TIMES = `${HEADER}
  <metadata><name>  Rondje Heuvelrug  </name></metadata>
  <wpt lat="52.2" lon="5.3"><name>Koffie</name></wpt>
  <trk><name>Spoornaam</name><trkseg>
    <trkpt lat="52.0907" lon="5.1214"><time>2026-09-17T10:00:00Z</time></trkpt>
    <trkpt lat="52.0950" lon="5.1300"><time>2026-09-17T10:01:00Z</time></trkpt>
    <trkpt lat="52.1000" lon="5.1400"><time>2026-09-17T10:05:30Z</time></trkpt>
  </trkseg></trk>
</gpx>`;

const ROUTE_WITH_VIAS = `${HEADER}
  <rte><name>Via-route</name>
    <rtept lat="52.0" lon="5.0"><name>Start</name></rtept>
    <rtept lat="52.05" lon="5.05"></rtept>
    <rtept lat="52.1" lon="5.1"><name>Koffie</name></rtept>
    <rtept lat="52.15" lon="5.15"></rtept>
    <rtept lat="52.2" lon="5.2"><name>Einde</name></rtept>
  </rte>
</gpx>`;

/** Onze eigen export: <rte> met benoemde via's naast een <trk> met de geometrie. */
const TRACK_WITH_RTE = `${HEADER}
  <rte>
    <rtept lat="52.0" lon="5.0"><name>Start</name></rtept>
    <rtept lat="52.1" lon="5.1"><name>Via</name></rtept>
    <rtept lat="52.2" lon="5.2"><name>Einde</name></rtept>
  </rte>
  <trk><trkseg>
    <trkpt lat="52.0" lon="5.0"/><trkpt lat="52.1" lon="5.1"/><trkpt lat="52.2" lon="5.2"/>
  </trkseg></trk>
</gpx>`;

const NAMELESS_TRACK = `${HEADER}
  <trk><trkseg><trkpt lat="52.0" lon="5.0"/><trkpt lat="52.1" lon="5.1"/></trkseg></trk>
</gpx>`;

const WAYPOINTS_ONLY = `${HEADER}
  <wpt lat="52.0" lon="5.0"><name>A</name></wpt>
  <wpt lat="52.5" lon="5.5"><name>B</name></wpt>
</gpx>`;

describe('gpxToNewRoute: spoor', () => {
  const text = TRACK_WITH_TIMES;
  const route = gpxToNewRoute(text, 'anders.gpx');

  it('maakt een gpx-route met de metadata-naam (getrimd) en de oorspronkelijke tekst', () => {
    expect(route.kind).toBe('gpx');
    expect(route.name).toBe('Rondje Heuvelrug');
    expect(route.gpx).toBe(text);
    expect(route.style).toBeNull();
    expect(route.avoid).toBeNull();
    expect(route.maneuvers).toBeNull();
    expect('id' in route).toBe(false);
  });

  it('neemt de lijnpunten over en berekent de afstand', () => {
    expect(route.geometry).toEqual([
      { lat: 52.0907, lon: 5.1214 },
      { lat: 52.095, lon: 5.13 },
      { lat: 52.1, lon: 5.14 },
    ]);
    expect(route.distanceKm).toBeCloseTo(pathLengthKm(route.geometry), 10);
    expect(route.distanceKm).toBeGreaterThan(1);
    expect(route.distanceKm).toBeLessThan(2);
  });

  it('gebruikt begin en eind als waypoints (losse <wpt> niet) en de tijdspanne als duur', () => {
    expect(route.waypoints).toEqual([
      { lat: 52.0907, lon: 5.1214 },
      { lat: 52.1, lon: 5.14 },
    ]);
    expect(route.durationS).toBe(330);
  });
});

describe('gpxToNewRoute: route met via-punten', () => {
  it('neemt benoemde rtepts over als via-punten, met de namen van begin en eind', () => {
    const route = gpxToNewRoute(ROUTE_WITH_VIAS, 'x.gpx');
    expect(route.name).toBe('Via-route');
    expect(route.geometry).toHaveLength(5);
    expect(route.waypoints).toEqual([
      { lat: 52.0, lon: 5.0, name: 'Start' },
      { lat: 52.1, lon: 5.1, name: 'Koffie' },
      { lat: 52.2, lon: 5.2, name: 'Einde' },
    ]);
    expect(route.durationS).toBeNull();
  });

  it('neemt geen via-punten over bij een spoor met een <rte> ernaast', () => {
    const route = gpxToNewRoute(TRACK_WITH_RTE, 'x.gpx');
    expect(route.waypoints).toEqual([
      { lat: 52.0, lon: 5.0 },
      { lat: 52.2, lon: 5.2 },
    ]);
  });

  it('laat via-punten weg bij meer dan tien benoemde rtepts', () => {
    const pts = Array.from({ length: 12 }, (_, i) => `<rtept lat="${52 + i * 0.01}" lon="5.0"><name>P${i}</name></rtept>`).join('');
    const route = gpxToNewRoute(`${HEADER}<rte>${pts}</rte></gpx>`, 'x.gpx');
    expect(route.waypoints).toEqual([
      { lat: 52, lon: 5 },
      { lat: 52.11, lon: 5 },
    ]);
  });
});

describe('gpxToNewRoute: naam', () => {
  it('valt terug op de bestandsnaam zonder map en extensie', () => {
    expect(gpxToNewRoute(NAMELESS_TRACK, 'C:\\ritten\\Veluwe-rit.GPX').name).toBe('Veluwe-rit');
    expect(gpxToNewRoute(NAMELESS_TRACK, '/tmp/rondje.gpx').name).toBe('rondje');
  });

  it('valt terug op een standaardnaam als ook de bestandsnaam niets oplevert', () => {
    expect(gpxToNewRoute(NAMELESS_TRACK, '.gpx').name).toBe(FALLBACK_ROUTE_NAME);
    expect(gpxToNewRoute(NAMELESS_TRACK, '').name).toBe(FALLBACK_ROUTE_NAME);
  });
});

describe('gpxToNewRoute: fouten', () => {
  it('gooit GpxError bij ongeldige invoer', () => {
    expect(() => gpxToNewRoute('geen xml', 'x.gpx')).toThrow(GpxError);
    expect(() => gpxToNewRoute('<html><body/></html>', 'x.gpx')).toThrow(GpxError);
  });

  it('gooit GpxError bij een bestand met alleen waypoints', () => {
    expect(() => gpxToNewRoute(WAYPOINTS_ONLY, 'x.gpx')).toThrow(GpxError);
    expect(() => gpxToNewRoute(WAYPOINTS_ONLY, 'x.gpx')).toThrow(/waypoints/);
  });
});

describe('gpxToNewRoute: grote sporen (parseGpx gemockt)', () => {
  const zigzag = (n: number): LatLng[] => Array.from({ length: n }, (_, i) => ({ lat: 52 + (i % 2) * 0.0002, lon: 5 + i * 0.0001 }));

  it('laat een spoor van precies 5000 punten ongemoeid', () => {
    const points = zigzag(SIMPLIFY_ABOVE_POINTS);
    vi.mocked(parseGpx).mockReturnValueOnce(fakeTrack(points));
    const route = gpxToNewRoute('<gpx/>', 'x.gpx');
    expect(route.geometry).toHaveLength(SIMPLIFY_ABOVE_POINTS);
    expect(route.gpx).toBe('<gpx/>');
  });

  it('vereenvoudigt boven 5000 punten (collineair spoor → 2 punten)', () => {
    const points = Array.from({ length: SIMPLIFY_ABOVE_POINTS + 1 }, (_, i) => ({ lat: 52, lon: 5 + i * 0.0001 }));
    vi.mocked(parseGpx).mockReturnValueOnce(fakeTrack(points));
    const route = gpxToNewRoute('<gpx/>', 'x.gpx');
    expect(route.geometry).toHaveLength(2);
    expect(route.geometry[0]).toEqual({ lat: 52, lon: 5 });
    expect(route.geometry[1]).toEqual({ lat: 52, lon: 5.5 });
    expect(route.waypoints).toEqual([
      { lat: 52, lon: 5 },
      { lat: 52, lon: 5.5 },
    ]);
    expect(route.distanceKm).toBeCloseTo(pathLengthKm(route.geometry), 10);
  });

  it('dunt uit tot 8000 punten als vereenvoudigen niet genoeg helpt (zigzag van 22 m)', () => {
    const points = zigzag(9000);
    vi.mocked(parseGpx).mockReturnValueOnce(fakeTrack(points));
    const route = gpxToNewRoute('<gpx/>', 'x.gpx');
    expect(route.geometry).toHaveLength(MAX_IMPORT_POINTS);
    expect(route.geometry[0]).toEqual(points[0]);
    expect(route.geometry[MAX_IMPORT_POINTS - 1]).toEqual(points[8999]);
    expect(route.waypoints).toEqual([points[0], points[8999]]);
  });
});

describe('hulpfuncties', () => {
  it('baseName', () => {
    expect(baseName('rit.gpx')).toBe('rit');
    expect(baseName('mijn.mooie.rit.gpx')).toBe('mijn.mooie.rit');
    expect(baseName('  rit  ')).toBe('rit');
    expect(baseName('.gpx')).toBe('');
  });

  it('downsampleEven behoudt begin en eind en is strikt oplopend', () => {
    const src = Array.from({ length: 1000 }, (_, i) => i);
    const out = downsampleEven(src, 100);
    expect(out).toHaveLength(100);
    expect(out[0]).toBe(0);
    expect(out[99]).toBe(999);
    for (let i = 1; i < out.length; i++) expect(out[i]).toBeGreaterThan(out[i - 1]);
    expect(downsampleEven([1, 2, 3], 10)).toEqual([1, 2, 3]);
  });

  it('dedupeConsecutive voegt gelijke buren samen en behoudt de naam', () => {
    expect(
      dedupeConsecutive([
        { lat: 1, lon: 1 },
        { lat: 1, lon: 1, name: 'A' },
        { lat: 2, lon: 2, name: 'B' },
        { lat: 2, lon: 2 },
        { lat: 1, lon: 1 },
      ]),
    ).toEqual([
      { lat: 1, lon: 1, name: 'A' },
      { lat: 2, lon: 2, name: 'B' },
      { lat: 1, lon: 1 },
    ]);
  });
});
