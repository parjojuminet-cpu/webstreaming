import React, { useMemo, useState } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import type {
  ContentCategory,
  ContentItem,
  CreatorProfile,
  CurrencyCode,
  LocaleCode,
} from '../types/vyora';
import { CATEGORY_LABELS_ID, CATEGORY_LIST } from '../i18n/translations';
import { ContentCard } from '../components/ui/ContentCard';
import { ContentCardSkeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/StateViews';

interface ExplorePageProps {
  catalog: ContentItem[];
  creators: CreatorProfile[];
  locale: LocaleCode;
  currency: CurrencyCode;
  selectedCategory: ContentCategory | 'All';
  selectedCreatorId: string | null;
  onChangeCategory: (category: ContentCategory | 'All') => void;
  onClearCreator: () => void;
  onSelectContent: (item: ContentItem) => void;
  onWatchPreview: (item: ContentItem) => void;
  onSelectCreator: (creatorId: string) => void;
}

type SortOption = 'trending' | 'recent' | 'price-asc' | 'duration';

export const ExplorePage: React.FC<ExplorePageProps> = ({
  catalog,
  creators,
  locale,
  currency,
  selectedCategory,
  selectedCreatorId,
  onChangeCategory,
  onClearCreator,
  onSelectContent,
  onWatchPreview,
  onSelectCreator,
}) => {
  const [sortBy, setSortBy] = useState<SortOption>('trending');
  const [filterText, setFilterText] = useState('');
  const [previewSkeleton, setPreviewSkeleton] = useState(false);

  const activeCreator = creators.find((c) => c.id === selectedCreatorId) ?? null;

  const filteredItems = useMemo(() => {
    const query = filterText.trim().toLowerCase();
    const list = catalog.filter((item) => {
      if (selectedCategory !== 'All' && item.category !== selectedCategory) {
        return false;
      }
      if (selectedCreatorId && item.creatorId !== selectedCreatorId) {
        return false;
      }
      if (!query) return true;
      return (
        item.title.toLowerCase().includes(query) ||
        item.creatorName.toLowerCase().includes(query) ||
        item.category.toLowerCase().includes(query) ||
        item.subtitle.toLowerCase().includes(query)
      );
    });

    return [...list].sort((a, b) => {
      if (sortBy === 'recent') {
        return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
      }
      if (sortBy === 'price-asc') {
        return a.priceUsd - b.priceUsd;
      }
      if (sortBy === 'duration') {
        return b.durationMinutes - a.durationMinutes;
      }
      return (b.trending ? 1 : 0) - (a.trending ? 1 : 0);
    });
  }, [catalog, selectedCategory, selectedCreatorId, filterText, sortBy]);

  const resetFilters = () => {
    onChangeCategory('All');
    onClearCreator();
    setFilterText('');
    setSortBy('trending');
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-12 space-y-5 sm:space-y-8">
      <div className="flex items-start md:items-end justify-between gap-3 pb-4 sm:pb-6 border-b border-slate-200 dark:border-slate-800">
        <div className="space-y-1.5 sm:space-y-2 min-w-0">
          <h1 className="font-display text-2xl sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-white">
            {locale === 'id' ? 'Jelajahi Katalog DELOKEN' : 'Explore DELOKEN Catalog'}
          </h1>
          <p className="text-xs sm:text-base text-slate-600 dark:text-slate-400 max-w-2xl">
            {locale === 'id'
              ? 'Temukan film panjang, dokumenter, kelas master, dan pertunjukan langsung. Setiap judul memiliki pratinjau gratis 5 menit.'
              : 'Browse curated films, documentaries, masterclasses, and live events. Every title includes a five-minute free preview.'}
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setPreviewSkeleton(true);
            window.setTimeout(() => setPreviewSkeleton(false), 650);
          }}
          aria-label={locale === 'id' ? 'Segarkan Katalog' : 'Refresh Catalog'}
          className="inline-flex items-center justify-center gap-2 shrink-0 min-h-[40px] min-w-[40px] sm:min-h-[38px] px-2.5 sm:px-3.5 py-2 rounded-xl sm:rounded-lg bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer whitespace-nowrap shadow-xs"
        >
          <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span className="hidden sm:inline">{locale === 'id' ? 'Segarkan Katalog' : 'Refresh Catalog'}</span>
        </button>
      </div>

      {/* Category Filter Tabs & Search/Sort Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div
          className="flex items-center gap-2 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0 deloken-scroll"
          role="tablist"
          aria-label="Filter by category"
        >
          <button
            type="button"
            role="tab"
            aria-selected={selectedCategory === 'All'}
            onClick={() => onChangeCategory('All')}
            className={`min-h-[44px] sm:min-h-[40px] px-4 py-2 rounded-xl sm:rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
              selectedCategory === 'All'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-slate-800'
            }`}
          >
            {locale === 'id' ? 'Semua Kategori' : 'All Categories'}
          </button>

          {CATEGORY_LIST.map((category) => {
            const active = selectedCategory === category;
            const label = locale === 'id' ? CATEGORY_LABELS_ID[category] : category;
            return (
              <button
                key={category}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onChangeCategory(category)}
                className={`min-h-[44px] sm:min-h-[40px] px-4 py-2 rounded-xl sm:rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  active
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-slate-800'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <input
            type="search"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder={
              locale === 'id' ? 'Saring judul atau kreator...' : 'Filter title or creator...'
            }
            aria-label="Filter catalog"
            className="min-h-[44px] sm:min-h-[40px] px-3.5 py-2 rounded-xl sm:rounded-lg bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-600"
          />

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortOption)}
            aria-label="Sort catalog"
            className="min-h-[44px] sm:min-h-[40px] px-3.5 py-2 rounded-xl sm:rounded-lg bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600 cursor-pointer"
          >
            <option value="trending">
              {locale === 'id' ? 'Urutkan: Sedang Tren' : 'Sort: Trending'}
            </option>
            <option value="recent">
              {locale === 'id' ? 'Urutkan: Terbaru' : 'Sort: Recently Added'}
            </option>
            <option value="price-asc">
              {locale === 'id' ? 'Urutkan: Harga Terendah' : 'Sort: Price Low to High'}
            </option>
            <option value="duration">
              {locale === 'id' ? 'Urutkan: Durasi Terpanjang' : 'Sort: Longest Runtime'}
            </option>
          </select>
        </div>
      </div>

      {/* Active Creator Filter Banner */}
      {activeCreator && (
        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/70">
          <div className="text-sm text-slate-900 dark:text-slate-100 min-w-0 truncate">
            <span className="text-slate-600 dark:text-slate-300">
              {locale === 'id' ? 'Menampilkan karya oleh: ' : 'Filtering by creator: '}
            </span>
            <span className="font-semibold">{activeCreator.name}</span>
          </div>
          <button
            type="button"
            onClick={onClearCreator}
            className="inline-flex items-center gap-1 min-h-[40px] px-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 cursor-pointer shrink-0"
          >
            <X className="w-3.5 h-3.5" />
            <span>{locale === 'id' ? 'Hapus' : 'Clear'}</span>
          </button>
        </div>
      )}

      {/* Results Grid / Skeleton / Empty State */}
      {previewSkeleton ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {Array.from({ length: 4 }).map((_, idx) => (
            <ContentCardSkeleton key={idx} />
          ))}
        </div>
      ) : filteredItems.length === 0 ? (
        <EmptyState
          title={locale === 'id' ? 'Tidak ada tayangan ditemukan' : 'No matching titles found'}
          description={
            locale === 'id'
              ? 'Coba ubah kata kunci pencarian atau setel ulang filter kategori untuk melihat semua rilisan.'
              : 'Try adjusting your search filter or resetting the active category to see all available releases.'
          }
          actionLabel={locale === 'id' ? 'Setel Ulang Filter' : 'Reset Filters'}
          onAction={resetFilters}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {filteredItems.map((item) => (
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
    </div>
  );
};
