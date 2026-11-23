import React from 'react';
import { Clapperboard, Compass, Home, Search, User } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import type { LocaleCode, ViewRoute } from '../../types/vyora';

interface MobileBottomNavProps {
  activeRoute: ViewRoute;
  locale: LocaleCode;
  onNavigate: (route: ViewRoute) => void;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  activeRoute,
  locale,
  onNavigate,
}) => {
  const { firebaseUser } = useAuth();

  const accountTarget: ViewRoute = firebaseUser ? 'viewer-dashboard' : 'login';

  const tabs: {
    id: string;
    label: string;
    route: ViewRoute;
    isActive: boolean;
    icon: React.ReactNode;
  }[] = [
    {
      id: 'home',
      label: locale === 'id' ? 'Beranda' : 'Home',
      route: 'home',
      isActive: activeRoute === 'home',
      icon: <Home className="w-5 h-5" aria-hidden="true" />,
    },
    {
      id: 'explore',
      label: locale === 'id' ? 'Jelajah' : 'Explore',
      route: 'explore',
      isActive:
        activeRoute === 'explore' ||
        activeRoute === 'categories' ||
        activeRoute === 'detail',
      icon: <Compass className="w-5 h-5" aria-hidden="true" />,
    },
    {
      id: 'search',
      label: locale === 'id' ? 'Cari' : 'Search',
      route: 'search',
      isActive: activeRoute === 'search',
      icon: <Search className="w-5 h-5" aria-hidden="true" />,
    },
    {
      id: 'studio',
      label: 'Studio',
      route: 'creator-dashboard',
      isActive: activeRoute === 'creator-dashboard' || activeRoute === 'creator',
      icon: <Clapperboard className="w-5 h-5" aria-hidden="true" />,
    },
    {
      id: 'account',
      label: firebaseUser
        ? locale === 'id'
          ? 'Akun'
          : 'Library'
        : locale === 'id'
        ? 'Masuk'
        : 'Sign In',
      route: accountTarget,
      isActive:
        activeRoute === 'viewer-dashboard' ||
        activeRoute === 'admin-dashboard' ||
        activeRoute === 'login' ||
        activeRoute === 'signup',
      icon: <User className="w-5 h-5" aria-hidden="true" />,
    },
  ];

  return (
    <nav
      aria-label={locale === 'id' ? 'Navigasi cepat mobile' : 'Mobile quick navigation'}
      className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#11121A]/95 backdrop-blur-md border-t border-white/10 pb-safe"
    >
      <div className="grid grid-cols-5 h-14 items-center px-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onNavigate(tab.route)}
            aria-current={tab.isActive ? 'page' : undefined}
            className={`relative min-h-[44px] flex flex-col items-center justify-center gap-0.5 px-1 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A78BFA] rounded-lg ${
              tab.isActive
                ? 'text-[#A78BFA]'
                : 'text-[#A5A6B2] active:text-[#F5F5F7]'
            }`}
          >
            {tab.isActive && (
              <span
                className="absolute top-0 inset-x-4 h-[2px] bg-[#7957ED] rounded-full"
                aria-hidden="true"
              />
            )}
            {tab.icon}
            <span className="text-[10px] font-medium leading-none truncate max-w-full">
              {tab.label}
            </span>
          </button>
        ))}
      </div>
    </nav>
  );
};
