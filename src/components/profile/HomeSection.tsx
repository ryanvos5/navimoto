// "Mijn huis": thuislocatie in het profiel. Adres zoeken (Photon), huidige locatie gebruiken of verwijderen.
import { useEffect, useState } from 'react';
import { House, LocateFixed, MapPin, Search, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { TextField } from '@/components/ui/TextField';
import { formatCoords } from '@/lib/format';
import { reverseGeocode, searchPlaces, type GeoSearchResult } from '@/services/geocoding';
import { useLocationStore } from '@/store/useLocationStore';
import { useToast } from '@/store/useToast';
import type { Waypoint } from '@/types';

const DEBOUNCE_MS = 350;
const MIN_CHARS = 2;
const ERR_NO_POSITION = 'Locatie onbekend. Zoek je adres of probeer het later opnieuw.';

export interface HomeSectionProps {
  home: Waypoint | null;
  /** Bewaart de thuislocatie (null = verwijderen); geeft true terug als het gelukt is. */
  onSave: (home: Waypoint | null) => Promise<boolean>;
}

function isAbortError(e: unknown): boolean {
  return e instanceof DOMException ? e.name === 'AbortError' : e instanceof Error && e.name === 'AbortError';
}

/** Volledige naam voor een zoekresultaat: "Kerkstraat 1, Oss". */
export function homeNameOf(result: GeoSearchResult): string {
  return `${result.name}${result.description ? `, ${result.description}` : ''}`;
}

export function HomeSection({ home, onSave }: HomeSectionProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeoSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [pending, setPending] = useState<'select' | 'locate' | 'remove' | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_CHARS) {
      setResults([]);
      setSearching(false);
      setSearchError(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSearching(true);
      setSearchError(null);
      searchPlaces(q, useLocationStore.getState().position, controller.signal)
        .then((r) => {
          if (controller.signal.aborted) return;
          setResults(r);
          setSearching(false);
        })
        .catch((e: unknown) => {
          if (controller.signal.aborted || isAbortError(e)) return;
          setResults([]);
          setSearchError(e instanceof Error ? e.message : 'Zoeken mislukt.');
          setSearching(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const clearSearch = (): void => {
    setQuery('');
    setResults([]);
    setSearchError(null);
  };

  const save = async (kind: 'select' | 'locate' | 'remove', next: Waypoint | null): Promise<void> => {
    if (pending) return;
    setPending(kind);
    try {
      const ok = await onSave(next);
      if (ok) {
        useToast.getState().show(next ? 'Thuislocatie opgeslagen' : 'Thuislocatie verwijderd', { type: 'success' });
        clearSearch();
      }
    } finally {
      setPending(null);
    }
  };

  const selectResult = (r: GeoSearchResult): void => {
    void save('select', { lat: r.position.lat, lon: r.position.lon, name: homeNameOf(r) });
  };

  const useCurrentLocation = async (): Promise<void> => {
    if (pending) return;
    const { position, error } = useLocationStore.getState();
    if (!position) {
      useToast.getState().show(error ?? ERR_NO_POSITION, { type: 'error' });
      return;
    }
    setPending('locate');
    const point = { lat: position.lat, lon: position.lon };
    let name: string;
    try {
      name = await reverseGeocode(point);
    } catch {
      name = formatCoords(point);
    }
    setPending(null);
    await save('locate', { ...point, name });
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Huidige thuislocatie */}
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${home ? 'bg-brand text-white' : 'bg-surface-3 text-muted'}`}
        >
          <House size={24} />
        </span>
        <div className="min-w-0 flex-1">
          {home ? (
            <>
              <p className="truncate font-semibold">{home.name || formatCoords(home)}</p>
              <p className="text-sm text-muted">Staat op de kaart en als 'Naar huis' onder Rijden.</p>
            </>
          ) : (
            <>
              <p className="font-semibold">Nog niet ingesteld</p>
              <p className="text-sm text-muted">Stel je thuisadres in om snel naar huis te navigeren.</p>
            </>
          )}
        </div>
        {home && (
          <Button
            variant="ghost"
            size="sm"
            icon={<Trash2 size={18} aria-hidden />}
            onClick={() => void save('remove', null)}
            loading={pending === 'remove'}
            disabled={pending !== null && pending !== 'remove'}
            aria-label="Thuislocatie verwijderen"
          >
            Verwijderen
          </Button>
        )}
      </div>

      {/* Adres zoeken */}
      <div className="flex flex-col gap-2">
        <TextField
          label={home ? 'Ander adres zoeken' : 'Adres zoeken'}
          placeholder="Straat, huisnummer, plaats"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          leading={<Search size={18} aria-hidden />}
          trailing={
            searching ? (
              <Spinner size="sm" />
            ) : query ? (
              <button
                type="button"
                onClick={clearSearch}
                aria-label="Zoekopdracht wissen"
                className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-muted hover:text-ink"
              >
                <X size={18} aria-hidden />
              </button>
            ) : undefined
          }
          error={searchError}
          autoComplete="street-address"
          enterKeyHint="search"
          inputMode="search"
        />
        {results.length > 0 && (
          <ul role="listbox" aria-label="Zoekresultaten" className="flex flex-col divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface-3">
            {results.map((r) => (
              <li key={r.id} role="option" aria-selected={false}>
                <button
                  type="button"
                  onClick={() => selectResult(r)}
                  disabled={pending !== null}
                  className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-surface-4 active:bg-surface-4 disabled:opacity-60"
                >
                  <MapPin size={18} className="shrink-0 text-brand" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{r.name}</span>
                    {r.description && <span className="block truncate text-sm text-muted">{r.description}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {!searching && !searchError && query.trim().length >= MIN_CHARS && results.length === 0 && (
          <p className="text-sm text-muted">Geen resultaten gevonden.</p>
        )}
      </div>

      <Button
        variant="secondary"
        size="lg"
        block
        icon={<LocateFixed size={20} aria-hidden />}
        onClick={() => void useCurrentLocation()}
        loading={pending === 'locate'}
        disabled={pending !== null && pending !== 'locate'}
      >
        Gebruik huidige locatie
      </Button>
    </div>
  );
}
