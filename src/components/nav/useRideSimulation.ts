// Ritsimulatie (profile.simulateRides): een ticker die met pointAlong over de route beweegt en de
// positie via useLocationStore.pushSimulatedPosition aanbiedt, alsof het GPS-fixes zijn.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RouteResult } from '@/types';
import { cumulativeKm, destinationPoint, pointAlong } from '@/lib/geo';
import { useLocationStore } from '@/store/useLocationStore';

export const SIM_SPEEDS = [30, 60, 90, 120] as const;
export type SimSpeed = (typeof SIM_SPEEDS)[number];
export const SIM_DEFAULT_SPEED: SimSpeed = 60;
export const SIM_TICK_MS = 1000;
/** "Van route af"-test: zo ver naast de route (haaks op de rijrichting). */
export const SIM_OFF_ROUTE_M = 150;
/** ... en zo lang, daarna weer op de route. */
export const SIM_OFF_ROUTE_MS = 12_000;

export interface RideSimulation {
  playing: boolean;
  speedKmh: SimSpeed;
  /** De "van route af"-test loopt. */
  offRoute: boolean;
  togglePlaying: () => void;
  setSpeedKmh: (speed: SimSpeed) => void;
  goOffRoute: () => void;
}

/**
 * Simuleert een rit over `route` zolang `enabled`. Een andere route (start of herberekening) begint
 * opnieuw vanaf het begin van die route. De simulatie speelt vanzelf af en stopt aan het einde.
 */
export function useRideSimulation(route: RouteResult | null, enabled: boolean): RideSimulation {
  const [playing, setPlaying] = useState(true);
  const [speedKmh, setSpeedKmh] = useState<SimSpeed>(SIM_DEFAULT_SPEED);
  const [offRoute, setOffRoute] = useState(false);
  const alongKmRef = useRef(0);
  const cumulativeRef = useRef<number[]>([]);
  const offRouteUntilRef = useRef(0);
  const offRouteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearOffRoute = useCallback((): void => {
    if (offRouteTimerRef.current !== null) {
      clearTimeout(offRouteTimerRef.current);
      offRouteTimerRef.current = null;
    }
    offRouteUntilRef.current = 0;
    setOffRoute(false);
  }, []);

  // Nieuwe route (start of herberekening): cumulatieve afstanden opnieuw en weer vanaf het begin.
  useEffect(() => {
    cumulativeRef.current = route ? cumulativeKm(route.geometry) : [];
    alongKmRef.current = 0;
    clearOffRoute();
  }, [route, clearOffRoute]);

  useEffect(() => clearOffRoute, [clearOffRoute]);

  useEffect(() => {
    if (!enabled || !playing || !route || route.geometry.length === 0) return;
    const geometry = route.geometry;

    const tick = (): void => {
      const cumulative = cumulativeRef.current;
      const total = cumulative[cumulative.length - 1] ?? 0;
      const alongKm = Math.min(alongKmRef.current, total);
      const { point, bearing } = pointAlong(geometry, cumulative, alongKm);
      const now = Date.now();
      const off = now < offRouteUntilRef.current;
      const p = off ? destinationPoint(point, (bearing + 90) % 360, SIM_OFF_ROUTE_M / 1000) : point;
      useLocationStore.getState().pushSimulatedPosition({
        lat: p.lat,
        lon: p.lon,
        accuracyM: 5,
        headingDeg: bearing,
        speedKmh,
        altitudeM: null,
        t: now,
      });
      if (alongKm >= total) {
        setPlaying(false);
        return;
      }
      alongKmRef.current = alongKm + speedKmh / 3600;
    };

    tick();
    const id = setInterval(tick, SIM_TICK_MS);
    return () => clearInterval(id);
  }, [enabled, playing, speedKmh, route]);

  const goOffRoute = useCallback((): void => {
    if (offRouteTimerRef.current !== null) clearTimeout(offRouteTimerRef.current);
    offRouteUntilRef.current = Date.now() + SIM_OFF_ROUTE_MS;
    setOffRoute(true);
    offRouteTimerRef.current = setTimeout(() => {
      offRouteTimerRef.current = null;
      offRouteUntilRef.current = 0;
      setOffRoute(false);
    }, SIM_OFF_ROUTE_MS);
  }, []);

  const togglePlaying = useCallback((): void => setPlaying((v) => !v), []);

  return { playing, speedKmh, offRoute, togglePlaying, setSpeedKmh, goOffRoute };
}
