// Lokale accounts: gebruikers in IndexedDB (Dexie), wachtwoorden gehasht met PBKDF2-SHA256 (Web Crypto).
// Sessie in localStorage ('navimoto.session') of, als localStorage ontbreekt, in de kv-tabel ('session').
import { db, storageGet, storageRemove, storageSet, type LocalUser } from '@/services/db';
import { newId } from '@/lib/geo';
import type { AuthUser } from '@/types';
import { AuthError, type AuthProvider } from './types';

export const SESSION_KEY = 'session';
export const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BYTES = 32;
const MIN_PASSWORD_LENGTH = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

interface StoredSession {
  userId: string;
}

// ---- hulpfuncties -----------------------------------------------------------

function getSubtle(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new AuthError('unknown', 'Veilige opslag (Web Crypto) is niet beschikbaar in deze browser.');
  return subtle;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function randomSalt(): Uint8Array<ArrayBuffer> {
  const salt = new Uint8Array(new ArrayBuffer(SALT_BYTES));
  globalThis.crypto.getRandomValues(salt);
  return salt;
}

/**
 * PBKDF2-SHA256 van het wachtwoord met de gegeven (base64) salt. Geeft de afgeleide sleutel
 * (32 bytes) terug als base64.
 */
export async function hashPassword(password: string, saltB64: string, iterations: number): Promise<string> {
  const subtle = getSubtle();
  const salt = base64ToBytes(saltB64);
  const keyMaterial = await subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, keyMaterial, KEY_BYTES * 8);
  return bytesToBase64(new Uint8Array(bits));
}

/** Vergelijking in constante tijd: alle bytes worden altijd bekeken, geen vroegtijdige return. */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    const x = i < a.length ? a[i] : 0;
    const y = i < b.length ? b[i] : 0;
    diff |= x ^ y;
  }
  return diff === 0;
}

export async function verifyPassword(
  password: string,
  user: Pick<LocalUser, 'passwordHash' | 'salt' | 'iterations'>,
): Promise<boolean> {
  const derived = await hashPassword(password, user.salt, user.iterations);
  return constantTimeEqual(base64ToBytes(derived), base64ToBytes(user.passwordHash));
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toAuthUser(user: LocalUser): AuthUser {
  return { id: user.id, email: user.email, displayName: user.displayName, isGuest: false };
}

async function readSession(): Promise<StoredSession | null> {
  const raw = await storageGet(SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && typeof (parsed as StoredSession).userId === 'string') {
      return { userId: (parsed as StoredSession).userId };
    }
  } catch {
    // ongeldige sessie: negeren
  }
  return null;
}

// ---- provider -----------------------------------------------------------------

export class LocalAuthProvider implements AuthProvider {
  readonly name = 'local' as const;
  private readonly listeners = new Set<(user: AuthUser | null) => void>();

  async getSession(): Promise<AuthUser | null> {
    const session = await readSession();
    if (!session) return null;
    const user = await db.localUsers.get(session.userId);
    if (!user) {
      await storageRemove(SESSION_KEY);
      return null;
    }
    return toAuthUser(user);
  }

  async signUp(email: string, password: string, displayName: string): Promise<AuthUser> {
    const normalized = normalizeEmail(email);
    if (!EMAIL_RE.test(normalized)) throw new AuthError('invalid_email');
    if (password.length < MIN_PASSWORD_LENGTH) throw new AuthError('weak_password');
    const name = displayName.trim() || normalized.split('@')[0];

    const existing = await db.localUsers.where('email').equals(normalized).first();
    if (existing) throw new AuthError('email_in_use');

    const salt = bytesToBase64(randomSalt());
    const passwordHash = await hashPassword(password, salt, PBKDF2_ITERATIONS);
    const user: LocalUser = {
      id: newId(),
      email: normalized,
      displayName: name,
      passwordHash,
      salt,
      iterations: PBKDF2_ITERATIONS,
      createdAt: Date.now(),
    };
    try {
      await db.localUsers.add(user);
    } catch (err) {
      // Unieke index op e-mail: gelijktijdige registratie met hetzelfde adres.
      if (err instanceof Error && err.name === 'ConstraintError') throw new AuthError('email_in_use');
      throw new AuthError('unknown');
    }
    await storageSet(SESSION_KEY, JSON.stringify({ userId: user.id } satisfies StoredSession));
    const authUser = toAuthUser(user);
    this.emit(authUser);
    return authUser;
  }

  async signIn(email: string, password: string): Promise<AuthUser> {
    const normalized = normalizeEmail(email);
    const user = await db.localUsers.where('email').equals(normalized).first();
    if (!user) throw new AuthError('invalid_credentials');
    const ok = await verifyPassword(password, user);
    if (!ok) throw new AuthError('invalid_credentials');
    await storageSet(SESSION_KEY, JSON.stringify({ userId: user.id } satisfies StoredSession));
    const authUser = toAuthUser(user);
    this.emit(authUser);
    return authUser;
  }

  async signOut(): Promise<void> {
    await storageRemove(SESSION_KEY);
    this.emit(null);
  }

  onAuthChange(cb: (user: AuthUser | null) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private emit(user: AuthUser | null): void {
    for (const cb of Array.from(this.listeners)) {
      try {
        cb(user);
      } catch (err) {
        console.error('auth listener error', err);
      }
    }
  }
}
