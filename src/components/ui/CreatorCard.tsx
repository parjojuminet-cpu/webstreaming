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
    <article className="flex flex-col bg-[#1B1C27] border border-white/8 hover:border-[#7957ED]/45 rounded-xl p-5 transition-colors duration-200">
      <div className="flex items-center gap-4 mb-4">
        <div className="w-14 h-14 rounded-full overflow-hidden border border-white/15 shrink-0 bg-[#11121A]">
          <MediaImage
            src={creator.avatarUrl}
            alt={creator.name}
            fallbackTitle={creator.name}
            className="w-full h-full"
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="text-base font-semibold text-[#F5F5F7] truncate">
              {creator.name}
            </h3>
            {creator.verified && (
              <CheckCircle2
                className="w-4 h-4 text-[#A78BFA] shrink-0"
                aria-label="Verified Creator"
              />
            )}
          </div>
          <p className="text-xs text-[#A5A6B2] truncate">{creator.role}</p>
          <p className="text-xs text-[#A5A6B2]/80 mt-0.5 tabular-nums">
            {specialtyLabel} · {creator.contentCount} {dict.cards.titles}
          </p>
        </div>
      </div>

      <p className="text-sm text-[#A5A6B2] leading-relaxed line-clamp-2 mb-5 flex-1">
        {bioText}
      </p>

      <Button
        variant="secondary"
        size="sm"
        className="w-full"
        onClick={() => onExploreCreator(creator.id)}
      >
        {dict.cards.exploreCreator}
      </Button>
    </article>
  );
};
