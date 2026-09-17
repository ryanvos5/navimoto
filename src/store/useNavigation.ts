// Actieve navigatie (zustand): voortgang langs de route, opname van het gereden spoor, gesproken
// instructies, van-de-route-detectie en herberekening. NavigationPage voert posities aan via
// updatePosition(); de rekenlogica zelf staat in lib/navigation.ts.
import { create } from 'zustand';
import type { AvoidOptions, GeoPosition, RiddenTrack, RouteResult, RouteStyle, RoutingOptions, TrackPoint, Waypoint } from '@/types';
import { DEFAULT_AVOID } from '@/types';
import { cumulativeKm, haversineM, pathLengthKm } from '@/lib/geo';
import {
  OFF_ROUTE_CONSECUTIVE,
  OFF_ROUTE_DISTANCE_M,
  buildTrackSummary,
  computeProgress,
  isArriveManeuver,
  isStartManeuver,
  remainingWaypoints,
  speechDistances,
  type NavProgress,
} from '@/lib/navigation';
import { cancelSpeech, speak } from '@/lib/speech';
import { route as requestRoute } from '@/services/routing';
import { useRides } from '@/store/useRides';
import { useSettings } from '@/store/useSettings';
import { useToast } from '@/store/useToast';

export interface RideMeta {
  name: string;
  routeId: string | null;
  waypoints: Waypoint[];
  style: RouteStyle | null;
  avoid: AvoidOptions | null;
}

export type NavigationProgress = NavProgress;

export interface NavigationState {
  active: boolean;
  route: RouteResult | null;
  meta: RideMeta | null;
  progress: NavigationProgress | null;
  recording: TrackPoint[];
  startedAt: number | null;
  rerouting: boolean;
  arrived: boolean;
  muted: boolean;
  /** Start een rit; navigeer daarna naar '/rijden'. */
  start(route: RouteResult, meta: RideMeta): void;
  /** Beëindigt de rit; slaat de opname op via useRides.saveTrack als er meer dan 100 m is gereden. */
  stop(): Promise<RiddenTrack | null>;
  /** Wordt door NavigationPage aangeroepen bij elke (echte of gesimuleerde) positie. */
  updatePosition(p: GeoPosition): void;
  toggleMute(): void;
}

/** Minimale tijd tussen twee herberekeningen. */
export const REROUTE_COOLDOWN_MS = 10_000;
/** Posities dichter dan dit bij het laatst opgenomen punt worden niet opgenomen. */
export const MIN_RECORD_DISTANCE_M = 2;
/** Alleen opnames langer dan dit worden als rit bewaard. */
export const MIN_TRACK_KM = 0.1;

export const NAV_TEXT = {
  rerouted: 'Route herberekend.',
  reroutedToast: 'Route herberekend',
  rerouteFailed: 'Herberekenen mislukt',
  arrived: 'Je bent op je bestemming.',
  saveFailed: 'Rit opslaan mislukt',
  trackSuffix: ' (gereden)',
} as const;

// Modulestatus (geen UI-relevantie): zoekvenster, van-de-route-teller, spraakgeheugen en herberekening.
let cumulative: number[] = [];
let prevIndex: number | null = null;
let offRouteCount = 0;
let lastRerouteAt = 0;
let rerouteInFlight = false;
let rerouteAbort: AbortController | null = null;
let spokenAlert = new Set<number>();
let spokenPre = new Set<number>();
let lastPosition: GeoPosition | null = null;
/** Telt op bij elke start()/stop(): een herberekening van een vorige rit mag deze rit niet raken. */
let generation = 0;

function resetInternals(): void {
  cumulative = [];
  prevIndex = null;
  offRouteCount = 0;
  lastRerouteAt = 0;
  rerouteInFlight = false;
  rerouteAbort = null;
  spokenAlert = new Set();
  spokenPre = new Set();
  lastPosition = null;
}

/** Nieuwe (of herberekende) route: zoekvenster, teller en spraakgeheugen opnieuw. */
function adoptRoute(route: RouteResult): void {
  cumulative = cumulativeKm(route.geometry);
  prevIndex = 0;
  offRouteCount = 0;
  spokenAlert = new Set();
  spokenPre = new Set();
}

function voiceOn(muted: boolean): boolean {
  const profile = useSettings.getState().profile;
  return (profile?.voiceEnabled ?? true) && !muted;
}

function say(text: string, muted: boolean, interrupt = false): void {
  if (voiceOn(muted)) speak(text, { interrupt });
}

function toTrackPoint(p: GeoPosition): TrackPoint {
  const point: TrackPoint = { lat: p.lat, lon: p.lon, t: p.t };
  if (p.altitudeM !== null) point.ele = p.altitudeM;
  if (p.speedKmh !== null) point.speedKmh = p.speedKmh;
  if (p.headingDeg !== null) point.headingDeg = p.headingDeg;
  return point;
}

/** Routeopties voor herberekening: de rit zelf, anders het profiel, anders de standaard. */
function reroutingOptions(meta: RideMeta): RoutingOptions {
  const profile = useSettings.getState().profile;
  return {
    style: meta.style ?? profile?.defaultStyle ?? 'bochtig',
    avoid: meta.avoid ?? profile?.defaultAvoid ?? DEFAULT_AVOID,
    riderType: profile?.riderType ?? 'street',
  };
}

