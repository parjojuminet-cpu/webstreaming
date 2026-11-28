import React from 'react';
import type { LocaleCode, ViewRoute } from '../../types/vyora';

interface FooterProps {
  locale: LocaleCode;
  onNavigate: (route: ViewRoute) => void;
}

export const Footer: React.FC<FooterProps> = ({
  locale,
  onNavigate,
}) => {
  return (
    <footer className="bg-white dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 mt-4 md:mt-8 transition-colors">
      <div className="max-w-7xl mx-auto px-3.5 sm:px-6 lg:px-8 pt-4 pb-20 md:py-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="font-medium text-slate-700 dark:text-slate-300">
            © {new Date().getFullYear()} DELOKEN
          </span>
          <span aria-hidden="true">·</span>
          <span className="font-mono tabular-nums">PayPal · QRIS Indonesia</span>
        </div>

        <button
          type="button"
          onClick={() => onNavigate('guide')}
          className="min-h-[36px] inline-flex items-center px-2 font-semibold text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 transition-colors cursor-pointer whitespace-nowrap"
        >
          {locale === 'id' ? 'Panduan & Info' : 'Guide & Info'}
        </button>
      </div>
    </footer>
  );
};
