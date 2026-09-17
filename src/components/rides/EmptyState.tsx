// Lege lijst / niet gevonden: icoon, titel, uitleg en optionele acties.
import type { ReactNode } from 'react';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className = '' }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center px-6 py-16 text-center ${className}`}>
      {icon && <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-surface-2 text-muted">{icon}</div>}
      <h2 className="text-lg font-semibold">{title}</h2>
      {description && <p className="mt-1 max-w-xs text-sm text-muted">{description}</p>}
      {action && <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
}
