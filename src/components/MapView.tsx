// MapLibre-kaart met rasterlagen (OSM / OpenTopoMap / CyclOSM), routelijnen, markers, de eigen
// positie (stip + nauwkeurigheidscirkel + richtingskegel), volgmodus en lang-indrukken.
// Contract: zie CLAUDE.md, sectie "src/components/MapView.tsx".
import { useEffect, useRef, useState } from 'react';
import {
  MapLibreMap,
  Marker,
  type GeoJSONSource,
  type LayerSpecification,
  type PaddingOptions,
  type RasterSourceSpecification,
  type StyleSpecification,
} from 'maplibre-gl';
import type { Feature, LineString } from 'geojson';
import { Compass } from 'lucide-react';
import type { GeoPosition, LatLng, MapStyleId } from '@/types';
import { boundsOf, destinationPoint } from '@/lib/geo';

export interface MapRouteLayer {
  id: string;
  geometry: LatLng[];
  color?: string;
  width?: number;
  opacity?: number;
  dashed?: boolean;
}

export type MapMarkerKind = 'start' | 'via' | 'end' | 'search' | 'poi';

export interface MapMarker {
  id: string;
  position: LatLng;
  kind: MapMarkerKind;
  label?: string;
  draggable?: boolean;
}

export interface MapPadding {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface MapViewProps {
  className?: string;
  mapStyle?: MapStyleId;
  initialCenter?: LatLng;
  initialZoom?: number;
  routes?: MapRouteLayer[];
  markers?: MapMarker[];
  /** Bij verandering (referentie) van een niet-lege lijst → fitBounds met padding. */
  fitTo?: LatLng[] | null;
  fitPadding?: MapPadding;
  userPosition?: GeoPosition | null;
  /** 'dot' (standaard): blauwe stip met nauwkeurigheidscirkel; 'arrow': grote rode navigatiepijl in de rijrichting. */
  userMarker?: 'dot' | 'arrow';
  /** Camera volgt userPosition (met koers en pitch). */
  follow?: boolean;
  followZoom?: number;
  followPitch?: number;
  onClick?: (p: LatLng) => void;
  /** ≥ 500 ms ingedrukt zonder beweging. */
  onLongPress?: (p: LatLng) => void;
  onMarkerDragEnd?: (id: string, p: LatLng) => void;
  /** Pan/zoom/draai door de gebruiker (om follow uit te zetten). */
  onUserInteraction?: () => void;
  onMapReady?: (map: MapLibreMap) => void;
}

export interface TileSource {
  tiles: string[];
  attribution: string;
  maxzoom: number;
}

const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-bijdragers';

export const TILE_SOURCES: Record<MapStyleId, TileSource> = {
  osm: {
    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    attribution: OSM_ATTRIBUTION,
    maxzoom: 19,
  },
  topo: {
    tiles: ['a', 'b', 'c'].map((s) => `https://${s}.tile.opentopomap.org/{z}/{x}/{y}.png`),
    attribution: `${OSM_ATTRIBUTION} | &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)`,
    maxzoom: 17,
  },
  cyclosm: {
    tiles: ['a', 'b', 'c'].map((s) => `https://${s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png`),
    attribution: `${OSM_ATTRIBUTION} | <a href="https://www.cyclosm.org">CyclOSM</a>`,
    maxzoom: 20,
  },
};

/** Utrecht, zelfde fallback als useLocationStore.DEFAULT_CENTER (hier los om de store niet te importeren). */
const FALLBACK_CENTER: LatLng = { lat: 52.0907, lon: 5.1214 };
const DEFAULT_ZOOM = 12;
const DEFAULT_FOLLOW_ZOOM = 16;
const DEFAULT_FOLLOW_PITCH = 45;
const FIT_MAX_ZOOM = 15;
const FIT_DURATION_MS = 600;
const FOLLOW_DURATION_MS = 900;
const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_PX = 8;
const DEFAULT_ROUTE_COLOR = '#e2131d';
const DEFAULT_ROUTE_WIDTH = 6;
const CASING_COLOR = '#0b1220';
const RASTER_SOURCE_ID = 'tiles';
const RASTER_LAYER_ID = 'tiles';
const USER_COLOR = '#3b82f6';
/** Maximale straal van de nauwkeurigheidscirkel in pixels. */
const MAX_HALO_RADIUS_PX = 400;

function rasterSource(style: MapStyleId): RasterSourceSpecification {
  const src = TILE_SOURCES[style];
  return { type: 'raster', tiles: src.tiles, tileSize: 256, attribution: src.attribution, maxzoom: src.maxzoom };
}

function buildStyle(style: MapStyleId): StyleSpecification {
  return {
    version: 8,
    sources: { [RASTER_SOURCE_ID]: rasterSource(style) },
    layers: [{ id: RASTER_LAYER_ID, type: 'raster', source: RASTER_SOURCE_ID }],
  };
}

function toLngLat(p: LatLng): [number, number] {
  return [p.lon, p.lat];
}

function lineFeature(geometry: LatLng[]): Feature<LineString> {
  return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: geometry.map(toLngLat) } };
}

