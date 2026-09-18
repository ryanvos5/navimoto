// Afstemming van het profiel met de cloud: de accountinstellingen mogen nooit door een vers
// standaardprofiel (nieuw toestel / na uitloggen) overschreven worden.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser, UserProfile } from '@/types';
import { defaultProfile } from '@/types';

const pullProfile = vi.fn();
const pushProfile = vi.fn();

vi.mock('@/services/cloud', () => ({
  cloudEnabledFor: () => true,
  pullProfile: (...args: unknown[]) => pullProfile(...args),
  pushProfile: (...args: unknown[]) => pushProfile(...args),
  background: (_label: string, op: () => Promise<void>) => void op().catch(() => undefined),
}));

const { db } = await import('@/services/db');
const { useSettings } = await import('@/store/useSettings');

const user: AuthUser = { id: 'b0a1c2d3-0000-4000-8000-000000000001', email: 'rijder@vos-oss.nl', displayName: 'Rijder', isGuest: false };

function remoteProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    ...defaultProfile(user, 1_000),
    riderType: 'allroad',
    mapStyle: 'topo',
    home: { lat: 51.77, lon: 5.55, name: 'Thuis in Oss' },
    updatedAt: 5_000,
    ...overrides,
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(async () => {
  await db.profiles.clear();
  useSettings.setState({ profile: null });
  pullProfile.mockReset();
  pushProfile.mockReset();
  pushProfile.mockResolvedValue(undefined);
});

describe('useSettings.load met cloud', () => {
  it('neemt het cloudprofiel over als er lokaal nog niets is (nieuw toestel / na uitloggen)', async () => {
    pullProfile.mockResolvedValue(remoteProfile());
    await useSettings.getState().load(user);
    await flush();
    const p = useSettings.getState().profile;
    expect(p?.riderType).toBe('allroad');
    expect(p?.mapStyle).toBe('topo');
    expect(p?.home?.name).toBe('Thuis in Oss');
    expect(pushProfile).not.toHaveBeenCalled();
    expect((await db.profiles.get(user.id))?.riderType).toBe('allroad');
  });

  it('kiest het nieuwste van lokaal en cloud en duwt lokaal naar de cloud als dat nieuwer is', async () => {
    await db.profiles.put({ ...defaultProfile(user, 1_000), riderType: 'offroad', updatedAt: 9_000 });
    pullProfile.mockResolvedValue(remoteProfile({ updatedAt: 5_000 }));
    await useSettings.getState().load(user);
    await flush();
    expect(useSettings.getState().profile?.riderType).toBe('offroad');
    expect(pushProfile).toHaveBeenCalledTimes(1);
    expect(pushProfile.mock.calls[0][0]).toMatchObject({ riderType: 'offroad' });
  });

  it('maakt alleen een standaardprofiel als lokaal én cloud leeg zijn, en zet dat in de cloud', async () => {
    pullProfile.mockResolvedValue(null);
    await useSettings.getState().load(user);
    await flush();
    expect(useSettings.getState().profile?.riderType).toBe('street');
    expect(pushProfile).toHaveBeenCalledTimes(1);
  });

  it('overschrijft de cloud niet als het ophalen mislukt (offline start)', async () => {
    pullProfile.mockRejectedValue(new Error('netwerk'));
    await useSettings.getState().load(user);
    await flush();
    expect(useSettings.getState().profile?.riderType).toBe('street');
    expect(pushProfile).not.toHaveBeenCalled();
  });
});
