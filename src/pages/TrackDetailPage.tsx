// Detail van een gereden rit (/ritten/rit/:id): kaart, statistieken, nogmaals rijden / exporteren / verwijderen.
import { SHOP_OVERLAYS } from '@/lib/shop';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { MapPinOff, RotateCcw } from 'lucide-react';
import MapView from '@/components/MapView';
import { useNavigation } from '@/store/useNavigation';
import { formatDateTime, formatDistance, formatDuration, formatSpeed } from '@/lib/format';
import { gpxFileName, trackToGpx } from '@/lib/gpx';
import { shareOrDownload } from '@/lib/download';
import { traceRoute } from '@/services/routing';
import { useRides } from '@/store/useRides';
import { useSettings } from '@/store/useSettings';
import { useToast } from '@/store/useToast';
import { ConfirmDialog } from '@/components/rides/ConfirmDialog';
import { DetailActions } from '@/components/rides/DetailActions';
import { DetailHeader } from '@/components/rides/DetailHeader';
import { EmptyState } from '@/components/rides/EmptyState';
import { PageSpinner } from '@/components/rides/PageSpinner';
import { RenameDialog } from '@/components/rides/RenameDialog';
import { RouteStats, type StatItem } from '@/components/rides/RouteStats';
import { DETAIL_FIT_PADDING, errorMessage, lineMarkers, LINK_BUTTON_CLASS, routingOptionsFor } from '@/components/rides/rideUtils';

const TRACK_COLOR = '#22c55e';
const BACK_TO = '/ritten?tab=gereden';

function NotFound() {
  return (
    <div className="flex h-full flex-col">
      <DetailHeader title="Rit" onBack={() => window.history.back()} />
      <EmptyState
        icon={<MapPinOff size={30} aria-hidden />}
        title="Rit niet gevonden"
        description="Deze rit bestaat niet meer of hoort bij een ander account."
        action={
          <Link to={BACK_TO} className={LINK_BUTTON_CLASS}>
            Naar Ritten
          </Link>
        }
      />
    </div>
  );
}

export default function TrackDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const loaded = useRides((s) => s.loaded);
  const track = useRides((s) => s.tracks.find((t) => t.id === id));
  const linkedRoute = useRides((s) => (track?.routeId ? s.routes.find((r) => r.id === track.routeId) : undefined));
  const profile = useSettings((s) => s.profile);
  const [renameOpen, setRenameOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const layers = useMemo(() => (track ? [{ id: track.id, geometry: track.points, color: TRACK_COLOR }] : []), [track]);
  const markers = useMemo(() => {
    if (!track || track.points.length === 0) return [];
    const first = track.points[0];
    const last = track.points[track.points.length - 1];
    return lineMarkers(track.points.length > 1 ? [first, last] : [first]);
  }, [track]);

  if (!loaded || (deleting && !track)) return <PageSpinner />;
  if (!track) return <NotFound />;

  const current = track;

  const onRideAgain = async (): Promise<void> => {
    if (starting) return;
    if (current.points.length < 2) {
      useToast.getState().show('Deze rit heeft te weinig punten om opnieuw te rijden.', { type: 'error' });
      return;
    }
    setStarting(true);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await traceRoute(current.points, routingOptionsFor(profile), controller.signal);
      if (controller.signal.aborted) return;
      const first = current.points[0];
      const last = current.points[current.points.length - 1];
      useNavigation.getState().start(result, {
        name: current.name,
        routeId: current.routeId,
        waypoints: [
          { lat: first.lat, lon: first.lon },
          { lat: last.lat, lon: last.lon },
        ],
        style: null,
        avoid: null,
      });
      navigate('/rijden');
    } catch (e) {
      if (controller.signal.aborted) return;
      useToast.getState().show(errorMessage(e, 'De rit kon niet worden gestart.'), { type: 'error' });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setStarting(false);
    }
  };

  const onExport = async (): Promise<void> => {
    try {
      const result = await shareOrDownload(gpxFileName(current.name), trackToGpx(current));
      if (result === 'downloaded') useToast.getState().show('GPX-bestand gedownload', { type: 'success' });
    } catch (e) {
      useToast.getState().show(errorMessage(e, 'Exporteren is mislukt.'), { type: 'error' });
    }
  };

  const onRename = async (name: string): Promise<void> => {
    try {
      await useRides.getState().renameTrack(current.id, name);
      setRenameOpen(false);
      useToast.getState().show('Naam gewijzigd', { type: 'success' });
    } catch (e) {
      useToast.getState().show(errorMessage(e, 'De naam kon niet worden gewijzigd.'), { type: 'error' });
    }
  };

  const onDelete = async (): Promise<void> => {
    setDeleting(true);
    try {
      await useRides.getState().deleteTrack(current.id);
      useToast.getState().show('Rit verwijderd', { type: 'success' });
      navigate(BACK_TO, { replace: true });
    } catch (e) {
      setDeleting(false);
      useToast.getState().show(errorMessage(e, 'De rit kon niet worden verwijderd.'), { type: 'error' });
    }
  };

  let linked: ReactNode = 'Geen';
  if (current.routeId) {
    linked = linkedRoute ? (
      <Link to={`/ritten/route/${linkedRoute.id}`} className="text-brand underline underline-offset-2">
        {linkedRoute.name}
      </Link>
    ) : (
      'Niet meer beschikbaar'
    );
  }

  const stats: StatItem[] = [
    { label: 'Datum en tijd', value: formatDateTime(current.startedAt) },
    { label: 'Afstand', value: formatDistance(current.distanceKm) },
    { label: 'Duur', value: formatDuration(current.durationS) },
    { label: 'Rijtijd', value: formatDuration(current.movingS) },
    { label: 'Gem. snelheid', value: formatSpeed(current.avgSpeedKmh) },
    { label: 'Max. snelheid', value: formatSpeed(current.maxSpeedKmh) },
    { label: 'Gekoppelde route', value: linked },
  ];

  return (
    <div className="relative flex h-full flex-col bg-surface">
      <DetailHeader title={current.name} onBack={() => navigate(BACK_TO)} onRename={() => setRenameOpen(true)} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="relative h-[45vh] w-full bg-surface-2">
          <MapView
            className="h-full w-full"
            mapStyle={profile?.mapStyle ?? 'osm'}
            routes={layers}
            markers={markers}
            overlays={SHOP_OVERLAYS}
            fitTo={current.points}
            fitPadding={DETAIL_FIT_PADDING}
          />
        </div>
        <div className="flex flex-col gap-4 p-4 pb-8">
          <RouteStats items={stats} />
          <DetailActions
            primaryLabel="Nogmaals rijden"
            primaryIcon={<RotateCcw size={22} aria-hidden />}
            primaryLoading={starting}
            onPrimary={() => void onRideAgain()}
            onExport={() => void onExport()}
            onDelete={() => setConfirmOpen(true)}
          />
        </div>
      </div>
      <RenameDialog open={renameOpen} initialName={current.name} onClose={() => setRenameOpen(false)} onSave={onRename} />
      <ConfirmDialog
        open={confirmOpen}
        title="Rit verwijderen?"
        message={`"${current.name}" wordt definitief verwijderd. Dit kan niet ongedaan worden gemaakt.`}
        busy={deleting}
        onConfirm={() => void onDelete()}
        onClose={() => setConfirmOpen(false)}
      />
    </div>
  );
}
