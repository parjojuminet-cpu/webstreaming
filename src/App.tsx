import { useEffect, useMemo, useState } from 'react';
import {
  CATALOG_ITEMS,
  CREATORS,
  CREDIT_PACKAGES,
  SAMPLE_REVIEWS,
} from './data/catalog';
import { AuthProvider, useAuth } from './context/AuthContext';
import {
  subscribePublicCreators,
  subscribePublishedVideos,
  submitReport,
} from './services/firestoreService';
import type {
  ContentCategory,
  ContentItem,
  CreatorProfile,
  CreditPackage,
  CurrencyCode,
  LocaleCode,
  PaymentGateway,
  ViewRoute,
} from './types/vyora';
import { formatPrice } from './i18n/translations';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { Navbar } from './components/layout/Navbar';
import { MobileBottomNav } from './components/layout/MobileBottomNav';
import { Footer } from './components/layout/Footer';
import { StreamingPlayerModal } from './components/player/StreamingPlayerModal';
import {
  CheckoutModal,
  type CheckoutTarget,
} from './components/checkout/CheckoutModal';
import { ConfirmDialog } from './components/ui/ConfirmDialog';
import { HomePage } from './pages/HomePage';
import { ExplorePage } from './pages/ExplorePage';
import { CategoriesPage } from './pages/CategoriesPage';
import { SearchPage } from './pages/SearchPage';
import { PricingPage } from './pages/PricingPage';
import { ContentDetailPage } from './pages/ContentDetailPage';
import { CreatorDetailPage } from './pages/CreatorDetailPage';
import { AuthPage } from './pages/AuthPage';
import { InfoPage } from './pages/InfoPage';
import { ViewerDashboardPage } from './pages/ViewerDashboardPage';
import { CreatorDashboardPage } from './pages/CreatorDashboardPage';
import { AdminDashboardPage } from './pages/AdminDashboardPage';

interface DialogPrompt {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
}

