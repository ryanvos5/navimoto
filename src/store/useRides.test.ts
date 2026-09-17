import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/services/db';
import { useRides, type NewRoute, type NewTrack } from '@/store/useRides';

async function resetDb(): Promise<void> {
  await Promise.all(db.tables.map((t) => t.clear()));
}

function routeInput(name: string, overrides: Partial<NewRoute> = {}): NewRoute {
  return {
    name,
    kind: 'planned',
    waypoints: [
      { lat: 52.09, lon: 5.12, name: 'Utrecht' },
      { lat: 52.37, lon: 4.9, name: 'Amsterdam' },
    ],
    style: 'bochtig',
    avoid: { ferries: false, highways: true, tolls: false, unpaved: false },
    geometry: [
      { lat: 52.09, lon: 5.12 },
      { lat: 52.2, lon: 5.0 },
      { lat: 52.37, lon: 4.9 },
    ],
    distanceKm: 45.2,
    durationS: 3600,
    maneuvers: [],
    gpx: null,
    ...overrides,
  };
}

function trackInput(name: string, startedAt: number, overrides: Partial<NewTrack> = {}): NewTrack {
  return {
    name,
    startedAt,
    endedAt: startedAt + 600_000,
    points: [
      { lat: 52.09, lon: 5.12, t: startedAt },
      { lat: 52.1, lon: 5.13, t: startedAt + 600_000 },
    ],
    distanceKm: 1.3,
    durationS: 600,
    movingS: 580,
    avgSpeedKmh: 8,
    maxSpeedKmh: 12,
    routeId: null,
    ...overrides,
  };
}

