// "GPX importeren": kiest een bestand, zet het om naar een route, slaat die op en opent de detailpagina.
import { useRef, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload } from 'lucide-react';
import { Button, type ButtonSize, type ButtonVariant } from '@/components/ui/Button';
import { gpxToNewRoute } from '@/lib/gpxImport';
import { useRides } from '@/store/useRides';
import { useToast } from '@/store/useToast';
import { errorMessage } from './rideUtils';

export const GPX_ACCEPT = '.gpx,application/gpx+xml,text/xml,application/xml';

export interface ImportGpxButtonProps {
  size?: ButtonSize;
  variant?: ButtonVariant;
  block?: boolean;
  className?: string;
}

async function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  // Oudere browsers zonder Blob.text().
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('Het bestand kon niet worden gelezen.'));
    reader.readAsText(file);
  });
}

export function ImportGpxButton({ size = 'md', variant = 'secondary', block = false, className }: ImportGpxButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const onChange = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const input = e.currentTarget;
    const file = input.files?.[0] ?? null;
    // Waarde wissen zodat hetzelfde bestand een tweede keer gekozen kan worden.
    input.value = '';
    if (!file || busy) return;
    setBusy(true);
    try {
      const text = await readFileText(file);
      const saved = await useRides.getState().saveRoute(gpxToNewRoute(text, file.name));
      useToast.getState().show('GPX geïmporteerd', { type: 'success' });
      navigate(`/ritten/route/${saved.id}`);
    } catch (err) {
      useToast.getState().show(errorMessage(err, 'Het GPX-bestand kon niet worden geïmporteerd.'), { type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        size={size}
        variant={variant}
        block={block}
        className={className}
        icon={<Upload size={18} aria-hidden />}
        loading={busy}
        onClick={() => inputRef.current?.click()}
      >
        GPX importeren
      </Button>
      <input ref={inputRef} type="file" accept={GPX_ACCEPT} className="hidden" tabIndex={-1} aria-hidden onChange={onChange} />
    </>
  );
}