function routeIds(id: string): { source: string; casing: string; line: string } {
  return { source: `route-${id}`, casing: `route-${id}-casing`, line: `route-${id}-line` };
}

function routeLayers(r: MapRouteLayer): { casing: LayerSpecification; line: LayerSpecification } {
  const ids = routeIds(r.id);
  const width = r.width ?? DEFAULT_ROUTE_WIDTH;
  const opacity = r.opacity ?? 1;
  const layout = { 'line-join': 'round', 'line-cap': 'round' } as const;
  return {
    casing: {
      id: ids.casing,
      type: 'line',
      source: ids.source,
      layout,
      paint: { 'line-color': CASING_COLOR, 'line-width': width + 4, 'line-opacity': 0.6 * opacity },
    },
    line: {
      id: ids.line,
      type: 'line',
      source: ids.source,
      layout,
      paint: {
        'line-color': r.color ?? DEFAULT_ROUTE_COLOR,
        'line-width': width,
        'line-opacity': opacity,
        ...(r.dashed ? { 'line-dasharray': [2, 2] } : {}),
      },
    },
  };
}

function sameRouteStyle(a: MapRouteLayer, b: MapRouteLayer): boolean {
  return a.color === b.color && a.width === b.width && a.opacity === b.opacity && !!a.dashed === !!b.dashed;
}

// ---------------------------------------------------------------------------
// Marker-elementen
// ---------------------------------------------------------------------------

const FLAG_SVG =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="white" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-7.333-2A6 6 0 0 0 4 15"/></svg>';

function pinSvg(color: string): string {
  return `<svg width="32" height="40" viewBox="0 0 32 40" xmlns="http://www.w3.org/2000/svg"><path d="M16 39c8-11 14-17.5 14-24A14 14 0 0 0 2 15c0 6.5 6 13 14 24z" fill="${color}" stroke="white" stroke-width="2.5"/><circle cx="16" cy="15" r="5" fill="white"/></svg>`;
}

function circle(size: number, background: string, borderPx: number): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText = `width:${size}px;height:${size}px;border-radius:9999px;background:${background};border:${borderPx}px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;color:#fff;font:700 13px/1 Inter,system-ui,sans-serif;`;
  return el;
}

/** DOM-element voor een marker; `viaNumber` is het 1-gebaseerde nummer van een via-punt. */
export function createMarkerElement(kind: MapMarkerKind, viaNumber: number): HTMLElement {
  switch (kind) {
    case 'start':
      return circle(22, '#22c55e', 3);
    case 'via': {
      const el = circle(26, '#e2131d', 2);
      el.textContent = String(viaNumber);
      return el;
    }
    case 'end': {
      const el = circle(30, '#ef4444', 3);
      el.innerHTML = FLAG_SVG;
      return el;
    }
    case 'search': {
      const el = document.createElement('div');
      el.style.cssText = 'width:32px;height:40px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.5));';
      el.innerHTML = pinSvg('#e2131d');
      return el;
    }
    case 'poi':
      return circle(12, '#94a3b8', 2);
  }
}

function markerAnchor(kind: MapMarkerKind): 'center' | 'bottom' {
  return kind === 'search' ? 'bottom' : 'center';
}

