// Knop 'Mijn locatie': centreert op de positie; toont een spinner tijdens het zoeken en een melding bij fouten.
import { LocateFixed, LocateOff } from 'lucide-react';
import { IconButton } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { useLocationStore } from '@/store/useLocationStore';
import { useToast } from '@/store/useToast';

export interface LocateButtonProps {
  /** Wordt aangeroepen met de huidige positie om de kaart te centreren. */
  onLocate: () => void;
}

export function LocateButton({ onLocate }: LocateButtonProps) {
  const status = useLocationStore((s) => s.status);
  const hasPosition = useLocationStore((s) => s.position !== null);
  const failed = status === 'denied' || status === 'unavailable';
  const requesting = status === 'requesting' && !hasPosition;

  const onClick = (): void => {
    const store = useLocationStore.getState();
    if (failed) {
      useToast.getState().show(store.error ?? 'Locatie niet beschikbaar.', { type: 'error' });
      return;
    }
    if (store.status === 'idle') store.start();
    if (store.position) onLocate();
    else useToast.getState().show('Locatie wordt gezocht…', { type: 'info' });
  };

  return (
    <IconButton label="Mijn locatie" onClick={onClick} className={failed ? 'text-muted' : hasPosition ? 'text-brand' : ''}>
      {requesting ? <Spinner size="sm" /> : failed ? <LocateOff size={22} aria-hidden /> : <LocateFixed size={22} aria-hidden />}
    </IconButton>
  );
}
