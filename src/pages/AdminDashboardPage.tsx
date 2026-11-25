import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  CreditCard,
  Film,
  Flag,
  Settings,
  Shield,
  Users,
  Video,
  Wallet,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  adminModerateCreator,
  adminModerateVideo,
  adminResolveReport,
  adminSavePlatformSettings,
  adminUpdateUserRole,
  subscribeAdminVideos,
  subscribeAllReports,
  subscribeAllUsers,
  subscribePlatformSettings,
  subscribePublicCreators,
} from '../services/firestoreService';
import {
  adminApprovePayment,
  adminRefundPayment,
  adminUpdatePayoutStatus,
  fetchAdminFinanceOverview,
  syncAdminPlatformSettings,
} from '../services/paymentService';
import {
  formatLocalizedDate,
  formatPrice,
  formatReleasePrice,
  isFreeContent,
} from '../i18n/translations';
import type {
  AdminFinanceOverview,
  ContentItem,
  CreatorProfile,
  LocaleCode,
  PlatformSettingRecord,
  ReportRecord,
  UserProfile,
  UserRole,
  ViewRoute,
} from '../types/vyora';
import { Button } from '../components/ui/Button';
import {
  DashboardSkeleton,
  ListRowSkeleton,
} from '../components/ui/Skeleton';
import { EmptyState, ErrorState } from '../components/ui/StateViews';

interface AdminDashboardPageProps {
  locale: LocaleCode;
  onNavigate: (route: ViewRoute) => void;
}

type AdminTab =
  | 'overview'
  | 'moderation'
  | 'transactions'
  | 'payouts'
  | 'creators'
  | 'users'
  | 'reports'
  | 'settings';

