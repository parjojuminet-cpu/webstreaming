import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clapperboard,
  Clock,
  Film,
  History,
  Play,
  Settings,
  Shield,
  User,
  Wallet,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  subscribeEntitlements,
  subscribePurchases,
  subscribeWalletTransactions,
  updateUserPreferences,
} from '../services/firestoreService';
import {
  fetchMyServerEntitlements,
  type ServerEntitlementItem,
} from '../services/streamService';
import {
  fetchMyWalletSummary,
  type WalletOverviewResponse,
} from '../services/paymentService';
import type {
  ContentItem,
  CurrencyCode,
  EntitlementRecord,
  LocaleCode,
  PurchaseRecord,
  ViewRoute,
  WalletTransactionRecord,
} from '../types/vyora';
import { formatLocalizedDate, formatPrice } from '../i18n/translations';
import { Button } from '../components/ui/Button';
import {
  DashboardSkeleton,
  ListRowSkeleton,
} from '../components/ui/Skeleton';
import { EmptyState, ErrorState } from '../components/ui/StateViews';
import { MediaImage } from '../components/ui/MediaImage';

interface ViewerDashboardPageProps {
  catalog: ContentItem[];
  locale: LocaleCode;
  currency: CurrencyCode;
  entitlementRefreshKey?: number;
  onChangeLocale: (locale: LocaleCode) => void;
  onChangeCurrency: (currency: CurrencyCode) => void;
  onNavigate: (route: ViewRoute) => void;
  onWatchContent: (item: ContentItem) => void;
}

function formatResumeClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

type ViewerTab = 'overview' | 'library' | 'wallet' | 'purchases' | 'profile';

