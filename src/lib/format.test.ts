import { describe, expect, it } from 'vitest';
import {
  formatCoords,
  formatDate,
  formatDateTime,
  formatDistance,
  formatDuration,
  formatEta,
  formatSpeed,
  formatTime,
} from '@/lib/format';

const TZ = 'Europe/Amsterdam';
// 17 september 2026, 14:05 in Amsterdam (CEST = UTC+2).
const SEP_17 = Date.UTC(2026, 8, 17, 12, 5, 0);
// 6 januari 2026, 00:30 in Amsterdam (CET = UTC+1).
const JAN_6 = Date.UTC(2026, 0, 5, 23, 30, 0);

describe('formatDistance', () => {
  it('toont meters onder 1 km, afgerond op 10 m', () => {
    expect(formatDistance(0.85)).toBe('850 m');
    expect(formatDistance(0.123)).toBe('120 m');
    expect(formatDistance(0.126)).toBe('130 m');
    expect(formatDistance(0.01)).toBe('10 m');
  });

  it('toont "0 m" onder 10 m en bij ongeldige of negatieve invoer', () => {
    expect(formatDistance(0)).toBe('0 m');
    expect(formatDistance(0.004)).toBe('0 m');
    expect(formatDistance(-3)).toBe('0 m');
    expect(formatDistance(Number.NaN)).toBe('0 m');
    expect(formatDistance(Number.POSITIVE_INFINITY)).toBe('0 m');
  });

  it('toont één decimaal met komma onder 100 km', () => {
    expect(formatDistance(5.4)).toBe('5,4 km');
    expect(formatDistance(1)).toBe('1,0 km');
    expect(formatDistance(9.94)).toBe('9,9 km');
    expect(formatDistance(9.97)).toBe('10,0 km');
    expect(formatDistance(12.3)).toBe('12,3 km');
    expect(formatDistance(10)).toBe('10,0 km');
    expect(formatDistance(99.94)).toBe('99,9 km');
  });

  it('toont geen decimalen vanaf 100 km', () => {
    expect(formatDistance(123)).toBe('123 km');
    expect(formatDistance(100)).toBe('100 km');
    expect(formatDistance(99.96)).toBe('100 km');
    expect(formatDistance(250.4)).toBe('250 km');
  });

  it('gaat netjes om met de grens rond 1 km', () => {
    expect(formatDistance(0.999)).toBe('1,0 km');
    expect(formatDistance(0.994)).toBe('990 m');
  });
});

describe('formatDuration', () => {
  it('toont "< 1 min" onder een minuut', () => {
    expect(formatDuration(0)).toBe('< 1 min');
    expect(formatDuration(59)).toBe('< 1 min');
    expect(formatDuration(-10)).toBe('< 1 min');
    expect(formatDuration(Number.NaN)).toBe('< 1 min');
  });

  it('toont minuten onder een uur', () => {
    expect(formatDuration(60)).toBe('1 min');
    expect(formatDuration(45 * 60)).toBe('45 min');
    expect(formatDuration(45 * 60 + 20)).toBe('45 min');
    expect(formatDuration(45 * 60 + 40)).toBe('46 min');
  });

  it('toont uren en minuten vanaf een uur', () => {
    expect(formatDuration(80 * 60)).toBe('1 u 20 min');
    expect(formatDuration(2 * 3600)).toBe('2 u');
    expect(formatDuration(3 * 3600 + 5 * 60)).toBe('3 u 5 min');
    expect(formatDuration(59 * 60 + 45)).toBe('1 u');
  });
});

describe('formatSpeed', () => {
  it('rondt af op hele km/u', () => {
    expect(formatSpeed(87.4)).toBe('87 km/u');
    expect(formatSpeed(87.5)).toBe('88 km/u');
    expect(formatSpeed(0)).toBe('0 km/u');
  });

  it('toont een gedachtestreepje bij onbekende snelheid', () => {
    expect(formatSpeed(null)).toBe('– km/u');
    expect(formatSpeed(Number.NaN)).toBe('– km/u');
    expect(formatSpeed(null)).toBe('– km/u');
  });
});

describe('datum en tijd (nl-NL, Europe/Amsterdam)', () => {
  it('formatDate', () => {
    expect(formatDate(SEP_17, TZ)).toBe('17 sep 2026');
    expect(formatDate(JAN_6, TZ)).toBe('6 jan 2026');
  });

  it('formatTime gebruikt 24-uursnotatie met voorloopnul', () => {
    expect(formatTime(SEP_17, TZ)).toBe('14:05');
    expect(formatTime(JAN_6, TZ)).toBe('00:30');
  });

  it('formatDateTime', () => {
    expect(formatDateTime(SEP_17, TZ)).toBe('17 sep 2026, 14:05');
    expect(formatDateTime(JAN_6, TZ)).toBe('6 jan 2026, 00:30');
  });

  it('formatEta telt de resterende seconden op bij nu', () => {
    expect(formatEta(SEP_17, 25 * 60, TZ)).toBe('14:30');
    expect(formatEta(SEP_17, 0, TZ)).toBe('14:05');
    expect(formatEta(SEP_17, 10 * 3600 + 55 * 60, TZ)).toBe('01:00');
    expect(formatEta(SEP_17, Number.NaN, TZ)).toBe('14:05');
  });

  it('werkt ook zonder tijdzone-argument (lokale tijd van het toestel)', () => {
    expect(formatDate(SEP_17)).toMatch(/^1[678] sep 2026$/);
    expect(formatTime(SEP_17)).toMatch(/^\d{2}:\d{2}$/);
    expect(formatDateTime(SEP_17)).toMatch(/^1[678] sep 2026, \d{2}:\d{2}$/);
  });

  it('geeft een streepje bij een ongeldige tijdstempel', () => {
    expect(formatDate(Number.NaN, TZ)).toBe('–');
    expect(formatTime(Number.NaN, TZ)).toBe('–');
    expect(formatDateTime(Number.NaN, TZ)).toBe('–');
  });
});

describe('formatCoords', () => {
  it('toont 5 decimalen met een punt', () => {
    expect(formatCoords({ lat: 52.0907, lon: 5.1214 })).toBe('52.09070, 5.12140');
    expect(formatCoords({ lat: -33.868819, lon: 151.209296 })).toBe('-33.86882, 151.20930');
  });
});
