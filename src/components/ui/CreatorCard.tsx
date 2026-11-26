import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import type { CreatorProfile, LocaleCode } from '../../types/vyora';
import { CATEGORY_LABELS_ID, TRANSLATIONS } from '../../i18n/translations';
import { MediaImage } from './MediaImage';
import { Button } from './Button';

interface CreatorCardProps {
  creator: CreatorProfile;
  locale: LocaleCode;
  onExploreCreator: (creatorId: string) => void;
}

export const CreatorCard: React.FC<CreatorCardProps> = ({
  creator,
  locale,
  onExploreCreator,
}) => {
  const dict = TRANSLATIONS[locale];
  const specialtyLabel =
    locale === 'id' ? CATEGORY_LABELS_ID[creator.specialty] : creator.specialty;
  const bioText = locale === 'id' ? creator.bioId : creator.bio;

  return (
    <article className="flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-emerald-600 dark:hover:border-emerald-500 rounded-xl p-3.5 sm:p-5 shadow-xs transition-colors duration-200">
      <div className="flex items-center gap-3 sm:gap-4 mb-2.5 sm:mb-4">
        <div className="w-11 h-11 sm:w-14 sm:h-14 rounded-full overflow-hidden border border-slate-200 dark:border-slate-700 shrink-0 bg-slate-100 dark:bg-slate-800">
          <MediaImage
            src={creator.avatarUrl}
            alt={creator.name}
            fallbackTitle={creator.name}
            className="w-full h-full"
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="text-sm sm:text-base font-semibold text-slate-900 dark:text-white truncate">
              {creator.name}
            </h3>
            {creator.verified && (
              <CheckCircle2
                className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0"
                aria-label="Verified Creator"
              />
            )}
          </div>
          <p className="text-[11px] sm:text-xs text-slate-600 dark:text-slate-400 truncate">{creator.role}</p>
          <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums truncate">
            {specialtyLabel} · {creator.contentCount} {dict.cards.titles}
          </p>
        </div>
      </div>

      <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed line-clamp-2 mb-3.5 sm:mb-5 flex-1">
        {bioText}
      </p>

      <Button
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => onExploreCreator(creator.id)}
      >
        {dict.cards.exploreCreator}
      </Button>
    </article>
  );
};
