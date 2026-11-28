import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CATALOG_ITEMS, CREDIT_PACKAGES, CREATORS, SAMPLE_REVIEWS } from './data/catalog';
import type {
  ContentCategory,
  ContentItem,
  CreatorFollowRecord,
  CreatorProfile,
  CurrencyCode,
  LocaleCode,
  ViewRoute,
  WatchProgressRecord,
  WatchlistRecord,
} from './types/vyora';
import { AuthProvider, useAuth } from './context/AuthContext';
import {
  removeWatchProgress,
  setCreatorFollowed,
  setWatchlistSaved,
  submitReport,
  subscribeCreatorFollows,
  subscribePublicCreators,
  subscribePublishedVideos,
  subscribeWatchProgress,
  subscribeWatchlist,
} from './services/firestoreService';
import { fetchPublicMetrics, syncCreatorFollowCount } from './services/streamService';
import { buildRouteUrl, parseLocationRoute } from './utils/navigation';
import { Navbar } from './components/layout/Navbar';
import { MobileBottomNav } from './components/layout/MobileBottomNav';
import { Footer } from './components/layout/Footer';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { ConfirmDialog } from './components/ui/ConfirmDialog';
import { EmptyState } from './components/ui/StateViews';
import { ContentCardSkeleton, CreatorCardSkeleton } from './components/ui/Skeleton';
import { Button } from './components/ui/Button';
import { StreamingPlayerModal } from './components/player/StreamingPlayerModal';
import { CheckoutModal, type CheckoutTarget } from './components/checkout/CheckoutModal';
import { HomePage } from './pages/HomePage';
import { ExplorePage } from './pages/ExplorePage';
import { CategoriesPage } from './pages/CategoriesPage';
import { SearchPage } from './pages/SearchPage';
import { PricingPage } from './pages/PricingPage';
import { ContentDetailPage } from './pages/ContentDetailPage';
import { CreatorDetailPage } from './pages/CreatorDetailPage';
import { AuthPage } from './pages/AuthPage';
import { ViewerDashboardPage } from './pages/ViewerDashboardPage';
import { CreatorDashboardPage } from './pages/CreatorDashboardPage';
import { AdminDashboardPage } from './pages/AdminDashboardPage';
import { InfoPage } from './pages/InfoPage';

const STORAGE_LOCALE_KEY = 'deloken_locale';
const STORAGE_CURRENCY_KEY = 'deloken_currency';
const STORAGE_THEME_KEY = 'deloken_theme';

export type ThemeMode = 'light' | 'dark';

function readStoredLocale(): LocaleCode {
  try {
    const raw = window.localStorage.getItem(STORAGE_LOCALE_KEY);
    return raw === 'en' ? 'en' : 'id';
  } catch {
    return 'id';
  }
}

function readStoredCurrency(defaultLocale: LocaleCode): CurrencyCode {
  try {
    const raw = window.localStorage.getItem(STORAGE_CURRENCY_KEY);
    if (raw === 'USD' || raw === 'IDR') return raw;
  } catch {
    // Ignore storage issues
  }
  return defaultLocale === 'id' ? 'IDR' : 'USD';
}

function readStoredTheme(): ThemeMode {
  try {
    const raw = window.localStorage.getItem(STORAGE_THEME_KEY);
    if (raw === 'dark' || raw === 'light') return raw;
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
  } catch {
    // Ignore storage issues
  }
  return 'light';
}

