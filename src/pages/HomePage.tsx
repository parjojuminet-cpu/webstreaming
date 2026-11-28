import React, { useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import type {
  ContentCategory,
  ContentItem,
  CreatorProfile,
  CurrencyCode,
  LocaleCode,
  ViewRoute,
} from '../types/vyora';
import {
  CATEGORY_LABELS_ID,
  CATEGORY_LIST,
  TRANSLATIONS,
} from '../i18n/translations';
import { ContentCard } from '../components/ui/ContentCard';
import { CreatorCard } from '../components/ui/CreatorCard';
import { EmptyState } from '../components/ui/StateViews';

interface HomePageProps {
  catalog: ContentItem[];
  creators: CreatorProfile[];
  locale: LocaleCode;
  currency: CurrencyCode;
  onWatchPreview: (item: ContentItem) => void;
  onSelectContent: (item: ContentItem) => void;
  onExploreCategory: (category: ContentCategory) => void;
  onExploreCreator: (creatorId: string) => void;
  onNavigate: (route: ViewRoute) => void;
}

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

export const HomePage: React.FC<HomePageProps> = ({
  catalog,
  creators,
  locale,
  currency,
  onWatchPreview,
  onSelectContent,
  onExploreCreator,
  onNavigate,
}) => {
  const dict = TRANSLATIONS[locale];
  const [selectedCategory, setSelectedCategory] = useState<ContentCategory | 'All'>('All');

  const galleryItems = useMemo(() => {
    const randomized = [...catalog].sort((a, b) => {
      const rankA = computeRandomRank(SESSION_SHUFFLE_SEED, a.id);
      const rankB = computeRandomRank(SESSION_SHUFFLE_SEED, b.id);
      if (rankA !== rankB) return rankA - rankB;
      return a.id.localeCompare(b.id);
    });

    if (selectedCategory === 'All') {
      return randomized;
    }
    return randomized.filter((item) => item.category === selectedCategory);
  }, [catalog, selectedCategory]);

  return (
    <div className="space-y-6 sm:space-y-10 lg:space-y-12 pb-4 sm:pb-8">
      {/* 1. INITIAL MOVIE & STREAMING GALLERY (Above the fold on open) */}
      <section
        aria-labelledby="movie-gallery-heading"
        className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 pt-2 sm:pt-5 space-y-2.5 sm:space-y-4"
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
                ? 'Belum ada video di kategori ini'
                : 'No releases in this category yet'
            }
            description={
              catalog.length === 0
                ? locale === 'id'
                  ? 'Semua konten dummy telah dihapus. Mulai unggah video asli, cover pilihan, atau tautan YouTube & Facebook melalui Studio Kreator.'
                  : 'All sample entries have been cleared. Upload your own release, custom cover, or YouTube & Facebook video via Creator Studio.'
                : locale === 'id'
                ? 'Pilih kategori lain atau unggah video baru ke kategori ini.'
                : 'Try another category or upload a new release in this category.'
            }
            actionLabel={
              catalog.length === 0
                ? locale === 'id'
                  ? 'Unggah di Studio Kreator'
                  : 'Upload in Creator Studio'
                : locale === 'id'
                ? 'Tampilkan Semua Kategori'
                : 'Show All Categories'
            }
            onAction={() => {
              if (catalog.length === 0) {
                onNavigate('creator-dashboard');
              } else {
                setSelectedCategory('All');
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
                onSelectContent={onSelectContent}
                onWatchPreview={onWatchPreview}
                onSelectCreator={onExploreCreator}
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
                  onExploreCreator={onExploreCreator}
                />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
