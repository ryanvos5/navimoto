// Weergavefuncties voor afstanden, tijden, datums en coördinaten. Nederlandse notatie (nl-NL).
// Puur en zonder React-afhankelijkheden - getest in format.test.ts.
import type { LatLng } from '@/types';

const LOCALE = 'nl-NL';

const oneDecimal = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const noDecimals = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });

/** Formatters per tijdzone worden gecachet: formatEta wordt tijdens navigatie vaak aangeroepen. */
const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const timeFormatters = new Map<string, Intl.DateTimeFormat>();

function getFormatter(cache: Map<string, Intl.DateTimeFormat>, tz: string | undefined, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = tz ?? '';
  let fmt = cache.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(LOCALE, tz ? { ...options, timeZone: tz } : options);
    cache.set(key, fmt);
  }
  return fmt;
}

/**
 * Afstand in km als tekst: "850 m" (afgerond op 10 m), "5,4 km" / "12,3 km" (< 100 km, één decimaal),
 * "123 km" (vanaf 100 km geen decimalen). Ongeldige of negatieve invoer geeft "0 m".
 */
export function formatDistance(km: number): string {
  if (!Number.isFinite(km) || km <= 0) return '0 m';
  if (km < 1) {
    const meters = km * 1000;
    if (meters < 10) return '0 m';
    const rounded = Math.round(meters / 10) * 10;
    if (rounded < 1000) return `${rounded} m`;
    // 995-999 m rondt af naar 1000 m: toon als kilometer.
    return `${oneDecimal.format(1)} km`;
  }
  const tenths = Math.round(km * 10) / 10;
  if (tenths < 100) return `${oneDecimal.format(tenths)} km`;
  return `${noDecimals.format(km)} km`;
}

/** Duur in seconden als tekst: "< 1 min", "45 min", "1 u 20 min", "2 u". */
export function formatDuration(seconds: number): string {
  const s = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  if (s < 60) return '< 1 min';
  const totalMinutes = Math.round(s / 60);
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours} u` : `${hours} u ${minutes} min`;
}

/** Snelheid als tekst: "87 km/u"; onbekend (null/NaN) geeft "– km/u". */
export function formatSpeed(kmh: number | null): string {
  if (kmh === null || !Number.isFinite(kmh)) return '– km/u';
  return `${Math.max(0, Math.round(kmh))} km/u`;
}

/** Datum als "17 sep 2026". `tz` (IANA-tijdzone) is optioneel, vooral voor tests. */
export function formatDate(ts: number, tz?: string): string {
  if (!Number.isFinite(ts)) return '–';
  return getFormatter(dateFormatters, tz, { day: 'numeric', month: 'short', year: 'numeric' }).format(ts);
}

/** Tijd als "14:05" (24-uursnotatie). */
export function formatTime(ts: number, tz?: string): string {
  if (!Number.isFinite(ts)) return '–';
  return getFormatter(timeFormatters, tz, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ts);
}

/** Datum en tijd als "17 sep 2026, 14:05". */
export function formatDateTime(ts: number, tz?: string): string {
  if (!Number.isFinite(ts)) return '–';
  return `${formatDate(ts, tz)}, ${formatTime(ts, tz)}`;
}

/** Verwachte aankomsttijd: nu + resterende seconden, als "14:05". */
export function formatEta(nowMs: number, remainingS: number, tz?: string): string {
  const remaining = Number.isFinite(remainingS) && remainingS > 0 ? remainingS : 0;
  return formatTime(nowMs + remaining * 1000, tz);
}

/** Coördinaten met 5 decimalen en een punt als decimaalteken: "52.09070, 5.12140". */
export function formatCoords(p: LatLng): string {
  return `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;
}