const DelokenAppShell: React.FC<{
  locale: LocaleCode;
  currency: CurrencyCode;
  theme: ThemeMode;
  onChangeLocale: (locale: LocaleCode) => void;
  onChangeCurrency: (currency: CurrencyCode) => void;
  onToggleTheme: () => void;
}> = ({ locale, currency, theme, onChangeLocale, onChangeCurrency, onToggleTheme }) => {
  const { firebaseUser, userProfile } = useAuth();

  const initialParsed = useMemo(() => parseLocationRoute(), []);
  const inAppHistoryDepthRef = useRef(0);

  const [route, setRoute] = useState<ViewRoute>(initialParsed.route);
  const [selectedCategory, setSelectedCategory] = useState<ContentCategory | 'All'>(
    initialParsed.category
  );
  const [selectedCreatorId, setSelectedCreatorId] = useState<string | null>(
    initialParsed.creatorId
  );
  const [selectedContentId, setSelectedContentId] = useState<string>(
    initialParsed.contentId
  );

  const [liveVideos, setLiveVideos] = useState<ContentItem[]>([]);
  const [liveCreators, setLiveCreators] = useState<CreatorProfile[]>([]);
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [creatorsLoaded, setCreatorsLoaded] = useState(false);

  const [watchProgress, setWatchProgress] = useState<WatchProgressRecord[]>([]);
  const [watchlist, setWatchlist] = useState<WatchlistRecord[]>([]);
  const [creatorFollows, setCreatorFollows] = useState<CreatorFollowRecord[]>([]);
  const [liveViewCounts, setLiveViewCounts] = useState<Record<string, number>>({});
  const [liveFollowerCounts, setLiveFollowerCounts] = useState<Record<string, number>>({});

  const [activePlayerItem, setActivePlayerItem] = useState<ContentItem | null>(null);
  const [playerInitialResume, setPlayerInitialResume] = useState<number>(0);
  const [checkoutTarget, setCheckoutTarget] = useState<CheckoutTarget | null>(null);
  const [entitlementRefreshKey, setEntitlementRefreshKey] = useState<number>(0);

  const [socialNoticePlatform, setSocialNoticePlatform] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<ContentItem | null>(null);
  const [reportReason, setReportReason] = useState('');
  const [reportSending, setReportSending] = useState(false);
  const [reportSentNotice, setReportSentNotice] = useState(false);

  // Sync user saved locale/currency preferences on sign-in
  useEffect(() => {
    if (!userProfile) return;
    if (userProfile.preferredLocale) {
      onChangeLocale(userProfile.preferredLocale);
    }
    if (userProfile.preferredCurrency) {
      onChangeCurrency(userProfile.preferredCurrency);
    }
  }, [userProfile?.uid]);

  // Real-time Firestore catalog & public creators
  useEffect(() => {
    const unsubVideos = subscribePublishedVideos((videos) => {
      setLiveVideos(videos);
      setCatalogLoaded(true);
    });
    const unsubCreators = subscribePublicCreators((creators) => {
      setLiveCreators(creators);
      setCreatorsLoaded(true);
    });
    return () => {
      unsubVideos();
      unsubCreators();
    };
  }, []);

  // Fetch public view & follower counts from backend ledger
  useEffect(() => {
    let cancelled = false;
    void fetchPublicMetrics().then((snapshot) => {
      if (cancelled) return;
      if (Object.keys(snapshot.videoViews).length > 0) {
        setLiveViewCounts((prev) => ({ ...prev, ...snapshot.videoViews }));
      }
      if (Object.keys(snapshot.creatorFollowers).length > 0) {
        setLiveFollowerCounts((prev) => ({ ...prev, ...snapshot.creatorFollowers }));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [entitlementRefreshKey]);

  // Subscribe to per-user watch progress, saved watchlist & creator follows
  useEffect(() => {
    if (!firebaseUser) {
      setWatchProgress([]);
      setWatchlist([]);
      setCreatorFollows([]);
      return;
    }
    const unsubProgress = subscribeWatchProgress(firebaseUser.uid, setWatchProgress);
    const unsubWatchlist = subscribeWatchlist(firebaseUser.uid, setWatchlist);
    const unsubFollows = subscribeCreatorFollows(firebaseUser.uid, setCreatorFollows);
    return () => {
      unsubProgress();
      unsubWatchlist();
      unsubFollows();
    };
  }, [firebaseUser?.uid]);

  // Browser & Mobile Back/Forward synchronization
  useEffect(() => {
    const handlePopState = () => {
      const parsed = parseLocationRoute();
      setActivePlayerItem(null);
      setRoute(parsed.route);
      setSelectedContentId(parsed.contentId);
      setSelectedCreatorId(parsed.creatorId);
      setSelectedCategory(parsed.category);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const commitHistoryUrl = useCallback(
    (nextState: {
      route: ViewRoute;
      contentId?: string;
      creatorId?: string | null;
      category?: ContentCategory | 'All';
    }) => {
      const nextUrl = buildRouteUrl(nextState);
      const currentUrl = `${window.location.pathname}${window.location.search}`;
      if (nextUrl !== currentUrl) {
        window.history.pushState(nextState, '', nextUrl);
        inAppHistoryDepthRef.current += 1;
      }
    },
    []
  );

  const savedVideoIds = useMemo(
    () => new Set(watchlist.map((item) => item.videoId)),
    [watchlist]
  );

  const followedCreatorIds = useMemo(
    () => new Set(creatorFollows.map((item) => item.creatorId)),
    [creatorFollows]
  );

  const mergedCatalog = useMemo(() => {
    const map = new Map<string, ContentItem>();
    for (const item of CATALOG_ITEMS) {
      map.set(item.id, item);
    }
    for (const item of liveVideos) {
      map.set(item.id, item);
    }
    return Array.from(map.values()).map((item) => ({
      ...item,
      viewCount: Math.max(item.viewCount ?? 0, liveViewCounts[item.id] ?? 0),
    }));
  }, [liveVideos, liveViewCounts]);

  const mergedCreators = useMemo(() => {
    const map = new Map<string, CreatorProfile>();
    for (const creator of CREATORS) {
      map.set(creator.id, creator);
    }
    for (const creator of liveCreators) {
      if (creator.status !== 'suspended') {
        map.set(creator.id, creator);
      }
    }
    return Array.from(map.values()).map((creator) => ({
      ...creator,
      followerCount:
        typeof liveFollowerCounts[creator.id] === 'number'
          ? liveFollowerCounts[creator.id]
          : creator.followerCount ?? 0,
    }));
  }, [liveCreators, liveFollowerCounts]);

  const navigate = (nextRoute: ViewRoute) => {
    setRoute(nextRoute);
    commitHistoryUrl({
      route: nextRoute,
      contentId: nextRoute === 'detail' ? selectedContentId : '',
      creatorId:
        nextRoute === 'creator' || nextRoute === 'explore' ? selectedCreatorId : null,
      category: nextRoute === 'explore' ? selectedCategory : 'All',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleBackNavigation = () => {
    if (inAppHistoryDepthRef.current > 0) {
      inAppHistoryDepthRef.current = Math.max(0, inAppHistoryDepthRef.current - 1);
      window.history.back();
      return;
    }
    navigate('home');
  };

  const handleSelectContent = (item: ContentItem) => {
    setSelectedContentId(item.id);
    setRoute('detail');
    commitHistoryUrl({ route: 'detail', contentId: item.id });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleExploreCategory = (category: ContentCategory) => {
    setSelectedCategory(category);
    setSelectedCreatorId(null);
    setRoute('explore');
    commitHistoryUrl({ route: 'explore', category, creatorId: null });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleExploreCreator = (creatorId: string) => {
    setSelectedCreatorId(creatorId);
    setRoute('creator');
    commitHistoryUrl({ route: 'creator', creatorId });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleChangeExploreCategory = (category: ContentCategory | 'All') => {
    setSelectedCategory(category);
    commitHistoryUrl({ route: 'explore', category, creatorId: selectedCreatorId });
  };

  const handleClearExploreCreator = () => {
    setSelectedCreatorId(null);
    commitHistoryUrl({ route: 'explore', category: selectedCategory, creatorId: null });
  };

  const handleWatchPreview = (item: ContentItem, resumeSeconds?: number) => {
    const existing = watchProgress.find((p) => p.videoId === item.id);
    setPlayerInitialResume(
      typeof resumeSeconds === 'number' ? resumeSeconds : existing?.resumeSeconds ?? 0
    );
    setActivePlayerItem(item);
  };

  const handleToggleSave = async (item: ContentItem) => {
    if (!firebaseUser) {
      setActivePlayerItem(null);
      navigate('login');
      return;
    }
    const nextSaved = !savedVideoIds.has(item.id);
    await setWatchlistSaved(firebaseUser.uid, item.id, nextSaved);
  };

  const handleToggleFollow = async (creatorId: string) => {
    if (!firebaseUser) {
      setActivePlayerItem(null);
      navigate('login');
      return;
    }
    const nextFollowing = !followedCreatorIds.has(creatorId);
    await setCreatorFollowed(firebaseUser.uid, creatorId, nextFollowing);
    const updatedCount = await syncCreatorFollowCount(creatorId, nextFollowing);
    if (typeof updatedCount === 'number') {
      setLiveFollowerCounts((prev) => ({
        ...prev,
        [creatorId]: updatedCount,
      }));
    }
  };

  const handleDismissProgress = async (videoId: string) => {
    if (!firebaseUser) return;
    await removeWatchProgress(firebaseUser.uid, videoId);
  };

  const handleViewCounted = useCallback((videoId: string, viewCount: number) => {
    setLiveViewCounts((prev) => ({
      ...prev,
      [videoId]: Math.max(prev[videoId] ?? 0, viewCount),
    }));
  }, []);

  const activeItem = selectedContentId
    ? mergedCatalog.find((c) => c.id === selectedContentId) ?? null
    : mergedCatalog[0] ?? null;
  const activeCreator = activeItem
    ? mergedCreators.find((c) => c.id === activeItem.creatorId)
    : undefined;
  const detailCreator = selectedCreatorId
    ? mergedCreators.find((c) => c.id === selectedCreatorId) ?? null
    : mergedCreators[0] ?? null;

  const relatedItems = useMemo(() => {
    if (!activeItem) return [];
    return mergedCatalog
      .filter((c) => c.id !== activeItem.id && c.category === activeItem.category)
      .concat(
        mergedCatalog.filter((c) => c.id !== activeItem.id && c.category !== activeItem.category)
      )
      .slice(0, 4);
  }, [mergedCatalog, activeItem]);

  const playerRelatedItems = useMemo(() => {
    if (!activePlayerItem) return [];
    return mergedCatalog
      .filter(
        (c) => c.id !== activePlayerItem.id && c.category === activePlayerItem.category
      )
      .concat(
        mergedCatalog.filter(
          (c) => c.id !== activePlayerItem.id && c.category !== activePlayerItem.category
        )
      )
      .slice(0, 6);
  }, [mergedCatalog, activePlayerItem]);

  const creatorWorks = useMemo(() => {
    if (!detailCreator) return [];
    return mergedCatalog.filter((c) => c.creatorId === detailCreator.id);
  }, [mergedCatalog, detailCreator]);

  const handleSubmitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !reportTarget || reportReason.trim().length < 5) return;
    setReportSending(true);
    try {
      await submitReport(firebaseUser.uid, 'video', reportTarget.id, reportReason.trim());
      setReportTarget(null);
      setReportReason('');
      setReportSentNotice(true);
    } finally {
      setReportSending(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors duration-200">
      <Navbar
        activeRoute={route}
        locale={locale}
        theme={theme}
        onChangeLocale={(next) => {
          onChangeLocale(next);
          onChangeCurrency(next === 'id' ? 'IDR' : 'USD');
        }}
        onToggleTheme={onToggleTheme}
        onNavigate={navigate}
      />

      <main className="flex-1 pb-14 md:pb-0">
        {route === 'home' && (
          <HomePage
            catalog={mergedCatalog}
            creators={mergedCreators}
            locale={locale}
            currency={currency}
            watchProgress={watchProgress}
            savedVideoIds={savedVideoIds}
            followedCreatorIds={followedCreatorIds}
            onWatchPreview={handleWatchPreview}
            onSelectContent={handleSelectContent}
            onExploreCategory={handleExploreCategory}
            onExploreCreator={handleExploreCreator}
            onToggleSave={handleToggleSave}
            onToggleFollow={handleToggleFollow}
            onDismissProgress={handleDismissProgress}
            onNavigate={navigate}
          />
        )}

        {route === 'explore' && (
          <ExplorePage
            catalog={mergedCatalog}
            creators={mergedCreators}
            locale={locale}
            currency={currency}
            selectedCategory={selectedCategory}
            selectedCreatorId={selectedCreatorId}
            savedVideoIds={savedVideoIds}
            onChangeCategory={handleChangeExploreCategory}
            onClearCreator={handleClearExploreCreator}
            onSelectContent={handleSelectContent}
            onWatchPreview={(item) => handleWatchPreview(item)}
            onSelectCreator={handleExploreCreator}
            onToggleSave={handleToggleSave}
          />
        )}

        {route === 'categories' && (
          <CategoriesPage
            catalog={mergedCatalog}
            locale={locale}
            currency={currency}
            savedVideoIds={savedVideoIds}
            onExploreCategory={handleExploreCategory}
            onSelectContent={handleSelectContent}
            onWatchPreview={(item) => handleWatchPreview(item)}
            onSelectCreator={handleExploreCreator}
            onToggleSave={handleToggleSave}
            onNavigate={navigate}
          />
        )}

        {route === 'search' && (
          <SearchPage
            catalog={mergedCatalog}
            creators={mergedCreators}
            locale={locale}
            currency={currency}
            savedVideoIds={savedVideoIds}
            followedCreatorIds={followedCreatorIds}
            onSelectContent={handleSelectContent}
            onWatchPreview={(item) => handleWatchPreview(item)}
            onSelectCreator={handleExploreCreator}
            onToggleSave={handleToggleSave}
            onToggleFollow={handleToggleFollow}
          />
        )}

        {route === 'pricing' && (
          <PricingPage
            packages={CREDIT_PACKAGES}
            locale={locale}
            currency={currency}
            onChangeCurrency={onChangeCurrency}
            onSelectPackage={(pkg) =>
              setCheckoutTarget({
                kind: 'credit_package',
                pkg,
                initialMethod: currency === 'IDR' ? 'qris' : 'paypal',
              })
            }
            onNavigate={navigate}
          />
        )}

        {route === 'detail' && (
          activeItem ? (
            <ContentDetailPage
              item={activeItem}
              creator={activeCreator}
              relatedItems={relatedItems}
              reviews={SAMPLE_REVIEWS.filter((r) => r.contentId === activeItem.id)}
              locale={locale}
              currency={currency}
              entitlementRefreshKey={entitlementRefreshKey}
              savedVideoIds={savedVideoIds}
              followedCreatorIds={followedCreatorIds}
              onBack={handleBackNavigation}
              onWatchPreview={(item) => handleWatchPreview(item)}
              onSelectContent={handleSelectContent}
              onExploreCreator={handleExploreCreator}
              onToggleSave={handleToggleSave}
              onToggleFollow={handleToggleFollow}
              onRequestUnlock={(method, item) =>
                setCheckoutTarget({
                  kind: 'video',
                  item,
                  initialMethod:
                    method === 'credits'
                      ? 'credits'
                      : currency === 'IDR'
                      ? 'qris'
                      : 'paypal',
                  resumeSeconds: 0,
                })
              }
              onReportContent={(item) => {
                if (!firebaseUser) {
                  navigate('login');
                  return;
                }
                setReportTarget(item);
              }}
            />
          ) : !catalogLoaded ? (
            <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-6 sm:py-10 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-5">
              {Array.from({ length: 4 }).map((_, idx) => (
                <ContentCardSkeleton key={idx} />
              ))}
            </div>
          ) : (
            <div className="max-w-3xl mx-auto px-4 py-16">
              <EmptyState
                title={
                  selectedContentId
                    ? locale === 'id'
                      ? 'Tayangan tidak ditemukan'
                      : 'Release not found'
                    : locale === 'id'
                    ? 'Belum ada tayangan di galeri'
                    : 'No releases in gallery yet'
                }
                description={
                  selectedContentId
                    ? locale === 'id'
                      ? 'Tautan tayangan mungkin sudah diarsipkan atau belum dipublikasikan.'
                      : 'This video link may have been archived or is not published yet.'
                    : locale === 'id'
                    ? 'Unggah video pertama Anda melalui Studio Kreator agar tayangan tampil di katalog.'
                    : 'Upload your first release through Creator Studio to publish it into the catalog.'
                }
                actionLabel={
                  selectedContentId
                    ? locale === 'id'
                      ? 'Kembali ke Beranda'
                      : 'Back to Home'
                    : locale === 'id'
                    ? 'Buka Studio Kreator'
                    : 'Open Creator Studio'
                }
                onAction={() =>
                  navigate(selectedContentId ? 'home' : 'creator-dashboard')
                }
              />
            </div>
          )
        )}

        {route === 'creator' && (
          detailCreator ? (
            <CreatorDetailPage
              creator={detailCreator}
              works={creatorWorks}
              locale={locale}
              currency={currency}
              isFollowing={followedCreatorIds.has(detailCreator.id)}
              savedVideoIds={savedVideoIds}
              onBack={handleBackNavigation}
              onSelectContent={handleSelectContent}
              onWatchPreview={(item) => handleWatchPreview(item)}
              onToggleFollow={handleToggleFollow}
              onToggleSave={handleToggleSave}
            />
          ) : !creatorsLoaded ? (
            <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-6 sm:py-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <CreatorCardSkeleton />
              <CreatorCardSkeleton />
            </div>
          ) : (
            <div className="max-w-3xl mx-auto px-4 py-16">
              <EmptyState
                title={
                  selectedCreatorId
                    ? locale === 'id'
                      ? 'Kreator tidak ditemukan'
                      : 'Creator not found'
                    : locale === 'id'
                    ? 'Belum ada profil kreator'
                    : 'No creator profiles yet'
                }
                description={
                  selectedCreatorId
                    ? locale === 'id'
                      ? 'Profil kreator yang Anda cari belum tersedia.'
                      : 'The requested creator profile is unavailable.'
                    : locale === 'id'
                    ? 'Daftarkan profil kreator pertama Anda di Studio Kreator untuk mulai mempublikasikan karya.'
                    : 'Register your first creator profile in Creator Studio to start publishing releases.'
                }
                actionLabel={
                  selectedCreatorId
                    ? locale === 'id'
                      ? 'Kembali ke Beranda'
                      : 'Back to Home'
                    : locale === 'id'
                    ? 'Buka Studio Kreator'
                    : 'Open Creator Studio'
                }
                onAction={() =>
                  navigate(selectedCreatorId ? 'home' : 'creator-dashboard')
                }
              />
            </div>
          )
        )}

        {(route === 'login' || route === 'signup') && (
          <AuthPage
            mode={route}
            locale={locale}
            currency={currency}
            onSwitchMode={(next) => navigate(next)}
            onNavigate={navigate}
          />
        )}

        {route === 'viewer-dashboard' && (
          <ViewerDashboardPage
            catalog={mergedCatalog}
            creators={mergedCreators}
            locale={locale}
            currency={currency}
            entitlementRefreshKey={entitlementRefreshKey}
            savedVideoIds={savedVideoIds}
            followedCreatorIds={followedCreatorIds}
            onNavigate={navigate}
            onWatchContent={(item) => handleWatchPreview(item)}
            onSelectContent={handleSelectContent}
            onExploreCreator={handleExploreCreator}
            onToggleSave={handleToggleSave}
            onToggleFollow={handleToggleFollow}
          />
        )}

        {route === 'creator-dashboard' && (
          <CreatorDashboardPage
            locale={locale}
            currency={currency}
            onNavigate={navigate}
          />
        )}

        {route === 'admin-dashboard' && (
          <AdminDashboardPage locale={locale} onNavigate={navigate} />
        )}

        {(route === 'guide' ||
          route === 'about' ||
          route === 'contact' ||
          route === 'terms' ||
          route === 'privacy' ||
          route === 'guidelines') && (
          <InfoPage
            section={route}
            locale={locale}
            onBack={handleBackNavigation}
            onNavigate={navigate}
            onOpenSocialNotice={(platform) => setSocialNoticePlatform(platform)}
          />
        )}
      </main>

      <Footer
        locale={locale}
        onNavigate={navigate}
      />

      <MobileBottomNav activeRoute={route} locale={locale} onNavigate={navigate} />

      {/* Adaptive Signed HLS Streaming Modal */}
      <StreamingPlayerModal
        item={activePlayerItem}
        relatedItems={playerRelatedItems}
        locale={locale}
        currency={currency}
        authRefreshKey={entitlementRefreshKey}
        initialResumeSeconds={playerInitialResume}
        isSaved={Boolean(activePlayerItem && savedVideoIds.has(activePlayerItem.id))}
        onClose={() => setActivePlayerItem(null)}
        onViewDetails={(item) => {
          setActivePlayerItem(null);
          handleSelectContent(item);
        }}
        onSelectRelated={(item) => handleWatchPreview(item)}
        onToggleSave={handleToggleSave}
        onViewCounted={handleViewCounted}
        onRequireSignIn={() => {
          setActivePlayerItem(null);
          navigate('login');
        }}
        onRequestCheckout={(item, method, resumeSeconds) => {
          setCheckoutTarget({
            kind: 'video',
            item,
            initialMethod: method,
            resumeSeconds,
          });
        }}
      />

      {/* Production Payment Checkout Modal (PayPal, QRIS, Credit Wallet) */}
      <CheckoutModal
        target={checkoutTarget}
        locale={locale}
        currency={currency}
        onClose={() => setCheckoutTarget(null)}
        onRequireSignIn={() => navigate('login')}
        onPaymentCompleted={() => {
          setEntitlementRefreshKey((k) => k + 1);
        }}
        onWatchVideo={(item) => {
          setActivePlayerItem(item);
        }}
        onOpenTopUpPackages={() => navigate('pricing')}
      />

      {/* Social Media Info Dialog */}
      <ConfirmDialog
        isOpen={Boolean(socialNoticePlatform)}
        title={`DELOKEN on ${socialNoticePlatform ?? ''}`}
        description={
          locale === 'id'
            ? `Akun resmi @delokenstream di ${socialNoticePlatform ?? ''} mempublikasikan cuplikan dokumenter, jadwal pemutaran langsung, dan sorotan kreator mingguan.`
            : `Official updates from @delokenstream on ${socialNoticePlatform ?? ''} share documentary trailers, live screening announcements, and weekly creator spotlights.`
        }
        confirmLabel={locale === 'id' ? 'Tutup' : 'Close'}
        cancelLabel={locale === 'id' ? 'Jelajahi Katalog' : 'Browse Catalog'}
        onConfirm={() => setSocialNoticePlatform(null)}
        onCancel={() => {
          setSocialNoticePlatform(null);
          navigate('explore');
        }}
      />

      {/* Report Sent Confirmation Dialog */}
      <ConfirmDialog
        isOpen={reportSentNotice}
        title={locale === 'id' ? 'Laporan Diterima' : 'Report Submitted'}
        description={
          locale === 'id'
            ? 'Terima kasih. Tim moderasi DELOKEN akan meninjau laporan Anda melalui Konsol Admin.'
            : 'Thank you. The DELOKEN moderation team will review your report in the Admin Console.'
        }
        confirmLabel="OK"
        cancelLabel={locale === 'id' ? 'Tutup' : 'Close'}
        onConfirm={() => setReportSentNotice(false)}
        onCancel={() => setReportSentNotice(false)}
      />

      {/* Content Report Modal */}
      {reportTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 dark:bg-slate-950/75 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="report-modal-title"
        >
          <form
            onSubmit={handleSubmitReport}
            className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4 shadow-2xl"
          >
            <h3 id="report-modal-title" className="text-lg font-bold text-slate-900 dark:text-white">
              {locale === 'id' ? 'Laporkan Tayangan' : 'Report Release'}
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              {reportTarget.title}
            </p>
            <textarea
              rows={3}
              required
              minLength={5}
              maxLength={500}
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              placeholder={
                locale === 'id'
                  ? 'Jelaskan alasan laporan (hak cipta, kualitas teknis, atau pelanggaran panduan)...'
                  : 'Describe your reason (copyright, technical issue, or guideline concern)...'
              }
              className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />
            <div className="flex items-center justify-end gap-2.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setReportTarget(null);
                  setReportReason('');
                }}
              >
                {locale === 'id' ? 'Batal' : 'Cancel'}
              </Button>
              <Button type="submit" variant="primary" size="sm" isLoading={reportSending}>
                {locale === 'id' ? 'Kirim Laporan' : 'Submit Report'}
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export function App() {
  const [locale, setLocale] = useState<LocaleCode>(() => readStoredLocale());
  const [currency, setCurrency] = useState<CurrencyCode>(() =>
    readStoredCurrency(readStoredLocale())
  );
  const [theme, setTheme] = useState<ThemeMode>(() => readStoredTheme());

  useEffect(() => {
    const isDark = theme === 'dark';
    document.documentElement.classList.toggle('dark', isDark);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', isDark ? '#020617' : '#F8FAFC');
    }
    try {
      window.localStorage.setItem(STORAGE_THEME_KEY, theme);
    } catch {
      // Ignore storage error
    }
  }, [theme]);

  const handleLocaleChange = (nextLocale: LocaleCode) => {
    setLocale(nextLocale);
    try {
      window.localStorage.setItem(STORAGE_LOCALE_KEY, nextLocale);
    } catch {
      // Ignore storage error
    }
  };

  const handleCurrencyChange = (nextCurrency: CurrencyCode) => {
    setCurrency(nextCurrency);
    try {
      window.localStorage.setItem(STORAGE_CURRENCY_KEY, nextCurrency);
    } catch {
      // Ignore storage error
    }
  };

  const handleToggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  return (
    <ErrorBoundary>
      <AuthProvider defaultLocale={locale} defaultCurrency={currency}>
        <DelokenAppShell
          locale={locale}
          currency={currency}
          theme={theme}
          onChangeLocale={handleLocaleChange}
          onChangeCurrency={handleCurrencyChange}
          onToggleTheme={handleToggleTheme}
        />
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;
