import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/services/db';
import {
  LocalAuthProvider,
  PBKDF2_ITERATIONS,
  SESSION_KEY,
  base64ToBytes,
  bytesToBase64,
  constantTimeEqual,
  hashPassword,
  randomSalt,
  verifyPassword,
} from '@/services/auth/local';
import { AuthError, type AuthErrorCode } from '@/services/auth/types';

async function resetDb(): Promise<void> {
  await Promise.all(db.tables.map((t) => t.clear()));
}

async function expectAuthError(p: Promise<unknown>, code: AuthErrorCode): Promise<void> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AuthError);
  expect((err as AuthError).code).toBe(code);
  expect((err as AuthError).message.length).toBeGreaterThan(0);
}

describe('LocalAuthProvider', () => {
  let provider: LocalAuthProvider;

  beforeEach(async () => {
    await resetDb();
    provider = new LocalAuthProvider();
  });

  it('registreert een gebruiker met gehasht wachtwoord en genormaliseerd e-mailadres', async () => {
    const user = await provider.signUp('  Rider@Example.COM ', 'geheim123', '  Ryan ');
    expect(user).toEqual({ id: expect.any(String), email: 'rider@example.com', displayName: 'Ryan', isGuest: false });

    const stored = await db.localUsers.get(user.id);
    expect(stored).toBeDefined();
    expect(stored!.email).toBe('rider@example.com');
    expect(stored!.iterations).toBe(PBKDF2_ITERATIONS);
    expect(stored!.passwordHash).not.toContain('geheim123');
    expect(base64ToBytes(stored!.passwordHash)).toHaveLength(32);
    expect(base64ToBytes(stored!.salt)).toHaveLength(16);
  });

  it('gebruikt het deel voor de @ als weergavenaam wanneer die leeg is', async () => {
    const user = await provider.signUp('piet@example.com', 'wachtwoord1', '   ');
    expect(user.displayName).toBe('piet');
  });

  it('logt in met het juiste wachtwoord en weigert een fout wachtwoord', async () => {
    const created = await provider.signUp('rider@example.com', 'geheim123', 'Ryan');
    await provider.signOut();

    const signedIn = await provider.signIn('RIDER@example.com', 'geheim123');
    expect(signedIn.id).toBe(created.id);
    expect(signedIn.email).toBe('rider@example.com');

    await expectAuthError(provider.signIn('rider@example.com', 'verkeerd1'), 'invalid_credentials');
    await expectAuthError(provider.signIn('onbekend@example.com', 'geheim123'), 'invalid_credentials');
  });

  it('weigert een e-mailadres dat al in gebruik is (hoofdletters/spaties genegeerd)', async () => {
    await provider.signUp('rider@example.com', 'geheim123', 'Ryan');
    await expectAuthError(provider.signUp(' Rider@Example.com', 'anderwachtwoord', 'Kopie'), 'email_in_use');
    expect(await db.localUsers.count()).toBe(1);
  });

  it('weigert een zwak wachtwoord en een ongeldig e-mailadres', async () => {
    await expectAuthError(provider.signUp('rider@example.com', 'kort', 'Ryan'), 'weak_password');
    await expectAuthError(provider.signUp('geen-email', 'geheim123', 'Ryan'), 'invalid_email');
    await expectAuthError(provider.signUp('a@b', 'geheim123', 'Ryan'), 'invalid_email');
    expect(await db.localUsers.count()).toBe(0);
  });

  it('bewaart de sessie in de kv-tabel en herstelt die in een nieuwe provider-instantie', async () => {
    const user = await provider.signUp('rider@example.com', 'geheim123', 'Ryan');

    const entry = await db.kv.get(SESSION_KEY);
    expect(entry).toBeDefined();
    expect(JSON.parse(entry!.value)).toEqual({ userId: user.id });

    const fresh = new LocalAuthProvider();
    expect(await fresh.getSession()).toEqual(user);

    await fresh.signOut();
    expect(await db.kv.get(SESSION_KEY)).toBeUndefined();
    expect(await new LocalAuthProvider().getSession()).toBeNull();
  });

  it('ruimt een sessie op waarvan de gebruiker niet meer bestaat', async () => {
    await db.kv.put({ key: SESSION_KEY, value: JSON.stringify({ userId: 'weg' }) });
    expect(await provider.getSession()).toBeNull();
    expect(await db.kv.get(SESSION_KEY)).toBeUndefined();
  });

  it('negeert een corrupte sessie', async () => {
    await db.kv.put({ key: SESSION_KEY, value: '{niet json' });
    expect(await provider.getSession()).toBeNull();
  });

  it('meldt wijzigingen via onAuthChange en kan afmelden', async () => {
    const seen: Array<string | null> = [];
    const unsubscribe = provider.onAuthChange((u) => seen.push(u ? u.email : null));

    await provider.signUp('rider@example.com', 'geheim123', 'Ryan');
    await provider.signOut();
    await provider.signIn('rider@example.com', 'geheim123');
    expect(seen).toEqual(['rider@example.com', null, 'rider@example.com']);

    unsubscribe();
    await provider.signOut();
    expect(seen).toHaveLength(3);
  });
});

describe('wachtwoord-hashing', () => {
  it('hashPassword is deterministisch per salt en verschilt per salt', async () => {
    const saltA = bytesToBase64(randomSalt());
    const saltB = bytesToBase64(randomSalt());
    expect(saltA).not.toBe(saltB);

    const h1 = await hashPassword('geheim123', saltA, 1000);
    const h2 = await hashPassword('geheim123', saltA, 1000);
    const h3 = await hashPassword('geheim123', saltB, 1000);
    const h4 = await hashPassword('geheim124', saltA, 1000);
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
    expect(h1).not.toBe(h4);
    expect(base64ToBytes(h1)).toHaveLength(32);
  });

  it('verifyPassword accepteert alleen het juiste wachtwoord', async () => {
    const salt = bytesToBase64(randomSalt());
    const passwordHash = await hashPassword('geheim123', salt, 1000);
    const record = { passwordHash, salt, iterations: 1000 };
    expect(await verifyPassword('geheim123', record)).toBe(true);
    expect(await verifyPassword('geheim124', record)).toBe(false);
    expect(await verifyPassword('', record)).toBe(false);
  });

  it('constantTimeEqual vergelijkt alle bytes', () => {
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2]))).toBe(false);
    expect(constantTimeEqual(new Uint8Array([]), new Uint8Array([]))).toBe(true);
  });

  it('base64-hulpfuncties zijn elkaars inverse', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 128]);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it('gebruikt Web Crypto van globalThis', async () => {
    const spy = vi.spyOn(globalThis.crypto.subtle, 'deriveBits');
    await hashPassword('x', bytesToBase64(randomSalt()), 10);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
