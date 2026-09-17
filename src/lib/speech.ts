// Gesproken instructies via de Web Speech API (SpeechSynthesis). Nederlandse stem als die er is.

let cachedVoice: SpeechSynthesisVoice | null = null;
let voicesListenerAttached = false;

function getSynth(): SpeechSynthesis | null {
  if (typeof window === 'undefined') return null;
  if (!('speechSynthesis' in window)) return null;
  return window.speechSynthesis ?? null;
}

export function isSpeechAvailable(): boolean {
  return getSynth() !== null && typeof SpeechSynthesisUtterance !== 'undefined';
}

function normalizeLang(lang: string | undefined): string {
  return (lang ?? '').toLowerCase().replace('_', '-');
}

/** Voorkeur: exact nl-NL, anders een willekeurige nl-stem (nl-BE, nl, ...). */
function pickDutchVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  return (
    voices.find((v) => normalizeLang(v.lang) === 'nl-nl') ??
    voices.find((v) => normalizeLang(v.lang).startsWith('nl')) ??
    null
  );
}

function listVoices(synth: SpeechSynthesis): SpeechSynthesisVoice[] {
  try {
    return typeof synth.getVoices === 'function' ? (synth.getVoices() ?? []) : [];
  } catch {
    return [];
  }
}

/**
 * Zoekt de Nederlandse stem en onthoudt die. Stemmen laden in sommige browsers asynchroon:
 * dan luisteren we (eenmalig aangemeld) naar 'voiceschanged' en cachen zodra er een is.
 */
function resolveVoice(synth: SpeechSynthesis): SpeechSynthesisVoice | null {
  if (cachedVoice) return cachedVoice;
  cachedVoice = pickDutchVoice(listVoices(synth));
  if (!cachedVoice && !voicesListenerAttached && typeof synth.addEventListener === 'function') {
    voicesListenerAttached = true;
    const onVoicesChanged = (): void => {
      cachedVoice = pickDutchVoice(listVoices(synth));
      if (cachedVoice && typeof synth.removeEventListener === 'function') {
        synth.removeEventListener('voiceschanged', onVoicesChanged);
      }
    };
    synth.addEventListener('voiceschanged', onVoicesChanged);
  }
  return cachedVoice;
}

/** Spreekt `text` uit (nl-NL). Met `interrupt` wordt eerst alles wat nog in de wachtrij staat gestopt. */
export function speak(text: string, opts?: { interrupt?: boolean }): void {
  const synth = getSynth();
  if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return;
  try {
    if (opts?.interrupt) synth.cancel();
    const trimmed = text.trim();
    if (!trimmed) return;
    const utterance = new SpeechSynthesisUtterance(trimmed);
    utterance.lang = 'nl-NL';
    utterance.rate = 1.0;
    const voice = resolveVoice(synth);
    if (voice) utterance.voice = voice;
    synth.speak(utterance);
  } catch (err) {
    console.warn('Spraak mislukt', err);
  }
}

export function cancelSpeech(): void {
  const synth = getSynth();
  if (!synth) return;
  try {
    synth.cancel();
  } catch (err) {
    console.warn('Spraak stoppen mislukt', err);
  }
}
