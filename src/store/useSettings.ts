import { create } from 'zustand';
import { db } from '@/services/db';
import { defaultProfile, type AuthUser, type UserProfile } from '@/types';

export interface SettingsState {
  profile: UserProfile | null;
  /** Laadt het profiel van de gebruiker; maakt een standaardprofiel aan als er nog geen is. */
  load(user: AuthUser): Promise<void>;
  /** Past het profiel aan en bewaart het. */
  update(patch: Partial<UserProfile>): Promise<void>;
  clear(): void;
}

export const useSettings = create<SettingsState>((set, get) => ({
  profile: null,

  async load(user) {
    const now = Date.now();
    let profile = await db.profiles.get(user.id);
    if (!profile) {
      profile = defaultProfile(user, now);
      await db.profiles.put(profile);
    } else {
      // E-mail volgt altijd het account. De weergavenaam alleen zolang het profiel er nog geen heeft:
      // een via update({ displayName }) gewijzigde naam blijft zo behouden.
      const displayName = profile.displayName.trim() ? profile.displayName : user.displayName;
      if (profile.email !== user.email || profile.displayName !== displayName) {
        profile = { ...profile, email: user.email, displayName, updatedAt: now };
        await db.profiles.put(profile);
      }
    }
    set({ profile });
  },

  async update(patch) {
    const current = get().profile;
    if (!current) {
      console.warn('useSettings.update: geen profiel geladen');
      return;
    }
    const next: UserProfile = {
      ...current,
      ...patch,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: Date.now(),
    };
    set({ profile: next });
    await db.profiles.put(next);
  },

  clear() {
    set({ profile: null });
  },
}));
