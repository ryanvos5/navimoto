// Fullscreen navigatie tijdens een rit (/rijden). Zonder actieve navigatie: terug naar de kaart.
// MapPage (altijd gemount) bezit de locatie-watch: hier alleen start() (idempotent), nooit stop().
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { LocateFixed } from 'lucide-react';
import type { GeoPosition, LatLng, Maneuver, MapStyleId, RiddenTrack, RouteResult } from '@/types';
import MapView from '@/components/MapView';
import { SHOP_MARKER, SHOP_OVERLAYS } from '@/lib/shop';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { ArrivedBanner } from '@/components/nav/ArrivedBanner';
import { ManeuverBanner } from '@/components/nav/ManeuverBanner';
import { RideStats } from '@/components/nav/RideStats';
import { SimulationControls } from '@/components/nav/SimulationControls';
import { useRideSimulation } from '@/components/nav/useRideSimulation';
import { requestWakeLock } from '@/lib/wakelock';
import { useCurrentPosition, useLocationStore } from '@/store/useLocationStore';
import { useNavigation, type RideMeta } from '@/store/useNavigation';
import { useSettings } from '@/store/useSettings';
import { useToast } from '@/store/useToast';

const FOLLOW_ZOOM = 16;
const FOLLOW_PITCH = 50;
const AFTER_RIDE_PATH = '/ritten?tab=gereden';

/** Subset van MapView's MapMarker / MapRouteLayer (structureel compatibel). */
interface RideMarker {
  id: string;
  position: LatLng;
  kind: 'via' | 'end' | 'shop';
  label?: string;
}
interface RideRouteLayer {
  id: string;
  geometry: LatLng[];
}

function buildMarkers(route: RouteResult | null, meta: RideMeta | null): RideMarker[] {
  if (!route || !meta) return [];
  const markers: RideMarker[] = meta.waypoints.slice(1, -1).map((wp, i) => ({
    id: `via-${i}`,
    position: { lat: wp.lat, lon: wp.lon },
    kind: 'via',
    ...(wp.name ? { label: wp.name } : {}),
  }));
  const destination = meta.waypoints[meta.waypoints.length - 1];
  const end: LatLng | undefined = destination ?? route.geometry[route.geometry.length - 1];
  if (end) {
    markers.push({ id: 'end', position: { lat: end.lat, lon: end.lon }, kind: 'end', ...(destination?.name ? { label: destination.name } : {}) });
  }
  markers.push(SHOP_MARKER);
  return markers;
}

/** Van de route af: hele route tonen, zodat je ziet waar je weer op moet komen. */
function progressOffRoute(progress: { offRoute: boolean } | null): boolean {
  return progress?.offRoute ?? false;
}

function EndingScreen() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-surface">
      <Spinner size="lg" />
      <p className="text-lg font-semibold">Rit wordt afgerond...</p>
    </div>
  );
}

export default function NavigationPage() {
  const active = useNavigation((s) => s.active);
  const [ending, setEnding] = useState(false);
  const navigate = useNavigate();

  const endRide = useCallback(async (): Promise<void> => {
    setEnding(true);
    let track: RiddenTrack | null = null;
    try {
      track = await useNavigation.getState().stop();
    } finally {
      useToast.getState().show(track ? 'Rit opgeslagen' : 'Rit beëindigd', { type: track ? 'success' : 'info' });
      navigate(AFTER_RIDE_PATH, { replace: true });
    }
  }, [navigate]);

  if (!active) return ending ? <EndingScreen /> : <Navigate to="/kaart" replace />;
  return <ActiveRide ending={ending} onEnd={endRide} />;
}

interface ActiveRideProps {
  ending: boolean;
  onEnd: () => Promise<void>;
}

