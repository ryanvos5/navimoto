// Kaarttab: kaart met zoekbalk, locatie-/laagknoppen, 'Rijden'-knop en de planner-panelen.
// Eigenaar van de locatiewatch: start() bij mount, nooit stop() (andere pagina's lezen mee).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MapLibreMap } from 'maplibre-gl';
import type { LatLng, Waypoint } from '@/types';
import { formatCoords } from '@/lib/format';
import { reverseGeocode, type GeoSearchResult } from '@/services/geocoding';
import MapView, { type MapMarker, type MapPadding, type MapRouteLayer } from '@/components/MapView';
import { PlaceSheet } from '@/components/map/ContextSheet';
import { SHOP, SHOP_FOCUS_CENTER, SHOP_FOCUS_ZOOM, SHOP_MARKER, SHOP_OVERLAYS } from '@/lib/shop';
import { LayerPicker } from '@/components/map/LayerPicker';
import { LocateButton } from '@/components/map/LocateButton';
import { PickBanner } from '@/components/map/PickBanner';
import { PlanRouteSheet, type SearchTarget } from '@/components/map/PlanRouteSheet';
import { RideButton, RideMenuSheet } from '@/components/map/RideButton';
import { RoundTripSheet } from '@/components/map/RoundTripSheet';
import { RoutePreviewSheet } from '@/components/map/RoutePreviewSheet';
import { SearchBar, type SearchMode } from '@/components/map/SearchBar';
import { DEFAULT_CENTER, useLocationStore } from '@/store/useLocationStore';
import { usePlanner, waypointLabel, type PickTarget } from '@/store/usePlanner';
import { useSettings } from '@/store/useSettings';

export interface MapPageProps {
  active: boolean;
}

const INITIAL_ZOOM = 12;
const FIRST_FIX_ZOOM = 14;
const LOCATE_ZOOM = 15;
const SEARCH_ZOOM = 14;
/** Ruimte voor het voorbeeldpaneel onderaan en de zoekbalk bovenaan. */
const PREVIEW_PADDING: MapPadding = { top: 120, bottom: 360, left: 40, right: 40 };

const HOME_MARKER_ID = 'home';
/** Naam van de bestemming bij 'Naar huis' (en in de routenaam "Huidige locatie → Thuis"). */
const HOME_DESTINATION_NAME = 'Thuis';

interface ContextPlace {
  point: LatLng;
  label: string;
}

function homeLabel(home: Waypoint): string {
  return `Thuis · ${home.name || formatCoords(home)}`;
}

function samePoint(a: LatLng, b: LatLng): boolean {
  return a.lat === b.lat && a.lon === b.lon;
}

function toWaypoint(p: LatLng, name: string): Waypoint {
  return { lat: p.lat, lon: p.lon, name };
}

