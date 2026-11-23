import React from 'react';
import { Globe } from 'lucide-react';
import type { CurrencyCode, LocaleCode, ViewRoute } from '../../types/vyora';
import { TRANSLATIONS } from '../../i18n/translations';

interface FooterProps {
  locale: LocaleCode;
  currency: CurrencyCode;
  onChangeLocale: (locale: LocaleCode) => void;
  onChangeCurrency: (currency: CurrencyCode) => void;
  onNavigate: (route: ViewRoute) => void;
  onOpenSocialNotice: (platformName: string) => void;
}

export const Footer: React.FC<FooterProps> = ({
  locale,
  currency,
  onChangeLocale,
  onChangeCurrency,
  onNavigate,
  onOpenSocialNotice,
}) => {
  const dict = TRANSLATIONS[locale];

  return (
    <footer className="bg-[#11121A] border-t border-white/8 mt-10 md:mt-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-24 md:py-14">
        <div className="grid grid-cols-2 lg:grid-cols-12 gap-8 md:gap-10">
          {/* Brand & Internationalization Controls */}
          <div className="col-span-2 lg:col-span-4 space-y-4">
            <button
              type="button"
              onClick={() => onNavigate('home')}
              className="inline-flex items-center gap-2.5 text-[#F5F5F7] cursor-pointer min-h-[44px]"
            >
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <rect width="24" height="24" rx="6" fill="#7957ED" />
                <path
                  d="M6.5 7.25L12 17.25L17.5 7.25H14.6L12 12.25L9.4 7.25H6.5Z"
                  fill="#F5F5F7"
                />
              </svg>
              <span className="font-display text-lg font-bold tracking-tight">
                VYORA
              </span>
            </button>
            <p className="text-sm text-[#A5A6B2] max-w-xs leading-relaxed">
              {dict.tagline}
            </p>

            {/* Locale & Currency Switcher */}
            <div className="pt-1 flex flex-wrap items-center gap-2.5 sm:gap-3">
              <div
                className="inline-flex items-center gap-1 p-1 rounded-lg bg-[#1B1C27] border border-white/8"
                role="group"
                aria-label={dict.footer.language}
              >
                <Globe className="w-3.5 h-3.5 text-[#A5A6B2] ml-2 mr-1" aria-hidden="true" />
                <button
                  type="button"
                  onClick={() => onChangeLocale('en')}
                  className={`min-h-[38px] sm:min-h-[32px] px-3 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    locale === 'en'
                      ? 'bg-[#7957ED] text-[#F5F5F7]'
                      : 'text-[#A5A6B2] hover:text-[#F5F5F7]'
                  }`}
                >
                  EN
                </button>
                <button
                  type="button"
                  onClick={() => onChangeLocale('id')}
                  className={`min-h-[38px] sm:min-h-[32px] px-3 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    locale === 'id'
                      ? 'bg-[#7957ED] text-[#F5F5F7]'
                      : 'text-[#A5A6B2] hover:text-[#F5F5F7]'
                  }`}
                >
                  ID
                </button>
              </div>

              <div
                className="inline-flex items-center gap-1 p-1 rounded-lg bg-[#1B1C27] border border-white/8"
                role="group"
                aria-label={dict.footer.currency}
              >
                <button
                  type="button"
                  onClick={() => onChangeCurrency('USD')}
                  className={`min-h-[38px] sm:min-h-[32px] px-3 py-1 rounded-md text-xs font-mono font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    currency === 'USD'
                      ? 'bg-[#7957ED] text-[#F5F5F7]'
                      : 'text-[#A5A6B2] hover:text-[#F5F5F7]'
                  }`}
                >
                  USD
                </button>
                <button
                  type="button"
                  onClick={() => onChangeCurrency('IDR')}
                  className={`min-h-[38px] sm:min-h-[32px] px-3 py-1 rounded-md text-xs font-mono font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    currency === 'IDR'
                      ? 'bg-[#7957ED] text-[#F5F5F7]'
                      : 'text-[#A5A6B2] hover:text-[#F5F5F7]'
                  }`}
                >
                  IDR
                </button>
              </div>
            </div>
          </div>

          {/* Explore Links */}
          <div className="col-span-1 lg:col-span-2 space-y-2.5">
            <h4 className="text-sm font-semibold text-[#F5F5F7]">Platform</h4>
            <ul className="space-y-1 text-sm text-[#A5A6B2]">
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate('explore')}
                  className="min-h-[40px] md:min-h-0 inline-flex items-center py-1 hover:text-[#F5F5F7] transition-colors cursor-pointer"
                >
                  {dict.nav.explore}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate('categories')}
                  className="min-h-[40px] md:min-h-0 inline-flex items-center py-1 hover:text-[#F5F5F7] transition-colors cursor-pointer"
                >
                  {dict.nav.categories}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate('pricing')}
                  className="min-h-[40px] md:min-h-0 inline-flex items-center py-1 hover:text-[#F5F5F7] transition-colors cursor-pointer"
                >
                  {dict.nav.pricing}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate('search')}
                  className="min-h-[40px] md:min-h-0 inline-flex items-center py-1 hover:text-[#F5F5F7] transition-colors cursor-pointer"
                >
                  {dict.nav.search}
                </button>
              </li>
            </ul>
          </div>

          {/* Company & Legal Links */}
          <div className="col-span-1 lg:col-span-3 space-y-2.5">
            <h4 className="text-sm font-semibold text-[#F5F5F7]">Company & Legal</h4>
            <ul className="space-y-1 text-sm text-[#A5A6B2]">
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate('about')}
                  className="min-h-[40px] md:min-h-0 inline-flex items-center py-1 hover:text-[#F5F5F7] transition-colors cursor-pointer"
                >
                  {dict.footer.about}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate('contact')}
                  className="min-h-[40px] md:min-h-0 inline-flex items-center py-1 hover:text-[#F5F5F7] transition-colors cursor-pointer"
                >
                  {dict.footer.contact}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate('guidelines')}
                  className="min-h-[40px] md:min-h-0 inline-flex items-center py-1 hover:text-[#F5F5F7] transition-colors cursor-pointer"
                >
                  {dict.footer.guidelines}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate('terms')}
                  className="min-h-[40px] md:min-h-0 inline-flex items-center py-1 hover:text-[#F5F5F7] transition-colors cursor-pointer"
                >
                  {dict.footer.terms}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate('privacy')}
                  className="min-h-[40px] md:min-h-0 inline-flex items-center py-1 hover:text-[#F5F5F7] transition-colors cursor-pointer"
                >
                  {dict.footer.privacy}
                </button>
              </li>
            </ul>
          </div>

          {/* Social Media */}
          <div className="col-span-2 lg:col-span-3 space-y-2.5">
            <h4 className="text-sm font-semibold text-[#F5F5F7]">{dict.footer.social}</h4>
            <ul className="grid grid-cols-2 lg:grid-cols-1 gap-x-4 gap-y-1 text-sm text-[#A5A6B2]">
              {['Instagram', 'YouTube', 'X / Twitter', 'LinkedIn'].map((platform) => (
                <li key={platform}>
                  <button
                    type="button"
                    onClick={() => onOpenSocialNotice(platform)}
                    className="min-h-[40px] md:min-h-0 inline-flex items-center py-1 hover:text-[#F5F5F7] transition-colors cursor-pointer"
                  >
                    {platform}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-white/8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-[#A5A6B2]">
          <p>
            © {new Date().getFullYear()} {dict.footer.rights}
          </p>
          <p className="font-mono tabular-nums text-[#A5A6B2]/80">
            PayPal · QRIS Indonesia · Credit Wallet
          </p>
        </div>
      </div>
    </footer>
  );
};
