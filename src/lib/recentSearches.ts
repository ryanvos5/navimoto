// Recent gekozen zoekresultaten (max. 3, nieuwste eerst) in localStorage.
// Alle opslagfouten (privémodus, quota, corrupte JSON) worden stil opgevangen.
import type { LatLng } from '@/types';
import type { GeoSearchResult } from '@/services/geocoding';

export const RECENT_SEARCHES_KEY = 'navimoto.recentSearches';
export const MAX_RECENT_SEARCHES = 3;

/** Twee posities gelden als gelijk als ze binnen ~1e-6 graden (≈ 0,1 m) van elkaar liggen. */
const POSITION_EPSILON = 1e-6;

function samePosition(a: LatLng, b: LatLng): boolean {
  return Math.abs(a.lat - b.lat) <= POSITION_EPSILON && Math.abs(a.lon - b.lon) <= POSITION_EPSILON;
}

function isSameSearch(a: GeoSearchResult, b: GeoSearchResult): boolean {
  return a.id === b.id || samePosition(a.position, b.position);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function parseResult(raw: unknown): GeoSearchResult | null {
  if (raw === null || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const pos = r.position;
  if (pos === null || typeof pos !== 'object') return null;
  const { lat, lon } = pos as Record<string, unknown>;
  if (typeof r.id !== 'string' || r.id === '') return null;
  if (typeof r.name !== 'string' || r.name === '') return null;
  if (!isFiniteNumber(lat) || !isFiniteNumber(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return {
    id: r.id,
    name: r.name,
    description: typeof r.description === 'string' ? r.description : '',
    position: { lat, lon },
    type: typeof r.type === 'string' ? r.type : '',
  };
}

function getStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function persist(items: GeoSearchResult[]): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    if (items.length === 0) storage.removeItem(RECENT_SEARCHES_KEY);
    else storage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(items));
  } catch {
    // Quota vol of privémodus: recente zoekopdrachten zijn niet essentieel.
  }
}

/** Leest de recente zoekopdrachten (nieuwste eerst). Ongeldige of corrupte items worden weggelaten. */
export function loadRecentSearches(): GeoSearchResult[] {
  const storage = getStorage();
  if (!storage) return [];
  let raw: string | null;
  try {
    raw = storage.getItem(RECENT_SEARCHES_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: GeoSearchResult[] = [];
  for (const item of parsed) {
    const r = parseResult(item);
    if (!r) continue;
    if (out.some((existing) => isSameSearch(existing, r))) continue;
    out.push(r);
    if (out.length >= MAX_RECENT_SEARCHES) break;
  }
  return out;
}

/** Zet `result` vooraan in de lijst (dubbelen op id of positie verdwijnen), bewaart en geeft de nieuwe lijst terug. */
export function rememberSearch(result: GeoSearchResult): GeoSearchResult[] {
  const entry = parseResult(result);
  if (!entry) return loadRecentSearches();
  const rest = loadRecentSearches().filter((r) => !isSameSearch(r, entry));
  const next = [entry, ...rest].slice(0, MAX_RECENT_SEARCHES);
  persist(next);
  return next;
}

/** Maakt de lijst leeg. */
export function clearRecentSearches(): void {
  persist([]);
}
