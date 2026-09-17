// Zoekbalk boven de kaart (Photon): debounce 350 ms, min. 2 tekens, AbortController per verzoek.
// In een 'pick'-modus (start/bestemming/via) vult een keuze het betreffende plannerpunt.
// Bij een leeg invoerveld met focus verschijnen de laatste gekozen resultaten ("Recent gezocht").
import { useEffect, useRef, useState } from 'react';
import { History, Search, X } from 'lucide-react';
import type { LatLng } from '@/types';
import { searchPlaces, type GeoSearchResult } from '@/services/geocoding';
import { clearRecentSearches, loadRecentSearches, rememberSearch } from '@/lib/recentSearches';
import { Spinner } from '@/components/ui/Spinner';

export type SearchMode = 'free' | 'start' | 'destination' | 'via';

/** Nederlands label voor het OSM-type van een zoekresultaat (onderscheidt bijv. stad en provincie Utrecht). */
const PLACE_TYPE_LABELS: Record<string, string> = {
  city: 'Stad',
  town: 'Plaats',
  village: 'Dorp',
  hamlet: 'Buurtschap',
  suburb: 'Wijk',
  neighbourhood: 'Buurt',
  quarter: 'Wijk',
  state: 'Provincie',
  province: 'Provincie',
  region: 'Regio',
  county: 'Regio',
  municipality: 'Gemeente',
  country: 'Land',
  house: 'Adres',
  motorway_junction: 'Afrit',
  fuel: 'Tankstation',
  restaurant: 'Restaurant',
  cafe: 'Café',
  hotel: 'Hotel',
  parking: 'Parkeerplaats',
  viewpoint: 'Uitzichtpunt',
  peak: 'Top',
  ferry_terminal: 'Veerhaven',
  motorcycle: 'Motorzaak',
};
const ROAD_TYPES = new Set([
  'residential', 'primary', 'secondary', 'tertiary', 'unclassified', 'living_street', 'pedestrian',
  'service', 'track', 'path', 'cycleway', 'footway', 'motorway', 'trunk', 'road', 'street',
]);

export function placeTypeLabel(type: string): string {
  if (!type) return '';
  if (PLACE_TYPE_LABELS[type]) return PLACE_TYPE_LABELS[type];
  if (ROAD_TYPES.has(type)) return 'Weg';
  return '';
}

export const SEARCH_MODE_LABELS: Record<Exclude<SearchMode, 'free'>, string> = {
  start: 'Startpunt',
  destination: 'Bestemming',
  via: 'Via-punt',
};

export interface SearchBarProps {
  mode: SearchMode;
  /** Zoeken in de buurt van dit punt (huidige positie of kaartcentrum). */
  near: LatLng | null;
  /** Verhoog om het invoerveld focus te geven. */
  focusToken: number;
  onSelect: (result: GeoSearchResult, mode: SearchMode) => void;
  /** Terug naar vrij zoeken (kruisje op de moduschip). */
  onCancelMode: () => void;
}

const DEBOUNCE_MS = 350;
const MIN_CHARS = 2;

function isAbortError(e: unknown): boolean {
  return e !== null && typeof e === 'object' && (e as { name?: unknown }).name === 'AbortError';
}

