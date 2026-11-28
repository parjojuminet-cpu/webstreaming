import React from 'react';
import { CheckCircle2, UserCheck, UserPlus } from 'lucide-react';
import type { CreatorProfile, LocaleCode } from '../../types/vyora';
import { CATEGORY_LABELS_ID, TRANSLATIONS } from '../../i18n/translations';
import { MediaImage } from './MediaImage';
import { Button } from './Button';

interface CreatorCardProps {
  creator: CreatorProfile;
  locale: LocaleCode;
  isFollowing?: boolean;
  onExploreCreator: (creatorId: string) => void;
  onToggleFollow?: (creatorId: string) => void;
}

export const CreatorCard: React.FC<CreatorCardProps> = ({
  creator,
  locale,
  isFollowing = false,
  onExploreCreator,
  onToggleFollow,
}) => {
  const dict = TRANSLATIONS[locale];
  const specialtyLabel =
    locale === 'id' ? CATEGORY_LABELS_ID[creator.specialty] : creator.specialty;
  const bioText = locale === 'id' ? creator.bioId : creator.bio;
  const followerCount = Math.max(0, creator.followerCount ?? 0);

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
            {followerCount > 0 &&
              ` · ${followerCount} ${locale === 'id' ? 'pengikut' : 'followers'}`}
          </p>
        </div>
      </div>

      <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed line-clamp-2 mb-3.5 sm:mb-5 flex-1">
        {bioText}
      </p>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={() => onExploreCreator(creator.id)}
        >
          {dict.cards.exploreCreator}
        </Button>

        {onToggleFollow && (
          <Button
            variant={isFollowing ? 'secondary' : 'primary'}
            size="sm"
            aria-pressed={isFollowing}
            leftIcon={
              isFollowing ? (
                <UserCheck className="w-3.5 h-3.5" aria-hidden="true" />
              ) : (
                <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
              )
            }
            onClick={() => onToggleFollow(creator.id)}
          >
            {isFollowing
              ? locale === 'id'
                ? 'Mengikuti'
                : 'Following'
              : locale === 'id'
              ? 'Ikuti'
              : 'Follow'}
          </Button>
        )}
      </div>
    </article>
  );
};
