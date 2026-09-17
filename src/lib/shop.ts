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
  /** Gespiegelde tekening (ronde deel links) zodat hij na 90 graden draaien op de plattegrond past. */
  url: `${SHOP.imageUrl}?v=3`,
  /** Anker = midden van de oostgevel; de onderrand van de tekening komt na het draaien op de oostkant te liggen. */
  anchor: { lat: 51.77437, lon: 5.55196 } as LatLng,
  /** Breedte van de tekening in meters (= noord-zuidlengte van het pand na het draaien). */
  widthM: 78,
  /** 90 graden tegen de klok in: hal noord-zuid, ronde glaspartij aan de zuidkant, aanbouw noordwest. */
  rotationDeg: -90,
  minzoom: 14,
};

/** Logo-badge naast het pand (structureel gelijk aan MapMarker met kind 'shop'). */
export const SHOP_MARKER = {
  id: SHOP.id,
  position: { lat: SHOP_FOOTPRINT.north + 0.00004, lon: (SHOP_FOOTPRINT.west + SHOP_FOOTPRINT.east) / 2 } as LatLng,
  kind: 'shop' as const,
  label: `${SHOP.name} – ${SHOP.address}`,
};

export const SHOP_OVERLAYS = [SHOP_OVERLAY];
