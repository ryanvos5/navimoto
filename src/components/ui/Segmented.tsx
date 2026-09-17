import type { ReactNode } from 'react';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  description?: ReactNode;
}

export interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  /** 'row': compacte segmenten naast elkaar; 'cards': grote kaarten met beschrijving. */
  layout?: 'row' | 'cards';
  ariaLabel: string;
  className?: string;
}

/** Keuze uit een klein aantal opties (rijstijl, rijderstype, kaartstijl). */
export function Segmented<T extends string>({ value, onChange, options, layout = 'row', ariaLabel, className = '' }: SegmentedProps<T>) {
  if (layout === 'cards') {
    return (
      <div role="radiogroup" aria-label={ariaLabel} className={`grid gap-2 ${className}`}>
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(o.value)}
              className={`flex items-start gap-3 rounded-2xl border p-4 text-left transition-colors ${
                active ? 'border-brand bg-brand/10' : 'border-line bg-surface-3 hover:bg-surface-4'
              }`}
            >
              {o.icon && <span className={`mt-0.5 shrink-0 ${active ? 'text-brand' : 'text-muted'}`}>{o.icon}</span>}
              <span className="min-w-0">
                <span className="block font-semibold">{o.label}</span>
                {o.description && <span className="block text-sm text-muted">{o.description}</span>}
              </span>
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={`flex rounded-xl bg-surface-3 p-1 ${className}`}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={`flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-semibold transition-colors ${
              active ? 'bg-brand text-white shadow' : 'text-muted hover:text-ink'
            }`}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
