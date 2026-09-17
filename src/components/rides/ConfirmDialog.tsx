// Bevestiging van een onomkeerbare actie (verwijderen) in een BottomSheet.
import type { ReactNode } from 'react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Bezig met uitvoeren: knoppen geblokkeerd, sluiten niet mogelijk. */
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Verwijderen',
  cancelLabel = 'Annuleren',
  busy = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  return (
    <BottomSheet
      open={open}
      onClose={busy ? undefined : onClose}
      title={title}
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" block onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant="danger" block onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <p className="pb-2 text-muted">{message}</p>
    </BottomSheet>
  );
}
