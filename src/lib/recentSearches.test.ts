import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeoSearchResult } from '@/services/geocoding';
import {
  MAX_RECENT_SEARCHES,
  RECENT_SEARCHES_KEY,
  clearRecentSearches,
  loadRecentSearches,
  rememberSearch,
} from '@/lib/recentSearches';

/** Minimale localStorage-stub voor de Node-omgeving. */
function makeStorage(): Storage & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    get length() {
      return store.size;
    },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
  };
}

function result(id: string, lat = 52.1, lon = 5.1, extra: Partial<GeoSearchResult> = {}): GeoSearchResult {
  return { id, name: `Plaats ${id}`, description: 'Utrecht, Nederland', position: { lat, lon }, type: 'city', ...extra };
}

let storage: ReturnType<typeof makeStorage>;

beforeEach(() => {
  storage = makeStorage();
  vi.stubGlobal('localStorage', storage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadRecentSearches', () => {
  it('geeft een lege lijst zonder opgeslagen data', () => {
    expect(loadRecentSearches()).toEqual([]);
  });

  it('tolereert corrupte JSON', () => {
    storage.setItem(RECENT_SEARCHES_KEY, '{not json');
    expect(loadRecentSearches()).toEqual([]);
  });

  it('tolereert JSON die geen array is', () => {
    storage.setItem(RECENT_SEARCHES_KEY, JSON.stringify({ id: 'a' }));
    expect(loadRecentSearches()).toEqual([]);
  });

  it('laat ongeldige items weg en vult ontbrekende velden aan', () => {
    storage.setItem(
      RECENT_SEARCHES_KEY,
      JSON.stringify([
        { id: 'ok', name: 'Goed', position: { lat: 52, lon: 5 } },
        { id: 'noname', position: { lat: 52, lon: 5.5 } },
        { id: 'nopos', name: 'Zonder positie' },
        { id: 'badpos', name: 'Tekst', position: { lat: '52', lon: 5 } },
        { id: 'nan', name: 'NaN', position: { lat: NaN, lon: 5 } },
        { id: 'range', name: 'Buiten bereik', position: { lat: 95, lon: 5 } },
        null,
        'tekst',
      ]),
    );
    expect(loadRecentSearches()).toEqual([
      { id: 'ok', name: 'Goed', description: '', position: { lat: 52, lon: 5 }, type: '' },
    ]);
  });

  it('geeft een lege lijst als localStorage ontbreekt of gooit', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(loadRecentSearches()).toEqual([]);
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError');
      },
    });
    expect(loadRecentSearches()).toEqual([]);
  });
});

describe('rememberSearch', () => {
  it('bewaart een resultaat en geeft de nieuwe lijst terug', () => {
    const list = rememberSearch(result('a'));
    expect(list).toEqual([result('a')]);
    expect(loadRecentSearches()).toEqual([result('a')]);
    expect(JSON.parse(storage.getItem(RECENT_SEARCHES_KEY) ?? '[]')).toHaveLength(1);
  });

  it('zet het nieuwste vooraan', () => {
    rememberSearch(result('a', 52.0, 5.0));
    rememberSearch(result('b', 52.1, 5.1));
    expect(loadRecentSearches().map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('dedupliceert op id en verplaatst naar voren', () => {
    rememberSearch(result('a', 52.0, 5.0));
    rememberSearch(result('b', 52.1, 5.1));
    rememberSearch(result('a', 52.0, 5.0, { name: 'Bijgewerkt' }));
    const list = loadRecentSearches();
    expect(list.map((r) => r.id)).toEqual(['a', 'b']);
    expect(list[0].name).toBe('Bijgewerkt');
  });

  it('dedupliceert op positie (binnen 1e-6) bij verschillende ids', () => {
    rememberSearch(result('a', 52.0, 5.0));
    rememberSearch(result('b', 52.0 + 5e-7, 5.0 - 5e-7));
    expect(loadRecentSearches().map((r) => r.id)).toEqual(['b']);
    // Net buiten de marge blijft een apart item.
    rememberSearch(result('c', 52.0 + 5e-6, 5.0));
    expect(loadRecentSearches().map((r) => r.id)).toEqual(['c', 'b']);
  });

  it('houdt maximaal MAX_RECENT_SEARCHES items', () => {
    expect(MAX_RECENT_SEARCHES).toBe(3);
    rememberSearch(result('a', 52.0, 5.0));
    rememberSearch(result('b', 52.1, 5.1));
    rememberSearch(result('c', 52.2, 5.2));
    const list = rememberSearch(result('d', 52.3, 5.3));
    expect(list.map((r) => r.id)).toEqual(['d', 'c', 'b']);
    expect(loadRecentSearches().map((r) => r.id)).toEqual(['d', 'c', 'b']);
  });

  it('negeert een ongeldig resultaat', () => {
    rememberSearch(result('a'));
    const list = rememberSearch({ id: '', name: 'x', description: '', position: { lat: 1, lon: 1 }, type: '' });
    expect(list.map((r) => r.id)).toEqual(['a']);
  });

  it('gooit niet als setItem faalt (privémodus/quota)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => undefined,
    });
    expect(() => rememberSearch(result('a'))).not.toThrow();
    expect(rememberSearch(result('a'))).toEqual([result('a')]);
  });
});

describe('clearRecentSearches', () => {
  it('maakt de lijst leeg', () => {
    rememberSearch(result('a'));
    rememberSearch(result('b', 52.5, 5.5));
    clearRecentSearches();
    expect(loadRecentSearches()).toEqual([]);
    expect(storage.getItem(RECENT_SEARCHES_KEY)).toBeNull();
  });

  it('gooit niet zonder localStorage', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(() => clearRecentSearches()).not.toThrow();
  });
});
