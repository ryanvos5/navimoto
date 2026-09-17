import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  block?: boolean;
  icon?: ReactNode;
}

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-strong active:bg-brand-strong shadow-lg shadow-brand/20',
  secondary: 'bg-surface-3 text-ink hover:bg-surface-4 active:bg-surface-4',
  ghost: 'bg-transparent text-ink hover:bg-surface-3 active:bg-surface-3',
  danger: 'bg-danger/15 text-danger hover:bg-danger/25 active:bg-danger/25',
  outline: 'border border-line bg-transparent text-ink hover:bg-surface-3',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-sm gap-1.5 rounded-lg',
  md: 'h-11 px-4 text-base gap-2 rounded-xl',
  lg: 'h-14 px-6 text-lg gap-2.5 rounded-2xl',
};

/** Standaardknop. Minimale tikhoogte 44px bij md/lg (goed voor handschoenen). */
export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  block = false,
  icon,
  className = '',
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`inline-flex select-none items-center justify-center font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT[variant]} ${SIZE[size]} ${block ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {loading ? <Spinner size="sm" /> : icon}
      {children}
    </button>
  );
}

/** Ronde icoonknop (bijv. op de kaart). */
export function IconButton({
  label,
  className = '',
  children,
  size = 'md',
  variant = 'secondary',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; size?: ButtonSize; variant?: ButtonVariant }) {
  const dim = size === 'sm' ? 'h-9 w-9' : size === 'lg' ? 'h-14 w-14' : 'h-11 w-11';
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex items-center justify-center rounded-full shadow-md transition-colors disabled:opacity-50 ${VARIANT[variant]} ${dim} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
