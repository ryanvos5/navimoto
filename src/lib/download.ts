// Tekstbestand downloaden of delen (Web Share API) - voor GPX-export van routes en ritten.

export const GPX_MIME = 'application/gpx+xml';

function isAbortError(e: unknown): boolean {
  return e !== null && typeof e === 'object' && (e as { name?: unknown }).name === 'AbortError';
}

/** Download via Blob + object-URL + <a download>. De object-URL wordt na de klik weer ingetrokken. */
export function downloadTextFile(name: string, text: string, mime = GPX_MIME): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Niet meteen intrekken: Safari en Firefox starten de download asynchroon vanaf de object-URL.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function canShareFiles(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function' &&
    typeof File === 'function'
  );
}

/**
 * Deelt het bestand via het deelmenu van het toestel als dat kan (navigator.share met bestanden),
 * anders wordt het gedownload. Een door de gebruiker geannuleerd deelmenu (AbortError) telt als 'shared':
 * dan geen download als terugval.
 */
export async function shareOrDownload(name: string, text: string, mime = GPX_MIME): Promise<'shared' | 'downloaded'> {
  if (canShareFiles()) {
    const file = new File([text], name, { type: mime });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name });
        return 'shared';
      } catch (e) {
        if (isAbortError(e)) return 'shared';
        console.warn('Delen mislukt, terugvallen op downloaden', e);
      }
    }
  }
  downloadTextFile(name, text, mime);
  return 'downloaded';
}
