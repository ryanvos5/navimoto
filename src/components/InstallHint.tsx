// Uitleg "Zet Navimoto op je beginscherm", eenmalig getoond bij het eerste bezoek in de browser.
// Android/Chrome: directe installatieknop via het beforeinstallprompt-event. iOS/Safari: stappenuitleg.
import { useEffect, useState } from 'react';
import { Download, Share, SquarePlus, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Logo } from '@/components/Logo';

const DISMISSED_KEY = 'navimoto.installHintDismissed';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const promptListeners = new Set<() => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    promptListeners.forEach((l) => l());
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    safeSet(DISMISSED_KEY, '1');
    promptListeners.forEach((l) => l());
  });
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* privémodus of geblokkeerde opslag: dan zien we de uitleg gewoon nog een keer */
  }
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return true;
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.('(display-mode: standalone)').matches || nav.standalone === true;
}

export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const iPadOs = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return /iPhone|iPad|iPod/i.test(ua) || iPadOs;
}

/** Toont de uitleg als de app in een gewone browser draait en de gebruiker hem nog niet heeft weggeklikt. */
export function InstallHint() {
  const [open, setOpen] = useState(() => !isStandalone() && safeGet(DISMISSED_KEY) !== '1');
  const [canPrompt, setCanPrompt] = useState(() => deferredPrompt !== null);

  useEffect(() => {
    const update = () => setCanPrompt(deferredPrompt !== null);
    promptListeners.add(update);
    return () => {
      promptListeners.delete(update);
    };
  }, []);

  if (!open) return null;

  const dismiss = () => {
    safeSet(DISMISSED_KEY, '1');
    setOpen(false);
  };

  const install = async () => {
    const evt = deferredPrompt;
    if (!evt) return;
    deferredPrompt = null;
    await evt.prompt();
    const choice = await evt.userChoice;
    if (choice.outcome === 'accepted') dismiss();
    else setCanPrompt(false);
  };

  const ios = isIos();

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 pb-[calc(var(--safe-bottom)+16px)]" role="dialog" aria-modal="true" aria-labelledby="install-title">
      <div className="w-full max-w-md rounded-3xl border border-line bg-surface-2 p-5 shadow-2xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <Logo size={28} />
          <button type="button" onClick={dismiss} aria-label="Sluiten" className="rounded-full p-2 text-muted hover:bg-surface-3 hover:text-ink">
            <X size={20} />
          </button>
        </div>
        <h2 id="install-title" className="text-xl font-bold">
          Zet Navimoto op je beginscherm
        </h2>
        <p className="mt-1 text-sm text-muted">
          Dan opent Navimoto als een echte app, schermvullend en zonder browserbalk. Handig op de motor.
        </p>

        {ios ? (
          <ol className="mt-4 flex flex-col gap-3 text-sm">
            <li className="flex items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand/15 font-bold text-brand">1</span>
              <span>
                Tik in Safari op de <strong>Deel</strong>-knop <Share size={16} className="inline align-text-bottom" aria-hidden /> onderaan het scherm.
              </span>
            </li>
            <li className="flex items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand/15 font-bold text-brand">2</span>
              <span>
                Kies <strong>Zet op beginscherm</strong> <SquarePlus size={16} className="inline align-text-bottom" aria-hidden />.
              </span>
            </li>
            <li className="flex items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand/15 font-bold text-brand">3</span>
              <span>
                Tik rechtsboven op <strong>Voeg toe</strong>. Navimoto staat nu tussen je apps.
              </span>
            </li>
          </ol>
        ) : canPrompt ? (
          <p className="mt-4 text-sm">Tik op de knop hieronder en bevestig de installatie.</p>
        ) : (
          <ol className="mt-4 flex flex-col gap-3 text-sm">
            <li className="flex items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand/15 font-bold text-brand">1</span>
              <span>
                Open het menu van je browser (de drie puntjes <strong>⋮</strong> rechtsboven).
              </span>
            </li>
            <li className="flex items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand/15 font-bold text-brand">2</span>
              <span>
                Kies <strong>App installeren</strong> of <strong>Toevoegen aan startscherm</strong>.
              </span>
            </li>
          </ol>
        )}

        <div className="mt-5 flex flex-col gap-2">
          {!ios && canPrompt && (
            <Button size="lg" block icon={<Download size={20} aria-hidden />} onClick={() => void install()}>
              Installeren
            </Button>
          )}
          <Button variant={!ios && canPrompt ? 'ghost' : 'secondary'} size="lg" block onClick={dismiss}>
            {ios || !canPrompt ? 'Begrepen' : 'Later'}
          </Button>
        </div>
      </div>
    </div>
  );
}
