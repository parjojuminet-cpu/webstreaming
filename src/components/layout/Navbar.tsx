import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Clapperboard, Globe, LogOut, Menu, Moon, Search, Shield, Sun, User, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import type { LocaleCode, ViewRoute } from '../../types/vyora';
import { TRANSLATIONS } from '../../i18n/translations';
import { DelokenLogo } from '../deloken/DelokenLogo';
import { Button } from '../ui/Button';

interface NavbarProps {
  activeRoute: ViewRoute;
  locale: LocaleCode;
  theme: 'light' | 'dark';
  onChangeLocale: (locale: LocaleCode) => void;
  onToggleTheme: () => void;
  onNavigate: (route: ViewRoute) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeRoute,
  locale,
  theme,
  onChangeLocale,
  onToggleTheme,
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
    { route: 'pricing', label: dict.nav.pricing },
    { route: 'guide', label: dict.nav.guide },
    { route: 'search', label: dict.nav.search },
  ];

  const isGuideSection =
    activeRoute === 'guide' ||
    activeRoute === 'about' ||
    activeRoute === 'contact' ||
    activeRoute === 'terms' ||
    activeRoute === 'privacy' ||
    activeRoute === 'guidelines';

  const handleNav = (route: ViewRoute) => {
    onNavigate(route);
    setMobileMenuOpen(false);
    setAccountMenuOpen(false);
  };

  const themeToggleLabel =
    theme === 'dark'
      ? locale === 'id'
        ? 'Aktifkan Mode Terang'
        : 'Switch to Light Mode'
      : locale === 'id'
      ? 'Aktifkan Mode Gelap'
      : 'Switch to Dark Mode';

  return (
    <header className="sticky top-0 z-40 h-14 md:h-16 bg-white/95 dark:bg-slate-950/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 transition-colors">
      <div className="max-w-7xl mx-auto h-full px-3.5 sm:px-6 lg:px-8 flex items-center justify-between gap-2 md:gap-4 lg:gap-8">
        {/* Zone 1: DELOKEN Brand Mark & Wordmark */}
        <button
          type="button"
          onClick={() => handleNav('home')}
          className="inline-flex items-center hover:opacity-90 transition-opacity whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 rounded-md px-1 py-1 min-h-[44px] md:min-h-0"
          aria-label="DELOKEN Home"
        >
          <DelokenLogo size="sm" />
        </button>

        {/* Zone 2: Primary Navigation Links (Desktop) */}
        <nav
          aria-label="Primary navigation"
          className="hidden md:flex items-center gap-4 lg:gap-7"
        >
          {navItems.map((item) => {
            const isActive =
              item.route === 'guide'
                ? isGuideSection
                : item.route === 'explore'
                ? activeRoute === 'explore' ||
                  activeRoute === 'categories' ||
                  activeRoute === 'detail'
                : activeRoute === item.route;
            return (
              <button
                key={item.route}
                type="button"
                onClick={() => handleNav(item.route)}
                aria-current={isActive ? 'page' : undefined}
                className={`relative py-2 text-sm font-medium whitespace-nowrap shrink-0 transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 rounded-sm ${
                  isActive
                    ? 'text-slate-900 dark:text-white font-semibold'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
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
                    className="absolute inset-x-0 -bottom-[1px] h-[2px] bg-emerald-600 dark:bg-emerald-500 rounded-full"
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Theme Toggle + Language Switcher + Auth / Workspace Menu */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
          {/* Theme Toggle */}
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={themeToggleLabel}
            aria-pressed={theme === 'dark'}
            title={themeToggleLabel}
            className="inline-flex items-center justify-center w-9 h-9 md:w-9 md:h-9 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-amber-300 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
          >
            {theme === 'dark' ? (
              <Sun className="w-4 h-4" aria-hidden="true" />
            ) : (
              <Moon className="w-4 h-4 text-slate-700" aria-hidden="true" />
            )}
          </button>

          {/* Language Switcher */}
          <div
            className="inline-flex items-center p-0.5 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shrink-0"
            role="group"
            aria-label={dict.footer.language}
          >
            <Globe
              className="hidden sm:block w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400 ml-2 mr-1 shrink-0"
              aria-hidden="true"
            />
            <button
              type="button"
              onClick={() => onChangeLocale('id')}
              aria-pressed={locale === 'id'}
              aria-label="Bahasa Indonesia"
              className={`min-h-[36px] md:min-h-[32px] px-2 sm:px-2.5 rounded-md text-[11px] sm:text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                locale === 'id'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
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
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
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
                className={`min-h-[40px] px-3 py-2 text-sm font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 ${
                  activeRoute === 'login'
                    ? 'text-slate-900 dark:text-white font-semibold'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
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
                className="min-h-[40px] inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <User className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                <span className="max-w-[130px] truncate">
                  {userProfile?.displayName || firebaseUser.displayName || 'Account'}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" aria-hidden="true" />
              </button>

              {accountMenuOpen && (
                <div className="absolute right-0 mt-2 w-56 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl py-1.5 z-50">
                  <button
                    type="button"
                    onClick={() => handleNav('viewer-dashboard')}
                    className="w-full px-4 py-2.5 text-left text-xs font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-2.5 cursor-pointer"
                  >
                    <User className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                    <span>
                      {locale === 'id' ? 'Dasbor Penonton' : 'Viewer Dashboard'}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleNav('creator-dashboard')}
                    className="w-full px-4 py-2.5 text-left text-xs font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-2.5 cursor-pointer"
                  >
                    <Clapperboard className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                    <span>
                      {locale === 'id' ? 'Studio Kreator' : 'Creator Studio'}
                    </span>
                  </button>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => handleNav('admin-dashboard')}
                      className="w-full px-4 py-2.5 text-left text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 flex items-center gap-2.5 cursor-pointer"
                    >
                      <Shield className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                      <span>
                        {locale === 'id' ? 'Konsol Admin' : 'Admin Console'}
                      </span>
                    </button>
                  )}
                  <div className="my-1 border-t border-slate-200 dark:border-slate-800" />
                  <button
                    type="button"
                    onClick={() => {
                      setAccountMenuOpen(false);
                      void signOutUser();
                      onNavigate('home');
                    }}
                    className="w-full px-4 py-2.5 text-left text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-2.5 cursor-pointer"
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
              className="md:hidden min-h-[40px] px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-xs font-semibold text-white whitespace-nowrap cursor-pointer"
            >
              {dict.nav.login}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => handleNav('viewer-dashboard')}
              aria-label={locale === 'id' ? 'Dasbor Akun' : 'Account Dashboard'}
              className="md:hidden min-h-[40px] max-w-[120px] px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-900 dark:text-slate-100 inline-flex items-center gap-1.5 cursor-pointer"
            >
              <User className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400 shrink-0" aria-hidden="true" />
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
            className="md:hidden inline-flex items-center justify-center w-11 h-11 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer & Backdrop */}
      {mobileMenuOpen && (
        <>
          <div
            className="md:hidden fixed inset-x-0 top-14 bottom-0 bg-slate-900/40 dark:bg-slate-950/70 backdrop-blur-xs z-40"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <div className="md:hidden fixed inset-x-0 top-14 max-h-[calc(100dvh-7.5rem)] overflow-y-auto bg-white dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 px-4 py-4 space-y-4 shadow-xl z-50">
            <nav aria-label="Mobile navigation" className="grid grid-cols-2 gap-2">
              {(
                [
                  { route: 'guide' as ViewRoute, label: dict.nav.guide },
                  { route: 'categories' as ViewRoute, label: dict.nav.categories },
                  { route: 'pricing' as ViewRoute, label: dict.nav.pricing },
                  { route: 'about' as ViewRoute, label: dict.footer.about },
                ] as const
              ).map((item) => {
                const isActive =
                  item.route === 'guide'
                    ? activeRoute === 'guide'
                    : activeRoute === item.route;
                return (
                  <button
                    key={item.route}
                    type="button"
                    onClick={() => handleNav(item.route)}
                    className={`min-h-[44px] w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer flex items-center justify-between ${
                      isActive
                        ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/70'
                        : 'bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-slate-800'
                    }`}
                  >
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </nav>

            {/* Theme Toggle inside Mobile Drawer */}
            <div className="pt-3 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={onToggleTheme}
                className="min-h-[44px] w-full px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-100 flex items-center justify-between cursor-pointer"
              >
                <span className="inline-flex items-center gap-2">
                  {theme === 'dark' ? (
                    <Sun className="w-4 h-4 text-amber-300" aria-hidden="true" />
                  ) : (
                    <Moon className="w-4 h-4 text-slate-700" aria-hidden="true" />
                  )}
                  <span>
                    {theme === 'dark'
                      ? locale === 'id'
                        ? 'Mode Gelap Aktif'
                        : 'Dark Mode Active'
                      : locale === 'id'
                      ? 'Mode Terang Aktif'
                      : 'Light Mode Active'}
                  </span>
                </span>
                <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                  {locale === 'id' ? 'Ganti' : 'Switch'}
                </span>
              </button>
            </div>

            {!firebaseUser ? (
              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
                <div className="flex items-center gap-3">
                  <Button
                    variant="outline"
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
                  className="min-h-[44px] w-full text-left px-3.5 py-2.5 rounded-xl text-sm font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/70 flex items-center gap-2.5 cursor-pointer"
                >
                  <Clapperboard className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{locale === 'id' ? 'Masuk Studio Kreator' : 'Open Creator Studio'}</span>
                </button>
              </div>
            ) : (
              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
                <button
                  type="button"
                  onClick={() => handleNav('viewer-dashboard')}
                  className="min-h-[44px] w-full text-left px-3.5 py-2.5 rounded-xl text-sm font-medium text-slate-900 dark:text-slate-100 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center gap-2.5 cursor-pointer"
                >
                  <User className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" aria-hidden="true" />
                  <span>{locale === 'id' ? 'Dasbor Penonton' : 'Viewer Dashboard'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleNav('creator-dashboard')}
                  className="min-h-[44px] w-full text-left px-3.5 py-2.5 rounded-xl text-sm font-medium text-slate-900 dark:text-slate-100 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center gap-2.5 cursor-pointer"
                >
                  <Clapperboard className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" aria-hidden="true" />
                  <span>{locale === 'id' ? 'Studio Kreator' : 'Creator Studio'}</span>
                </button>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => handleNav('admin-dashboard')}
                    className="min-h-[44px] w-full text-left px-3.5 py-2.5 rounded-xl text-sm font-medium text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/70 flex items-center gap-2.5 cursor-pointer"
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
