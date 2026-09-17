// Planner: route van A naar B met via-punten.
import { Circle, Flag, Plus, Trash2 } from 'lucide-react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button, IconButton } from '@/components/ui/Button';
import { RouteOptionsForm } from '@/components/map/RouteOptionsForm';
import { WaypointRow } from '@/components/map/WaypointRow';
import { CURRENT_LOCATION_LABEL, usePlanner, waypointLabel } from '@/store/usePlanner';
import { useSettings } from '@/store/useSettings';

export type SearchTarget = 'start' | 'destination' | 'via';

export interface PlanRouteSheetProps {
  open: boolean;
  /** Zet de zoekbalk in de gegeven modus en geeft die focus. */
  onSearch: (target: SearchTarget) => void;
}

export function PlanRouteSheet({ open, onSearch }: PlanRouteSheetProps) {
  const start = usePlanner((s) => s.start);
  const destination = usePlanner((s) => s.destination);
  const vias = usePlanner((s) => s.vias);
  const style = usePlanner((s) => s.style);
  const avoid = usePlanner((s) => s.avoid);
  const loading = usePlanner((s) => s.loading);
  const error = usePlanner((s) => s.error);
  const pickTarget = usePlanner((s) => s.pickTarget);
  const riderType = useSettings((s) => s.profile?.riderType ?? 'street');
  const planner = usePlanner.getState;

  return (
    <BottomSheet
      open={open}
      nonModal
      height="auto"
      title="Route plannen"
      onClose={() => planner().close()}
      footer={
        <Button
          block
          size="lg"
          loading={loading}
          disabled={!destination}
          onClick={() => void planner().calculate()}
        >
          Route berekenen
        </Button>
      }
    >
      <div className="flex flex-col gap-3 pb-2">
        <WaypointRow
          icon={<Circle size={20} className="text-success" aria-hidden />}
          title="Start"
          waypoint={start}
          placeholder={CURRENT_LOCATION_LABEL}
          picking={pickTarget === 'start'}
          onPick={() => planner().setPickTarget(pickTarget === 'start' ? null : 'start')}
          onSearch={() => onSearch('start')}
          onClear={() => planner().setStart(null)}
        />

        {vias.length > 0 && (
          <ol className="flex flex-col gap-2" aria-label="Via-punten">
            {vias.map((via, i) => (
              <li key={`${i}-${via.lat}-${via.lon}`} className="flex items-center gap-3 rounded-2xl border border-line bg-surface-3 px-3 py-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{waypointLabel(via)}</span>
                <IconButton label={`Via-punt ${i + 1} verwijderen`} size="sm" variant="ghost" onClick={() => planner().removeVia(i)}>
                  <Trash2 size={18} aria-hidden />
                </IconButton>
              </li>
            ))}
          </ol>
        )}

        <div className="flex gap-2">
          <Button
            size="sm"
            variant={pickTarget === 'via' ? 'primary' : 'outline'}
            icon={<Plus size={16} aria-hidden />}
            className="flex-1"
            onClick={() => planner().setPickTarget(pickTarget === 'via' ? null : 'via')}
          >
            {pickTarget === 'via' ? 'Tik op de kaart…' : 'Via-punt toevoegen'}
          </Button>
          <Button size="sm" variant="outline" className="flex-1" onClick={() => onSearch('via')}>
            Via-punt zoeken
          </Button>
        </div>

        <WaypointRow
          icon={<Flag size={20} className="text-danger" aria-hidden />}
          title="Bestemming"
          waypoint={destination}
          placeholder="Nog geen bestemming gekozen"
          picking={pickTarget === 'destination'}
          onPick={() => planner().setPickTarget(pickTarget === 'destination' ? null : 'destination')}
          onSearch={() => onSearch('destination')}
        />

        <RouteOptionsForm
          style={style}
          avoid={avoid}
          riderType={riderType}
          onStyleChange={(s) => planner().setStyle(s)}
          onAvoidChange={(a) => planner().setAvoid(a)}
        />

        {error && (
          <p role="alert" className="rounded-xl border border-danger/40 bg-danger/15 px-3 py-2 text-sm">
            {error}
          </p>
        )}
      </div>
    </BottomSheet>
  );
}
