// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PREVIEW_MAX_POINTS, PREVIEW_PADDING, projectPreview, RoutePreviewSvg } from '@/components/RoutePreviewSvg';
import type { LatLng } from '@/types';

/** Aantal coördinatenparen in het points-attribuut van de polyline, of -1 als er geen polyline is. */
function polylinePairs(markup: string): number {
  const m = /<polyline[^>]*\spoints="([^"]*)"/.exec(markup);
  if (!m) return -1;
  return m[1].trim().split(/\s+/).length;
}

const THREE: LatLng[] = [
  { lat: 52.0907, lon: 5.1214 },
  { lat: 52.095, lon: 5.13 },
  { lat: 52.1, lon: 5.14 },
];

describe('RoutePreviewSvg', () => {
  it('rendert een polyline met één paar per punt en de standaardmaten', () => {
    const markup = renderToStaticMarkup(<RoutePreviewSvg geometry={THREE} />);
    expect(markup).toContain('<svg');
    expect(markup).toContain('width="96"');
    expect(markup).toContain('height="64"');
    expect(markup).toContain('<rect');
    expect(markup).toContain('fill="var(--color-surface-3)"');
    expect(polylinePairs(markup)).toBe(3);
    expect(markup).toContain('stroke="var(--color-route)"');
    expect(markup).toContain('stroke-linejoin="round"');
    expect(markup).toContain('stroke-width="2.5"');
    expect(markup).not.toContain('NaN');
  });

  it('rendert alleen de achtergrond bij 0 of 1 punten', () => {
    const empty = renderToStaticMarkup(<RoutePreviewSvg geometry={[]} />);
    expect(empty).toContain('<rect');
    expect(empty).not.toContain('<polyline');
    const single = renderToStaticMarkup(<RoutePreviewSvg geometry={[THREE[0]]} />);
    expect(single).not.toContain('<polyline');
  });

  it('dunt lange lijnen uit tot maximaal PREVIEW_MAX_POINTS paren', () => {
    const many = Array.from({ length: 1000 }, (_, i) => ({ lat: 52 + i * 0.0001, lon: 5 + Math.sin(i / 20) * 0.01 }));
    const markup = renderToStaticMarkup(<RoutePreviewSvg geometry={many} />);
    expect(polylinePairs(markup)).toBe(PREVIEW_MAX_POINTS);
  });

  it('neemt kleur, maat, lijndikte en className over', () => {
    const markup = renderToStaticMarkup(
      <RoutePreviewSvg geometry={THREE} width={120} height={80} color="#22c55e" strokeWidth={3} className="rounded-xl" />,
    );
    expect(markup).toContain('width="120"');
    expect(markup).toContain('viewBox="0 0 120 80"');
    expect(markup).toContain('stroke="#22c55e"');
    expect(markup).toContain('stroke-width="3"');
    expect(markup).toContain('class="rounded-xl"');
  });
});

describe('projectPreview', () => {
  it('geeft null bij minder dan 2 punten', () => {
    expect(projectPreview([], 96, 64)).toBeNull();
    expect(projectPreview([THREE[0]], 96, 64)).toBeNull();
  });

  it('past een brede lijn in de breedte, binnen de padding en verticaal gecentreerd', () => {
    const wide: LatLng[] = [
      { lat: 52, lon: 5 },
      { lat: 52, lon: 5.5 },
    ];
    const xy = projectPreview(wide, 96, 64)!;
    expect(xy[0][0]).toBeCloseTo(PREVIEW_PADDING, 6);
    expect(xy[1][0]).toBeCloseTo(96 - PREVIEW_PADDING, 6);
    expect(xy[0][1]).toBeCloseTo(32, 6);
    expect(xy[1][1]).toBeCloseTo(32, 6);
  });

  it('past een hoge lijn in de hoogte, horizontaal gecentreerd, met noorden boven', () => {
    const tall: LatLng[] = [
      { lat: 52, lon: 5 },
      { lat: 52.5, lon: 5 },
    ];
    const xy = projectPreview(tall, 96, 64)!;
    // Eerste punt ligt zuidelijker en dus onderaan (grotere y).
    expect(xy[0][1]).toBeCloseTo(64 - PREVIEW_PADDING, 6);
    expect(xy[1][1]).toBeCloseTo(PREVIEW_PADDING, 6);
    expect(xy[0][0]).toBeCloseTo(48, 6);
    expect(xy[1][0]).toBeCloseTo(48, 6);
  });

  it('houdt alle punten binnen de box en corrigeert de lengtegraad met cos(breedtegraad)', () => {
    // Even groot in graden, maar op 60° N is een lengtegraad half zo breed: de lijn wordt door de hoogte begrensd.
    const square: LatLng[] = [
      { lat: 60, lon: 5 },
      { lat: 60.2, lon: 5.2 },
      { lat: 60, lon: 5.2 },
    ];
    const xy = projectPreview(square, 100, 100)!;
    for (const [x, y] of xy) {
      expect(x).toBeGreaterThanOrEqual(PREVIEW_PADDING - 1e-9);
      expect(x).toBeLessThanOrEqual(100 - PREVIEW_PADDING + 1e-9);
      expect(y).toBeGreaterThanOrEqual(PREVIEW_PADDING - 1e-9);
      expect(y).toBeLessThanOrEqual(100 - PREVIEW_PADDING + 1e-9);
    }
    const widthPx = Math.max(...xy.map((p) => p[0])) - Math.min(...xy.map((p) => p[0]));
    const heightPx = Math.max(...xy.map((p) => p[1])) - Math.min(...xy.map((p) => p[1]));
    expect(heightPx).toBeCloseTo(88, 6);
    expect(widthPx).toBeCloseTo(88 * Math.cos((60.1 * Math.PI) / 180), 3);
  });

  it('zet identieke punten in het midden zonder NaN', () => {
    const xy = projectPreview([THREE[0], THREE[0]], 96, 64)!;
    expect(xy).toEqual([
      [48, 32],
      [48, 32],
    ]);
  });
});