interface UserElements {
  ground: HTMLDivElement; // halo + kegel + pijl (draait en kantelt mee met de kaart)
  halo: HTMLDivElement;
  cone: HTMLDivElement;
  arrow: HTMLDivElement;
  dot: HTMLDivElement;
}

function createUserElements(): UserElements {
  const ground = document.createElement('div');
  ground.style.cssText = 'position:relative;width:0;height:0;pointer-events:none;';
  const halo = document.createElement('div');
  halo.style.cssText = `position:absolute;left:0;top:0;width:0;height:0;transform:translate(-50%,-50%);border-radius:9999px;background:rgba(59,130,246,.16);border:1px solid rgba(59,130,246,.35);`;
  const cone = document.createElement('div');
  cone.style.cssText = 'position:absolute;left:-40px;top:-40px;width:80px;height:80px;display:none;';
  cone.innerHTML =
    '<svg width="80" height="80" viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="nm-cone" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b82f6" stop-opacity="0"/><stop offset="1" stop-color="#3b82f6" stop-opacity=".55"/></linearGradient></defs><path d="M40 40 L20 6 A40 40 0 0 1 60 6 Z" fill="url(#nm-cone)"/></svg>';
  // Navigatiepijl: rode chevron met witte rand, wijst naar "boven" (= rijrichting na setRotation).
  const arrow = document.createElement('div');
  arrow.style.cssText = 'position:absolute;left:-32px;top:-32px;width:64px;height:64px;display:none;filter:drop-shadow(0 3px 6px rgba(0,0,0,.55));';
  arrow.innerHTML =
    '<svg width="64" height="64" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><path d="M32 6 L54 52 L32 41 L10 52 Z" fill="#e2131d" stroke="#fff" stroke-width="4" stroke-linejoin="round"/></svg>';
  ground.append(halo, cone, arrow);
  const dot = document.createElement('div');
  dot.style.cssText = `width:18px;height:18px;border-radius:9999px;background:${USER_COLOR};border:3px solid #fff;box-shadow:0 0 0 2px rgba(59,130,246,.35),0 2px 6px rgba(0,0,0,.5);pointer-events:none;`;
  return { ground, halo, cone, arrow, dot };
}

/** Straal in pixels van `accuracyM` rond `p` bij de huidige zoom/projectie. */
function accuracyRadiusPx(map: MapLibreMap, p: LatLng, accuracyM: number): number {
  if (!Number.isFinite(accuracyM) || accuracyM <= 0) return 0;
  const center = map.project(toLngLat(p));
  const east = map.project(toLngLat(destinationPoint(p, 90, accuracyM / 1000)));
  return Math.min(MAX_HALO_RADIUS_PX, Math.hypot(east.x - center.x, east.y - center.y));
}

/** Padding die altijd in de kaart past (fitBounds gooit anders een fout). */
function safePadding(map: MapLibreMap, padding: MapPadding): PaddingOptions {
  const el = map.getContainer();
  const w = el.clientWidth;
  const h = el.clientHeight;
  const shrink = (a: number, b: number, total: number): [number, number] => {
    const room = Math.max(0, total - 40);
    if (a + b <= room) return [a, b];
    const f = room / Math.max(1, a + b);
    return [Math.floor(a * f), Math.floor(b * f)];
  };
  const [top, bottom] = shrink(padding.top, padding.bottom, h);
  const [left, right] = shrink(padding.left, padding.right, w);
  return { top, bottom, left, right };
}

const DEFAULT_FIT_PADDING: MapPadding = { top: 60, bottom: 60, left: 60, right: 60 };

interface AppliedMarker {
  marker: Marker;
  data: MapMarker;
  viaNumber: number;
}

