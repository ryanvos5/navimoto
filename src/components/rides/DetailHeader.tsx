// Kop van een detailpagina: terug, naam (afgekapt) en potlood om de naam te wijzigen.
import { ArrowLeft, Pencil } from 'lucide-react';

export interface DetailHeaderProps {
  title: string;
  onBack: () => void;
  onRename?: () => void;
}

const ICON_BUTTON = 'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink transition-colors hover:bg-surface-3 active:bg-surface-3';

export function DetailHeader({ title, onBack, onRename }: DetailHeaderProps) {
  return (
    <header className="safe-top shrink-0 border-b border-line bg-surface-2/95 backdrop-blur">
      <div className="flex items-center gap-1 px-2 py-2">
        <button type="button" onClick={onBack} aria-label="Terug" title="Terug" className={ICON_BUTTON}>
          <ArrowLeft size={22} aria-hidden />
        </button>
        <h1 className="min-w-0 flex-1 truncate px-1 text-lg font-bold">{title}</h1>
        {onRename && (
          <button type="button" onClick={onRename} aria-label="Naam wijzigen" title="Naam wijzigen" className={ICON_BUTTON}>
            <Pencil size={20} aria-hidden />
          </button>
        )}
      </div>
    </header>
  );
}
