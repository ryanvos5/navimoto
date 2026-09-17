import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  containerClassName?: string;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, leading, trailing, className = '', containerClassName = '', id, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className={`flex flex-col gap-1.5 ${containerClassName}`}>
      {label && (
        <label htmlFor={inputId} className="text-sm font-medium text-muted">
          {label}
        </label>
      )}
      <div
        className={`flex h-12 items-center gap-2 rounded-xl border bg-surface-3 px-3 transition-colors focus-within:border-brand ${
          error ? 'border-danger' : 'border-line'
        }`}
      >
        {leading && <span className="shrink-0 text-muted">{leading}</span>}
        <input
          ref={ref}
          id={inputId}
          className={`h-full min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-muted/70 focus:outline-none ${className}`}
          aria-invalid={!!error}
          {...rest}
        />
        {trailing && <span className="shrink-0 text-muted">{trailing}</span>}
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : hint ? <p className="text-sm text-muted">{hint}</p> : null}
    </div>
  );
});
