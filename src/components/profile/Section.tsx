import { useId, type ReactNode } from 'react';

export interface SectionProps {
  title: string;
  children: ReactNode;
  className?: string;
}

/** Sectie op de profielpagina: kleine kop met daaronder een kaart. */
export function Section({ title, children, className = '' }: SectionProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={`flex flex-col gap-2 ${className}`}>
      <h2 id={headingId} className="px-1 text-xs font-semibold uppercase tracking-wider text-muted">
        {title}
      </h2>
      <div className="rounded-2xl border border-line bg-surface-2 p-4">{children}</div>
    </section>
  );
}
