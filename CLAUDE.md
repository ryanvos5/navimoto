# Navimoto – architectuur en contracten

Navimoto is een mobile-first PWA (React 19 + TypeScript + Vite 7 + Tailwind v4 + MapLibre GL) voor
motorrijders, op basis van OpenStreetMap. Routing via de publieke Valhalla-server, zoeken via Photon,
reverse geocoding via Nominatim. Data lokaal in IndexedDB (Dexie); accounts lokaal of via Supabase.

**Taal:** alle UI-teksten in het Nederlands. Code, identifiers en commentaar mogen Engels of Nederlands zijn.

## Commando's

```bash
npm run dev         # vite dev server op http://localhost:5173
npm run typecheck   # tsc --noEmit (strict, noUnusedLocals, noUnusedParameters)
npm run test        # vitest run (node-omgeving; fake-indexeddb via src/test-setup.ts; jsdom beschikbaar per bestand met // @vitest-environment jsdom)
npm run build       # typecheck + vite build
```

## Conventies

- Path-alias `@/` → `src/`. Importeer domeintypes altijd uit `@/types`.
- Tailwind v4: geen `tailwind.config.js`. Thema-tokens staan in `src/index.css` (`@theme`): kleuren
  `brand`, `brand-strong`, `brand-soft`, `surface`, `surface-2`, `surface-3`, `surface-4`, `ink`, `muted`, `line`,
  `success`, `danger`, `warning`, `route`, `route-alt`, `track`. Gebruik ze als `bg-surface-2`, `text-muted`, `border-line`, enz.
  Donker thema is het enige thema.
- Pagina's in `src/pages/*` hebben een **default export**. Componenten/hooks/stores gebruiken named exports.
- Stores: zustand (`create`). Buiten React: `useX.getState()`.
- Alle effecten moeten StrictMode-veilig zijn (dubbele mount in dev): altijd opruimen (map.remove(), watchers clearen, abort controllers).
- Geen `any`. `noUnusedLocals`/`noUnusedParameters` staan aan: prefix ongebruikte parameters met `_`.
- Grote tikdoelen (min. 44px hoog) – de app wordt met handschoenen bediend.
- Meldingen: `useToast.getState().show('…', { type: 'success' | 'error' | 'info' })`.
- IDs: `newId()` uit `@/lib/geo`.
- Tijd: epoch ms (`Date.now()`).
- Geen console.log in productiecode (console.warn/error bij echte fouten mag).

## Gedeelde UI-primitieven (bestaan al, in `src/components/ui/`)

- `Button` (`variant`: primary|secondary|ghost|danger|outline, `size`: sm|md|lg, `loading`, `block`, `icon`), `IconButton` (`label` verplicht).
- `BottomSheet` (`open`, `onClose`, `title`, `height`: auto|half|full, `nonModal`, `footer`). Positioneert zich `absolute inset-0` in de dichtstbijzijnde `relative` parent.
- `Toggle` (`checked`, `onChange`, `label`, `description`).
- `Segmented<T>` (`value`, `onChange`, `options: {value,label,icon?,description?}[]`, `layout`: row|cards, `ariaLabel`).
- `TextField` (`label`, `hint`, `error`, `leading`, `trailing`, + input props; forwardRef).
- `Spinner` (`size`), `ToastViewport` (al gerenderd in App).
- Iconen: `lucide-react`.

## Routes (react-router v7, zie `src/App.tsx`)

| Pad | Pagina | Opmerking |
|---|---|---|
| `/login` | `pages/LoginPage` | inloggen / registreren / doorgaan als gast |
| `/kaart` | `pages/MapPage` (`props: { active: boolean }`) | blijft altijd gemount in TabLayout (verborgen via `invisible` als een andere tab actief is) |
| `/ritten` | `pages/RidesPage` | opgeslagen routes + gereden ritten, GPX-import |
| `/ritten/route/:id` | `pages/RouteDetailPage` | detail van een SavedRoute |
| `/ritten/rit/:id` | `pages/TrackDetailPage` | detail van een RiddenTrack |
| `/profiel` | `pages/ProfilePage` | account + rijderstype + voorkeuren |
| `/rijden` | `pages/NavigationPage` | fullscreen navigatie, zonder tabbalk; redirect naar `/kaart` als er geen actieve navigatie is |

