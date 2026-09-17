// Locatiestore: volgt de GPS-positie van het toestel via navigator.geolocation.watchPosition,
// of neemt posities aan van de ritsimulator (simulated = true; echte fixes worden dan genegeerd).
import { create } from 'zustand';
import type { GeoPosition, LatLng } from '@/types';
import { bearingDeg, haversineM } from '@/lib/geo';

/** Utrecht - fallback voor de kaart zolang de locatie onbekend is. */
export const DEFAULT_CENTER: LatLng = { lat: 52.0907, lon: 5.1214 };

export type LocationStatus = 'idle' | 'requesting' | 'watching' | 'denied' | 'unavailable';

export interface LocationState {
  position: GeoPosition | null;
  status: LocationStatus;
  error: string | null;
  /** true = position komt van de simulator, echte GPS wordt genegeerd. */
  simulated: boolean;
  /** watchPosition starten (idempotent), enableHighAccuracy: true. */
  start(): void;
  stop(): void;
  setSimulated(on: boolean): void;
  pushSimulatedPosition(p: GeoPosition): void;
}

const ERR_UNSUPPORTED = 'Locatie wordt niet ondersteund op dit apparaat.';
const ERR_DENIED = 'Locatietoegang geweigerd. Zet locatie aan in je browserinstellingen.';
const ERR_NO_SIGNAL = 'Geen GPS-signaal.';

/** GeolocationPositionError.code voor geweigerde toestemming. */
const PERMISSION_DENIED = 1;
/** Fixes onnauwkeuriger dan dit worden genegeerd zolang er recent een betere fix was. */
const MAX_ACCURACY_M = 150;
/** Venster waarbinnen een goede fix een slechte fix laat negeren. */
const ACCURACY_WINDOW_MS = 30_000;
/** Minimale verplaatsing om koers/snelheid uit twee fixes af te leiden (GPS-ruis). */
const MIN_MOVE_M = 3;
/** Minimale verplaatsing voor de simulator (geen ruis; alleen identieke punten uitsluiten). */
const MIN_SIM_MOVE_M = 0.5;

const WATCH_OPTIONS: PositionOptions = { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 };

// Modulestatus (niet in de store: geen UI-relevantie, wel nodig voor idempotentie en herstart).
let watchId: number | null = null;
/** Of start() is aangevraagd (en niet door stop() ingetrokken) - om na simulatie de echte watch te herstarten. */
let wantWatching = false;
/** Tijdstip (fix-tijd) van de laatste fix met accuracy <= MAX_ACCURACY_M. */
let lastAccurateT: number | null = null;

function fixTime(pos: GeolocationPosition): number {
  return pos.timestamp || Date.now();
}

/**
 * Zet een browser-GeolocationPosition om naar GeoPosition. `prev` is de vorige geaccepteerde positie:
 * daaruit worden koers en snelheid afgeleid als het toestel ze niet levert en er > 3 m is afgelegd.
 */
export function toGeoPosition(pos: GeolocationPosition, prev: GeoPosition | null): GeoPosition {
  const c = pos.coords;
  const t = fixTime(pos);
  const point: LatLng = { lat: c.latitude, lon: c.longitude };
  const movedM = prev ? haversineM(prev, point) : 0;
  const moved = prev !== null && movedM > MIN_MOVE_M;

  let headingDeg: number | null;
  if (c.heading !== null && Number.isFinite(c.heading)) headingDeg = c.heading;
  else if (prev && moved) headingDeg = bearingDeg(prev, point);
  else headingDeg = prev?.headingDeg ?? null;

  let speedKmh: number | null = null;
  if (c.speed !== null && Number.isFinite(c.speed) && c.speed >= 0) speedKmh = c.speed * 3.6;
  else if (prev && moved) {
    const dtS = (t - prev.t) / 1000;
    if (dtS > 0) speedKmh = (movedM / dtS) * 3.6;
  }

  return {
    lat: c.latitude,
    lon: c.longitude,
    accuracyM: c.accuracy,
    altitudeM: c.altitude ?? null,
    headingDeg,
    speedKmh,
    t,
  };
}

function clearRealWatch(): void {
  if (watchId === null) return;
  if (typeof navigator !== 'undefined' && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
  watchId = null;
}

export const useLocationStore = create<LocationState>((set, get) => {
  const onFix = (pos: GeolocationPosition): void => {
    const state = get();
    if (state.simulated) return; // simulator heeft voorrang
    const t = fixTime(pos);
    const accuracy = pos.coords.accuracy;
    if (accuracy > MAX_ACCURACY_M && lastAccurateT !== null && t - lastAccurateT <= ACCURACY_WINDOW_MS) {
      return; // slechte fix negeren, er was net nog een goede
    }
    if (accuracy <= MAX_ACCURACY_M) lastAccurateT = t;
    set({ position: toGeoPosition(pos, state.position), status: 'watching', error: null });
  };

  const onError = (err: GeolocationPositionError): void => {
    if (get().simulated) return;
    if (err.code === PERMISSION_DENIED) {
      clearRealWatch();
      set({ status: 'denied', error: ERR_DENIED });
      return;
    }
    // POSITION_UNAVAILABLE / TIMEOUT: watch blijft lopen, status blijft 'requesting' of 'watching'.
    set({ error: ERR_NO_SIGNAL });
  };

  return {
    position: null,
    status: 'idle',
    error: null,
    simulated: false,

    start: () => {
      wantWatching = true;
      if (get().simulated) {
        set({ status: 'watching', error: null });
        return;
      }
      if (watchId !== null) return; // al bezig
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        set({ status: 'unavailable', error: ERR_UNSUPPORTED });
        return;
      }
      set({ status: 'requesting', error: null });
      watchId = navigator.geolocation.watchPosition(onFix, onError, WATCH_OPTIONS);
    },

    stop: () => {
      wantWatching = false;
      clearRealWatch();
      lastAccurateT = null;
      set({ status: 'idle', error: null });
    },

    setSimulated: (on) => {
      if (on === get().simulated) return;
      if (on) {
        clearRealWatch();
        lastAccurateT = null;
        set({ simulated: true, status: 'watching', position: null, error: null });
        return;
      }
      set({ simulated: false, status: 'idle', position: null, error: null });
      if (wantWatching) get().start();
    },

    pushSimulatedPosition: (p) => {
      const state = get();
      if (!state.simulated) return;
      let headingDeg = p.headingDeg;
      if (headingDeg === null) {
        const prev = state.position;
        if (prev && haversineM(prev, p) > MIN_SIM_MOVE_M) headingDeg = bearingDeg(prev, p);
        else headingDeg = prev?.headingDeg ?? null;
      }
      set({ position: headingDeg === p.headingDeg ? p : { ...p, headingDeg } });
    },
  };
});

/** Hook: de huidige positie (echt of gesimuleerd), of null. */
export function useCurrentPosition(): GeoPosition | null {
  return useLocationStore((s) => s.position);
}
