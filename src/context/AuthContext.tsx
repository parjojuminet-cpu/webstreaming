import React, { createContext, useContext, useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import {
  BOOTSTRAPPED_ADMIN_EMAIL,
  OperationType,
  auth,
  db,
  googleProvider,
  handleFirestoreError,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type FirebaseUser,
} from '../lib/firebase';
import {
  ensureUserProfile,
  subscribeWallet,
} from '../services/firestoreService';
import type {
  CreatorProfile,
  CurrencyCode,
  LocaleCode,
  UserProfile,
  WalletRecord,
} from '../types/vyora';

interface AuthContextValue {
  firebaseUser: FirebaseUser | null;
  userProfile: UserProfile | null;
  creatorProfile: CreatorProfile | null;
  wallet: WalletRecord | null;
  authReady: boolean;
  isAdmin: boolean;
  isSigningIn: boolean;
  authError: string | null;
  signInWithGoogle: (
    locale: LocaleCode,
    currency: CurrencyCode
  ) => Promise<UserProfile | null>;
  signOutUser: () => Promise<void>;
  clearAuthError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{
  children: React.ReactNode;
  defaultLocale: LocaleCode;
  defaultCurrency: CurrencyCode;
}> = ({ children, defaultLocale, defaultCurrency }) => {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [creatorProfile, setCreatorProfile] = useState<CreatorProfile | null>(null);
  const [wallet, setWallet] = useState<WalletRecord | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const localeRef = React.useRef(defaultLocale);
  const currencyRef = React.useRef(defaultCurrency);
  localeRef.current = defaultLocale;
  currencyRef.current = defaultCurrency;

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (!user) {
        setUserProfile(null);
        setCreatorProfile(null);
        setWallet(null);
        setAuthReady(true);
        return;
      }

      try {
        const profile = await ensureUserProfile(
          user,
          localeRef.current,
          currencyRef.current
        );
        setUserProfile(profile);
      } catch (err) {
        console.error('Failed to ensure user profile:', err);
      } finally {
        setAuthReady(true);
      }
    });

    return () => unsubAuth();
  }, []);

  // Real-time listeners strictly gated on authReady && firebaseUser
  useEffect(() => {
    if (!authReady || !firebaseUser) return;

    const userPath = `users/${firebaseUser.uid}`;
    const unsubUser = onSnapshot(
      doc(db, 'users', firebaseUser.uid),
      (snap) => {
        if (snap.exists()) {
          setUserProfile(snap.data() as UserProfile);
        }
      },
      (error) => handleFirestoreError(error, OperationType.GET, userPath)
    );

    const creatorPath = `creators/${firebaseUser.uid}`;
    const unsubCreator = onSnapshot(
      doc(db, 'creators', firebaseUser.uid),
      (snap) => {
        if (snap.exists()) {
          setCreatorProfile({
            id: snap.id,
            ...(snap.data() as Omit<CreatorProfile, 'id'>),
          });
        } else {
          setCreatorProfile(null);
        }
      },
      (error) => handleFirestoreError(error, OperationType.GET, creatorPath)
    );

    const unsubWallet = subscribeWallet(firebaseUser.uid, setWallet);

    return () => {
      unsubUser();
      unsubCreator();
      unsubWallet();
    };
  }, [authReady, firebaseUser]);

  const formatAuthErrorMessage = (err: unknown, locale: LocaleCode): string => {
    const raw = err instanceof Error ? err.message : String(err);
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code?: unknown }).code || '')
        : '';

    if (code === 'auth/popup-blocked' || raw.includes('popup-blocked')) {
      return locale === 'id'
        ? 'Popup login Google diblokir oleh browser atau iframe. Izinkan popup untuk situs ini atau buka pratinjau aplikasi di tab browser baru lalu coba masuk lagi.'
        : 'Google sign-in popup was blocked by your browser or iframe. Allow popups for this site or open the app in a new browser tab and try again.';
    }
    if (
      code === 'auth/popup-closed-by-user' ||
      code === 'auth/cancelled-popup-request' ||
      raw.includes('popup-closed-by-user')
    ) {
      return locale === 'id'
        ? 'Jendela login Google ditutup sebelum proses masuk selesai. Silakan klik Lanjutkan dengan Google lagi.'
        : 'The Google sign-in window was closed before completing login. Please click Continue with Google again.';
    }
    if (code === 'auth/unauthorized-domain' || raw.includes('unauthorized-domain')) {
      return locale === 'id'
        ? 'Domain pratinjau ini belum masuk daftar Authorized Domains Firebase Authentication. Tambahkan domain saat ini di Firebase Console > Authentication > Settings > Authorized domains.'
        : 'This domain is not yet allowlisted in Firebase Authentication Authorized Domains.';
    }
    if (code === 'auth/network-request-failed' || raw.includes('network-request-failed')) {
      return locale === 'id'
        ? 'Koneksi jaringan ke layanan login gagal. Periksa koneksi internet Anda dan coba lagi.'
        : 'Network connection to Firebase Authentication failed. Please check your internet connection.';
    }
    if (raw.includes('Missing or insufficient permissions') || raw.includes('PERMISSION_DENIED')) {
      return locale === 'id'
        ? 'Login Google berhasil, namun akses database Firestore ditolak aturan keamanan. Pastikan akun Google memiliki email terverifikasi dan aturan Firestore sudah aktif.'
        : 'Google sign-in succeeded, but Firestore security rules denied profile access.';
    }
    return raw || (locale === 'id' ? 'Gagal masuk dengan Google.' : 'Unable to sign in with Google.');
  };

  const signInWithGoogle = async (
    locale: LocaleCode,
    currency: CurrencyCode
  ): Promise<UserProfile | null> => {
    setAuthError(null);
    setIsSigningIn(true);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      const profile = await ensureUserProfile(cred.user, locale, currency);
      setUserProfile(profile);
      return profile;
    } catch (err) {
      setAuthError(formatAuthErrorMessage(err, locale));
      return null;
    } finally {
      setIsSigningIn(false);
    }
  };

  const signOutUser = async (): Promise<void> => {
    await signOut(auth);
    setUserProfile(null);
    setCreatorProfile(null);
    setWallet(null);
  };

  const isAdmin = Boolean(
    firebaseUser &&
      ((firebaseUser.email === BOOTSTRAPPED_ADMIN_EMAIL &&
        firebaseUser.emailVerified) ||
        userProfile?.role === 'admin')
  );

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        userProfile,
        creatorProfile,
        wallet,
        authReady,
        isAdmin,
        isSigningIn,
        authError,
        signInWithGoogle,
        signOutUser,
        clearAuthError: () => setAuthError(null),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
