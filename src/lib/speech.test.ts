import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class MockUtterance {
  text: string;
  lang = '';
  rate = 0;
  voice: SpeechSynthesisVoice | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

function voice(lang: string, name = lang): SpeechSynthesisVoice {
  return { lang, name, default: false, localService: true, voiceURI: name } as SpeechSynthesisVoice;
}

let voices: SpeechSynthesisVoice[] = [];
const synth = {
  speak: vi.fn(),
  cancel: vi.fn(),
  getVoices: vi.fn(() => voices),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
};

/** Verse module per test: de stem wordt in modulescope gecachet. */
async function loadSpeech() {
  vi.resetModules();
  return import('./speech');
}

function stubSpeech() {
  vi.stubGlobal('window', { speechSynthesis: synth });
  vi.stubGlobal('SpeechSynthesisUtterance', MockUtterance);
}

function lastUtterance(): MockUtterance {
  const calls = synth.speak.mock.calls;
  return calls[calls.length - 1][0] as MockUtterance;
}

beforeEach(() => {
  voices = [];
  synth.speak.mockClear();
  synth.cancel.mockClear();
  synth.getVoices.mockClear();
  synth.addEventListener.mockClear();
  synth.removeEventListener.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('speech', () => {
  it('is niet beschikbaar zonder window en spreekt dan niets uit', async () => {
    const { isSpeechAvailable, speak, cancelSpeech } = await loadSpeech();
    expect(isSpeechAvailable()).toBe(false);
    expect(() => speak('Sla rechtsaf.')).not.toThrow();
    expect(() => cancelSpeech()).not.toThrow();
    expect(synth.speak).not.toHaveBeenCalled();
  });

  it('is niet beschikbaar zonder speechSynthesis', async () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('SpeechSynthesisUtterance', MockUtterance);
    const { isSpeechAvailable, speak } = await loadSpeech();
    expect(isSpeechAvailable()).toBe(false);
    expect(() => speak('Sla rechtsaf.')).not.toThrow();
  });

  it('is beschikbaar met window.speechSynthesis en SpeechSynthesisUtterance', async () => {
    stubSpeech();
    const { isSpeechAvailable } = await loadSpeech();
    expect(isSpeechAvailable()).toBe(true);
  });

  it('spreekt in nl-NL met rate 1.0 en geeft voorrang aan de nl-NL-stem', async () => {
    stubSpeech();
    voices = [voice('en-US'), voice('nl-BE'), voice('nl-NL'), voice('de-DE')];
    const { speak } = await loadSpeech();
    speak('Over 300 meter rechtsaf.');
    expect(synth.speak).toHaveBeenCalledTimes(1);
    const utt = lastUtterance();
    expect(utt).toBeInstanceOf(MockUtterance);
    expect(utt.text).toBe('Over 300 meter rechtsaf.');
    expect(utt.lang).toBe('nl-NL');
    expect(utt.rate).toBe(1);
    expect(utt.voice?.lang).toBe('nl-NL');
    expect(synth.cancel).not.toHaveBeenCalled();
  });

  it('valt terug op een andere nl-stem (ook met underscore)', async () => {
    stubSpeech();
    voices = [voice('en-GB'), voice('nl_BE')];
    const { speak } = await loadSpeech();
    speak('Rechtdoor.');
    expect(lastUtterance().voice?.lang).toBe('nl_BE');
  });

  it('laat de stem leeg als er geen Nederlandse stem is', async () => {
    stubSpeech();
    voices = [voice('en-US'), voice('fr-FR')];
    const { speak } = await loadSpeech();
    speak('Rechtdoor.');
    expect(lastUtterance().voice).toBeNull();
    expect(lastUtterance().lang).toBe('nl-NL');
  });

  it('cachet de gevonden stem (getVoices wordt niet opnieuw opgevraagd)', async () => {
    stubSpeech();
    voices = [voice('nl-NL')];
    const { speak } = await loadSpeech();
    speak('Een.');
    speak('Twee.');
    expect(synth.getVoices).toHaveBeenCalledTimes(1);
    expect(synth.addEventListener).not.toHaveBeenCalled();
  });

  it('wacht op voiceschanged als de stemmen nog niet geladen zijn', async () => {
    stubSpeech();
    const { speak } = await loadSpeech();
    speak('Een.');
    expect(lastUtterance().voice).toBeNull();
    expect(synth.addEventListener).toHaveBeenCalledTimes(1);
    expect(synth.addEventListener.mock.calls[0][0]).toBe('voiceschanged');
    const handler = synth.addEventListener.mock.calls[0][1] as () => void;

    speak('Twee.');
    expect(lastUtterance().voice).toBeNull();
    expect(synth.addEventListener).toHaveBeenCalledTimes(1); // maar één keer aangemeld

    voices = [voice('nl-NL')];
    handler();
    expect(synth.removeEventListener).toHaveBeenCalledWith('voiceschanged', handler);

    speak('Drie.');
    expect(lastUtterance().voice?.lang).toBe('nl-NL');
  });

  it('interrupt annuleert eerst de wachtrij', async () => {
    stubSpeech();
    const { speak } = await loadSpeech();
    speak('Nu rechtsaf.', { interrupt: true });
    expect(synth.cancel).toHaveBeenCalledTimes(1);
    expect(synth.speak).toHaveBeenCalledTimes(1);
    expect(synth.cancel.mock.invocationCallOrder[0]).toBeLessThan(synth.speak.mock.invocationCallOrder[0]);
  });

  it('spreekt lege tekst niet uit', async () => {
    stubSpeech();
    const { speak } = await loadSpeech();
    speak('   ');
    expect(synth.speak).not.toHaveBeenCalled();
  });

  it('cancelSpeech roept speechSynthesis.cancel aan', async () => {
    stubSpeech();
    const { cancelSpeech } = await loadSpeech();
    cancelSpeech();
    expect(synth.cancel).toHaveBeenCalledTimes(1);
  });

  it('vangt fouten van de browser op zonder te gooien', async () => {
    stubSpeech();
    synth.speak.mockImplementationOnce(() => {
      throw new Error('not allowed');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { speak } = await loadSpeech();
    expect(() => speak('Test.')).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
