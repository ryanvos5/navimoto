import type { ReactNode } from 'react';
import { FlaskConical, TriangleAlert } from 'lucide-react';
import type { Maneuver } from '@/types';
import { formatDistance } from '@/lib/format';
import { maneuverIconName } from '@/lib/navigation';
import { Spinner } from '@/components/ui/Spinner';
import { ManeuverIcon } from './ManeuverIcon';

export interface ManeuverBannerProps {
  /** De volgende manoeuvre, of null als de route er geen (meer) heeft. */
  maneuver: Maneuver | null;
  /** Afstand tot de manoeuvre in meters. */
  distanceM: number;
  /** Resterende afstand in km; wordt getoond als er geen manoeuvre is. */
  remainingKm: number;
  /** De manoeuvre na de volgende ("Daarna: ..."). */
  following: Maneuver | null;
  rerouting: boolean;
  offRoute: boolean;
  simulating: boolean;
}

const CHIP_TONE = {
  info: 'border-line bg-surface-3 text-ink',
  warning: 'border-warning/60 bg-warning/20 text-warning',
  sim: 'border-route-alt/60 bg-route-alt/20 text-route-alt',
} as const;

function Chip({ tone, children }: { tone: keyof typeof CHIP_TONE; children: ReactNode }) {
  return <span className={`inline-flex h-9 items-center gap-2 rounded-full border px-3 text-sm font-semibold ${CHIP_TONE[tone]}`}>{children}</span>;
}

/** Bovenste paneel tijdens het rijden: icoon, afstand in grote cijfers, instructie, straatnamen en statuschips. */
export function ManeuverBanner({ maneuver, distanceM, remainingKm, following, rerouting, offRoute, simulating }: ManeuverBannerProps) {
  const icon = maneuver ? maneuverIconName(maneuver.type) : 'straight';
  const distance = maneuver ? formatDistance(distanceM / 1000) : formatDistance(remainingKm);
  const instruction = maneuver?.instruction || 'Volg de route';
  const streets = maneuver?.streetNames.join(' / ') ?? '';
  const hasChips = rerouting || offRoute || simulating;

  return (
    <section aria-label="Volgende manoeuvre" className="rounded-3xl border border-line bg-surface-2/95 p-4 shadow-2xl backdrop-blur">
      <div className="flex items-center gap-4">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-brand text-white shadow-lg shadow-brand/30">
          <ManeuverIcon name={icon} size={52} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-5xl font-black leading-none tracking-tight tabular-nums">{distance}</div>
          <p className="mt-2 text-xl font-semibold leading-tight">{instruction}</p>
          {streets && <p className="mt-0.5 truncate text-base text-muted">{streets}</p>}
        </div>
      </div>

      {following && (
        <p className="mt-3 flex items-center gap-2 border-t border-line pt-2 text-base text-muted">
          <ManeuverIcon name={maneuverIconName(following.type)} size={20} className="shrink-0 text-ink" />
          <span className="truncate">
            <span className="font-semibold text-ink">Daarna:</span> {following.instruction}
          </span>
        </p>
      )}

      {hasChips && (
        <div className="mt-3 flex flex-wrap gap-2" aria-live="polite">
          {rerouting && (
            <Chip tone="info">
              <Spinner size="sm" />
              Herberekenen...
            </Chip>
          )}
          {offRoute && (
            <Chip tone="warning">
              <TriangleAlert size={18} aria-hidden />
              Je bent van de route af
            </Chip>
          )}
          {simulating && (
            <Chip tone="sim">
              <FlaskConical size={18} aria-hidden />
              Simulatie
            </Chip>
          )}
        </div>
      )}
    </section>
  );
}
