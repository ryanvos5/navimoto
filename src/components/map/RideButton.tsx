// Grote 'Rijden'-knop rechtsonder op de kaart plus het keuzepaneel 'Wat wil je doen?'.
import { ChevronRight, Navigation, Repeat, Route } from 'lucide-react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';

export interface RideButtonProps {
  onClick: () => void;
}

export function RideButton({ onClick }: RideButtonProps) {
  return (
    <Button size="lg" onClick={onClick} icon={<Navigation size={24} aria-hidden />} className="min-w-36 shadow-xl shadow-black/40">
      Rijden
    </Button>
  );
}

export interface RideMenuSheetProps {
  open: boolean;
  onClose: () => void;
  onPlan: () => void;
  onRoundTrip: () => void;
}

const OPTIONS = [
  { key: 'plan', title: 'Route plannen', description: 'Van A naar B, met via-punten', Icon: Route },
  { key: 'roundtrip', title: 'Rondreis maken', description: 'Een lus vanaf je startpunt, kies de afstand', Icon: Repeat },
] as const;

export function RideMenuSheet({ open, onClose, onPlan, onRoundTrip }: RideMenuSheetProps) {
  return (
    <BottomSheet open={open} onClose={onClose} title="Wat wil je doen?" height="auto">
      <div className="flex flex-col gap-3 pb-2">
        {OPTIONS.map(({ key, title, description, Icon }) => (
          <button
            key={key}
            type="button"
            onClick={key === 'plan' ? onPlan : onRoundTrip}
            className="flex min-h-20 items-center gap-4 rounded-2xl border border-line bg-surface-3 p-4 text-left transition-colors hover:bg-surface-4 active:bg-surface-4"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand/15 text-brand">
              <Icon size={26} aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-lg font-semibold">{title}</span>
              <span className="block text-sm text-muted">{description}</span>
            </span>
            <ChevronRight size={22} className="shrink-0 text-muted" aria-hidden />
          </button>
        ))}
      </div>
    </BottomSheet>
  );
}
