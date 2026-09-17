// Plannerstore: route van A naar B (met via-punten) of een rondrit, met voorbeeld op de kaart.
// Wordt gebruikt door MapPage en de planner-sheets; berekent via services/routing en services/roundtrip.
import { create } from 'zustand';
import type { AvoidOptions, RouteResult, RouteStyle, UserProfile, Waypoint } from '@/types';
import { DEFAULT_AVOID } from '@/types';
import { formatCoords } from '@/lib/format';
import { route, RoutingError } from '@/services/routing';
import { generateRoundTrip } from '@/services/roundtrip';
import { useLocationStore } from '@/store/useLocationStore';
import { useSettings } from '@/store/useSettings';
import { useToast } from '@/store/useToast';

export type PlannerMode = 'idle' | 'plan' | 'roundtrip' | 'preview';
export type PlannerFormMode = 'plan' | 'roundtrip';
export type PickTarget = 'start' | 'destination' | 'via' | null;

export const ROUNDTRIP_MIN_KM = 20;
export const ROUNDTRIP_MAX_KM = 400;
export const ROUNDTRIP_STEP_KM = 10;
export const ROUNDTRIP_DEFAULT_KM = 100;
export const CURRENT_LOCATION_LABEL = 'Huidige locatie';
export const ERR_NO_LOCATION = 'Locatie onbekend. Kies een startpunt op de kaart.';
export const ERR_NO_DESTINATION = 'Kies eerst een bestemming.';

export interface RoundTripSettings {
  targetKm: number;
  seed: number | null;
  bearingDeg: number | null;
}

export interface PlannerState {
  mode: PlannerMode;
  previousMode: PlannerFormMode | null;
  /** null = huidige locatie. */
  start: Waypoint | null;
  destination: Waypoint | null;
  vias: Waypoint[];
  style: RouteStyle;
  avoid: AvoidOptions;
  roundTrip: RoundTripSettings;
  result: RouteResult | null;
  resultWaypoints: Waypoint[];
  resultName: string;
  loading: boolean;
  error: string | null;
  /** Een tik op de kaart kiest dit punt. */
  pickTarget: PickTarget;
  /** Id van de opgeslagen route van het huidige resultaat (na 'Opslaan'). */
  savedRouteId: string | null;
  /** Stijl/vermijden zijn al eenmaal uit het profiel overgenomen. */
  profileApplied: boolean;

  openPlan(): void;
  openRoundTrip(): void;
  close(): void;
  setStart(w: Waypoint | null): void;
  setDestination(w: Waypoint): void;
  addVia(w: Waypoint): void;
  removeVia(index: number): void;
  updateVia(index: number, w: Waypoint): void;
  setStyle(style: RouteStyle): void;
  setAvoid(avoid: AvoidOptions): void;
  setTargetKm(km: number): void;
  setPickTarget(target: PickTarget): void;
  calculate(): Promise<void>;
  regenerate(): Promise<void>;
  backToForm(): void;
  initFromProfile(profile: UserProfile): void;
  setResultName(name: string): void;
  markSaved(id: string): void;
}

/** Label van een waypoint voor de routenaam: eigen naam of korte coördinaten. */
export function waypointLabel(w: Waypoint | null): string {
  if (!w) return CURRENT_LOCATION_LABEL;
  const name = w.name?.trim();
  return name && name.length > 0 ? name : formatCoords(w);
}

export function clampTargetKm(km: number): number {
  if (!Number.isFinite(km)) return ROUNDTRIP_DEFAULT_KM;
  const stepped = Math.round(km / ROUNDTRIP_STEP_KM) * ROUNDTRIP_STEP_KM;
  return Math.max(ROUNDTRIP_MIN_KM, Math.min(ROUNDTRIP_MAX_KM, stepped));
}

function randomSeed(): number {
  return Math.floor(Math.random() * 0x100000000);
}

function isAbort(e: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true;
  if (e instanceof RoutingError) return e.code === 'aborted';
  return e !== null && typeof e === 'object' && (e as { name?: unknown }).name === 'AbortError';
}

function errorMessage(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return 'Routeberekening mislukt.';
}

/** Lopende berekening (buiten de store: geen UI-relevantie). */
let controller: AbortController | null = null;

function abortInFlight(): void {
  if (controller) {
    controller.abort();
    controller = null;
  }
}

const initialFields = {
  mode: 'idle' as PlannerMode,
  previousMode: null as PlannerFormMode | null,
  start: null as Waypoint | null,
  destination: null as Waypoint | null,
  vias: [] as Waypoint[],
  style: 'bochtig' as RouteStyle,
  avoid: { ...DEFAULT_AVOID },
  roundTrip: { targetKm: ROUNDTRIP_DEFAULT_KM, seed: null, bearingDeg: null } as RoundTripSettings,
  result: null as RouteResult | null,
  resultWaypoints: [] as Waypoint[],
  resultName: '',
  loading: false,
  error: null as string | null,
  pickTarget: null as PickTarget,
  savedRouteId: null as string | null,
  profileApplied: false,
};

