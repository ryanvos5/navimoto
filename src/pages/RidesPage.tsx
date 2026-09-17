// Ritten-tab: opgeslagen routes en gereden ritten, met GPX-import. De gekozen lijst staat in ?tab=gereden.
import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Bike, Bookmark, History, Map as MapIcon, Route as RouteIcon } from 'lucide-react';
import { Segmented } from '@/components/ui/Segmented';
import { EmptyState } from '@/components/rides/EmptyState';
import { ImportGpxButton } from '@/components/rides/ImportGpxButton';
import { PageSpinner } from '@/components/rides/PageSpinner';
import { RideListItem } from '@/components/rides/RideListItem';
import { LINK_BUTTON_CLASS } from '@/components/rides/rideUtils';
import { useRides } from '@/store/useRides';

type Tab = 'opgeslagen' | 'gereden';

function tabFromParam(value: string | null): Tab {
  return value === 'gereden' ? 'gereden' : 'opgeslagen';
}

export default function RidesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = tabFromParam(searchParams.get('tab'));
  const routes = useRides((s) => s.routes);
  const tracks = useRides((s) => s.tracks);
  const loaded = useRides((s) => s.loaded);

  const setTab = (next: Tab): void => {
    setSearchParams(next === 'gereden' ? { tab: 'gereden' } : {}, { replace: true });
  };

  let content: ReactNode;
  if (!loaded) {
    content = <PageSpinner />;
  } else if (tab === 'opgeslagen') {
    content =
      routes.length === 0 ? (
        <EmptyState
          icon={<RouteIcon size={30} aria-hidden />}
          title="Nog geen opgeslagen routes"
          description="Plan een route op de Kaart-tab of importeer een GPX-bestand."
          action={
            <>
              <Link to="/kaart" className={LINK_BUTTON_CLASS}>
                <MapIcon size={18} aria-hidden />
                Naar de kaart
              </Link>
              <ImportGpxButton />
            </>
          }
        />
      ) : (
        <ul className="flex flex-col gap-2 p-4 pb-8">
          {routes.map((route) => (
            <li key={route.id}>
              <RideListItem route={route} />
            </li>
          ))}
        </ul>
      );
  } else {
    content =
      tracks.length === 0 ? (
        <EmptyState
          icon={<Bike size={30} aria-hidden />}
          title="Nog geen gereden ritten"
          description="Start een rit vanaf de kaart; je rit wordt automatisch opgeslagen."
          action={
            <Link to="/kaart" className={LINK_BUTTON_CLASS}>
              <MapIcon size={18} aria-hidden />
              Naar de kaart
            </Link>
          }
        />
      ) : (
        <ul className="flex flex-col gap-2 p-4 pb-8">
          {tracks.map((track) => (
            <li key={track.id}>
              <RideListItem track={track} />
            </li>
          ))}
        </ul>
      );
  }

  return (
    <div className="relative flex h-full flex-col bg-surface">
      <header className="safe-top shrink-0 border-b border-line bg-surface-2/95 backdrop-blur">
        <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-3">
          <h1 className="text-2xl font-bold">Ritten</h1>
          <ImportGpxButton />
        </div>
        <div className="px-4 pb-3">
          <Segmented<Tab>
            value={tab}
            onChange={setTab}
            ariaLabel="Lijst kiezen"
            options={[
              { value: 'opgeslagen', label: `Opgeslagen (${routes.length})`, icon: <Bookmark size={16} aria-hidden /> },
              { value: 'gereden', label: `Gereden (${tracks.length})`, icon: <History size={16} aria-hidden /> },
            ]}
          />
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{content}</div>
    </div>
  );
}