function ActiveRide({ ending, onEnd }: ActiveRideProps) {
  const route = useNavigation((s) => s.route);
  const meta = useNavigation((s) => s.meta);
  const progress = useNavigation((s) => s.progress);
  const rerouting = useNavigation((s) => s.rerouting);
  const arrived = useNavigation((s) => s.arrived);
  const muted = useNavigation((s) => s.muted);
  const profile = useSettings((s) => s.profile);
  const position = useCurrentPosition();
  const simulating = profile?.simulateRides === true;
  const mapStyle: MapStyleId = profile?.mapStyle ?? 'osm';

  const [follow, setFollow] = useState(true);
  const [confirming, setConfirming] = useState(false);

  // Locatie: alleen (idempotent) starten; MapPage ruimt de watch op.
  useEffect(() => {
    useLocationStore.getState().start();
  }, []);

  // Simulatiemodus aan zolang deze pagina open is.
  useEffect(() => {
    if (!simulating) return;
    useLocationStore.getState().setSimulated(true);
    return () => useLocationStore.getState().setSimulated(false);
  }, [simulating]);

  // Elke nieuwe positie (echt of gesimuleerd) naar de navigatiestore.
  useEffect(() => {
    const feed = (p: GeoPosition | null): void => {
      if (p) useNavigation.getState().updatePosition(p);
    };
    feed(useLocationStore.getState().position);
    return useLocationStore.subscribe((s, prev) => {
      if (s.position !== prev.position) feed(s.position);
    });
  }, []);

  // Scherm aan houden tijdens de rit.
  useEffect(() => {
    let release: (() => void) | null = null;
    let cancelled = false;
    void requestWakeLock().then((r) => {
      if (cancelled) r();
      else release = r;
    });
    return () => {
      cancelled = true;
      release?.();
    };
  }, []);

  const sim = useRideSimulation(simulating ? route : null, simulating);

  // Alleen het stuk vóór je wordt getekend: het gereden deel (tot het snappunt) verdwijnt.
  const snapIndex = progress?.snapIndex ?? null;
  const snapPoint = progress?.snapPoint ?? null;
  const routes = useMemo<RideRouteLayer[]>(() => {
    if (!route) return [];
    if (snapIndex === null || snapPoint === null || progressOffRoute(progress)) return [{ id: 'ride', geometry: route.geometry }];
    const ahead = route.geometry.slice(snapIndex + 1);
    return [{ id: 'ride', geometry: ahead.length > 0 ? [snapPoint, ...ahead] : [snapPoint] }];
  }, [route, snapIndex, snapPoint, progress]);
  const markers = useMemo<RideMarker[]>(() => buildMarkers(route, meta), [route, meta]);

  const onUserInteraction = useCallback((): void => setFollow(false), []);
  const enableFollow = useCallback((): void => setFollow(true), []);
  const toggleMute = useCallback((): void => useNavigation.getState().toggleMute(), []);
  const requestStop = useCallback((): void => setConfirming(true), []);
  const cancelStop = useCallback((): void => setConfirming(false), []);
  const confirmStop = useCallback((): void => {
    void onEnd();
  }, [onEnd]);

  if (!route || !meta) return null;

  // Voor de eerste positie: de vertrekmanoeuvre tonen.
  const maneuverIndex = progress ? progress.maneuverIndex : route.maneuvers.length > 0 ? 0 : -1;
  const next: Maneuver | null = progress ? progress.nextManeuver : (route.maneuvers[0] ?? null);
  const following: Maneuver | null = maneuverIndex >= 0 ? (route.maneuvers[maneuverIndex + 1] ?? null) : null;
  const remainingKm = progress?.remainingKm ?? route.distanceKm;
  const remainingS = progress?.remainingS ?? route.durationS;

  return (
    <div className="relative h-full w-full overflow-hidden bg-surface">
      <MapView
        className="absolute inset-0"
        mapStyle={mapStyle}
        routes={routes}
        markers={markers}
        overlays={SHOP_OVERLAYS}
        userPosition={position}
        userMarker="arrow"
        follow={follow}
        followZoom={FOLLOW_ZOOM}
        followPitch={FOLLOW_PITCH}
        onUserInteraction={onUserInteraction}
      />

      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
        <div className="safe-top pointer-events-auto p-3">
          {arrived ? (
            <ArrivedBanner name={meta.name} finishing={ending} onFinish={confirmStop} />
          ) : (
            <ManeuverBanner
              maneuver={next}
              distanceM={progress?.distanceToNextM ?? 0}
              remainingKm={remainingKm}
              following={following}
              rerouting={rerouting}
              offRoute={progress?.offRoute ?? false}
              simulating={simulating}
            />
          )}
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-end justify-between gap-3 px-3">
            <div className="pointer-events-auto min-w-0">
              {simulating && (
                <SimulationControls
                  playing={sim.playing}
                  speedKmh={sim.speedKmh}
                  offRoute={sim.offRoute}
                  onTogglePlaying={sim.togglePlaying}
                  onSpeedChange={sim.setSpeedKmh}
                  onOffRoute={sim.goOffRoute}
                />
              )}
            </div>
            {!follow && (
              <Button className="pointer-events-auto shrink-0" variant="secondary" size="lg" icon={<LocateFixed size={22} aria-hidden />} onClick={enableFollow}>
                Volgen
              </Button>
            )}
          </div>
          <div className="pointer-events-auto">
            <RideStats
              speedKmh={position?.speedKmh ?? null}
              remainingKm={remainingKm}
              remainingS={remainingS}
              muted={muted}
              following={follow}
              confirming={confirming}
              stopping={ending}
              onToggleMute={toggleMute}
              onFollow={enableFollow}
              onRequestStop={requestStop}
              onCancelStop={cancelStop}
              onConfirmStop={confirmStop}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
