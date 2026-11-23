import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Clapperboard, Globe, LogOut, Menu, Search, Shield, User, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import type { CurrencyCode, LocaleCode, ViewRoute } from '../../types/vyora';
import { TRANSLATIONS } from '../../i18n/translations';
import { Button } from '../ui/Button';

interface NavbarProps {
  activeRoute: ViewRoute;
  locale: LocaleCode;
  currency: CurrencyCode;
  onChangeLocale: (locale: LocaleCode) => void;
  onChangeCurrency: (currency: CurrencyCode) => void;
  onNavigate: (route: ViewRoute) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeRoute,
  locale,
  currency,
  onChangeLocale,
  onChangeCurrency,
  onNavigate,
}) => {
  const { firebaseUser, userProfile, isAdmin, signOutUser } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const dict = TRANSLATIONS[locale];

  useEffect(() => {
    if (!accountMenuOpen && !mobileMenuOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (
        accountMenuOpen &&
        accountMenuRef.current &&
        !accountMenuRef.current.contains(e.target as Node)
      ) {
        setAccountMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAccountMenuOpen(false);
        setMobileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [accountMenuOpen, mobileMenuOpen]);

  const navItems: { route: ViewRoute; label: string }[] = [
    { route: 'home', label: dict.nav.home },
    { route: 'explore', label: dict.nav.explore },
    { route: 'categories', label: dict.nav.categories },
    { route: 'pricing', label: dict.nav.pricing },
    { route: 'search', label: dict.nav.search },
  ];

  const handleNav = (route: ViewRoute) => {
    onNavigate(route);
    setMobileMenuOpen(false);
    setAccountMenuOpen(false);
  };

  return (
    <header className="sticky top-0 z-40 h-14 md:h-16 bg-[#11121A]/90 backdrop-blur-md border-b border-white/8">
      <div className="max-w-7xl mx-auto h-full px-3.5 sm:px-6 lg:px-8 flex items-center justify-between gap-2 md:gap-4 lg:gap-8">
        {/* Zone 1: Brand Mark & Wordmark */}
        <button
          type="button"
          onClick={() => handleNav('home')}
          className="inline-flex items-center gap-2 text-[#F5F5F7] hover:opacity-90 transition-opacity whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A78BFA] rounded-md px-1 py-1 min-h-[44px] md:min-h-0"
          aria-label="VYORA Home"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
            className="shrink-0"
          >
            <rect width="24" height="24" rx="6" fill="#7957ED" />
            <path
              d="M6.5 7.25L12 17.25L17.5 7.25H14.6L12 12.25L9.4 7.25H6.5Z"
              fill="#F5F5F7"
            />
          </svg>
          <span className="font-display text-lg font-bold tracking-tight text-[#F5F5F7]">
            VYORA
          </span>
        </button>

        {/* Zone 2: Primary Navigation Links (Desktop) */}
        <nav
          aria-label="Primary navigation"
          className="hidden md:flex items-center gap-4 lg:gap-7"
        >
          {navItems.map((item) => {
            const isActive = activeRoute === item.route;
            return (
              <button
                key={item.route}
                type="button"
                onClick={() => handleNav(item.route)}
                aria-current={isActive ? 'page' : undefined}
                className={`relative py-2 text-sm font-medium whitespace-nowrap shrink-0 transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A78BFA] rounded-sm ${
                  isActive
                    ? 'text-[#F5F5F7]'
                    : 'text-[#A5A6B2] hover:text-[#F5F5F7]'
                }`}
              >
                <span className="inline-flex items-center gap-1.5">
                  {item.route === 'search' && (
                    <Search className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                  <span>{item.label}</span>
                </span>
                {isActive && (
                  <span
                    className="absolute inset-x-0 -bottom-[1px] h-[2px] bg-[#7957ED] rounded-full"
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Top Language Switcher + Auth / Workspace Menu */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
          {/* Top Language Switcher (Always visible on mobile & desktop) */}
          <div
            className="inline-flex items-center p-0.5 rounded-lg bg-[#1B1C27] border border-white/10 shrink-0"
            role="group"
            aria-label={dict.footer.language}
          >
            <Globe
              className="hidden sm:block w-3.5 h-3.5 text-[#A78BFA] ml-2 mr-1 shrink-0"
              aria-hidden="true"
            />
            <button
              type="button"
              onClick={() => onChangeLocale('id')}
              aria-pressed={locale === 'id'}
              aria-label="Bahasa Indonesia"
              className={`min-h-[36px] md:min-h-[32px] px-2 sm:px-2.5 rounded-md text-[11px] sm:text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                locale === 'id'
                  ? 'bg-[#7957ED] text-[#F5F5F7]'
                  : 'text-[#A5A6B2] hover:text-[#F5F5F7]'
              }`}
            >
              ID
            </button>
            <button
              type="button"
              onClick={() => onChangeLocale('en')}
              aria-pressed={locale === 'en'}
              aria-label="English"
              className={`min-h-[36px] md:min-h-[32px] px-2 sm:px-2.5 rounded-md text-[11px] sm:text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                locale === 'en'
                  ? 'bg-[#7957ED] text-[#F5F5F7]'
                  : 'text-[#A5A6B2] hover:text-[#F5F5F7]'
              }`}
            >
              EN
            </button>
          </div>

          {!firebaseUser ? (
            <div className="hidden md:flex items-center gap-2 lg:gap-3">
              <button
                type="button"
                onClick={() => handleNav('login')}
                className={`min-h-[40px] px-3 py-2 text-sm font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A78BFA] ${
                  activeRoute === 'login'
                    ? 'text-[#F5F5F7]'
                    : 'text-[#A5A6B2] hover:text-[#F5F5F7]'
                }`}
              >
                {dict.nav.login}
              </button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => handleNav('signup')}
              >
                {dict.nav.signup}
              </Button>
            </div>
          ) : (
            <div ref={accountMenuRef} className="hidden md:block relative">
              <button
                type="button"
                onClick={() => setAccountMenuOpen((prev) => !prev)}
                aria-expanded={accountMenuOpen}
                aria-haspopup="menu"
                className="min-h-[40px] inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-[#1B1C27] hover:bg-[#242636] border border-white/10 text-xs font-semibold text-[#F5F5F7] whitespace-nowrap shrink-0 cursor-pointer"
              >
                <User className="w-3.5 h-3.5 text-[#A78BFA]" aria-hidden="true" />
                <span className="max-w-[130px] truncate">
                  {userProfile?.displayName || firebaseUser.displayName || 'Account'}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-[#A5A6B2]" aria-hidden="true" />
              </button>

              {accountMenuOpen && (
                <div className="absolute right-0 mt-2 w-56 rounded-xl bg-[#1B1C27] border border-white/10 shadow-2xl py-1.5 z-50">
                  <button
                    type="button"
                    onClick={() => handleNav('viewer-dashboard')}
                    className="w-full px-4 py-2.5 text-left text-xs font-medium text-[#F5F5F7] hover:bg-white/5 flex items-center gap-2.5 cursor-pointer"
                  >
                    <User className="w-3.5 h-3.5 text-[#A78BFA]" aria-hidden="true" />
                    <span>
                      {locale === 'id' ? 'Dasbor Penonton' : 'Viewer Dashboard'}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleNav('creator-dashboard')}
                    className="w-full px-4 py-2.5 text-left text-xs font-medium text-[#F5F5F7] hover:bg-white/5 flex items-center gap-2.5 cursor-pointer"
                  >
                    <Clapperboard className="w-3.5 h-3.5 text-[#A78BFA]" aria-hidden="true" />
                    <span>
                      {locale === 'id' ? 'Studio Kreator' : 'Creator Studio'}
                    </span>
                  </button>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => handleNav('admin-dashboard')}
                      className="w-full px-4 py-2.5 text-left text-xs font-medium text-[#F5F5F7] hover:bg-white/5 flex items-center gap-2.5 cursor-pointer"
                    >
                      <Shield className="w-3.5 h-3.5 text-[#A78BFA]" aria-hidden="true" />
                      <span>
                        {locale === 'id' ? 'Konsol Admin' : 'Admin Console'}
                      </span>
                    </button>
                  )}
                  <div className="my-1 border-t border-white/8" />
                  <button
                    type="button"
                    onClick={() => {
                      setAccountMenuOpen(false);
                      void signOutUser();
                      onNavigate('home');
                    }}
                    className="w-full px-4 py-2.5 text-left text-xs font-medium text-[#A5A6B2] hover:text-[#F5F5F7] hover:bg-white/5 flex items-center gap-2.5 cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{locale === 'id' ? 'Keluar' : 'Sign Out'}</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {!firebaseUser ? (
            <button
              type="button"
              onClick={() => handleNav('login')}
              className="md:hidden min-h-[40px] px-3 py-1.5 rounded-lg bg-[#7957ED] hover:bg-[#6743DF] text-xs font-semibold text-[#F5F5F7] whitespace-nowrap cursor-pointer"
            >
              {dict.nav.login}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => handleNav('viewer-dashboard')}
              aria-label={locale === 'id' ? 'Dasbor Akun' : 'Account Dashboard'}
              className="md:hidden min-h-[40px] max-w-[120px] px-2.5 py-1.5 rounded-lg bg-[#1B1C27] border border-white/10 text-xs font-medium text-[#F5F5F7] inline-flex items-center gap-1.5 cursor-pointer"
            >
              <User className="w-3.5 h-3.5 text-[#A78BFA] shrink-0" aria-hidden="true" />
              <span className="truncate">
                {userProfile?.displayName?.split(' ')[0] ||
                  firebaseUser.displayName?.split(' ')[0] ||
                  (locale === 'id' ? 'Akun' : 'Account')}
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-expanded={mobileMenuOpen}
            aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
            className="md:hidden inline-flex items-center justify-center w-11 h-11 rounded-lg text-[#F5F5F7] hover:bg-white/5 transition-colors cursor-pointer"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer & Backdrop */}
      {mobileMenuOpen && (
        <>
          <div
            className="md:hidden fixed inset-x-0 top-14 bottom-0 bg-black/60 backdrop-blur-sm z-40"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <div className="md:hidden fixed inset-x-0 top-14 max-h-[calc(100dvh-7.5rem)] overflow-y-auto bg-[#11121A] border-b border-white/10 px-4 py-4 space-y-4 shadow-2xl z-50">
          <nav aria-label="Mobile navigation" className="grid grid-cols-2 gap-2">
            {(
              [
                { route: 'categories' as ViewRoute, label: dict.nav.categories },
                { route: 'pricing' as ViewRoute, label: dict.nav.pricing },
                { route: 'guidelines' as ViewRoute, label: dict.footer.guidelines },
                { route: 'about' as ViewRoute, label: dict.footer.about },
              ] as const
            ).map((item) => {
              const isActive = activeRoute === item.route;
              return (
                <button
                  key={item.route}
                  type="button"
                  onClick={() => handleNav(item.route)}
                  className={`min-h-[44px] w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer flex items-center justify-between ${
                    isActive
                      ? 'bg-[#7957ED]/20 text-[#F5F5F7] border border-[#7957ED]/50'
                      : 'bg-[#1B1C27] text-[#A5A6B2] hover:text-[#F5F5F7] border border-white/8'
                  }`}
                >
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Quick Language & Currency Toggle inside Mobile Drawer */}
          <div className="pt-3 border-t border-white/10 flex flex-wrap items-center justify-between gap-2">
            <div
              className="inline-flex items-center gap-1 p-1 rounded-xl bg-[#1B1C27] border border-white/8"
              role="group"
              aria-label={dict.footer.language}
            >
              <Globe className="w-3.5 h-3.5 text-[#A5A6B2] ml-2 mr-1" aria-hidden="true" />
              <button
                type="button"
                onClick={() => onChangeLocale('en')}
                className={`min-h-[36px] px-3 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
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
                className={`min-h-[36px] px-3 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                  locale === 'id'
                    ? 'bg-[#7957ED] text-[#F5F5F7]'
                    : 'text-[#A5A6B2] hover:text-[#F5F5F7]'
                }`}
              >
                ID
              </button>
            </div>

            <div
              className="inline-flex items-center gap-1 p-1 rounded-xl bg-[#1B1C27] border border-white/8"
              role="group"
              aria-label={dict.footer.currency}
            >
              <button
                type="button"
                onClick={() => onChangeCurrency('USD')}
                className={`min-h-[36px] px-3 py-1 rounded-lg text-xs font-mono font-medium transition-colors cursor-pointer ${
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
                className={`min-h-[36px] px-3 py-1 rounded-lg text-xs font-mono font-medium transition-colors cursor-pointer ${
                  currency === 'IDR'
                    ? 'bg-[#7957ED] text-[#F5F5F7]'
                    : 'text-[#A5A6B2] hover:text-[#F5F5F7]'
                }`}
              >
                IDR
              </button>
            </div>
          </div>

          {!firebaseUser ? (
            <div className="pt-3 border-t border-white/10 space-y-2.5">
              <div className="flex items-center gap-3">
                <Button
                  variant="secondary"
                  size="sm"
                  className="flex-1"
                  onClick={() => handleNav('login')}
                >
                  {dict.nav.login}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  className="flex-1"
                  onClick={() => handleNav('signup')}
                >
                  {dict.nav.signup}
                </Button>
              </div>
              <button
                type="button"
                onClick={() => handleNav('creator-dashboard')}
                className="min-h-[44px] w-full text-left px-3.5 py-2.5 rounded-xl text-sm font-medium text-[#A78BFA] bg-[#1B1C27] flex items-center gap-2.5 cursor-pointer"
              >
                <Clapperboard className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{locale === 'id' ? 'Masuk Studio Kreator' : 'Open Creator Studio'}</span>
              </button>
            </div>
          ) : (
            <div className="pt-3 border-t border-white/10 space-y-2">
              <button
                type="button"
                onClick={() => handleNav('viewer-dashboard')}
                className="min-h-[44px] w-full text-left px-3.5 py-2.5 rounded-xl text-sm font-medium text-[#F5F5F7] bg-[#1B1C27] flex items-center gap-2.5 cursor-pointer"
              >
                <User className="w-4 h-4 text-[#A78BFA] shrink-0" aria-hidden="true" />
                <span>{locale === 'id' ? 'Dasbor Penonton' : 'Viewer Dashboard'}</span>
              </button>
              <button
                type="button"
                onClick={() => handleNav('creator-dashboard')}
                className="min-h-[44px] w-full text-left px-3.5 py-2.5 rounded-xl text-sm font-medium text-[#F5F5F7] bg-[#1B1C27] flex items-center gap-2.5 cursor-pointer"
              >
                <Clapperboard className="w-4 h-4 text-[#A78BFA] shrink-0" aria-hidden="true" />
                <span>{locale === 'id' ? 'Studio Kreator' : 'Creator Studio'}</span>
              </button>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => handleNav('admin-dashboard')}
                  className="min-h-[44px] w-full text-left px-3.5 py-2.5 rounded-xl text-sm font-medium text-[#A78BFA] bg-[#1B1C27] flex items-center gap-2.5 cursor-pointer"
                >
                  <Shield className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{locale === 'id' ? 'Konsol Admin' : 'Admin Console'}</span>
                </button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => {
                  setMobileMenuOpen(false);
                  void signOutUser();
                  onNavigate('home');
                }}
              >
                {locale === 'id' ? 'Keluar' : 'Sign Out'}
              </Button>
            </div>
          )}
        </div>
        </>
      )}
    </header>
  );
};
