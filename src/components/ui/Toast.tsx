import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { useToast } from '@/store/useToast';

const STYLE = {
  info: 'border-line bg-surface-3 text-ink',
  success: 'border-success/40 bg-success/15 text-ink',
  error: 'border-danger/40 bg-danger/15 text-ink',
} as const;

const ICON = { info: Info, success: CheckCircle2, error: AlertCircle } as const;

/** Render eenmaal in App; toont meldingen uit useToast. */
export function ToastViewport() {
  const toasts = useToast((s) => s.toasts);
  const dismiss = useToast((s) => s.dismiss);
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex flex-col items-center gap-2 px-4 pt-[calc(var(--safe-top)+12px)]" aria-live="polite">
      {toasts.map((t) => {
        const Icon = ICON[t.type];
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => dismiss(t.id)}
            className={`pointer-events-auto flex max-w-md items-center gap-2 rounded-xl border px-4 py-3 text-sm shadow-lg backdrop-blur ${STYLE[t.type]}`}
          >
            <Icon size={18} className="shrink-0" aria-hidden />
            <span>{t.message}</span>
          </button>
        );
      })}
    </div>
  );
}
