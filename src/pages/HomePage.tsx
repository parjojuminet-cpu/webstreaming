import React, { useMemo, useState } from 'react';
import { ArrowRight, Sparkles } from 'lucide-react';
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
import { Button } from '../components/ui/Button';
import { ContentCard } from '../components/ui/ContentCard';
import { CreatorCard } from '../components/ui/CreatorCard';

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
    const sorted = [...catalog].sort((a, b) => {
      if (Boolean(b.featuredHero) !== Boolean(a.featuredHero)) {
        return b.featuredHero ? 1 : -1;
      }
      if (Boolean(b.trending) !== Boolean(a.trending)) {
        return b.trending ? 1 : -1;
      }
      return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
    });

    if (selectedCategory === 'All') {
      return sorted;
    }
    return sorted.filter((item) => item.category === selectedCategory);
  }, [catalog, selectedCategory]);

  return (
    <div className="space-y-12 sm:space-y-16 lg:space-y-20 pb-10">
      {/* 1. INITIAL MOVIE & STREAMING GALLERY (Above the fold on open) */}
      <section
        aria-labelledby="movie-gallery-heading"
        className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 sm:pt-10 space-y-5 sm:space-y-7"
      >
        <div className="flex items-start sm:items-end justify-between gap-3 pb-4 sm:pb-5 border-b border-white/8">
          <div className="space-y-1.5 min-w-0">
            <h1
              id="movie-gallery-heading"
              className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-[#F5F5F7]"
            >
              {dict.sections.galleryHeading}
            </h1>
            <p className="text-xs sm:text-base text-[#A5A6B2] max-w-2xl">
              {dict.sections.gallerySubtitle}
            </p>
          </div>

          <button
            type="button"
            onClick={() => onNavigate('explore')}
            className="inline-flex items-center gap-1 min-h-[44px] -mt-1 sm:mt-0 text-xs sm:text-sm font-semibold text-[#A78BFA] hover:text-[#F5F5F7] transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <span>{dict.sections.viewAll}</span>
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Category Filter Tabs */}
        <div
          role="tablist"
          aria-label={dict.sections.exploreCategories}
          className="vyora-scroll flex items-center gap-2 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0"
        >
          <button
            type="button"
            role="tab"
            aria-selected={selectedCategory === 'All'}
            onClick={() => setSelectedCategory('All')}
            className={`min-h-[40px] px-4 py-2 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
              selectedCategory === 'All'
                ? 'bg-[#7957ED] text-[#F5F5F7]'
                : 'bg-[#1B1C27] text-[#A5A6B2] hover:text-[#F5F5F7] border border-white/8'
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
                className={`min-h-[40px] px-4 py-2 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  active
                    ? 'bg-[#7957ED] text-[#F5F5F7]'
                    : 'bg-[#1B1C27] text-[#A5A6B2] hover:text-[#F5F5F7] border border-white/8'
                }`}
              >
                {label} ({count})
              </button>
            );
          })}
        </div>

        {/* Responsive Movie Gallery Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
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
      </section>

      {/* 2. FEATURED CREATORS */}
      <section
        aria-labelledby="creators-heading"
        className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8"
      >
        <div className="flex items-start sm:items-end justify-between gap-3 sm:gap-4 mb-5 sm:mb-7">
          <div className="space-y-1 sm:space-y-1.5 min-w-0">
            <h2
              id="creators-heading"
              className="font-display text-xl sm:text-3xl font-bold tracking-tight text-[#F5F5F7]"
            >
              {dict.sections.featuredCreators}
            </h2>
            <p className="text-xs sm:text-sm text-[#A5A6B2] max-w-2xl">
              {dict.sections.creatorsSubtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('explore')}
            className="inline-flex items-center gap-1 min-h-[44px] -mt-1.5 sm:mt-0 text-xs sm:text-sm font-semibold text-[#A78BFA] hover:text-[#F5F5F7] transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <span>{dict.sections.viewAll}</span>
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="vyora-scroll flex sm:grid sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5 overflow-x-auto sm:overflow-visible pb-2 sm:pb-0 -mx-4 px-4 sm:mx-0 sm:px-0 snap-x snap-mandatory scroll-pl-4 sm:scroll-pl-0">
          {creators.map((creator) => (
            <div
              key={creator.id}
              className="snap-start shrink-0 w-[78vw] max-w-[300px] sm:w-auto sm:max-w-none"
            >
              <CreatorCard
                creator={creator}
                locale={locale}
                onExploreCreator={onExploreCreator}
              />
            </div>
          ))}
        </div>
      </section>

      {/* 3. HOW VYORA WORKS */}
      <section
        aria-labelledby="how-heading"
        className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8"
      >
        <div className="bg-[#1B1C27] border border-white/8 rounded-2xl p-5 sm:p-10">
          <div className="max-w-2xl mb-6 sm:mb-9 space-y-1.5 sm:space-y-2">
            <h2
              id="how-heading"
              className="font-display text-xl sm:text-3xl font-bold tracking-tight text-[#F5F5F7]"
            >
              {dict.sections.howItWorks}
            </h2>
            <p className="text-xs sm:text-base text-[#A5A6B2]">
              {dict.sections.howItWorksSubtitle}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-white/8 pt-5 sm:pt-6 border-t border-white/8">
            <div className="space-y-1.5 sm:space-y-2.5 py-4 first:pt-0 md:py-0 md:pr-6">
              <h3 className="text-sm sm:text-lg font-semibold text-[#F5F5F7]">
                {dict.howSteps.step1Title}
              </h3>
              <p className="text-xs sm:text-sm text-[#A5A6B2] leading-relaxed">
                {dict.howSteps.step1Desc}
              </p>
            </div>

            <div className="space-y-1.5 sm:space-y-2.5 py-4 md:py-0 md:px-6">
              <h3 className="text-sm sm:text-lg font-semibold text-[#F5F5F7]">
                {dict.howSteps.step2Title}
              </h3>
              <p className="text-xs sm:text-sm text-[#A5A6B2] leading-relaxed">
                {dict.howSteps.step2Desc}
              </p>
            </div>

            <div className="space-y-1.5 sm:space-y-2.5 py-4 last:pb-0 md:py-0 md:pl-6">
              <h3 className="text-sm sm:text-lg font-semibold text-[#F5F5F7]">
                {dict.howSteps.step3Title}
              </h3>
              <p className="text-xs sm:text-sm text-[#A5A6B2] leading-relaxed">
                {dict.howSteps.step3Desc}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 4. CALL TO ACTION — BECOME A VYORA CREATOR */}
      <section
        aria-labelledby="creator-cta-heading"
        className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8"
      >
        <div className="relative overflow-hidden rounded-2xl bg-[#1B1C27] border border-[#7957ED]/30 p-6 sm:p-10 lg:p-12 flex flex-col lg:flex-row lg:items-center justify-between gap-6 sm:gap-8">
          <div className="max-w-2xl space-y-3">
            <div className="inline-flex items-center gap-2 text-xs font-semibold text-[#A78BFA]">
              <Sparkles className="w-4 h-4" aria-hidden="true" />
              <span>VYORA Creator Economy</span>
            </div>
            <h2
              id="creator-cta-heading"
              className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-[#F5F5F7]"
            >
              {dict.cta.heading}
            </h2>
            <p className="text-sm sm:text-base text-[#A5A6B2] leading-relaxed">
              {dict.cta.body}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-3 shrink-0">
            <Button
              variant="primary"
              size="lg"
              className="w-full sm:w-auto"
              onClick={() => onNavigate('signup')}
            >
              {dict.cta.primaryBtn}
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="w-full sm:w-auto"
              onClick={() => onNavigate('guidelines')}
            >
              {dict.cta.secondaryBtn}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
};
