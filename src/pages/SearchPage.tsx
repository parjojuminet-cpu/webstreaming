import React, { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import type {
  ContentItem,
  CreatorProfile,
  CurrencyCode,
  LocaleCode,
} from '../types/vyora';
import { ContentCard } from '../components/ui/ContentCard';
import { CreatorCard } from '../components/ui/CreatorCard';
import { EmptyState } from '../components/ui/StateViews';

interface SearchPageProps {
  catalog: ContentItem[];
  creators: CreatorProfile[];
  locale: LocaleCode;
  currency: CurrencyCode;
  savedVideoIds?: Set<string>;
  followedCreatorIds?: Set<string>;
  onSelectContent: (item: ContentItem) => void;
  onWatchPreview: (item: ContentItem) => void;
  onSelectCreator: (creatorId: string) => void;
  onToggleSave?: (item: ContentItem) => void;
  onToggleFollow?: (creatorId: string) => void;
}

const SUGGESTED_QUERIES = [
  '4K HDR',
  'Documentary',
  'Indonesia',
  'Workshop',
  'Education',
  'DELOKEN',
];

export const SearchPage: React.FC<SearchPageProps> = ({
  catalog,
  creators,
  locale,
  currency,
  savedVideoIds,
  followedCreatorIds,
  onSelectContent,
  onWatchPreview,
  onSelectCreator,
  onToggleSave,
  onToggleFollow,
}) => {
  const [query, setQuery] = useState('');

  const trimmed = query.trim().toLowerCase();

  const matchingContent = useMemo(() => {
    if (!trimmed) return catalog;
    return catalog.filter(
      (item) =>
        item.title.toLowerCase().includes(trimmed) ||
        item.subtitle.toLowerCase().includes(trimmed) ||
        item.description.toLowerCase().includes(trimmed) ||
        item.descriptionId.toLowerCase().includes(trimmed) ||
        item.creatorName.toLowerCase().includes(trimmed) ||
        item.category.toLowerCase().includes(trimmed) ||
        item.resolution.toLowerCase().includes(trimmed)
    );
  }, [catalog, trimmed]);

  const matchingCreators = useMemo(() => {
    if (!trimmed) return [];
    return creators.filter(
      (creator) =>
        creator.name.toLowerCase().includes(trimmed) ||
        creator.role.toLowerCase().includes(trimmed) ||
        creator.location.toLowerCase().includes(trimmed) ||
        creator.specialty.toLowerCase().includes(trimmed)
    );
  }, [creators, trimmed]);

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-8 space-y-4 sm:space-y-7">
      <div className="max-w-3xl space-y-2.5 sm:space-y-4">
        <div className="space-y-0.5 sm:space-y-1.5">
          <h1 className="font-display text-lg sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
            {locale === 'id' ? 'Cari di DELOKEN' : 'Search DELOKEN'}
          </h1>
          <p className="text-[11px] sm:text-sm text-slate-600 dark:text-slate-400">
            {locale === 'id'
              ? 'Cari berdasarkan judul, sutradara, kategori, lokasi, atau format audio.'
              : 'Search across films, documentaries, masterclasses, live events, and verified creators.'}
          </p>
        </div>

        {/* Search Input */}
        <div className="relative">
          <Search
            className="w-4 h-4 sm:w-5 sm:h-5 text-slate-400 dark:text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              locale === 'id'
                ? 'Ketik judul film, dokumenter, atau nama kreator...'
                : 'Search titles, creators, categories, or themes...'
            }
            aria-label="Search DELOKEN catalog"
            className="w-full min-h-[44px] pl-10 sm:pl-11 pr-10 py-2 rounded-xl bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-sm sm:text-base text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-600 shadow-xs"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Quick Search Suggestions */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 mr-0.5">
            {locale === 'id' ? 'Populer:' : 'Suggested:'}
          </span>
          {SUGGESTED_QUERIES.map((term) => (
            <button
              key={term}
              type="button"
              onClick={() => setQuery(term)}
              className="min-h-[32px] px-2.5 sm:px-3 py-1 rounded-lg bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-[11px] sm:text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
            >
              {term}
            </button>
          ))}
        </div>
      </div>

      {/* Matching Creators */}
      {matchingCreators.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display text-base sm:text-xl font-bold text-slate-900 dark:text-white">
            {locale === 'id' ? 'Kreator Terkait' : 'Matching Creators'}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5">
            {matchingCreators.map((creator) => (
              <CreatorCard
                key={creator.id}
                creator={creator}
                locale={locale}
                isFollowing={followedCreatorIds?.has(creator.id)}
                onExploreCreator={onSelectCreator}
                onToggleFollow={onToggleFollow}
              />
            ))}
          </div>
        </section>
      )}

      {/* Matching Content */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-base sm:text-xl font-bold text-slate-900 dark:text-white">
            {trimmed
              ? locale === 'id'
                ? `Hasil Pencarian (${matchingContent.length})`
                : `Search Results (${matchingContent.length})`
              : locale === 'id'
              ? 'Semua Tayangan Tersedia'
              : 'All Available Releases'}
          </h2>
        </div>

        {matchingContent.length === 0 && matchingCreators.length === 0 ? (
          <EmptyState
            title={locale === 'id' ? 'Tidak ada hasil yang cocok' : 'No results match your query'}
            description={
              locale === 'id'
                ? `Kami tidak menemukan tayangan atau kreator untuk "${query}". Coba kata kunci lain.`
                : `We could not find any releases or creators matching "${query}". Try a broader term.`
            }
            actionLabel={locale === 'id' ? 'Hapus Pencarian' : 'Clear Search'}
            onAction={() => setQuery('')}
          />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-5">
            {matchingContent.map((item) => (
              <ContentCard
                key={item.id}
                item={item}
                locale={locale}
                currency={currency}
                isSaved={savedVideoIds?.has(item.id)}
                onSelectContent={onSelectContent}
                onWatchPreview={onWatchPreview}
                onSelectCreator={onSelectCreator}
                onToggleSave={onToggleSave}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
