import React from 'react';
import { ArrowLeft, CheckCircle2, MapPin, UserCheck, UserPlus } from 'lucide-react';
import type {
  ContentItem,
  CreatorProfile,
  CurrencyCode,
  LocaleCode,
} from '../types/vyora';
import { CATEGORY_LABELS_ID, TRANSLATIONS } from '../i18n/translations';
import { buildAbsoluteShareUrl } from '../utils/navigation';
import { Button } from '../components/ui/Button';
import { ContentCard } from '../components/ui/ContentCard';
import { MediaImage } from '../components/ui/MediaImage';
import { ShareActions } from '../components/ui/ShareActions';

interface CreatorDetailPageProps {
  creator: CreatorProfile;
  works: ContentItem[];
  locale: LocaleCode;
  currency: CurrencyCode;
  isFollowing?: boolean;
  savedVideoIds?: Set<string>;
  onBack: () => void;
  onSelectContent: (item: ContentItem) => void;
  onWatchPreview: (item: ContentItem) => void;
  onToggleFollow?: (creatorId: string) => void;
  onToggleSave?: (item: ContentItem) => void;
}

export const CreatorDetailPage: React.FC<CreatorDetailPageProps> = ({
  creator,
  works,
  locale,
  currency,
  isFollowing = false,
  savedVideoIds,
  onBack,
  onSelectContent,
  onWatchPreview,
  onToggleFollow,
  onToggleSave,
}) => {
  const dict = TRANSLATIONS[locale];
  const bio = locale === 'id' ? creator.bioId : creator.bio;
  const specialtyLabel =
    locale === 'id' ? CATEGORY_LABELS_ID[creator.specialty] : creator.specialty;
  const followerCount = Math.max(0, creator.followerCount ?? 0);

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-8 space-y-5 sm:space-y-8">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 min-h-[38px] text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        <span>{locale === 'id' ? 'Kembali' : 'Back'}</span>
      </button>

      {/* Creator Profile Header */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-7 shadow-xs flex flex-col md:flex-row items-start md:items-center gap-4 sm:gap-6">
        <div className="w-16 h-16 sm:w-24 sm:h-24 rounded-full overflow-hidden border border-slate-200 dark:border-slate-700 shrink-0 bg-slate-100 dark:bg-slate-800">
          <MediaImage
            src={creator.avatarUrl}
            alt={creator.name}
            fallbackTitle={creator.name}
            loading="eager"
            className="w-full h-full"
          />
        </div>

        <div className="space-y-2 flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-xl sm:text-3xl font-bold text-slate-900 dark:text-white">
              {creator.name}
            </h1>
            {creator.verified && (
              <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-600 dark:text-emerald-400" aria-label="Verified Creator" />
            )}
            <span className="text-xs font-mono text-slate-500 dark:text-slate-400">{creator.handle}</span>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <span className="text-emerald-700 dark:text-emerald-400 font-semibold">{creator.role}</span>
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
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              {followerCount} {locale === 'id' ? 'pengikut' : 'followers'}
            </span>
          </div>

          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed max-w-3xl">
            {bio}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0 w-full md:w-auto">
          {onToggleFollow && (
            <Button
              variant={isFollowing ? 'secondary' : 'primary'}
              size="md"
              className="flex-1 md:flex-none"
              leftIcon={
                isFollowing ? (
                  <UserCheck className="w-4 h-4" aria-hidden="true" />
                ) : (
                  <UserPlus className="w-4 h-4" aria-hidden="true" />
                )
              }
              onClick={() => onToggleFollow(creator.id)}
            >
              {isFollowing
                ? locale === 'id'
                  ? 'Mengikuti'
                  : 'Following'
                : locale === 'id'
                ? 'Ikuti Kreator'
                : 'Follow Creator'}
            </Button>
          )}
          <ShareActions
            title={`${creator.name} — DELOKEN`}
            url={buildAbsoluteShareUrl({ route: 'creator', creatorId: creator.id })}
            locale={locale}
          />
        </div>
      </section>

      {/* Creator Releases */}
      <section className="space-y-3 sm:space-y-5">
        <h2 className="font-display text-lg sm:text-2xl font-bold text-slate-900 dark:text-white">
          {locale === 'id'
            ? `Rilisan oleh ${creator.name}`
            : `Releases by ${creator.name}`}
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-5">
          {works.map((item) => (
            <ContentCard
              key={item.id}
              item={item}
              locale={locale}
              currency={currency}
              isSaved={savedVideoIds?.has(item.id)}
              onSelectContent={onSelectContent}
              onWatchPreview={onWatchPreview}
              onToggleSave={onToggleSave}
            />
          ))}
        </div>
      </section>
    </div>
  );
};
