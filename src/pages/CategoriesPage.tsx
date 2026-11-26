import React from 'react';
import { ArrowRight } from 'lucide-react';
import type {
  ContentCategory,
  ContentItem,
  CurrencyCode,
  LocaleCode,
  ViewRoute,
} from '../types/vyora';
import {
  CATEGORY_DESCRIPTIONS,
  CATEGORY_LABELS_ID,
  CATEGORY_LIST,
} from '../i18n/translations';
import { ContentCard } from '../components/ui/ContentCard';
import { EmptyState } from '../components/ui/StateViews';

interface CategoriesPageProps {
  catalog: ContentItem[];
  locale: LocaleCode;
  currency: CurrencyCode;
  onExploreCategory: (category: ContentCategory) => void;
  onSelectContent: (item: ContentItem) => void;
  onWatchPreview: (item: ContentItem) => void;
  onSelectCreator: (creatorId: string) => void;
  onNavigate?: (route: ViewRoute) => void;
}

export const CategoriesPage: React.FC<CategoriesPageProps> = ({
  catalog,
  locale,
  currency,
  onExploreCategory,
  onSelectContent,
  onWatchPreview,
  onSelectCreator,
  onNavigate,
}) => {
  const nonEmptyCategories = CATEGORY_LIST.filter((category) =>
    catalog.some((item) => item.category === category)
  );

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-8 space-y-5 sm:space-y-10">
      <header className="space-y-1 pb-3 sm:pb-5 border-b border-slate-200 dark:border-slate-800">
        <h1 className="font-display text-lg sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
          {locale === 'id' ? 'Kategori Kurasi' : 'Curated Categories'}
        </h1>
        <p className="text-[11px] sm:text-sm text-slate-600 dark:text-slate-400 max-w-2xl line-clamp-2 sm:line-clamp-none">
          {locale === 'id'
            ? 'Lima jalur utama konten premium di DELOKEN — dari film festival hingga lokakarya desain dan konser langsung.'
            : 'Five core programming pillars on DELOKEN — from festival cinema and documentaries to craft education and live concerts.'}
        </p>
      </header>

      {nonEmptyCategories.length === 0 ? (
        <EmptyState
          title={locale === 'id' ? 'Belum ada video di kategori mana pun' : 'No releases in any category yet'}
          description={
            locale === 'id'
              ? 'Unggah video pertama Anda melalui Studio Kreator untuk mengisi kategori pilihan di DELOKEN.'
              : 'Upload your first release in Creator Studio to populate DELOKEN categories.'
          }
          actionLabel={onNavigate ? (locale === 'id' ? 'Buka Studio Kreator' : 'Open Creator Studio') : undefined}
          onAction={onNavigate ? () => onNavigate('creator-dashboard') : undefined}
        />
      ) : (
        <div className="space-y-6 sm:space-y-10">
          {nonEmptyCategories.map((category) => {
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
                className="space-y-2.5 sm:space-y-4"
              >
                <div className="flex items-start sm:items-end justify-between gap-3">
                  <div className="space-y-0.5 sm:space-y-1 max-w-2xl min-w-0">
                    <h2
                      id={`cat-section-${category}`}
                      className="font-display text-base sm:text-xl font-bold text-slate-900 dark:text-white"
                    >
                      {label}
                    </h2>
                    <p className="text-[11px] sm:text-sm text-slate-600 dark:text-slate-400 line-clamp-1 sm:line-clamp-none">
                      {desc}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => onExploreCategory(category)}
                    className="inline-flex items-center gap-1 min-h-[36px] -mt-1 sm:mt-0 text-xs sm:text-sm font-semibold text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <span className="sm:hidden">{locale === 'id' ? 'Semua' : 'See all'}</span>
                    <span className="hidden sm:inline">
                      {locale === 'id' ? `Jelajahi ${label}` : `Explore ${label}`}
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 sm:w-4 sm:h-4" aria-hidden="true" />
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-5">
                  {items.map((item) => (
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
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
};
