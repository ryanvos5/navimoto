// Zoeken (Photon) en reverse geocoding (Nominatim). Contract: zie CLAUDE.md, sectie "src/services/geocoding.ts".
import type { LatLng } from '@/types';
import { isValidLatLng } from '@/lib/geo';
import { formatCoords } from '@/lib/format';

export interface GeoSearchResult {
  id: string;
  name: string;
  description: string;
  position: LatLng;
  type: string;
}

export const PHOTON_URL = 'https://photon.komoot.io/api/';
export const NOMINATIM_REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse';
export const SEARCH_LIMIT = 6;
/** Nominatim staat maximaal 1 verzoek per seconde toe; we houden wat marge. */
export const NOMINATIM_MIN_INTERVAL_MS = 1100;
const SEARCH_ERROR = 'Zoeken mislukt.';
const UNKNOWN_NAME = 'Onbekend';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function str(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function isAbortError(e: unknown): boolean {
  return e !== null && typeof e === 'object' && (e as { name?: unknown }).name === 'AbortError';
}

// ---------------------------------------------------------------------------
// Photon
// ---------------------------------------------------------------------------

function parsePhotonFeature(raw: unknown, index: number): GeoSearchResult | null {
  const feature = asRecord(raw);
  const coords = asRecord(feature?.geometry)?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const position = { lat: coords[1] as unknown, lon: coords[0] as unknown };
  if (!isValidLatLng(position)) return null;

  const p = asRecord(feature?.properties) ?? {};
  const streetLine = [str(p.street), str(p.housenumber)].filter(Boolean).join(' ');
  const place = str(p.city) || str(p.town) || str(p.village) || str(p.locality);
  const name = str(p.name) || streetLine || place || UNKNOWN_NAME;

  const seen = new Set<string>([name]);
  const description: string[] = [];
  for (const part of [streetLine, str(p.postcode), place, str(p.state), str(p.country)]) {
    if (!part || seen.has(part)) continue;
    seen.add(part);
    description.push(part);
  }

  const osmId = p.osm_id;
  const idSuffix = typeof osmId === 'number' || typeof osmId === 'string' ? String(osmId) : String(index);
  return {
    id: (str(p.osm_type) || 'x') + idSuffix,
    name,
    description: description.join(', '),
    position: { lat: position.lat, lon: position.lon },
    type: str(p.osm_value) || str(p.type) || '',
  };
}

export function parsePhotonResponse(json: unknown): GeoSearchResult[] {
  const features = asRecord(json)?.features;
  if (!Array.isArray(features)) return [];
  const out: GeoSearchResult[] = [];
  features.forEach((f, i) => {
    const r = parsePhotonFeature(f, i);
    if (r) out.push(r);
  });
  return out;
}

/**
 * Zoekt plaatsen/adressen via Photon. Een zoekterm korter dan 2 tekens geeft [] zonder verzoek.
 * Gooit Error('Zoeken mislukt.') bij netwerk-/serverfouten; een afgebroken verzoek (AbortError) wordt doorgegeven.
 */
export async function searchPlaces(query: string, near?: LatLng | null, signal?: AbortSignal): Promise<GeoSearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const params = new URLSearchParams({ q, limit: String(SEARCH_LIMIT) });
  if (near && isValidLatLng(near)) {
    params.set('lat', String(near.lat));
    params.set('lon', String(near.lon));
  }
  // Let op: geen `lang`-parameter, Photon ondersteunt nl niet (400).
  let json: unknown;
  try {
    const res = await fetch(`${PHOTON_URL}?${params.toString()}`, { signal });
    if (!res.ok) throw new Error(SEARCH_ERROR);
    json = await res.json();
  } catch (e) {
    if (isAbortError(e)) throw e;
    throw new Error(SEARCH_ERROR);
  }
  return parsePhotonResponse(json);
}

// ---------------------------------------------------------------------------
// Nominatim (reverse)
// ---------------------------------------------------------------------------

let queue: Promise<unknown> = Promise.resolve();
let lastRequestAt = -Infinity;

function abortError(): Error {
  return new DOMException('Verzoek afgebroken.', 'AbortError');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Voert `fn` uit na de vorige aanvraag en minimaal NOMINATIM_MIN_INTERVAL_MS na de start daarvan. */
function throttled<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const run = queue.then(async () => {
    if (signal?.aborted) throw abortError();
    const wait = lastRequestAt + NOMINATIM_MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    if (signal?.aborted) throw abortError();
    lastRequestAt = Date.now();
    return fn();
  });
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Alleen voor tests: wachtrij en timing van de Nominatim-throttle terugzetten. */
export function resetNominatimThrottle(): void {
  queue = Promise.resolve();
  lastRequestAt = -Infinity;
}

const ROAD_KEYS = ['road', 'pedestrian', 'footway', 'path', 'cycleway'] as const;
const PLACE_KEYS = ['city', 'town', 'village', 'municipality', 'hamlet'] as const;

function firstOf(record: Record<string, unknown> | null, keys: ReadonlyArray<string>): string {
  if (!record) return '';
  for (const key of keys) {
    const v = str(record[key]);
    if (v) return v;
  }
  return '';
}

/** "Kruisstraat, Utrecht" uit een Nominatim jsonv2-antwoord, of '' als er niets bruikbaars in zit. */
export function labelFromNominatim(json: unknown): string {
  const root = asRecord(json);
  const address = asRecord(root?.address);
  const label = [firstOf(address, ROAD_KEYS), firstOf(address, PLACE_KEYS)].filter(Boolean).join(', ');
  if (label) return label;
  return str(root?.display_name)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(', ');
}

async function fetchReverse(p: LatLng, signal?: AbortSignal): Promise<string> {
  const params = new URLSearchParams({
    lat: String(p.lat),
    lon: String(p.lon),
    format: 'jsonv2',
    'accept-language': 'nl',
    zoom: '16',
  });
  const res = await fetch(`${NOMINATIM_REVERSE_URL}?${params.toString()}`, {
    headers: { 'Accept-Language': 'nl' },
    signal,
  });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  return labelFromNominatim(await res.json());
}

/**
 * Geeft een korte plaatsaanduiding ("Biltstraat, Utrecht") voor een punt. Gooit nooit: bij fouten,
 * afbreken of een leeg antwoord komt `formatCoords(p)` terug. Verzoeken worden geserialiseerd met
 * minimaal 1,1 s tussenruimte (Nominatim-gebruiksvoorwaarden).
 */
export async function reverseGeocode(p: LatLng, signal?: AbortSignal): Promise<string> {
  let fallback: string;
  try {
    fallback = formatCoords(p);
  } catch {
    fallback = `${String(p?.lat)}, ${String(p?.lon)}`;
  }
  if (!isValidLatLng(p)) return fallback;
  try {
    const label = await throttled(() => fetchReverse(p, signal), signal);
    return label || fallback;
  } catch {
    return fallback;
  }
}
