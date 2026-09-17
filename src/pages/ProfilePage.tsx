import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { AccountCard } from '@/components/profile/AccountCard';
import { RiderTypeCards } from '@/components/profile/RiderTypeCards';
import { Section } from '@/components/profile/Section';
import { StatsRow } from '@/components/profile/StatsRow';
import { Button } from '@/components/ui/Button';
import { Segmented } from '@/components/ui/Segmented';
import { Spinner } from '@/components/ui/Spinner';
import { Toggle } from '@/components/ui/Toggle';
import { useAuth } from '@/store/useAuth';
import { useSettings } from '@/store/useSettings';
import { useToast } from '@/store/useToast';
import {
  AVOID_LABELS,
  MAP_STYLE_LABELS,
  STYLE_DESCRIPTIONS,
  STYLE_LABELS,
  type AvoidOptions,
  type MapStyleId,
  type RiderType,
  type RouteStyle,
  type UserProfile,
} from '@/types';

const STYLE_ORDER: readonly RouteStyle[] = ['avontuurlijk', 'bochtig', 'snel'];
const AVOID_ORDER: readonly (keyof AvoidOptions)[] = ['highways', 'tolls', 'ferries', 'unpaved'];
const MAP_STYLE_ORDER: readonly MapStyleId[] = ['light', 'osm', 'topo', 'cyclosm'];
const APP_VERSION = import.meta.env.VITE_APP_VERSION || '0.1.0';

export default function ProfilePage() {
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const providerName = useAuth((s) => s.providerName);
  const signOut = useAuth((s) => s.signOut);
  const profile = useSettings((s) => s.profile);
  const update = useSettings((s) => s.update);
  const [pending, setPending] = useState<'signOut' | 'createAccount' | null>(null);

  /** Bewaart een profielwijziging (optimistisch via useSettings.update); geeft true terug als het gelukt is. */
  const save = useCallback(
    async (patch: Partial<UserProfile>, successMessage?: string): Promise<boolean> => {
      try {
        await update(patch);
        if (successMessage) useToast.getState().show(successMessage, { type: 'success' });
        return true;
      } catch (err) {
        console.error('Profiel opslaan is mislukt', err);
        useToast.getState().show('Opslaan is mislukt. Probeer het opnieuw.', { type: 'error' });
        return false;
      }
    },
    [update],
  );

  if (!user || !profile) {
    return (
      <div className="flex min-h-full items-center justify-center py-24">
        <Spinner size="lg" />
      </div>
    );
  }

  const isStreet = profile.riderType === 'street';

  const handleRiderType = (riderType: RiderType) => {
    if (riderType === profile.riderType) return;
    const patch: Partial<UserProfile> = { riderType };
    if (riderType === 'street') {
      // Street-rijders vermijden onverhard altijd.
      patch.defaultAvoid = { ...profile.defaultAvoid, unpaved: true };
    } else if (isStreet) {
      // Weg van Street: de (afgedwongen) vermijding van onverhard weer loslaten, anders krijgt een
      // allroad-/offroadrijder nooit onverharde wegen (avoid.unpaved overschrijft het rijderstype).
      patch.defaultAvoid = { ...profile.defaultAvoid, unpaved: false };
    }
    void save(patch, 'Rijderstype opgeslagen');
  };

  const setAvoid = (key: keyof AvoidOptions, checked: boolean) => {
    void save({ defaultAvoid: { ...profile.defaultAvoid, [key]: checked } });
  };

  const handleSignOut = async () => {
    if (pending) return;
    setPending('signOut');
    try {
      await signOut(); // App (RequireAuth) stuurt daarna door naar /login
    } finally {
      setPending(null);
    }
  };

  const handleCreateAccount = async () => {
    if (pending) return;
    setPending('createAccount');
    try {
      await signOut();
      navigate('/login', { replace: true, state: { mode: 'register' } });
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 pb-10 pt-[calc(var(--safe-top)+16px)]">
      <header className="px-1">
        <h1 className="text-2xl font-bold">Profiel</h1>
      </header>

      <Section title="Account">
        <AccountCard
          user={user}
          profile={profile}
          providerName={providerName}
          onSaveName={(displayName) => save({ displayName }, 'Naam opgeslagen')}
          onCreateAccount={() => void handleCreateAccount()}
          creatingAccount={pending === 'createAccount'}
        />
      </Section>

      <Section title="Wat voor rijder ben je?">
        <RiderTypeCards value={profile.riderType} onChange={handleRiderType} />
      </Section>

      <Section title="Standaard routevoorkeuren">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-muted">Rijstijl</p>
            <Segmented<RouteStyle>
              ariaLabel="Standaard rijstijl"
              value={profile.defaultStyle}
              onChange={(defaultStyle) => void save({ defaultStyle })}
              options={STYLE_ORDER.map((style) => ({ value: style, label: STYLE_LABELS[style] }))}
            />
            <p className="text-sm text-muted">{STYLE_DESCRIPTIONS[profile.defaultStyle]}</p>
          </div>

          <div>
            <p className="text-sm font-medium text-muted">Vermijden</p>
            <div className="divide-y divide-line">
              {AVOID_ORDER.map((key) => {
                const forced = key === 'unpaved' && isStreet;
                return (
                  <Toggle
                    key={key}
                    label={AVOID_LABELS[key]}
                    description={forced ? 'Altijd aan voor Street-rijders' : undefined}
                    checked={forced || profile.defaultAvoid[key]}
                    disabled={forced}
                    onChange={(checked) => setAvoid(key, checked)}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </Section>

      <Section title="Navigatie en kaart">
        <div className="flex flex-col gap-3">
          <div className="divide-y divide-line">
            <Toggle
              label="Gesproken instructies"
              description="Spreekt de aanwijzingen uit tijdens het rijden."
              checked={profile.voiceEnabled}
              onChange={(voiceEnabled) => void save({ voiceEnabled })}
            />
            <Toggle
              label="Demo-modus: rit simuleren"
              description="Simuleert een rit langs de route zonder GPS. Handig om de navigatie te bekijken."
              checked={profile.simulateRides}
              onChange={(simulateRides) => void save({ simulateRides })}
            />
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-muted">Kaartstijl</p>
            <Segmented<MapStyleId>
              ariaLabel="Kaartstijl"
              value={profile.mapStyle}
              onChange={(mapStyle) => void save({ mapStyle })}
              options={MAP_STYLE_ORDER.map((id) => ({ value: id, label: MAP_STYLE_LABELS[id] }))}
            />
          </div>
        </div>
      </Section>

      <Section title="Statistieken">
        <StatsRow />
      </Section>

      <Section title="Over Navimoto">
        <div className="flex flex-col gap-3 text-sm text-muted">
          <div className="flex items-center justify-between gap-3">
            <Logo size={32} />
            <span>Versie {APP_VERSION}</span>
          </div>
          <p>
            Kaartgegevens ©{' '}
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 hover:text-ink"
            >
              OpenStreetMap-bijdragers
            </a>
          </p>
          <p>Routing: Valhalla · Zoeken: Photon / Nominatim</p>
        </div>
      </Section>

      <Button
        variant="danger"
        size="lg"
        block
        icon={<LogOut size={20} aria-hidden />}
        onClick={() => void handleSignOut()}
        loading={pending === 'signOut'}
        disabled={pending === 'createAccount'}
      >
        Uitloggen
      </Button>
    </div>
  );
}
