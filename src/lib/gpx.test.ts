// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { GpxError, gpxFileName, parseGpx, routeToGpx, trackToGpx } from '@/lib/gpx';
import type { RiddenTrack, SavedRoute } from '@/types';

const TRACK_11 = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Test" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>Rondje Utrechtse Heuvelrug</name>
    <author><name>Niet deze naam</name></author>
  </metadata>
  <wpt lat="52.1" lon="5.2"><name>Koffiestop</name></wpt>
  <wpt lat="52.2" lon="5.3"></wpt>
  <trk>
    <name>Spoornaam</name>
    <trkseg>
      <trkpt lat="52.0907" lon="5.1214"><ele>3.5</ele><time>2026-09-17T10:00:00Z</time></trkpt>
      <trkpt lat="52.0950" lon="5.1300"><ele>4.0</ele><time>2026-09-17T10:01:00Z</time></trkpt>
    </trkseg>
    <trkseg>
      <trkpt lat="52.1000" lon="5.1400"><time>2026-09-17T10:02:00+00:00</time></trkpt>
      <trkpt lat="abc" lon="5.1500"><time>2026-09-17T10:03:00Z</time></trkpt>
      <trkpt lat="52.1100" lon="181"><time>2026-09-17T10:03:30Z</time></trkpt>
      <trkpt lat="52.1200"><time>2026-09-17T10:04:00Z</time></trkpt>
      <trkpt lat="52.1300" lon="5.1700"><time>2026-09-17T10:05:00Z</time></trkpt>
    </trkseg>
  </trk>
</gpx>`;

const ROUTE_10_PREFIXED = `<?xml version="1.0"?>
<g:gpx version="1.0" creator="Oud programma" xmlns:g="http://www.topografix.com/GPX/1/0">
  <g:name>Oude route</g:name>
  <g:rte>
    <g:name>Routenaam</g:name>
    <g:rtept lat="52.0" lon="5.0"><g:name>Start</g:name></g:rtept>
    <g:rtept lat="52.1" lon="5.1"></g:rtept>
    <g:rtept lat="52.2" lon="5.2"><g:ele>12</g:ele><g:name>Einde</g:name></g:rtept>
  </g:rte>
</g:gpx>`;

const WAYPOINTS_ONLY = `<gpx version="1.1" creator="x">
  <wpt lat="52.0" lon="5.0"><name>A</name></wpt>
  <wpt lat="52.5" lon="5.5"><name>B</name></wpt>
</gpx>`;

const NO_NAMESPACE_TRACK = `<gpx version="1.1" creator="x">
  <trk><trkseg>
    <trkpt lat="1" lon="1"/>
    <trkpt lat="1.1" lon="1.1"/>
  </trkseg></trk>
