import { useState, type FormEvent } from 'react';
import { Check, Pencil, UserPlus, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import type { AuthProviderName } from '@/services/auth/types';
import type { AuthUser, UserProfile } from '@/types';

export interface AccountCardProps {
  user: AuthUser;
  profile: UserProfile;
  providerName: AuthProviderName;
  /** Bewaart een nieuwe weergavenaam; geeft true terug als het gelukt is. */
  onSaveName: (displayName: string) => Promise<boolean>;
  /** Alleen voor gasten: uitloggen en naar de registratiepagina. */
  onCreateAccount: () => void;
  creatingAccount?: boolean;
}

/** Initialen voor de avatar: "Jan de Vries" → "JV", "Gast" → "G". */
export function initialsOf(name: string, fallback = '?'): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  const first = parts[0].charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : '';
  return (first + last).toUpperCase() || fallback;
}

function providerLabel(user: AuthUser, providerName: AuthProviderName): string {
  if (user.isGuest) return 'Gast';
  return providerName === 'supabase' ? 'Vos Oss-account' : 'Lokaal account';
}

/** Accountkaart: avatar, naam (inline te bewerken), e-mail en accounttype; voor gasten een registratie-oproep. */
export function AccountCard({ user, profile, providerName, onSaveName, onCreateAccount, creatingAccount = false }: AccountCardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Het profiel is leidend (een via het profiel gewijzigde naam blijft bewaard, zie useSettings.load).
  const displayName = profile.displayName.trim() || user.displayName || 'Rijder';
  const email = user.isGuest ? 'Gastaccount' : profile.email || user.email;

  const startEditing = () => {
    setDraft(displayName);
    setNameError(null);
    setEditing(true);
  };

  const stopEditing = () => {
    setEditing(false);
    setNameError(null);
  };

  const submitName = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (saving) return;
    const next = draft.trim();
    if (!next) {
      setNameError('Vul een naam in.');
      return;
    }
    if (next === displayName) {
      stopEditing();
      return;
    }
    setSaving(true);
    try {
      const ok = await onSaveName(next);
      if (ok) stopEditing();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <div
          aria-hidden
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-brand text-2xl font-bold text-white"
        >
          {initialsOf(displayName)}
        </div>

        <div className="min-w-0 flex-1">
          {editing ? (
            <form onSubmit={submitName} noValidate className="flex flex-col gap-2">
              <TextField
                label="Naam"
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  if (nameError) setNameError(null);
                }}
                error={nameError}
                maxLength={40}
                autoComplete="name"
                autoCapitalize="words"
                enterKeyHint="done"
                autoFocus
              />
              <div className="flex gap-2">
                <Button type="submit" loading={saving} icon={<Check size={18} aria-hidden />}>
                  Opslaan
                </Button>
                <Button type="button" variant="ghost" onClick={stopEditing} disabled={saving} icon={<X size={18} aria-hidden />}>
                  Annuleren
                </Button>
              </div>
            </form>
          ) : (
            <>
              <div className="flex items-center gap-1">
                <p className="min-w-0 truncate text-lg font-semibold">{displayName}</p>
                <button
                  type="button"
                  onClick={startEditing}
                  aria-label="Naam bewerken"
                  title="Naam bewerken"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-3 hover:text-ink"
                >
                  <Pencil size={18} aria-hidden />
                </button>
              </div>
              <p className="truncate text-sm text-muted">{email}</p>
              <span className="mt-1.5 inline-block rounded-full bg-surface-3 px-2.5 py-0.5 text-xs font-medium text-muted">
                {providerLabel(user, providerName)}
              </span>
            </>
          )}
        </div>
      </div>

      {user.isGuest && (
        <div className="flex flex-col gap-3 rounded-xl border border-brand/40 bg-brand/10 p-4">
          <p className="text-sm">Maak een account aan om je profiel en ritten aan een account te koppelen.</p>
          <Button block icon={<UserPlus size={18} aria-hidden />} onClick={onCreateAccount} loading={creatingAccount}>
            Account aanmaken
          </Button>
        </div>
      )}
    </div>
  );
}
