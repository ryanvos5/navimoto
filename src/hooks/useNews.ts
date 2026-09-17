// Laadt de nieuwslijst (gecachet in services/news) met laad-/foutstatus; StrictMode-veilig via AbortController.
import { useCallback, useEffect, useState } from 'react';
import { fetchNews, getCachedNews, type NewsArticle } from '@/services/news';

export interface NewsListState {
  articles: NewsArticle[] | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

const isAbort = (e: unknown): boolean => e instanceof DOMException && e.name === 'AbortError';

export function useNews(): NewsListState {
  const [articles, setArticles] = useState<NewsArticle[] | null>(() => getCachedNews());
  const [loading, setLoading] = useState(articles === null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    fetchNews(ac.signal, { force: attempt > 0 })
      .then((list) => {
        if (ac.signal.aborted) return;
        setArticles(list);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted || isAbort(e)) return;
        console.warn('Nieuws laden mislukt', e);
        setError(e instanceof Error && e.message ? e.message : 'Het nieuws kon niet worden geladen.');
        setLoading(false);
      });
    return () => ac.abort();
  }, [attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  return { articles, loading, error, reload };
}
