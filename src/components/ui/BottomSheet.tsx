import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

export interface BottomSheetProps {
  open: boolean;
  onClose?: () => void;
  title?: ReactNode;
  children: ReactNode;
  /** Hoogte: 'auto' (inhoud), 'half' of 'full'. */
  height?: 'auto' | 'half' | 'full';
  /** Laat de kaart erachter bedienbaar (geen backdrop). */
  nonModal?: boolean;
  footer?: ReactNode;
  className?: string;
}

/**
 * Onderste schuifpaneel. Bij nonModal blijft de achtergrond (kaart) bedienbaar;
 * anders sluit een klik op de backdrop het paneel.
 */
export function BottomSheet({ open, onClose, title, children, height = 'auto', nonModal = false, footer, className = '' }: BottomSheetProps) {
  useEffect(() => {
    if (!open || !onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const h = height === 'full' ? 'h-[92%]' : height === 'half' ? 'h-[55%]' : 'max-h-[85%]';

  return (
    <div className={`absolute inset-0 z-30 flex flex-col justify-end ${nonModal ? 'pointer-events-none' : ''}`}>
      {!nonModal && <button type="button" aria-label="Sluiten" className="absolute inset-0 bg-black/40" onClick={onClose} />}
      <section
        role="dialog"
        aria-modal={!nonModal}
        className={`pointer-events-auto relative flex w-full flex-col rounded-t-3xl border-t border-line bg-surface-2 shadow-2xl ${h} ${className}`}
      >
        <div className="flex shrink-0 items-center gap-3 px-4 pb-2 pt-3">
          <div className="mx-auto h-1.5 w-10 rounded-full bg-surface-4" aria-hidden />
        </div>
        {(title || onClose) && (
          <header className="flex shrink-0 items-center justify-between px-5 pb-3">
            <h2 className="text-lg font-semibold">{title}</h2>
            {onClose && (
              <button type="button" onClick={onClose} aria-label="Sluiten" className="rounded-full p-2 text-muted hover:bg-surface-3 hover:text-ink">
                <X size={20} />
              </button>
            )}
          </header>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>
        {footer && <footer className="safe-bottom shrink-0 border-t border-line px-5 py-3">{footer}</footer>}
      </section>
    </div>
  );
}
