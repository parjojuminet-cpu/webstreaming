import React from 'react';
import { Play } from 'lucide-react';
import type { ContentItem, CurrencyCode, LocaleCode } from '../../types/vyora';
import {
  CATEGORY_LABELS_ID,
  TRANSLATIONS,
  formatDuration,
  formatPrice,
} from '../../i18n/translations';
import { MediaImage } from './MediaImage';

interface ContentCardProps {
  item: ContentItem;
  locale: LocaleCode;
  currency: CurrencyCode;
  onSelectContent: (item: ContentItem) => void;
  onWatchPreview: (item: ContentItem) => void;
  onSelectCreator?: (creatorId: string) => void;
  className?: string;
}

export const ContentCard: React.FC<ContentCardProps> = ({
  item,
  locale,
  currency,
  onSelectContent,
  onWatchPreview,
  onSelectCreator,
  className = '',
}) => {
  const dict = TRANSLATIONS[locale];
  const categoryLabel = locale === 'id' ? CATEGORY_LABELS_ID[item.category] : item.category;

  return (
    <article
      className={`group flex flex-col bg-[#1B1C27] border border-white/8 hover:border-[#7957ED]/50 rounded-xl overflow-hidden transition-colors duration-200 ${className}`}
    >
      {/* 16:9 Cinema Thumbnail */}
      <div className="relative aspect-video overflow-hidden bg-[#11121A]">
        <button
          type="button"
          onClick={() => onSelectContent(item)}
          className="block w-full h-full text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A78BFA]"
          aria-label={`${item.title} — ${dict.cards.viewDetails}`}
        >
          <MediaImage
            src={item.thumbnailUrl}
            alt={item.title}
            fallbackTitle={item.title}
            className="w-full h-full transition-transform duration-300 ease-out group-hover:scale-[1.03]"
          />
          <div
            className="absolute inset-0 bg-gradient-to-t from-[#11121A]/90 via-[#11121A]/20 to-transparent"
            aria-hidden="true"
          />
        </button>

        {/* Bottom overlay row: unboxed duration + hover preview trigger */}
        <div className="absolute inset-x-3 bottom-2.5 flex items-center justify-between gap-2 pointer-events-none">
          <span className="text-xs font-mono tabular-nums text-[#F5F5F7]/90 tracking-tight">
            {formatDuration(item.durationMinutes, locale)}
          </span>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onWatchPreview(item);
            }}
            className="pointer-events-auto inline-flex items-center gap-1.5 min-h-[36px] px-3 py-1.5 rounded-lg bg-[#11121A]/85 hover:bg-[#7957ED] active:bg-[#7957ED] text-[#F5F5F7] text-xs font-medium border border-white/15 transition-colors duration-150 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Play className="w-3 h-3 fill-current" aria-hidden="true" />
            <span>{dict.cards.watchPreview}</span>
          </button>
        </div>
      </div>

      {/* Card Body: Clean unboxed metadata + Title + Creator + Price */}
      <div className="flex flex-col flex-1 p-4 min-w-0">
        <div className="flex items-center gap-2 text-xs text-[#A5A6B2] mb-1.5 truncate">
          <span className="text-[#A78BFA] font-medium truncate">{categoryLabel}</span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums shrink-0">{item.resolution}</span>
        </div>

        <h3 className="text-base font-semibold text-[#F5F5F7] leading-snug mb-1">
          <button
            type="button"
            onClick={() => onSelectContent(item)}
            className="w-full text-left truncate hover:text-[#A78BFA] transition-colors cursor-pointer"
          >
            {item.title}
          </button>
        </h3>

        <div className="text-xs text-[#A5A6B2] mb-4 truncate">
          {onSelectCreator ? (
            <button
              type="button"
              onClick={() => onSelectCreator(item.creatorId)}
              className="hover:text-[#F5F5F7] transition-colors cursor-pointer truncate max-w-full"
            >
              {item.creatorName}
            </button>
          ) : (
            <span>{item.creatorName}</span>
          )}
        </div>

        <div className="mt-auto pt-3 border-t border-white/8 flex items-center justify-between gap-2.5">
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-semibold font-mono tabular-nums text-[#F5F5F7] truncate">
              {formatPrice(item.priceUsd, item.priceIdr, currency)}
            </span>
            <span className="text-[11px] text-[#A5A6B2] truncate">{dict.cards.access30Days}</span>
          </div>

          <button
            type="button"
            onClick={() => onSelectContent(item)}
            className="min-h-[44px] sm:min-h-[40px] px-3.5 py-2 rounded-lg text-xs font-semibold text-[#F5F5F7] bg-[#11121A] hover:bg-[#7957ED] border border-white/10 hover:border-transparent transition-colors duration-150 cursor-pointer whitespace-nowrap shrink-0"
          >
            {dict.cards.viewDetails}
          </button>
        </div>
      </div>
    </article>
  );
};
