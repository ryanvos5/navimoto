import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/services/db';
import { useSettings } from '@/store/useSettings';
import { DEFAULT_AVOID, type AuthUser } from '@/types';

async function resetDb(): Promise<void> {
  await Promise.all(db.tables.map((t) => t.clear()));
}

const RIDER: AuthUser = { id: 'user-1', email: 'rider@example.com', displayName: 'Ryan', isGuest: false };
const GUEST: AuthUser = { id: 'guest', email: '', displayName: 'Gast', isGuest: true };

describe('useSettings', () => {
  beforeEach(async () => {
    await resetDb();
    useSettings.setState({ profile: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maakt een standaardprofiel aan en bewaart het', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    await useSettings.getState().load(RIDER);

    const profile = useSettings.getState().profile;
    expect(profile).toEqual({
      id: 'user-1',
      email: 'rider@example.com',
      displayName: 'Ryan',
      riderType: 'street',
      defaultStyle: 'bochtig',
      defaultAvoid: { ...DEFAULT_AVOID },
      voiceEnabled: true,
      mapStyle: 'osm',
      simulateRides: false,
      createdAt: 1000,
      updatedAt: 1000,
    });
    expect(await db.profiles.get('user-1')).toEqual(profile);
  });

  it('bewaart ook een gastprofiel onder id guest', async () => {
    await useSettings.getState().load(GUEST);
    expect(useSettings.getState().profile?.id).toBe('guest');
    expect(await db.profiles.get('guest')).toBeDefined();
  });

  it('laadt een bestaand profiel, volgt de e-mail van het account en bewaart de eigen weergavenaam', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    await useSettings.getState().load(RIDER);
    await useSettings.getState().update({ riderType: 'allroad', mapStyle: 'topo', displayName: 'Ryan V.' });
    useSettings.getState().clear();
    expect(useSettings.getState().profile).toBeNull();

    vi.spyOn(Date, 'now').mockReturnValue(2000);
    await useSettings.getState().load({ ...RIDER, email: 'nieuw@example.com', displayName: 'Ryan' });
    const profile = useSettings.getState().profile;
    expect(profile).toMatchObject({
      id: 'user-1',
      email: 'nieuw@example.com',
      displayName: 'Ryan V.',
      riderType: 'allroad',
      mapStyle: 'topo',
      createdAt: 1000,
      updatedAt: 2000,
    });
    expect(await db.profiles.get('user-1')).toEqual(profile);

    // Ongewijzigd account: geen schrijfactie, updatedAt blijft staan.
    vi.spyOn(Date, 'now').mockReturnValue(3000);
    await useSettings.getState().load({ ...RIDER, email: 'nieuw@example.com' });
    expect(useSettings.getState().profile?.updatedAt).toBe(2000);
  });

  it('vult een lege weergavenaam met de naam van het account', async () => {
    await useSettings.getState().load(RIDER);
    await useSettings.getState().update({ displayName: '  ' });
    useSettings.getState().clear();
    await useSettings.getState().load({ ...RIDER, displayName: 'Ryan V.' });
    expect(useSettings.getState().profile?.displayName).toBe('Ryan V.');
  });

  it('update voegt de wijziging samen, zet updatedAt en bewaart', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    await useSettings.getState().load(RIDER);

    vi.spyOn(Date, 'now').mockReturnValue(5000);
    await useSettings.getState().update({
      voiceEnabled: false,
      defaultAvoid: { ...DEFAULT_AVOID, highways: true },
      simulateRides: true,
    });

    const profile = useSettings.getState().profile;
    expect(profile).toMatchObject({
      voiceEnabled: false,
      defaultAvoid: { ferries: false, highways: true, tolls: false, unpaved: false },
      simulateRides: true,
      riderType: 'street',
      createdAt: 1000,
      updatedAt: 5000,
    });
    expect(await db.profiles.get('user-1')).toEqual(profile);
  });

  it('update kan id en createdAt niet overschrijven', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    await useSettings.getState().load(RIDER);
    await useSettings.getState().update({ id: 'ander', createdAt: 5, displayName: 'Nieuw' });
    const profile = useSettings.getState().profile;
    expect(profile?.id).toBe('user-1');
    expect(profile?.createdAt).toBe(1000);
    expect(profile?.displayName).toBe('Nieuw');
    expect(await db.profiles.get('ander')).toBeUndefined();
  });

  it('update zonder geladen profiel doet niets en gooit niet', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(useSettings.getState().update({ voiceEnabled: false })).resolves.toBeUndefined();
    expect(useSettings.getState().profile).toBeNull();
    expect(await db.profiles.count()).toBe(0);
    expect(warn).toHaveBeenCalled();
  });
});
