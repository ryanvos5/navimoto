import { create } from 'zustand';
import type { AuthUser } from '@/types';
import { authProvider as defaultProvider, GUEST_USER } from '@/services/auth';
import { AuthError, AUTH_ERROR_MESSAGES, type AuthProvider, type AuthProviderName } from '@/services/auth/types';
import { storageGet, storageRemove, storageSet } from '@/services/db';

const GUEST_KEY = 'guest';

export interface AuthState {
  user: AuthUser | null;
  status: 'loading' | 'signedOut' | 'signedIn';
  error: string | null;
  providerName: AuthProviderName;
  init(): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string, displayName: string): Promise<void>;
  signOut(): Promise<void>;
  continueAsGuest(): Promise<void>;
  clearError(): void;
}

let provider: AuthProvider = defaultProvider;
let unsubscribe: (() => void) | null = null;

/** Vertaalt een fout naar een Nederlandse melding voor de UI. */
export function authErrorText(err: unknown): string {
  if (err instanceof AuthError) return err.message || AUTH_ERROR_MESSAGES[err.code];
  return AUTH_ERROR_MESSAGES.unknown;
}

function sameUser(a: AuthUser | null, b: AuthUser | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.id === b.id && a.email === b.email && a.displayName === b.displayName && a.isGuest === b.isGuest;
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  status: 'loading',
  error: null,
  providerName: provider.name,

  async init() {
    set({ status: 'loading', error: null, providerName: provider.name });

    // Gastmodus bestaat alleen nog bij lokale accounts; met Vos Oss-accounts (Supabase) is inloggen verplicht.
    const guestFlag = await storageGet(GUEST_KEY);
    if (guestFlag === '1' && provider.name === 'local') {
      set({ user: GUEST_USER, status: 'signedIn' });
    } else {
      let user: AuthUser | null = null;
      try {
        user = await provider.getSession();
      } catch (err) {
        console.warn('Sessie kon niet worden geladen', err);
      }
      set({ user, status: user ? 'signedIn' : 'signedOut' });
    }

    // Luister naar wijzigingen van de provider (bijv. uitloggen in een ander tabblad).
    unsubscribe?.();
    unsubscribe = provider.onAuthChange((next) => {
      const state = get();
      if (state.user?.isGuest) return; // gastmodus negeert providerwijzigingen
      if (next) {
        if (state.status === 'signedIn' && sameUser(state.user, next)) return;
        set({ user: next, status: 'signedIn' });
      } else if (state.user !== null || state.status !== 'signedOut') {
        set({ user: null, status: 'signedOut' });
      }
    });
  },

  async signIn(email, password) {
    set({ error: null });
    try {
      const user = await provider.signIn(email, password);
      await storageRemove(GUEST_KEY);
      set({ user, status: 'signedIn', error: null });
    } catch (err) {
      set({ error: authErrorText(err) });
    }
  },

  async signUp(email, password, displayName) {
    set({ error: null });
    try {
      const user = await provider.signUp(email, password, displayName);
      await storageRemove(GUEST_KEY);
      set({ user, status: 'signedIn', error: null });
    } catch (err) {
      set({ error: authErrorText(err) });
    }
  },

  async signOut() {
    const { user } = get();
    if (user && !user.isGuest) {
      try {
        await provider.signOut();
      } catch (err) {
        console.warn('Uitloggen bij de provider is mislukt', err);
      }
    }
    await storageRemove(GUEST_KEY);
    set({ user: null, status: 'signedOut', error: null });
  },

  async continueAsGuest() {
    await storageSet(GUEST_KEY, '1');
    set({ user: GUEST_USER, status: 'signedIn', error: null });
  },

  clearError() {
    set({ error: null });
  },
}));

/** Alleen voor tests: vervangt de auth-provider en zet de store terug naar de beginstand. */
export function _setAuthProviderForTests(p: AuthProvider): void {
  unsubscribe?.();
  unsubscribe = null;
  provider = p;
  useAuth.setState({ user: null, status: 'loading', error: null, providerName: p.name });
}
