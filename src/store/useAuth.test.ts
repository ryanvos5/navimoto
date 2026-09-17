import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/services/db';
import { LocalAuthProvider } from '@/services/auth/local';
import { GUEST_USER } from '@/services/auth';
import { AUTH_ERROR_MESSAGES, AuthError } from '@/services/auth/types';
import { _setAuthProviderForTests, authErrorText, useAuth } from '@/store/useAuth';

async function resetDb(): Promise<void> {
  await Promise.all(db.tables.map((t) => t.clear()));
}

describe('useAuth', () => {
  let provider: LocalAuthProvider;

  beforeEach(async () => {
    await resetDb();
    provider = new LocalAuthProvider();
    _setAuthProviderForTests(provider);
  });

  it('start in status loading en wordt signedOut zonder sessie', async () => {
    expect(useAuth.getState().status).toBe('loading');
    await useAuth.getState().init();
    const s = useAuth.getState();
    expect(s.status).toBe('signedOut');
    expect(s.user).toBeNull();
    expect(s.error).toBeNull();
    expect(s.providerName).toBe('local');
  });

  it('herstelt een bestaande sessie bij init', async () => {
    const created = await provider.signUp('rider@example.com', 'geheim123', 'Ryan');
    await useAuth.getState().init();
    expect(useAuth.getState().status).toBe('signedIn');
    expect(useAuth.getState().user).toEqual(created);
  });

  it('signUp logt in en zet geen fout', async () => {
    await useAuth.getState().init();
    await useAuth.getState().signUp('rider@example.com', 'geheim123', 'Ryan');
    const s = useAuth.getState();
    expect(s.status).toBe('signedIn');
    expect(s.user).toMatchObject({ email: 'rider@example.com', displayName: 'Ryan', isGuest: false });
    expect(s.error).toBeNull();
  });

  it('signUp met een zwak wachtwoord zet een Nederlandse fout en gooit niet', async () => {
    await useAuth.getState().init();
    await expect(useAuth.getState().signUp('rider@example.com', 'kort', 'Ryan')).resolves.toBeUndefined();
    const s = useAuth.getState();
    expect(s.status).toBe('signedOut');
    expect(s.error).toBe(AUTH_ERROR_MESSAGES.weak_password);
    expect(s.error).toMatch(/wachtwoord/i);
  });

  it('signIn met verkeerd wachtwoord zet een Nederlandse foutmelding', async () => {
    await provider.signUp('rider@example.com', 'geheim123', 'Ryan');
    await provider.signOut();
    await useAuth.getState().init();

    await useAuth.getState().signIn('rider@example.com', 'verkeerd1');
    const s = useAuth.getState();
    expect(s.status).toBe('signedOut');
    expect(s.user).toBeNull();
    expect(s.error).toBe(AUTH_ERROR_MESSAGES.invalid_credentials);
    expect(s.error).toMatch(/wachtwoord/i);

    useAuth.getState().clearError();
    expect(useAuth.getState().error).toBeNull();

    await useAuth.getState().signIn('rider@example.com', 'geheim123');
    expect(useAuth.getState().status).toBe('signedIn');
    expect(useAuth.getState().user?.email).toBe('rider@example.com');
  });

  it('continueAsGuest zet de gastgebruiker en onthoudt dat bij een volgende init', async () => {
    await useAuth.getState().init();
    await useAuth.getState().continueAsGuest();
    expect(useAuth.getState().status).toBe('signedIn');
    expect(useAuth.getState().user).toEqual(GUEST_USER);
    expect(useAuth.getState().user?.isGuest).toBe(true);
    expect((await db.kv.get('guest'))?.value).toBe('1');

    // "Herstart" van de app: nieuwe store-stand, zelfde opslag.
    _setAuthProviderForTests(provider);
    await useAuth.getState().init();
    expect(useAuth.getState().user).toEqual(GUEST_USER);
    expect(useAuth.getState().status).toBe('signedIn');
  });

  it('signOut als gast wist de gastvlag', async () => {
    await useAuth.getState().init();
    await useAuth.getState().continueAsGuest();
    await useAuth.getState().signOut();
    const s = useAuth.getState();
    expect(s.status).toBe('signedOut');
    expect(s.user).toBeNull();
    expect(await db.kv.get('guest')).toBeUndefined();

    _setAuthProviderForTests(provider);
    await useAuth.getState().init();
    expect(useAuth.getState().status).toBe('signedOut');
  });

  it('signOut als ingelogde gebruiker beeindigt de providersessie', async () => {
    await useAuth.getState().init();
    await useAuth.getState().signUp('rider@example.com', 'geheim123', 'Ryan');
    await useAuth.getState().signOut();
    expect(useAuth.getState().status).toBe('signedOut');
    expect(useAuth.getState().user).toBeNull();
    expect(await provider.getSession()).toBeNull();
  });

  it('inloggen als gast wist de gastvlag', async () => {
    await useAuth.getState().init();
    await useAuth.getState().continueAsGuest();
    await useAuth.getState().signUp('rider@example.com', 'geheim123', 'Ryan');
    expect(useAuth.getState().user?.isGuest).toBe(false);
    expect(await db.kv.get('guest')).toBeUndefined();
  });

  it('volgt wijzigingen van de provider (bijv. uitloggen elders)', async () => {
    await provider.signUp('rider@example.com', 'geheim123', 'Ryan');
    await useAuth.getState().init();
    expect(useAuth.getState().status).toBe('signedIn');

    await provider.signOut();
    expect(useAuth.getState().status).toBe('signedOut');
    expect(useAuth.getState().user).toBeNull();

    await provider.signIn('rider@example.com', 'geheim123');
    expect(useAuth.getState().status).toBe('signedIn');
  });

  it('negeert providerwijzigingen zolang de gast actief is', async () => {
    await useAuth.getState().init();
    await useAuth.getState().continueAsGuest();
    await provider.signUp('rider@example.com', 'geheim123', 'Ryan');
    await provider.signOut();
    expect(useAuth.getState().user).toEqual(GUEST_USER);
    expect(useAuth.getState().status).toBe('signedIn');
  });

  it('authErrorText vertaalt fouten naar Nederlands', () => {
    expect(authErrorText(new AuthError('email_in_use'))).toBe(AUTH_ERROR_MESSAGES.email_in_use);
    expect(authErrorText(new AuthError('unknown', 'Eigen tekst'))).toBe('Eigen tekst');
    expect(authErrorText(new Error('boom'))).toBe(AUTH_ERROR_MESSAGES.unknown);
  });
});
