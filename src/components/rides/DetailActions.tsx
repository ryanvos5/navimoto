// Actieknoppen van een detailpagina: primair (rijden), exporteren (GPX) en verwijderen.
import type { ReactNode } from 'react';
import { Share2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';

export interface DetailActionsProps {
  primaryLabel: string;
  primaryIcon: ReactNode;
  primaryLoading?: boolean;
  onPrimary: () => void;
  onExport: () => void;
  onDelete: () => void;
}

export function DetailActions({ primaryLabel, primaryIcon, primaryLoading = false, onPrimary, onExport, onDelete }: DetailActionsProps) {
  return (
    <div className="flex flex-col gap-2">
      <Button size="lg" block icon={primaryIcon} loading={primaryLoading} onClick={onPrimary}>
        {primaryLabel}
      </Button>
      <Button variant="secondary" block icon={<Share2 size={18} aria-hidden />} onClick={onExport} disabled={primaryLoading}>
        Exporteren (GPX)
      </Button>
      <Button variant="danger" block icon={<Trash2 size={18} aria-hidden />} onClick={onDelete} disabled={primaryLoading}>
        Verwijderen
      </Button>
    </div>
  );
}
