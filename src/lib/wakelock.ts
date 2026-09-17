// Screen Wake Lock: houdt het scherm aan tijdens het navigeren. Niet ondersteund -> no-op.

/**
 * Vraagt een screen wake lock aan en houdt die vast: wordt de pagina verborgen (de browser laat het
 * lock dan los), dan wordt het opnieuw aangevraagd zodra de pagina weer zichtbaar is. De teruggegeven
 * functie laat het lock los en ruimt de listener op. Fouten worden gelogd (console.warn), nooit gegooid.
 */
export async function requestWakeLock(): Promise<() => void> {
  if (typeof navigator === 'undefined' || !('wakeLock' in navigator) || !navigator.wakeLock) {
    return () => {};
  }
  const wakeLock = navigator.wakeLock;
  const hasDocument = typeof document !== 'undefined';
  let sentinel: WakeLockSentinel | null = null;
  let released = false;

  const acquire = async (): Promise<void> => {
    if (released) return;
    if (sentinel && !sentinel.released) return;
    try {
      const s = await wakeLock.request('screen');
      if (released) {
        // Losgelaten terwijl de aanvraag liep: direct weer vrijgeven.
        await s.release();
        return;
      }
      sentinel = s;
    } catch (err) {
      console.warn('Wake lock niet beschikbaar', err);
    }
  };

  const onVisibilityChange = (): void => {
    if (!released && document.visibilityState === 'visible') void acquire();
  };
  if (hasDocument) document.addEventListener('visibilitychange', onVisibilityChange);

  await acquire();

  return () => {
    if (released) return;
    released = true;
    if (hasDocument) document.removeEventListener('visibilitychange', onVisibilityChange);
    const s = sentinel;
    sentinel = null;
    if (s && !s.released) {
      s.release().catch((err: unknown) => console.warn('Wake lock loslaten mislukt', err));
    }
  };
}