export const usePlanner = create<PlannerState>((set, get) => ({
  ...initialFields,

  openPlan: () => {
    abortInFlight();
    set({ mode: 'plan', previousMode: 'plan', pickTarget: null, error: null, loading: false });
  },

  openRoundTrip: () => {
    abortInFlight();
    set({ mode: 'roundtrip', previousMode: 'roundtrip', pickTarget: null, error: null, loading: false });
  },

  close: () => {
    abortInFlight();
    const { style, avoid, roundTrip, profileApplied } = get();
    set({
      ...initialFields,
      style,
      avoid,
      roundTrip: { ...roundTrip, seed: null, bearingDeg: null },
      profileApplied,
    });
  },

  setStart: (w) => set({ start: w, pickTarget: null }),
  setDestination: (w) => set({ destination: w, pickTarget: null }),
  addVia: (w) => set({ vias: [...get().vias, w], pickTarget: null }),
  removeVia: (index) => set({ vias: get().vias.filter((_, i) => i !== index) }),
  updateVia: (index, w) => set({ vias: get().vias.map((v, i) => (i === index ? w : v)) }),
  setStyle: (style) => set({ style }),
  setAvoid: (avoid) => set({ avoid: { ...avoid } }),
  setTargetKm: (km) => set({ roundTrip: { ...get().roundTrip, targetKm: clampTargetKm(km) } }),
  setPickTarget: (target) => set({ pickTarget: target }),

  calculate: async () => {
    const state = get();
    const formMode: PlannerFormMode =
      state.mode === 'plan' || state.mode === 'roundtrip' ? state.mode : (state.previousMode ?? 'plan');

    abortInFlight();
    const own = new AbortController();
    controller = own;
    set({ loading: true, error: null, pickTarget: null });

    const fail = (message: string): void => {
      if (controller === own) controller = null;
      set({ loading: false, error: message });
      useToast.getState().show(message, { type: 'error' });
    };

    // Startpunt: gekozen punt of de huidige positie.
    let startPoint: Waypoint;
    if (state.start) {
      startPoint = state.start;
    } else {
      const pos = useLocationStore.getState().position;
      if (!pos) {
        fail(ERR_NO_LOCATION);
        return;
      }
      startPoint = { lat: pos.lat, lon: pos.lon, name: CURRENT_LOCATION_LABEL };
    }

    const riderType = useSettings.getState().profile?.riderType ?? 'street';
    const avoid: AvoidOptions = riderType === 'street' ? { ...state.avoid, unpaved: true } : { ...state.avoid };
    const style = state.style;

    try {
      if (formMode === 'plan') {
        if (!state.destination) {
          fail(ERR_NO_DESTINATION);
          return;
        }
        const waypoints: Waypoint[] = [startPoint, ...state.vias, state.destination];
        const result = await route(waypoints, { style, avoid, riderType }, own.signal);
        if (own.signal.aborted) return;
        controller = null;
        set({
          mode: 'preview',
          previousMode: 'plan',
          result,
          resultWaypoints: waypoints,
          resultName: `${waypointLabel(state.start)} → ${waypointLabel(state.destination)}`,
          savedRouteId: null,
          loading: false,
          error: null,
        });
      } else {
        const { targetKm, seed } = state.roundTrip;
        const rt = await generateRoundTrip(
          {
            start: { lat: startPoint.lat, lon: startPoint.lon },
            targetDistanceKm: targetKm,
            style,
            avoid,
            riderType,
            ...(seed !== null ? { seed } : {}),
          },
          own.signal,
        );
        if (own.signal.aborted) return;
        controller = null;
        const waypoints = rt.waypoints.map((w, i) =>
          i === 0 || i === rt.waypoints.length - 1 ? { ...w, name: startPoint.name } : w,
        );
        set({
          mode: 'preview',
          previousMode: 'roundtrip',
          result: rt.route,
          resultWaypoints: waypoints,
          resultName: `Rondreis ${Math.round(rt.route.distanceKm)} km`,
          roundTrip: { targetKm, seed: rt.seed, bearingDeg: rt.bearingDeg },
          savedRouteId: null,
          loading: false,
          error: null,
        });
      }
    } catch (e) {
      // Afgebroken door close()/backToForm()/een nieuwe berekening: die hebben de status al gereset, geen melding.
      if (isAbort(e, own.signal)) return;
      fail(errorMessage(e));
    }
  },

  regenerate: async () => {
    const { roundTrip } = get();
    set({ roundTrip: { ...roundTrip, seed: randomSeed(), bearingDeg: null } });
    await get().calculate();
  },

  backToForm: () => {
    abortInFlight();
    const previous = get().previousMode ?? 'plan';
    set({ mode: previous, loading: false, error: null, pickTarget: null });
  },

  initFromProfile: (profile) => {
    if (get().profileApplied) return;
    set({ style: profile.defaultStyle, avoid: { ...profile.defaultAvoid }, profileApplied: true });
  },

  setResultName: (name) => set({ resultName: name }),
  markSaved: (id) => set({ savedRouteId: id }),
}));
