// "App bijwerken": service worker verversen, alle caches wissen en de app opnieuw laden.
// Zo krijgt een geïnstalleerde PWA gegarandeerd de nieuwste versie van navimoto.vos-oss.nl.

/** Wist alle Cache Storage-caches en laat de service worker(s) op een update controleren. */
export async function clearAppCaches(): Promise<{ caches: number; workers: number }> {
  let cacheCount = 0;
  let workerCount = 0;
  if (typeof caches !== 'undefined') {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    cacheCount = keys.length;
  }
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    workerCount = registrations.length;
    await Promise.all(
      registrations.map(async (r) => {
        try {
          await r.update();
        } catch {
          /* geen verbinding: dan laden we gewoon opnieuw */
        }
        // Wachtende nieuwe versie direct activeren.
        r.waiting?.postMessage({ type: 'SKIP_WAITING' });
      }),
    );
  }
  return { caches: cacheCount, workers: workerCount };
}

/** Herlaadt de app zonder browsercache (cache-busting query op de huidige URL). */
export function reloadApp(): void {
  const url = new URL(window.location.href);
  url.searchParams.set('v', String(Date.now()));
  window.location.replace(url.toString());
}
