// Banner bovenaan de kaart terwijl de gebruiker een punt op de kaart kiest.
import { MapPin } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { PickTarget } from '@/store/usePlanner';

export interface PickBannerProps {
  target: Exclude<PickTarget, null>;
  onCancel: () => void;
}

const TARGET_TEXT: Record<Exclude<PickTarget, null>, string> = {
  start: 'het startpunt',
  destination: 'de bestemming',
  via: 'het via-punt',
};

export function PickBanner({ target, onCancel }: PickBannerProps) {
  return (
    <div role="status" className="flex items-center gap-3 rounded-2xl border border-brand/50 bg-surface-2/95 px-3 py-2 shadow-lg backdrop-blur">
      <MapPin size={20} className="shrink-0 text-brand" aria-hidden />
      <span className="min-w-0 flex-1 text-sm font-medium">Tik op de kaart om {TARGET_TEXT[target]} te kiezen</span>
      <Button size="sm" variant="secondary" onClick={onCancel}>
        Annuleren
      </Button>
    </div>
  );
}
