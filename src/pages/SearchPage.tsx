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
  onSelectContent: (item: ContentItem) => void;
  onWatchPreview: (item: ContentItem) => void;
  onSelectCreator: (creatorId: string) => void;
}

const SUGGESTED_QUERIES = [
  '4K HDR',
  'Documentary',
  'Indonesia',
  'Berlin',
  'Architecture',
  'Kenji Takahashi',
];

export const SearchPage: React.FC<SearchPageProps> = ({
  catalog,
  creators,
  locale,
  currency,
  onSelectContent,
  onWatchPreview,
  onSelectCreator,
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
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 space-y-8 sm:space-y-10">
      <div className="max-w-3xl space-y-4 sm:space-y-5">
        <div className="space-y-2">
          <h1 className="font-display text-2xl sm:text-4xl font-bold tracking-tight text-[#F5F5F7]">
            {locale === 'id' ? 'Cari di VYORA' : 'Search VYORA'}
          </h1>
          <p className="text-sm sm:text-base text-[#A5A6B2]">
            {locale === 'id'
              ? 'Cari berdasarkan judul, sutradara, kategori, lokasi, atau format audio.'
              : 'Search across films, documentaries, masterclasses, live events, and verified creators.'}
          </p>
        </div>

        {/* Search Input */}
        <div className="relative">
          <Search
            className="w-5 h-5 text-[#A5A6B2] absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none"
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
            aria-label="Search VYORA catalog"
            className="w-full min-h-[50px] pl-12 pr-12 py-3 rounded-xl bg-[#1B1C27] border border-white/12 text-base text-[#F5F5F7] placeholder:text-[#A5A6B2]/70 focus:outline-none focus:ring-2 focus:ring-[#7957ED]"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-[#A5A6B2] hover:text-[#F5F5F7] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Quick Search Suggestions */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-[#A5A6B2] mr-1">
            {locale === 'id' ? 'Populer:' : 'Suggested:'}
          </span>
          {SUGGESTED_QUERIES.map((term) => (
            <button
              key={term}
              type="button"
              onClick={() => setQuery(term)}
              className="min-h-[40px] px-3.5 py-2 rounded-xl sm:rounded-lg bg-[#1B1C27] hover:bg-[#242636] border border-white/10 text-xs font-medium text-[#A5A6B2] hover:text-[#F5F5F7] transition-colors cursor-pointer active:scale-[0.98]"
            >
              {term}
            </button>
          ))}
        </div>
      </div>

      {/* Matching Creators */}
      {matchingCreators.length > 0 && (
        <section className="space-y-4">
          <h2 className="font-display text-xl font-bold text-[#F5F5F7]">
            {locale === 'id' ? 'Kreator Terkait' : 'Matching Creators'}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {matchingCreators.map((creator) => (
              <CreatorCard
                key={creator.id}
                creator={creator}
                locale={locale}
                onExploreCreator={onSelectCreator}
              />
            ))}
          </div>
        </section>
      )}

      {/* Matching Content */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-bold text-[#F5F5F7]">
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {matchingContent.map((item) => (
              <ContentCard
                key={item.id}
                item={item}
                locale={locale}
                currency={currency}
                onSelectContent={onSelectContent}
                onWatchPreview={onWatchPreview}
                onSelectCreator={onSelectCreator}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
