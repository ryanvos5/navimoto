// Gedeelde domeintypes voor Navimoto. Alle modules importeren vanuit '@/types'.

export type RiderType = 'street' | 'offroad' | 'allroad';
export type RouteStyle = 'avontuurlijk' | 'bochtig' | 'snel';
export type RouteKind = 'planned' | 'roundtrip' | 'gpx';
export type MapStyleId = 'osm' | 'topo' | 'cyclosm';

export interface AvoidOptions {
  ferries: boolean; // veerponten vermijden
  highways: boolean; // snelwegen vermijden
  tolls: boolean; // tolwegen vermijden
  unpaved: boolean; // onverharde wegen vermijden
}

export const DEFAULT_AVOID: AvoidOptions = { ferries: false, highways: false, tolls: false, unpaved: false };

export interface LatLng {
  lat: number;
  lon: number;
}

export interface Waypoint extends LatLng {
  name?: string;
}

/** Een GPS-positie van het toestel (of de simulator). */
export interface GeoPosition extends LatLng {
  accuracyM: number;
  headingDeg: number | null;
  speedKmh: number | null;
  altitudeM: number | null;
  t: number; // epoch ms
}

/** Een manoeuvre uit Valhalla, met indices in RouteResult.geometry (globaal, over alle legs heen). */
export interface Maneuver {
  type: number; // Valhalla maneuver type (1 = start, 4/5/6 = bestemming, 10 = rechts, 15 = links, ...)
  instruction: string; // "Sla rechtsaf naar Mariaplaats."
  verbalPre?: string; // gesproken instructie vlak voor de manoeuvre
  verbalPost?: string; // gesproken instructie na de manoeuvre ("300 meter doorgaan.")
  verbalAlert?: string; // vroege waarschuwing
  streetNames: string[];
  lengthKm: number; // lengte van het stuk na deze manoeuvre tot de volgende
  timeS: number;
  beginIndex: number; // index in geometry waar de manoeuvre plaatsvindt
  endIndex: number;
  bearingAfter?: number;
  roundaboutExitCount?: number;
}

export interface RouteResult {
  geometry: LatLng[]; // volledige lijn, legs aan elkaar geplakt (dubbele grenspunten verwijderd)
  distanceKm: number;
  durationS: number;
  maneuvers: Maneuver[];
  hasHighway: boolean;
  hasToll: boolean;
  hasFerry: boolean;
  /** Score voor bochtigheid (graden koersverandering per km), zie lib/geo curvatureScore. */
  curvature: number;
}

export interface RoutingOptions {
  style: RouteStyle;
  avoid: AvoidOptions;
  riderType: RiderType;
}

export interface RoundTripOptions extends RoutingOptions {
  start: LatLng;
  targetDistanceKm: number; // gewenste totale lengte van de lus
  seed?: number; // maakt de lus reproduceerbaar; anders willekeurig
  bearingDeg?: number; // voorkeursrichting; anders willekeurig
}

export interface SavedRoute {
  id: string;
  userId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  kind: RouteKind;
  waypoints: Waypoint[]; // start, via's, einde (bij gpx: begin en eind van het spoor)
  style: RouteStyle | null;
  avoid: AvoidOptions | null;
  geometry: LatLng[];
  distanceKm: number;
  durationS: number | null;
  maneuvers: Maneuver[] | null; // null voor gpx-import totdat map-matching is gedaan
  gpx: string | null; // oorspronkelijke GPX-tekst bij import
}

export interface TrackPoint extends LatLng {
  t: number; // epoch ms
  ele?: number;
  speedKmh?: number;
  headingDeg?: number;
}

export interface RiddenTrack {
  id: string;
  userId: string;
  name: string;
  startedAt: number;
  endedAt: number;
  points: TrackPoint[];
  distanceKm: number;
  durationS: number;
  movingS: number;
  avgSpeedKmh: number;
  maxSpeedKmh: number;
  routeId: string | null; // gekoppelde SavedRoute, als er langs een route is gereden
}

export interface UserProfile {
  id: string; // = AuthUser.id
  email: string;
  displayName: string;
  riderType: RiderType;
  defaultStyle: RouteStyle;
  defaultAvoid: AvoidOptions;
  voiceEnabled: boolean;
  mapStyle: MapStyleId;
  simulateRides: boolean; // demo-modus: rit simuleren i.p.v. echte GPS
  createdAt: number;
  updatedAt: number;
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  isGuest: boolean;
}

export const STYLE_LABELS: Record<RouteStyle, string> = {
  avontuurlijk: 'Avontuurlijk',
  bochtig: 'Bochtig',
  snel: 'Snel',
};

export const STYLE_DESCRIPTIONS: Record<RouteStyle, string> = {
  avontuurlijk: 'Kleine wegen, afwisselend landschap en (afhankelijk van je rijderstype) onverharde stukken.',
  bochtig: 'Zoveel mogelijk bochten en zo min mogelijk snelweg.',
  snel: 'De snelste route, snelwegen toegestaan.',
};

export const RIDER_LABELS: Record<RiderType, string> = {
  street: 'Street',
  offroad: 'Offroad',
  allroad: 'Allroad',
};

export const RIDER_DESCRIPTIONS: Record<RiderType, string> = {
  street: 'Alleen verharde wegen. Onverhard wordt altijd vermeden.',
  offroad: 'Zoekt actief onverharde wegen en paden op.',
  allroad: 'Een mix van verhard en onverhard.',
};

export const AVOID_LABELS: Record<keyof AvoidOptions, string> = {
  ferries: 'Veerponten',
  highways: 'Snelwegen',
  tolls: 'Tolwegen',
  unpaved: 'Onverharde wegen',
};

export const MAP_STYLE_LABELS: Record<MapStyleId, string> = {
  osm: 'Standaard',
  topo: 'Topografisch',
  cyclosm: 'CyclOSM',
};

export function defaultProfile(user: AuthUser, now: number): UserProfile {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    riderType: 'street',
    defaultStyle: 'bochtig',
    defaultAvoid: { ...DEFAULT_AVOID },
    voiceEnabled: true,
    mapStyle: 'osm',
    simulateRides: false,
    createdAt: now,
    updatedAt: now,
  };
}
