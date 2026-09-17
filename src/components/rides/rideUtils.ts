// Kleine hulpfuncties en labels voor de Ritten-tab (lijst + detailpagina's).
import { SHOP_MARKER } from '@/lib/shop';
import {
  AVOID_LABELS,
  DEFAULT_AVOID,
  type AvoidOptions,
  type LatLng,
  type RouteKind,
  type RouteStyle,
  type RoutingOptions,
  type SavedRoute,
  type UserProfile,
  type Waypoint,
} from '@/types';
import { haversineM } from '@/lib/geo';

export const ROUTE_KIND_LABELS: Record<RouteKind, string> = {
  planned: 'Gepland',
  roundtrip: 'Rondreis',
  gpx: 'GPX',
};

/** Link die eruitziet als een primaire knop (react-router Link kan geen <button> zijn). */
export const LINK_BUTTON_CLASS =
  'inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-brand px-4 font-semibold text-white shadow-lg shadow-brand/20 transition-colors hover:bg-brand-strong active:bg-brand-strong';

/** Padding voor fitBounds op de detailkaart (markers niet tegen de rand). */
export const DETAIL_FIT_PADDING = { top: 40, bottom: 40, left: 40, right: 40 };

/** "Snelwegen, Tolwegen" of "Niets". */
export function avoidSummary(avoid: AvoidOptions | null): string {
  if (!avoid) return 'Niets';
  const active = (Object.keys(AVOID_LABELS) as Array<keyof AvoidOptions>).filter((k) => avoid[k]).map((k) => AVOID_LABELS[k]);
  return active.length > 0 ? active.join(', ') : 'Niets';
}

/** Routeopties voor het rijden: route-instellingen, anders profielvoorkeuren, anders de standaard. */
export function routingOptionsFor(
  profile: UserProfile | null,
  style: RouteStyle | null = null,
  avoid: AvoidOptions | null = null,
): RoutingOptions {
  return {
    style: style ?? profile?.defaultStyle ?? 'bochtig',
    avoid: avoid ?? profile?.defaultAvoid ?? DEFAULT_AVOID,
    riderType: profile?.riderType ?? 'street',
  };
}

/** Nederlandse foutmelding uit een gevangen fout, met terugval. */
export function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/** Structureel gelijk aan MapMarker uit components/MapView (subset van kinds). */
export interface DetailMarker {
  id: string;
  position: LatLng;
  kind: 'start' | 'via' | 'end' | 'shop';
  label?: string;
}

function marker(id: string, w: Waypoint, kind: DetailMarker['kind']): DetailMarker {
  const m: DetailMarker = { id, position: { lat: w.lat, lon: w.lon }, kind };
  if (w.name) m.label = w.name;
  return m;
}

/**
 * Markers voor [start, ...via's, einde]. Het eindpunt wordt weggelaten als het (vrijwel) samenvalt met het
 * beginpunt (rondrit), anders liggen twee markers over elkaar.
 */
export function lineMarkers(anchors: Waypoint[]): DetailMarker[] {
  if (anchors.length === 0) return [SHOP_MARKER];
  const start = anchors[0];
  const end = anchors[anchors.length - 1];
  const out: DetailMarker[] = [marker('start', start, 'start')];
  anchors.slice(1, -1).forEach((w, i) => out.push(marker(`via-${i}`, w, 'via')));
  if (anchors.length > 1 && haversineM(start, end) >= 5) out.push(marker('end', end, 'end'));
  out.push(SHOP_MARKER);
  return out;
}

/** De ankerpunten van een route: de waypoints, of anders begin en eind van de geometrie. */
export function routeAnchors(route: SavedRoute): Waypoint[] {
  if (route.waypoints.length >= 2) return route.waypoints;
  const g = route.geometry;
  if (g.length === 0) return route.waypoints;
  return g.length === 1 ? [g[0]] : [g[0], g[g.length - 1]];
}
