import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeoPosition } from '@/types';

type SuccessCb = (pos: GeolocationPosition) => void;
type ErrorCb = (err: GeolocationPositionError) => void;

let captured: { ok: SuccessCb; err: ErrorCb } | null = null;
const watchPosition = vi.fn((ok: SuccessCb, err: ErrorCb, _options?: PositionOptions) => {
  captured = { ok, err };
  return 7;
});
const clearWatch = vi.fn();

interface FixInput {
  lat: number;
  lon: number;
  acc?: number;
  heading?: number | null;
  speed?: number | null;
  alt?: number | null;
  t?: number;
}

function fix(p: FixInput): GeolocationPosition {
  const coords = {
    latitude: p.lat,
    longitude: p.lon,
    accuracy: p.acc ?? 10,
    altitude: p.alt ?? null,
    altitudeAccuracy: null,
    heading: p.heading ?? null,
    speed: p.speed ?? null,
  };
  return { coords, timestamp: p.t ?? 1_000_000 } as unknown as GeolocationPosition;
}

function geoError(code: number): GeolocationPositionError {
  return { code, message: '', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError;
}

function simPos(lat: number, lon: number, headingDeg: number | null = null, t = 1000): GeoPosition {
  return { lat, lon, accuracyM: 5, headingDeg, speedKmh: 60, altitudeM: null, t };
}

/** Verse module per test: watch-id en filterstatus leven in modulescope. */
async function loadStore() {
  vi.resetModules();
  return import('./useLocationStore');
}

function stubGeolocation() {
  vi.stubGlobal('navigator', { geolocation: { watchPosition, clearWatch } });
}

// Utrecht Domplein en een punt ~100 m noordelijker / ~100 m oostelijker.
const A = { lat: 52.0907, lon: 5.1214 };
const NORTH_100M = { lat: 52.0907 + 0.0009, lon: 5.1214 };
const EAST_100M = { lat: 52.0907, lon: 5.1214 + 0.00146 };

beforeEach(() => {
  captured = null;
  watchPosition.mockClear();
  clearWatch.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('useLocationStore', () => {
  it('exporteert DEFAULT_CENTER (Utrecht) en de hook', async () => {
    const mod = await loadStore();
    expect(mod.DEFAULT_CENTER).toEqual({ lat: 52.0907, lon: 5.1214 });
    expect(typeof mod.useCurrentPosition).toBe('function');
    expect(mod.useLocationStore.getState()).toMatchObject({ position: null, status: 'idle', error: null, simulated: false });
  });

  it('is unavailable zonder geolocation-API', async () => {
    vi.stubGlobal('navigator', {});
    const { useLocationStore } = await loadStore();
    useLocationStore.getState().start();
    expect(useLocationStore.getState().status).toBe('unavailable');
    expect(useLocationStore.getState().error).toBe('Locatie wordt niet ondersteund op dit apparaat.');
    expect(watchPosition).not.toHaveBeenCalled();
  });

  it('start() vraagt watchPosition aan met hoge nauwkeurigheid en verwerkt de eerste fix', async () => {
    stubGeolocation();
    const { useLocationStore } = await loadStore();
    useLocationStore.getState().start();
    expect(useLocationStore.getState().status).toBe('requesting');
    expect(watchPosition).toHaveBeenCalledTimes(1);
    expect(watchPosition.mock.calls[0][2]).toEqual({ enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 });

    captured!.ok(fix({ lat: 52.1, lon: 5.2, acc: 8, heading: 90, speed: 10, alt: 12, t: 5000 }));
    const s = useLocationStore.getState();
    expect(s.status).toBe('watching');
    expect(s.error).toBeNull();
    expect(s.position).toEqual({ lat: 52.1, lon: 5.2, accuracyM: 8, headingDeg: 90, speedKmh: 36, altitudeM: 12, t: 5000 });
  });

  it('start() is idempotent zolang de watch loopt', async () => {
    stubGeolocation();
    const { useLocationStore } = await loadStore();
    useLocationStore.getState().start();
    useLocationStore.getState().start();
    useLocationStore.getState().start();
    expect(watchPosition).toHaveBeenCalledTimes(1);
  });

  it('stop() ruimt de watch op en gaat naar idle', async () => {
    stubGeolocation();
    const { useLocationStore } = await loadStore();
    useLocationStore.getState().start();
    useLocationStore.getState().stop();
    expect(clearWatch).toHaveBeenCalledWith(7);
    expect(useLocationStore.getState().status).toBe('idle');
    // Na stop() start een nieuwe start() opnieuw een watch.
    useLocationStore.getState().start();
    expect(watchPosition).toHaveBeenCalledTimes(2);
  });

  it('geweigerde toestemming -> denied, watch wordt opgeruimd', async () => {
    stubGeolocation();
    const { useLocationStore } = await loadStore();
    useLocationStore.getState().start();
    captured!.err(geoError(1));
    const s = useLocationStore.getState();
    expect(s.status).toBe('denied');
    expect(s.error).toBe('Locatietoegang geweigerd. Zet locatie aan in je browserinstellingen.');
    expect(clearWatch).toHaveBeenCalledWith(7);
    // Opnieuw starten mag (bijv. na het aanpassen van de instellingen).
    useLocationStore.getState().start();
    expect(watchPosition).toHaveBeenCalledTimes(2);
    expect(useLocationStore.getState().status).toBe('requesting');
  });

  it('geen signaal / timeout -> foutmelding, watch en status blijven', async () => {
    stubGeolocation();
    const { useLocationStore } = await loadStore();
    useLocationStore.getState().start();
    captured!.err(geoError(2));
    expect(useLocationStore.getState().status).toBe('requesting');
    expect(useLocationStore.getState().error).toBe('Geen GPS-signaal.');
    expect(clearWatch).not.toHaveBeenCalled();

    captured!.ok(fix({ lat: 52, lon: 5, t: 1000 }));
    expect(useLocationStore.getState().status).toBe('watching');
    expect(useLocationStore.getState().error).toBeNull();

    captured!.err(geoError(3));
    expect(useLocationStore.getState().status).toBe('watching');
    expect(useLocationStore.getState().error).toBe('Geen GPS-signaal.');
    expect(useLocationStore.getState().position?.lat).toBe(52);
  });

  it('negeert onnauwkeurige fixes (> 150 m) binnen 30 s na een goede fix', async () => {
    stubGeolocation();
    const { useLocationStore } = await loadStore();
    useLocationStore.getState().start();

    // Eerste fix mag onnauwkeurig zijn: er is nog niets beters.
    captured!.ok(fix({ lat: 51, lon: 4, acc: 800, t: 1000 }));
    expect(useLocationStore.getState().position?.accuracyM).toBe(800);

    captured!.ok(fix({ lat: 52, lon: 5, acc: 20, t: 2000 }));
    expect(useLocationStore.getState().position?.lat).toBe(52);

    // Slechte fix 10 s later: negeren.
    captured!.ok(fix({ lat: 53, lon: 6, acc: 500, t: 12_000 }));
    expect(useLocationStore.getState().position?.lat).toBe(52);
    expect(useLocationStore.getState().position?.accuracyM).toBe(20);

    // Slechte fix > 30 s na de laatste goede: accepteren.
    captured!.ok(fix({ lat: 53, lon: 6, acc: 500, t: 33_000 }));
    expect(useLocationStore.getState().position?.lat).toBe(53);
    expect(useLocationStore.getState().position?.accuracyM).toBe(500);
  });

  it('gebruikt Date.now() als de fix geen timestamp heeft', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_700_000_000_000));
    stubGeolocation();
    const { useLocationStore } = await loadStore();
    useLocationStore.getState().start();
    captured!.ok(fix({ lat: 52, lon: 5, t: 0 }));
    expect(useLocationStore.getState().position?.t).toBe(1_700_000_000_000);
  });

  describe('toGeoPosition', () => {
    it('neemt koers en snelheid van het toestel over', async () => {
      const { toGeoPosition } = await loadStore();
      const p = toGeoPosition(fix({ lat: 52, lon: 5, acc: 4, heading: 270, speed: 25, alt: 3.5, t: 42 }), null);
      expect(p).toEqual({ lat: 52, lon: 5, accuracyM: 4, headingDeg: 270, speedKmh: 90, altitudeM: 3.5, t: 42 });
    });

    it('geeft null voor koers/snelheid zonder vorige positie', async () => {
      const { toGeoPosition } = await loadStore();
      const p = toGeoPosition(fix({ lat: 52, lon: 5, heading: NaN, speed: null }), null);
      expect(p.headingDeg).toBeNull();
      expect(p.speedKmh).toBeNull();
      expect(p.altitudeM).toBeNull();
    });

    it('berekent koers en snelheid uit de vorige positie bij > 3 m verplaatsing', async () => {
      const { toGeoPosition } = await loadStore();
      const prev: GeoPosition = { ...A, accuracyM: 5, headingDeg: 45, speedKmh: null, altitudeM: null, t: 10_000 };
      // ~100 m naar het noorden in 10 s -> ~36 km/u, koers ~0.
      const north = toGeoPosition(fix({ ...NORTH_100M, heading: NaN, speed: null, t: 20_000 }), prev);
      expect(north.headingDeg).toBeCloseTo(0, 0);
      expect(north.speedKmh).toBeCloseTo(36, 0);
      // ~100 m naar het oosten in 5 s -> ~72 km/u, koers ~90.
      const east = toGeoPosition(fix({ ...EAST_100M, heading: null, speed: -1, t: 15_000 }), prev);
      expect(east.headingDeg).toBeCloseTo(90, 0);
      expect(east.speedKmh).toBeCloseTo(72, 0);
    });

    it('houdt de vorige koers en geeft snelheid null bij < 3 m verplaatsing', async () => {
      const { toGeoPosition } = await loadStore();
      const prev: GeoPosition = { ...A, accuracyM: 5, headingDeg: 123, speedKmh: 50, altitudeM: null, t: 10_000 };
      const p = toGeoPosition(fix({ lat: A.lat + 0.00001, lon: A.lon, heading: null, speed: null, t: 11_000 }), prev);
      expect(p.headingDeg).toBe(123);
      expect(p.speedKmh).toBeNull();
    });

    it('geeft snelheid null als dt <= 0, maar berekent wel de koers', async () => {
      const { toGeoPosition } = await loadStore();
      const prev: GeoPosition = { ...A, accuracyM: 5, headingDeg: null, speedKmh: null, altitudeM: null, t: 10_000 };
      const p = toGeoPosition(fix({ ...NORTH_100M, heading: null, speed: null, t: 10_000 }), prev);
      expect(p.headingDeg).toBeCloseTo(0, 0);
      expect(p.speedKmh).toBeNull();
    });

    it('geeft voorrang aan coords.heading boven de berekende koers', async () => {
      const { toGeoPosition } = await loadStore();
      const prev: GeoPosition = { ...A, accuracyM: 5, headingDeg: null, speedKmh: null, altitudeM: null, t: 10_000 };
      const p = toGeoPosition(fix({ ...NORTH_100M, heading: 180, speed: 0, t: 11_000 }), prev);
      expect(p.headingDeg).toBe(180);
      expect(p.speedKmh).toBe(0);
    });
  });

  describe('simulatie', () => {
    it('setSimulated(true) ruimt de echte watch op en negeert echte fixes', async () => {
      stubGeolocation();
      const { useLocationStore } = await loadStore();
      useLocationStore.getState().start();
      captured!.ok(fix({ lat: 52, lon: 5, t: 1000 }));
      expect(useLocationStore.getState().position).not.toBeNull();

      useLocationStore.getState().setSimulated(true);
      const s = useLocationStore.getState();
      expect(s.simulated).toBe(true);
      expect(s.status).toBe('watching');
      expect(s.position).toBeNull();
      expect(clearWatch).toHaveBeenCalledWith(7);

      // Een late echte fix (callback nog in handen van de browser) wordt genegeerd.
      captured!.ok(fix({ lat: 53, lon: 6, t: 2000 }));
      expect(useLocationStore.getState().position).toBeNull();
      captured!.err(geoError(1));
      expect(useLocationStore.getState().status).toBe('watching');
    });

    it('start() in simulatie raakt geolocation niet aan', async () => {
      stubGeolocation();
      const { useLocationStore } = await loadStore();
      useLocationStore.getState().setSimulated(true);
      useLocationStore.getState().start();
      expect(watchPosition).not.toHaveBeenCalled();
      expect(useLocationStore.getState().status).toBe('watching');
    });

    it('pushSimulatedPosition zet de positie en berekent de koers uit de vorige gesimuleerde positie', async () => {
      stubGeolocation();
      const { useLocationStore } = await loadStore();
      // Zonder simulatie: genegeerd.
      useLocationStore.getState().pushSimulatedPosition(simPos(52, 5));
      expect(useLocationStore.getState().position).toBeNull();

      useLocationStore.getState().setSimulated(true);
      const first = simPos(A.lat, A.lon, null, 1000);
      useLocationStore.getState().pushSimulatedPosition(first);
      expect(useLocationStore.getState().position).toBe(first);
      expect(useLocationStore.getState().position?.headingDeg).toBeNull();

      useLocationStore.getState().pushSimulatedPosition(simPos(EAST_100M.lat, EAST_100M.lon, null, 2000));
      expect(useLocationStore.getState().position?.headingDeg).toBeCloseTo(90, 0);

      // Expliciete koers wordt niet overschreven.
      const explicit = simPos(NORTH_100M.lat, NORTH_100M.lon, 33, 3000);
      useLocationStore.getState().pushSimulatedPosition(explicit);
      expect(useLocationStore.getState().position).toBe(explicit);

      // Zelfde punt: vorige koers behouden.
      useLocationStore.getState().pushSimulatedPosition(simPos(NORTH_100M.lat, NORTH_100M.lon, null, 4000));
      expect(useLocationStore.getState().position?.headingDeg).toBe(33);
    });

    it('setSimulated(false) herstart de echte watch als start() eerder is aangevraagd', async () => {
      stubGeolocation();
      const { useLocationStore } = await loadStore();
      useLocationStore.getState().start();
      useLocationStore.getState().setSimulated(true);
      useLocationStore.getState().pushSimulatedPosition(simPos(52, 5));
      expect(watchPosition).toHaveBeenCalledTimes(1);

      useLocationStore.getState().setSimulated(false);
      const s = useLocationStore.getState();
      expect(s.simulated).toBe(false);
      expect(s.position).toBeNull();
      expect(s.status).toBe('requesting');
      expect(watchPosition).toHaveBeenCalledTimes(2);

      captured!.ok(fix({ lat: 52, lon: 5, t: 1000 }));
      expect(useLocationStore.getState().status).toBe('watching');
      expect(useLocationStore.getState().position?.lat).toBe(52);
    });

    it('setSimulated(false) zonder eerdere start() blijft idle', async () => {
      stubGeolocation();
      const { useLocationStore } = await loadStore();
      useLocationStore.getState().setSimulated(true);
      useLocationStore.getState().setSimulated(false);
      expect(useLocationStore.getState().status).toBe('idle');
      expect(watchPosition).not.toHaveBeenCalled();
    });

    it('setSimulated(false) na stop() herstart niet', async () => {
      stubGeolocation();
      const { useLocationStore } = await loadStore();
      useLocationStore.getState().start();
      useLocationStore.getState().stop();
      useLocationStore.getState().setSimulated(true);
      useLocationStore.getState().setSimulated(false);
      expect(watchPosition).toHaveBeenCalledTimes(1);
      expect(useLocationStore.getState().status).toBe('idle');
    });

    it('setSimulated met dezelfde waarde is een no-op', async () => {
      stubGeolocation();
      const { useLocationStore } = await loadStore();
      useLocationStore.getState().setSimulated(true);
      const p = simPos(52, 5, 10);
      useLocationStore.getState().pushSimulatedPosition(p);
      useLocationStore.getState().setSimulated(true);
      expect(useLocationStore.getState().position).toBe(p);
    });
  });
});
