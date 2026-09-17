// Statistieken als definitielijst in een raster van twee kolommen.
import type { ReactNode } from 'react';

export interface StatItem {
  label: string;
  value: ReactNode;
}

export function RouteStats({ items, className = '' }: { items: StatItem[]; className?: string }) {
  return (
    <dl className={`grid grid-cols-2 gap-2 ${className}`}>
      {items.map((item) => (
        <div key={item.label} className="min-w-0 rounded-xl bg-surface-2 px-3 py-2.5">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted">{item.label}</dt>
          <dd className="mt-0.5 break-words font-semibold">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