describe('useRides', () => {
  beforeEach(async () => {
    await resetDb();
    useRides.setState({ routes: [], tracks: [], loaded: false, userId: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('weigert opslaan zonder ingelogde gebruiker', async () => {
    await expect(useRides.getState().saveRoute(routeInput('A'))).rejects.toThrow('Niet ingelogd');
    await expect(useRides.getState().saveTrack(trackInput('T', 1000))).rejects.toThrow('Niet ingelogd');
  });

  it('load zet loaded en userId, ook zonder data', async () => {
    await useRides.getState().load('user-a');
    const s = useRides.getState();
    expect(s.loaded).toBe(true);
    expect(s.userId).toBe('user-a');
    expect(s.routes).toEqual([]);
    expect(s.tracks).toEqual([]);
  });

  it('slaat routes op, hernoemt en verwijdert ze (nieuwste eerst)', async () => {
    await useRides.getState().load('user-a');
    const now = vi.spyOn(Date, 'now');

    now.mockReturnValue(1000);
    const a = await useRides.getState().saveRoute(routeInput('A'));
    now.mockReturnValue(2000);
    const b = await useRides.getState().saveRoute(routeInput('B', { kind: 'roundtrip' }));

    expect(a).toMatchObject({ name: 'A', userId: 'user-a', createdAt: 1000, updatedAt: 1000 });
    expect(a.id).toEqual(expect.any(String));
    expect(useRides.getState().routes.map((r) => r.name)).toEqual(['B', 'A']);
    expect(useRides.getState().getRoute(a.id)).toEqual(a);
    expect(await db.routes.get(a.id)).toEqual(a);

    now.mockReturnValue(3000);
    await useRides.getState().renameRoute(a.id, '  A2 ');
    expect(useRides.getState().routes.map((r) => r.name)).toEqual(['A2', 'B']);
    expect(useRides.getState().getRoute(a.id)).toMatchObject({ name: 'A2', createdAt: 1000, updatedAt: 3000 });
    expect((await db.routes.get(a.id))?.name).toBe('A2');

    // Opnieuw laden geeft dezelfde volgorde (updatedAt aflopend).
    useRides.getState().clear();
    expect(useRides.getState().loaded).toBe(false);
    await useRides.getState().load('user-a');
    expect(useRides.getState().routes.map((r) => r.name)).toEqual(['A2', 'B']);

    await useRides.getState().deleteRoute(b.id);
    expect(useRides.getState().routes.map((r) => r.name)).toEqual(['A2']);
    expect(useRides.getState().getRoute(b.id)).toBeUndefined();
    expect(await db.routes.get(b.id)).toBeUndefined();
    expect(await db.routes.count()).toBe(1);
  });

  it('bijwerken met bestaand id behoudt createdAt en maakt geen dubbele', async () => {
    await useRides.getState().load('user-a');
    const now = vi.spyOn(Date, 'now');

    now.mockReturnValue(1000);
    const first = await useRides.getState().saveRoute(routeInput('A'));
    now.mockReturnValue(2000);
    const second = await useRides.getState().saveRoute({ ...routeInput('A gewijzigd', { distanceKm: 50 }), id: first.id });

    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(1000);
    expect(second.updatedAt).toBe(2000);
    expect(second.distanceKm).toBe(50);
    expect(useRides.getState().routes).toHaveLength(1);
    expect(useRides.getState().routes[0].name).toBe('A gewijzigd');
    expect(await db.routes.count()).toBe(1);
    expect((await db.routes.get(first.id))?.createdAt).toBe(1000);
  });

  it('slaat ritten op, hernoemt en verwijdert ze (nieuwste start eerst)', async () => {
    await useRides.getState().load('user-a');

    const oud = await useRides.getState().saveTrack(trackInput('Oud', 1_000_000));
    const nieuw = await useRides.getState().saveTrack(trackInput('Nieuw', 2_000_000));
    const midden = await useRides.getState().saveTrack(trackInput('Midden', 1_500_000, { routeId: 'route-x' }));

    expect(oud).toMatchObject({ name: 'Oud', userId: 'user-a', startedAt: 1_000_000 });
    expect(useRides.getState().tracks.map((t) => t.name)).toEqual(['Nieuw', 'Midden', 'Oud']);
    expect(useRides.getState().getTrack(midden.id)?.routeId).toBe('route-x');
    expect(await db.tracks.get(nieuw.id)).toEqual(nieuw);

    await useRides.getState().renameTrack(oud.id, 'Oudste');
    expect(useRides.getState().getTrack(oud.id)?.name).toBe('Oudste');
    expect((await db.tracks.get(oud.id))?.name).toBe('Oudste');
    expect(useRides.getState().tracks.map((t) => t.name)).toEqual(['Nieuw', 'Midden', 'Oudste']);

    useRides.getState().clear();
    await useRides.getState().load('user-a');
    expect(useRides.getState().tracks.map((t) => t.name)).toEqual(['Nieuw', 'Midden', 'Oudste']);

    await useRides.getState().deleteTrack(nieuw.id);
    expect(useRides.getState().tracks.map((t) => t.name)).toEqual(['Midden', 'Oudste']);
    expect(await db.tracks.get(nieuw.id)).toBeUndefined();
  });

  it('opslaan van een rit met bestaand id vervangt de rit', async () => {
    await useRides.getState().load('user-a');
    const t = await useRides.getState().saveTrack(trackInput('Rit', 1000));
    const replaced = await useRides.getState().saveTrack({ ...trackInput('Rit 2', 1000, { distanceKm: 9 }), id: t.id });
    expect(replaced.id).toBe(t.id);
    expect(useRides.getState().tracks).toHaveLength(1);
    expect(useRides.getState().tracks[0]).toMatchObject({ name: 'Rit 2', distanceKm: 9 });
    expect(await db.tracks.count()).toBe(1);
  });

  it('houdt data van verschillende gebruikers gescheiden', async () => {
    await useRides.getState().load('user-a');
    await useRides.getState().saveRoute(routeInput('Route van A'));
    await useRides.getState().saveTrack(trackInput('Rit van A', 1000));

    await useRides.getState().load('user-b');
    expect(useRides.getState().routes).toEqual([]);
    expect(useRides.getState().tracks).toEqual([]);
    const routeB = await useRides.getState().saveRoute(routeInput('Route van B'));
    expect(routeB.userId).toBe('user-b');

    await useRides.getState().load('user-a');
    expect(useRides.getState().routes.map((r) => r.name)).toEqual(['Route van A']);
    expect(useRides.getState().tracks.map((t) => t.name)).toEqual(['Rit van A']);
    expect(useRides.getState().getRoute(routeB.id)).toBeUndefined();

    expect(await db.routes.count()).toBe(2);
    expect(await db.tracks.count()).toBe(1);
  });

  it('clear zet de store terug', async () => {
    await useRides.getState().load('user-a');
    await useRides.getState().saveRoute(routeInput('A'));
    useRides.getState().clear();
    expect(useRides.getState()).toMatchObject({ routes: [], tracks: [], loaded: false, userId: null });
    // Data blijft bewaard in de database.
    expect(await db.routes.count()).toBe(1);
  });
});
