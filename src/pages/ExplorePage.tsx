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
      <div className="flex items-start md:items-end justify-between gap-3 pb-4 sm:pb-6 border-b border-white/8">
        <div className="space-y-1.5 sm:space-y-2 min-w-0">
          <h1 className="font-display text-2xl sm:text-4xl font-bold tracking-tight text-[#F5F5F7]">
            {locale === 'id' ? 'Jelajahi Katalog VYORA' : 'Explore VYORA Catalog'}
          </h1>
          <p className="text-xs sm:text-base text-[#A5A6B2] max-w-2xl">
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
          className="inline-flex items-center justify-center gap-2 shrink-0 min-h-[40px] min-w-[40px] sm:min-h-[38px] px-2.5 sm:px-3.5 py-2 rounded-xl sm:rounded-lg bg-[#1B1C27] hover:bg-[#242636] border border-white/10 text-xs font-medium text-[#A5A6B2] hover:text-[#F5F5F7] transition-colors cursor-pointer whitespace-nowrap"
        >
          <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span className="hidden sm:inline">{locale === 'id' ? 'Segarkan Katalog' : 'Refresh Catalog'}</span>
        </button>
      </div>

      {/* Category Filter Tabs & Search/Sort Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div
          className="flex items-center gap-2 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0 vyora-scroll"
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
                ? 'bg-[#7957ED] text-[#F5F5F7]'
                : 'bg-[#1B1C27] text-[#A5A6B2] hover:text-[#F5F5F7] border border-white/8'
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
                    ? 'bg-[#7957ED] text-[#F5F5F7]'
                    : 'bg-[#1B1C27] text-[#A5A6B2] hover:text-[#F5F5F7] border border-white/8'
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
            className="min-h-[44px] sm:min-h-[40px] px-3.5 py-2 rounded-xl sm:rounded-lg bg-[#1B1C27] border border-white/10 text-sm text-[#F5F5F7] placeholder:text-[#A5A6B2]/70 focus:outline-none focus:ring-2 focus:ring-[#7957ED]"
          />

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortOption)}
            aria-label="Sort catalog"
            className="min-h-[44px] sm:min-h-[40px] px-3.5 py-2 rounded-xl sm:rounded-lg bg-[#1B1C27] border border-white/10 text-sm text-[#F5F5F7] focus:outline-none focus:ring-2 focus:ring-[#7957ED] cursor-pointer"
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
        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-xl bg-[#1B1C27] border border-[#7957ED]/40">
          <div className="text-sm text-[#F5F5F7] min-w-0 truncate">
            <span className="text-[#A5A6B2]">
              {locale === 'id' ? 'Menampilkan karya oleh: ' : 'Filtering by creator: '}
            </span>
            <span className="font-semibold">{activeCreator.name}</span>
          </div>
          <button
            type="button"
            onClick={onClearCreator}
            className="inline-flex items-center gap-1 min-h-[40px] px-2 text-xs font-medium text-[#A78BFA] hover:text-[#F5F5F7] cursor-pointer shrink-0"
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
