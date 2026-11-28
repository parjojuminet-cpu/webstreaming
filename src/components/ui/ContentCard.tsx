import React, { useEffect, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import type { ContentItem, CurrencyCode, LocaleCode } from '../../types/vyora';
import {
  CATEGORY_LABELS_ID,
  TRANSLATIONS,
  formatDuration,
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

  const isPortraitOrSquare =
    item.aspectRatio === '9:16' ||
    item.aspectRatio === '4:5' ||
    item.aspectRatio === '1:1';

  const statusBadgeText = isFree
    ? locale === 'id'
      ? 'GRATIS'
      : 'FREE'
    : locale === 'id'
    ? 'BERBAYAR'
    : 'PAID';

  return (
    <article
      className={`group flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-emerald-600 dark:hover:border-emerald-500 rounded-xl overflow-hidden shadow-xs hover:shadow-md transition-all duration-200 ${className}`}
    >
      {/* Thumbnail / Hover Video Clip */}
      <div
        className={`relative aspect-video overflow-hidden ${
          isPortraitOrSquare
            ? 'bg-slate-950'
            : 'bg-slate-100 dark:bg-slate-800'
        }`}
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
            fit={isPortraitOrSquare ? 'contain' : 'cover'}
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
              className={`absolute inset-0 w-full h-full pointer-events-none transition-opacity duration-300 ${
                isPortraitOrSquare ? 'object-contain bg-black' : 'object-cover'
              } ${
                clipReady ? 'opacity-100' : 'opacity-0'
              }`}
            />
          )}

          <div
            className="absolute inset-0 bg-gradient-to-t from-slate-950/75 via-transparent to-slate-950/30"
            aria-hidden="true"
          />
        </button>

        {/* Top-left corner status tag (Free / Paid) */}
        <span
          className={`pointer-events-none select-none absolute top-1.5 left-1.5 sm:top-2 sm:left-2 px-1.5 py-0.5 rounded-[5px] text-[9px] sm:text-[10px] font-semibold tracking-wide leading-none shadow-xs ${
            isFree
              ? 'bg-emerald-600/95 text-white'
              : 'bg-slate-950/80 text-white/95 border border-white/15 backdrop-blur-[2px]'
          }`}
        >
          {statusBadgeText}
        </span>

        {/* Bottom overlay row: duration + compact play trigger */}
        <div className="absolute inset-x-1.5 sm:inset-x-2.5 bottom-1.5 sm:bottom-2 flex items-center justify-between gap-1.5 sm:gap-2 pointer-events-none">
          <span className="text-[10px] sm:text-[11px] font-mono tabular-nums text-white font-medium tracking-tight drop-shadow-xs">
            {formatDuration(item.durationMinutes, locale)}
          </span>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onWatchPreview(item);
            }}
            aria-label={`${isFree ? dict.cards.watchFree : dict.cards.watchPreview}: ${item.title}`}
            className="pointer-events-auto inline-flex items-center justify-center gap-1 w-7 h-7 sm:w-auto sm:h-auto sm:min-h-[30px] sm:px-2.5 sm:py-1 rounded-md bg-slate-900/85 hover:bg-emerald-600 active:bg-emerald-700 text-white text-[11px] font-medium border border-white/20 transition-colors duration-150 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Play className="w-3 h-3 fill-current" aria-hidden="true" />
            <span className="hidden sm:inline">
              {isFree ? dict.cards.watchFree : dict.cards.watchPreview}
            </span>
          </button>
        </div>
      </div>

      {/* Compact Card Body: 2-line small title + single-line Category · Creator */}
      <div className="flex flex-col flex-1 p-2 sm:p-2.5 gap-1 min-w-0">
        <h3 className="text-[11px] sm:text-[13px] font-semibold text-slate-900 dark:text-white leading-[1.3]">
          <button
            type="button"
            onClick={() => onSelectContent(item)}
            className="w-full text-left line-clamp-2 hover:text-emerald-700 dark:hover:text-emerald-400 transition-colors cursor-pointer"
          >
            {item.title}
          </button>
        </h3>

        <div className="mt-auto flex items-center gap-1 text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400 truncate">
          <span className="text-emerald-700 dark:text-emerald-400 font-medium shrink-0">
            {categoryLabel}
          </span>
          <span aria-hidden="true" className="shrink-0">
            ·
          </span>
          {onSelectCreator ? (
            <button
              type="button"
              onClick={() => onSelectCreator(item.creatorId)}
              className="hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer truncate min-w-0"
            >
              {item.creatorName}
            </button>
          ) : (
            <span className="truncate min-w-0">{item.creatorName}</span>
          )}
        </div>
      </div>
    </article>
  );
};
