// Eén gedeelde Supabase-client (lui geladen) voor auth én data-synchronisatie.
// Zonder VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY is Supabase uit en werkt de app volledig lokaal.
import type { SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? '';
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? '';

let clientPromise: Promise<SupabaseClient> | null = null;

export function isSupabaseConfigured(): boolean {
  return url.length > 0 && anonKey.length > 0;
}

export function supabaseConfig(): { url: string; anonKey: string } {
  return { url, anonKey };
}

/** De gedeelde client; null als Supabase niet is geconfigureerd. */
export function getSupabaseClient(): Promise<SupabaseClient> | null {
  if (!isSupabaseConfigured()) return null;
  if (!clientPromise) {
    clientPromise = import('@supabase/supabase-js').then(({ createClient }) => createClient(url, anonKey));
  }
  return clientPromise;
}

/** Alleen voor tests: client vervangen/resetten. */
export function _setSupabaseClientForTests(client: SupabaseClient | null): void {
  clientPromise = client ? Promise.resolve(client) : null;
}
