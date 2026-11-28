import React, { useMemo, useState } from 'react';
import { ArrowRight, Clock, Play, Search, X } from 'lucide-react';
import type {
  ContentCategory,
  ContentItem,
  CreatorProfile,
  CurrencyCode,
  LocaleCode,
  ViewRoute,
  WatchProgressRecord,
} from '../types/vyora';
import {
  CATEGORY_LABELS_ID,
  CATEGORY_LIST,
  TRANSLATIONS,
  isFreeContent,
} from '../i18n/translations';
import { ContentCard } from '../components/ui/ContentCard';
import { CreatorCard } from '../components/ui/CreatorCard';
import { MediaImage } from '../components/ui/MediaImage';
import { EmptyState } from '../components/ui/StateViews';

interface HomePageProps {
  catalog: ContentItem[];
  creators: CreatorProfile[];
  locale: LocaleCode;
  currency: CurrencyCode;
  watchProgress?: WatchProgressRecord[];
  savedVideoIds?: Set<string>;
  followedCreatorIds?: Set<string>;
  onWatchPreview: (item: ContentItem, resumeSeconds?: number) => void;
  onSelectContent: (item: ContentItem) => void;
  onExploreCategory: (category: ContentCategory) => void;
  onExploreCreator: (creatorId: string) => void;
  onToggleSave?: (item: ContentItem) => void;
  onToggleFollow?: (creatorId: string) => void;
  onDismissProgress?: (videoId: string) => void;
  onNavigate: (route: ViewRoute) => void;
}

type PriceFilter = 'all' | 'free' | 'paid';

// Fresh random seed per browser open/reload so home catalog order always randomizes on arrival
const SESSION_SHUFFLE_SEED = `${Math.floor(Math.random() * 1_000_000_000).toString(36)}-${Date.now().toString(36)}`;

