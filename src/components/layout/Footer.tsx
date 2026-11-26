import React from 'react';
import { Globe, Moon, Sun } from 'lucide-react';
import type { CurrencyCode, LocaleCode, ViewRoute } from '../../types/vyora';
import { TRANSLATIONS } from '../../i18n/translations';
import { DelokenLogo } from '../deloken/DelokenLogo';

interface FooterProps {
  locale: LocaleCode;
  currency: CurrencyCode;
  theme: 'light' | 'dark';
  onChangeLocale: (locale: LocaleCode) => void;
  onChangeCurrency: (currency: CurrencyCode) => void;
  onToggleTheme: () => void;
  onNavigate: (route: ViewRoute) => void;
  onOpenSocialNotice: (platformName: string) => void;
}

export const Footer: React.FC<FooterProps> = ({
  locale,
  currency,
  theme,
  onChangeLocale,
  onChangeCurrency,
  onToggleTheme,
  onNavigate,
  onOpenSocialNotice,
}) => {
  const dict = TRANSLATIONS[locale];

  return (
    <footer className="bg-white dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 mt-6 md:mt-12 transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-7 pb-20 md:py-10">
        <div className="grid grid-cols-2 lg:grid-cols-12 gap-5 md:gap-8">
          {/* Brand & Internationalization Controls */}
          <div className="col-span-2 lg:col-span-4 space-y-3">
            <button
              type="button"
              onClick={() => onNavigate('home')}
              className="inline-flex items-center cursor-pointer min-h-[40px]"
              aria-label="DELOKEN Home"
            >
              <DelokenLogo size="sm" />
            </button>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 max-w-xs leading-relaxed">
              {dict.tagline}
            </p>

            {/* Locale, Currency & Theme Switcher */}
            <div className="pt-1 flex flex-wrap items-center gap-2.5 sm:gap-3">
              <div
                className="inline-flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
                role="group"
                aria-label={dict.footer.language}
              >
                <Globe className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 ml-2 mr-1" aria-hidden="true" />
                <button
                  type="button"
                  onClick={() => onChangeLocale('en')}
                  className={`min-h-[38px] sm:min-h-[32px] px-3 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    locale === 'en'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  EN
                </button>
                <button
                  type="button"
                  onClick={() => onChangeLocale('id')}
                  className={`min-h-[38px] sm:min-h-[32px] px-3 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    locale === 'id'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  ID
                </button>
              </div>

              <div
                className="inline-flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
                role="group"
                aria-label={dict.footer.currency}
              >
                <button
                  type="button"
                  onClick={() => onChangeCurrency('USD')}
                  className={`min-h-[38px] sm:min-h-[32px] px-3 py-1 rounded-md text-xs font-mono font-medium transition-colors cursor-pointer whitespace-nowrap ${
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
                  className={`min-h-[38px] sm:min-h-[32px] px-3 py-1 rounded-md text-xs font-mono font-medium transition-colors cursor-pointer whitespace-nowrap ${
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
                onClick={onToggleTheme}
                aria-pressed={theme === 'dark'}
                className="min-h-[40px] sm:min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap"
              >
                {theme === 'dark' ? (
                  <>
                    <Sun className="w-3.5 h-3.5 text-amber-300" aria-hidden="true" />
                    <span>{locale === 'id' ? 'Mode Terang' : 'Light Mode'}</span>
                  </>
                ) : (
                  <>
                    <Moon className="w-3.5 h-3.5 text-slate-600" aria-hidden="true" />
                    <span>{locale === 'id' ? 'Mode Gelap' : 'Dark Mode'}</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Explore Links */}
          <div className="col-span-1 lg:col-span-2 space-y-2.5">
            <h4 className="text-sm font-semibold text-slate-900 dark:text-white">Platform</h4>
            <ul className="space-y-1 text-sm text-slate-600 dark:text-slate-400">
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate('explore')}
                  className="min-h-[40px] md:min-h-0 inline-flex items-center py-1 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                >
                  {dict.nav.explore}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate('categories')}
                  className="min-h-[40px] md:min-h-0 inline-flex items-center py-1 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                >
                  {dict.nav.categories}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate('pricing')}
                  className="min-h-[40px] md:min-h-0 inline-flex items-center py-1 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                >
                  {dict.nav.pricing}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate('search')}
                  className="min-h-[40px] md:min-h-0 inline-flex items-center py-1 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                >
                  {dict.nav.search}
                </button>
              </li>
            </ul>
          </div>

          {/* Company & Legal Links */}
          <div className="col-span-1 lg:col-span-3 space-y-2.5">
            <h4 className="text-sm font-semibold text-slate-900 dark:text-white">Company & Legal</h4>
            <ul className="space-y-1 text-sm text-slate-600 dark:text-slate-400">
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate('about')}
                  className="min-h-[40px] md:min-h-0 inline-flex items-center py-1 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                >
                  {dict.footer.about}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate('contact')}
                  className="min-h-[40px] md:min-h-0 inline-flex items-center py-1 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                >
                  {dict.footer.contact}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate('guidelines')}
                  className="min-h-[40px] md:min-h-0 inline-flex items-center py-1 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                >
                  {dict.footer.guidelines}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate('terms')}
                  className="min-h-[40px] md:min-h-0 inline-flex items-center py-1 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                >
                  {dict.footer.terms}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate('privacy')}
                  className="min-h-[40px] md:min-h-0 inline-flex items-center py-1 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                >
                  {dict.footer.privacy}
                </button>
              </li>
            </ul>
          </div>

          {/* Social Media */}
          <div className="col-span-2 lg:col-span-3 space-y-2.5">
            <h4 className="text-sm font-semibold text-slate-900 dark:text-white">{dict.footer.social}</h4>
            <ul className="grid grid-cols-2 lg:grid-cols-1 gap-x-4 gap-y-1 text-sm text-slate-600 dark:text-slate-400">
              {['Instagram', 'YouTube', 'X / Twitter', 'LinkedIn'].map((platform) => (
                <li key={platform}>
                  <button
                    type="button"
                    onClick={() => onOpenSocialNotice(platform)}
                    className="min-h-[40px] md:min-h-0 inline-flex items-center py-1 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                  >
                    {platform}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 text-xs text-slate-500 dark:text-slate-400">
          <p>
            © {new Date().getFullYear()} {dict.footer.rights}
          </p>
          <p className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
            PayPal · QRIS Indonesia · Credit Wallet
          </p>
        </div>
      </div>
    </footer>
  );
};
