import React, { useEffect, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import type { ContentItem, CurrencyCode, LocaleCode } from '../../types/vyora';
import {
  CATEGORY_LABELS_ID,
  TRANSLATIONS,
  formatDuration,
  formatReleasePrice,
  isFreeContent,
} from '../../i18n/translations';
import { authorizeVideoStream } from '../../services/streamService';
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
  const isFree = isFreeContent(item);

  const [isHovered, setIsHovered] = useState(false);
  const [hoverClipUrl, setHoverClipUrl] = useState<string | null>(null);
  const [clipReady, setClipReady] = useState(false);
  const fetchedClipRef = useRef(false);
  const hoverTimerRef = useRef<number | null>(null);

  useEffect(() => {
    fetchedClipRef.current = false;
    setHoverClipUrl(null);
    setClipReady(false);
  }, [item.id]);

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) {
        window.clearTimeout(hoverTimerRef.current);
      }
    };
  }, []);

  const handleMouseEnter = () => {
    setIsHovered(true);
    if (fetchedClipRef.current) return;

    hoverTimerRef.current = window.setTimeout(() => {
      fetchedClipRef.current = true;
      void authorizeVideoStream(item.id, item.category)
        .then((resp) => {
          if (resp.streamType === 'file' && resp.manifestUrl) {
            setHoverClipUrl(resp.manifestUrl);
          }
        })
        .catch(() => {
          // Keep static cover on fallback
        });
    }, 350);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    setClipReady(false);
    if (hoverTimerRef.current) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  };

  return (
    <article
      className={`group flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-emerald-600 dark:hover:border-emerald-500 rounded-xl overflow-hidden shadow-xs hover:shadow-md transition-all duration-200 ${className}`}
    >
      {/* 16:9 Thumbnail / Hover Video Clip */}
      <div
        className="relative aspect-video overflow-hidden bg-slate-100 dark:bg-slate-800"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <button
          type="button"
          onClick={() => onSelectContent(item)}
          className="block w-full h-full text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
          aria-label={`${item.title} — ${dict.cards.viewDetails}`}
        >
          <MediaImage
            src={item.thumbnailUrl}
            alt={item.title}
            fallbackTitle={item.title}
            className="w-full h-full transition-transform duration-300 ease-out group-hover:scale-[1.03]"
          />

          {isHovered && hoverClipUrl && (
            <video
              src={hoverClipUrl}
              autoPlay
              muted
              playsInline
              preload="metadata"
              onCanPlay={() => setClipReady(true)}
              onTimeUpdate={(e) => {
                if (e.currentTarget.currentTime >= 8) {
                  e.currentTarget.currentTime = 0;
                }
              }}
              className={`absolute inset-0 w-full h-full object-cover pointer-events-none transition-opacity duration-300 ${
                clipReady ? 'opacity-100' : 'opacity-0'
              }`}
            />
          )}

          <div
            className="absolute inset-0 bg-gradient-to-t from-slate-900/80 via-slate-900/15 to-transparent"
            aria-hidden="true"
          />
        </button>

        {/* Bottom overlay row: unboxed duration + compact mobile play button */}
        <div className="absolute inset-x-2 sm:inset-x-3 bottom-1.5 sm:bottom-2.5 flex items-center justify-between gap-1.5 sm:gap-2 pointer-events-none">
          <span className="text-[10px] sm:text-xs font-mono tabular-nums text-white font-medium tracking-tight drop-shadow-xs">
            {formatDuration(item.durationMinutes, locale)}
          </span>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onWatchPreview(item);
            }}
            aria-label={`${isFree ? dict.cards.watchFree : dict.cards.watchPreview}: ${item.title}`}
            className="pointer-events-auto inline-flex items-center justify-center gap-1.5 w-8 h-8 sm:w-auto sm:h-auto sm:min-h-[34px] sm:px-3 sm:py-1 rounded-lg bg-slate-900/85 hover:bg-emerald-600 active:bg-emerald-700 text-white text-xs font-medium border border-white/20 transition-colors duration-150 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Play className="w-3.5 h-3.5 sm:w-3 sm:h-3 fill-current" aria-hidden="true" />
            <span className="hidden sm:inline">
              {isFree ? dict.cards.watchFree : dict.cards.watchPreview}
            </span>
          </button>
        </div>
      </div>

      {/* Card Body: Compact 2-col mobile & full desktop layout */}
      <div className="flex flex-col flex-1 p-2.5 sm:p-4 min-w-0">
        <div className="flex items-center gap-1.5 sm:gap-2 text-[10px] sm:text-xs text-slate-500 dark:text-slate-400 mb-0.5 sm:mb-1.5 truncate">
          <span className="text-emerald-700 dark:text-emerald-400 font-semibold truncate">{categoryLabel}</span>
          <span className="hidden sm:inline" aria-hidden="true">·</span>
          <span className="hidden sm:inline tabular-nums shrink-0">{item.resolution}</span>
        </div>

        <h3 className="text-xs sm:text-base font-semibold text-slate-900 dark:text-white leading-snug mb-0.5 sm:mb-1">
          <button
            type="button"
            onClick={() => onSelectContent(item)}
            className="w-full text-left line-clamp-2 sm:line-clamp-1 hover:text-emerald-700 dark:hover:text-emerald-400 transition-colors cursor-pointer"
          >
            {item.title}
          </button>
        </h3>

        <div className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 mb-2 sm:mb-3.5 truncate">
          {onSelectCreator ? (
            <button
              type="button"
              onClick={() => onSelectCreator(item.creatorId)}
              className="hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer truncate max-w-full"
            >
              {item.creatorName}
            </button>
          ) : (
            <span className="truncate block">{item.creatorName}</span>
          )}
        </div>

        <div className="mt-auto pt-1.5 sm:pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
          <div className="flex flex-col min-w-0">
            <span
              className={`text-xs sm:text-sm font-semibold font-mono tabular-nums truncate ${
                isFree
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-slate-900 dark:text-white'
              }`}
            >
              {formatReleasePrice(item, locale, currency)}
            </span>
            <span className="hidden sm:block text-[11px] text-slate-500 dark:text-slate-400 truncate">
              {isFree ? dict.cards.freeAccess : dict.cards.access30Days}
            </span>
          </div>

          <button
            type="button"
            onClick={() => onSelectContent(item)}
            className="hidden sm:inline-flex items-center justify-center min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-semibold text-slate-800 dark:text-slate-100 bg-slate-50 dark:bg-slate-800 hover:bg-emerald-600 dark:hover:bg-emerald-600 hover:text-white border border-slate-200 dark:border-slate-700 hover:border-transparent transition-colors duration-150 cursor-pointer whitespace-nowrap shrink-0"
          >
            {dict.cards.viewDetails}
          </button>
        </div>
      </div>
    </article>
  );
};
