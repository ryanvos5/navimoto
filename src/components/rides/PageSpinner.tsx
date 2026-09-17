import { Spinner } from '@/components/ui/Spinner';

/** Gecentreerde spinner die de hele pagina vult (zolang de ritten nog laden). */
export function PageSpinner() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <Spinner size="lg" />
    </div>
  );
}