`App.tsx` roept bij start `useAuth.getState().init()` aan en bij een ingelogde gebruiker
`useSettings.getState().load(user)` en `useRides.getState().load(user.id)`.

## Module-contracten

Hieronder de exacte exports waar andere modules op bouwen. Wijk niet af zonder de afnemers aan te passen.

### `src/lib/geo.ts` (bestaat al)
`haversineKm/haversineM`, `bearingDeg`, `angleDiff`, `destinationPoint(origin, bearingDeg, distanceKm)`,
`decodePolyline(str, precision=6)`, `encodePolyline`, `pathLengthKm`, `cumulativeKm`, `boundsOf`, `boundsCenter`,
`nearestPointOnPath(points, p, cumulative?, searchFrom?, searchTo?) → SnapResult|null` (`{index,t,point,distanceM,alongKm}`),
`curvatureScore(points)` (graden/km), `simplifyPath(points, toleranceM)`, `pointAlong(points, cumulative, distKm)`,
`seededRandom(seed)`, `newId()`, `isValidLatLng`, `normalizeLon`.

### `src/lib/format.ts`
```ts
formatDistance(km: number): string        // "850 m", "5,4 km", "12,3 km" (één decimaal onder 100 km), "123 km"
formatDuration(seconds: number): string   // "45 min", "1 u 20 min", "2 u"
formatSpeed(kmh: number | null): string   // "87 km/u", "– km/u"
formatDate(ts: number): string            // "17 sep 2026"
formatDateTime(ts: number): string        // "17 sep 2026, 14:05"
formatTime(ts: number): string            // "14:05"
formatEta(nowMs: number, remainingS: number): string // "14:05"
formatCoords(p: LatLng): string           // "52.09070, 5.12140"
```

### `src/lib/gpx.ts`
```ts
export class GpxError extends Error {}
export interface ParsedGpx {
  name: string | null;
  kind: 'track' | 'route' | 'waypoints';   // wat er primair in zat
  points: LatLng[];                         // de lijn (trkpt's van alle segmenten aaneen, of rtept's)
  trackPoints: TrackPoint[];                // zelfde punten met t (0 als er geen <time> was) en ele
  waypoints: Waypoint[];                    // <wpt> plus alle <rtept> met naam (ook naast een <trk>, zoals in onze eigen export)
  hasTimes: boolean;
}
export function parseGpx(text: string): ParsedGpx   // throws GpxError; werkt met DOMParser (browser + jsdom)
export function routeToGpx(route: SavedRoute): string   // <rte> met rtept per waypoint + <trk> met de geometrie
export function trackToGpx(track: RiddenTrack): string  // <trk> met trkpt incl. <time> en <ele>
export function gpxFileName(name: string): string       // veilige bestandsnaam, eindigt op .gpx
```

### `src/services/routing.ts` (Valhalla)
```ts
export class RoutingError extends Error { code: 'no_route' | 'network' | 'invalid' | 'server' | 'aborted' }
export function buildCostingOptions(options: RoutingOptions): Record<string, unknown>  // motorcycle costing_options
export function route(locations: Waypoint[], options: RoutingOptions, signal?: AbortSignal): Promise<RouteResult>
export function routeWithAlternatives(locations: Waypoint[], options: RoutingOptions, signal?: AbortSignal): Promise<RouteResult[]> // [beste, ...overige]
export function traceRoute(shape: LatLng[], options: RoutingOptions, signal?: AbortSignal): Promise<RouteResult> // map matching van een GPX-spoor
export function concatRoutes(a: RouteResult, b: RouteResult): RouteResult
export function parseValhallaTrip(trip: unknown): RouteResult  // legs aaneen, maneuver-indices globaal maken
```
- Eerste en laatste locatie: `type: "break"`; tussenliggende via-punten: `type: "through"` (geen tussenstop-manoeuvres).
- `units: "kilometers"`, `language: "nl-NL"`.
- Server: `import.meta.env.VITE_VALHALLA_URL || 'https://valhalla1.openstreetmap.de'`.
- Legs aaneen: het laatste punt van leg *i* is gelijk aan het eerste punt van leg *i+1* – verwijder dat dubbele punt en
  verschuif alle `begin_shape_index`/`end_shape_index` van latere legs. De "bestemming"-manoeuvre (type 4/5/6) aan het eind
  van een niet-laatste leg vervalt.
