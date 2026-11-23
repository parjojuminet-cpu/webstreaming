import React from 'react';
import { ArrowLeft, CheckCircle2, MapPin } from 'lucide-react';
import type {
  ContentItem,
  CreatorProfile,
  CurrencyCode,
  LocaleCode,
} from '../types/vyora';
import { CATEGORY_LABELS_ID, TRANSLATIONS } from '../i18n/translations';
import { ContentCard } from '../components/ui/ContentCard';
import { MediaImage } from '../components/ui/MediaImage';

interface CreatorDetailPageProps {
  creator: CreatorProfile;
  works: ContentItem[];
  locale: LocaleCode;
  currency: CurrencyCode;
  onBack: () => void;
  onSelectContent: (item: ContentItem) => void;
  onWatchPreview: (item: ContentItem) => void;
}

export const CreatorDetailPage: React.FC<CreatorDetailPageProps> = ({
  creator,
  works,
  locale,
  currency,
  onBack,
  onSelectContent,
  onWatchPreview,
}) => {
  const dict = TRANSLATIONS[locale];
  const bio = locale === 'id' ? creator.bioId : creator.bio;
  const specialtyLabel =
    locale === 'id' ? CATEGORY_LABELS_ID[creator.specialty] : creator.specialty;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 space-y-8 sm:space-y-12">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 min-h-[44px] text-xs font-semibold text-[#A5A6B2] hover:text-[#F5F5F7] transition-colors cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        <span>{locale === 'id' ? 'Kembali' : 'Back'}</span>
      </button>

      {/* Creator Profile Header */}
      <section className="bg-[#1B1C27] border border-white/10 rounded-2xl p-5 sm:p-10 flex flex-col md:flex-row items-start md:items-center gap-5 sm:gap-7">
        <div className="w-20 h-20 sm:w-28 sm:h-28 rounded-full overflow-hidden border border-white/15 shrink-0">
          <MediaImage
            src={creator.avatarUrl}
            alt={creator.name}
            fallbackTitle={creator.name}
            loading="eager"
            className="w-full h-full"
          />
        </div>

        <div className="space-y-3 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#F5F5F7]">
              {creator.name}
            </h1>
            {creator.verified && (
              <CheckCircle2 className="w-5 h-5 text-[#A78BFA]" aria-label="Verified Creator" />
            )}
            <span className="text-xs font-mono text-[#A5A6B2]">{creator.handle}</span>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs sm:text-sm text-[#A5A6B2]">
            <span className="text-[#A78BFA] font-medium">{creator.role}</span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
              {creator.location}
            </span>
            <span aria-hidden="true">·</span>
            <span>{specialtyLabel}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              {creator.contentCount} {dict.cards.titles}
            </span>
          </div>

          <p className="text-sm sm:text-base text-[#A5A6B2] leading-relaxed max-w-3xl">
            {bio}
          </p>
        </div>
      </section>

      {/* Creator Releases */}
      <section className="space-y-6">
        <h2 className="font-display text-2xl font-bold text-[#F5F5F7]">
          {locale === 'id'
            ? `Rilisan oleh ${creator.name}`
            : `Releases by ${creator.name}`}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {works.map((item) => (
            <ContentCard
              key={item.id}
              item={item}
              locale={locale}
              currency={currency}
              onSelectContent={onSelectContent}
              onWatchPreview={onWatchPreview}
            />
          ))}
        </div>
      </section>
    </div>
  );
};