</gpx>`;

describe('parseGpx: track', () => {
  const parsed = parseGpx(TRACK_11);

  it('herkent een spoor en plakt alle segmenten aaneen (ongeldige punten overgeslagen)', () => {
    expect(parsed.kind).toBe('track');
    expect(parsed.points).toEqual([
      { lat: 52.0907, lon: 5.1214 },
      { lat: 52.095, lon: 5.13 },
      { lat: 52.1, lon: 5.14 },
      { lat: 52.13, lon: 5.17 },
    ]);
  });

  it('neemt de naam uit metadata (niet uit author)', () => {
    expect(parsed.name).toBe('Rondje Utrechtse Heuvelrug');
  });

  it('zet <time> om naar epoch ms en neemt <ele> mee', () => {
    expect(parsed.hasTimes).toBe(true);
    expect(parsed.trackPoints[0]).toEqual({ lat: 52.0907, lon: 5.1214, t: Date.UTC(2026, 8, 17, 10, 0, 0), ele: 3.5 });
    expect(parsed.trackPoints[2]).toEqual({ lat: 52.1, lon: 5.14, t: Date.UTC(2026, 8, 17, 10, 2, 0) });
    expect(parsed.trackPoints[2]).not.toHaveProperty('ele');
    expect(parsed.trackPoints[3].t).toBe(Date.UTC(2026, 8, 17, 10, 5, 0));
  });

  it('neemt alle <wpt> mee als waypoints, met naam als die er is', () => {
    expect(parsed.waypoints).toEqual([{ lat: 52.1, lon: 5.2, name: 'Koffiestop' }, { lat: 52.2, lon: 5.3 }]);
  });

  it('hasTimes is false als een lijnpunt geen <time> heeft, en t wordt dan 0', () => {
    const p = parseGpx(NO_NAMESPACE_TRACK);
    expect(p.kind).toBe('track');
    expect(p.hasTimes).toBe(false);
    expect(p.trackPoints.map((tp) => tp.t)).toEqual([0, 0]);
    expect(p.name).toBeNull();
  });

  it('valt terug op de naam van het spoor als er geen metadata-naam is', () => {
    const p = parseGpx(`<gpx version="1.1" creator="x"><metadata><name>  </name></metadata>
      <trk><name>Alleen hier</name><trkseg><trkpt lat="1" lon="1"/><trkpt lat="2" lon="2"/></trkseg></trk></gpx>`);
    expect(p.name).toBe('Alleen hier');
  });

  it('accepteert een UTF-8 BOM en witruimte vooraf', () => {
    const p = parseGpx('﻿  ' + TRACK_11);
    expect(p.points).toHaveLength(4);
  });
});

describe('parseGpx: route (GPX 1.0 met namespace-prefix)', () => {
  const parsed = parseGpx(ROUTE_10_PREFIXED);

  it('herkent de route en de punten', () => {
    expect(parsed.kind).toBe('route');
    expect(parsed.points).toEqual([
      { lat: 52.0, lon: 5.0 },
      { lat: 52.1, lon: 5.1 },
      { lat: 52.2, lon: 5.2 },
    ]);
    expect(parsed.hasTimes).toBe(false);
    expect(parsed.trackPoints[2]).toEqual({ lat: 52.2, lon: 5.2, t: 0, ele: 12 });
  });

  it('gebruikt de naam op gpx-niveau (GPX 1.0)', () => {
    expect(parsed.name).toBe('Oude route');
  });

  it('neemt alleen de rtept met naam op als waypoint', () => {
    expect(parsed.waypoints).toEqual([
      { lat: 52.0, lon: 5.0, name: 'Start' },
      { lat: 52.2, lon: 5.2, name: 'Einde' },
    ]);
  });
});

describe('parseGpx: waypoints en fouten', () => {
  it('herkent een bestand met alleen waypoints', () => {
    const p = parseGpx(WAYPOINTS_ONLY);
    expect(p.kind).toBe('waypoints');
    expect(p.points).toEqual([]);
    expect(p.trackPoints).toEqual([]);
    expect(p.hasTimes).toBe(false);
    expect(p.waypoints.map((w) => w.name)).toEqual(['A', 'B']);
  });

  it('gooit GpxError met Nederlandse melding bij niet-XML', () => {
    expect(() => parseGpx('dit is geen xml')).toThrow(GpxError);
    expect(() => parseGpx('dit is geen xml')).toThrow('Dit is geen geldig GPX-bestand.');
    expect(() => parseGpx('')).toThrow(GpxError);
    expect(() => parseGpx('{"json": true}')).toThrow(GpxError);
  });

  it('gooit GpxError bij kapotte XML en bij een andere root dan <gpx>', () => {
    expect(() => parseGpx('<gpx version="1.1"><trk><trkseg><trkpt lat="1" lon="1"></trkseg></trk></gpx>')).toThrow(
      GpxError,
    );
    expect(() => parseGpx('<kml xmlns="http://www.opengis.net/kml/2.2"><Document/></kml>')).toThrow(
      'Dit is geen geldig GPX-bestand.',
    );
  });

  it('gooit GpxError als er minder dan 2 lijnpunten en geen waypoints zijn', () => {
    expect(() => parseGpx('<gpx version="1.1" creator="x"></gpx>')).toThrow(GpxError);
    expect(() =>
      parseGpx('<gpx version="1.1" creator="x"><trk><trkseg><trkpt lat="1" lon="1"/></trkseg></trk></gpx>'),
    ).toThrow(GpxError);
    expect(() =>
      parseGpx('<gpx version="1.1" creator="x"><trk><trkseg><trkpt lat="x" lon="1"/><trkpt lat="1" lon="y"/></trkseg></trk></gpx>'),
    ).toThrow(/GPX-bestand/);
  });

  it('GpxError is een Error met de juiste naam', () => {
    const err = new GpxError('test');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(GpxError);
    expect(err.name).toBe('GpxError');
    expect(err.message).toBe('test');
  });
});

describe('trackToGpx', () => {
  const track: RiddenTrack = {
    id: 't1',
    userId: 'u1',
    name: 'Avondrit <Vecht> & "Loosdrecht"',
    startedAt: Date.UTC(2026, 8, 17, 18, 0, 0),
    endedAt: Date.UTC(2026, 8, 17, 19, 0, 0),
    points: [
      { lat: 52.0907, lon: 5.1214, t: Date.UTC(2026, 8, 17, 18, 0, 0), ele: 2.5 },
      { lat: 52.0950123456789, lon: 5.1300987654321, t: Date.UTC(2026, 8, 17, 18, 0, 30), speedKmh: 50 },
      { lat: 52.1, lon: 5.14, t: Date.UTC(2026, 8, 17, 18, 1, 0), ele: -1.25, headingDeg: 45 },
    ],
    distanceKm: 1.8,
    durationS: 3600,
    movingS: 3000,
    avgSpeedKmh: 40,
    maxSpeedKmh: 80,
    routeId: null,
  };

  it('schrijft geldige GPX 1.1 met creator Navimoto en geëscapete naam', () => {
    const xml = trackToGpx(track);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('xmlns="http://www.topografix.com/GPX/1/1"');
    expect(xml).toContain('version="1.1"');
    expect(xml).toContain('creator="Navimoto"');
    expect(xml).toContain('<name>Avondrit &lt;Vecht&gt; &amp; &quot;Loosdrecht&quot;</name>');
    expect(xml).not.toContain('<rte>');
    expect(xml).toContain('<ele>2.5</ele>');
    expect(xml).toContain('<ele>-1.25</ele>');
    expect(xml).toContain('<time>2026-09-17T18:00:30.000Z</time>');
    // Maximaal 6 decimalen.
    expect(xml).toContain('lat="52.095012" lon="5.130099"');
    expect(xml).not.toMatch(/\d\.\d{7,}/);
    // Het is welgevormde XML.
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
    expect(doc.documentElement.namespaceURI).toBe('http://www.topografix.com/GPX/1/1');
  });

  it('round-trip: parseGpx(trackToGpx(track)) geeft punten, tijden en hoogtes terug', () => {
    const parsed = parseGpx(trackToGpx(track));
    expect(parsed.kind).toBe('track');
    expect(parsed.name).toBe(track.name);
    expect(parsed.hasTimes).toBe(true);
    expect(parsed.points).toHaveLength(3);
    expect(parsed.trackPoints.map((p) => p.t)).toEqual(track.points.map((p) => p.t));
    expect(parsed.trackPoints[0].ele).toBe(2.5);
    expect(parsed.trackPoints[1].ele).toBeUndefined();
    expect(parsed.trackPoints[2].ele).toBe(-1.25);
    parsed.points.forEach((p, i) => {
      expect(p.lat).toBeCloseTo(track.points[i].lat, 5);
      expect(p.lon).toBeCloseTo(track.points[i].lon, 5);
    });
    expect(parsed.waypoints).toEqual([]);
  });

  it('laat <time> weg als t 0 is (onbekende tijd)', () => {
    const xml = trackToGpx({ ...track, points: [{ lat: 1, lon: 1, t: 0 }, { lat: 2, lon: 2, t: 0 }] });
    expect(xml).not.toContain('<time>1970');
    expect(parseGpx(xml).hasTimes).toBe(false);
  });
});

describe('routeToGpx', () => {
  const route: SavedRoute = {
    id: 'r1',
    userId: 'u1',
    name: "Bochtig naar 's-Hertogenbosch",
    createdAt: Date.UTC(2026, 8, 17, 8, 0, 0),
    updatedAt: Date.UTC(2026, 8, 17, 9, 0, 0),
    kind: 'planned',
    waypoints: [
      { lat: 52.0907, lon: 5.1214, name: 'Utrecht' },
      { lat: 51.95, lon: 5.3 },
      { lat: 51.6978, lon: 5.3037, name: "'s-Hertogenbosch" },
    ],
    style: 'bochtig',
    avoid: null,
    geometry: [
      { lat: 52.0907, lon: 5.1214 },
      { lat: 52.0, lon: 5.2 },
      { lat: 51.95, lon: 5.3 },
      { lat: 51.8, lon: 5.31 },
      { lat: 51.6978, lon: 5.3037 },
    ],
    distanceKm: 55,
    durationS: 4000,
    maneuvers: [],
    gpx: null,
  };

  it('schrijft een <rte> met rtept per waypoint en een <trk> met de geometrie', () => {
    const xml = routeToGpx(route);
    expect(xml).toContain('creator="Navimoto"');
    expect(xml).toContain('<name>Bochtig naar &apos;s-Hertogenbosch</name>');
    expect((xml.match(/<rtept /g) ?? []).length).toBe(3);
    expect((xml.match(/<trkpt /g) ?? []).length).toBe(5);
    expect(xml).toContain('<rtept lat="52.0907" lon="5.1214">');
    expect(xml).toContain('<name>Utrecht</name>');
    expect(xml).toContain('<rtept lat="51.95" lon="5.3"></rtept>');
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
  });

  it('round-trip: parseGpx(routeToGpx(route)) geeft geometrie en benoemde waypoints terug', () => {
    const parsed = parseGpx(routeToGpx(route));
    expect(parsed.name).toBe(route.name);
    expect(parsed.points).toEqual(route.geometry);
    expect(parsed.waypoints).toEqual([
      { lat: 52.0907, lon: 5.1214, name: 'Utrecht' },
      { lat: 51.6978, lon: 5.3037, name: "'s-Hertogenbosch" },
    ]);
  });

  it('gebruikt een standaardnaam bij een lege naam', () => {
    expect(parseGpx(routeToGpx({ ...route, name: '   ' })).name).toBe('Route');
  });
});

describe('gpxFileName', () => {
  it('maakt een veilige bestandsnaam', () => {
    expect(gpxFileName('Mijn rit / test')).toBe('Mijn-rit-test.gpx');
    expect(gpxFileName('  Rondje   Veluwe!!  ')).toBe('Rondje-Veluwe.gpx');
    expect(gpxFileName('snake_case-naam')).toBe('snake_case-naam.gpx');
  });

  it('verwijdert diakrieten en een bestaande .gpx-extensie', () => {
    expect(gpxFileName('Ardèche à moto')).toBe('Ardeche-a-moto.gpx');
    expect(gpxFileName('rit.gpx')).toBe('rit.gpx');
    expect(gpxFileName('rit.GPX')).toBe('rit.gpx');
  });

  it('valt terug op route.gpx bij een lege of onbruikbare naam', () => {
    expect(gpxFileName('')).toBe('route.gpx');
    expect(gpxFileName('   ')).toBe('route.gpx');
    expect(gpxFileName('///')).toBe('route.gpx');
    expect(gpxFileName('日本語')).toBe('route.gpx');
  });

  it('kapt af op 60 tekens voor de extensie', () => {
    const long = 'a'.repeat(100);
    expect(gpxFileName(long)).toBe('a'.repeat(60) + '.gpx');
    const withDash = 'b'.repeat(59) + ' ' + 'c'.repeat(10);
    expect(gpxFileName(withDash)).toBe('b'.repeat(59) + '.gpx');
    expect(gpxFileName(long).length).toBeLessThanOrEqual(64);
  });
});
