import { Pause, Play, TriangleAlert } from 'lucide-react';
import { Button, IconButton } from '@/components/ui/Button';
import { Segmented } from '@/components/ui/Segmented';
import { SIM_SPEEDS, type SimSpeed } from './useRideSimulation';

export interface SimulationControlsProps {
  playing: boolean;
  speedKmh: SimSpeed;
  /** De "van route af"-test loopt (knop tijdelijk uit). */
  offRoute: boolean;
  onTogglePlaying: () => void;
  onSpeedChange: (speed: SimSpeed) => void;
  onOffRoute: () => void;
}

type SpeedKey = `${SimSpeed}`;

const SPEED_OPTIONS = SIM_SPEEDS.map((s) => ({ value: `${s}` as SpeedKey, label: String(s) }));

function toSpeed(key: SpeedKey): SimSpeed {
  return SIM_SPEEDS.find((s) => `${s}` === key) ?? SIM_SPEEDS[1];
}

/** Klein paneel linksonder in simulatiemodus: afspelen/pauzeren, snelheid en de "van route af"-test. */
export function SimulationControls({ playing, speedKmh, offRoute, onTogglePlaying, onSpeedChange, onOffRoute }: SimulationControlsProps) {
  return (
    <section aria-label="Simulatie" className="flex max-w-full flex-col gap-2 rounded-2xl border border-line bg-surface-2/95 p-2 shadow-xl backdrop-blur">
      <div className="flex items-center gap-2">
        <IconButton label={playing ? 'Pauzeren' : 'Afspelen'} variant="primary" onClick={onTogglePlaying} aria-pressed={playing}>
          {playing ? <Pause size={22} aria-hidden /> : <Play size={22} aria-hidden />}
        </IconButton>
        <Segmented<SpeedKey>
          value={`${speedKmh}`}
          onChange={(key) => onSpeedChange(toSpeed(key))}
          options={SPEED_OPTIONS}
          ariaLabel="Simulatiesnelheid in km/u"
          className="min-w-0"
        />
        <span className="text-sm font-semibold text-muted">km/u</span>
      </div>
      <Button variant="outline" size="sm" block icon={<TriangleAlert size={16} aria-hidden />} onClick={onOffRoute} disabled={offRoute}>
        Van route af
      </Button>
    </section>
  );
}
