// Kaartje in de Ritten-lijst: thumbnail, naam, badge, meta-regel en chevron. Hele kaart is een Link.
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import type { LatLng, RiddenTrack, SavedRoute } from '@/types';
import { formatDate, formatDistance, formatDuration, formatSpeed } from '@/lib/format';
import { RoutePreviewSvg } from '@/components/RoutePreviewSvg';
import { ROUTE_KIND_LABELS } from './rideUtils';

export type RideListItemProps = { route: SavedRoute } | { track: RiddenTrack };

interface Card {
  to: string;
  geometry: LatLng[];
  color: string;
  name: string;
  badge: string;
  meta: string;
}

function routeCard(route: SavedRoute): Card {
  const parts = [formatDistance(route.distanceKm)];
  if (route.durationS !== null) parts.push(formatDuration(route.durationS));
  return {
    to: `/ritten/route/${route.id}`,
    geometry: route.geometry,
    color: 'var(--color-route)',
    name: route.name,
    badge: ROUTE_KIND_LABELS[route.kind],
    meta: parts.join(' · '),
  };
}

function trackCard(track: RiddenTrack): Card {
  return {
    to: `/ritten/rit/${track.id}`,
    geometry: track.points,
    color: 'var(--color-track)',
    name: track.name,
    badge: formatDate(track.startedAt),
    meta: [formatDistance(track.distanceKm), formatDuration(track.durationS), `Ø ${formatSpeed(track.avgSpeedKmh)}`].join(' · '),
  };
}

export function RideListItem(props: RideListItemProps) {
  const card = 'route' in props ? routeCard(props.route) : trackCard(props.track);
  return (
    <Link
      to={card.to}
      className="flex min-h-[88px] items-center gap-3 rounded-2xl border border-line bg-surface-2 p-3 transition-colors hover:bg-surface-3 active:bg-surface-3"
    >
      <RoutePreviewSvg geometry={card.geometry} color={card.color} className="shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{card.name}</span>
        <span className="mt-1 inline-block rounded-full bg-surface-3 px-2 py-0.5 text-xs font-medium text-muted">{card.badge}</span>
        <span className="mt-1 block truncate text-sm text-muted">{card.meta}</span>
      </span>
      <ChevronRight size={20} className="shrink-0 text-muted" aria-hidden />
    </Link>
  );
}
