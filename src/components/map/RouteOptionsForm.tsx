// Rijstijl (kaarten) en vermijd-opties (schakelaars) voor de planner.
import { Mountain, Waves, Zap } from 'lucide-react';
import type { AvoidOptions, RiderType, RouteStyle } from '@/types';
import { AVOID_LABELS, STYLE_DESCRIPTIONS, STYLE_LABELS } from '@/types';
import { Segmented } from '@/components/ui/Segmented';
import { Toggle } from '@/components/ui/Toggle';

export interface RouteOptionsFormProps {
  style: RouteStyle;
  avoid: AvoidOptions;
  riderType: RiderType;
  onStyleChange: (style: RouteStyle) => void;
  onAvoidChange: (avoid: AvoidOptions) => void;
}

const STYLE_ORDER: RouteStyle[] = ['bochtig', 'avontuurlijk', 'snel'];
const STYLE_ICONS: Record<RouteStyle, typeof Mountain> = { avontuurlijk: Mountain, bochtig: Waves, snel: Zap };
const AVOID_ORDER: Array<keyof AvoidOptions> = ['highways', 'tolls', 'ferries', 'unpaved'];

export function RouteOptionsForm({ style, avoid, riderType, onStyleChange, onAvoidChange }: RouteOptionsFormProps) {
  const street = riderType === 'street';
  return (
    <div className="flex flex-col gap-4">
      <section>
        <h3 className="mb-2 text-sm font-medium text-muted">Rijstijl</h3>
        <Segmented<RouteStyle>
          ariaLabel="Rijstijl"
          layout="cards"
          value={style}
          onChange={onStyleChange}
          options={STYLE_ORDER.map((s) => {
            const Icon = STYLE_ICONS[s];
            return { value: s, label: STYLE_LABELS[s], description: STYLE_DESCRIPTIONS[s], icon: <Icon size={22} aria-hidden /> };
          })}
        />
      </section>
      <section>
        <h3 className="mb-1 text-sm font-medium text-muted">Vermijden</h3>
        <div className="divide-y divide-line">
          {AVOID_ORDER.map((key) => {
            const forced = key === 'unpaved' && street;
            return (
              <Toggle
                key={key}
                label={AVOID_LABELS[key]}
                checked={forced ? true : avoid[key]}
                disabled={forced}
                description={forced ? 'Altijd aan voor Street-rijders' : undefined}
                onChange={(checked) => onAvoidChange({ ...avoid, [key]: checked })}
              />
            );
          })}
        </div>
      </section>
    </div>
  );
}