export default function MapPage({ active }: MapPageProps) {
  const mapRef = useRef<MapLibreMap | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const interacted = useRef(false);
  const flownToFix = useRef(false);
  const contextAbort = useRef<AbortController | null>(null);

  const [searchMode, setSearchMode] = useState<SearchMode>('free');
  const [focusToken, setFocusToken] = useState(0);
  const [searchResult, setSearchResult] = useState<GeoSearchResult | null>(null);
  const [resultSheetOpen, setResultSheetOpen] = useState(false);
  const [rideMenuOpen, setRideMenuOpen] = useState(false);
  const [context, setContext] = useState<ContextPlace | null>(null);

  const profile = useSettings((s) => s.profile);
  const mapStyle = profile?.mapStyle ?? 'osm';
  const home = profile?.home ?? null;
  const position = useLocationStore((s) => s.position);

  const mode = usePlanner((s) => s.mode);
  const start = usePlanner((s) => s.start);
  const destination = usePlanner((s) => s.destination);
  const vias = usePlanner((s) => s.vias);
  const pickTarget = usePlanner((s) => s.pickTarget);
  const result = usePlanner((s) => s.result);
  const resultWaypoints = usePlanner((s) => s.resultWaypoints);
  const previousMode = usePlanner((s) => s.previousMode);
  const planner = usePlanner.getState;

  const planning = mode === 'plan' || mode === 'roundtrip';
  const [initialCenter] = useState<LatLng>(() => useLocationStore.getState().position ?? DEFAULT_CENTER);

  // --- Locatiewatch en profielvoorkeuren -------------------------------------------------------------
  useEffect(() => {
    useLocationStore.getState().start();
  }, []);

  useEffect(() => {
    if (profile) planner().initFromProfile(profile);
  }, [profile, planner]);

  // Eerste fix: één keer naar de positie vliegen, tenzij de gebruiker de kaart al bewoog.
  useEffect(() => {
    if (!mapReady || !position || flownToFix.current) return;
    flownToFix.current = true;
    if (!interacted.current) mapRef.current?.flyTo({ center: [position.lon, position.lat], zoom: FIRST_FIX_ZOOM, duration: 1200 });
  }, [mapReady, position]);

  useEffect(() => {
    if (!active) setRideMenuOpen(false);
  }, [active]);

  useEffect(() => () => contextAbort.current?.abort(), []);

  // --- Helpers ----------------------------------------------------------------------------------------
  const flyTo = useCallback((p: LatLng, minZoom: number): void => {
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({ center: [p.lon, p.lat], zoom: Math.max(map.getZoom(), minZoom), duration: 800 });
  }, []);

  /** Zet een punt in de planner en haalt (niet-blokkerend) een plaatsnaam op. */
  const assignPoint = useCallback((target: Exclude<PickTarget, null>, p: LatLng, knownName?: string): void => {
    const s = planner();
    const w = toWaypoint(p, knownName ?? formatCoords(p));
    let viaIndex = -1;
    if (target === 'start') s.setStart(w);
    else if (target === 'destination') s.setDestination(w);
    else {
      s.addVia(w);
      viaIndex = planner().vias.length - 1;
    }
    if (knownName) return;
    void reverseGeocode(p).then((name) => {
      const now = planner();
      const named = toWaypoint(p, name);
      if (target === 'start' && now.start && samePoint(now.start, p)) now.setStart(named);
      else if (target === 'destination' && now.destination && samePoint(now.destination, p)) now.setDestination(named);
      else if (target === 'via') {
        const current = now.vias[viaIndex];
        if (current && samePoint(current, p)) now.updateVia(viaIndex, named);
      }
    });
  }, [planner]);

  const closePlaceSheets = useCallback((): void => {
    setResultSheetOpen(false);
    setContext(null);
    contextAbort.current?.abort();
  }, []);

  // --- Kaartgebeurtenissen ----------------------------------------------------------------------------
  const onMapClick = useCallback(
    (p: LatLng): void => {
      const target = planner().pickTarget;
      if (target) {
        assignPoint(target, p);
        return;
      }
      closePlaceSheets();
    },
    [assignPoint, closePlaceSheets, planner],
  );

  const onLongPress = useCallback((p: LatLng): void => {
    contextAbort.current?.abort();
    const controller = new AbortController();
    contextAbort.current = controller;
    setRideMenuOpen(false);
    setResultSheetOpen(false);
    setContext({ point: p, label: formatCoords(p) });
    void reverseGeocode(p, controller.signal).then((label) => {
      if (controller.signal.aborted) return;
      setContext((c) => (c && samePoint(c.point, p) ? { ...c, label } : c));
    });
  }, []);

  const onMarkerDragEnd = useCallback(
    (id: string, p: LatLng): void => {
      if (id === 'start') assignPoint('start', p);
      else if (id === 'destination') assignPoint('destination', p);
      else if (id.startsWith('via-')) {
        const index = Number(id.slice(4));
        const s = planner();
        if (!Number.isInteger(index) || !s.vias[index]) return;
        s.updateVia(index, toWaypoint(p, formatCoords(p)));
        void reverseGeocode(p).then((name) => {
          const now = planner();
          if (now.vias[index] && samePoint(now.vias[index], p)) now.updateVia(index, toWaypoint(p, name));
        });
      }
    },
    [assignPoint, planner],
  );

  const onUserInteraction = useCallback((): void => {
    interacted.current = true;
  }, []);

  const onMapReady = useCallback((map: MapLibreMap): void => {
    mapRef.current = map;
    setMapReady(true);
  }, []);

  // --- Zoeken -----------------------------------------------------------------------------------------
  const startSearch = useCallback((target: SearchTarget): void => {
    setSearchMode(target);
    setFocusToken((t) => t + 1);
  }, []);

  const onSearchSelect = useCallback(
    (r: GeoSearchResult, m: SearchMode): void => {
      if (m === 'free') {
        setContext(null);
        setSearchResult(r);
        setResultSheetOpen(true);
        flyTo(r.position, SEARCH_ZOOM);
        return;
      }
      assignPoint(m, r.position, r.name);
      setSearchMode('free');
    },
    [assignPoint, flyTo],
  );

  // --- Acties vanuit plek-panelen ---------------------------------------------------------------------
  const rideTo = useCallback(
    (p: LatLng, name: string): void => {
      const s = planner();
      if (s.mode !== 'plan') s.openPlan();
      planner().setDestination(toWaypoint(p, name));
      setSearchResult(null);
      closePlaceSheets();
    },
    [closePlaceSheets, planner],
  );

  const useAsStart = useCallback(
    (p: LatLng, name: string): void => {
      const s = planner();
      if (s.mode !== 'plan' && s.mode !== 'roundtrip') s.openPlan();
      planner().setStart(toWaypoint(p, name));
      setSearchResult(null);
      closePlaceSheets();
    },
    [closePlaceSheets, planner],
  );

  const useAsVia = useCallback(
    (p: LatLng, name: string): void => {
      planner().addVia(toWaypoint(p, name));
      setSearchResult(null);
      closePlaceSheets();
    },
    [closePlaceSheets, planner],
  );

  const locate = useCallback((): void => {
    const p = useLocationStore.getState().position;
    if (p) flyTo(p, LOCATE_ZOOM);
  }, [flyTo]);

  // --- Kaartinhoud ------------------------------------------------------------------------------------
  const markers = useMemo<MapMarker[]>(() => {
    const out: MapMarker[] = [];
    if (planning) {
      if (start) out.push({ id: 'start', position: start, kind: 'start', label: waypointLabel(start), draggable: true });
      if (mode === 'plan') {
        vias.forEach((v, i) => out.push({ id: `via-${i}`, position: v, kind: 'via', label: waypointLabel(v), draggable: true }));
        if (destination) out.push({ id: 'destination', position: destination, kind: 'end', label: waypointLabel(destination), draggable: true });
      }
    } else if (mode === 'preview' && resultWaypoints.length > 0) {
      const first = resultWaypoints[0];
      const last = resultWaypoints[resultWaypoints.length - 1];
      out.push({ id: 'start', position: first, kind: 'start', label: waypointLabel(first) });
      resultWaypoints.slice(1, -1).forEach((v, i) =>
        out.push({ id: `via-${i}`, position: v, kind: previousMode === 'roundtrip' ? 'poi' : 'via', label: waypointLabel(v) }),
      );
      if (!samePoint(first, last)) out.push({ id: 'destination', position: last, kind: 'end', label: waypointLabel(last) });
    }
    if (searchResult) out.push({ id: 'search', position: searchResult.position, kind: 'search', label: searchResult.name });
    if (home) out.push({ id: HOME_MARKER_ID, position: home, kind: 'home', label: homeLabel(home) });
    out.push(SHOP_MARKER);
    return out;
  }, [planning, mode, start, vias, destination, resultWaypoints, previousMode, searchResult, home]);

  const onMarkerClick = useCallback(
    (id: string): void => {
      if (id === HOME_MARKER_ID) {
        const h = useSettings.getState().profile?.home;
        if (!h) return;
        contextAbort.current?.abort();
        setResultSheetOpen(false);
        setRideMenuOpen(false);
        setContext({ point: { lat: h.lat, lon: h.lon }, label: homeLabel(h) });
        return;
      }
      if (id !== SHOP.id) return;
      contextAbort.current?.abort();
      setResultSheetOpen(false);
      setRideMenuOpen(false);
      // Uitgezoomd: eerst naar het pand vliegen, zodat je de locatie echt ziet.
      const map = mapRef.current;
      if (map && map.getZoom() < SHOP_FOCUS_ZOOM - 0.5) {
        map.flyTo({ center: [SHOP_FOCUS_CENTER.lon, SHOP_FOCUS_CENTER.lat], zoom: SHOP_FOCUS_ZOOM, duration: 1400 });
      }
      setContext({ point: SHOP.position, label: `${SHOP.name} · ${SHOP.address}` });
    },
    [],
  );

  /** 'Naar huis' uit het Rijden-menu: planner openen, thuis als bestemming en meteen berekenen. */
  const rideHome = useCallback((): void => {
    const h = useSettings.getState().profile?.home;
    setRideMenuOpen(false);
    if (!h) return;
    closePlaceSheets();
    const s = planner();
    s.openPlan();
    s.setDestination({ lat: h.lat, lon: h.lon, name: HOME_DESTINATION_NAME });
    // Start = huidige positie; zonder positie toont calculate() zelf de foutmelding (ERR_NO_LOCATION) en
    // blijft het planformulier open zodat je een startpunt kunt kiezen.
    void s.calculate();
  }, [closePlaceSheets, planner]);

  const routes = useMemo<MapRouteLayer[]>(
    () => (mode === 'preview' && result ? [{ id: 'preview', geometry: result.geometry }] : []),
    [mode, result],
  );
  const fitTo = useMemo<LatLng[] | null>(() => (mode === 'preview' && result ? result.geometry : null), [mode, result]);

  const sheetsVisible = searchMode === 'free' && pickTarget === null;
  const placeSheetOpen = sheetsVisible && ((resultSheetOpen && searchResult !== null) || context !== null);
  const place = context ?? (searchResult ? { point: searchResult.position, label: searchResult.name } : null);

  return (
    <div className="relative h-full w-full overflow-hidden bg-surface">
      <MapView
        mapStyle={mapStyle}
        initialCenter={initialCenter}
        initialZoom={INITIAL_ZOOM}
        routes={routes}
        markers={markers}
        overlays={SHOP_OVERLAYS}
        fitTo={fitTo}
        fitPadding={PREVIEW_PADDING}
        userPosition={position}
        onClick={onMapClick}
        onLongPress={onLongPress}
        onMarkerDragEnd={onMarkerDragEnd}
        onMarkerClick={onMarkerClick}
        onUserInteraction={onUserInteraction}
        onMapReady={onMapReady}
      />

      {/* Bovenkant: zoekbalk + kiesbanner */}
      <div className="safe-top pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-col gap-2 p-3">
        <div className="pointer-events-auto">
          <SearchBar
            mode={searchMode}
            near={position ?? initialCenter}
            focusToken={focusToken}
            onSelect={onSearchSelect}
            onCancelMode={() => setSearchMode('free')}
          />
        </div>
        {pickTarget && (
          <div className="pointer-events-auto">
            <PickBanner target={pickTarget} onCancel={() => planner().setPickTarget(null)} />
          </div>
        )}
      </div>

      {/* Rechts: locatie + kaartstijl */}
      <div className="absolute right-3 z-10 flex flex-col gap-2" style={{ top: 'calc(var(--safe-top) + 76px)' }}>
        <LocateButton onLocate={locate} />
        <LayerPicker value={mapStyle} onChange={(s) => void useSettings.getState().update({ mapStyle: s })} />
      </div>

      {/* Rechtsonder: Rijden */}
      {mode === 'idle' && !placeSheetOpen && (
        <div className="absolute bottom-9 right-3 z-10">
          <RideButton
            onClick={() => {
              closePlaceSheets();
              setRideMenuOpen(true);
            }}
          />
        </div>
      )}

      <RideMenuSheet
        open={rideMenuOpen}
        onClose={() => setRideMenuOpen(false)}
        onPlan={() => {
          setRideMenuOpen(false);
          planner().openPlan();
        }}
        onRoundTrip={() => {
          setRideMenuOpen(false);
          planner().openRoundTrip();
        }}
        homeName={home?.name || (home ? formatCoords(home) : undefined)}
        onHome={rideHome}
      />

      {sheetsVisible && <PlanRouteSheet open={mode === 'plan'} onSearch={startSearch} />}
      {sheetsVisible && <RoundTripSheet open={mode === 'roundtrip'} onSearch={startSearch} />}
      {sheetsVisible && <RoutePreviewSheet open={mode === 'preview'} />}

      {place && (
        <PlaceSheet
          open={placeSheetOpen}
          title={place.label}
          description={context ? undefined : searchResult?.description}
          showStart={context !== null || planning}
          showVia={mode === 'plan'}
          onClose={closePlaceSheets}
          onRideHere={() => rideTo(place.point, place.label)}
          onAsStart={() => useAsStart(place.point, place.label)}
          onAsVia={() => useAsVia(place.point, place.label)}
        />
      )}
    </div>
  );
}