export const ViewerDashboardPage: React.FC<ViewerDashboardPageProps> = ({
  catalog,
  locale,
  currency,
  entitlementRefreshKey = 0,
  onChangeLocale,
  onChangeCurrency,
  onNavigate,
  onWatchContent,
}) => {
  const { firebaseUser, userProfile, creatorProfile, wallet, isAdmin, authReady } = useAuth();
  const [activeTab, setActiveTab] = useState<ViewerTab>('overview');
  const [entitlements, setEntitlements] = useState<EntitlementRecord[]>([]);
  const [serverEntitlements, setServerEntitlements] = useState<ServerEntitlementItem[]>([]);
  const [purchases, setPurchases] = useState<PurchaseRecord[]>([]);
  const [transactions, setTransactions] = useState<WalletTransactionRecord[]>([]);
  const [serverWalletSummary, setServerWalletSummary] =
    useState<WalletOverviewResponse | null>(null);
  const [loadingServerData, setLoadingServerData] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  const [displayName, setDisplayName] = useState(userProfile?.displayName ?? '');
  const [prefLocale, setPrefLocale] = useState<LocaleCode>(
    userProfile?.preferredLocale ?? locale
  );
  const [prefCurrency, setPrefCurrency] = useState<CurrencyCode>(
    userProfile?.preferredCurrency ?? currency
  );
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileFeedback, setProfileFeedback] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  useEffect(() => {
    if (userProfile) {
      setDisplayName(userProfile.displayName);
      setPrefLocale(userProfile.preferredLocale);
      setPrefCurrency(userProfile.preferredCurrency);
    }
  }, [userProfile]);

  useEffect(() => {
    if (!authReady || !firebaseUser) return;
    const unsubEnt = subscribeEntitlements(firebaseUser.uid, setEntitlements);
    const unsubPur = subscribePurchases(firebaseUser.uid, setPurchases);
    const unsubTx = subscribeWalletTransactions(firebaseUser.uid, setTransactions);
    return () => {
      unsubEnt();
      unsubPur();
      unsubTx();
    };
  }, [authReady, firebaseUser]);

  useEffect(() => {
    if (!authReady || !firebaseUser) {
      setServerEntitlements([]);
      setServerWalletSummary(null);
      setLoadingServerData(false);
      return;
    }
    let cancelled = false;
    setLoadingServerData(true);
    setServerError(null);
    void Promise.all([fetchMyServerEntitlements(), fetchMyWalletSummary()])
      .then(([items, summary]) => {
        if (!cancelled) {
          setServerEntitlements(items);
          setServerWalletSummary(summary);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setServerError(
            err instanceof Error ? err.message : 'Unable to sync wallet and library records.'
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingServerData(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authReady, firebaseUser, entitlementRefreshKey, retryTick]);

  const effectiveWallet = serverWalletSummary?.wallet ?? wallet;

  const mergedTransactions = useMemo(() => {
    const map = new Map<string, WalletTransactionRecord>();
    for (const tx of transactions) map.set(tx.id, tx);
    for (const tx of serverWalletSummary?.transactions ?? []) map.set(tx.id, tx);
    return Array.from(map.values()).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );
  }, [transactions, serverWalletSummary]);

  const mergedPurchases = useMemo(() => {
    const map = new Map<string, PurchaseRecord>();
    for (const p of purchases) map.set(p.id, p);
    for (const p of serverWalletSummary?.purchases ?? []) map.set(p.id, p);
    return Array.from(map.values()).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );
  }, [purchases, serverWalletSummary]);

  const mergedEntitlements = useMemo(() => {
    const map = new Map<string, ServerEntitlementItem>();
    for (const ent of entitlements) {
      const expiresMs = Date.parse(ent.expiresAt);
      const remainingDays = Number.isFinite(expiresMs)
        ? Math.max(0, Math.ceil((expiresMs - Date.now()) / (24 * 60 * 60 * 1000)))
        : 30;
      map.set(ent.videoId, { ...ent, remainingDays });
    }
    for (const srv of serverEntitlements) {
      map.set(srv.videoId, srv);
    }
    return Array.from(map.values());
  }, [entitlements, serverEntitlements]);

  if (!authReady) {
    return <DashboardSkeleton />;
  }

  if (!firebaseUser) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <EmptyState
          title={locale === 'id' ? 'Masuk Diperlukan' : 'Sign In Required'}
          description={
            locale === 'id'
              ? 'Masuk ke akun DELOKEN Anda untuk mengakses Perpustakaan, Dompet Kredit, dan Riwayat Pembelian.'
              : 'Sign in to access your DELOKEN Library, Credit Wallet, Purchase History, and Profile Settings.'
          }
          actionLabel={locale === 'id' ? 'Masuk ke DELOKEN' : 'Sign In'}
          onAction={() => onNavigate('login')}
        />
      </div>
    );
  }

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileFeedback(null);
    setProfileError(null);
    if (displayName.trim().length < 2) {
      setProfileError(
        locale === 'id'
          ? 'Nama tampilan minimal 2 karakter.'
          : 'Display name must be at least 2 characters.'
      );
      return;
    }
    setSavingProfile(true);
    try {
      await updateUserPreferences(firebaseUser.uid, {
        displayName: displayName.trim(),
        preferredLocale: prefLocale,
        preferredCurrency: prefCurrency,
        photoURL: firebaseUser.photoURL ?? '',
      });
      onChangeLocale(prefLocale);
      onChangeCurrency(prefCurrency);
      setProfileFeedback(
        locale === 'id'
          ? 'Profil dan preferensi Anda berhasil disimpan.'
          : 'Profile and regional preferences saved.'
      );
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : 'Unable to save profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  const tabs: { id: ViewerTab; label: string; icon: React.ReactNode }[] = [
    {
      id: 'overview',
      label: locale === 'id' ? 'Ringkasan' : 'Overview',
      icon: <User className="w-4 h-4" aria-hidden="true" />,
    },
    {
      id: 'library',
      label: locale === 'id' ? 'Perpustakaan Saya' : 'My Library',
      icon: <Film className="w-4 h-4" aria-hidden="true" />,
    },
    {
      id: 'wallet',
      label: locale === 'id' ? 'Dompet Kredit' : 'Credit Wallet',
      icon: <Wallet className="w-4 h-4" aria-hidden="true" />,
    },
    {
      id: 'purchases',
      label: locale === 'id' ? 'Riwayat Pembelian' : 'Purchase History',
      icon: <History className="w-4 h-4" aria-hidden="true" />,
    },
    {
      id: 'profile',
      label: locale === 'id' ? 'Profil & Pengaturan' : 'Profile & Settings',
      icon: <Settings className="w-4 h-4" aria-hidden="true" />,
    },
  ];

  const activeEntitlements = mergedEntitlements.filter((e) => e.status === 'active');

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-8 space-y-4 sm:space-y-6">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3.5 sm:pb-5 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
          <div className="w-11 h-11 sm:w-14 sm:h-14 rounded-full overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 shrink-0">
            <MediaImage
              src={userProfile?.photoURL || firebaseUser.photoURL || ''}
              alt={userProfile?.displayName || 'User'}
              fallbackTitle={userProfile?.displayName || 'DELOKEN'}
              className="w-full h-full"
            />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] sm:text-xs text-emerald-700 dark:text-emerald-400 font-semibold">
              {locale === 'id' ? 'Dasbor Penonton' : 'Viewer Workspace'}
            </p>
            <h1 className="font-display text-lg sm:text-2xl font-bold text-slate-900 dark:text-white truncate">
              {userProfile?.displayName || firebaseUser.displayName || 'DELOKEN Member'}
            </h1>
            <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 truncate">{firebaseUser.email}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 sm:gap-2.5">
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              className="col-span-2 sm:col-span-1 w-full sm:w-auto border-emerald-600 dark:border-emerald-500 text-emerald-700 dark:text-emerald-400"
              leftIcon={<Shield className="w-4 h-4" />}
              onClick={() => onNavigate('admin-dashboard')}
            >
              {locale === 'id' ? 'Konsol Admin (Pemilik)' : 'Admin Console'}
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            className="w-full sm:w-auto"
            leftIcon={<Clapperboard className="w-4 h-4" />}
            onClick={() => onNavigate('creator-dashboard')}
          >
            {creatorProfile
              ? locale === 'id'
                ? 'Studio Kreator'
                : 'Creator Studio'
              : locale === 'id'
              ? 'Jadi Kreator'
              : 'Become a Creator'}
          </Button>
          <Button
            variant="primary"
            size="sm"
            className="w-full sm:w-auto"
            onClick={() => onNavigate('explore')}
          >
            {locale === 'id' ? 'Jelajahi Katalog' : 'Explore Catalog'}
          </Button>
        </div>
      </header>

      {/* Tabs */}
      <div
        role="tablist"
        aria-label="Viewer dashboard sections"
        className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto pb-0.5 -mx-3 px-3 sm:mx-0 sm:px-0 deloken-scroll"
      >
        {tabs.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(tab.id)}
              className={`min-h-[38px] inline-flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 rounded-lg text-[11px] sm:text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                active
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-slate-800'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {serverError && (
        <ErrorState
          title={locale === 'id' ? 'Gagal Memuat Data Akun' : 'Unable to Sync Account Ledger'}
          description={serverError}
          retryLabel={locale === 'id' ? 'Coba Lagi' : 'Retry'}
          onRetry={() => setRetryTick((t) => t + 1)}
        />
      )}

      {/* OVERVIEW */}
      {activeTab === 'overview' && (
        <div className="space-y-4 sm:space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 sm:p-4 space-y-0.5 shadow-xs">
              <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400">
                {locale === 'id' ? 'Akses Aktif (30 Hari)' : 'Active 30-Day Access'}
              </p>
              <p className="text-lg sm:text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                {activeEntitlements.length}
              </p>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 sm:p-4 space-y-0.5 shadow-xs">
              <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400">
                {locale === 'id' ? 'Saldo Dompet Kredit' : 'Credit Wallet Balance'}
              </p>
              <p className="text-lg sm:text-2xl font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                {effectiveWallet?.balanceCredits ?? 0}
              </p>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 sm:p-4 space-y-0.5 shadow-xs">
              <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400">
                {locale === 'id' ? 'Total Pembelian' : 'Total Purchases'}
              </p>
              <p className="text-lg sm:text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                {mergedPurchases.length}
              </p>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 sm:p-4 space-y-0.5 shadow-xs">
              <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400">
                {locale === 'id' ? 'Peran Akun' : 'Account Role'}
              </p>
              <p className="text-lg sm:text-2xl font-bold capitalize text-slate-900 dark:text-white">
                {userProfile?.role ?? 'viewer'}
              </p>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1.5 max-w-xl">
              <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                {locale === 'id'
                  ? 'Pay-Per-View, QRIS & Dompet Kredit Aktif'
                  : 'Pay-Per-View, QRIS & Credit Wallet Ready'}
              </h2>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {locale === 'id'
                  ? 'Setiap judul menyediakan pratinjau HLS 5 menit dan dapat dibuka selama 30 hari menggunakan PayPal USD, QRIS Indonesia, atau Dompet Kredit.'
                  : 'Every release offers a 5-minute HLS preview and unlocks 30 days of streaming via PayPal USD, Indonesian QRIS, or Credit Wallet.'}
              </p>
            </div>
            <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2.5 shrink-0">
              <Button variant="outline" size="md" className="w-full sm:w-auto" onClick={() => onNavigate('pricing')}>
                {locale === 'id' ? 'Isi Ulang Kredit' : 'Top Up Credits'}
              </Button>
              <Button variant="primary" size="md" className="w-full sm:w-auto" onClick={() => onNavigate('explore')}>
                {locale === 'id' ? 'Buka Katalog' : 'Browse Catalog'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* MY LIBRARY */}
      {activeTab === 'library' && (
        <section className="space-y-4">
          <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">
            {locale === 'id' ? 'Perpustakaan Akses 30 Hari' : 'My 30-Day Streaming Library'}
          </h2>
          {loadingServerData && mergedEntitlements.length === 0 ? (
            <div className="space-y-3">
              <ListRowSkeleton />
              <ListRowSkeleton />
            </div>
          ) : mergedEntitlements.length === 0 ? (
            <EmptyState
              title={locale === 'id' ? 'Perpustakaan masih kosong' : 'Your library is empty'}
              description={
                locale === 'id'
                  ? 'Tayangan yang Anda buka melalui Pay-Per-View atau Dompet Kredit akan muncul di sini dengan masa akses 30 hari.'
                  : 'Titles you unlock with Pay-Per-View or Credits will appear here with your remaining 30-day access timer.'
              }
              actionLabel={locale === 'id' ? 'Jelajahi Rilisan' : 'Explore Releases'}
              onAction={() => onNavigate('explore')}
              icon={<Film className="w-6 h-6" />}
            />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 sm:gap-5">
              {mergedEntitlements.map((ent) => {
                const catalogMatch = catalog.find((c) => c.id === ent.videoId);
                const playableItem: ContentItem = catalogMatch ?? {
                  id: ent.videoId,
                  slug: ent.videoId,
                  title: ent.videoTitle,
                  subtitle: locale === 'id' ? 'Rilisan Perpustakaan Saya' : 'Library Release',
                  description: '',
                  descriptionId: '',
                  category: 'Creator Exclusives',
                  creatorId: 'creator-1',
                  creatorName: 'DELOKEN Creator',
                  durationMinutes: 6,
                  previewSeconds: 300,
                  releaseYear: 2026,
                  rating: 4.9,
                  reviewCount: 0,
                  priceUsd: 4.99,
                  priceIdr: 79000,
                  creditCost: 5,
                  thumbnailUrl: ent.thumbnailUrl,
                  backdropUrl: ent.thumbnailUrl,
                  resolution: '1080p HD',
                  audioFormat: 'Stereo AAC',
                  languages: ['EN', 'ID'],
                  publishedAt: ent.createdAt || new Date().toISOString(),
                  status: 'published',
                  credits: {
                    director: 'DELOKEN Studio',
                    cinematography: 'DELOKEN Studio',
                    sound: 'DELOKEN Audio',
                  },
                };

                return (
                  <article
                    key={ent.id}
                    className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden p-2.5 sm:p-4 flex flex-col justify-between gap-2.5 sm:gap-3 shadow-xs"
                  >
                    <div className="space-y-2 sm:space-y-3">
                      <div className="aspect-video rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-800">
                        <MediaImage
                          src={ent.thumbnailUrl || playableItem.thumbnailUrl}
                          alt={ent.videoTitle}
                          fallbackTitle={ent.videoTitle}
                          className="w-full h-full"
                        />
                      </div>
                      <div>
                        <h3 className="text-base font-semibold text-slate-900 dark:text-white line-clamp-1">
                          {ent.videoTitle}
                        </h3>
                        <p className="text-xs text-emerald-700 dark:text-emerald-400 font-semibold mt-1 font-mono tabular-nums">
                          {ent.status === 'active'
                            ? locale === 'id'
                              ? `Aktif · Tersisa ${ent.remainingDays} hari`
                              : `Active · ${ent.remainingDays} days remaining`
                            : ent.status === 'revoked'
                            ? locale === 'id'
                              ? 'Dibatalkan / Refund'
                              : 'Revoked / Refunded'
                            : locale === 'id'
                            ? 'Kedaluwarsa'
                            : 'Expired'}
                        </p>
                        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400 mt-1 font-mono tabular-nums">
                          <span>
                            {locale === 'id' ? 'Berakhir' : 'Expires'}{' '}
                            {formatLocalizedDate(ent.expiresAt, locale)}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Clock className="w-3 h-3" aria-hidden="true" />
                            {formatResumeClock(ent.resumeSeconds)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {ent.status === 'active' && (
                      <Button
                        variant="primary"
                        size="sm"
                        className="w-full"
                        leftIcon={<Play className="w-3.5 h-3.5 fill-current" />}
                        onClick={() => onWatchContent(playableItem)}
                      >
                        {ent.resumeSeconds > 0
                          ? locale === 'id'
                            ? `Lanjutkan (${formatResumeClock(ent.resumeSeconds)})`
                            : `Continue Watching (${formatResumeClock(ent.resumeSeconds)})`
                          : locale === 'id'
                          ? 'Tonton Sekarang'
                          : 'Watch Now'}
                      </Button>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* CREDIT WALLET */}
      {activeTab === 'wallet' && (
        <section className="space-y-6">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-8 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-5 sm:gap-6">
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">
                {locale === 'id' ? 'Saldo Kredit Tersedia' : 'Available Credit Balance'}
              </p>
              <p className="text-3xl sm:text-4xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                {effectiveWallet?.balanceCredits ?? 0}{' '}
                <span className="text-base font-normal text-emerald-700 dark:text-emerald-400">
                  {locale === 'id' ? 'Kredit' : 'Credits'}
                </span>
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 font-mono tabular-nums">
                {locale === 'id' ? 'Total digunakan: ' : 'Lifetime spent: '}
                {effectiveWallet?.totalSpentCredits ?? 0}
              </p>
            </div>

            <Button variant="primary" size="md" className="w-full sm:w-auto" onClick={() => onNavigate('pricing')}>
              {locale === 'id' ? 'Isi Ulang Dompet Kredit' : 'Top Up Credits'}
            </Button>
          </div>

          <div className="space-y-3">
            <h3 className="font-display text-lg font-bold text-slate-900 dark:text-white">
              {locale === 'id' ? 'Riwayat Transaksi Kredit' : 'Wallet Ledger'}
            </h3>
            {loadingServerData && mergedTransactions.length === 0 ? (
              <div className="space-y-3">
                <ListRowSkeleton />
                <ListRowSkeleton />
              </div>
            ) : mergedTransactions.length === 0 ? (
              <EmptyState
                title={locale === 'id' ? 'Belum ada transaksi kredit' : 'No wallet transactions yet'}
                description={
                  locale === 'id'
                    ? 'Pengisian saldo melalui PayPal/QRIS dan penggunaan kredit tercatat permanen di buku besar ini.'
                    : 'Credit package top-ups via PayPal/QRIS and title unlocks are recorded immutably here.'
                }
                icon={<Wallet className="w-6 h-6" />}
              />
            ) : (
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-200 dark:divide-slate-800 shadow-xs">
                {mergedTransactions.map((tx) => (
                  <div key={tx.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100 break-words">{tx.description}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 capitalize font-mono mt-0.5">
                        {tx.type} · {formatLocalizedDate(tx.createdAt, locale)}
                      </p>
                    </div>
                    <span
                      className={`text-sm font-mono tabular-nums font-semibold shrink-0 ${
                        tx.creditsDelta >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-900 dark:text-slate-100'
                      }`}
                    >
                      {tx.creditsDelta > 0 ? `+${tx.creditsDelta}` : tx.creditsDelta} Credits
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* PURCHASE HISTORY */}
      {activeTab === 'purchases' && (
        <section className="space-y-4">
          <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">
            {locale === 'id' ? 'Riwayat Pembelian' : 'Purchase History'}
          </h2>
          {loadingServerData && mergedPurchases.length === 0 ? (
            <div className="space-y-3">
              <ListRowSkeleton />
              <ListRowSkeleton />
            </div>
          ) : mergedPurchases.length === 0 ? (
            <EmptyState
              title={locale === 'id' ? 'Belum ada pembelian' : 'No purchases recorded yet'}
              description={
                locale === 'id'
                  ? 'Semua transaksi PayPal, QRIS, dan Kredit akan tampil di sini bersama status verifikasi server.'
                  : 'Your PayPal, QRIS, and Credit purchases will appear here with server-verified status.'
              }
              icon={<History className="w-6 h-6" />}
            />
          ) : (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-200 dark:divide-slate-800 shadow-xs">
              {mergedPurchases.map((p) => (
                <div key={p.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white break-words">{p.videoTitle}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-0.5">
                      {p.method.toUpperCase()} · {p.status.toUpperCase()} ·{' '}
                      {formatLocalizedDate(p.createdAt, locale)}
                    </p>
                  </div>
                  <span className="text-sm font-mono tabular-nums font-semibold text-slate-900 dark:text-white shrink-0">
                    {p.currency === 'CREDITS'
                      ? `${p.amount} Credits`
                      : formatPrice(p.amount, p.amount, p.currency)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* PROFILE & SETTINGS */}
      {activeTab === 'profile' && (
        <section className="max-w-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6 shadow-xs">
          <div>
            <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">
              {locale === 'id' ? 'Profil & Pengaturan' : 'Profile & Settings'}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {locale === 'id'
                ? 'Perubahan disimpan langsung ke profil Firestore Anda.'
                : 'Updates save directly to your Firestore profile.'}
            </p>
          </div>

          {profileError && (
            <div
              role="alert"
              className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800/70 text-xs text-rose-700 dark:text-rose-300"
            >
              {profileError}
            </div>
          )}

          {profileFeedback && (
            <div
              role="status"
              className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/70 text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>{profileFeedback}</span>
            </div>
          )}

          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div>
              <label
                htmlFor="viewer-display-name"
                className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5"
              >
                {locale === 'id' ? 'Nama Tampilan' : 'Display Name'}
              </label>
              <input
                id="viewer-display-name"
                type="text"
                maxLength={80}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="viewer-locale"
                  className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5"
                >
                  {locale === 'id' ? 'Bahasa Default' : 'Preferred Language'}
                </label>
                <select
                  id="viewer-locale"
                  value={prefLocale}
                  onChange={(e) => setPrefLocale(e.target.value as LocaleCode)}
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                >
                  <option value="en">English</option>
                  <option value="id">Bahasa Indonesia</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="viewer-currency"
                  className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5"
                >
                  {locale === 'id' ? 'Mata Uang Default' : 'Preferred Currency'}
                </label>
                <select
                  id="viewer-currency"
                  value={prefCurrency}
                  onChange={(e) => setPrefCurrency(e.target.value as CurrencyCode)}
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                >
                  <option value="USD">USD ($)</option>
                  <option value="IDR">IDR (Rp)</option>
                </select>
              </div>
            </div>

            <Button type="submit" variant="primary" size="md" className="w-full sm:w-auto" isLoading={savingProfile}>
              {locale === 'id' ? 'Simpan Perubahan' : 'Save Preferences'}
            </Button>
          </form>
        </section>
      )}
    </div>
  );
};
