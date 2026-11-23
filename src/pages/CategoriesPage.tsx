import React from 'react';
import { ArrowRight } from 'lucide-react';
import type {
  ContentCategory,
  ContentItem,
  CurrencyCode,
  LocaleCode,
} from '../types/vyora';
import {
  CATEGORY_DESCRIPTIONS,
  CATEGORY_LABELS_ID,
  CATEGORY_LIST,
} from '../i18n/translations';
import { ContentCard } from '../components/ui/ContentCard';

interface CategoriesPageProps {
  catalog: ContentItem[];
  locale: LocaleCode;
  currency: CurrencyCode;
  onExploreCategory: (category: ContentCategory) => void;
  onSelectContent: (item: ContentItem) => void;
  onWatchPreview: (item: ContentItem) => void;
  onSelectCreator: (creatorId: string) => void;
}

export const CategoriesPage: React.FC<CategoriesPageProps> = ({
  catalog,
  locale,
  currency,
  onExploreCategory,
  onSelectContent,
  onWatchPreview,
  onSelectCreator,
}) => {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-12 space-y-8 sm:space-y-14">
      <header className="space-y-1.5 sm:space-y-2 pb-4 sm:pb-6 border-b border-white/8">
        <h1 className="font-display text-2xl sm:text-4xl font-bold tracking-tight text-[#F5F5F7]">
          {locale === 'id' ? 'Kategori Kurasi' : 'Curated Categories'}
        </h1>
        <p className="text-xs sm:text-base text-[#A5A6B2] max-w-2xl">
          {locale === 'id'
            ? 'Lima jalur utama konten premium di VYORA — dari film festival hingga lokakarya desain dan konser langsung.'
            : 'Five core programming pillars on VYORA — from festival cinema and documentaries to craft education and live concerts.'}
        </p>
      </header>

      <div className="space-y-8 sm:space-y-14">
        {CATEGORY_LIST.map((category) => {
          const items = catalog.filter((item) => item.category === category);
          const label = locale === 'id' ? CATEGORY_LABELS_ID[category] : category;
          const desc =
            locale === 'id'
              ? CATEGORY_DESCRIPTIONS[category].id
              : CATEGORY_DESCRIPTIONS[category].en;

          return (
            <section
              key={category}
              aria-labelledby={`cat-section-${category}`}
              className="space-y-4 sm:space-y-6"
            >
              <div className="flex items-start sm:items-end justify-between gap-3 sm:gap-4">
                <div className="space-y-1 sm:space-y-1.5 max-w-2xl min-w-0">
                  <h2
                    id={`cat-section-${category}`}
                    className="font-display text-lg sm:text-2xl font-bold text-[#F5F5F7]"
                  >
                    {label}
                  </h2>
                  <p className="text-xs sm:text-sm text-[#A5A6B2] line-clamp-2 sm:line-clamp-none">
                    {desc}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => onExploreCategory(category)}
                  className="inline-flex items-center gap-1 min-h-[44px] -mt-1.5 sm:mt-0 text-xs sm:text-sm font-semibold text-[#A78BFA] hover:text-[#F5F5F7] transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <span className="sm:hidden">{locale === 'id' ? 'Semua' : 'See all'}</span>
                  <span className="hidden sm:inline">
                    {locale === 'id' ? `Jelajahi ${label}` : `Explore ${label}`}
                  </span>
                  <ArrowRight className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>

              <div className="vyora-scroll flex sm:grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5 overflow-x-auto sm:overflow-visible pb-2 sm:pb-0 -mx-4 px-4 sm:mx-0 sm:px-0 snap-x snap-mandatory scroll-pl-4 sm:scroll-pl-0">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className="snap-start shrink-0 w-[82vw] max-w-[310px] sm:w-auto sm:max-w-none"
                  >
                    <ContentCard
                      item={item}
                      locale={locale}
                      currency={currency}
                      onSelectContent={onSelectContent}
                      onWatchPreview={onWatchPreview}
                      onSelectCreator={onSelectCreator}
                    />
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
};
