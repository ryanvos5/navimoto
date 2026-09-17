import { CircleCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';

export interface ArrivedBannerProps {
  /** Naam van de rit (wordt onder de kop getoond). */
  name: string;
  finishing: boolean;
  onFinish: () => void;
}

/** Vervangt de manoeuvrebanner zodra de bestemming is bereikt. */
export function ArrivedBanner({ name, finishing, onFinish }: ArrivedBannerProps) {
  return (
    <section aria-live="polite" className="rounded-3xl border border-success/50 bg-surface-2/95 p-4 shadow-2xl backdrop-blur">
      <div className="flex items-center gap-4">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-success text-white shadow-lg shadow-success/30">
          <CircleCheck size={52} strokeWidth={2.5} aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-black leading-tight">Je bent aangekomen</h1>
          <p className="mt-1 truncate text-base text-muted">{name}</p>
        </div>
      </div>
      <Button size="lg" block className="mt-4" loading={finishing} onClick={onFinish}>
        Rit afronden
      </Button>
    </section>
  );
}
