import React, { useState } from 'react';
import { CheckCircle2, Clapperboard, LogOut, Shield, User } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { CurrencyCode, LocaleCode, ViewRoute } from '../types/vyora';
import { Button } from '../components/ui/Button';

interface AuthPageProps {
  mode: 'login' | 'signup';
  locale: LocaleCode;
  currency: CurrencyCode;
  postLoginRoute?: ViewRoute;
  onSwitchMode: (route: 'login' | 'signup') => void;
  onNavigate: (route: ViewRoute) => void;
}

export const AuthPage: React.FC<AuthPageProps> = ({
  mode,
  locale,
  currency,
  postLoginRoute = 'viewer-dashboard',
  onSwitchMode,
  onNavigate,
}) => {
  const {
    firebaseUser,
    userProfile,
    isAdmin,
    isSigningIn,
    authError,
    signInWithGoogle,
    signOutUser,
    clearAuthError,
  } = useAuth();

  const [intendedRole, setIntendedRole] = useState<'viewer' | 'creator'>(
    postLoginRoute === 'creator-dashboard' ? 'creator' : 'viewer'
  );
  const isSignup = mode === 'signup';

  const handleGoogleAuth = async () => {
    clearAuthError();
    const profile = await signInWithGoogle(locale, currency);
    if (profile) {
      if ((isSignup && intendedRole === 'creator') || postLoginRoute === 'creator-dashboard') {
        onNavigate('creator-dashboard');
      } else {
        onNavigate('viewer-dashboard');
      }
    }
  };

  if (firebaseUser) {
    return (
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-5 sm:py-10">
        <div className="max-w-md mx-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-7 space-y-4 sm:space-y-5 text-center shadow-xs">
          <div className="w-12 h-12 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/70 text-emerald-700 dark:text-emerald-400 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-6 h-6" aria-hidden="true" />
          </div>

          <div className="space-y-1.5">
            <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
              {locale === 'id' ? 'Anda Sudah Masuk' : 'Signed In to DELOKEN'}
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {userProfile?.displayName || firebaseUser.displayName} ·{' '}
              {firebaseUser.email}
            </p>
          </div>

          <div className="space-y-2.5 pt-2">
            <Button
              variant="primary"
              size="md"
              className="w-full"
              leftIcon={<User className="w-4 h-4" />}
              onClick={() => onNavigate('viewer-dashboard')}
            >
              {locale === 'id' ? 'Buka Dasbor Penonton' : 'Open Viewer Dashboard'}
            </Button>

            <Button
              variant="secondary"
              size="md"
              className="w-full"
              leftIcon={<Clapperboard className="w-4 h-4" />}
              onClick={() => onNavigate('creator-dashboard')}
            >
              {locale === 'id' ? 'Buka Studio Kreator' : 'Open Creator Studio'}
            </Button>

            {isAdmin && (
              <Button
                variant="outline"
                size="md"
                className="w-full"
                leftIcon={<Shield className="w-4 h-4" />}
                onClick={() => onNavigate('admin-dashboard')}
              >
                {locale === 'id' ? 'Buka Konsol Admin' : 'Open Admin Console'}
              </Button>
            )}

            <Button
              variant="ghost"
              size="sm"
              className="w-full mt-2"
              leftIcon={<LogOut className="w-4 h-4" />}
              onClick={() => void signOutUser()}
            >
              {locale === 'id' ? 'Keluar' : 'Sign Out'}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-5 sm:py-10">
      <div className="max-w-md mx-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-7 space-y-4 sm:space-y-5 shadow-xs">
        <div className="space-y-2 text-center">
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">
            {isSignup
              ? locale === 'id'
                ? 'Buat Akun DELOKEN'
                : 'Create Your DELOKEN Account'
              : locale === 'id'
              ? 'Masuk ke DELOKEN'
              : 'Sign In to DELOKEN'}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {isSignup
              ? locale === 'id'
                ? 'Masuk dengan Google untuk langsung membuat profil Penonton atau mengajukan Studio Kreator.'
                : 'Continue with Google to initialize your Viewer account or set up Creator Studio.'
              : locale === 'id'
              ? 'Akses perpustakaan, dompet kredit, dan dasbor akun Anda melalui Firebase Authentication.'
              : 'Access your Library, Credit Wallet, and role dashboard via Firebase Authentication.'}
          </p>
        </div>

        {authError && (
          <div
            role="alert"
            className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800/70 text-xs text-rose-700 dark:text-rose-300 leading-relaxed"
          >
            {authError}
          </div>
        )}

        {isSignup && (
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-2">
              {locale === 'id' ? 'Tujuan Utama Anda' : 'Start With'}
            </label>
            <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setIntendedRole('viewer')}
                className={`min-h-[44px] rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  intendedRole === 'viewer'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {locale === 'id' ? 'Penonton' : 'Viewer'}
              </button>
              <button
                type="button"
                onClick={() => setIntendedRole('creator')}
                className={`min-h-[44px] rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  intendedRole === 'creator'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {locale === 'id' ? 'Kreator' : 'Creator Studio'}
              </button>
            </div>
          </div>
        )}

        <Button
          type="button"
          variant="primary"
          size="lg"
          className="w-full"
          isLoading={isSigningIn}
          onClick={() => void handleGoogleAuth()}
        >
          <span className="inline-flex items-center gap-2.5">
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="currentColor"
                d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.27 5 16.25 5 12c0-4.1 3.2-7.27 7.2-7.27c3.09 0 4.9 1.97 4.9 1.97L19 4.72S16.56 2 12.1 2C6.42 2 2.03 6.8 2.03 12c0 5.05 4.13 10 10.22 10c5.35 0 9.25-3.67 9.25-9.09c0-1.15-.15-1.81-.15-1.81Z"
              />
            </svg>
            <span>
              {locale === 'id' ? 'Lanjutkan dengan Google' : 'Continue with Google'}
            </span>
          </span>
        </Button>

        <div className="pt-4 border-t border-slate-200 dark:border-slate-800 text-center text-xs text-slate-600 dark:text-slate-300 space-y-2">
          <p>
            {isSignup
              ? locale === 'id'
                ? 'Sudah punya akun?'
                : 'Already have an account?'
              : locale === 'id'
              ? 'Belum memiliki akun DELOKEN?'
              : 'New to DELOKEN?'}{' '}
            <button
              type="button"
              onClick={() => {
                clearAuthError();
                onSwitchMode(isSignup ? 'login' : 'signup');
              }}
              className="text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 font-semibold cursor-pointer"
            >
              {isSignup
                ? locale === 'id'
                  ? 'Masuk'
                  : 'Login'
                : locale === 'id'
                ? 'Daftar'
                : 'Sign Up'}
            </button>
          </p>

          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            {locale === 'id' ? 'Dengan melanjutkan, Anda menyetujui ' : 'By continuing, you agree to '}
            <button
              type="button"
              onClick={() => onNavigate('terms')}
              className="underline hover:text-slate-900 dark:hover:text-white cursor-pointer"
            >
              {locale === 'id' ? 'Syarat & Ketentuan' : 'Terms'}
            </button>{' '}
            &{' '}
            <button
              type="button"
              onClick={() => onNavigate('privacy')}
              className="underline hover:text-slate-900 dark:hover:text-white cursor-pointer"
            >
              {locale === 'id' ? 'Privasi' : 'Privacy'}
            </button>
            .
          </p>
        </div>
      </div>
    </div>
  );
};