/** Kaartcomponent. Container is `position: relative` en vult de ouder (h-full w-full). */
export default function MapView(props: MapViewProps) {
  const {
    className = '',
    mapStyle = 'osm',
    routes,
    markers,
    fitTo,
    fitPadding,
    userPosition,
    userMarker = 'dot',
    follow = false,
    followZoom,
    followPitch,
  } = props;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);
  const [rotated, setRotated] = useState(false);

  // Nieuwste props/callbacks voor de MapLibre-handlers (die maar één keer worden geregistreerd).
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });

  const appliedStyle = useRef<MapStyleId>(mapStyle);
  const appliedRoutes = useRef(new Map<string, MapRouteLayer>());
  const appliedMarkers = useRef(new Map<string, AppliedMarker>());
  const userRef = useRef<{ ground: Marker; dot: Marker; els: UserElements } | null>(null);
  const wasFollowing = useRef(false);
  const suppressClick = useRef(false);
  const dragging = useRef(false);

  // --- Kaart aanmaken (StrictMode-veilig: remove() in de cleanup) ---------------------------------
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const initial = latest.current;
    const center = initial.initialCenter ?? FALLBACK_CENTER;
    const map = new MapLibreMap({
      container: el,
      style: buildStyle(initial.mapStyle ?? 'osm'),
      center: toLngLat(center),
      zoom: initial.initialZoom ?? DEFAULT_ZOOM,
      attributionControl: { compact: true },
      maxPitch: 60,
    });
    appliedStyle.current = initial.mapStyle ?? 'osm';
    mapRef.current = map;

    map.on('load', () => {
      setReady(true);
      latest.current.onMapReady?.(map);
    });

    const onInteraction = (e: { originalEvent?: unknown }): void => {
      if (e.originalEvent) latest.current.onUserInteraction?.();
    };
    map.on('dragstart', onInteraction);
    map.on('wheel', onInteraction);
    map.on('pitchstart', onInteraction);
    map.on('rotatestart', onInteraction);
    map.on('zoomstart', onInteraction);
    map.on('dragstart', () => {
      dragging.current = true;
    });

    map.on('click', (e) => {
      if (suppressClick.current || dragging.current) {
        suppressClick.current = false;
        dragging.current = false;
        return;
      }
      latest.current.onClick?.({ lat: e.lngLat.lat, lon: e.lngLat.lng });
    });

    const updateRotated = (): void => {
      setRotated(Math.abs(map.getBearing()) > 0.5 || map.getPitch() > 0.5);
    };
    map.on('rotate', updateRotated);
    map.on('pitch', updateRotated);
    map.on('moveend', updateRotated);

    // Nauwkeurigheidscirkel meeschalen met de zoom.
    map.on('zoom', () => {
      const u = userRef.current;
      const p = latest.current.userPosition;
      if (!u || !p) return;
      const r = accuracyRadiusPx(map, p, p.accuracyM);
      u.els.halo.style.width = `${r * 2}px`;
      u.els.halo.style.height = `${r * 2}px`;
    });

    // Lang indrukken: 500 ms zonder beweging (> 8 px), niet op knoppen of markers.
    let timer: ReturnType<typeof setTimeout> | null = null;
    let startX = 0;
    let startY = 0;
    let pointers = 0;
    const cancel = (): void => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };
    const onPointerDown = (e: PointerEvent): void => {
      pointers += 1;
      suppressClick.current = false;
      dragging.current = false;
      cancel();
      if (pointers > 1) return;
      const target = e.target as Element | null;
      if (target?.closest('button, .maplibregl-marker, .maplibregl-ctrl')) return;
      startX = e.clientX;
      startY = e.clientY;
      timer = setTimeout(() => {
        timer = null;
        const rect = el.getBoundingClientRect();
        const ll = map.unproject([startX - rect.left, startY - rect.top]);
        suppressClick.current = true;
        latest.current.onLongPress?.({ lat: ll.lat, lon: ll.lng });
      }, LONG_PRESS_MS);
    };
    const onPointerMove = (e: PointerEvent): void => {
      if (timer === null) return;
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > LONG_PRESS_MOVE_PX) cancel();
    };
    const onPointerEnd = (): void => {
      pointers = Math.max(0, pointers - 1);
      cancel();
    };
    const onContextMenu = (e: Event): void => e.preventDefault();
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerEnd);
    el.addEventListener('pointercancel', onPointerEnd);
    el.addEventListener('contextmenu', onContextMenu);

    const observer = new ResizeObserver(() => map.resize());
    observer.observe(el);

    return () => {
      observer.disconnect();
      cancel();
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerEnd);
      el.removeEventListener('pointercancel', onPointerEnd);
      el.removeEventListener('contextmenu', onContextMenu);
      appliedRoutes.current.clear();
      appliedMarkers.current.clear();
      userRef.current = null;
      wasFollowing.current = false;
      mapRef.current = null;
      setReady(false);
      map.remove();
    };
  }, []);

  // --- Kaartstijl wisselen: rasterbron/-laag ter plekke vervangen, routes/markers blijven ---------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || appliedStyle.current === mapStyle) return;
    appliedStyle.current = mapStyle;
    const firstOther = map.getStyle().layers.find((l) => l.id !== RASTER_LAYER_ID)?.id;
    if (map.getLayer(RASTER_LAYER_ID)) map.removeLayer(RASTER_LAYER_ID);
    if (map.getSource(RASTER_SOURCE_ID)) map.removeSource(RASTER_SOURCE_ID);
    map.addSource(RASTER_SOURCE_ID, rasterSource(mapStyle));
    map.addLayer({ id: RASTER_LAYER_ID, type: 'raster', source: RASTER_SOURCE_ID }, firstOther);
  }, [mapStyle, ready]);

  // --- Routes (diff op id) --------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const wanted = new Map<string, MapRouteLayer>();
    for (const r of routes ?? []) wanted.set(r.id, r);
    const applied = appliedRoutes.current;

    for (const [id] of applied) {
      if (wanted.has(id)) continue;
      const ids = routeIds(id);
      if (map.getLayer(ids.line)) map.removeLayer(ids.line);
      if (map.getLayer(ids.casing)) map.removeLayer(ids.casing);
      if (map.getSource(ids.source)) map.removeSource(ids.source);
      applied.delete(id);
    }

    for (const [id, r] of wanted) {
      const ids = routeIds(id);
      const prev = applied.get(id);
      if (prev === r) continue;
      if (prev && map.getSource(ids.source) && sameRouteStyle(prev, r)) {
        if (prev.geometry !== r.geometry) map.getSource<GeoJSONSource>(ids.source)?.setData(lineFeature(r.geometry));
        applied.set(id, r);
        continue;
      }
      if (map.getLayer(ids.line)) map.removeLayer(ids.line);
      if (map.getLayer(ids.casing)) map.removeLayer(ids.casing);
      if (map.getSource(ids.source)) map.removeSource(ids.source);
      map.addSource(ids.source, { type: 'geojson', data: lineFeature(r.geometry) });
      const layers = routeLayers(r);
      map.addLayer(layers.casing);
      map.addLayer(layers.line);
      applied.set(id, r);
    }
  }, [routes, ready]);

  // --- Markers (diff op id) -------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const applied = appliedMarkers.current;
    const wanted = new Map<string, { data: MapMarker; viaNumber: number }>();
    let via = 0;
    for (const m of markers ?? []) {
      if (m.kind === 'via') via += 1;
      wanted.set(m.id, { data: m, viaNumber: via });
    }

    for (const [id, a] of applied) {
      if (wanted.has(id)) continue;
      a.marker.remove();
      applied.delete(id);
    }

    for (const [id, { data, viaNumber }] of wanted) {
      const prev = applied.get(id);
      if (prev && prev.data.kind === data.kind && prev.viaNumber === viaNumber) {
        if (prev.data.position.lat !== data.position.lat || prev.data.position.lon !== data.position.lon) {
          prev.marker.setLngLat(toLngLat(data.position));
        }
        if (!!prev.data.draggable !== !!data.draggable) prev.marker.setDraggable(!!data.draggable);
        if (prev.data.label !== data.label) prev.marker.getElement().title = data.label ?? '';
        prev.data = data;
        continue;
      }
      prev?.marker.remove();
      const element = createMarkerElement(data.kind, viaNumber);
      if (data.label) element.title = data.label;
      const marker = new Marker({ element, anchor: markerAnchor(data.kind), draggable: !!data.draggable })
        .setLngLat(toLngLat(data.position))
        .addTo(map);
      marker.on('dragstart', () => {
        dragging.current = true;
      });
      marker.on('dragend', () => {
        const ll = marker.getLngLat();
        const entry = applied.get(id);
        if (entry) entry.data = { ...entry.data, position: { lat: ll.lat, lon: ll.lng } };
        latest.current.onMarkerDragEnd?.(id, { lat: ll.lat, lon: ll.lng });
        // De click die de sleepactie afsluit negeren.
        setTimeout(() => {
          dragging.current = false;
        }, 0);
      });
      applied.set(id, { marker, data, viaNumber });
    }
  }, [markers, ready]);

  // --- Eigen positie ----------------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (!userPosition) {
      if (userRef.current) {
        userRef.current.ground.remove();
        userRef.current.dot.remove();
        userRef.current = null;
      }
      return;
    }
    let u = userRef.current;
    if (!u) {
      const els = createUserElements();
      const ground = new Marker({ element: els.ground, anchor: 'center', rotationAlignment: 'map', pitchAlignment: 'map' });
      const dot = new Marker({ element: els.dot, anchor: 'center' });
      u = { ground, dot, els };
      userRef.current = u;
      ground.setLngLat(toLngLat(userPosition)).addTo(map);
      dot.setLngLat(toLngLat(userPosition)).addTo(map);
    } else {
      u.ground.setLngLat(toLngLat(userPosition));
      u.dot.setLngLat(toLngLat(userPosition));
    }
    const arrowMode = userMarker === 'arrow';
    const r = accuracyRadiusPx(map, userPosition, userPosition.accuracyM);
    u.els.halo.style.width = `${r * 2}px`;
    u.els.halo.style.height = `${r * 2}px`;
    u.els.halo.style.display = arrowMode ? 'none' : 'block';
    u.els.dot.style.display = arrowMode ? 'none' : 'block';
    if (userPosition.headingDeg !== null) u.ground.setRotation(userPosition.headingDeg);
    // Zonder koers: stip tonen (pijl zou een willekeurige richting suggereren).
    const hasHeading = userPosition.headingDeg !== null;
    u.els.cone.style.display = !arrowMode && hasHeading ? 'block' : 'none';
    u.els.arrow.style.display = arrowMode && hasHeading ? 'block' : 'none';
    if (arrowMode && !hasHeading) u.els.dot.style.display = 'block';
  }, [userPosition, userMarker, ready]);

  // --- Volgmodus --------------------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (!follow) {
      wasFollowing.current = false;
      return;
    }
    if (!userPosition) return;
    const target = {
      center: toLngLat(userPosition),
      bearing: userPosition.headingDeg ?? map.getBearing(),
      pitch: followPitch ?? DEFAULT_FOLLOW_PITCH,
      zoom: followZoom ?? DEFAULT_FOLLOW_ZOOM,
    };
    if (!wasFollowing.current) map.jumpTo(target);
    else map.easeTo({ ...target, duration: FOLLOW_DURATION_MS });
    wasFollowing.current = true;
  }, [userPosition, follow, followZoom, followPitch, ready]);

  // --- fitTo ------------------------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !fitTo || fitTo.length === 0) return;
    const b = boundsOf(fitTo);
    if (!b) return;
    map.fitBounds([b.minLon, b.minLat, b.maxLon, b.maxLat], {
      padding: safePadding(map, fitPadding ?? DEFAULT_FIT_PADDING),
      maxZoom: FIT_MAX_ZOOM,
      duration: FIT_DURATION_MS,
    });
    // Alleen bij een nieuwe lijst (referentie); fitPadding hoort bij die lijst.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitTo, ready]);

  const resetNorth = (): void => {
    mapRef.current?.easeTo({ bearing: 0, pitch: 0, duration: 400 });
  };

  return (
    <div ref={containerRef} className={`relative h-full w-full overflow-hidden bg-surface ${className}`}>
      {rotated && (
        <button
          type="button"
          onClick={resetNorth}
          aria-label="Kaart naar het noorden draaien"
          title="Naar het noorden"
          className="absolute left-3 z-10 flex h-11 w-11 items-center justify-center rounded-full border border-line bg-surface-2/90 text-ink shadow-md backdrop-blur"
          style={{ top: 'calc(var(--safe-top) + 76px)' }}
        >
          <Compass size={22} aria-hidden />
        </button>
      )}
    </div>
  );
}
