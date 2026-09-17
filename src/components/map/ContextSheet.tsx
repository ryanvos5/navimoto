// Paneel voor een gekozen plek (zoekresultaat of lang ingedrukt punt) met acties voor de planner.
import { Circle, Flag, Navigation, Plus } from 'lucide-react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';

export interface PlaceSheetProps {
  open: boolean;
  title: string;
  description?: string;
  /** Toon 'Als startpunt' (altijd in de planner; bij lang indrukken ook buiten de planner). */
  showStart: boolean;
  /** Toon 'Als via-punt' (alleen tijdens route plannen). */
  showVia: boolean;
  onClose: () => void;
  onRideHere: () => void;
  onAsStart: () => void;
  onAsVia: () => void;
}

export function PlaceSheet({ open, title, description, showStart, showVia, onClose, onRideHere, onAsStart, onAsVia }: PlaceSheetProps) {
  return (
    <BottomSheet open={open} nonModal height="auto" onClose={onClose} title={title}>
      <div className="flex flex-col gap-3 pb-2">
        {description && <p className="text-sm text-muted">{description}</p>}
        <Button block size="lg" icon={<Navigation size={22} aria-hidden />} onClick={onRideHere}>
          Hierheen rijden
        </Button>
        {(showStart || showVia) && (
          <div className="flex gap-2">
            {showStart && (
              <Button variant="secondary" className="flex-1" icon={<Circle size={18} className="text-success" aria-hidden />} onClick={onAsStart}>
                Als startpunt
              </Button>
            )}
            {showVia && (
              <Button variant="secondary" className="flex-1" icon={<Plus size={18} aria-hidden />} onClick={onAsVia}>
                Als via-punt
              </Button>
            )}
          </div>
        )}
        {!showStart && !showVia && (
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <Flag size={14} aria-hidden /> Kies 'Rijden' om een route of rondreis te plannen.
          </p>
        )}
      </div>
    </BottomSheet>
  );
}
