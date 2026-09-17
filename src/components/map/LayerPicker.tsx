// Kaartstijlkeuze (OSM / Topografisch / CyclOSM) als popover naast een ronde knop.
import { useEffect, useRef, useState } from 'react';
import { Check, Layers } from 'lucide-react';
import type { MapStyleId } from '@/types';
import { MAP_STYLE_LABELS } from '@/types';
import { IconButton } from '@/components/ui/Button';

export interface LayerPickerProps {
  value: MapStyleId;
  onChange: (style: MapStyleId) => void;
}

const STYLES: MapStyleId[] = ['osm', 'topo', 'cyclosm'];

export function LayerPicker({ value, onChange }: LayerPickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <IconButton label="Kaartstijl" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu" className={open ? 'ring-2 ring-brand' : ''}>
        <Layers size={22} aria-hidden />
      </IconButton>
      {open && (
        <div role="menu" aria-label="Kaartstijl" className="absolute right-0 top-full mt-2 w-48 overflow-hidden rounded-2xl border border-line bg-surface-2 shadow-xl">
          {STYLES.map((s) => (
            <button
              key={s}
              type="button"
              role="menuitemradio"
              aria-checked={s === value}
              onClick={() => {
                onChange(s);
                setOpen(false);
              }}
              className={`flex min-h-12 w-full items-center justify-between px-4 text-left font-medium hover:bg-surface-3 ${s === value ? 'text-brand' : 'text-ink'}`}
            >
              {MAP_STYLE_LABELS[s]}
              {s === value && <Check size={18} aria-hidden />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
