import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy, MessageCircle, Share2 } from 'lucide-react';
import type { LocaleCode } from '../../types/vyora';
import {
  buildWhatsAppShareHref,
  copyTextToClipboard,
  shareContentUrl,
} from '../../utils/share';

interface ShareActionsProps {
  title: string;
  url: string;
  locale: LocaleCode;
  compact?: boolean;
  className?: string;
}

export const ShareActions: React.FC<ShareActionsProps> = ({
  title,
  url,
  locale,
  compact = false,
  className = '',
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKey);
    };
  }, [menuOpen]);

  const handlePrimaryShare = async () => {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      const result = await shareContentUrl({ title, url });
      if (result === 'copied') {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      }
      if (result === 'shared' || result === 'copied') return;
    }
    setMenuOpen((prev) => !prev);
  };

  const handleCopy = async () => {
    const ok = await copyTextToClipboard(url);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => {
        setCopied(false);
        setMenuOpen(false);
      }, 1500);
    }
  };

  return (
    <div ref={containerRef} className={`relative inline-flex ${className}`}>
      <button
        type="button"
        onClick={() => void handlePrimaryShare()}
        aria-expanded={menuOpen}
        aria-label={locale === 'id' ? 'Bagikan tautan' : 'Share link'}
        className={`inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer whitespace-nowrap ${
          compact
            ? 'min-h-[34px] px-2.5 py-1 text-xs font-medium rounded-lg'
            : 'min-h-[42px] px-3.5 py-2 text-xs sm:text-sm font-semibold'
        }`}
      >
        {copied ? (
          <>
            <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            <span>{locale === 'id' ? 'Disalin' : 'Copied'}</span>
          </>
        ) : (
          <>
            <Share2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{locale === 'id' ? 'Bagikan' : 'Share'}</span>
          </>
        )}
      </button>

      {menuOpen && (
        <div
          role="menu"
          className="absolute right-0 bottom-full mb-2 sm:bottom-auto sm:top-full sm:mt-2 sm:mb-0 z-50 w-52 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl p-1.5 space-y-1"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => void handleCopy()}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer text-left"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />
            ) : (
              <Copy className="w-3.5 h-3.5 text-slate-500 shrink-0" aria-hidden="true" />
            )}
            <span>
              {copied
                ? locale === 'id'
                  ? 'Tautan Disalin!'
                  : 'Link Copied!'
                : locale === 'id'
                ? 'Salin Tautan'
                : 'Copy Link'}
            </span>
          </button>

          <a
            href={buildWhatsAppShareHref(title, url, locale)}
            target="_blank"
            rel="noopener noreferrer"
            role="menuitem"
            onClick={() => setMenuOpen(false)}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 transition-colors"
          >
            <MessageCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>{locale === 'id' ? 'Bagikan ke WhatsApp' : 'Share on WhatsApp'}</span>
          </a>
        </div>
      )}
    </div>
  );
};
