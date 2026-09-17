// Planner: rondrit vanaf een startpunt met een gewenste afstand.
import { Circle } from 'lucide-react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { RouteOptionsForm } from '@/components/map/RouteOptionsForm';
import { WaypointRow } from '@/components/map/WaypointRow';
import {
  CURRENT_LOCATION_LABEL,
  ROUNDTRIP_MAX_KM,
  ROUNDTRIP_MIN_KM,
  ROUNDTRIP_STEP_KM,
  usePlanner,
} from '@/store/usePlanner';
import { useSettings } from '@/store/useSettings';

export interface RoundTripSheetProps {
  open: boolean;
  onSearch: (target: 'start') => void;
}

export function RoundTripSheet({ open, onSearch }: RoundTripSheetProps) {
  const start = usePlanner((s) => s.start);
  const targetKm = usePlanner((s) => s.roundTrip.targetKm);
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
      title="Rondreis maken"
      onClose={() => planner().close()}
      footer={
        <Button block size="lg" loading={loading} onClick={() => void planner().calculate()}>
          Rondreis genereren
        </Button>
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        <WaypointRow
          icon={<Circle size={20} className="text-success" aria-hidden />}
          title="Startpunt"
          waypoint={start}
          placeholder={CURRENT_LOCATION_LABEL}
          picking={pickTarget === 'start'}
          onPick={() => planner().setPickTarget(pickTarget === 'start' ? null : 'start')}
          onSearch={() => onSearch('start')}
          onClear={() => planner().setStart(null)}
        />

        <section className="rounded-2xl border border-line bg-surface-3 p-4">
          <div className="flex items-baseline justify-between">
            <label htmlFor="roundtrip-distance" className="text-sm font-medium text-muted">
              Afstand
            </label>
            <output htmlFor="roundtrip-distance" className="text-3xl font-bold tabular-nums">
              {targetKm} km
            </output>
          </div>
          <input
            id="roundtrip-distance"
            type="range"
            min={ROUNDTRIP_MIN_KM}
            max={ROUNDTRIP_MAX_KM}
            step={ROUNDTRIP_STEP_KM}
            value={targetKm}
            onChange={(e) => planner().setTargetKm(Number(e.target.value))}
            className="mt-3 h-11 w-full accent-brand"
            aria-valuetext={`${targetKm} kilometer`}
          />
          <div className="flex justify-between text-xs text-muted">
            <span>{ROUNDTRIP_MIN_KM} km</span>
            <span>{ROUNDTRIP_MAX_KM} km</span>
          </div>
        </section>

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
