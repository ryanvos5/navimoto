// Voorbeeld van een berekende route/rondrit: naam, afstand, duur, waarschuwingen en acties.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bookmark, Check, Clock, Pencil, Play, RefreshCw, Ruler, Settings2 } from 'lucide-react';
import { STYLE_LABELS } from '@/types';
import { formatDistance, formatDuration } from '@/lib/format';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { useNavigation } from '@/store/useNavigation';
import { usePlanner } from '@/store/usePlanner';
import { useRides } from '@/store/useRides';
import { useToast } from '@/store/useToast';

export interface RoutePreviewSheetProps {
  open: boolean;
}

export function RoutePreviewSheet({ open }: RoutePreviewSheetProps) {
  const navigate = useNavigate();
  const result = usePlanner((s) => s.result);
  const resultName = usePlanner((s) => s.resultName);
  const resultWaypoints = usePlanner((s) => s.resultWaypoints);
  const previousMode = usePlanner((s) => s.previousMode);
  const style = usePlanner((s) => s.style);
  const avoid = usePlanner((s) => s.avoid);
  const loading = usePlanner((s) => s.loading);
  const savedRouteId = usePlanner((s) => s.savedRouteId);
  const [saving, setSaving] = useState(false);
  const planner = usePlanner.getState;

  const [name, setName] = useState(resultName);
  useEffect(() => setName(resultName), [resultName]);

  if (!open || !result) return null;

  const isRoundTrip = previousMode === 'roundtrip';
  const finalName = name.trim() || resultName;

  const startRide = (): void => {
    useNavigation.getState().start(result, { name: finalName, routeId: savedRouteId, waypoints: resultWaypoints, style, avoid });
    navigate('/rijden');
    planner().close();
  };

  const save = async (): Promise<void> => {
    if (savedRouteId || saving) return;
    setSaving(true);
    try {
      const saved = await useRides.getState().saveRoute({
        name: finalName,
        kind: isRoundTrip ? 'roundtrip' : 'planned',
        waypoints: resultWaypoints,
        style,
        avoid,
        geometry: result.geometry,
        distanceKm: result.distanceKm,
        durationS: result.durationS,
        maneuvers: result.maneuvers,
        gpx: null,
      });
      planner().setResultName(finalName);
      planner().markSaved(saved.id);
      useToast.getState().show('Route opgeslagen', { type: 'success' });
    } catch (e) {
      console.error('Route opslaan mislukt', e);
      useToast.getState().show('Route opslaan mislukt', { type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const chips: string[] = [];
  if (result.hasHighway) chips.push('Bevat snelweg');
  if (result.hasToll) chips.push('Bevat tolweg');
  if (result.hasFerry) chips.push('Bevat veerpont');

  return (
    <BottomSheet
      open
      nonModal
      height="auto"
      title={isRoundTrip ? 'Rondreis' : 'Route'}
      onClose={() => planner().close()}
      footer={
        <div className="flex flex-col gap-2">
          <Button block size="lg" icon={<Play size={22} aria-hidden />} onClick={startRide} disabled={loading}>
            Start rit
          </Button>
          <div className={`grid gap-2 ${isRoundTrip ? 'grid-cols-3' : 'grid-cols-2'}`}>
            <Button
              variant="secondary"
              className="min-w-0 px-2! text-sm!"
              loading={saving}
              disabled={!!savedRouteId}
              icon={savedRouteId ? <Check size={16} aria-hidden /> : <Bookmark size={16} aria-hidden />}
              onClick={() => void save()}
            >
              {savedRouteId ? 'Opgeslagen' : 'Opslaan'}
            </Button>
            {isRoundTrip && (
              <Button variant="secondary" className="min-w-0 px-2! text-sm!" loading={loading} icon={<RefreshCw size={16} aria-hidden />} onClick={() => void planner().regenerate()}>
                Opnieuw
              </Button>
            )}
            <Button variant="secondary" className="min-w-0 px-2! text-sm!" icon={<Settings2 size={16} aria-hidden />} onClick={() => planner().backToForm()} disabled={loading}>
              Wijzigen
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-3 pb-2">
        <TextField
          label="Naam"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => planner().setResultName(finalName)}
          leading={<Pencil size={18} aria-hidden />}
          maxLength={80}
          disabled={!!savedRouteId}
        />
        <dl className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-surface-3 p-3">
            <dt className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted">
              <Ruler size={14} aria-hidden /> Afstand
            </dt>
            <dd className="text-2xl font-bold tabular-nums">{formatDistance(result.distanceKm)}</dd>
          </div>
          <div className="rounded-2xl bg-surface-3 p-3">
            <dt className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted">
              <Clock size={14} aria-hidden /> Duur
            </dt>
            <dd className="text-2xl font-bold tabular-nums">{formatDuration(result.durationS)}</dd>
          </div>
        </dl>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-brand/15 px-3 py-1 text-sm font-semibold text-brand">{STYLE_LABELS[style]}</span>
          {chips.map((c) => (
            <span key={c} className="rounded-full bg-warning/15 px-3 py-1 text-sm font-medium text-warning">
              {c}
            </span>
          ))}
        </div>
      </div>
    </BottomSheet>
  );
}
