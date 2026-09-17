// Vaste locatie van Vos Oss Motoren: het pand als afbeelding op de plattegrond + een logo-badge.
import type { LatLng } from '@/types';

export const SHOP = {
  id: 'shop-vos-oss',
  name: 'Vos Oss Motoren',
  address: 'Singel 1940-1945 320a, 5348 PV Oss',
  /** Ingang / OSM-punt van de winkel. */
  position: { lat: 51.7741699, lon: 5.5517858 } as LatLng,
  imageUrl: `${import.meta.env.BASE_URL}brand/pand.png`,
  logoUrl: `${import.meta.env.BASE_URL}brand/voss-logo.png`,
} as const;

/**
 * Plattegrond van het pand (OSM way 289062112): bbox 51.774081–51.774669 N, 5.551255–5.551932 O.
 * De 3D-tekening staat met de onderrand op de zuidkant van het gebouw en de breedte over de hele plattegrond.
 */
export const SHOP_FOOTPRINT = {
  south: 51.77408,
  north: 51.77467,
  west: 5.551255,
  east: 5.551932,
} as const;

/** Overlay-definitie voor MapView: de tekening van het pand, meeschalend met de kaart. */
export const SHOP_OVERLAY = {
  id: 'shop-vos-oss-pand',
  url: `${SHOP.imageUrl}?v=4`,
  /** Zuid-midden van de tekening (onderrand van het pand). */
  anchor: { lat: 51.77400, lon: (SHOP_FOOTPRINT.west + SHOP_FOOTPRINT.east) / 2 } as LatLng,
  /** Breedte van de tekening in meters (iets breder dan de plattegrond vanwege het 3D-perspectief). */
  widthM: 92,
  rotationDeg: 0,
  minzoom: 14,
};

/** Logo-badge op het dak van de hal in de 3D-tekening (structureel gelijk aan MapMarker met kind 'shop'). */
export const SHOP_MARKER = {
  id: SHOP.id,
  position: { lat: 51.77427, lon: 5.55175 } as LatLng,
  kind: 'shop' as const,
  label: `${SHOP.name} – ${SHOP.address}`,
};

/** Zoomniveau waarop de kaart naar het pand vliegt als je op het logo tikt. */
export const SHOP_FOCUS_ZOOM = 17.2;
export const SHOP_FOCUS_CENTER: LatLng = { lat: 51.77430, lon: 5.55165 };

export const SHOP_OVERLAYS = [SHOP_OVERLAY];
