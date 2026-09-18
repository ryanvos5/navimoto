import type { AuthUser } from '@/types';

export type AuthProviderName = 'local' | 'supabase';

export type AuthErrorCode =
  | 'invalid_credentials'
  | 'email_in_use'
  | 'weak_password'
  | 'invalid_email'
  | 'network'
  | 'confirm_email'
  | 'unknown';

/** Nederlandse standaardteksten per foutcode. */
export const AUTH_ERROR_MESSAGES: Record<AuthErrorCode, string> = {
  invalid_credentials: 'Onjuist e-mailadres of wachtwoord.',
  email_in_use: 'Er bestaat al een account met dit e-mailadres.',
  weak_password: 'Het wachtwoord moet minimaal 8 tekens bevatten.',
  invalid_email: 'Vul een geldig e-mailadres in.',
  network: 'Geen verbinding. Controleer je internetverbinding en probeer het opnieuw.',
  confirm_email: 'Bijna klaar! We hebben je een e-mail gestuurd. Tik op de link in die mail om je adres te bevestigen; daarna kun je hier inloggen.',
  unknown: 'Er is iets misgegaan. Probeer het opnieuw.',
};

export class AuthError extends Error {
  readonly code: AuthErrorCode;

  constructor(code: AuthErrorCode, message?: string) {
    super(message ?? AUTH_ERROR_MESSAGES[code]);
    this.name = 'AuthError';
    this.code = code;
  }
}

export interface AuthProvider {
  readonly name: AuthProviderName;
  getSession(): Promise<AuthUser | null>;
  signUp(email: string, password: string, displayName: string): Promise<AuthUser>;
  signIn(email: string, password: string): Promise<AuthUser>;
  signOut(): Promise<void>;
  /** Meldt wijzigingen van de ingelogde gebruiker; geeft een unsubscribe-functie terug. */
  onAuthChange(cb: (user: AuthUser | null) => void): () => void;
}
