// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { _resetNewsCache, fetchArticle, fetchNews, NEWS_CACHE_TTL_MS, rowToArticle, sanitizeArticleHtml } from '@/services/news';

vi.mock('@/services/supabaseClient', () => ({
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from '@/services/supabaseClient';

const mockedGetClient = vi.mocked(getSupabaseClient);

/** Bouwt een mock-client waarvan de query-keten eindigt in `result`; registreert de aanroepen. */
function mockClient(result: { data: unknown; error: { message: string } | null }) {
  const calls: Record<string, unknown[]> = {};
  const chain: Record<string, unknown> = {};
  for (const name of ['select', 'eq', 'order', 'limit', 'abortSignal']) {
    chain[name] = vi.fn((...args: unknown[]) => {
      calls[name] = args;
      return chain;
    });
  }
  chain.returns = vi.fn(() => Promise.resolve(result));
  const from = vi.fn((table: string) => {
    calls.from = [table];
    return chain;
  });
  mockedGetClient.mockReturnValue(Promise.resolve({ from } as unknown as SupabaseClient));
  return { calls, from };
}

const ROW = {
  id: 'a1',
  titel: '  Kawasaki Ninja H2 2027 ',
  slug: 'kawasaki-ninja-h2-2027',
  intro: 'Supercharged.',
  inhoud: '<h2>Kop</h2><p>Tekst &rsquo;quote&rsquo;</p>',
  afbeelding: 'https://x.supabase.co/storage/v1/object/public/nieuws/h2.jpg',
  categorie: 'Nieuw model',
  created_at: '2026-09-10T08:30:00.000Z',
};

beforeEach(() => {
  _resetNewsCache();
  vi.useRealTimers();
  mockedGetClient.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('rowToArticle', () => {
  it('vertaalt een rij naar een artikel met de www.vos-oss.nl-URL', () => {
    const a = rowToArticle(ROW);
    expect(a).not.toBeNull();
    expect(a).toMatchObject({
      id: 'a1',
      title: 'Kawasaki Ninja H2 2027',
      slug: 'kawasaki-ninja-h2-2027',
      intro: 'Supercharged.',
      contentHtml: ROW.inhoud,
      imageUrl: ROW.afbeelding,
      category: 'Nieuw model',
      publishedAt: Date.parse('2026-09-10T08:30:00.000Z'),
      url: 'https://www.vos-oss.nl/nieuws/kawasaki-ninja-h2-2027',
    });
  });

  it('vult null-velden veilig in en weigert rijen zonder id of slug', () => {
    const a = rowToArticle({ ...ROW, titel: null, intro: null, inhoud: null, afbeelding: null, categorie: '', created_at: null });
    expect(a).toMatchObject({ title: 'Zonder titel', intro: '', contentHtml: '', imageUrl: null, category: null, publishedAt: 0 });
    expect(rowToArticle({ ...ROW, slug: null })).toBeNull();
    expect(rowToArticle({ ...ROW, id: '' })).toBeNull();
  });

  it('accepteert alleen https-afbeeldingen', () => {
    expect(rowToArticle({ ...ROW, afbeelding: 'http://onveilig.example/x.jpg' })?.imageUrl).toBeNull();
    expect(rowToArticle({ ...ROW, afbeelding: 'javascript:alert(1)' })?.imageUrl).toBeNull();
  });
});

describe('fetchNews', () => {
  it('gooit een Nederlandse fout zonder Supabase-configuratie', async () => {
    mockedGetClient.mockReturnValue(null);
    await expect(fetchNews()).rejects.toThrow('Nieuws is niet beschikbaar zonder Supabase-configuratie.');
  });

  it('vraagt gepubliceerde artikelen op (nieuwste eerst, max 30) en mapt de rijen', async () => {
    const { calls, from } = mockClient({ data: [ROW, { ...ROW, id: 'b2', slug: null }], error: null });
    const articles = await fetchNews();
    expect(from).toHaveBeenCalledWith('nieuws_artikelen');
    expect(calls.select).toEqual(['id,titel,slug,intro,afbeelding,categorie,created_at,inhoud']);
    expect(calls.eq).toEqual(['gepubliceerd', true]);
    expect(calls.order).toEqual(['created_at', { ascending: false }]);
    expect(calls.limit).toEqual([30]);
    expect(articles).toHaveLength(1);
    expect(articles[0].slug).toBe('kawasaki-ninja-h2-2027');
  });

  it('gooit bij een databasefout', async () => {
    mockClient({ data: null, error: { message: 'permission denied' } });
    await expect(fetchNews()).rejects.toThrow('permission denied');
  });

  it('cachet 10 minuten en deelt gelijktijdige verzoeken', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-17T12:00:00Z'));
    const { from } = mockClient({ data: [ROW], error: null });
    const [a, b] = await Promise.all([fetchNews(), fetchNews()]);
    expect(a).toBe(b);
    expect(from).toHaveBeenCalledTimes(1);
    await fetchNews();
    expect(from).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date('2026-09-17T12:11:00Z'));
    await fetchNews();
    expect(from).toHaveBeenCalledTimes(2);
    expect(NEWS_CACHE_TTL_MS).toBe(600_000);
  });

  it('fetchArticle vindt op slug uit de cache en geeft null voor onbekende slugs', async () => {
    const { from } = mockClient({ data: [ROW], error: null });
    expect((await fetchArticle('kawasaki-ninja-h2-2027'))?.id).toBe('a1');
    expect(await fetchArticle('bestaat-niet')).toBeNull();
    expect(from).toHaveBeenCalledTimes(1);
  });
});

describe('sanitizeArticleHtml', () => {
  it('behoudt toegestane tags en decodeert entiteiten', () => {
    const out = sanitizeArticleHtml('<h2>Kop</h2><p>Dit is <em>cursief</em> en <strong>vet</strong> &rsquo;ok&rsquo;<br>x</p><ul><li>een</li></ul>');
    expect(out).toBe('<h2>Kop</h2><p>Dit is <em>cursief</em> en <strong>vet</strong> ’ok’<br>x</p><ul><li>een</li></ul>');
  });

  it('verwijdert scripts, styles en onbekende elementen maar houdt de tekst', () => {
    const out = sanitizeArticleHtml('<div class="x"><p onclick="evil()">Hallo <span style="color:red">wereld</span></p><script>alert(1)</script><style>p{}</style><img src="x" onerror="evil()"></div>');
    expect(out).toBe('<p>Hallo wereld</p>');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('alert');
  });

  it('staat alleen http(s)-links toe, in een nieuw tabblad met noopener', () => {
    const out = sanitizeArticleHtml('<p><a href="https://www.vos-oss.nl/x" onclick="evil()">site</a> <a href="javascript:alert(1)">kwaad</a> <a href="mailto:a@b.nl">mail</a></p>');
    expect(out).toBe('<p><a href="https://www.vos-oss.nl/x" target="_blank" rel="noopener noreferrer">site</a> <a>kwaad</a> <a>mail</a></p>');
  });

  it('geeft een lege string voor lege invoer', () => {
    expect(sanitizeArticleHtml('')).toBe('');
  });
});
