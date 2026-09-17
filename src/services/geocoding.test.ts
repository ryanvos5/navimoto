import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LatLng } from '@/types';
import {
  labelFromNominatim,
  parsePhotonResponse,
  resetNominatimThrottle,
  reverseGeocode,
  searchPlaces,
} from '@/services/geocoding';
import photonFixture from './__fixtures__/photon-search.json';
import nominatimFixture from './__fixtures__/nominatim-reverse.json';

vi.mock('@/lib/format', () => ({
  formatCoords: (p: LatLng) => `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`,
}));

const UTRECHT = { lat: 52.0907, lon: 5.1214 };
const KRUISSTRAAT = { lat: 52.0935, lon: 5.129 };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const fetchMock = vi.fn<typeof fetch>();

function calledUrl(call = 0): URL {
  return new URL(String(fetchMock.mock.calls[call][0]));
}

function photonFeature(properties: Record<string, unknown>, coordinates: [number, number] | unknown = [5.12, 52.09]): unknown {
  return { type: 'Feature', properties, geometry: { type: 'Point', coordinates } };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  resetNominatimThrottle();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('searchPlaces', () => {
  it('geeft [] zonder verzoek bij een te korte zoekterm', async () => {
    expect(await searchPlaces('')).toEqual([]);
    expect(await searchPlaces(' a ')).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('vraagt Photon aan met q, limit en positie, maar zonder lang', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(photonFixture));
    const controller = new AbortController();
    await searchPlaces('  Domplein Utrecht ', UTRECHT, controller.signal);
    const url = calledUrl();
    expect(url.origin + url.pathname).toBe('https://photon.komoot.io/api/');
    expect(url.searchParams.get('q')).toBe('Domplein Utrecht');
    expect(url.searchParams.get('limit')).toBe('6');
    expect(url.searchParams.get('lat')).toBe('52.0907');
    expect(url.searchParams.get('lon')).toBe('5.1214');
    expect(url.searchParams.has('lang')).toBe(false);
    expect(fetchMock.mock.calls[0][1]?.signal).toBe(controller.signal);
  });

  it('laat lat/lon weg zonder (geldige) positie', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(photonFixture));
    await searchPlaces('Arnhem');
    expect(calledUrl(0).searchParams.has('lat')).toBe(false);
    await searchPlaces('Arnhem', null);
    expect(calledUrl(1).searchParams.has('lon')).toBe(false);
    await searchPlaces('Arnhem', { lat: 100, lon: 5 });
    expect(calledUrl(2).searchParams.has('lat')).toBe(false);
  });

  it('zet Photon-features om naar zoekresultaten', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(photonFixture));
    const results = await searchPlaces('Domplein Utrecht', UTRECHT);
    expect(results).toHaveLength(6);
    expect(results[0]).toEqual({
      id: 'W7010307',
      name: 'Domplein',
      description: '3512 JC, Utrecht, Nederland',
      position: { lat: 52.0910551, lon: 5.1219044 },
      type: 'residential',
    });
    expect(results[3]).toEqual({
      id: 'R18941234',
      name: 'Domplein, Neude, Janskerkhof',
      description: 'Utrecht, Nederland',
      position: { lat: 52.0917723, lon: 5.1215765 },
      type: 'neighbourhood',
    });
    expect(results[4]).toEqual({
      id: 'N874056502',
      name: 'Hogeschool voor de Kunsten Utrecht',
      description: 'Janskerkhof 4A, 3512 BK, Utrecht, Nederland',
      position: { lat: 52.0928174, lon: 5.1211367 },
      type: 'university',
    });
    expect(new Set(results.map((r) => r.id)).size).toBe(6);
  });

  it('valt terug op straat + huisnummer, plaats of "Onbekend" als naam', () => {
    const results = parsePhotonResponse({
      features: [
        photonFeature({ street: 'Janskerkhof', housenumber: '4A', city: 'Utrecht', postcode: '3512 BK', country: 'Nederland' }),
        photonFeature({ osm_type: 'N', osm_id: 12, town: 'Zeist', state: 'Utrecht', type: 'city' }),
        photonFeature({ osm_type: 'N', osm_id: 'abc', osm_value: 'peak' }),
        photonFeature({ name: 'Ergens' }, [200, 52]),
        photonFeature({ name: 'Nergens' }, 'x'),
        'geen feature',
      ],
    });
    expect(results).toEqual([
      { id: 'x0', name: 'Janskerkhof 4A', description: '3512 BK, Utrecht, Nederland', position: { lat: 52.09, lon: 5.12 }, type: '' },
      { id: 'N12', name: 'Zeist', description: 'Utrecht', position: { lat: 52.09, lon: 5.12 }, type: 'city' },
      { id: 'Nabc', name: 'Onbekend', description: '', position: { lat: 52.09, lon: 5.12 }, type: 'peak' },
    ]);
    expect(parsePhotonResponse(null)).toEqual([]);
    expect(parsePhotonResponse({ features: 'nee' })).toEqual([]);
  });

  it('gooit een Nederlandse fout bij netwerk-, server- of parseerfouten', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(searchPlaces('Utrecht')).rejects.toThrow('Zoeken mislukt.');
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'bad' }, 400));
    await expect(searchPlaces('Utrecht')).rejects.toThrow('Zoeken mislukt.');
    fetchMock.mockResolvedValueOnce(new Response('<html>', { status: 200 }));
    await expect(searchPlaces('Utrecht')).rejects.toThrow('Zoeken mislukt.');
  });

  it('geeft een afgebroken verzoek door als AbortError', async () => {
    fetchMock.mockRejectedValueOnce(new DOMException('afgebroken', 'AbortError'));
    await expect(searchPlaces('Utrecht')).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('reverseGeocode', () => {
  it('vraagt Nominatim aan en geeft "straat, plaats"', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(nominatimFixture));
    const controller = new AbortController();
    const label = await reverseGeocode(KRUISSTRAAT, controller.signal);
    expect(label).toBe('Kruisstraat, Utrecht');
    const url = calledUrl();
    expect(url.origin + url.pathname).toBe('https://nominatim.openstreetmap.org/reverse');
    expect(url.searchParams.get('lat')).toBe('52.0935');
    expect(url.searchParams.get('lon')).toBe('5.129');
    expect(url.searchParams.get('format')).toBe('jsonv2');
    expect(url.searchParams.get('accept-language')).toBe('nl');
    expect(url.searchParams.get('zoom')).toBe('16');
    const init = fetchMock.mock.calls[0][1];
    expect(init?.headers).toEqual({ 'Accept-Language': 'nl' });
    expect(init?.signal).toBe(controller.signal);
  });

  it('gebruikt alternatieve weg- en plaatsvelden en anders display_name', () => {
    expect(labelFromNominatim({ address: { pedestrian: 'Oudegracht', village: 'Vreeswijk', country: 'Nederland' } })).toBe(
      'Oudegracht, Vreeswijk',
    );
    expect(labelFromNominatim({ address: { cycleway: 'Fietspad', municipality: 'Utrechtse Heuvelrug' } })).toBe(
      'Fietspad, Utrechtse Heuvelrug',
    );
    expect(labelFromNominatim({ address: { town: 'Zeist' } })).toBe('Zeist');
    expect(labelFromNominatim({ address: { country: 'Nederland' }, display_name: 'Bosje, Heuvelrug, Utrecht, Nederland' })).toBe(
      'Bosje, Heuvelrug',
    );
    expect(labelFromNominatim({ error: 'Unable to geocode' })).toBe('');
    expect(labelFromNominatim(null)).toBe('');
  });

  it('valt bij fouten of lege antwoorden terug op coördinaten en gooit nooit', async () => {
    const fallback = '52.09070, 5.12140';
    // Throttle tussendoor terugzetten, anders wacht elke aanroep 1,1 s (echte timers).
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await reverseGeocode(UTRECHT)).toBe(fallback);
    resetNominatimThrottle();
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'Unable to geocode' }));
    expect(await reverseGeocode(UTRECHT)).toBe(fallback);
    resetNominatimThrottle();
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 429));
    expect(await reverseGeocode(UTRECHT)).toBe(fallback);
    resetNominatimThrottle();
    fetchMock.mockResolvedValueOnce(new Response('<html>', { status: 200 }));
    expect(await reverseGeocode(UTRECHT)).toBe(fallback);
    expect(await reverseGeocode({ lat: 200, lon: 5 })).toBe('200.00000, 5.00000');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('houdt minimaal 1100 ms tussen verzoeken en verwerkt ze in volgorde', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => jsonResponse(nominatimFixture));
    const first = reverseGeocode(KRUISSTRAAT);
    const second = reverseGeocode(UTRECHT);
    const third = reverseGeocode(KRUISSTRAAT);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await first).toBe('Kruisstraat, Utrecht');
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(150);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(calledUrl(1).searchParams.get('lat')).toBe('52.0907');
    expect(await second).toBe('Kruisstraat, Utrecht');
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(150);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(await third).toBe('Kruisstraat, Utrecht');
  });

  it('slaat een wachtend verzoek over als het signaal intussen is afgebroken', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => jsonResponse(nominatimFixture));
    const controller = new AbortController();
    const first = reverseGeocode(KRUISSTRAAT);
    const second = reverseGeocode(UTRECHT, controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    expect(await first).toBe('Kruisstraat, Utrecht');
    await vi.advanceTimersByTimeAsync(1200);
    expect(await second).toBe('52.09070, 5.12140');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