export const AdminDashboardPage: React.FC<AdminDashboardPageProps> = ({
  locale,
  onNavigate,
}) => {
  const { firebaseUser, isAdmin, authReady } = useAuth();
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [creators, setCreators] = useState<CreatorProfile[]>([]);
  const [videos, setVideos] = useState<ContentItem[]>([]);
  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [settings, setSettings] = useState<PlatformSettingRecord | null>(null);

  const [moderationNotes, setModerationNotes] = useState<Record<string, string>>({});
  const [commissionPercent, setCommissionPercent] = useState(20);
  const [minPriceUsd, setMinPriceUsd] = useState(1.99);
  const [minPriceIdr, setMinPriceIdr] = useState(29000);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const [financeOverview, setFinanceOverview] = useState<AdminFinanceOverview | null>(
    null
  );
  const [loadingFinance, setLoadingFinance] = useState(false);
  const [financeError, setFinanceError] = useState<string | null>(null);
  const [financeRetryTick, setFinanceRetryTick] = useState(0);
  const [confirmRefundId, setConfirmRefundId] = useState<string | null>(null);
  const [processingActionId, setProcessingActionId] = useState<string | null>(null);
  const [payoutNotes, setPayoutNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!authReady || !firebaseUser || !isAdmin) return;
    const u1 = subscribeAllUsers(setUsers);
    const u2 = subscribePublicCreators(setCreators);
    const u3 = subscribeAdminVideos(setVideos);
    const u4 = subscribeAllReports(setReports);
    const u5 = subscribePlatformSettings((s) => {
      setSettings(s);
      if (s) {
        setCommissionPercent(s.commissionPercent);
        setMinPriceUsd(s.minPriceUsd);
        setMinPriceIdr(s.minPriceIdr);
      }
    });
    let cancelled = false;
    setLoadingFinance(true);
    setFinanceError(null);
    void fetchAdminFinanceOverview()
      .then((res) => {
        if (!cancelled) setFinanceOverview(res);
      })
      .catch((err) => {
        if (!cancelled) {
          setFinanceError(err instanceof Error ? err.message : 'Unable to load finance ledger.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingFinance(false);
      });
    return () => {
      cancelled = true;
      u1();
      u2();
      u3();
      u4();
      u5();
    };
  }, [authReady, firebaseUser, isAdmin, financeRetryTick]);

  if (!authReady) {
    return <DashboardSkeleton />;
  }

  if (!firebaseUser) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <EmptyState
          title="Admin Sign In Required"
          description="Sign in with an authorized administrator account to access the DELOKEN Admin Console."
          actionLabel="Go to Login"
          onAction={() => onNavigate('login')}
        />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <ErrorState
          title="Administrator Access Restricted"
          description="Your account does not hold Admin privileges. Permissions are enforced server-side via Firestore security rules."
          retryLabel="Return Home"
          onRetry={() => onNavigate('home')}
        />
      </div>
    );
  }

  const pendingVideos = videos.filter((v) => v.status === 'pending_review');
  const openReports = reports.filter((r) => r.status === 'open');
  const pendingPayouts = (financeOverview?.payouts ?? []).filter(
    (p) => p.status === 'requested' || p.status === 'processing'
  );

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    setSettingsSaved(false);
    setSettingsError(null);
    try {
      await adminSavePlatformSettings({
        commissionPercent,
        minPriceUsd,
        minPriceIdr,
      });
      await syncAdminPlatformSettings({
        commissionPercent,
        minPriceUsd,
        minPriceIdr,
      });
      const updatedFinance = await fetchAdminFinanceOverview();
      setFinanceOverview(updatedFinance);
      setSettingsSaved(true);
    } catch (err) {
      setSettingsError(
        err instanceof Error ? err.message : 'Unable to save platform settings.'
      );
    } finally {
      setSavingSettings(false);
    }
  };

  const handleIssueRefund = async (paymentId: string) => {
    setFinanceError(null);
    setProcessingActionId(paymentId);
    try {
      const res = await adminRefundPayment(paymentId, crypto.randomUUID());
      setFinanceOverview(res.overview);
      setConfirmRefundId(null);
    } catch (err) {
      setFinanceError(err instanceof Error ? err.message : 'Refund failed.');
    } finally {
      setProcessingActionId(null);
    }
  };

  const handleApprovePendingPayment = async (paymentId: string) => {
    setFinanceError(null);
    setProcessingActionId(paymentId);
    try {
      const res = await adminApprovePayment(paymentId, crypto.randomUUID());
      setFinanceOverview(res.overview);
    } catch (err) {
      setFinanceError(
        err instanceof Error
          ? err.message
          : locale === 'id'
          ? 'Gagal mengonfirmasi pembayaran tertunda.'
          : 'Failed to approve pending payment.'
      );
    } finally {
      setProcessingActionId(null);
    }
  };

  const handlePayoutDecision = async (
    payoutId: string,
    status: 'processing' | 'paid' | 'rejected'
  ) => {
    setFinanceError(null);
    setProcessingActionId(payoutId);
    try {
      const res = await adminUpdatePayoutStatus(
        payoutId,
        status,
        payoutNotes[payoutId] || ''
      );
      setFinanceOverview(res.overview);
    } catch (err) {
      setFinanceError(err instanceof Error ? err.message : 'Failed to update payout.');
    } finally {
      setProcessingActionId(null);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10 space-y-6 sm:space-y-8">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 sm:pb-6 border-b border-slate-200 dark:border-slate-800">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
            <Shield className="w-4 h-4" aria-hidden="true" />
            <span>DELOKEN Admin Console</span>
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">
            {locale === 'id' ? 'Manajemen & Moderasi Platform' : 'Platform Operations & Moderation'}
          </h1>
        </div>
      </header>

      {/* Tabs */}
      <div
        role="tablist"
        aria-label="Admin dashboard sections"
        className="flex items-center gap-2 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0 deloken-scroll"
      >
        {[
          { id: 'overview' as AdminTab, label: locale === 'id' ? 'Ringkasan' : 'Overview', icon: <Shield className="w-4 h-4" /> },
          { id: 'moderation' as AdminTab, label: `${locale === 'id' ? 'Moderasi Konten' : 'Content Moderation'} (${pendingVideos.length})`, icon: <Video className="w-4 h-4" /> },
          { id: 'transactions' as AdminTab, label: `${locale === 'id' ? 'Transaksi & Refund' : 'Transactions'} (${financeOverview?.payments.length ?? 0})`, icon: <CreditCard className="w-4 h-4" /> },
          { id: 'payouts' as AdminTab, label: `${locale === 'id' ? 'Payout Kreator' : 'Creator Payouts'} (${pendingPayouts.length})`, icon: <Wallet className="w-4 h-4" /> },
          { id: 'creators' as AdminTab, label: `${locale === 'id' ? 'Kreator' : 'Creators'} (${creators.length})`, icon: <Film className="w-4 h-4" /> },
          { id: 'users' as AdminTab, label: `${locale === 'id' ? 'Pengguna' : 'Users'} (${users.length})`, icon: <Users className="w-4 h-4" /> },
          { id: 'reports' as AdminTab, label: `${locale === 'id' ? 'Laporan' : 'Reports'} (${openReports.length})`, icon: <Flag className="w-4 h-4" /> },
          { id: 'settings' as AdminTab, label: locale === 'id' ? 'Pengaturan Platform' : 'Platform Settings', icon: <Settings className="w-4 h-4" /> },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`min-h-[44px] sm:min-h-[40px] inline-flex items-center gap-2 px-4 py-2 rounded-xl sm:rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
              activeTab === tab.id
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-slate-800'
            }`}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* OVERVIEW */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 shadow-xs">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {locale === 'id' ? 'Total Pengguna' : 'Total Users'}
              </p>
              <p className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1">
                {users.length}
              </p>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 shadow-xs">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {locale === 'id' ? 'Kreator' : 'Creators'}
              </p>
              <p className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1">
                {creators.length}
              </p>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 shadow-xs">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {locale === 'id' ? 'Menunggu Moderasi' : 'Pending Moderation'}
              </p>
              <p className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400 mt-1">
                {pendingVideos.length}
              </p>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 shadow-xs">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {locale === 'id' ? 'Akses Aktif (30 Hari)' : 'Active Entitlements'}
              </p>
              <p className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1">
                {financeOverview?.activeEntitlementsCount ?? 0}
              </p>
            </div>
            <div className="col-span-2 lg:col-span-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 shadow-xs">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {locale === 'id' ? 'Komisi Platform' : 'Platform Commission'}
              </p>
              <p className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1">
                {financeOverview?.commissionPercent ??
                  settings?.commissionPercent ??
                  commissionPercent}
                %
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {locale === 'id' ? 'Total Volume USD' : 'Gross USD Volume'}
              </p>
              <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1">
                {formatPrice(financeOverview?.totalGrossUsd ?? 0, 0, 'USD')}
              </p>
              <p className="text-xs font-mono text-emerald-700 dark:text-emerald-400 mt-1">
                {locale === 'id' ? 'Biaya platform: ' : 'Platform fee: '}
                {formatPrice(financeOverview?.platformCommissionUsd ?? 0, 0, 'USD')}
              </p>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {locale === 'id' ? 'Total Volume IDR' : 'Gross IDR Volume'}
              </p>
              <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1">
                {formatPrice(0, financeOverview?.totalGrossIdr ?? 0, 'IDR')}
              </p>
              <p className="text-xs font-mono text-emerald-700 dark:text-emerald-400 mt-1">
                {locale === 'id' ? 'Biaya platform: ' : 'Platform fee: '}
                {formatPrice(0, financeOverview?.platformCommissionIdr ?? 0, 'IDR')}
              </p>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {locale === 'id' ? 'Laporan Terbuka & Payout Tertunda' : 'Open Reports & Pending Payouts'}
              </p>
              <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1">
                {openReports.length} / {pendingPayouts.length}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* TRANSACTIONS & REFUNDS */}
      {activeTab === 'transactions' && (
        <section className="space-y-4">
          {financeError && (
            <ErrorState
              title={locale === 'id' ? 'Gagal Memuat Transaksi Pembayaran' : 'Unable to Load Payment Transactions'}
              description={financeError}
              retryLabel={locale === 'id' ? 'Coba Lagi' : 'Retry'}
              onRetry={() => setFinanceRetryTick((t) => t + 1)}
            />
          )}

          {loadingFinance && !financeOverview ? (
            <div className="space-y-3">
              <ListRowSkeleton />
              <ListRowSkeleton />
            </div>
          ) : !financeOverview || financeOverview.payments.length === 0 ? (
            <EmptyState
              title={locale === 'id' ? 'Belum ada transaksi pembayaran' : 'No payment transactions recorded yet'}
              description={
                locale === 'id'
                  ? 'Pesanan PayPal, QRIS Indonesia, dan Dompet Kredit akan muncul di sini beserta kontrol aktivasi dan refund server.'
                  : 'PayPal, Indonesian QRIS, and Credit Wallet orders will appear here with server approval and refund controls.'
              }
            />
          ) : (
            <div className="space-y-3">
              {financeOverview.payments.map((pay) => {
                const statusBadgeClass =
                  pay.status === 'completed'
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : pay.status === 'pending'
                    ? 'text-amber-700 dark:text-amber-400'
                    : 'text-rose-700 dark:text-rose-400';

                return (
                  <article
                    key={pay.id}
                    className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400 font-mono">
                        <span className={`${statusBadgeClass} font-semibold uppercase`}>
                          {pay.method} · {pay.status}
                        </span>
                        {pay.gatewayMode === 'payment_link' && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold">
                              PAYPAL LINK
                            </span>
                          </>
                        )}
                        <span aria-hidden="true">·</span>
                        <span>{pay.purpose}</span>
                        <span aria-hidden="true">·</span>
                        <span>{formatLocalizedDate(pay.createdAt, locale)}</span>
                      </div>
                      <h3 className="text-base font-semibold text-slate-900 dark:text-white break-words">
                        {pay.targetTitle}
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 font-mono break-all">
                        {locale === 'id' ? 'Pengguna' : 'User'}: {pay.userEmail || pay.userId} · Ref: {pay.id}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 shrink-0">
                      <span className="text-sm font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                        {pay.currency === 'CREDITS'
                          ? `${pay.amount} Credits`
                          : formatPrice(pay.amount, pay.amount, pay.currency)}
                      </span>

                      {pay.status === 'pending' && (
                        <Button
                          variant="primary"
                          size="sm"
                          isLoading={processingActionId === pay.id}
                          onClick={() => void handleApprovePendingPayment(pay.id)}
                        >
                          {locale === 'id' ? 'Konfirmasi & Aktifkan' : 'Approve & Activate'}
                        </Button>
                      )}

                      {pay.status === 'completed' && (
                        confirmRefundId === pay.id ? (
                          <div className="flex items-center gap-2">
                            <Button
                              variant="primary"
                              size="sm"
                              className="bg-rose-600 hover:bg-rose-700 text-white"
                              isLoading={processingActionId === pay.id}
                              onClick={() => void handleIssueRefund(pay.id)}
                            >
                              {locale === 'id' ? 'Konfirmasi Refund' : 'Confirm Refund'}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setConfirmRefundId(null)}
                            >
                              {locale === 'id' ? 'Batal' : 'Cancel'}
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setConfirmRefundId(pay.id)}
                          >
                            {locale === 'id' ? 'Refund & Cabut Akses' : 'Refund & Revoke'}
                          </Button>
                        )
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* CREATOR PAYOUTS */}
      {activeTab === 'payouts' && (
        <section className="space-y-4">
          {financeError && (
            <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800/70 text-xs text-rose-700 dark:text-rose-300">
              {financeError}
            </div>
          )}

          {!financeOverview || financeOverview.payouts.length === 0 ? (
            <EmptyState
              title="No creator payout requests yet"
              description="Creator withdrawal requests will appear here for Admin verification and settlement."
            />
          ) : (
            <div className="space-y-3">
              {financeOverview.payouts.map((po) => (
                <article
                  key={po.id}
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 space-y-3 shadow-xs"
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3.5 sm:gap-4">
                    <div className="space-y-1 min-w-0">
                      <p className="text-xs font-mono text-emerald-700 dark:text-emerald-400 font-semibold uppercase">
                        {po.status} · {po.method}
                      </p>
                      <h3 className="text-base font-semibold text-slate-900 dark:text-white break-words">
                        {po.creatorName} —{' '}
                        {po.currency === 'USD'
                          ? formatPrice(po.amountUsd, 0, 'USD')
                          : formatPrice(0, po.amountIdr, 'IDR')}
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 font-mono break-all">
                        Destination: {po.destination} · Requested{' '}
                        {formatLocalizedDate(po.createdAt, locale)}
                      </p>
                    </div>

                    {(po.status === 'requested' || po.status === 'processing') && (
                      <div className="flex flex-wrap items-center gap-2 shrink-0 w-full md:w-auto">
                        {po.status === 'requested' && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1 sm:flex-none"
                            isLoading={processingActionId === po.id}
                            onClick={() => void handlePayoutDecision(po.id, 'processing')}
                          >
                            Mark Processing
                          </Button>
                        )}
                        <Button
                          variant="primary"
                          size="sm"
                          className="flex-1 sm:flex-none"
                          isLoading={processingActionId === po.id}
                          onClick={() => void handlePayoutDecision(po.id, 'paid')}
                        >
                          Mark Paid
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 sm:flex-none"
                          isLoading={processingActionId === po.id}
                          onClick={() => void handlePayoutDecision(po.id, 'rejected')}
                        >
                          Reject
                        </Button>
                      </div>
                    )}
                  </div>

                  <input
                    type="text"
                    value={payoutNotes[po.id] ?? po.adminNote ?? ''}
                    onChange={(e) =>
                      setPayoutNotes((prev) => ({ ...prev, [po.id]: e.target.value }))
                    }
                    placeholder="Optional payout transfer reference or admin note..."
                    className="w-full min-h-[42px] sm:min-h-[38px] px-3.5 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                  />
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {/* CONTENT MODERATION */}
      {activeTab === 'moderation' && (
        <section className="space-y-4">
          {videos.length === 0 ? (
            <EmptyState
              title="No submitted videos in Firestore"
              description="Creator video submissions will appear here for approval, rejection, or publishing."
            />
          ) : (
            videos.map((vid) => (
              <article
                key={vid.id}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 space-y-3.5 sm:space-y-4 shadow-xs"
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3.5 sm:gap-4">
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span className="text-emerald-700 dark:text-emerald-400 font-semibold uppercase">
                        {vid.status.replace('_', ' ')}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{vid.category}</span>
                      <span aria-hidden="true">·</span>
                      <span>By {vid.creatorName}</span>
                      <span aria-hidden="true">·</span>
                      <span
                        className={`font-mono tabular-nums ${
                          isFreeContent(vid)
                            ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                            : ''
                        }`}
                      >
                        {formatReleasePrice(vid, locale, locale === 'id' ? 'IDR' : 'USD')}
                      </span>
                    </div>
                    <h3 className="text-base sm:text-lg font-semibold text-slate-900 dark:text-white break-words">
                      {vid.title}
                    </h3>
                    <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-2">{vid.subtitle}</p>
                  </div>

                  <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 w-full md:w-auto shrink-0">
                    {vid.status === 'pending_review' && (
                      <>
                        <Button
                          variant="primary"
                          size="sm"
                          className="col-span-2 sm:col-span-1"
                          onClick={async () => {
                            const note = moderationNotes[vid.id] || 'Approved & published';
                            await adminModerateVideo(vid.id, 'approved', note);
                            await adminModerateVideo(vid.id, 'published', note);
                          }}
                        >
                          {locale === 'id' ? 'Setujui & Tayangkan' : 'Approve & Publish'}
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            void adminModerateVideo(
                              vid.id,
                              'approved',
                              moderationNotes[vid.id] || 'Approved for release'
                            )
                          }
                        >
                          {locale === 'id' ? 'Setujui Saja' : 'Approve'}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            void adminModerateVideo(
                              vid.id,
                              'rejected',
                              moderationNotes[vid.id] || 'Needs metadata or asset adjustment'
                            )
                          }
                        >
                          {locale === 'id' ? 'Tolak' : 'Reject'}
                        </Button>
                      </>
                    )}
                    {vid.status === 'approved' && (
                      <Button
                        variant="primary"
                        size="sm"
                        className="col-span-2 sm:col-span-1"
                        onClick={() =>
                          void adminModerateVideo(
                            vid.id,
                            'published',
                            moderationNotes[vid.id] || 'Published'
                          )
                        }
                      >
                        {locale === 'id' ? 'Tayangkan Sekarang' : 'Publish Now'}
                      </Button>
                    )}
                    {(vid.status === 'published' || vid.status === 'approved') && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          void adminModerateVideo(
                            vid.id,
                            'archived',
                            moderationNotes[vid.id] || 'Archived by Admin'
                          )
                        }
                      >
                        {locale === 'id' ? 'Arsipkan' : 'Archive'}
                      </Button>
                    )}
                  </div>
                </div>

                <input
                  type="text"
                  value={moderationNotes[vid.id] ?? vid.moderationNote ?? ''}
                  onChange={(e) =>
                    setModerationNotes((prev) => ({
                      ...prev,
                      [vid.id]: e.target.value,
                    }))
                  }
                  placeholder={
                    locale === 'id'
                      ? 'Catatan moderasi opsional untuk kreator...'
                      : 'Optional moderation note for the creator...'
                  }
                  className="w-full min-h-[42px] sm:min-h-[40px] px-3.5 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                />
              </article>
            ))
          )}
        </section>
      )}

      {/* CREATOR MANAGEMENT */}
      {activeTab === 'creators' && (
        <section className="space-y-3">
          {creators.length === 0 ? (
            <EmptyState
              title="No creator applications yet"
              description="Users who register for Creator Studio will appear here for verification."
            />
          ) : (
            creators.map((c) => (
              <div
                key={c.id}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 sm:gap-4"
              >
                <div className="min-w-0">
                  <h3 className="text-base font-semibold text-slate-900 dark:text-white break-words">
                    {c.name}{' '}
                    <span className="text-xs font-mono text-slate-500 dark:text-slate-400">{c.handle}</span>
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {c.role} · {c.location} · Status: {c.status ?? 'pending'} ·{' '}
                    {c.verified ? 'Verified' : 'Unverified'}
                  </p>
                </div>
                <div className="grid grid-cols-2 sm:flex items-center gap-2 w-full sm:w-auto shrink-0">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => void adminModerateCreator(c.id, 'approved', true)}
                  >
                    {locale === 'id' ? 'Setujui & Verifikasi' : 'Approve & Verify'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void adminModerateCreator(c.id, 'suspended', false)}
                  >
                    {locale === 'id' ? 'Tangguhkan' : 'Suspend'}
                  </Button>
                </div>
              </div>
            ))
          )}
        </section>
      )}

      {/* USER MANAGEMENT */}
      {activeTab === 'users' && (
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden divide-y divide-slate-200 dark:divide-slate-800 shadow-xs">
          {users.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">No users loaded yet.</div>
          ) : (
            users.map((u) => (
              <div
                key={u.uid}
                className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{u.displayName}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 break-all">
                    {u.email} · {u.preferredLocale.toUpperCase()} / {u.preferredCurrency}
                  </p>
                </div>
                <select
                  value={u.role}
                  aria-label={`Role for ${u.displayName}`}
                  onChange={(e) =>
                    void adminUpdateUserRole(u.uid, e.target.value as UserRole)
                  }
                  className="w-full sm:w-auto min-h-[44px] sm:min-h-[40px] px-3 py-2 rounded-xl sm:rounded-lg bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-900 dark:text-slate-100"
                >
                  <option value="viewer">Viewer</option>
                  <option value="creator">Creator</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            ))
          )}
        </section>
      )}

      {/* REPORTS */}
      {activeTab === 'reports' && (
        <section className="space-y-3">
          {reports.length === 0 ? (
            <EmptyState
              title="No reports filed"
              description="Viewer reports on content or creator profiles will appear here."
            />
          ) : (
            reports.map((r) => (
              <div
                key={r.id}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 sm:gap-4"
              >
                <div className="min-w-0">
                  <p className="text-xs text-emerald-700 dark:text-emerald-400 font-semibold uppercase">
                    {r.targetType} · {r.status}
                  </p>
                  <p className="text-sm font-medium text-slate-900 dark:text-white mt-1 break-words">{r.reason}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-0.5 break-all">
                    Target ID: {r.targetId}
                  </p>
                </div>
                {r.status === 'open' && (
                  <div className="grid grid-cols-2 sm:flex items-center gap-2 w-full sm:w-auto shrink-0">
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => void adminResolveReport(r.id, 'resolved')}
                    >
                      Resolve
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void adminResolveReport(r.id, 'dismissed')}
                    >
                      Dismiss
                    </Button>
                  </div>
                )}
              </div>
            ))
          )}
        </section>
      )}

      {/* PLATFORM SETTINGS */}
      {activeTab === 'settings' && (
        <section className="max-w-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 sm:p-8 space-y-5 shadow-xs">
          <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">
            Platform Economics & Streaming Rules
          </h2>

          {settingsError && (
            <div
              role="alert"
              className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800/70 text-xs text-rose-700 dark:text-rose-300"
            >
              {settingsError}
            </div>
          )}

          {settingsSaved && (
            <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/70 text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>Platform settings saved to Firestore & Cloud SQL.</span>
            </div>
          )}

          <form onSubmit={handleSaveSettings} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                Platform Commission (%)
              </label>
              <input
                type="number"
                min={0}
                max={50}
                value={commissionPercent}
                onChange={(e) => setCommissionPercent(Number(e.target.value))}
                className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-sm font-mono tabular-nums text-slate-900 dark:text-slate-100"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                  Minimum Price (USD)
                </label>
                <input
                  type="number"
                  step="0.50"
                  min={0.99}
                  value={minPriceUsd}
                  onChange={(e) => setMinPriceUsd(Number(e.target.value))}
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-sm font-mono tabular-nums text-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                  Minimum Price (IDR)
                </label>
                <input
                  type="number"
                  step="1000"
                  min={10000}
                  value={minPriceIdr}
                  onChange={(e) => setMinPriceIdr(Number(e.target.value))}
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-sm font-mono tabular-nums text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
              Fixed invariants: Free Preview = 300s (5 min) · Entitlement Window = 30 days
            </p>

            <Button type="submit" variant="primary" size="md" className="w-full sm:w-auto" isLoading={savingSettings}>
              {locale === 'id' ? 'Simpan Pengaturan Platform' : 'Save Platform Settings'}
            </Button>
          </form>
        </section>
      )}
    </div>
  );
};
