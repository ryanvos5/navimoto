import type { ReactNode } from 'react';
import { LocateFixed, Square, Volume2, VolumeX } from 'lucide-react';
import { formatDistance, formatDuration, formatEta } from '@/lib/format';
import { Button, IconButton } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';

export interface RideStatsProps {
  speedKmh: number | null;
  remainingKm: number;
  remainingS: number;
  muted: boolean;
  following: boolean;
  /** De bevestigingsvraag "Rit beëindigen?" staat open. */
  confirming: boolean;
  /** stop() loopt. */
  stopping: boolean;
  onToggleMute: () => void;
  onFollow: () => void;
  onRequestStop: () => void;
  onCancelStop: () => void;
  onConfirmStop: () => void;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="truncate text-lg font-bold leading-tight tabular-nums sm:text-2xl">{value}</dd>
    </div>
  );
}

/** Felrode, goed zichtbare knop (de gedeelde danger-variant is te subtiel voor in de zon). */
function RedButton({ label, loading, onClick, icon }: { label: string; loading?: boolean; onClick: () => void; icon?: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="inline-flex h-14 flex-1 select-none items-center justify-center gap-2.5 rounded-2xl bg-danger px-6 text-lg font-bold text-white shadow-lg shadow-danger/30 transition-colors hover:bg-red-600 active:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {loading ? <Spinner size="sm" className="border-white" /> : icon}
      {label}
    </button>
  );
}

/** Onderste paneel: snelheid in grote cijfers, resterende afstand/tijd/aankomst en de bedieningsknoppen. */
export function RideStats({
  speedKmh,
  remainingKm,
  remainingS,
  muted,
  following,
  confirming,
  stopping,
  onToggleMute,
  onFollow,
  onRequestStop,
  onCancelStop,
  onConfirmStop,
}: RideStatsProps) {
  const speed = speedKmh !== null && Number.isFinite(speedKmh) ? String(Math.max(0, Math.round(speedKmh))) : '–';

  return (
    <section aria-label="Ritgegevens" className="safe-bottom rounded-t-3xl border-t border-line bg-surface-2/95 px-4 pt-3 shadow-2xl backdrop-blur">
      <div className="flex items-end justify-between gap-3">
        <div className="flex shrink-0 items-baseline gap-1.5">
          <span className="text-6xl font-black leading-none tracking-tight tabular-nums sm:text-7xl">{speed}</span>
          <span className="text-lg font-semibold text-muted">km/u</span>
        </div>
        <dl className="grid min-w-0 flex-1 grid-cols-3 gap-x-2 text-right">
          <Stat label="Resterend" value={formatDistance(remainingKm)} />
          <Stat label="Tijd" value={formatDuration(remainingS)} />
          <Stat label="Aankomst" value={formatEta(Date.now(), remainingS)} />
        </dl>
      </div>

      <div className="mt-3 pb-3">
        {confirming ? (
          <div className="flex items-center gap-3" role="group" aria-label="Rit beëindigen?">
            <span className="min-w-0 flex-1 text-lg font-bold">Rit beëindigen?</span>
            <Button variant="secondary" size="lg" onClick={onCancelStop} disabled={stopping}>
              Doorgaan
            </Button>
            <RedButton label="Beëindigen" loading={stopping} onClick={onConfirmStop} />
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <IconButton label={muted ? 'Geluid aan' : 'Geluid uit'} size="lg" onClick={onToggleMute} aria-pressed={muted}>
              {muted ? <VolumeX size={26} aria-hidden /> : <Volume2 size={26} aria-hidden />}
            </IconButton>
            {!following && (
              <IconButton label="Volgen" size="lg" onClick={onFollow}>
                <LocateFixed size={26} aria-hidden />
              </IconButton>
            )}
            <RedButton label="Stop" onClick={onRequestStop} icon={<Square size={20} fill="currentColor" aria-hidden />} />
          </div>
        )}
      </div>
    </section>
  );
}
