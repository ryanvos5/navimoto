// Vaste locatie van Vos Oss Motoren: altijd zichtbaar op de kaart als "pand"-marker.
import type { LatLng } from '@/types';

export const SHOP = {
  id: 'shop-vos-oss',
  name: 'Vos Oss Motoren',
  address: 'Singel 1940-1945 320a, 5348 PV Oss',
  position: { lat: 51.7741699, lon: 5.5517858 } as LatLng,
  imageUrl: `${import.meta.env.BASE_URL}brand/pand.png`,
  logoUrl: `${import.meta.env.BASE_URL}brand/voss-logo.png`,
} as const;

/** Marker-definitie voor MapView (structureel gelijk aan MapMarker met kind 'shop'). */
export const SHOP_MARKER = {
  id: SHOP.id,
  position: SHOP.position,
  kind: 'shop' as const,
  label: `${SHOP.name} – ${SHOP.address}`,
};
