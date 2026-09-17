// Detail van een nieuwsartikel (/nieuws/:slug): afbeelding, categorie, datum, titel, opgeschoonde inhoud en
// een knop naar het artikel op vos-oss.nl. Het artikel komt uit de gecachete lijst (fetchArticle).
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ExternalLink, FileQuestion, RefreshCw, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { DetailHeader } from '@/components/rides/DetailHeader';
import { EmptyState } from '@/components/rides/EmptyState';
import { PageSpinner } from '@/components/rides/PageSpinner';
import { LINK_BUTTON_CLASS } from '@/components/rides/rideUtils';
import { formatDate } from '@/lib/format';
import { fetchArticle, NEWS_SITE_URL, sanitizeArticleHtml, type NewsArticle } from '@/services/news';
import { ArticleImage, CategoryChip } from '@/pages/NewsPage';

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; article: NewsArticle | null };

const isAbort = (e: unknown): boolean => e instanceof DOMException && e.name === 'AbortError';

/**
 * Opmaak voor de artikel-HTML (alleen p/h2/h3/ul/ol/li/strong/em/b/i/a/br na sanitizeArticleHtml).
 * Tailwind v4: `[&_p]`-varianten stylen de kinderen zonder typography-plugin.
 */
const PROSE_CLASS = [
  'text-[15px] leading-relaxed text-ink',
  '[&_p]:my-3',
  '[&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:leading-snug',
  '[&_h3]:mt-5 [&_h3]:mb-1.5 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:leading-snug',
  '[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1',
  '[&_strong]:font-semibold [&_b]:font-semibold [&_em]:italic [&_i]:italic',
  '[&_a]:text-brand [&_a]:underline [&_a]:underline-offset-2',
].join(' ');

export default function NewsArticlePage() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const ac = new AbortController();
    setState({ status: 'loading' });
    fetchArticle(slug, ac.signal)
      .then((article) => {
        if (!ac.signal.aborted) setState({ status: 'ready', article });
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted || isAbort(e)) return;
        console.warn('Nieuwsartikel laden mislukt', e);
        setState({ status: 'error', message: e instanceof Error && e.message ? e.message : 'Het artikel kon niet worden geladen.' });
      });
    return () => ac.abort();
  }, [slug, attempt]);

  const article = state.status === 'ready' ? state.article : null;
  const html = useMemo(() => (article ? sanitizeArticleHtml(article.contentHtml) : ''), [article]);

  const goBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate('/nieuws', { replace: true });
  };

  if (state.status === 'loading') {
    return (
      <div className="flex h-full flex-col bg-surface">
        <DetailHeader title="Nieuws" onBack={goBack} />
        <PageSpinner />
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="flex h-full flex-col bg-surface">
        <DetailHeader title="Nieuws" onBack={goBack} />
        <EmptyState
          icon={<WifiOff size={30} aria-hidden />}
          title="Artikel laden mislukt"
          description={state.message}
          action={
            <Button variant="primary" icon={<RefreshCw size={18} aria-hidden />} onClick={() => setAttempt((n) => n + 1)}>
              Opnieuw proberen
            </Button>
          }
        />
      </div>
    );
  }

  if (!article) {
    return (
      <div className="flex h-full flex-col bg-surface">
        <DetailHeader title="Nieuws" onBack={goBack} />
        <EmptyState
          icon={<FileQuestion size={30} aria-hidden />}
          title="Artikel niet gevonden"
          description="Dit artikel bestaat niet (meer) of is nog niet gepubliceerd."
          action={
            <>
              <Link to="/nieuws" className={LINK_BUTTON_CLASS}>
                Naar Nieuws
              </Link>
              <a
                href={NEWS_SITE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-line px-4 font-semibold text-ink transition-colors hover:bg-surface-3"
              >
                <ExternalLink size={18} aria-hidden />
                vos-oss.nl/nieuws
              </a>
            </>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-surface">
      <DetailHeader title={article.title} onBack={goBack} />
      <article className="min-h-0 flex-1 overflow-y-auto">
        <ArticleImage src={article.imageUrl} alt="" />
        <div className="px-4 pb-10 pt-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <CategoryChip category={article.category} />
            {article.publishedAt > 0 && <time dateTime={new Date(article.publishedAt).toISOString()}>{formatDate(article.publishedAt)}</time>}
          </div>
          <h1 className="mt-2 text-2xl font-bold leading-tight">{article.title}</h1>
          {article.intro && <p className="mt-3 text-base font-medium text-muted">{article.intro}</p>}
          {html ? (
            // Veilig: de HTML is door sanitizeArticleHtml gehaald (alleen tekstopmaak en http(s)-links).
            <div className={`mt-4 ${PROSE_CLASS}`} dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <p className="mt-4 text-sm text-muted">Lees het volledige artikel op vos-oss.nl.</p>
          )}
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-8 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 font-semibold text-white shadow-lg shadow-brand/20 transition-colors hover:bg-brand-strong active:bg-brand-strong"
          >
            <ExternalLink size={18} aria-hidden />
            Lees op vos-oss.nl
          </a>
        </div>
      </article>
    </div>
  );
}
