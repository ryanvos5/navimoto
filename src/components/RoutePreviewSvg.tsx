// Miniatuur van een route of spoor als pure SVG (thumbnail in lijsten). Geen kaarttegels, alleen de lijn.
import { useMemo } from 'react';
import type { LatLng } from '@/types';
import { boundsOf } from '@/lib/geo';

export interface RoutePreviewSvgProps {
  geometry: LatLng[];
  width?: number;
  height?: number;
  color?: string;
  strokeWidth?: number;
  className?: string;
}

/** Meer punten heeft een thumbnail niet nodig; de lijn wordt gelijkmatig uitgedund. */
export const PREVIEW_MAX_POINTS = 400;
export const PREVIEW_PADDING = 6;

function thin(points: LatLng[], max: number): LatLng[] {
  if (points.length <= max) return points;
  const out: LatLng[] = [];
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]);
  return out;
}

/**
 * Projecteert de lijn in een box van width×height (met padding), aspectratio behouden en gecentreerd:
 * x = (lon - minLon) · cos(midLat), y = (maxLat - lat). Geeft null bij minder dan 2 punten.
 */
export function projectPreview(
  geometry: LatLng[],
  width: number,
  height: number,
  padding = PREVIEW_PADDING,
): Array<[number, number]> | null {
  if (geometry.length < 2) return null;
  const points = thin(geometry, PREVIEW_MAX_POINTS);
  const b = boundsOf(points);
  if (!b) return null;
  const midLat = (b.minLat + b.maxLat) / 2;
  const cosLat = Math.max(0.01, Math.cos((midLat * Math.PI) / 180));
  const rawW = (b.maxLon - b.minLon) * cosLat;
  const rawH = b.maxLat - b.minLat;
  const innerW = Math.max(1, width - 2 * padding);
  const innerH = Math.max(1, height - 2 * padding);
  const scaleW = rawW > 0 ? innerW / rawW : Infinity;
  const scaleH = rawH > 0 ? innerH / rawH : Infinity;
  let scale = Math.min(scaleW, scaleH);
  if (!Number.isFinite(scale)) scale = 0; // alle punten gelijk: alles in het midden
  const offX = padding + (innerW - rawW * scale) / 2;
  const offY = padding + (innerH - rawH * scale) / 2;
  return points.map((p) => [offX + (p.lon - b.minLon) * cosLat * scale, offY + (b.maxLat - p.lat) * scale]);
}

export function RoutePreviewSvg({
  geometry,
  width = 96,
  height = 64,
  color = 'var(--color-route)',
  strokeWidth = 2.5,
  className,
}: RoutePreviewSvgProps) {
  const points = useMemo(() => {
    const projected = projectPreview(geometry, width, height);
    return projected ? projected.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ') : null;
  }, [geometry, width, height]);

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden="true" focusable="false">
      <rect x={0} y={0} width={width} height={height} rx={10} fill="var(--color-surface-3)" />
      {points && (
        <polyline points={points} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
      )}
    </svg>
  );
}