- Stijlkeuze bij alternatieven: `bochtig` en `avontuurlijk` vragen `alternates: 3` en kiezen de route met de hoogste
  `curvatureScore` (bij avontuurlijk: hoogste curvature, tie-break op langste); `snel` kiest de kortste tijd.
- `RouteResult.curvature` = `curvatureScore(geometry)`.

**Verified mapping stijl/rijder/vermijden → Valhalla `costing_options.motorcycle`:**

| | use_highways | use_tolls | use_trails | exclude_unpaved | overig |
|---|---|---|---|---|---|
| snel | 1.0 | 1.0 | 0.0 | (rider) | – |
| bochtig | 0.0 | 0.3 | 0.0 | (rider) | use_living_streets 0.3 |
| avontuurlijk | 0.0 | 0.2 | street 0.2 / allroad 0.6 / offroad 1.0 | (rider) | – |

Rijderstype: `street` → `exclude_unpaved: true`; `allroad` en `offroad` → `exclude_unpaved: false`. Het rijderstype beïnvloedt
`use_trails` **alleen bij avontuurlijk** (street 0.2 / allroad 0.6 / offroad 1.0, zie tabel); bij snel en bochtig blijft `use_trails` 0.0
ongeacht het rijderstype (offroad + snel is dus nog steeds de snelste route, alleen zonder uitsluiting van onverhard).
Vermijden (overschrijft): `ferries` → `use_ferry: 0, exclude_ferries: true`; `highways` → `use_highways: 0, exclude_highways: true`;
`tolls` → `use_tolls: 0, exclude_tolls: true`; `unpaved` → `exclude_unpaved: true`.
Als Valhalla met `exclude_*` fout 442 ("No path could be found") geeft, probeer dezelfde aanvraag opnieuw zonder de
`exclude_*`-vlaggen (alleen `use_* = 0`) en geef pas daarna `RoutingError('no_route')`.

**Verified Valhalla-feiten (17-09-2026, valhalla1.openstreetmap.de):** CORS `*`; POST `/route` en `/trace_route` met JSON-body;
antwoord `{ trip: { legs: [{ shape (polyline6), maneuvers: [...], summary }], summary: { length (km), time (s), has_toll, has_highway, has_ferry }, units, language }, alternates?: [{ trip }] }`;
maneuver-velden: `type, instruction, verbal_pre_transition_instruction, verbal_post_transition_instruction, verbal_transition_alert_instruction, street_names?, length (km), time (s), begin_shape_index, end_shape_index, bearing_after?, roundabout_exit_count?`;
fout: `{ error_code: 442, error: "No path could be found for input", status_code: 400 }`. Nederlandse instructies werken ("Sla rechtsaf naar Mariaplaats.").
`/trace_route` body: `{ shape: [{lat,lon}], costing: "motorcycle", shape_match: "map_snap", units, language, costing_options }` – vereenvoudig sporen tot max. ~1000 punten met `simplifyPath` (tolerantie oplopend 5→50 m tot het past).

