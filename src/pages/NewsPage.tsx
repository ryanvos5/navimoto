// Nieuws-tab (/nieuws): de laatste artikelen van Vos Oss Motoren als kaarten; tikken opent /nieuws/:slug.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ImageOff, Newspaper, RefreshCw, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/rides/EmptyState';
import { PageSpinner } from '@/components/rides/PageSpinner';
import { formatDate } from '@/lib/format';
import { useNews } from '@/hooks/useNews';
import type { NewsArticle } from '@/services/news';

/** 16:9-afbeelding met lazy loading; zonder (of bij een kapotte) afbeelding een placeholder. */
export function ArticleImage({ src, alt, className = '' }: { src: string | null; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={`relative aspect-video w-full overflow-hidden bg-surface-3 ${className}`}>
      {src && !failed ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-muted" aria-hidden>
          <ImageOff size={32} />
        </div>
      )}
    </div>
  );
}

export function CategoryChip({ category }: { category: string | null }) {
  if (!category) return null;
  return <span className="inline-block rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-semibold text-brand">{category}</span>;
}

function ArticleCard({ article }: { article: NewsArticle }) {
  return (
    <Link
      to={`/nieuws/${encodeURIComponent(article.slug)}`}
      className="block overflow-hidden rounded-2xl border border-line bg-surface-2 transition-colors hover:bg-surface-3 active:bg-surface-3"
    >
      <ArticleImage src={article.imageUrl} alt="" />
      <div className="flex flex-col gap-1.5 p-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <CategoryChip category={article.category} />
          {article.publishedAt > 0 && <time dateTime={new Date(article.publishedAt).toISOString()}>{formatDate(article.publishedAt)}</time>}
        </div>
        <h2 className="text-lg font-bold leading-snug">{article.title}</h2>
        {article.intro && <p className="line-clamp-3 text-sm text-muted">{article.intro}</p>}
      </div>
    </Link>
  );
}

export default function NewsPage() {
  const { articles, loading, error, reload } = useNews();

  let content;
  if (loading && !articles) {
    content = <PageSpinner />;
  } else if (error && !articles) {
    content = (
      <EmptyState
        icon={<WifiOff size={30} aria-hidden />}
        title="Nieuws laden mislukt"
        description={error}
        action={
          <Button variant="primary" icon={<RefreshCw size={18} aria-hidden />} onClick={reload}>
            Opnieuw proberen
          </Button>
        }
      />
    );
  } else if (!articles || articles.length === 0) {
    content = (
      <EmptyState
        icon={<Newspaper size={30} aria-hidden />}
        title="Nog geen nieuws"
        description="Zodra Vos Oss Motoren iets publiceert, verschijnt het hier."
        action={
          <Button variant="secondary" icon={<RefreshCw size={18} aria-hidden />} onClick={reload} loading={loading}>
            Vernieuwen
          </Button>
        }
      />
    );
  } else {
    content = (
      <ul className="flex flex-col gap-3 p-4 pb-8">
        {articles.map((article) => (
          <li key={article.id}>
            <ArticleCard article={article} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="relative flex h-full flex-col bg-surface">
      <header className="safe-top shrink-0 border-b border-line bg-surface-2/95 backdrop-blur">
        <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold">Nieuws</h1>
            <p className="text-sm text-muted">Het laatste nieuws van Vos Oss Motoren</p>
          </div>
          <button
            type="button"
            onClick={reload}
            disabled={loading}
            aria-label="Vernieuwen"
            title="Vernieuwen"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink transition-colors hover:bg-surface-3 active:bg-surface-3 disabled:opacity-50"
          >
            <RefreshCw size={20} aria-hidden className={loading && articles ? 'animate-spin' : ''} />
          </button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{content}</div>
    </div>
  );
}
