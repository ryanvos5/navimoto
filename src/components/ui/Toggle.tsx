import type { ReactNode } from 'react';

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
}

/** Schakelaar met label, geschikt als rij in een lijst. */
export function Toggle({ checked, onChange, label, description, disabled, className = '' }: ToggleProps) {
  return (
    <label className={`flex cursor-pointer items-center justify-between gap-4 py-3 ${disabled ? 'opacity-50' : ''} ${className}`}>
      <span className="min-w-0">
        <span className="block font-medium">{label}</span>
        {description && <span className="block text-sm text-muted">{description}</span>}
      </span>
      <span className="relative inline-flex shrink-0">
        <input
          type="checkbox"
          role="switch"
          className="peer sr-only"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="h-7 w-12 rounded-full bg-surface-4 transition-colors peer-checked:bg-brand peer-focus-visible:ring-2 peer-focus-visible:ring-brand-soft" />
        <span className="absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
      </span>
    </label>
  );
}
