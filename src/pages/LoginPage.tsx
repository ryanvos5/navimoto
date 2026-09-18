import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, Eye, EyeOff, Info, Lock, Mail, MailCheck, UserRound } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { Button } from '@/components/ui/Button';
import { Segmented, type SegmentedOption } from '@/components/ui/Segmented';
import { TextField } from '@/components/ui/TextField';
import { useAuth } from '@/store/useAuth';

type Mode = 'login' | 'register';

interface LoginLocationState {
  mode?: Mode;
  from?: string;
}

interface FieldErrors {
  name?: string;
  email?: string;
  password?: string;
}

// Zelfde regels als de lokale auth-provider, zodat fouten al vóór het versturen zichtbaar zijn.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN_PASSWORD_LENGTH = 8;
const DEFAULT_TARGET = '/kaart';

const MODE_OPTIONS: SegmentedOption<Mode>[] = [
  { value: 'login', label: 'Inloggen' },
  { value: 'register', label: 'Account aanmaken' },
];

/** Leest de navigatiestate veilig uit (react-router typeert `state` als any). */
function readState(raw: unknown): LoginLocationState {
  if (!raw || typeof raw !== 'object') return {};
  const s = raw as Record<string, unknown>;
  const from = typeof s.from === 'string' && s.from.startsWith('/') && !s.from.startsWith('/login') ? s.from : undefined;
  return { mode: s.mode === 'register' ? 'register' : undefined, from };
}

