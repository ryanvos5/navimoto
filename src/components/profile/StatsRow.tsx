import type { ReactNode } from 'react';
import { Flag, Milestone, Route, Timer } from 'lucide-react';
import { formatDistance, formatDuration } from '@/lib/format';
import { useRides } from '@/store/useRides';

interface StatTile {
  label: string;
  value: string;
  icon: ReactNode;
}

const finite = (n: number): number => (Number.isFinite(n) ? n : 0);

/** Vier tegels: opgeslagen routes, gereden ritten, totaal gereden en totale rijtijd. */
export function StatsRow() {
  const routes = useRides((s) => s.routes);
  const tracks = useRides((s) => s.tracks);

  const totalKm = tracks.reduce((sum, t) => sum + finite(t.distanceKm), 0);
  const totalS = tracks.reduce((sum, t) => sum + finite(t.durationS), 0);

  const tiles: StatTile[] = [
    { label: 'Opgeslagen routes', value: String(routes.length), icon: <Route size={16} aria-hidden /> },
    { label: 'Gereden ritten', value: String(tracks.length), icon: <Flag size={16} aria-hidden /> },
    { label: 'Totaal gereden', value: formatDistance(totalKm), icon: <Milestone size={16} aria-hidden /> },
    // formatDuration(0) geeft "< 1 min"; zonder ritten is "0 min" duidelijker.
    { label: 'Totale rijtijd', value: totalS > 0 ? formatDuration(totalS) : '0 min', icon: <Timer size={16} aria-hidden /> },
  ];

  return (
    <dl className="grid grid-cols-2 gap-3">
      {tiles.map((tile) => (
        <div key={tile.label} className="flex flex-col gap-1 rounded-xl bg-surface-3 p-3">
          <dt className="flex items-center gap-1.5 text-xs font-medium text-muted">
            {tile.icon}
            {tile.label}
          </dt>
          <dd className="text-2xl font-bold tabular-nums text-ink">{tile.value}</dd>
        </div>
      ))}
    </dl>
  );
}
