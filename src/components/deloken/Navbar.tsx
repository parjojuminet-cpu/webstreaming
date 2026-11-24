import React, { useState } from 'react';
import { Clapperboard, Globe, Menu, Shield, User, X } from 'lucide-react';
import { getTranslation } from '../../data/translations';
import type { LanguageCode, RoleMode } from '../../types/deloken';
import { DelokenLogo } from './DelokenLogo';

interface NavbarProps {
  activeRole: RoleMode;
  language: LanguageCode;
  userName: string;
  onSelectRole: (role: RoleMode) => void;
  onChangeLanguage: (lang: LanguageCode) => void;
  onGoCatalogHome: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeRole,
  language,
  userName,
  onSelectRole,
  onChangeLanguage,
  onGoCatalogHome,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const t = getTranslation(language);

  const roles: { id: RoleMode; label: string; icon: React.ReactNode }[] = [
    {
      id: 'viewer',
      label: t.roles.viewer,
      icon: <User className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
    },
    {
      id: 'creator',
      label: t.roles.creator,
      icon: <Clapperboard className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
    },
    {
      id: 'admin',
      label: t.roles.admin,
      icon: <Shield className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
    },
  ];

  const handleRoleSwitch = (role: RoleMode) => {
    onSelectRole(role);
    if (role === 'viewer') onGoCatalogHome();
    setMobileMenuOpen(false);
  };

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200">
      <div className="max-w-7xl mx-auto h-14 md:h-16 px-3 sm:px-6 lg:px-8 flex items-center justify-between gap-4 lg:gap-8">
        {/* Zone 1: Brand Mark & Wordmark */}
        <button
          type="button"
          onClick={() => {
            onSelectRole('viewer');
            onGoCatalogHome();
            setMobileMenuOpen(false);
          }}
          className="inline-flex items-center cursor-pointer rounded-md py-1 px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 shrink-0"
          aria-label="DELOKEN Home"
        >
          <DelokenLogo size="md" />
        </button>

        {/* Zone 2: Role Switcher (Desktop) */}
        <nav
          aria-label="DELOKEN Role Switcher"
          className="hidden md:flex items-center gap-1 p-1 rounded-lg bg-slate-100 border border-slate-200"
        >
          {roles.map((r) => {
            const isActive = activeRole === r.id;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => handleRoleSwitch(r.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 ${
                  isActive
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <span className={isActive ? 'text-emerald-600' : 'text-slate-400'}>
                  {r.icon}
                </span>
                <span>{r.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Language Switcher (ID | EN) + Account status */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <div
            className="inline-flex items-center p-0.5 rounded-lg bg-slate-100 border border-slate-200 shrink-0"
            role="group"
            aria-label="Language Switcher"
          >
            <Globe
              className="hidden sm:block w-3.5 h-3.5 text-slate-500 ml-2 mr-1 shrink-0"
              aria-hidden="true"
            />
            <button
              type="button"
              onClick={() => onChangeLanguage('id')}
              aria-pressed={language === 'id'}
              className={`min-h-[34px] px-2.5 rounded-md text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                language === 'id'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              ID
            </button>
            <button
              type="button"
              onClick={() => onChangeLanguage('en')}
              aria-pressed={language === 'en'}
              className={`min-h-[34px] px-2.5 rounded-md text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                language === 'en'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              EN
            </button>
          </div>

          <span className="hidden lg:inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 whitespace-nowrap shrink-0 max-w-[140px] truncate">
            <User className="w-3.5 h-3.5 text-emerald-600 shrink-0" aria-hidden="true" />
            <span className="truncate">{userName}</span>
          </span>

          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-expanded={mobileMenuOpen}
            aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            className="md:hidden inline-flex items-center justify-center w-10 h-10 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100 cursor-pointer shrink-0"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Role Switcher Strip & Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-slate-200 bg-white px-4 py-3 space-y-2 shadow-sm">
          <p className="text-xs font-medium text-slate-500">
            {language === 'id' ? 'Pilih Peran Aktif' : 'Switch Active Role'} ({userName})
          </p>
          <div className="grid grid-cols-1 gap-2">
            {roles.map((r) => {
              const isActive = activeRole === r.id;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => handleRoleSwitch(r.id)}
                  className={`min-h-[44px] w-full px-3.5 py-2 rounded-lg border text-sm font-semibold flex items-center gap-2.5 cursor-pointer transition-colors ${
                    isActive
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                      : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {r.icon}
                  <span>{r.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </header>
  );
};