function VyoraShell({
  locale,
  currency,
  onChangeLocale,
  onChangeCurrency,
}: {
  locale: LocaleCode;
  currency: CurrencyCode;
  onChangeLocale: (locale: LocaleCode) => void;
  onChangeCurrency: (currency: CurrencyCode) => void;
}) {
  const { firebaseUser, userProfile } = useAuth();
  const [route, setRoute] = useState<ViewRoute>('home');
  const [previousRoute, setPreviousRoute] = useState<ViewRoute>('home');
  const [postLoginRoute, setPostLoginRoute] = useState<ViewRoute>('viewer-dashboard');
  const [selectedCategory, setSelectedCategory] = useState<ContentCategory | 'All'>('All');
  const [selectedCreatorId, setSelectedCreatorId] = useState<string | null>(null);
  const [selectedContentId, setSelectedContentId] = useState<string>(CATALOG_ITEMS[0].id);
  const [previewItem, setPreviewItem] = useState<ContentItem | null>(null);
  const [checkoutTarget, setCheckoutTarget] = useState<CheckoutTarget | null>(null);
  const [entitlementRefreshKey, setEntitlementRefreshKey] = useState(0);
  const [playerRefreshKey, setPlayerRefreshKey] = useState(0);
  const [dialogPrompt, setDialogPrompt] = useState<DialogPrompt | null>(null);

  const [firestoreVideos, setFirestoreVideos] = useState<ContentItem[]>([]);
  const [firestoreCreators, setFirestoreCreators] = useState<CreatorProfile[]>([]);

  // Sync user's saved locale/currency preference upon profile load
  useEffect(() => {
    if (userProfile) {
      onChangeLocale(userProfile.preferredLocale);
      onChangeCurrency(userProfile.preferredCurrency);
    }
  }, [userProfile?.uid]);

  // Public Firestore catalog & creators subscription
  useEffect(() => {
    const unsubVideos = subscribePublishedVideos(setFirestoreVideos);
    const unsubCreators = subscribePublicCreators(setFirestoreCreators);
    return () => {
      unsubVideos();
      unsubCreators();
    };
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [route, selectedContentId, selectedCreatorId]);

  // Merge live Firestore published videos with showcase catalog (Firestore takes precedence on id match)
  const mergedCatalog = useMemo(() => {
    const map = new Map<string, ContentItem>();
    for (const item of CATALOG_ITEMS) map.set(item.id, item);
    for (const item of firestoreVideos) map.set(item.id, item);
    return Array.from(map.values());
  }, [firestoreVideos]);

  const mergedCreators = useMemo(() => {
    const map = new Map<string, CreatorProfile>();
    for (const c of CREATORS) map.set(c.id, c);
    for (const c of firestoreCreators) {
      if (c.status === 'approved' || c.verified) {
        map.set(c.id, c);
      }
    }
    return Array.from(map.values());
  }, [firestoreCreators]);

  const navigateTo = (nextRoute: ViewRoute) => {
    if (nextRoute !== route) {
      setPreviousRoute(route);
    }
    if (
      (nextRoute === 'login' || nextRoute === 'signup') &&
      route === 'creator-dashboard'
    ) {
      setPostLoginRoute('creator-dashboard');
    } else if (nextRoute === 'login' || nextRoute === 'signup') {
      setPostLoginRoute('viewer-dashboard');
    }
    if (nextRoute === 'explore' && route !== 'explore') {
      setSelectedCreatorId(null);
    }
    setRoute(nextRoute);
  };

  const handleSelectContent = (item: ContentItem) => {
    setPreviousRoute(route);
    setSelectedContentId(item.id);
    setRoute('detail');
  };

  const handleExploreCategory = (category: ContentCategory) => {
    setPreviousRoute(route);
    setSelectedCategory(category);
    setSelectedCreatorId(null);
    setRoute('explore');
  };

  const handleExploreCreator = (creatorId: string) => {
    setPreviousRoute(route);
    setSelectedCreatorId(creatorId);
    setRoute('creator');
  };

  const handleRequestUnlock = (method: 'ppv' | 'credits', item: ContentItem) => {
    const formatted = formatPrice(item.priceUsd, item.priceIdr, currency);
    if (!firebaseUser) {
      setDialogPrompt({
        title:
          locale === 'id'
            ? 'Masuk untuk Membuka Akses'
            : 'Sign In to Unlock 30-Day Access',
        description:
          locale === 'id'
            ? `Masuk ke akun VYORA untuk membuka "${item.title}" (${
                method === 'ppv' ? formatted : `${item.creditCost} Kredit`
              }) dengan PayPal, QRIS, atau Dompet Kredit.`
            : `Sign in to unlock "${item.title}" (${
                method === 'ppv' ? formatted : `${item.creditCost} Credits`
              }) for 30 days via PayPal, Indonesian QRIS, or Credit Wallet.`,
        confirmLabel: locale === 'id' ? 'Masuk Sekarang' : 'Sign In Now',
        onConfirm: () => {
          setDialogPrompt(null);
          navigateTo('login');
        },
      });
      return;
    }

    const initialMethod: PaymentGateway =
      method === 'credits' ? 'credits' : currency === 'IDR' ? 'qris' : 'paypal';
    setCheckoutTarget({
      kind: 'video',
      item,
      initialMethod,
      resumeSeconds: 0,
    });
  };

  const handleSelectPackage = (pkg: CreditPackage) => {
    setCheckoutTarget({
      kind: 'credit_package',
      pkg,
      initialMethod: currency === 'IDR' ? 'qris' : 'paypal',
    });
  };

  const handleReportContent = (item: ContentItem) => {
    if (!firebaseUser) {
      navigateTo('login');
      return;
    }
    setDialogPrompt({
      title: locale === 'id' ? 'Laporkan Tayangan Ini?' : 'Report This Release?',
      description:
        locale === 'id'
          ? `Kirim laporan moderasi untuk "${item.title}" ke tim Admin VYORA?`
          : `Submit a moderation report for "${item.title}" to the VYORA Admin review queue?`,
      confirmLabel: locale === 'id' ? 'Kirim Laporan' : 'Submit Report',
      onConfirm: () => {
        setDialogPrompt(null);
        void submitReport(
          firebaseUser.uid,
          'video',
          item.id,
          `Viewer requested moderation review for "${item.title}".`
        );
      },
    });
  };

  const handleOpenSocialNotice = (platformName: string) => {
    setDialogPrompt({
      title: `VYORA on ${platformName}`,
      description:
        locale === 'id'
          ? `Kanal resmi VYORA di ${platformName} (@vyorastreaming) menampilkan cuplikan festival, sorotan kreator Indonesia & internasional, serta jadwal rilisan perdana.`
          : `Follow @vyorastreaming on ${platformName} for festival premieres, Indonesian and international creator spotlights, and behind-the-scenes dispatches.`,
      confirmLabel: locale === 'id' ? 'Tutup' : 'Close',
      onConfirm: () => setDialogPrompt(null),
    });
  };

  const activeContent = useMemo(
    () => mergedCatalog.find((item) => item.id === selectedContentId) ?? mergedCatalog[0],
    [mergedCatalog, selectedContentId]
  );

  const activeCreator = useMemo(
    () => mergedCreators.find((creator) => creator.id === activeContent.creatorId),
    [mergedCreators, activeContent]
  );

  const relatedItems = useMemo(
    () =>
      mergedCatalog
        .filter(
          (item) =>
            item.id !== activeContent.id &&
            (item.category === activeContent.category ||
              item.creatorId === activeContent.creatorId)
        )
        .slice(0, 4),
    [mergedCatalog, activeContent]
  );

  const contentReviews = useMemo(
    () => SAMPLE_REVIEWS.filter((rev) => rev.contentId === activeContent.id),
    [activeContent]
  );

  const detailCreatorProfile = useMemo(
    () => mergedCreators.find((c) => c.id === selectedCreatorId) ?? mergedCreators[0],
    [mergedCreators, selectedCreatorId]
  );

  const creatorWorks = useMemo(
    () => mergedCatalog.filter((item) => item.creatorId === detailCreatorProfile.id),
    [mergedCatalog, detailCreatorProfile]
  );

  return (
    <div className="min-h-screen flex flex-col bg-[#11121A] text-[#F5F5F7] overflow-x-clip">
      <Navbar
        activeRoute={route}
        locale={locale}
        currency={currency}
        onChangeLocale={onChangeLocale}
        onChangeCurrency={onChangeCurrency}
        onNavigate={navigateTo}
      />

      <main className="flex-1">
        {route === 'home' && (
          <HomePage
            catalog={mergedCatalog}
            creators={mergedCreators}
            locale={locale}
            currency={currency}
            onWatchPreview={setPreviewItem}
            onSelectContent={handleSelectContent}
            onExploreCategory={handleExploreCategory}
            onExploreCreator={handleExploreCreator}
            onNavigate={navigateTo}
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
            onChangeCategory={setSelectedCategory}
            onClearCreator={() => setSelectedCreatorId(null)}
            onSelectContent={handleSelectContent}
            onWatchPreview={setPreviewItem}
            onSelectCreator={handleExploreCreator}
          />
        )}

        {route === 'categories' && (
          <CategoriesPage
            catalog={mergedCatalog}
            locale={locale}
            currency={currency}
            onExploreCategory={handleExploreCategory}
            onSelectContent={handleSelectContent}
            onWatchPreview={setPreviewItem}
            onSelectCreator={handleExploreCreator}
          />
        )}

        {route === 'search' && (
          <SearchPage
            catalog={mergedCatalog}
            creators={mergedCreators}
            locale={locale}
            currency={currency}
            onSelectContent={handleSelectContent}
            onWatchPreview={setPreviewItem}
            onSelectCreator={handleExploreCreator}
          />
        )}

        {route === 'pricing' && (
          <PricingPage
            packages={CREDIT_PACKAGES}
            locale={locale}
            currency={currency}
            onChangeCurrency={onChangeCurrency}
            onSelectPackage={handleSelectPackage}
            onNavigate={navigateTo}
          />
        )}

        {route === 'detail' && (
          <ContentDetailPage
            item={activeContent}
            creator={activeCreator}
            relatedItems={relatedItems}
            reviews={contentReviews}
            locale={locale}
            currency={currency}
            entitlementRefreshKey={entitlementRefreshKey}
            onBack={() =>
              navigateTo(previousRoute === 'detail' ? 'explore' : previousRoute)
            }
            onWatchPreview={setPreviewItem}
            onSelectContent={handleSelectContent}
            onExploreCreator={handleExploreCreator}
            onRequestUnlock={handleRequestUnlock}
            onReportContent={handleReportContent}
          />
        )}

        {route === 'creator' && (
          <CreatorDetailPage
            creator={detailCreatorProfile}
            works={creatorWorks}
            locale={locale}
            currency={currency}
            onBack={() =>
              navigateTo(previousRoute === 'creator' ? 'home' : previousRoute)
            }
            onSelectContent={handleSelectContent}
            onWatchPreview={setPreviewItem}
          />
        )}

        {(route === 'login' || route === 'signup') && (
          <AuthPage
            mode={route}
            locale={locale}
            currency={currency}
            postLoginRoute={postLoginRoute}
            onSwitchMode={(nextMode) => navigateTo(nextMode)}
            onNavigate={navigateTo}
          />
        )}

        {route === 'viewer-dashboard' && (
          <ViewerDashboardPage
            catalog={mergedCatalog}
            locale={locale}
            currency={currency}
            entitlementRefreshKey={entitlementRefreshKey}
            onChangeLocale={onChangeLocale}
            onChangeCurrency={onChangeCurrency}
            onNavigate={navigateTo}
            onWatchContent={setPreviewItem}
          />
        )}

        {route === 'creator-dashboard' && (
          <CreatorDashboardPage
            locale={locale}
            currency={currency}
            onNavigate={navigateTo}
          />
        )}

        {route === 'admin-dashboard' && (
          <AdminDashboardPage locale={locale} onNavigate={navigateTo} />
        )}

        {(route === 'about' ||
          route === 'contact' ||
          route === 'terms' ||
          route === 'privacy' ||
          route === 'guidelines') && (
          <InfoPage
            section={route}
            locale={locale}
            onBack={() => navigateTo('home')}
            onNavigate={navigateTo}
          />
        )}
      </main>

      <Footer
        locale={locale}
        currency={currency}
        onChangeLocale={onChangeLocale}
        onChangeCurrency={onChangeCurrency}
        onNavigate={navigateTo}
        onOpenSocialNotice={handleOpenSocialNotice}
      />

      <StreamingPlayerModal
        item={previewItem}
        locale={locale}
        currency={currency}
        authRefreshKey={playerRefreshKey}
        onClose={() => {
          setPreviewItem(null);
          setEntitlementRefreshKey((k) => k + 1);
        }}
        onViewDetails={handleSelectContent}
        onRequireSignIn={() => navigateTo('login')}
        onRequestCheckout={(videoItem, method, resumeSeconds) => {
          if (!firebaseUser) {
            setPreviewItem(null);
            navigateTo('login');
            return;
          }
          setCheckoutTarget({
            kind: 'video',
            item: videoItem,
            initialMethod: method,
            resumeSeconds,
          });
        }}
      />

      <CheckoutModal
        target={checkoutTarget}
        locale={locale}
        currency={currency}
        onClose={() => setCheckoutTarget(null)}
        onRequireSignIn={() => navigateTo('login')}
        onPaymentCompleted={() => {
          setEntitlementRefreshKey((k) => k + 1);
          setPlayerRefreshKey((k) => k + 1);
        }}
        onWatchVideo={(videoItem) => {
          setPreviewItem(videoItem);
        }}
        onOpenTopUpPackages={() => navigateTo('pricing')}
      />

      <ConfirmDialog
        isOpen={Boolean(dialogPrompt)}
        title={dialogPrompt?.title ?? ''}
        description={dialogPrompt?.description ?? ''}
        confirmLabel={dialogPrompt?.confirmLabel}
        cancelLabel={locale === 'id' ? 'Batal' : 'Cancel'}
        onConfirm={() => dialogPrompt?.onConfirm()}
        onCancel={() => setDialogPrompt(null)}
      />

      <MobileBottomNav
        activeRoute={route}
        locale={locale}
        onNavigate={navigateTo}
      />
    </div>
  );
}

export function App() {
  const [locale, setLocale] = useState<LocaleCode>('en');
  const [currency, setCurrency] = useState<CurrencyCode>('USD');

  const handleChangeLocale = (nextLocale: LocaleCode) => {
    setLocale(nextLocale);
    setCurrency(nextLocale === 'id' ? 'IDR' : 'USD');
  };

  return (
    <ErrorBoundary>
      <AuthProvider defaultLocale={locale} defaultCurrency={currency}>
        <VyoraShell
          locale={locale}
          currency={currency}
          onChangeLocale={handleChangeLocale}
          onChangeCurrency={setCurrency}
        />
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;
