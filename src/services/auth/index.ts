// Kiest de auth-provider: Supabase als VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY gezet zijn, anders lokaal.
import type { AuthUser } from '@/types';
import { LocalAuthProvider } from './local';
import { SupabaseAuthProvider } from './supabase';
import type { AuthProvider } from './types';

export { AuthError, AUTH_ERROR_MESSAGES } from './types';
export type { AuthProvider, AuthErrorCode, AuthProviderName } from './types';
export { LocalAuthProvider } from './local';
export { SupabaseAuthProvider } from './supabase';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const authProvider: AuthProvider = url && key ? new SupabaseAuthProvider(url, key) : new LocalAuthProvider();

/** De gastgebruiker: geen account, data blijft lokaal onder id 'guest'. */
export const GUEST_USER: AuthUser = { id: 'guest', email: '', displayName: 'Gast', isGuest: true };
