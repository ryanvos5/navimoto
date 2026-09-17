// Naam wijzigen in een BottomSheet (de pagina moet 'relative' zijn en de hoogte van het scherm hebben).
import { useEffect, useId, useState, type FormEvent } from 'react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';

export interface RenameDialogProps {
  open: boolean;
  initialName: string;
  title?: string;
  label?: string;
  onClose: () => void;
  onSave: (name: string) => void | Promise<void>;
}

export function RenameDialog({ open, initialName, title = 'Naam wijzigen', label = 'Naam', onClose, onSave }: RenameDialogProps) {
  const formId = useId();
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(initialName);
      setSaving(false);
    }
  }, [open, initialName]);

  const trimmed = name.trim();
  const canSave = trimmed.length > 0 && !saving;

  const submit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave(trimmed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <BottomSheet
      open={open}
      onClose={saving ? undefined : onClose}
      title={title}
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" block onClick={onClose} disabled={saving}>
            Annuleren
          </Button>
          <Button type="submit" form={formId} block loading={saving} disabled={!canSave}>
            Opslaan
          </Button>
        </div>
      }
    >
      <form id={formId} onSubmit={submit} className="pb-2">
        <TextField
          label={label}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          maxLength={80}
          autoComplete="off"
          enterKeyHint="done"
        />
      </form>
    </BottomSheet>
  );
}