const INITIAL = {
  active: false,
  route: null,
  meta: null,
  progress: null,
  recording: [] as TrackPoint[],
  startedAt: null,
  rerouting: false,
  arrived: false,
  muted: false,
} satisfies Partial<NavigationState>;

export const useNavigation = create<NavigationState>((set, get) => {
  /** Spreekt de waarschuwing (~300/500 m) en de instructie (~60/100 m) voor de volgende manoeuvre, elk één keer. */
  const announce = (progress: NavProgress, speedKmh: number | null, muted: boolean): void => {
    const m = progress.nextManeuver;
    const i = progress.maneuverIndex;
    // Vertrek wordt bij start() uitgesproken; de bestemming pas bij aankomst.
    if (!m || i < 0 || isStartManeuver(m) || isArriveManeuver(m)) return;
    const { alertM, preM } = speechDistances(speedKmh);
    if (progress.distanceToNextM <= alertM && !spokenAlert.has(i)) {
      spokenAlert.add(i);
      say(m.verbalAlert ?? m.verbalPre ?? m.instruction, muted);
    }
    if (progress.distanceToNextM <= preM && !spokenPre.has(i)) {
      spokenPre.add(i);
      say(m.verbalPre ?? m.instruction, muted, true);
    }
  };

  const reroute = async (from: GeoPosition, alongKm: number): Promise<void> => {
    const s = get();
    if (!s.route || !s.meta) return;
    const gen = generation;
    const controller = new AbortController();
    rerouteInFlight = true;
    rerouteAbort = controller;
    set({ rerouting: true });

    const options = reroutingOptions(s.meta);
    const targets = remainingWaypoints(s.route, s.meta.waypoints, alongKm);
    const end = s.route.geometry[s.route.geometry.length - 1];
    const destinations: Waypoint[] = targets.length > 0 ? targets : end ? [end] : [];
    const locations: Waypoint[] = [{ lat: from.lat, lon: from.lon }, ...destinations];

    try {
      const fresh = await requestRoute(locations, options, controller.signal);
      if (gen !== generation || !get().active) return;
      adoptRoute(fresh);
      const progress = computeProgress(fresh, cumulative, lastPosition ?? from, prevIndex);
      prevIndex = progress.snapIndex;
      set({ route: fresh, progress });
      say(NAV_TEXT.rerouted, get().muted, true);
      useToast.getState().show(NAV_TEXT.reroutedToast, { type: 'success' });
    } catch (err) {
      if (gen !== generation || controller.signal.aborted) return;
      console.warn('Herberekenen mislukt', err);
      useToast.getState().show(NAV_TEXT.rerouteFailed, { type: 'error' });
    } finally {
      if (gen === generation) {
        rerouteInFlight = false;
        rerouteAbort = null;
        lastRerouteAt = Date.now();
        if (get().active) set({ rerouting: false });
      }
    }
  };

  return {
    ...INITIAL,

    start(route, meta) {
      generation += 1;
      rerouteAbort?.abort();
      resetInternals();
      adoptRoute(route);
      set({ ...INITIAL, active: true, route, meta, startedAt: Date.now() });
      const first = route.maneuvers[0];
      if (first) say(first.verbalPre ?? first.instruction, false, true);
    },

    async stop() {
      const s = get();
      generation += 1;
      rerouteAbort?.abort();
      cancelSpeech();
      const { active, meta, startedAt, recording } = s;
      // Eerst de status wissen: posities die tijdens het opslaan binnenkomen horen niet meer bij deze rit.
      resetInternals();
      set({ ...INITIAL });
      if (!active || !meta || startedAt === null) return null;
      if (pathLengthKm(recording) <= MIN_TRACK_KM) return null;

      const endedAt = Date.now();
      const summary = buildTrackSummary(recording, startedAt, endedAt);
      try {
        return await useRides.getState().saveTrack({
          name: `${meta.name}${NAV_TEXT.trackSuffix}`,
          startedAt,
          endedAt,
          points: recording,
          ...summary,
          routeId: meta.routeId,
        });
      } catch (err) {
        console.warn('Rit opslaan mislukt', err);
        useToast.getState().show(NAV_TEXT.saveFailed, { type: 'error' });
        return null;
      }
    },

    updatePosition(p) {
      const s = get();
      if (!s.active || !s.route) return;
      lastPosition = p;

      const lastRecorded = s.recording[s.recording.length - 1];
      const recording =
        !lastRecorded || haversineM(lastRecorded, p) >= MIN_RECORD_DISTANCE_M ? [...s.recording, toTrackPoint(p)] : s.recording;

      const raw = computeProgress(s.route, cumulative, p, prevIndex);
      prevIndex = raw.snapIndex;
      offRouteCount = raw.distanceFromRouteM > OFF_ROUTE_DISTANCE_M ? offRouteCount + 1 : 0;
      const progress: NavProgress = { ...raw, offRoute: offRouteCount >= OFF_ROUTE_CONSECUTIVE };

      let arrived = s.arrived;
      if (!arrived && raw.arrived) {
        arrived = true;
        say(NAV_TEXT.arrived, s.muted, true);
      } else if (!arrived) {
        announce(progress, p.speedKmh, s.muted);
      }
      set({ recording, progress, arrived });

      if (progress.offRoute && !arrived && !rerouteInFlight && Date.now() - lastRerouteAt > REROUTE_COOLDOWN_MS) {
        void reroute(p, raw.alongKm);
      }
    },

    toggleMute() {
      const muted = !get().muted;
      if (muted) cancelSpeech();
      set({ muted });
    },
  };
});
