import React from 'react';
import type { CurrencyCode, LocaleCode, ViewRoute } from '../../types/vyora';
import { TRANSLATIONS } from '../../i18n/translations';

interface FooterProps {
  locale: LocaleCode;
  currency: CurrencyCode;
  onChangeCurrency: (currency: CurrencyCode) => void;
  onNavigate: (route: ViewRoute) => void;
}

export const Footer: React.FC<FooterProps> = ({
  locale,
  currency,
  onChangeCurrency,
  onNavigate,
}) => {
  const dict = TRANSLATIONS[locale];

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

        <div className="flex items-center gap-3">
          <div
            className="inline-flex items-center gap-1 p-0.5 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
            role="group"
            aria-label={dict.footer.currency}
          >
            <button
              type="button"
              onClick={() => onChangeCurrency('USD')}
              className={`min-h-[32px] px-2.5 py-0.5 rounded-md text-[11px] font-mono font-medium transition-colors cursor-pointer whitespace-nowrap ${
                currency === 'USD'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              USD
            </button>
            <button
              type="button"
              onClick={() => onChangeCurrency('IDR')}
              className={`min-h-[32px] px-2.5 py-0.5 rounded-md text-[11px] font-mono font-medium transition-colors cursor-pointer whitespace-nowrap ${
                currency === 'IDR'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              IDR
            </button>
          </div>

          <button
            type="button"
            onClick={() => onNavigate('guide')}
            className="min-h-[36px] inline-flex items-center px-2 font-semibold text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 transition-colors cursor-pointer whitespace-nowrap"
          >
            {locale === 'id' ? 'Panduan & Info' : 'Guide & Info'}
          </button>
        </div>
      </div>
    </footer>
  );
};
