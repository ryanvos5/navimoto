// Supabase-accounts. De client wordt lui aangemaakt (dynamische import), zodat de bundel zonder
// Supabase-configuratie de bibliotheek niet laadt.
import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { AuthUser } from '@/types';
import { AuthError, type AuthProvider } from './types';
import { getSupabaseClient } from '@/services/supabaseClient';

const CONFIRM_EMAIL_MESSAGE = 'Controleer je e-mail om je account te bevestigen en log daarna in.';
const EMAIL_NOT_CONFIRMED_MESSAGE = 'Bevestig eerst je e-mailadres via de link in je mailbox en log daarna in.';

export function toAuthUser(user: User): AuthUser {
  const email = user.email ?? '';
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const fromMeta = typeof meta.display_name === 'string' ? meta.display_name.trim() : '';
  const displayName = fromMeta || email.split('@')[0] || 'Rijder';
  return { id: user.id, email, displayName, isGuest: false };
}

/** Vertaalt een Supabase-/netwerkfout naar een AuthError. */
export function mapSupabaseError(err: unknown): AuthError {
  if (err instanceof AuthError) return err;
  const obj = err && typeof err === 'object' ? (err as { code?: unknown; message?: unknown; name?: unknown }) : null;
  const code = typeof obj?.code === 'string' ? obj.code : '';
  const message = err instanceof Error ? err.message : typeof obj?.message === 'string' ? obj.message : String(err ?? '');
  const m = message.toLowerCase();

  switch (code) {
    case 'invalid_credentials':
      return new AuthError('invalid_credentials');
    case 'user_already_exists':
    case 'email_exists':
      return new AuthError('email_in_use');
    case 'weak_password':
      return new AuthError('weak_password');
    case 'email_address_invalid':
      return new AuthError('invalid_email');
    case 'email_not_confirmed':
      return new AuthError('unknown', EMAIL_NOT_CONFIRMED_MESSAGE);
    default:
      break;
  }

  if (m.includes('invalid login credentials')) return new AuthError('invalid_credentials');
  if (m.includes('already registered') || m.includes('already exists')) return new AuthError('email_in_use');
  if (m.includes('password should be') || m.includes('at least')) return new AuthError('weak_password');
  if (m.includes('valid email') || m.includes('invalid format')) return new AuthError('invalid_email');
  if (m.includes('email not confirmed')) return new AuthError('unknown', EMAIL_NOT_CONFIRMED_MESSAGE);
  const name = typeof obj?.name === 'string' ? obj.name : '';
  if (
    name === 'AuthRetryableFetchError' ||
    err instanceof TypeError ||
    m.includes('fetch') ||
    m.includes('network') ||
    m.includes('load failed')
  ) {
    return new AuthError('network');
  }
  return new AuthError('unknown');
}

export class SupabaseAuthProvider implements AuthProvider {
  readonly name = 'supabase' as const;
  private clientPromise: Promise<SupabaseClient> | null = null;

  constructor(
    private readonly url: string,
    private readonly anonKey: string,
  ) {}

  private getClient(): Promise<SupabaseClient> {
    if (!this.clientPromise) {
      // Dezelfde client als de data-synchronisatie (services/cloud.ts), zodat RLS de ingelogde sessie ziet.
      const shared = getSupabaseClient();
      this.clientPromise =
        shared ??
        import('@supabase/supabase-js').then(({ createClient }) => createClient(this.url, this.anonKey));
    }
    return this.clientPromise;
  }

  async getSession(): Promise<AuthUser | null> {
    try {
      const client = await this.getClient();
      const { data, error } = await client.auth.getSession();
      if (error) throw mapSupabaseError(error);
      return data.session?.user ? toAuthUser(data.session.user) : null;
    } catch (err) {
      throw mapSupabaseError(err);
    }
  }

  async signUp(email: string, password: string, displayName: string): Promise<AuthUser> {
    try {
      const client = await this.getClient();
      const { data, error } = await client.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { display_name: displayName.trim() || email.trim().split('@')[0] } },
      });
      if (error) throw mapSupabaseError(error);
      // Bij een bestaand adres geeft Supabase (met e-mailbevestiging aan) een "lege" gebruiker zonder identities terug.
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        throw new AuthError('email_in_use');
      }
      if (!data.session || !data.user) throw new AuthError('unknown', CONFIRM_EMAIL_MESSAGE);
      return toAuthUser(data.user);
    } catch (err) {
      throw mapSupabaseError(err);
    }
  }

  async signIn(email: string, password: string): Promise<AuthUser> {
    try {
      const client = await this.getClient();
      const { data, error } = await client.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw mapSupabaseError(error);
      if (!data.user) throw new AuthError('invalid_credentials');
      return toAuthUser(data.user);
    } catch (err) {
      throw mapSupabaseError(err);
    }
  }

  async signOut(): Promise<void> {
    try {
      const client = await this.getClient();
      const { error } = await client.auth.signOut();
      if (error) throw mapSupabaseError(error);
    } catch (err) {
      throw mapSupabaseError(err);
    }
  }

  onAuthChange(cb: (user: AuthUser | null) => void): () => void {
    let active = true;
    let subscription: { unsubscribe: () => void } | null = null;
    void this.getClient()
      .then((client) => {
        if (!active) return;
        const { data } = client.auth.onAuthStateChange((_event, session) => {
          if (!active) return;
          cb(session?.user ? toAuthUser(session.user) : null);
        });
        subscription = data.subscription;
        if (!active) subscription.unsubscribe();
      })
      .catch((err: unknown) => {
        console.warn('Supabase auth listener kon niet worden gestart', err);
      });
    return () => {
      active = false;
      subscription?.unsubscribe();
      subscription = null;
    };
  }
}
