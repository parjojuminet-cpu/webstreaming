import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  CreditCard,
  Film,
  Flag,
  RefreshCw,
  RotateCcw,
  Settings,
  Shield,
  Trash2,
  Users,
  Video,
  Wallet,
  X,
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
  AdminVideoApiError,
  adminArchiveVideoApi,
  adminDeleteVideoPermanentlyApi,
  adminRestoreVideoApi,
  fetchAdminVideoAssetInfo,
  fetchAdminVideoDeletionJobs,
} from '../services/adminVideoService';
import {
  formatLocalizedDate,
  formatPrice,
  formatReleasePrice,
  isFreeContent,
} from '../i18n/translations';
import type {
  AdminFinanceOverview,
  AdminVideoAssetInfo,
  ContentItem,
  ContentStatus,
  CreatorProfile,
  LocaleCode,
  PlatformSettingRecord,
  ReportRecord,
  UserProfile,
  UserRole,
  VideoDeletionJobRecord,
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

  type ModerationFilter = 'all' | 'pending_review' | 'published' | 'archived' | 'other';
  const [moderationFilter, setModerationFilter] = useState<ModerationFilter>('all');
  const [videoActionFeedback, setVideoActionFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [deletionJobs, setDeletionJobs] = useState<VideoDeletionJobRecord[]>([]);
  const [loadingDeletionJobs, setLoadingDeletionJobs] = useState(false);

  const [restoreTargetModal, setRestoreTargetModal] = useState<{
    video: ContentItem;
    selectedStatus: Exclude<ContentStatus, 'archived' | 'deletion_pending'>;
    error: string | null;
    submitting: boolean;
  } | null>(null);

  const [deleteModal, setDeleteModal] = useState<{
    videoId: string;
    fallbackTitle: string;
    loadingInfo: boolean;
    assetInfo: AdminVideoAssetInfo | null;
    latestJob: VideoDeletionJobRecord | null;
    confirmationInput: string;
    submitting: boolean;
    error: string | null;
  } | null>(null);

  const refreshDeletionJobs = async () => {
    setLoadingDeletionJobs(true);
    try {
      const jobs = await fetchAdminVideoDeletionJobs();
      setDeletionJobs(jobs);
    } catch {
      // Non-fatal if deletion audit logs cannot be loaded yet
    } finally {
      setLoadingDeletionJobs(false);
    }
  };

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
    void refreshDeletionJobs();
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

  const handleArchiveVideo = async (vid: ContentItem) => {
    setVideoActionFeedback(null);
    setProcessingActionId(`arch_${vid.id}`);
    try {
      const result = await adminArchiveVideoApi(
        vid.id,
        moderationNotes[vid.id] || 'Archived by Admin'
      );
      setVideoActionFeedback({
        type: 'success',
        message:
          locale === 'id'
            ? `"${vid.title}" diarsipkan (status asal tersimpan: ${result.previousStatus || 'tidak tersedia'}). Akses playback penonton kini diblokir server dan file media tetap aman.`
            : `"${vid.title}" archived (previous status: ${result.previousStatus || 'unknown'}). Viewer playback is now blocked while media files remain intact.`,
      });
    } catch (err) {
      setVideoActionFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Gagal mengarsipkan video.',
      });
    } finally {
      setProcessingActionId(null);
    }
  };

  const handleRestoreVideoClick = async (vid: ContentItem) => {
    setVideoActionFeedback(null);
    if (!vid.previousStatus) {
      setRestoreTargetModal({
        video: vid,
        selectedStatus: 'draft',
        error: null,
        submitting: false,
      });
      return;
    }

    setProcessingActionId(`rest_${vid.id}`);
    try {
      const res = await adminRestoreVideoApi(vid.id, {
        moderationNote: moderationNotes[vid.id],
      });
      setVideoActionFeedback({
        type: 'success',
        message:
          locale === 'id'
            ? `"${vid.title}" dipulihkan ke status "${res.status.replace('_', ' ')}".`
            : `"${vid.title}" restored to "${res.status.replace('_', ' ')}".`,
      });
    } catch (err) {
      if (err instanceof AdminVideoApiError && err.code === 'TARGET_STATUS_REQUIRED') {
        setRestoreTargetModal({
          video: vid,
          selectedStatus: 'draft',
          error: null,
          submitting: false,
        });
      } else {
        setVideoActionFeedback({
          type: 'error',
          message: err instanceof Error ? err.message : 'Gagal memulihkan video.',
        });
      }
    } finally {
      setProcessingActionId(null);
    }
  };

  const handleConfirmExplicitRestore = async () => {
    if (!restoreTargetModal) return;
    setRestoreTargetModal((prev) => (prev ? { ...prev, submitting: true, error: null } : null));
    try {
      const res = await adminRestoreVideoApi(restoreTargetModal.video.id, {
        targetStatus: restoreTargetModal.selectedStatus,
        moderationNote: moderationNotes[restoreTargetModal.video.id],
      });
      setVideoActionFeedback({
        type: 'success',
        message:
          locale === 'id'
            ? `"${restoreTargetModal.video.title}" dipulihkan ke status "${res.status.replace('_', ' ')}".`
            : `"${restoreTargetModal.video.title}" restored to "${res.status.replace('_', ' ')}".`,
      });
      setRestoreTargetModal(null);
    } catch (err) {
      setRestoreTargetModal((prev) =>
        prev
          ? {
              ...prev,
              submitting: false,
              error: err instanceof Error ? err.message : 'Gagal memulihkan video.',
            }
          : null
      );
    }
  };

  const openPermanentDeleteModal = async (videoId: string, fallbackTitle: string) => {
    setVideoActionFeedback(null);
    setDeleteModal({
      videoId,
      fallbackTitle,
      loadingInfo: true,
      assetInfo: null,
      latestJob: null,
      confirmationInput: '',
      submitting: false,
      error: null,
    });
    try {
      const data = await fetchAdminVideoAssetInfo(videoId);
      setDeleteModal((prev) =>
        prev && prev.videoId === videoId
          ? {
              ...prev,
              loadingInfo: false,
              assetInfo: data.assetInfo,
              latestJob: data.latestJob,
            }
          : prev
      );
    } catch (err) {
      setDeleteModal((prev) =>
        prev && prev.videoId === videoId
          ? {
              ...prev,
              loadingInfo: false,
              error:
                err instanceof Error
                  ? err.message
                  : 'Gagal memuat metadata aset server untuk video ini.',
            }
          : prev
      );
    }
  };

  const handleExecutePermanentDelete = async () => {
    if (!deleteModal) return;
    setDeleteModal((prev) => (prev ? { ...prev, submitting: true, error: null } : null));
    try {
      const res = await adminDeleteVideoPermanentlyApi(
        deleteModal.videoId,
        deleteModal.confirmationInput
      );
      const warningSuffix = res.job.externalMediaWarning
        ? ` ${res.job.externalMediaWarning}`
        : '';
      setVideoActionFeedback({
        type: 'success',
        message:
          (locale === 'id'
            ? `Video "${res.job.videoTitleSnapshot}" dihapus permanen (ID Operasi: ${res.job.operationId}). Catatan transaksi & pendapatan kreator tetap dipertahankan.`
            : `Video "${res.job.videoTitleSnapshot}" permanently deleted (Operation ID: ${res.job.operationId}). Financial transactions and creator earnings were preserved.`) +
          warningSuffix,
      });
      setDeleteModal(null);
      void refreshDeletionJobs();
    } catch (err) {
      void refreshDeletionJobs();
      setDeleteModal((prev) =>
        prev
          ? {
              ...prev,
              submitting: false,
              latestJob:
                err instanceof AdminVideoApiError && err.job ? err.job : prev.latestJob,
              error:
                err instanceof Error
                  ? err.message
                  : 'Penghapusan permanen gagal. Anda dapat mencoba ulang dengan aman.',
            }
          : null
      );
    }
  };

  const archivedCount = videos.filter((v) => v.status === 'archived').length;
  const publishedCount = videos.filter((v) => v.status === 'published').length;
  const filteredVideos = videos.filter((v) => {
    if (moderationFilter === 'all') return true;
    if (moderationFilter === 'pending_review') return v.status === 'pending_review';
    if (moderationFilter === 'published') return v.status === 'published';
    if (moderationFilter === 'archived') return v.status === 'archived';
    return (
      v.status === 'draft' ||
      v.status === 'approved' ||
      v.status === 'rejected' ||
      v.status === 'deletion_pending'
    );
  });

  const providerLabel = (provider?: string) => {
    if (provider === 'cloudflare_stream') return 'Cloudflare Stream';
    if (provider === 'private_storage') return locale === 'id' ? 'Penyimpanan Lokal DELOKEN' : 'DELOKEN Local Storage';
    if (provider === 'youtube') return 'YouTube (Eksternal)';
    if (provider === 'vimeo') return 'Vimeo (Eksternal)';
    if (provider === 'dailymotion') return 'Dailymotion (Eksternal)';
    if (provider === 'streamable') return 'Streamable (Eksternal)';
    if (provider === 'tiktok') return 'TikTok (Eksternal)';
    if (provider === 'facebook') return 'Facebook (Eksternal)';
    if (provider === 'x') return 'X / Twitter (Eksternal)';
    if (provider === 'instagram') return 'Instagram (Eksternal)';
    if (provider === 'direct_video') return locale === 'id' ? 'URL Video / Stream Langsung (Eksternal)' : 'Direct Video / Stream URL (External)';
    return locale === 'id' ? 'Provider Tidak Dikenal' : 'Unknown Provider';
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
        <section className="space-y-6">
          {/* Moderation Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {[
                { id: 'all' as ModerationFilter, label: `${locale === 'id' ? 'Semua' : 'All'} (${videos.length})` },
                { id: 'pending_review' as ModerationFilter, label: `${locale === 'id' ? 'Menunggu Review' : 'Pending'} (${pendingVideos.length})` },
                { id: 'published' as ModerationFilter, label: `${locale === 'id' ? 'Tayang' : 'Published'} (${publishedCount})` },
                { id: 'archived' as ModerationFilter, label: `${locale === 'id' ? 'Diarsipkan' : 'Archived'} (${archivedCount})` },
                { id: 'other' as ModerationFilter, label: locale === 'id' ? 'Draft / Lainnya' : 'Draft / Other' },
              ].map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setModerationFilter(f.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    moderationFilter === f.id
                      ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                      : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {videoActionFeedback && (
            <div
              role={videoActionFeedback.type === 'error' ? 'alert' : 'status'}
              className={`p-3.5 rounded-xl border text-xs flex items-start justify-between gap-3 ${
                videoActionFeedback.type === 'error'
                  ? 'bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-800/70 text-rose-700 dark:text-rose-300'
                  : 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800/70 text-emerald-800 dark:text-emerald-300'
              }`}
            >
              <span>{videoActionFeedback.message}</span>
              <button
                type="button"
                aria-label="Dismiss notification"
                onClick={() => setVideoActionFeedback(null)}
                className="shrink-0 opacity-70 hover:opacity-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {filteredVideos.length === 0 ? (
            <EmptyState
              title={
                locale === 'id'
                  ? 'Tidak ada video pada filter ini'
                  : 'No videos match this filter'
              }
              description={
                locale === 'id'
                  ? 'Pengajuan video kreator, tayangan aktif, dan arsip akan muncul di sini.'
                  : 'Creator submissions, published titles, and archived content appear here.'
              }
            />
          ) : (
            <div className="space-y-4">
              {filteredVideos.map((vid) => (
                <article
                  key={vid.id}
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 space-y-3.5 sm:space-y-4 shadow-xs"
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3.5 sm:gap-4">
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <span
                          className={`font-semibold uppercase ${
                            vid.status === 'deletion_pending'
                              ? 'text-rose-700 dark:text-rose-400'
                              : vid.status === 'archived'
                              ? 'text-amber-700 dark:text-amber-400'
                              : 'text-emerald-700 dark:text-emerald-400'
                          }`}
                        >
                          {vid.status.replace('_', ' ')}
                        </span>
                        {vid.status === 'archived' && vid.previousStatus && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                              {locale === 'id' ? 'Asal' : 'Origin'}: {vid.previousStatus.replace('_', ' ')}
                            </span>
                          </>
                        )}
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
                      <p className="text-[11px] font-mono text-slate-400 dark:text-slate-500">
                        ID: {vid.id}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 w-full md:w-auto shrink-0">
                      {vid.status === 'pending_review' && (
                        <>
                          <Button
                            variant="primary"
                            size="sm"
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

                      {vid.status !== 'archived' && vid.status !== 'deletion_pending' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          leftIcon={<Archive className="w-3.5 h-3.5" />}
                          isLoading={processingActionId === `arch_${vid.id}`}
                          onClick={() => void handleArchiveVideo(vid)}
                        >
                          {locale === 'id' ? 'Arsipkan' : 'Archive'}
                        </Button>
                      )}

                      {vid.status === 'archived' && (
                        <Button
                          variant="secondary"
                          size="sm"
                          leftIcon={<RotateCcw className="w-3.5 h-3.5" />}
                          isLoading={processingActionId === `rest_${vid.id}`}
                          onClick={() => void handleRestoreVideoClick(vid)}
                        >
                          {locale === 'id' ? 'Pulihkan' : 'Restore'}
                        </Button>
                      )}

                      <Button
                        variant="outline"
                        size="sm"
                        className="border-rose-300 dark:border-rose-800/80 text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/60"
                        leftIcon={<Trash2 className="w-3.5 h-3.5" />}
                        onClick={() => void openPermanentDeleteModal(vid.id, vid.title)}
                      >
                        {vid.status === 'deletion_pending'
                          ? locale === 'id'
                            ? 'Lanjutkan Hapus'
                            : 'Retry Delete'
                          : locale === 'id'
                          ? 'Hapus Permanen'
                          : 'Delete Permanently'}
                      </Button>
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
              ))}
            </div>
          )}

          {/* Deletion Audit Trail */}
          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
                  {locale === 'id'
                    ? 'Log Audit Penghapusan Media Permanen'
                    : 'Permanent Media Deletion Audit Log'}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {locale === 'id'
                    ? 'Riwayat pembersihan aset provider, metadata, serta status retry yang aman. Data keuangan tetap terjaga.'
                    : 'Tracks provider cleanup, metadata removal, and safe retries. Financial records are preserved.'}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
                isLoading={loadingDeletionJobs}
                onClick={() => void refreshDeletionJobs()}
              >
                {locale === 'id' ? 'Muat Ulang' : 'Refresh'}
              </Button>
            </div>

            {deletionJobs.length === 0 ? (
              <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                {locale === 'id'
                  ? 'Belum ada operasi penghapusan permanen yang tercatat.'
                  : 'No permanent video deletion jobs recorded yet.'}
              </div>
            ) : (
              <div className="space-y-2.5">
                {deletionJobs.map((job) => (
                  <div
                    key={job.operationId}
                    className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
                        <span
                          className={`font-semibold uppercase ${
                            job.status === 'completed'
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : job.status === 'failed'
                              ? 'text-rose-700 dark:text-rose-400'
                              : 'text-amber-700 dark:text-amber-400'
                          }`}
                        >
                          {job.status}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{providerLabel(job.provider)}</span>
                        <span aria-hidden="true">·</span>
                        <span className="text-slate-500 dark:text-slate-400">
                          {job.assetRefFingerprint}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="text-slate-400">{job.operationId}</span>
                      </div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-white break-words">
                        {job.videoTitleSnapshot}{' '}
                        <span className="text-xs font-mono text-slate-400">
                          ({job.videoId})
                        </span>
                      </p>
                      <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                        Provider: {job.providerResult} · Firestore: {job.firestoreResult} · SQL: {job.sqlResult} · Thumb: {job.thumbnailResult}
                      </p>
                      {job.externalMediaWarning && (
                        <p className="text-xs text-amber-700 dark:text-amber-300">
                          {job.externalMediaWarning}
                        </p>
                      )}
                      {job.errorMessage && (
                        <p className="text-xs text-rose-700 dark:text-rose-300">
                          {job.errorCode ? `[${job.errorCode}] ` : ''}
                          {job.errorMessage}
                        </p>
                      )}
                    </div>

                    {job.status !== 'completed' && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        onClick={() =>
                          void openPermanentDeleteModal(
                            job.videoId,
                            job.videoTitleSnapshot
                          )
                        }
                      >
                        {locale === 'id' ? 'Lanjutkan / Retry' : 'Resume / Retry'}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
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

      {/* RESTORE TARGET STATUS MODAL (when previousStatus is unavailable) */}
      {restoreTargetModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Pilih status pemulihan video"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-xs"
        >
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                  {locale === 'id' ? 'Pilih Status Pemulihan' : 'Choose Restore Status'}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  {locale === 'id'
                    ? `Status asal untuk "${restoreTargetModal.video.title}" tidak tersedia. Pilih status tujuan secara manual (tidak dipublikasikan otomatis).`
                    : `Previous status for "${restoreTargetModal.video.title}" is unavailable. Choose target status explicitly.`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRestoreTargetModal(null)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {restoreTargetModal.error && (
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300">
                {restoreTargetModal.error}
              </div>
            )}

            <div className="space-y-2">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                {locale === 'id' ? 'Status Tujuan' : 'Target Status'}
              </label>
              <select
                value={restoreTargetModal.selectedStatus}
                onChange={(e) =>
                  setRestoreTargetModal((prev) =>
                    prev
                      ? {
                          ...prev,
                          selectedStatus: e.target.value as Exclude<
                            ContentStatus,
                            'archived' | 'deletion_pending'
                          >,
                        }
                      : null
                  )
                }
                className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100"
              >
                <option value="draft">Draft</option>
                <option value="pending_review">Pending Review</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="published">Published (Tayang Publik)</option>
              </select>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRestoreTargetModal(null)}
              >
                {locale === 'id' ? 'Batal' : 'Cancel'}
              </Button>
              <Button
                variant="primary"
                size="sm"
                isLoading={restoreTargetModal.submitting}
                onClick={() => void handleConfirmExplicitRestore()}
              >
                {locale === 'id' ? 'Pulihkan ke Status Ini' : 'Restore Status'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* PERMANENT DELETE CONFIRMATION MODAL */}
      {deleteModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Konfirmasi hapus permanen video"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs"
        >
          <div className="w-full max-w-lg bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900/70 rounded-2xl p-6 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="p-2.5 rounded-xl bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-400 shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                    {locale === 'id'
                      ? 'Hapus Video Secara Permanen'
                      : 'Permanently Delete Video'}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {locale === 'id'
                      ? 'Tindakan ini menghapus aset media dan katalog DELOKEN secara permanen dan tidak dapat dibatalkan.'
                      : 'This action permanently deletes the media asset and DELOKEN catalog entry and cannot be undone.'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDeleteModal(null)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {deleteModal.loadingInfo ? (
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300">
                {locale === 'id'
                  ? 'Memeriksa metadata aset otoritatif dari server...'
                  : 'Inspecting authoritative server asset metadata...'}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2 text-xs">
                  <div>
                    <span className="text-slate-500 dark:text-slate-400">
                      {locale === 'id' ? 'Judul Video:' : 'Video Title:'}
                    </span>{' '}
                    <span className="font-semibold text-slate-900 dark:text-white">
                      {deleteModal.assetInfo?.title || deleteModal.fallbackTitle}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 dark:text-slate-400">
                      {locale === 'id' ? 'Provider Aset:' : 'Asset Provider:'}
                    </span>{' '}
                    <span className="font-mono font-semibold text-slate-900 dark:text-white">
                      {providerLabel(deleteModal.assetInfo?.provider)}
                    </span>
                  </div>
                  {deleteModal.assetInfo?.assetRefFingerprint && (
                    <div>
                      <span className="text-slate-500 dark:text-slate-400">
                        {locale === 'id' ? 'Sidik Aset:' : 'Asset Ref:'}
                      </span>{' '}
                      <span className="font-mono text-slate-700 dark:text-slate-300">
                        {deleteModal.assetInfo.assetRefFingerprint}
                      </span>
                    </div>
                  )}
                </div>

                {deleteModal.assetInfo?.externalMediaWarning && (
                  <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300">
                    {deleteModal.assetInfo.externalMediaWarning}
                  </div>
                )}

                {deleteModal.latestJob && deleteModal.latestJob.status !== 'completed' && (
                  <div className="p-3.5 rounded-xl bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 text-xs text-blue-800 dark:text-blue-300">
                    {locale === 'id'
                      ? `Melanjutkan operasi sebelumnya (${deleteModal.latestJob.operationId}, status: ${deleteModal.latestJob.status}). Aset yang sudah terhapus tidak akan diperlakukan sebagai error.`
                      : `Resuming previous operation (${deleteModal.latestJob.operationId}, status: ${deleteModal.latestJob.status}). Already-removed assets are handled idempotently.`}
                  </div>
                )}

                <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 text-xs text-emerald-800 dark:text-emerald-300">
                  {locale === 'id'
                    ? 'Catatan transaksi, pembelian, entitlement historis, pendapatan kreator, payout, dan akun kreator tetap disimpan untuk audit finansial.'
                    : 'Transactions, purchases, historical entitlements, creator earnings, payouts, and creator accounts are preserved for financial auditing.'}
                </div>
              </div>
            )}

            {deleteModal.error && (
              <div
                role="alert"
                className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300"
              >
                {deleteModal.error}
              </div>
            )}

            <div className="space-y-2">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                {locale === 'id' ? 'Ketik judul video berikut untuk konfirmasi:' : 'Type the exact video title to confirm:'}
              </label>
              <p className="text-xs font-mono font-semibold text-slate-900 dark:text-white bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-lg select-all">
                {deleteModal.assetInfo?.title || deleteModal.fallbackTitle}
              </p>
              <input
                type="text"
                value={deleteModal.confirmationInput}
                onChange={(e) =>
                  setDeleteModal((prev) =>
                    prev ? { ...prev, confirmationInput: e.target.value } : null
                  )
                }
                placeholder={
                  locale === 'id' ? 'Ketik ulang judul video...' : 'Retype exact video title...'
                }
                className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDeleteModal(null)}
              >
                {locale === 'id' ? 'Batal' : 'Cancel'}
              </Button>
              <Button
                variant="primary"
                size="sm"
                className="bg-rose-600 hover:bg-rose-700 text-white"
                disabled={
                  deleteModal.loadingInfo ||
                  deleteModal.confirmationInput.trim().toLowerCase() !==
                    (
                      deleteModal.assetInfo?.title || deleteModal.fallbackTitle
                    )
                      .trim()
                      .toLowerCase()
                }
                isLoading={deleteModal.submitting}
                onClick={() => void handleExecutePermanentDelete()}
              >
                {locale === 'id' ? 'Hapus Permanen Sekarang' : 'Delete Permanently Now'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