export function SearchBar({ mode, near, focusToken, onSelect, onCancelMode }: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeoSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [recents, setRecents] = useState<GeoSearchResult[]>(() => loadRecentSearches());
  const nearRef = useRef(near);
  nearRef.current = near;

  useEffect(() => {
    if (focusToken > 0) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [focusToken]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_CHARS) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);
      searchPlaces(q, nearRef.current, controller.signal)
        .then((r) => {
          if (controller.signal.aborted) return;
          setResults(r);
          setOpen(true);
          setLoading(false);
        })
        .catch((e: unknown) => {
          if (controller.signal.aborted || isAbortError(e)) return;
          setResults([]);
          setError(e instanceof Error ? e.message : 'Zoeken mislukt.');
          setOpen(true);
          setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const clear = (): void => {
    setQuery('');
    setResults([]);
    setError(null);
    setOpen(false);
    inputRef.current?.focus();
  };

  const select = (r: GeoSearchResult): void => {
    setOpen(false);
    setResults([]);
    setQuery(mode === 'free' ? r.name : '');
    inputRef.current?.blur();
    setRecents(rememberSearch(r));
    onSelect(r, mode);
  };

  const clearRecents = (): void => {
    clearRecentSearches();
    setRecents([]);
  };

  const showList = open && query.trim().length >= MIN_CHARS && (results.length > 0 || error !== null || !loading);
  const showRecents = open && query.trim().length < MIN_CHARS && recents.length > 0;
  const placeholder = mode === 'free' ? 'Zoek een plaats of adres' : `${SEARCH_MODE_LABELS[mode]} zoeken…`;

  return (
    <div className="relative">
      <div className="flex h-12 items-center gap-2 rounded-2xl border border-line bg-surface-2/95 px-3 shadow-lg backdrop-blur focus-within:border-brand">
        {mode !== 'free' ? (
          <button
            type="button"
            onClick={onCancelMode}
            className="flex h-8 shrink-0 items-center gap-1 rounded-full bg-brand px-2.5 text-xs font-semibold text-white"
            aria-label={`${SEARCH_MODE_LABELS[mode]} zoeken annuleren`}
          >
            {SEARCH_MODE_LABELS[mode]}
            <X size={14} aria-hidden />
          </button>
        ) : (
          <Search size={20} className="shrink-0 text-muted" aria-hidden />
        )}
        <input
          ref={inputRef}
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          value={query}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            setRecents(loadRecentSearches());
            setOpen(true);
          }}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setOpen(false);
              inputRef.current?.blur();
            } else if (e.key === 'Enter' && results.length > 0) {
              select(results[0]);
            }
          }}
          className="h-full min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-muted/70 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
        />
        {loading ? (
          <Spinner size="sm" />
        ) : (
          query.length > 0 && (
            <button type="button" onClick={clear} aria-label="Zoekopdracht wissen" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-3 hover:text-ink">
              <X size={18} aria-hidden />
            </button>
          )
        )}
      </div>

      {showRecents && (
        <div
          // Voorkomt blur van het invoerveld vóór de klik geregistreerd is.
          onPointerDown={(e) => e.preventDefault()}
          className="absolute inset-x-0 top-full z-10 mt-2 max-h-72 overflow-y-auto rounded-2xl border border-line bg-surface-2 shadow-xl"
        >
          <div className="flex min-h-11 items-center justify-between border-b border-line px-4 py-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">Recent gezocht</span>
            <button
              type="button"
              onClick={clearRecents}
              className="-mr-2 flex h-9 items-center rounded-full px-2 text-sm font-medium text-muted hover:bg-surface-3 hover:text-ink"
              aria-label="Recente zoekopdrachten wissen"
            >
              Wissen
            </button>
          </div>
          <div role="listbox" aria-label="Recente zoekopdrachten">
            {recents.map((r) => (
              <button
                key={r.id}
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => select(r)}
                className="flex min-h-12 w-full items-center gap-3 border-b border-line px-4 py-2 text-left last:border-b-0 hover:bg-surface-3"
              >
                <History size={18} className="shrink-0 text-muted" aria-hidden />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex w-full min-w-0 items-center gap-2">
                    <span className="truncate font-medium">{r.name}</span>
                    {placeTypeLabel(r.type) && (
                      <span className="shrink-0 rounded-full bg-surface-4 px-2 py-0.5 text-xs text-muted">{placeTypeLabel(r.type)}</span>
                    )}
                  </span>
                  {r.description && <span className="w-full truncate text-sm text-muted">{r.description}</span>}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {showList && (
        <div
          role="listbox"
          aria-label="Zoekresultaten"
          // Voorkomt blur van het invoerveld vóór de klik geregistreerd is.
          onPointerDown={(e) => e.preventDefault()}
          className="absolute inset-x-0 top-full z-10 mt-2 max-h-72 overflow-y-auto rounded-2xl border border-line bg-surface-2 shadow-xl"
        >
          {error ? (
            <p className="px-4 py-3 text-sm text-danger">{error}</p>
          ) : results.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted">Geen resultaten.</p>
          ) : (
            results.map((r) => (
              <button
                key={r.id}
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => select(r)}
                className="flex min-h-12 w-full flex-col items-start justify-center border-b border-line px-4 py-2 text-left last:border-b-0 hover:bg-surface-3"
              >
                <span className="flex w-full min-w-0 items-center gap-2">
                  <span className="truncate font-medium">{r.name}</span>
                  {placeTypeLabel(r.type) && (
                    <span className="shrink-0 rounded-full bg-surface-4 px-2 py-0.5 text-xs text-muted">{placeTypeLabel(r.type)}</span>
                  )}
                </span>
                {r.description && <span className="w-full truncate text-sm text-muted">{r.description}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