### `src/services/roundtrip.ts`
```ts
export interface RoundTripResult { route: RouteResult; waypoints: Waypoint[]; seed: number; bearingDeg: number }
export function generateRoundTrip(opts: RoundTripOptions, signal?: AbortSignal): Promise<RoundTripResult>
```
Algoritme: kies (seeded) een richting; zet 2–3 via-punten op een ruwe driehoek/vierhoek rond de start (straal ≈ target / 7,5 – empirisch: de lus is ~7-8× de straal),
route `start → via… → start` (via's `type: "through"`), vergelijk lengte met doel, schaal straal max. 3× bij (factor doel/werkelijk)
en geef de dichtstbijzijnde. Andere `seed` → andere lus ("Opnieuw genereren").

### `src/services/geocoding.ts`
```ts
export interface GeoSearchResult { id: string; name: string; description: string; position: LatLng; type: string }
export function searchPlaces(query: string, near?: LatLng | null, signal?: AbortSignal): Promise<GeoSearchResult[]>
export function reverseGeocode(p: LatLng, signal?: AbortSignal): Promise<string>  // "Biltstraat, Utrecht"; fallback formatCoords
```
Photon: `GET https://photon.komoot.io/api/?q=…&limit=6&lat=…&lon=…` – **geen `lang`-parameter** (nl wordt niet ondersteund → 400).
Nominatim: `GET https://nominatim.openstreetmap.org/reverse?lat=…&lon=…&format=jsonv2&accept-language=nl&zoom=16`, max 1 verzoek/s; CORS ok.

### `src/services/db.ts` (Dexie)
```ts
export class NavimotoDb extends Dexie { profiles, routes, tracks, localUsers, kv }
export const db: NavimotoDb
```
Tabellen: `profiles` (id), `routes` (id, userId, updatedAt), `tracks` (id, userId, startedAt), `localUsers` (id, &email), `kv` (key).

### `src/services/auth/`
```ts
// types.ts
export interface AuthProvider {
  readonly name: 'local' | 'supabase';
  getSession(): Promise<AuthUser | null>;
  signUp(email: string, password: string, displayName: string): Promise<AuthUser>;
  signIn(email: string, password: string): Promise<AuthUser>;
  signOut(): Promise<void>;
  onAuthChange(cb: (user: AuthUser | null) => void): () => void;
}
export class AuthError extends Error { code: 'invalid_credentials' | 'email_in_use' | 'weak_password' | 'invalid_email' | 'network' | 'unknown' }
// index.ts
export const authProvider: AuthProvider   // supabase als VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY gezet zijn, anders local
export const GUEST_USER: AuthUser         // { id: 'guest', email: '', displayName: 'Gast', isGuest: true }
```
Local provider: wachtwoord-hash met PBKDF2 (Web Crypto, 100k iteraties, random salt) in `localUsers`; sessie in `localStorage` (`navimoto.session`).

### `src/store/useAuth.ts`
```ts
interface AuthState {
  user: AuthUser | null; status: 'loading' | 'signedOut' | 'signedIn'; error: string | null; providerName: 'local' | 'supabase';
  init(): Promise<void>; signIn(email, password): Promise<void>; signUp(email, password, displayName): Promise<void>;
  signOut(): Promise<void>; continueAsGuest(): Promise<void>; clearError(): void;
}
export const useAuth: UseBoundStore<StoreApi<AuthState>>
```
Fouten worden vertaald naar Nederlandse `error`-teksten; `signIn/signUp` gooien niet, ze zetten `error`.

### `src/store/useSettings.ts`
```ts
interface SettingsState { profile: UserProfile | null; load(user: AuthUser): Promise<void>; update(patch: Partial<UserProfile>): Promise<void>; clear(): void }
```
`load` maakt een profiel aan met `defaultProfile(user, Date.now())` als er nog geen is. Gastprofiel wordt ook bewaard (id 'guest').
Bij een bestaand profiel wordt `email` gelijkgetrokken met het account; `displayName` wordt alleen gevuld als het profiel nog geen naam
heeft, zodat een via `update({ displayName })` gewijzigde naam behouden blijft. Toon in de UI dus `profile.displayName`, niet `user.displayName`.

### `src/store/useRides.ts`
```ts
type NewRoute = Omit<SavedRoute, 'id' | 'userId' | 'createdAt' | 'updatedAt'> & { id?: string }
type NewTrack = Omit<RiddenTrack, 'id' | 'userId'> & { id?: string }
interface RidesState {
  routes: SavedRoute[]; tracks: RiddenTrack[]; loaded: boolean; userId: string | null;
  load(userId: string): Promise<void>; clear(): void;
  saveRoute(input: NewRoute): Promise<SavedRoute>; renameRoute(id, name): Promise<void>; deleteRoute(id): Promise<void>;
  saveTrack(input: NewTrack): Promise<RiddenTrack>; renameTrack(id, name): Promise<void>; deleteTrack(id): Promise<void>;
  getRoute(id): SavedRoute | undefined; getTrack(id): RiddenTrack | undefined;
}
```
Lijsten gesorteerd nieuwste eerst. `saveRoute` met bestaand `id` werkt bij (updatedAt).

### `src/store/useLocationStore.ts`
```ts
export const DEFAULT_CENTER: LatLng  // Utrecht { lat: 52.0907, lon: 5.1214 } – fallback als locatie onbekend is
interface LocationState {
  position: GeoPosition | null;
  status: 'idle' | 'requesting' | 'watching' | 'denied' | 'unavailable';
  error: string | null;
  simulated: boolean;                       // true = position komt van de simulator, echte GPS wordt genegeerd
  start(): void;                            // watchPosition starten (idempotent), enableHighAccuracy: true
  stop(): void;
  setSimulated(on: boolean): void;
  pushSimulatedPosition(p: GeoPosition): void;
}
export const useLocationStore
export function useCurrentPosition(): GeoPosition | null   // hook
```
Posities worden gefilterd: accuracy > 150 m negeren zodra er al een betere fix was; heading uit `coords.heading` of anders
berekend uit de vorige positie als er > 3 m is afgelegd; `speedKmh` uit `coords.speed` (m/s → km/u) of berekend.

### `src/lib/speech.ts`
```ts
export function isSpeechAvailable(): boolean
export function speak(text: string, opts?: { interrupt?: boolean }): void   // nl-NL stem als beschikbaar
export function cancelSpeech(): void
```
### `src/lib/wakelock.ts`
```ts
export function requestWakeLock(): Promise<() => void>   // no-op release als niet ondersteund
```

### `src/components/MapView.tsx` (MapLibre)
```tsx
export interface MapRouteLayer { id: string; geometry: LatLng[]; color?: string; width?: number; opacity?: number; dashed?: boolean }
export interface MapMarker { id: string; position: LatLng; kind: 'start' | 'via' | 'end' | 'search' | 'poi'; label?: string; draggable?: boolean }
export interface MapViewProps {
  className?: string;
  mapStyle?: MapStyleId;                 // 'osm' | 'topo' | 'cyclosm' (raster tiles)
  initialCenter?: LatLng; initialZoom?: number;
  routes?: MapRouteLayer[];
  markers?: MapMarker[];
  fitTo?: LatLng[] | null;               // bij verandering (referentie) → fitBounds met padding
  fitPadding?: { top: number; bottom: number; left: number; right: number };
  userPosition?: GeoPosition | null;     // toont blauwe stip + richtingskegel
  follow?: boolean;                      // camera volgt userPosition (met bearing + pitch)
  followZoom?: number; followPitch?: number;
  onClick?: (p: LatLng) => void;
  onLongPress?: (p: LatLng) => void;     // ≥ 500 ms ingedrukt, zonder beweging
  onMarkerDragEnd?: (id: string, p: LatLng) => void;
  onUserInteraction?: () => void;        // pan/zoom door de gebruiker (om follow uit te zetten)
  onMapReady?: (map: import('maplibre-gl').Map) => void;
}
export default function MapView(props: MapViewProps): JSX.Element
export const TILE_SOURCES: Record<MapStyleId, { tiles: string[]; attribution: string; maxzoom: number }>
```
Tiles (allemaal geverifieerd 200/png): OSM `https://tile.openstreetmap.org/{z}/{x}/{y}.png`,
OpenTopoMap `https://{a-c}.tile.opentopomap.org/{z}/{x}/{y}.png` (maxzoom 17), CyclOSM `https://{a-c}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png`.
Attributie verplicht: "© OpenStreetMap-bijdragers" (+ OpenTopoMap/CyclOSM waar van toepassing). Gebruik een `ResizeObserver` op de container en `map.resize()`.

### `src/store/useNavigation.ts` + `src/lib/navigation.ts` + `src/lib/rideBuilder.ts`
```ts
// lib/rideBuilder.ts
export function buildRideFromSavedRoute(saved: SavedRoute, from: LatLng | null, options: RoutingOptions, signal?: AbortSignal): Promise<RouteResult>
//  - planned/roundtrip met maneuvers en `from` binnen 300 m van het begin → opgeslagen geometrie/maneuvers hergebruiken
//  - anders: route([from ?? waypoints[0], ...waypoints], options)  (roundtrip: waypoints eindigen al op start)
//  - gpx (maneuvers null): traceRoute(geometry) en als `from` > 300 m van het begin: concatRoutes(route([from, begin]), matched)
// store/useNavigation.ts
export interface RideMeta { name: string; routeId: string | null; waypoints: Waypoint[]; style: RouteStyle | null; avoid: AvoidOptions | null }
interface NavigationState {
  active: boolean; route: RouteResult | null; meta: RideMeta | null;
  progress: { alongKm: number; remainingKm: number; remainingS: number; offRoute: boolean; nextManeuver: Maneuver | null; distanceToNextM: number; maneuverIndex: number } | null;
  recording: TrackPoint[]; startedAt: number | null; rerouting: boolean; arrived: boolean;
  start(route: RouteResult, meta: RideMeta): void;   // navigeer daarna naar '/rijden'
  stop(): Promise<RiddenTrack | null>;                // slaat de opname op via useRides.saveTrack als > 100 m gereden; reset state
  updatePosition(p: GeoPosition): void;               // wordt door NavigationPage aangeroepen bij elke positie
}
export const useNavigation
```
Navigatielogica (`lib/navigation.ts`, puur en getest): snappen met `nearestPointOnPath` in een venster rond de vorige index
(± 200 punten, met fallback over de hele lijn), off-route als > 60 m gedurende ≥ 3 opeenvolgende posities, volgende manoeuvre =
eerste manoeuvre met `beginIndex > snap.index` (of `beginIndex === snap.index` en t < 1), aankomst als binnen 30 m van het einde
of alongKm ≥ totaal − 0.03 km. Herberekening: `route([positie, ...resterende waypoints], options)`.
Spraak: bij ~300 m ("Over 300 meter …" = `verbalAlert` of `verbalPre`) en bij ~50 m (`verbalPre`), elk één keer per manoeuvre.
Simulatie (`profile.simulateRides`): NavigationPage laat een ticker lopen die met `pointAlong` over de route beweegt (~60 km/u,
instelbaar) en `useLocationStore.pushSimulatedPosition` aanroept.

## Bestandseigenaarschap tijdens de bouw

Wave 1 (fundament, parallel): `lib/format.ts`, `lib/gpx.ts` + tests | `services/routing.ts`, `services/roundtrip.ts`, `services/geocoding.ts` + tests |
`services/db.ts`, `services/auth/*`, `store/useAuth.ts`, `store/useSettings.ts`, `store/useRides.ts`, `supabase/schema.sql` + tests |
`store/useLocationStore.ts`, `lib/speech.ts`, `lib/wakelock.ts` + tests.

Wave 2 (UI, parallel): `components/MapView.tsx`, `pages/MapPage.tsx`, planner-componenten, `store/usePlanner.ts` |
`pages/NavigationPage.tsx`, `store/useNavigation.ts`, `lib/navigation.ts`, `lib/rideBuilder.ts` + tests |
`pages/RidesPage.tsx`, `pages/RouteDetailPage.tsx`, `pages/TrackDetailPage.tsx`, `components/RoutePreviewSvg.tsx` |
`pages/LoginPage.tsx`, `pages/ProfilePage.tsx`.
