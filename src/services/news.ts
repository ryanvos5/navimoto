// Nieuws van Vos Oss Motoren uit de gedeelde Supabase-tabel `nieuws_artikelen` (alleen gepubliceerde rijen
// zijn leesbaar via RLS). Resultaten worden 10 minuten in het geheugen gecachet zodat lijst → detail → terug
// niet opnieuw ophaalt. De artikelinhoud is HTML uit een CMS en wordt vóór weergave opgeschoond met
// sanitizeArticleHtml.
import { getSupabaseClient } from './supabaseClient';

export interface NewsArticle {
  id: string;
  title: string;
  slug: string;
  intro: string;
  contentHtml: string;
  imageUrl: string | null;
  category: string | null;
  publishedAt: number;
  url: string;
}

/** Geverifieerd (17-09-2026): vos-oss.nl/nieuws/<slug> geeft 308 naar www.vos-oss.nl/nieuws/<slug> (200). */
export const NEWS_SITE_URL = 'https://www.vos-oss.nl/nieuws';

export const NEWS_CACHE_TTL_MS = 10 * 60 * 1000;
const NEWS_LIMIT = 30;

interface NewsRow {
  id: string;
  titel: string | null;
  slug: string | null;
  intro: string | null;
  inhoud: string | null;
  afbeelding: string | null;
  categorie: string | null;
  created_at: string | null;
}

const fromIso = (value: unknown, fallback = 0): number => {
  if (typeof value !== 'string') return fallback;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : fallback;
};

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

function isHttpsUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https:\/\//i.test(value.trim());
}

/** Vertaalt een databaserij naar een NewsArticle; null als de rij onbruikbaar is (geen id of slug). */
export function rowToArticle(r: NewsRow): NewsArticle | null {
  const id = text(r.id);
  const slug = text(r.slug);
  if (!id || !slug) return null;
  const category = text(r.categorie);
  return {
    id,
    title: text(r.titel) || 'Zonder titel',
    slug,
    intro: text(r.intro),
    contentHtml: typeof r.inhoud === 'string' ? r.inhoud : '',
    imageUrl: isHttpsUrl(r.afbeelding) ? r.afbeelding.trim() : null,
    category: category || null,
    publishedAt: fromIso(r.created_at),
    url: `${NEWS_SITE_URL}/${encodeURIComponent(slug)}`,
  };
}

// ---------------------------------------------------------------------------
// Ophalen + cache
// ---------------------------------------------------------------------------

let cache: { articles: NewsArticle[]; fetchedAt: number } | null = null;
let inflight: Promise<NewsArticle[]> | null = null;

/** Alleen voor tests. */
export function _resetNewsCache(): void {
  cache = null;
  inflight = null;
}

/** Gecachete artikelen (ook als ze verlopen zijn), of null als er nog nooit iets is opgehaald. */
export function getCachedNews(): NewsArticle[] | null {
  return cache?.articles ?? null;
}

async function fetchFromSupabase(signal?: AbortSignal): Promise<NewsArticle[]> {
  const clientPromise = getSupabaseClient();
  if (!clientPromise) throw new Error('Nieuws is niet beschikbaar zonder Supabase-configuratie.');
  const client = await clientPromise;
  let query = client
    .from('nieuws_artikelen')
    .select('id,titel,slug,intro,afbeelding,categorie,created_at,inhoud')
    .eq('gepubliceerd', true)
    .order('created_at', { ascending: false })
    .limit(NEWS_LIMIT);
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query.returns<NewsRow[]>();
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToArticle).filter((a): a is NewsArticle => a !== null);
}

/**
 * De laatste 30 gepubliceerde artikelen, nieuwste eerst. Binnen 10 minuten wordt de gecachete lijst
 * teruggegeven; gelijktijdige aanroepen delen één verzoek. Met `force` wordt de cache genegeerd.
 */
export async function fetchNews(signal?: AbortSignal, opts: { force?: boolean } = {}): Promise<NewsArticle[]> {
  const now = Date.now();
  if (!opts.force && cache && now - cache.fetchedAt < NEWS_CACHE_TTL_MS) return cache.articles;
  if (!inflight) {
    // Het gedeelde verzoek krijgt geen signal: één afgebroken afnemer mag de andere niet afbreken.
    inflight = fetchFromSupabase()
      .then((articles) => {
        cache = { articles, fetchedAt: Date.now() };
        return articles;
      })
      .finally(() => {
        inflight = null;
      });
  }
  const shared = inflight;
  if (!signal) return shared;
  return new Promise<NewsArticle[]>((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Afgebroken', 'AbortError'));
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    shared.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/** Artikel op slug uit de cache, anders na ophalen van de lijst. Null als het niet bestaat. */
export async function fetchArticle(slug: string, signal?: AbortSignal): Promise<NewsArticle | null> {
  const cached = getCachedNews()?.find((a) => a.slug === slug);
  if (cached) return cached;
  const articles = await fetchNews(signal);
  return articles.find((a) => a.slug === slug) ?? null;
}

// ---------------------------------------------------------------------------
// HTML opschonen
// ---------------------------------------------------------------------------

const ALLOWED_TAGS = new Set(['p', 'h2', 'h3', 'ul', 'ol', 'li', 'strong', 'em', 'b', 'i', 'a', 'br']);
/** Inhoud van deze elementen wordt volledig weggegooid (ook de tekst). */
const DROP_WITH_CONTENT = new Set(['script', 'style', 'template', 'noscript', 'iframe', 'object', 'embed', 'svg', 'math', 'head', 'title']);

function safeHref(value: string | null): string | null {
  if (!value) return null;
  const href = value.trim();
  return /^https?:\/\//i.test(href) ? href : null;
}

function cleanNode(node: Node, doc: Document, out: Node): void {
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      out.appendChild(doc.createTextNode(child.nodeValue ?? ''));
      return;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return; // commentaar e.d. overslaan
    const el = child as Element;
    const tag = el.tagName.toLowerCase();
    if (DROP_WITH_CONTENT.has(tag)) return;
    if (!ALLOWED_TAGS.has(tag)) {
      // Onbekend element: zelf weglaten, inhoud (tekst en toegestane kinderen) behouden.
      cleanNode(el, doc, out);
      return;
    }
    const clean = doc.createElement(tag);
    if (tag === 'a') {
      const href = safeHref(el.getAttribute('href'));
      if (href) {
        clean.setAttribute('href', href);
        clean.setAttribute('target', '_blank');
        clean.setAttribute('rel', 'noopener noreferrer');
      }
    }
    cleanNode(el, doc, clean);
    out.appendChild(clean);
  });
}

/**
 * Laat alleen p, h2, h3, ul, ol, li, strong, em, b, i, a (alleen http(s)-href, opent in nieuw tabblad) en br
 * toe; alle andere elementen en attributen verdwijnen, tekst blijft staan. Scripts/styles verdwijnen met inhoud.
 */
export function sanitizeArticleHtml(html: string): string {
  if (!html || typeof DOMParser === 'undefined') return '';
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}`, 'text/html');
  const out = doc.createElement('div');
  cleanNode(doc.body, doc, out);
  return out.innerHTML;
}
