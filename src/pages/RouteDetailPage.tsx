// Detail van een opgeslagen route (/ritten/route/:id): kaart, statistieken, rijden / exporteren / verwijderen.
import { SHOP_OVERLAYS } from '@/lib/shop';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { MapPinOff, Play } from 'lucide-react';
import MapView from '@/components/MapView';
import { buildRideFromSavedRoute } from '@/lib/rideBuilder';
import { useNavigation } from '@/store/useNavigation';
import { STYLE_LABELS, type LatLng } from '@/types';
import { formatDate, formatDistance, formatDuration } from '@/lib/format';
import { gpxFileName, routeToGpx } from '@/lib/gpx';
import { shareOrDownload } from '@/lib/download';
import { useRides } from '@/store/useRides';
import { useSettings } from '@/store/useSettings';
import { useLocationStore } from '@/store/useLocationStore';
import { useToast } from '@/store/useToast';
import { ConfirmDialog } from '@/components/rides/ConfirmDialog';
import { DetailActions } from '@/components/rides/DetailActions';
import { DetailHeader } from '@/components/rides/DetailHeader';
import { EmptyState } from '@/components/rides/EmptyState';
import { PageSpinner } from '@/components/rides/PageSpinner';
import { RenameDialog } from '@/components/rides/RenameDialog';
import { RouteStats, type StatItem } from '@/components/rides/RouteStats';
import {
  avoidSummary,
  DETAIL_FIT_PADDING,
  errorMessage,
  lineMarkers,
  LINK_BUTTON_CLASS,
  ROUTE_KIND_LABELS,
  routeAnchors,
  routingOptionsFor,
} from '@/components/rides/rideUtils';

function NotFound() {
  return (
    <div className="flex h-full flex-col">
      <DetailHeader title="Route" onBack={() => window.history.back()} />
      <EmptyState
        icon={<MapPinOff size={30} aria-hidden />}
        title="Route niet gevonden"
        description="Deze route bestaat niet meer of hoort bij een ander account."
        action={
          <Link to="/ritten" className={LINK_BUTTON_CLASS}>
            Naar Ritten
          </Link>
        }
      />
    </div>
  );
}

export default function RouteDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const loaded = useRides((s) => s.loaded);
  const route = useRides((s) => s.routes.find((r) => r.id === id));
  const profile = useSettings((s) => s.profile);
  const [renameOpen, setRenameOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Lopende routeberekening afbreken bij verlaten van de pagina (StrictMode-veilig: ref, geen state).
  useEffect(() => () => abortRef.current?.abort(), []);

  const layers = useMemo(() => (route ? [{ id: route.id, geometry: route.geometry }] : []), [route]);
  const markers = useMemo(() => (route ? lineMarkers(routeAnchors(route)) : []), [route]);

  if (!loaded || (deleting && !route)) return <PageSpinner />;
  if (!route) return <NotFound />;

  const current = route;

  const onRide = async (): Promise<void> => {
    if (starting) return;
    setStarting(true);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const pos = useLocationStore.getState().position;
      const from: LatLng | null = pos ? { lat: pos.lat, lon: pos.lon } : null;
      const options = routingOptionsFor(profile, current.style, current.avoid);
      const result = await buildRideFromSavedRoute(current, from, options, controller.signal);
      if (controller.signal.aborted) return;
      useNavigation.getState().start(result, {
        name: current.name,
        routeId: current.id,
        waypoints: current.waypoints,
        style: current.style,
        avoid: current.avoid,
      });
      navigate('/rijden');
    } catch (e) {
      if (controller.signal.aborted) return;
      useToast.getState().show(errorMessage(e, 'De route kon niet worden gestart.'), { type: 'error' });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setStarting(false);
    }
  };

  const onExport = async (): Promise<void> => {
    try {
      const text = current.kind === 'gpx' && current.gpx ? current.gpx : routeToGpx(current);
      const result = await shareOrDownload(gpxFileName(current.name), text);
      if (result === 'downloaded') useToast.getState().show('GPX-bestand gedownload', { type: 'success' });
    } catch (e) {
      useToast.getState().show(errorMessage(e, 'Exporteren is mislukt.'), { type: 'error' });
    }
  };

  const onRename = async (name: string): Promise<void> => {
    try {
      await useRides.getState().renameRoute(current.id, name);
      setRenameOpen(false);
      useToast.getState().show('Naam gewijzigd', { type: 'success' });
    } catch (e) {
      useToast.getState().show(errorMessage(e, 'De naam kon niet worden gewijzigd.'), { type: 'error' });
    }
  };

  const onDelete = async (): Promise<void> => {
    setDeleting(true);
    try {
      await useRides.getState().deleteRoute(current.id);
      useToast.getState().show('Route verwijderd', { type: 'success' });
      navigate('/ritten', { replace: true });
    } catch (e) {
      setDeleting(false);
      useToast.getState().show(errorMessage(e, 'De route kon niet worden verwijderd.'), { type: 'error' });
    }
  };

  const stats: StatItem[] = [
    { label: 'Afstand', value: formatDistance(current.distanceKm) },
    ...(current.durationS !== null ? [{ label: 'Duur', value: formatDuration(current.durationS) }] : []),
    { label: 'Type', value: ROUTE_KIND_LABELS[current.kind] },
    { label: 'Rijstijl', value: current.style ? STYLE_LABELS[current.style] : '–' },
    { label: 'Vermijden', value: avoidSummary(current.avoid) },
    { label: 'Aangemaakt', value: formatDate(current.createdAt) },
    { label: 'Via-punten', value: String(Math.max(0, current.waypoints.length - 2)) },
  ];

  return (
    <div className="relative flex h-full flex-col bg-surface">
      <DetailHeader title={current.name} onBack={() => navigate('/ritten')} onRename={() => setRenameOpen(true)} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="relative h-[45vh] w-full bg-surface-2">
          <MapView
            className="h-full w-full"
            mapStyle={profile?.mapStyle ?? 'osm'}
            routes={layers}
            markers={markers}
            overlays={SHOP_OVERLAYS}
            fitTo={current.geometry}
            fitPadding={DETAIL_FIT_PADDING}
          />
        </div>
        <div className="flex flex-col gap-4 p-4 pb-8">
          <RouteStats items={stats} />
          <DetailActions
            primaryLabel="Rijden"
            primaryIcon={<Play size={22} aria-hidden />}
            primaryLoading={starting}
            onPrimary={() => void onRide()}
            onExport={() => void onExport()}
            onDelete={() => setConfirmOpen(true)}
          />
        </div>
      </div>
      <RenameDialog open={renameOpen} initialName={current.name} onClose={() => setRenameOpen(false)} onSave={onRename} />
      <ConfirmDialog
        open={confirmOpen}
        title="Route verwijderen?"
        message={`"${current.name}" wordt definitief verwijderd. Dit kan niet ongedaan worden gemaakt.`}
        busy={deleting}
        onConfirm={() => void onDelete()}
        onClose={() => setConfirmOpen(false)}
      />
    </div>
  );
}