export default function LoginPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { mode: stateMode, from } = readState(location.state);
  const target = from ?? DEFAULT_TARGET;

  const status = useAuth((s) => s.status);
  const error = useAuth((s) => s.error);
  const notice = useAuth((s) => s.notice);
  // Terug van de bevestigingslink in de e-mail (?bevestigd=1): melding tonen en klaarzetten om in te loggen.
  const confirmed = new URLSearchParams(location.search).get('bevestigd') === '1';
  // Supabase zet een mislukte bevestiging in de hash (#error_code=otp_expired ...): dan is de link verlopen of al gebruikt.
  const linkError = new URLSearchParams(location.hash.replace(/^#/, '')).get('error_code');
  const linkErrorText = linkError
    ? linkError === 'otp_expired'
      ? 'Deze bevestigingslink is verlopen of al gebruikt. Log in met je account, of maak het opnieuw aan om een nieuwe link te ontvangen.'
      : 'De bevestigingslink kon niet worden verwerkt. Probeer in te loggen of maak je account opnieuw aan.'
    : null;
  const providerName = useAuth((s) => s.providerName);
  const signIn = useAuth((s) => s.signIn);
  const signUp = useAuth((s) => s.signUp);
  const clearError = useAuth((s) => s.clearError);

  const [mode, setMode] = useState<Mode>(stateMode === 'register' ? 'register' : 'login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState<'form' | 'guest' | null>(null);

  // De modus volgt de navigatiestate, ook als de pagina al gemount is
  // (gast tikt op "Account aanmaken" op de profielpagina: eerst redirect door RequireAuth, dan onze navigate).
  useEffect(() => {
    if (stateMode === 'register') setMode('register');
  }, [stateMode]);

  // Ingelogd: terug naar waar de gebruiker vandaan kwam (App redirect zelf al naar /kaart).
  useEffect(() => {
    if (status === 'signedIn') navigate(target, { replace: true });
  }, [status, target, navigate]);

  // Geen oude foutmelding laten staan bij het verlaten van de pagina.
  useEffect(() => () => clearError(), [clearError]);

  const isRegister = mode === 'register';

  /**
   * Na een geslaagde aanmelding. RedirectIfSignedIn in App ontkoppelt deze pagina zodra status
   * 'signedIn' wordt (dus vóór het effect hierboven iets kan doen); daarom hier expliciet naar `from`.
   */
  const finishSignIn = () => {
    const auth = useAuth.getState();
    if (auth.status === 'signedIn' && !auth.error && target !== DEFAULT_TARGET) navigate(target, { replace: true });
  };

  const validate = (): FieldErrors => {
    const errors: FieldErrors = {};
    if (isRegister && !name.trim()) errors.name = 'Vul je naam in.';
    const mail = email.trim();
    if (!mail) errors.email = 'Vul je e-mailadres in.';
    else if (!EMAIL_RE.test(mail)) errors.email = 'Vul een geldig e-mailadres in.';
    if (!password) errors.password = 'Vul je wachtwoord in.';
    else if (isRegister && password.length < MIN_PASSWORD_LENGTH) {
      errors.password = `Het wachtwoord moet minimaal ${MIN_PASSWORD_LENGTH} tekens bevatten.`;
    }
    return errors;
  };

  const clearFieldError = (key: keyof FieldErrors) => {
    if (fieldErrors[key]) setFieldErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    const errors = validate();
    setFieldErrors(errors);
    if (errors.name || errors.email || errors.password) return;

    setBusy('form');
    try {
      // signIn/signUp gooien niet: bij een fout zetten ze `error` in de store (getoond in de alert hieronder).
      if (isRegister) {
        await signUp(email.trim(), password, name.trim());
        // E-mailbevestiging nodig: naar 'Inloggen' met het adres ingevuld, de melding blijft staan.
        if (useAuth.getState().notice) {
          setMode('login');
          setPassword('');
          setFieldErrors({});
        }
      } else {
        await signIn(email.trim(), password);
      }
      finishSignIn();
    } finally {
      setBusy(null);
    }
  };


  const switchMode = (next: Mode) => {
    if (next === mode) return;
    setMode(next);
    setFieldErrors({});
    clearError();
  };

  return (
    <div className="h-full overflow-y-auto bg-surface">
      <div className="flex min-h-full flex-col">
        <main className="mx-auto my-auto flex w-full max-w-md flex-col gap-6 px-6 pb-8 pt-[calc(var(--safe-top)+40px)]">
          <div className="flex flex-col items-center gap-3 text-center">
            <Logo size={52} />
            <p className="text-base text-muted">Navigatie voor motorrijders van Vos Oss</p>
          </div>

          <Segmented<Mode> ariaLabel="Inloggen of account aanmaken" value={mode} onChange={switchMode} options={MODE_OPTIONS} />

          <form onSubmit={handleSubmit} noValidate aria-busy={busy === 'form'} className="flex flex-col gap-4">
            {isRegister && (
              <TextField
                label="Naam"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  clearFieldError('name');
                }}
                error={fieldErrors.name}
                placeholder="Je naam"
                autoComplete="name"
                autoCapitalize="words"
                enterKeyHint="next"
                maxLength={40}
                required
                leading={<UserRound size={18} aria-hidden />}
              />
            )}

            <TextField
              label="E-mailadres"
              type="email"
              inputMode="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                clearFieldError('email');
              }}
              error={fieldErrors.email}
              placeholder="naam@voorbeeld.nl"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="next"
              required
              leading={<Mail size={18} aria-hidden />}
            />

            <TextField
              label="Wachtwoord"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                clearFieldError('password');
              }}
              error={fieldErrors.password}
              hint={isRegister ? `Minimaal ${MIN_PASSWORD_LENGTH} tekens.` : undefined}
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              enterKeyHint="go"
              required
              leading={<Lock size={18} aria-hidden />}
              trailing={
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Wachtwoord verbergen' : 'Wachtwoord tonen'}
                  aria-pressed={showPassword}
                  className="-mr-2 flex h-11 w-11 items-center justify-center rounded-lg text-muted transition-colors hover:text-ink"
                >
                  {showPassword ? <EyeOff size={20} aria-hidden /> : <Eye size={20} aria-hidden />}
                </button>
              }
            />

            {(error || linkErrorText) && (
              <div role="alert" className="flex items-start gap-2 rounded-xl border border-danger/40 bg-danger/15 px-4 py-3 text-sm text-danger">
                <AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden />
                <span>{error ?? linkErrorText}</span>
              </div>
            )}

            {!error && !linkErrorText && (notice || confirmed) && (
              <div role="status" className="flex items-start gap-3 rounded-xl border border-success/40 bg-success/15 px-4 py-3 text-sm text-ink">
                <MailCheck size={20} className="mt-0.5 shrink-0 text-success" aria-hidden />
                <span>
                  {confirmed ? (
                    <>
                      <strong>E-mailadres bevestigd.</strong> Je kunt nu inloggen met je Vos Oss-account.
                    </>
                  ) : (
                    <>
                      <strong>Bijna klaar!</strong> {notice?.replace(/^Bijna klaar!\s*/, '')}
                    </>
                  )}
                </span>
              </div>
            )}

            <Button type="submit" size="lg" block loading={busy === 'form'}>
              {isRegister ? 'Account aanmaken' : 'Inloggen'}
            </Button>
          </form>

          <p className="text-center text-sm text-muted">
            {isRegister
              ? 'Je Vos Oss-account werkt ook op vos-oss.nl. Na het aanmaken ontvang je een e-mail om je adres te bevestigen.'
              : 'Log in met je Vos Oss-account. Nog geen account? Kies "Account aanmaken".'}
          </p>

          {providerName === 'local' && (
            <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted">
              <Info size={14} className="shrink-0" aria-hidden />
              Accounts worden lokaal op dit apparaat opgeslagen.
            </p>
          )}
        </main>

        <footer className="safe-bottom shrink-0 px-6 pb-4 text-center text-xs text-muted">Kaartgegevens © OpenStreetMap-bijdragers</footer>
      </div>
    </div>
  );
}
