import { create } from 'zustand';
import { db } from '@/services/db';
import * as cloud from '@/services/cloud';
import { setNewsletterSubscription } from '@/services/newsletter';
import { defaultProfile, type AuthUser, type UserProfile } from '@/types';

export interface SettingsState {
  profile: UserProfile | null;
  /** Laadt het profiel van de gebruiker; maakt een standaardprofiel aan als er nog geen is. */
  load(user: AuthUser): Promise<void>;
  /** Past het profiel aan en bewaart het. */
  update(patch: Partial<UserProfile>): Promise<void>;
  /** Meldt de gebruiker aan/af voor de Vos Oss-nieuwsbrief (Brevo) en bewaart de keuze. Gooit bij een fout. */
  setNewsletter(optIn: boolean): Promise<void>;
  clear(): void;
}

/**
 * E-mail volgt altijd het account; de weergavenaam alleen zolang het profiel nog geen naam heeft,
 * zodat een via update({ displayName }) gewijzigde naam behouden blijft.
 */
function syncAccountFields(profile: UserProfile, user: AuthUser, now: number): UserProfile {
  const displayName = profile.displayName.trim() ? profile.displayName : user.displayName;
  const email = user.email || profile.email;
  if (profile.email === email && profile.displayName === displayName) return profile;
  return { ...profile, email, displayName, updatedAt: now };
}

export const useSettings = create<SettingsState>((set, get) => ({
  profile: null,

  async load(user) {
    const now = Date.now();
    const local = await db.profiles.get(user.id);
    // Lokaal profiel meteen tonen (of nog niets) en daarna afstemmen met de cloud.
    if (local) set({ profile: syncAccountFields(local, user, now) });

    let remote: UserProfile | null = null;
    let cloudOk = false;
    if (cloud.cloudEnabledFor(user.id)) {
      try {
        remote = await cloud.pullProfile(user.id);
        cloudOk = true;
      } catch (err) {
        console.warn('Cloud-sync mislukt (profiel ophalen)', err);
      }
    }
    if (get().profile && get().profile?.id !== user.id) return; // intussen als iemand anders ingelogd

    // Keuze: nieuwste van lokaal en cloud. Zonder lokaal profiel wint de cloud altijd (nieuw toestel
    // of na uitloggen): een vers standaardprofiel mag nooit de instellingen op het account overschrijven.
    let profile: UserProfile;
    if (local && remote) profile = remote.updatedAt > local.updatedAt ? remote : local;
    else if (remote) profile = remote;
    else if (local) profile = local;
    else profile = defaultProfile(user, now);
    profile = syncAccountFields(profile, user, now);

    await db.profiles.put(profile);
    set({ profile });

    // Cloud bijwerken als die achterloopt (of nog niets heeft). Alleen als het ophalen lukte:
    // anders zou een offline start de cloud kunnen overschrijven met verouderde data.
    if (cloudOk && (!remote || profile.updatedAt > remote.updatedAt)) {
      cloud.background('profiel opslaan', () => cloud.pushProfile(profile));
    }

    // Bij registratie aangevinkt maar nog niet naar Brevo gestuurd (pas mogelijk na e-mailbevestiging + inloggen).
    if (cloudOk && user.newsletterOptIn && !profile.newsletterSyncedAt) {
      cloud.background('nieuwsbrief aanmelden', async () => {
        await setNewsletterSubscription('subscribe', profile.displayName);
        await get().update({ newsletterOptIn: true, newsletterSyncedAt: Date.now() });
      });
    }
  },

  async setNewsletter(optIn) {
    const current = get().profile;
    if (!current) return;
    await setNewsletterSubscription(optIn ? 'subscribe' : 'unsubscribe', current.displayName);
    await get().update({ newsletterOptIn: optIn, newsletterSyncedAt: Date.now() });
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
    if (cloud.cloudEnabledFor(next.id)) cloud.background('profiel opslaan', () => cloud.pushProfile(next));
  },

  clear() {
    set({ profile: null });
  },
}));
