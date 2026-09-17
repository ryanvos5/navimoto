// Rij in de planner voor start/bestemming/via-punt met knoppen 'Kies op kaart' en 'Zoeken'.
import type { ReactNode } from 'react';
import { MapPin, Search, X } from 'lucide-react';
import type { Waypoint } from '@/types';
import { Button, IconButton } from '@/components/ui/Button';
import { waypointLabel } from '@/store/usePlanner';

export interface WaypointRowProps {
  icon: ReactNode;
  title: string;
  waypoint: Waypoint | null;
  /** Tekst als er geen punt is (bijv. 'Huidige locatie' of 'Nog geen bestemming'). */
  placeholder: string;
  /** Actief: een tik op de kaart kiest dit punt. */
  picking: boolean;
  onPick: () => void;
  onSearch: () => void;
  /** Wissen (terug naar huidige locatie / verwijderen). */
  onClear?: () => void;
}

export function WaypointRow({ icon, title, waypoint, placeholder, picking, onPick, onSearch, onClear }: WaypointRowProps) {
  const empty = !waypoint;
  return (
    <div className={`rounded-2xl border p-3 ${picking ? 'border-brand bg-brand/10' : 'border-line bg-surface-3'}`}>
      <div className="flex items-center gap-3">
        <span className="shrink-0 text-muted">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium uppercase tracking-wide text-muted">{title}</div>
          <div className={`truncate font-medium ${empty ? 'text-muted' : 'text-ink'}`}>
            {empty ? placeholder : waypointLabel(waypoint)}
          </div>
        </div>
        {onClear && !empty && (
          <IconButton label={`${title} wissen`} size="sm" variant="ghost" onClick={onClear}>
            <X size={18} aria-hidden />
          </IconButton>
        )}
      </div>
      <div className="mt-2 flex gap-2">
        <Button size="sm" variant={picking ? 'primary' : 'secondary'} icon={<MapPin size={16} aria-hidden />} onClick={onPick} className="flex-1">
          {picking ? 'Tik op de kaart…' : 'Kies op kaart'}
        </Button>
        <Button size="sm" variant="secondary" icon={<Search size={16} aria-hidden />} onClick={onSearch} className="flex-1">
          Zoeken
        </Button>
      </div>
    </div>
  );
}