function computeRandomRank(seed: string, itemId: string): number {
  const input = `${seed}:${itemId}`;
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

function formatResumeStamp(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export const HomePage: React.FC<HomePageProps> = ({
  catalog,
  creators,
  locale,
  currency,
  watchProgress = [],
  savedVideoIds,
  followedCreatorIds,
  onWatchPreview,
  onSelectContent,
  onExploreCreator,
  onToggleSave,
  onToggleFollow,
  onDismissProgress,
  onNavigate,
}) => {
  const dict = TRANSLATIONS[locale];
  const [selectedCategory, setSelectedCategory] = useState<ContentCategory | 'All'>('All');
  const [priceFilter, setPriceFilter] = useState<PriceFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const continueWatchingItems = useMemo(() => {
    if (watchProgress.length === 0 || catalog.length === 0) return [];
    const byId = new Map(catalog.map((c) => [c.id, c]));
    return watchProgress
      .filter((wp) => wp.resumeSeconds >= 5)
      .map((wp) => {
        const item = byId.get(wp.videoId);
        if (!item) return null;
        const pct = Math.min(
          100,
          Math.max(4, Math.round((wp.resumeSeconds / Math.max(1, wp.durationSeconds)) * 100))
        );
        return {
          item,
          resumeSeconds: wp.resumeSeconds,
          pct,
        };
      })
      .filter(
        (entry): entry is { item: ContentItem; resumeSeconds: number; pct: number } =>
          entry !== null
      )
      .slice(0, 8);
  }, [watchProgress, catalog]);

  const galleryItems = useMemo(() => {
    const randomized = [...catalog].sort((a, b) => {
      const rankA = computeRandomRank(SESSION_SHUFFLE_SEED, a.id);
      const rankB = computeRandomRank(SESSION_SHUFFLE_SEED, b.id);
      if (rankA !== rankB) return rankA - rankB;
      return a.id.localeCompare(b.id);
    });

    const trimmedQuery = searchQuery.trim().toLowerCase();

    return randomized.filter((item) => {
      if (selectedCategory !== 'All' && item.category !== selectedCategory) {
        return false;
      }
      if (priceFilter === 'free' && !isFreeContent(item)) {
        return false;
      }
      if (priceFilter === 'paid' && isFreeContent(item)) {
        return false;
      }
      if (trimmedQuery) {
        const catLabel = (
          locale === 'id' ? CATEGORY_LABELS_ID[item.category] : item.category
        ).toLowerCase();
        const hit =
          item.title.toLowerCase().includes(trimmedQuery) ||
          item.creatorName.toLowerCase().includes(trimmedQuery) ||
          item.category.toLowerCase().includes(trimmedQuery) ||
          catLabel.includes(trimmedQuery);
        if (!hit) return false;
      }
      return true;
    });
  }, [catalog, selectedCategory, priceFilter, searchQuery, locale]);

  const hasActiveFilter =
    selectedCategory !== 'All' || priceFilter !== 'all' || searchQuery.trim().length > 0;

  return (
    <div className="space-y-6 sm:space-y-10 lg:space-y-12 pb-4 sm:pb-8">
      {/* CONTINUE WATCHING ROW (Authenticated users with saved progress) */}
      {continueWatchingItems.length > 0 && (
        <section
          aria-labelledby="continue-watching-heading"
          className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 pt-2.5 sm:pt-5 space-y-2 sm:space-y-3"
        >
          <div className="flex items-center justify-between gap-2">
            <h2
              id="continue-watching-heading"
              className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-bold text-slate-900 dark:text-white"
            >
              <Clock className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              <span>{locale === 'id' ? 'Lanjutkan Menonton' : 'Continue Watching'}</span>
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('viewer-dashboard')}
              className="text-[11px] sm:text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
            >
              {locale === 'id' ? 'Perpustakaan' : 'Library'}
            </button>
          </div>

          <div className="deloken-scroll flex gap-2.5 sm:gap-3.5 overflow-x-auto pb-1 -mx-3 px-3 sm:mx-0 sm:px-0">
            {continueWatchingItems.map(({ item, resumeSeconds, pct }) => {
              const isPortrait =
                item.aspectRatio === '9:16' ||
                item.aspectRatio === '4:5' ||
                item.aspectRatio === '1:1';
              return (
                <div
                  key={item.id}
                  className="group relative shrink-0 w-[165px] sm:w-[210px] rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-emerald-600 dark:hover:border-emerald-500 overflow-hidden shadow-xs transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => onWatchPreview(item, resumeSeconds)}
                    className="w-full text-left cursor-pointer block"
                  >
                    <div className="relative aspect-video w-full overflow-hidden bg-slate-900">
                      {isPortrait && item.thumbnailUrl && (
                        <img
                          src={item.thumbnailUrl}
                          alt=""
                          aria-hidden="true"
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          className="absolute inset-0 w-full h-full object-cover scale-125 blur-lg opacity-55 brightness-75 pointer-events-none"
                        />
                      )}
                      <MediaImage
                        src={item.thumbnailUrl}
                        alt={item.title}
                        fallbackTitle={item.title}
                        fit={isPortrait ? 'contain' : 'cover'}
                        transparentBg={isPortrait}
                        className="relative z-[1] w-full h-full group-hover:scale-[1.03] transition-transform duration-200"
                      />
                      <span className="absolute z-[2] bottom-2 left-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-950/85 text-[9px] sm:text-[10px] font-mono text-white">
                        <Play className="w-2.5 h-2.5 fill-current text-emerald-400" aria-hidden="true" />
                        {formatResumeStamp(resumeSeconds)}
                      </span>
                      <div
                        className="absolute z-[2] inset-x-0 bottom-0 h-1 bg-slate-900/70"
                        aria-hidden="true"
                      >
                        <div
                          className="h-full bg-emerald-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                    <div className="px-2 py-1.5">
                      <p className="text-[11px] sm:text-xs font-semibold text-slate-900 dark:text-white truncate group-hover:text-emerald-700 dark:group-hover:text-emerald-400">
                        {item.title}
                      </p>
                    </div>
                  </button>

                  {onDismissProgress && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDismissProgress(item.id);
                      }}
                      aria-label={locale === 'id' ? `Hapus ${item.title} dari riwayat` : `Remove ${item.title}`}
                      className="absolute z-[3] top-1 right-1 w-6 h-6 rounded-md bg-slate-950/75 hover:bg-slate-900 text-white/90 inline-flex items-center justify-center opacity-85 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity cursor-pointer"
                    >
                      <X className="w-3 h-3" aria-hidden="true" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 1. INITIAL MOVIE & STREAMING GALLERY (Above the fold on open) */}
      <section
        aria-labelledby="movie-gallery-heading"
        className={`max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 ${
          continueWatchingItems.length > 0 ? 'pt-1 sm:pt-2' : 'pt-2 sm:pt-5'
        } space-y-2.5 sm:space-y-3.5`}
      >
        <div className="flex items-center justify-between gap-2.5 pb-2 sm:pb-3 border-b border-slate-200 dark:border-slate-800">
          <div className="space-y-0.5 min-w-0">
            <h1
              id="movie-gallery-heading"
              className="font-display text-sm sm:text-xl lg:text-2xl font-bold tracking-tight text-slate-900 dark:text-white leading-tight truncate"
            >
              {dict.sections.galleryHeading}
            </h1>
            <p className="hidden sm:block text-xs text-slate-500 dark:text-slate-400 leading-snug truncate max-w-2xl">
              {dict.sections.gallerySubtitle}
            </p>
          </div>

          <button
            type="button"
            onClick={() => onNavigate('explore')}
            className="inline-flex items-center gap-1 min-h-[32px] sm:min-h-[36px] text-xs sm:text-sm font-semibold text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <span>{dict.sections.viewAll}</span>
            <ArrowRight className="w-3.5 h-3.5 sm:w-4 sm:h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Compact Quick Search + Free/Paid Filter Row */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="relative flex-1 max-w-md">
            <Search
              className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={
                locale === 'id'
                  ? 'Cari judul atau nama kreator...'
                  : 'Quick search titles or creators...'
              }
              aria-label={locale === 'id' ? 'Cari cepat di beranda' : 'Quick home search'}
              className="w-full min-h-[34px] pl-8 pr-8 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs sm:text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label={locale === 'id' ? 'Hapus pencarian' : 'Clear search'}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
          </div>

          <div
            role="group"
            aria-label={locale === 'id' ? 'Filter harga tayangan' : 'Price tier filter'}
            className="inline-flex items-center p-0.5 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 self-start sm:self-auto shrink-0"
          >
            {(['all', 'free', 'paid'] as PriceFilter[]).map((mode) => {
              const active = priceFilter === mode;
              const label =
                mode === 'all'
                  ? locale === 'id'
                    ? 'Semua'
                    : 'All'
                  : mode === 'free'
                  ? locale === 'id'
                    ? 'Gratis'
                    : 'Free'
                  : locale === 'id'
                  ? 'Berbayar'
                  : 'Paid';
              return (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setPriceFilter(mode)}
                  className={`min-h-[30px] px-3 py-1 rounded-md text-[11px] sm:text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                    active
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Category Filter Tabs */}
        <div
          role="tablist"
          aria-label={dict.sections.exploreCategories}
          className="deloken-scroll flex items-center gap-1.5 sm:gap-2 overflow-x-auto pb-0.5 -mx-3 px-3 sm:mx-0 sm:px-0"
        >
          <button
            type="button"
            role="tab"
            aria-selected={selectedCategory === 'All'}
            onClick={() => setSelectedCategory('All')}
            className={`min-h-[32px] sm:min-h-[36px] px-2.5 sm:px-3.5 py-1 rounded-lg text-[11px] sm:text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
              selectedCategory === 'All'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-slate-800'
            }`}
          >
            {dict.sections.allCategories} ({catalog.length})
          </button>

          {CATEGORY_LIST.map((category) => {
            const active = selectedCategory === category;
            const label = locale === 'id' ? CATEGORY_LABELS_ID[category] : category;
            const count = catalog.filter((item) => item.category === category).length;

            return (
              <button
                key={category}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setSelectedCategory(category)}
                className={`min-h-[32px] sm:min-h-[36px] px-2.5 sm:px-3.5 py-1 rounded-lg text-[11px] sm:text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  active
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-slate-800'
                }`}
              >
                {label} ({count})
              </button>
            );
          })}
        </div>

        {/* Responsive Movie Gallery Grid */}
        {galleryItems.length === 0 ? (
          <EmptyState
            title={
              catalog.length === 0
                ? locale === 'id'
                  ? 'Galeri Video Masih Kosong'
                  : 'Video Gallery is Empty'
                : locale === 'id'
                ? 'Tidak ada video yang cocok dengan filter'
                : 'No releases match your filter'
            }
            description={
              catalog.length === 0
                ? locale === 'id'
                  ? 'Semua konten dummy telah dihapus. Mulai unggah video asli, cover pilihan, atau tautan YouTube & Facebook melalui Studio Kreator.'
                  : 'All sample entries have been cleared. Upload your own release, custom cover, or YouTube & Facebook video via Creator Studio.'
                : locale === 'id'
                ? 'Coba ubah kata kunci pencarian, kategori, atau filter Gratis/Berbayar.'
                : 'Try adjusting your search query, category, or Free/Paid filter.'
            }
            actionLabel={
              catalog.length === 0
                ? locale === 'id'
                  ? 'Unggah di Studio Kreator'
                  : 'Upload in Creator Studio'
                : hasActiveFilter
                ? locale === 'id'
                  ? 'Reset Filter'
                  : 'Reset Filters'
                : locale === 'id'
                ? 'Tampilkan Semua Kategori'
                : 'Show All Categories'
            }
            onAction={() => {
              if (catalog.length === 0) {
                onNavigate('creator-dashboard');
              } else {
                setSelectedCategory('All');
                setPriceFilter('all');
                setSearchQuery('');
              }
            }}
          />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4">
            {galleryItems.map((item) => (
              <ContentCard
                key={item.id}
                item={item}
                locale={locale}
                currency={currency}
                isSaved={savedVideoIds?.has(item.id)}
                onSelectContent={onSelectContent}
                onWatchPreview={(selected) => onWatchPreview(selected)}
                onSelectCreator={onExploreCreator}
                onToggleSave={onToggleSave}
              />
            ))}
          </div>
        )}
      </section>

      {/* 2. FEATURED CREATORS */}
      <section
        aria-labelledby="creators-heading"
        className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8"
      >
        <div className="flex items-start sm:items-end justify-between gap-3 mb-3.5 sm:mb-6">
          <div className="space-y-0.5 sm:space-y-1 min-w-0">
            <h2
              id="creators-heading"
              className="font-display text-lg sm:text-2xl lg:text-3xl font-bold tracking-tight text-slate-900 dark:text-white"
            >
              {dict.sections.featuredCreators}
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 max-w-2xl line-clamp-2 sm:line-clamp-none">
              {dict.sections.creatorsSubtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('explore')}
            className="inline-flex items-center gap-1 min-h-[36px] sm:min-h-[40px] -mt-1 sm:mt-0 text-xs sm:text-sm font-semibold text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <span>{dict.sections.viewAll}</span>
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {creators.length === 0 ? (
          <EmptyState
            title={locale === 'id' ? 'Belum ada kreator terdaftar' : 'No registered creators yet'}
            description={
              locale === 'id'
                ? 'Daftarkan profil kreator Anda sendiri melalui Studio Kreator untuk tampil di etalase kreator DELOKEN.'
                : 'Register your own creator profile via Creator Studio to appear in the DELOKEN creator showcase.'
            }
            actionLabel={locale === 'id' ? 'Buka Studio Kreator' : 'Open Creator Studio'}
            onAction={() => onNavigate('creator-dashboard')}
          />
        ) : (
          <div className="deloken-scroll flex sm:grid sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5 overflow-x-auto sm:overflow-visible pb-1 sm:pb-0 -mx-3 px-3 sm:mx-0 sm:px-0 snap-x snap-mandatory scroll-pl-3 sm:scroll-pl-0">
            {creators.map((creator) => (
              <div
                key={creator.id}
                className="snap-start shrink-0 w-[68vw] max-w-[260px] sm:w-auto sm:max-w-none"
              >
                <CreatorCard
                  creator={creator}
                  locale={locale}
                  isFollowing={followedCreatorIds?.has(creator.id)}
                  onExploreCreator={onExploreCreator}
                  onToggleFollow={onToggleFollow}
                />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
