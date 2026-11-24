import React, { useEffect, useRef, useState } from 'react';
import {
  Archive,
  BarChart3,
  CheckCircle2,
  Film,
  Image as ImageIcon,
  Link2,
  Send,
  Upload,
  UserCheck,
  Video,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  creatorArchiveVideo,
  createCreatorVideo,
  creatorPublishApprovedVideo,
  creatorSubmitForReview,
  subscribeCreatorVideos,
  updateVideoCover,
  upsertCreatorProfile,
} from '../services/firestoreService';
import {
  fetchCreatorEarningsSummary,
  requestCreatorPayout,
  type CreatorEarningsSummary,
} from '../services/paymentService';
import {
  fetchStreamCapabilities,
  registerCreatorVideoMedia,
  uploadCreatorMedia,
  uploadVideoToCloudflareStream,
  type StreamCapabilities,
} from '../services/streamService';
import {
  extractYouTubeVideoId,
  getYouTubeThumbnailUrl,
} from '../utils/youtube';
import { extractFacebookVideoUrl } from '../utils/facebook';
import { autoCaptureCoverFromVideoFile } from '../utils/videoThumbnail';
import { CoverPicker } from '../components/creator/CoverPicker';
import {
  CATEGORY_LIST,
  formatDuration,
  formatLocalizedDate,
  formatPrice,
  formatReleasePrice,
  isFreeContent,
} from '../i18n/translations';
import type {
  ContentCategory,
  ContentItem,
  CurrencyCode,
  LocaleCode,
  ViewRoute,
} from '../types/vyora';
import { Button } from '../components/ui/Button';
import {
  DashboardSkeleton,
  ListRowSkeleton,
} from '../components/ui/Skeleton';
import { EmptyState, ErrorState } from '../components/ui/StateViews';
import { MediaImage } from '../components/ui/MediaImage';

interface CreatorDashboardPageProps {
  locale: LocaleCode;
  currency: CurrencyCode;
  onNavigate: (route: ViewRoute) => void;
}

type CreatorTab = 'content' | 'upload' | 'analytics' | 'profile';

const THUMBNAIL_PRESETS = [
  {
    label: 'Woodworking Craft Workshop',
    url: '/src/assets/images/deloken_woodworking_workshop_1795504288328.jpg',
  },
  {
    label: 'Traditional Culinary Documentary',
    url: '/src/assets/images/deloken_traditional_food_doc_1795504288538.jpg',
  },
  {
    label: 'Electrical Repair Lab',
    url: '/src/assets/images/deloken_electrical_repair_1795504290568.jpg',
  },
  {
    label: 'Coastal Observatory Cinema',
    url: '/src/assets/images/hero_featured_film_1794930897673.jpg',
  },
  {
    label: 'Volcanic Caldera',
    url: '/src/assets/images/thumb_archipelago_doc_1794930897547.jpg',
  },
  {
    label: 'Nocturnal City Street',
    url: '/src/assets/images/thumb_tokyo_nocturne_1794930898628.jpg',
  },
  {
    label: 'Acoustic Stage',
    url: '/src/assets/images/thumb_acoustic_session_1794930899091.jpg',
  },
  {
    label: 'Design Studio Lab',
    url: '/src/assets/images/thumb_design_masterclass_1794930898532.jpg',
  },
  {
    label: 'Deep Ocean Submersible',
    url: '/src/assets/images/thumb_deep_ocean_1794930899350.jpg',
  },
];

const inputClass =
  'w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-600';

export const CreatorDashboardPage: React.FC<CreatorDashboardPageProps> = ({
  locale,
  currency,
  onNavigate,
}) => {
  const { firebaseUser, userProfile, creatorProfile, authReady, isAdmin } = useAuth();
  const [activeTab, setActiveTab] = useState<CreatorTab>('content');
  const [videos, setVideos] = useState<ContentItem[]>([]);
  const [uploadHighlight, setUploadHighlight] = useState(false);
  const uploadSectionRef = useRef<HTMLElement | null>(null);
  const videoFileInputRef = useRef<HTMLInputElement | null>(null);

  // Creator Onboarding / Profile state
  const [cName, setCName] = useState(
    creatorProfile?.name || userProfile?.displayName || ''
  );
  const [cHandle, setCHandle] = useState(creatorProfile?.handle || '@');
  const [cRole, setCRole] = useState(creatorProfile?.role || 'Independent Filmmaker');
  const [cLocation, setCLocation] = useState(
    creatorProfile?.location || 'Jakarta, Indonesia'
  );
  const [cSpecialty, setCSpecialty] = useState<ContentCategory>(
    creatorProfile?.specialty || 'Movies'
  );
  const [cAvatar, setCAvatar] = useState(
    creatorProfile?.avatarUrl || userProfile?.photoURL || firebaseUser?.photoURL || ''
  );
  const [cBio, setCBio] = useState(creatorProfile?.bio || '');
  const [savingCreator, setSavingCreator] = useState(false);
  const [creatorMsg, setCreatorMsg] = useState<string | null>(null);
  const [creatorErr, setCreatorErr] = useState<string | null>(null);

  // Upload Content state
  const [vTitle, setVTitle] = useState('');
  const [vSubtitle, setVSubtitle] = useState('');
  const [vCategory, setVCategory] = useState<ContentCategory>('Movies');
  const [vDescription, setVDescription] = useState('');
  const [vThumbnail, setVThumbnail] = useState(THUMBNAIL_PRESETS[0].url);
  const [vHasExplicitCover, setVHasExplicitCover] = useState(false);
  const [vVideoPreviewUrl, setVVideoPreviewUrl] = useState<string | null>(null);
  const [autoCapturingCover, setAutoCapturingCover] = useState(false);
  const [vDuration, setVDuration] = useState(65);
  const [vResolution, setVResolution] = useState<'4K HDR' | '4K UHD' | '1080p HD'>(
    '4K HDR'
  );
  const [vAudio, setVAudio] = useState('Dolby Atmos');
  const [vPricingMode, setVPricingMode] = useState<'paid' | 'free'>('paid');
  const [vPriceUsd, setVPriceUsd] = useState(4.99);
  const [vPriceIdr, setVPriceIdr] = useState(75000);
  const [vCreditCost, setVCreditCost] = useState(5);
  const [vSourceMode, setVSourceMode] = useState<
    'file' | 'youtube' | 'facebook' | 'preset' | 'manual'
  >('file');
  const [vProvider, setVProvider] = useState<
    'cloudflare_stream' | 'private_storage' | 'youtube' | 'facebook'
  >('private_storage');
  const [vAssetRef, setVAssetRef] = useState('');
  const [vYoutubeUrl, setVYoutubeUrl] = useState('');
  const [vFacebookUrl, setVFacebookUrl] = useState('');
  const [vUploadedFileName, setVUploadedFileName] = useState<string | null>(null);
  const [vUploadedMimeType, setVUploadedMimeType] = useState<string | undefined>(undefined);
  const [uploadingVideoFile, setUploadingVideoFile] = useState(false);
  const [videoUploadProgress, setVideoUploadProgress] = useState<number | null>(null);
  const [streamCaps, setStreamCaps] = useState<StreamCapabilities>({
    cloudflareStreamConfigured: false,
    cloudflareSigningConfigured: false,
  });
  const [submittingVideo, setSubmittingVideo] = useState(false);
  const [videoMsg, setVideoMsg] = useState<string | null>(null);
  const [videoErr, setVideoErr] = useState<string | null>(null);

  // Edit Cover Modal state (Kelola Konten)
  const [editingCoverItem, setEditingCoverItem] = useState<ContentItem | null>(null);
  const [editingCoverUrl, setEditingCoverUrl] = useState('');
  const [savingEditedCover, setSavingEditedCover] = useState(false);
  const [editingCoverErr, setEditingCoverErr] = useState<string | null>(null);

  // Earnings & Payouts state
  const [earningsSummary, setEarningsSummary] = useState<CreatorEarningsSummary | null>(
    null
  );
  const [loadingEarnings, setLoadingEarnings] = useState(false);
  const [earningsError, setEarningsError] = useState<string | null>(null);
  const [earningsRetryTick, setEarningsRetryTick] = useState(0);
  const [payoutCurrency, setPayoutCurrency] = useState<'USD' | 'IDR'>('USD');
  const [payoutAmount, setPayoutAmount] = useState<string>('');
  const [payoutMethod, setPayoutMethod] = useState<
    'bank_transfer_idr' | 'ewallet_idr' | 'paypal_usd'
  >('paypal_usd');
  const [payoutDest, setPayoutDest] = useState('');
  const [requestingPayout, setRequestingPayout] = useState(false);
  const [payoutMsg, setPayoutMsg] = useState<string | null>(null);
  const [payoutErr, setPayoutErr] = useState<string | null>(null);

  useEffect(() => {
    if (creatorProfile) {
      setCName(creatorProfile.name);
      setCHandle(creatorProfile.handle);
      setCRole(creatorProfile.role);
      setCLocation(creatorProfile.location);
      setCSpecialty(creatorProfile.specialty);
      setCAvatar(creatorProfile.avatarUrl);
      setCBio(creatorProfile.bio);
    } else {
      if (userProfile?.displayName && !cName) {
        setCName(userProfile.displayName);
      }
      if (!cAvatar && (userProfile?.photoURL || firebaseUser?.photoURL)) {
        setCAvatar(userProfile?.photoURL || firebaseUser?.photoURL || '');
      }
    }
  }, [creatorProfile, userProfile, firebaseUser]);

  useEffect(() => {
    if (!authReady || !firebaseUser || !creatorProfile) return;
    const unsub = subscribeCreatorVideos(firebaseUser.uid, setVideos);
    return () => unsub();
  }, [authReady, firebaseUser, creatorProfile]);

  useEffect(() => {
    void fetchStreamCapabilities().then(setStreamCaps);
  }, []);

  useEffect(() => {
    return () => {
      if (vVideoPreviewUrl) {
        URL.revokeObjectURL(vVideoPreviewUrl);
      }
    };
  }, [vVideoPreviewUrl]);

  useEffect(() => {
    if (!authReady || !firebaseUser || !creatorProfile) {
      setEarningsSummary(null);
      setLoadingEarnings(false);
      return;
    }
    if (activeTab !== 'analytics' && earningsSummary !== null && earningsRetryTick === 0) {
      return;
    }
    let cancelled = false;
    setLoadingEarnings(true);
    setEarningsError(null);
    void fetchCreatorEarningsSummary()
      .then((res) => {
        if (!cancelled) setEarningsSummary(res);
      })
      .catch((err) => {
        if (!cancelled) {
          setEarningsError(
            err instanceof Error ? err.message : 'Unable to load creator earnings ledger.'
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingEarnings(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authReady, firebaseUser, creatorProfile, activeTab, earningsRetryTick]);

  const openUploadTab = () => {
    setActiveTab('upload');
    setUploadHighlight(true);
    window.setTimeout(() => setUploadHighlight(false), 1200);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        uploadSectionRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      });
    });
  };

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
              ? 'Masuk terlebih dahulu untuk mengakses Studio Kreator DELOKEN.'
              : 'Sign in with your DELOKEN account to open or apply for Creator Studio.'
          }
          actionLabel={locale === 'id' ? 'Masuk ke DELOKEN' : 'Sign In'}
          onAction={() => onNavigate('login')}
        />
      </div>
    );
  }

  const formatFriendlyError = (err: unknown, fallbackId: string, fallbackEn: string) => {
    const raw = err instanceof Error ? err.message : String(err);
    if (raw.includes('PERMISSION_DENIED') || raw.includes('Missing or insufficient permissions')) {
      return locale === 'id'
        ? 'Akses penulisan Firestore ditolak aturan keamanan. Pastikan akun Google terverifikasi dan semua kolom wajib sudah diisi sesuai ketentuan.'
        : 'Firestore write was denied by security rules. Please verify your account and required field lengths.';
    }
    try {
      const parsed = JSON.parse(raw) as { error?: string };
      if (parsed?.error) return parsed.error;
    } catch {
      // Not JSON
    }
    return raw || (locale === 'id' ? fallbackId : fallbackEn);
  };

  const handleSaveCreatorProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatorMsg(null);
    setCreatorErr(null);

    if (cName.trim().length < 2) {
      setCreatorErr(
        locale === 'id'
          ? 'Nama kreator / studio minimal 2 karakter.'
          : 'Creator name must be at least 2 characters.'
      );
      return;
    }
    if (cBio.trim().length < 10) {
      setCreatorErr(
        locale === 'id'
          ? 'Bio kreator minimal 10 karakter agar profil dapat disimpan.'
          : 'Bio must be at least 10 characters.'
      );
      return;
    }

    setSavingCreator(true);
    try {
      await upsertCreatorProfile(
        firebaseUser.uid,
        {
          name: cName,
          handle: cHandle,
          role: cRole,
          location: cLocation,
          avatarUrl: cAvatar,
          bio: cBio,
          bioId: cBio,
          specialty: cSpecialty,
        },
        Boolean(creatorProfile)
      );
      setCreatorMsg(
        creatorProfile
          ? locale === 'id'
            ? 'Profil kreator berhasil diperbarui.'
            : 'Creator profile updated.'
          : locale === 'id'
          ? 'Profil kreator dibuat dan dikirim untuk verifikasi Admin.'
          : 'Creator studio profile created and queued for Admin verification.'
      );
    } catch (err) {
      setCreatorErr(
        formatFriendlyError(
          err,
          'Gagal menyimpan profil kreator.',
          'Unable to save creator profile.'
        )
      );
    } finally {
      setSavingCreator(false);
    }
  };

  const handleVideoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setVideoErr(null);
    setVideoMsg(null);
    setVideoUploadProgress(null);

    const maxBytes = streamCaps.cloudflareStreamConfigured
      ? 10 * 1024 * 1024 * 1024
      : 100 * 1024 * 1024;

    if (file.size > maxBytes) {
      setVideoErr(
        streamCaps.cloudflareStreamConfigured
          ? locale === 'id'
            ? 'Ukuran file melebihi batas unggahan 10 GB.'
            : 'Video file exceeds the 10 GB upload limit.'
          : locale === 'id'
          ? 'File > 100 MB membutuhkan Cloudflare Stream agar server tidak kelebihan beban. Atur CLOUDFLARE_STREAM_ACCOUNT_ID dan CLOUDFLARE_STREAM_API_TOKEN di Secrets AI Studio, atau unggah file ≤ 100 MB.'
          : 'Files larger than 100 MB require Cloudflare Stream credentials (CLOUDFLARE_STREAM_ACCOUNT_ID & CLOUDFLARE_STREAM_API_TOKEN) in Secrets, or upload a file ≤ 100 MB.'
      );
      e.target.value = '';
      return;
    }

    setUploadingVideoFile(true);

    if (vVideoPreviewUrl) {
      URL.revokeObjectURL(vVideoPreviewUrl);
    }
    const nextPreviewUrl = URL.createObjectURL(file);
    setVVideoPreviewUrl(nextPreviewUrl);

    try {
      const probe = document.createElement('video');
      probe.preload = 'metadata';
      probe.onloadedmetadata = () => {
        if (Number.isFinite(probe.duration) && probe.duration > 0) {
          setVDuration(Math.max(1, Math.round(probe.duration / 60)));
        }
      };
      probe.src = nextPreviewUrl;
    } catch {
      // Ignore duration probe errors
    }

    // Auto-extract a cover frame from the uploaded video when creator has not picked a custom cover yet
    if (!vHasExplicitCover) {
      setAutoCapturingCover(true);
      void autoCaptureCoverFromVideoFile(file)
        .then((frameFile) => uploadCreatorMedia(frameFile))
        .then((uploadedThumb) => {
          if (uploadedThumb.kind === 'thumbnail') {
            setVThumbnail(uploadedThumb.thumbnailUrl);
          }
        })
        .catch(() => {
          // Non-fatal fallback to current thumbnail if browser codec fails frame capture
        })
        .finally(() => {
          setAutoCapturingCover(false);
        });
    }

    try {
      const uploaded = streamCaps.cloudflareStreamConfigured
        ? await uploadVideoToCloudflareStream(file, (pct) => {
            setVideoUploadProgress(pct);
          })
        : await uploadCreatorMedia(file);

      if (uploaded.kind === 'video') {
        setVProvider(uploaded.provider);
        setVAssetRef(uploaded.assetRef);
        setVUploadedFileName(file.name);
        setVUploadedMimeType(uploaded.mimeType);
      }
    } catch (err) {
      setVideoErr(
        formatFriendlyError(
          err,
          'Gagal mengunggah file video ke server.',
          'Failed to upload video file.'
        )
      );
    } finally {
      setUploadingVideoFile(false);
      setVideoUploadProgress(null);
      e.target.value = '';
    }
  };

  const handleSubmitVideo = async (initialStatus: 'draft' | 'pending_review') => {
    if (!creatorProfile) return;
    setVideoMsg(null);
    setVideoErr(null);

    if (vTitle.trim().length < 2) {
      setVideoErr(
        locale === 'id'
          ? 'Judul tayangan minimal 2 karakter.'
          : 'Title must be at least 2 characters.'
      );
      return;
    }
    if (vSubtitle.trim().length < 4) {
      setVideoErr(
        locale === 'id'
          ? 'Subjudul / tagline minimal 4 karakter.'
          : 'Subtitle / logline must be at least 4 characters.'
      );
      return;
    }
    if (vDescription.trim().length < 10) {
      setVideoErr(
        locale === 'id'
          ? 'Sinopsis / deskripsi minimal 10 karakter.'
          : 'Synopsis description must be at least 10 characters.'
      );
      return;
    }

    const parsedYoutubeId =
      vSourceMode === 'youtube' ? extractYouTubeVideoId(vYoutubeUrl) : null;
    const parsedFacebookUrl =
      vSourceMode === 'facebook' ? extractFacebookVideoUrl(vFacebookUrl) : null;

    if (vSourceMode === 'youtube' && !parsedYoutubeId) {
      setVideoErr(
        locale === 'id'
          ? 'Link atau ID video YouTube tidak valid. Tempel link seperti https://www.youtube.com/watch?v=... atau https://youtu.be/...'
          : 'Invalid YouTube link or video ID. Paste a link like https://www.youtube.com/watch?v=... or https://youtu.be/...'
      );
      return;
    }

    if (vSourceMode === 'facebook' && !parsedFacebookUrl) {
      setVideoErr(
        locale === 'id'
          ? 'Link video Facebook tidak valid. Gunakan link publik seperti facebook.com/.../videos/..., facebook.com/watch?v=..., facebook.com/reel/..., atau fb.watch/...'
          : 'Invalid Facebook video URL. Paste a public link like facebook.com/.../videos/..., facebook.com/watch?v=..., facebook.com/reel/..., or fb.watch/...'
      );
      return;
    }

    const effectiveProvider:
      | 'cloudflare_stream'
      | 'private_storage'
      | 'youtube'
      | 'facebook' =
      vSourceMode === 'preset'
        ? 'private_storage'
        : vSourceMode === 'youtube'
        ? 'youtube'
        : vSourceMode === 'facebook'
        ? 'facebook'
        : vProvider;
    const effectiveAssetRef =
      vSourceMode === 'preset' && vAssetRef.trim().length < 3
        ? vCategory === 'Documentary' || vCategory === 'Education'
          ? 'stream-doc'
          : 'stream-cinema'
        : vSourceMode === 'youtube' && parsedYoutubeId
        ? parsedYoutubeId
        : vSourceMode === 'facebook' && parsedFacebookUrl
        ? parsedFacebookUrl
        : vAssetRef.trim();

    if (effectiveAssetRef.length < 3) {
      setVideoErr(
        locale === 'id'
          ? 'Silakan unggah file video, masukkan link YouTube/Facebook, atau pilih tab "Stream Studio".'
          : 'Please upload a video file, paste a YouTube/Facebook link, or select "Studio Stream".'
      );
      return;
    }

    setSubmittingVideo(true);
    try {
      const isFreeUpload = vPricingMode === 'free';
      const videoId = await createCreatorVideo(firebaseUser.uid, creatorProfile.name, {
        title: vTitle,
        subtitle: vSubtitle,
        description: vDescription,
        descriptionId: vDescription,
        category: vCategory,
        thumbnailUrl: vThumbnail,
        durationMinutes: Number(vDuration),
        isFree: isFreeUpload,
        priceUsd: isFreeUpload ? 0 : Number(vPriceUsd),
        priceIdr: isFreeUpload ? 0 : Number(vPriceIdr),
        creditCost: isFreeUpload ? 0 : Number(vCreditCost),
        releaseYear: new Date().getFullYear(),
        resolution: vResolution,
        audioFormat: vAudio,
        languages: ['Indonesian', 'English'],
        assetProvider: effectiveProvider,
        assetRef: effectiveAssetRef,
        initialStatus,
      });

      await registerCreatorVideoMedia({
        videoId,
        provider: effectiveProvider,
        assetRef: effectiveAssetRef,
        mimeType:
          effectiveProvider === 'youtube'
            ? 'video/youtube'
            : effectiveProvider === 'facebook'
            ? 'video/facebook'
            : vUploadedMimeType,
      });

      setVTitle('');
      setVSubtitle('');
      setVDescription('');
      setVPricingMode('paid');
      setVAssetRef('');
      setVYoutubeUrl('');
      setVFacebookUrl('');
      setVUploadedFileName(null);
      setVUploadedMimeType(undefined);
      setVThumbnail(THUMBNAIL_PRESETS[0].url);
      setVHasExplicitCover(false);
      if (vVideoPreviewUrl) {
        URL.revokeObjectURL(vVideoPreviewUrl);
      }
      setVVideoPreviewUrl(null);
      setVideoMsg(
        initialStatus === 'pending_review'
          ? locale === 'id'
            ? 'Konten berhasil diunggah dan diajukan ke antrean moderasi Admin.'
            : 'Release uploaded and submitted to Admin moderation queue.'
          : locale === 'id'
          ? 'Draf konten tersimpan di database Firestore.'
          : 'Draft saved to Firestore database.'
      );
      setActiveTab('content');
    } catch (err) {
      setVideoErr(
        formatFriendlyError(
          err,
          'Gagal menyimpan video ke database.',
          'Failed to create video.'
        )
      );
    } finally {
      setSubmittingVideo(false);
    }
  };

  const handleRequestPayout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!creatorProfile) return;
    setPayoutMsg(null);
    setPayoutErr(null);

    const parsedAmount = Number(payoutAmount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setPayoutErr(
        locale === 'id' ? 'Masukkan nominal penarikan yang valid.' : 'Enter a valid payout amount.'
      );
      return;
    }
    if (payoutDest.trim().length < 4) {
      setPayoutErr(
        locale === 'id'
          ? 'Masukkan tujuan transfer atau akun PayPal Anda.'
          : 'Enter a valid bank account, e-wallet, or PayPal destination.'
      );
      return;
    }

    setRequestingPayout(true);
    try {
      const res = await requestCreatorPayout(
        {
          creatorName: creatorProfile.name,
          currency: payoutCurrency,
          amount: parsedAmount,
          method: payoutMethod,
          destination: payoutDest.trim(),
        },
        crypto.randomUUID()
      );
      setEarningsSummary(res.summary);
      setPayoutAmount('');
      setPayoutDest('');
      setPayoutMsg(
        locale === 'id'
          ? 'Permintaan payout berhasil dikirim ke antrean Admin.'
          : 'Payout request submitted to Admin operations.'
      );
    } catch (err) {
      setPayoutErr(err instanceof Error ? err.message : 'Payout request failed.');
    } finally {
      setRequestingPayout(false);
    }
  };

  // Show Onboarding form if user does not have a Creator profile yet
  if (!creatorProfile) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 space-y-6">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-9 space-y-6 shadow-xs">
          <div className="space-y-2">
            <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
              {locale === 'id' ? 'Studio Kreator DELOKEN' : 'DELOKEN Creator Studio'}
            </p>
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">
              {locale === 'id'
                ? 'Aktifkan Profil Kreator Anda'
                : 'Set Up Your Creator Studio Profile'}
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              {locale === 'id'
                ? 'Buat profil studio kreator Anda untuk mulai menyusun draf dan mengajukan film, dokumenter, kelas praktis, atau acara langsung ke moderasi.'
                : 'Register your studio profile to draft and submit films, documentaries, practical workshops, or live events for moderation.'}
            </p>
          </div>

          {creatorErr && (
            <div
              role="alert"
              className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800/70 text-xs text-rose-700 dark:text-rose-300"
            >
              {creatorErr}
            </div>
          )}

          <form onSubmit={handleSaveCreatorProfile} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                  {locale === 'id' ? 'Nama Kreator / Studio' : 'Creator / Studio Name'}
                </label>
                <input
                  type="text"
                  required
                  value={cName}
                  onChange={(e) => setCName(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                  Handle (@username)
                </label>
                <input
                  type="text"
                  required
                  value={cHandle}
                  onChange={(e) => setCHandle(e.target.value)}
                  placeholder="@studio_name"
                  className={inputClass}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                  {locale === 'id' ? 'Peran / Bidang' : 'Role / Craft'}
                </label>
                <input
                  type="text"
                  required
                  value={cRole}
                  onChange={(e) => setCRole(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                  {locale === 'id' ? 'Lokasi' : 'Location'}
                </label>
                <input
                  type="text"
                  required
                  value={cLocation}
                  onChange={(e) => setCLocation(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                  {locale === 'id' ? 'Kategori Utama' : 'Primary Category'}
                </label>
                <select
                  value={cSpecialty}
                  onChange={(e) => setCSpecialty(e.target.value as ContentCategory)}
                  className={inputClass}
                >
                  {CATEGORY_LIST.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                  {locale === 'id' ? 'Bio Kreator' : 'Creator Bio'}
                </label>
                <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                  {cBio.trim().length}/10+ {locale === 'id' ? 'karakter' : 'chars'}
                </span>
              </div>
              <textarea
                rows={3}
                required
                minLength={10}
                value={cBio}
                onChange={(e) => setCBio(e.target.value)}
                placeholder={
                  locale === 'id'
                    ? 'Ceritakan profil film, dokumenter, atau kelas praktis Anda (minimal 10 karakter)...'
                    : 'Tell viewers about your filmmaking, educational focus, or studio work (min. 10 characters)...'
                }
                className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>

            <Button type="submit" variant="primary" size="lg" className="w-full sm:w-auto" isLoading={savingCreator}>
              {locale === 'id' ? 'Buat Profil Kreator' : 'Create Creator Profile'}
            </Button>
          </form>
        </div>
      </div>
    );
  }

  const publishedCount = videos.filter((v) => v.status === 'published').length;
  const pendingCount = videos.filter((v) => v.status === 'pending_review').length;
  const totalViews = videos.reduce((acc, v) => acc + (v.viewCount ?? 0), 0);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10 space-y-6 sm:space-y-8">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 sm:pb-6 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-3.5 sm:gap-4 min-w-0">
          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 shrink-0">
            <MediaImage
              src={creatorProfile.avatarUrl}
              alt={creatorProfile.name}
              fallbackTitle={creatorProfile.name}
              className="w-full h-full"
            />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400 font-semibold">
              <span>{locale === 'id' ? 'Studio Kreator DELOKEN' : 'DELOKEN Creator Studio'}</span>
              <span aria-hidden="true">·</span>
              <span className="capitalize">
                {creatorProfile.verified
                  ? locale === 'id'
                    ? 'Kreator Terverifikasi'
                    : 'Verified Creator'
                  : `Status: ${creatorProfile.status ?? 'pending'}`}
              </span>
            </div>
            <h1 className="font-display text-xl sm:text-3xl font-bold text-slate-900 dark:text-white truncate">
              {creatorProfile.name}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
              {creatorProfile.handle} · {creatorProfile.location}
            </p>
          </div>
        </div>

        <Button
          variant="primary"
          size="sm"
          className="w-full md:w-auto"
          leftIcon={<Upload className="w-4 h-4" />}
          onClick={openUploadTab}
        >
          {locale === 'id' ? 'Unggah Konten Baru' : 'Submit New Content'}
        </Button>
      </header>

      {/* Navigation Tabs */}
      <div
        role="tablist"
        aria-label="Creator studio sections"
        className="flex items-center gap-2 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0 deloken-scroll"
      >
        {[
          {
            id: 'content' as CreatorTab,
            label: locale === 'id' ? 'Kelola Konten' : 'Content Management',
            icon: <Film className="w-4 h-4" />,
          },
          {
            id: 'upload' as CreatorTab,
            label: locale === 'id' ? 'Unggah Konten' : 'Submit Content',
            icon: <Upload className="w-4 h-4" />,
          },
          {
            id: 'analytics' as CreatorTab,
            label: locale === 'id' ? 'Analitik & Pendapatan' : 'Analytics & Earnings',
            icon: <BarChart3 className="w-4 h-4" />,
          },
          {
            id: 'profile' as CreatorTab,
            label: locale === 'id' ? 'Profil Kreator' : 'Creator Profile',
            icon: <UserCheck className="w-4 h-4" />,
          },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => {
              if (tab.id === 'upload') {
                openUploadTab();
              } else {
                setActiveTab(tab.id);
              }
            }}
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

      {/* KPI Strip */}
      {(activeTab === 'content' || activeTab === 'analytics') && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 shadow-xs">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {locale === 'id' ? 'Total Konten' : 'Total Submissions'}
            </p>
            <p className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1">
              {videos.length}
            </p>
          </div>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 shadow-xs">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {locale === 'id' ? 'Tayang Publik' : 'Published'}
            </p>
            <p className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400 mt-1">
              {publishedCount}
            </p>
          </div>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 shadow-xs">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {locale === 'id' ? 'Menunggu Moderasi' : 'Pending Moderation'}
            </p>
            <p className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1">
              {pendingCount}
            </p>
          </div>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 shadow-xs">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {locale === 'id' ? 'Total Penayangan' : 'Total Views'}
            </p>
            <p className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1">
              {totalViews}
            </p>
          </div>
        </div>
      )}

      {/* CONTENT MANAGEMENT */}
      {activeTab === 'content' && (
        <section className="space-y-4">
          {videoMsg && (
            <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/70 text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>{videoMsg}</span>
            </div>
          )}

          {videos.length === 0 ? (
            <EmptyState
              title={
                locale === 'id' ? 'Belum ada konten diajukan' : 'No releases submitted yet'
              }
              description={
                locale === 'id'
                  ? 'Buat draf atau ajukan rilisan video pertama Anda ke antrean moderasi Admin.'
                  : 'Create a draft or submit your first video release for Admin moderation.'
              }
              actionLabel={locale === 'id' ? 'Unggah Konten Baru' : 'Submit New Content'}
              onAction={openUploadTab}
              icon={<Film className="w-6 h-6" />}
            />
          ) : (
            <div className="space-y-3">
              {videos.map((vid) => (
                <article
                  key={vid.id}
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 sm:p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3.5 sm:gap-4"
                >
                  <div className="flex items-start gap-3 sm:gap-4 min-w-0">
                    <div className="w-24 sm:w-36 aspect-video rounded-lg overflow-hidden shrink-0 bg-slate-100 dark:bg-slate-800">
                      <MediaImage
                        src={vid.thumbnailUrl}
                        alt={vid.title}
                        fallbackTitle={vid.title}
                        className="w-full h-full"
                      />
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] sm:text-xs text-slate-500 dark:text-slate-400">
                        <span className="text-emerald-700 dark:text-emerald-400 font-semibold uppercase tracking-wide">
                          {vid.status.replace('_', ' ')}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{vid.category}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          {formatDuration(vid.durationMinutes, locale)}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span
                          className={`font-mono tabular-nums ${
                            isFreeContent(vid)
                              ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                              : ''
                          }`}
                        >
                          {formatReleasePrice(vid, locale, currency)}
                        </span>
                      </div>
                      <h3 className="text-sm sm:text-base font-semibold text-slate-900 dark:text-white break-words line-clamp-2 sm:line-clamp-none">
                        {vid.title}
                      </h3>
                      <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-1">{vid.subtitle}</p>
                      {vid.moderationNote && (
                        <p className="text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800/70 rounded-lg px-2.5 py-1 mt-1 inline-block">
                          {locale === 'id' ? 'Catatan moderasi: ' : 'Moderation note: '}
                          {vid.moderationNote}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-2.5 border-t border-slate-200 dark:border-slate-800 md:border-t-0 md:pt-0 shrink-0">
                    {(vid.status === 'draft' ||
                      vid.status === 'rejected' ||
                      (isAdmin && vid.status !== 'archived')) && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 sm:flex-none"
                        leftIcon={<ImageIcon className="w-3.5 h-3.5" />}
                        onClick={() => {
                          setEditingCoverItem(vid);
                          setEditingCoverUrl(vid.thumbnailUrl);
                          setEditingCoverErr(null);
                        }}
                      >
                        {locale === 'id' ? 'Ganti Cover' : 'Edit Cover'}
                      </Button>
                    )}
                    {(vid.status === 'draft' || vid.status === 'rejected') && (
                      <Button
                        variant="primary"
                        size="sm"
                        className="flex-1 sm:flex-none"
                        leftIcon={<Send className="w-3.5 h-3.5" />}
                        onClick={() => void creatorSubmitForReview(vid.id)}
                      >
                        {locale === 'id' ? 'Ajukan Review' : 'Submit for Review'}
                      </Button>
                    )}
                    {vid.status === 'approved' && (
                      <Button
                        variant="primary"
                        size="sm"
                        className="flex-1 sm:flex-none"
                        onClick={() => void creatorPublishApprovedVideo(vid.id)}
                      >
                        {locale === 'id' ? 'Publikasikan' : 'Publish Release'}
                      </Button>
                    )}
                    {(vid.status === 'draft' ||
                      vid.status === 'approved' ||
                      vid.status === 'published') && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="flex-1 sm:flex-none"
                        leftIcon={<Archive className="w-3.5 h-3.5" />}
                        onClick={() => void creatorArchiveVideo(vid.id)}
                      >
                        {locale === 'id' ? 'Arsipkan' : 'Archive'}
                      </Button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {/* SUBMIT NEW CONTENT */}
      {activeTab === 'upload' && (
        <section
          ref={uploadSectionRef}
          className={`max-w-3xl bg-white dark:bg-slate-900 border rounded-2xl p-5 sm:p-8 space-y-6 scroll-mt-20 shadow-xs transition-all duration-300 ${
            uploadHighlight
              ? 'border-emerald-600 ring-2 ring-emerald-600/30'
              : 'border-slate-200 dark:border-slate-800'
          }`}
        >
          <div>
            <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">
              {locale === 'id'
                ? 'Unggah Video & Ajukan Tayangan Baru'
                : 'Upload Video & Submit New Release'}
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
              {locale === 'id'
                ? 'Unggah file video (.MP4 / .WebM / .MOV), tempel link YouTube atau Facebook, atau pilih Stream Studio.'
                : 'Upload a video file (.MP4 / .WebM / .MOV), paste a YouTube or Facebook link, or select a Studio Stream.'}
            </p>
          </div>

          {videoErr && (
            <div
              role="alert"
              className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800/70 text-xs text-rose-700 dark:text-rose-300"
            >
              {videoErr}
            </div>
          )}

          <div className="space-y-5">
            {/* Step 1: Video Media Source Picker */}
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3.5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-900 dark:text-white">
                  {locale === 'id' ? '1. Sumber Berkas Video' : '1. Video Media Source'}
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-1 p-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  {[
                    {
                      id: 'file' as const,
                      label: locale === 'id' ? 'Unggah File' : 'Upload File',
                    },
                    {
                      id: 'youtube' as const,
                      label: locale === 'id' ? 'Link YouTube' : 'YouTube',
                    },
                    {
                      id: 'facebook' as const,
                      label: locale === 'id' ? 'Link Facebook' : 'Facebook',
                    },
                    {
                      id: 'preset' as const,
                      label: locale === 'id' ? 'Stream Studio' : 'Studio Stream',
                    },
                    {
                      id: 'manual' as const,
                      label: 'Stream UID',
                    },
                  ].map((modeOpt) => (
                    <button
                      key={modeOpt.id}
                      type="button"
                      onClick={() => {
                        setVSourceMode(modeOpt.id);
                        if (modeOpt.id === 'preset') {
                          setVProvider('private_storage');
                          setVAssetRef(
                            vCategory === 'Documentary' || vCategory === 'Education'
                              ? 'stream-doc'
                              : 'stream-cinema'
                          );
                        } else if (modeOpt.id === 'youtube') {
                          setVProvider('youtube');
                        } else if (modeOpt.id === 'facebook') {
                          setVProvider('facebook');
                        } else if (modeOpt.id === 'manual') {
                          setVProvider('cloudflare_stream');
                          if (vAssetRef === 'stream-cinema' || vAssetRef === 'stream-doc') {
                            setVAssetRef('');
                          }
                        } else if (
                          modeOpt.id === 'file' &&
                          (vProvider === 'youtube' || vProvider === 'facebook')
                        ) {
                          setVProvider('private_storage');
                        }
                      }}
                      className={`min-h-[34px] px-2.5 rounded-md text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                        vSourceMode === modeOpt.id
                          ? 'bg-emerald-600 text-white'
                          : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      {modeOpt.label}
                    </button>
                  ))}
                </div>
              </div>

              {vSourceMode === 'file' && (
                <div className="space-y-3">
                  <div className="relative flex flex-col items-center justify-center gap-2 p-5 rounded-xl border border-dashed border-emerald-500 bg-white dark:bg-slate-900 hover:bg-emerald-50/40 dark:hover:bg-emerald-950/30 transition-colors text-center">
                    <input
                      ref={videoFileInputRef}
                      type="file"
                      accept="video/*,.mp4,.webm,.mov"
                      disabled={uploadingVideoFile}
                      onChange={(e) => void handleVideoFileChange(e)}
                      aria-label={
                        locale === 'id'
                          ? 'Pilih file video untuk diunggah'
                          : 'Choose video file to upload'
                      }
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 disabled:cursor-not-allowed"
                    />
                    <div className="pointer-events-none flex flex-col items-center gap-1.5">
                      <Video className="w-6 h-6 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                      <span className="text-xs font-semibold text-slate-900 dark:text-white">
                        {uploadingVideoFile
                          ? videoUploadProgress !== null
                            ? locale === 'id'
                              ? `Mengunggah langsung ke Cloudflare Stream... ${videoUploadProgress}%`
                              : `Uploading directly to Cloudflare Stream... ${videoUploadProgress}%`
                            : locale === 'id'
                            ? 'Sedang mengunggah video ke server...'
                            : 'Uploading video file to server...'
                          : vUploadedFileName
                          ? locale === 'id'
                            ? `Terunggah: ${vUploadedFileName}`
                            : `Uploaded: ${vUploadedFileName}`
                          : streamCaps.cloudflareStreamConfigured
                          ? locale === 'id'
                            ? 'Pilih Film Panjang (.MP4, .WebM, .MOV · maks 10GB via Cloudflare HLS)'
                            : 'Select Feature Film (.MP4, .WebM, .MOV · up to 10GB via Cloudflare HLS)'
                          : locale === 'id'
                          ? 'Pilih File Video dari HP / Laptop (.MP4, .WebM, .MOV · maks 100MB)'
                          : 'Select Video File from Device (.MP4, .WebM, .MOV · max 100MB)'}
                      </span>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">
                        {vAssetRef && vUploadedFileName
                          ? vProvider === 'cloudflare_stream'
                            ? locale === 'id'
                              ? 'Terhubung ke Cloudflare Stream HLS terenkripsi & siap diajukan ke moderasi.'
                              : 'Encoded target ready on Cloudflare Stream HLS for moderation.'
                            : locale === 'id'
                            ? 'File siap diputar & diajukan ke moderasi.'
                            : 'File ready for streaming and moderation.'
                          : streamCaps.cloudflareStreamConfigured
                          ? locale === 'id'
                            ? 'Unggahan dikirim per-chunk langsung ke Cloudflare Stream (tidak membebani RAM/disk server).'
                            : 'Chunked TUS upload goes directly to Cloudflare Stream without loading server RAM/disk.'
                          : locale === 'id'
                          ? 'Mode server lokal maks 100MB. Tambahkan CLOUDFLARE_STREAM_* di Secrets untuk film panjang (>100MB) HLS terenkripsi.'
                          : 'Local server fallback max 100MB. Add CLOUDFLARE_STREAM_* Secrets for >100MB encrypted HLS.'}
                      </span>
                    </div>
                  </div>
                  {uploadingVideoFile && videoUploadProgress !== null && (
                    <div className="space-y-1">
                      <div className="h-2 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                        <div
                          className="h-full bg-emerald-600 transition-all duration-200"
                          style={{ width: `${videoUploadProgress}%` }}
                        />
                      </div>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      leftIcon={<Upload className="w-3.5 h-3.5" />}
                      isLoading={uploadingVideoFile}
                      onClick={() => videoFileInputRef.current?.click()}
                    >
                      {vUploadedFileName
                        ? locale === 'id'
                          ? 'Ganti File Video'
                          : 'Replace Video File'
                        : locale === 'id'
                        ? 'Pilih File Video'
                        : 'Browse Video File'}
                    </Button>
                    {vUploadedFileName && (
                      <span className="text-[11px] font-mono text-emerald-700 dark:text-emerald-400 font-semibold truncate max-w-xs">
                        ✓ {vUploadedFileName}
                        {vProvider === 'cloudflare_stream' ? ' · Cloudflare HLS' : ''}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {vSourceMode === 'youtube' && (() => {
                const parsedYtId = extractYouTubeVideoId(vYoutubeUrl);
                const ytThumb = parsedYtId ? getYouTubeThumbnailUrl(parsedYtId) : '';
                return (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1.5">
                        {locale === 'id'
                          ? 'URL Video YouTube (Disarankan status Unlisted / Tidak Publik)'
                          : 'YouTube Video URL (Unlisted or Public recommended)'}
                      </label>
                      <div className="relative">
                        <Link2
                          className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                          aria-hidden="true"
                        />
                        <input
                          type="text"
                          value={vYoutubeUrl}
                          onChange={(e) => {
                            const val = e.target.value;
                            setVYoutubeUrl(val);
                            setVProvider('youtube');
                            const id = extractYouTubeVideoId(val);
                            setVAssetRef(id || '');
                          }}
                          placeholder="https://www.youtube.com/watch?v=... atau https://youtu.be/..."
                          className={`${inputClass} pl-10 font-mono text-xs`}
                        />
                      </div>
                    </div>

                    {vYoutubeUrl.trim().length > 0 && (
                      parsedYtId ? (
                        <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800/70 flex flex-col sm:flex-row sm:items-center gap-3">
                          <div className="w-full sm:w-32 aspect-video rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-800 shrink-0">
                            <img
                              src={ytThumb}
                              alt="YouTube preview thumbnail"
                              className="w-full h-full object-cover"
                            />
                          </div>
                          <div className="flex-1 min-w-0 space-y-1.5">
                            <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                              <CheckCircle2 className="w-4 h-4 shrink-0" />
                              <span>
                                {locale === 'id'
                                  ? `ID Video YouTube valid: ${parsedYtId}`
                                  : `Valid YouTube Video ID: ${parsedYtId}`}
                              </span>
                            </p>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                              {locale === 'id'
                                ? 'Pastikan di YouTube Studio opsi "Izinkan penyematan / Allow embedding" aktif dan visibilitas disetel Unlisted atau Publik.'
                                : 'Ensure "Allow embedding" is enabled in YouTube Studio and visibility is set to Unlisted or Public.'}
                            </p>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setVThumbnail(ytThumb)}
                            >
                              {locale === 'id'
                                ? 'Gunakan Thumbnail YouTube Ini'
                                : 'Use This YouTube Thumbnail'}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-rose-600 dark:text-rose-400">
                          {locale === 'id'
                            ? 'Format link belum dikenali. Gunakan tautan youtube.com/watch?v=..., youtu.be/..., youtube.com/shorts/..., atau ID 11 karakter.'
                            : 'Unrecognized link format. Paste a youtube.com/watch?v=..., youtu.be/..., youtube.com/shorts/..., or 11-char ID.'}
                        </p>
                      )
                    )}

                    <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                      {locale === 'id'
                        ? 'Video YouTube diputar melalui YouTube IFrame Player API tanpa memakan kuota server, dengan pembatasan pratinjau 5 menit di pemutar DELOKEN sebelum transaksi selesai.'
                        : 'YouTube videos stream via the official YouTube IFrame Player API with zero server storage overhead and a 5-minute preview gate in the DELOKEN player.'}
                    </p>
                  </div>
                );
              })()}

              {vSourceMode === 'facebook' && (() => {
                const parsedFbUrl = extractFacebookVideoUrl(vFacebookUrl);
                return (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1.5">
                        {locale === 'id'
                          ? 'URL Video / Reel Facebook (Wajib berstatus Publik)'
                          : 'Facebook Video / Reel URL (Must be Public)'}
                      </label>
                      <div className="relative">
                        <Link2
                          className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                          aria-hidden="true"
                        />
                        <input
                          type="text"
                          value={vFacebookUrl}
                          onChange={(e) => {
                            const val = e.target.value;
                            setVFacebookUrl(val);
                            setVProvider('facebook');
                            const canonical = extractFacebookVideoUrl(val);
                            setVAssetRef(canonical || '');
                          }}
                          placeholder="https://www.facebook.com/.../videos/1234567890 atau https://fb.watch/..."
                          className={`${inputClass} pl-10 font-mono text-xs`}
                        />
                      </div>
                    </div>

                    {vFacebookUrl.trim().length > 0 && (
                      parsedFbUrl ? (
                        <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800/70 space-y-1">
                          <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                            <CheckCircle2 className="w-4 h-4 shrink-0" />
                            <span className="truncate">
                              {locale === 'id'
                                ? `Link Facebook valid: ${parsedFbUrl}`
                                : `Valid Facebook URL: ${parsedFbUrl}`}
                            </span>
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            {locale === 'id'
                              ? 'Pastikan postingan video Facebook disetel "Publik" (bukan Teman/Privat) dan pilih thumbnail sampul di bawah.'
                              : 'Ensure the Facebook video post privacy is set to Public (not Friends/Private) and pick a cover thumbnail below.'}
                          </p>
                        </div>
                      ) : (
                        <p className="text-xs text-rose-600 dark:text-rose-400">
                          {locale === 'id'
                            ? 'Format link Facebook belum dikenali. Gunakan tautan facebook.com/.../videos/..., facebook.com/watch?v=..., facebook.com/reel/..., atau fb.watch/...'
                            : 'Unrecognized Facebook URL. Paste a facebook.com/.../videos/..., facebook.com/watch?v=..., facebook.com/reel/..., or fb.watch/... link.'}
                        </p>
                      )
                    )}

                    <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                      {locale === 'id'
                        ? 'Video Facebook disematkan melalui Facebook Embedded Video Player. Catatan: sebagian browser HP atau pemblokir iklan dapat membatasi embed Facebook; untuk kontrol lebih stabil disarankan YouTube Unlisted atau unggahan langsung.'
                        : 'Facebook videos embed via the official Facebook Video Plugin. Note: privacy blockers or mobile browsers may prompt Facebook login; YouTube Unlisted or direct upload is recommended for stricter paywalls.'}
                    </p>
                  </div>
                );
              })()}

              {vSourceMode === 'preset' && (
                <div className="space-y-2">
                  <label className="block text-xs text-slate-600 dark:text-slate-300">
                    {locale === 'id'
                      ? 'Pilih Master Stream HLS Terenkripsi (Siap Uji Tayang Instan)'
                      : 'Choose Encrypted Studio HLS Master (Instant Playback Ready)'}
                  </label>
                  <select
                    value={vAssetRef === 'stream-doc' ? 'stream-doc' : 'stream-cinema'}
                    onChange={(e) => {
                      setVProvider('private_storage');
                      setVAssetRef(e.target.value);
                    }}
                    className={inputClass}
                  >
                    <option value="stream-cinema">
                      {locale === 'id'
                        ? 'Studio Cinema Master 4K (HLS Adaptif)'
                        : 'Studio Cinema Master 4K (Adaptive HLS)'}
                    </option>
                    <option value="stream-doc">
                      {locale === 'id'
                        ? 'Studio Documentary & Masterclass (HLS Adaptif)'
                        : 'Studio Documentary & Masterclass (Adaptive HLS)'}
                    </option>
                  </select>
                </div>
              )}

              {vSourceMode === 'manual' && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                      {locale === 'id' ? 'Penyedia Stream' : 'Stream Provider'}
                    </label>
                    <select
                      value={vProvider}
                      onChange={(e) =>
                        setVProvider(
                          e.target.value as 'cloudflare_stream' | 'private_storage'
                        )
                      }
                      className={inputClass}
                    >
                      <option value="cloudflare_stream">Cloudflare Stream</option>
                      <option value="private_storage">Private Object Storage</option>
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                      {locale === 'id'
                        ? 'Referensi Aset / Stream UID'
                        : 'Private Video Asset Reference / Stream UID'}
                    </label>
                    <input
                      type="text"
                      maxLength={300}
                      value={vAssetRef}
                      onChange={(e) => setVAssetRef(e.target.value)}
                      placeholder="cf-stream-uid-9482a7... / private/masters/film.mp4"
                      className={`${inputClass} font-mono`}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                  {locale === 'id' ? 'Judul Tayangan' : 'Title'}
                </label>
                <input
                  type="text"
                  maxLength={140}
                  value={vTitle}
                  onChange={(e) => setVTitle(e.target.value)}
                  placeholder={
                    locale === 'id'
                      ? 'Contoh: Horizon di Atas Sulawesi'
                      : 'e.g., Horizon Over Sulawesi'
                  }
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                  {locale === 'id' ? 'Kategori' : 'Category'}
                </label>
                <select
                  value={vCategory}
                  onChange={(e) => setVCategory(e.target.value as ContentCategory)}
                  className={inputClass}
                >
                  {CATEGORY_LIST.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                {locale === 'id' ? 'Subjudul / Tagline Singkat' : 'Subtitle / Logline'}
              </label>
              <input
                type="text"
                maxLength={220}
                value={vSubtitle}
                onChange={(e) => setVSubtitle(e.target.value)}
                placeholder={
                  locale === 'id'
                    ? 'Ringkasan 1 baris yang tampil di bawah judul (min. 4 karakter)'
                    : 'Short one-line hook shown below the title'
                }
                className={inputClass}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                {locale === 'id'
                  ? 'Sinopsis / Deskripsi Lengkap (min. 10 karakter)'
                  : 'Description / Synopsis (min. 10 characters)'}
              </label>
              <textarea
                rows={4}
                maxLength={2000}
                value={vDescription}
                onChange={(e) => setVDescription(e.target.value)}
                placeholder={
                  locale === 'id'
                    ? 'Ceritakan alur film, dokumenter, atau materi kelas master Anda...'
                    : 'Describe the film, documentary, or educational curriculum...'
                }
                className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>

            <CoverPicker
              locale={locale}
              value={vThumbnail}
              titleHint={vTitle}
              presets={THUMBNAIL_PRESETS}
              youtubeVideoId={
                vSourceMode === 'youtube' ? extractYouTubeVideoId(vYoutubeUrl) : null
              }
              videoPreviewUrl={vSourceMode === 'file' ? vVideoPreviewUrl : null}
              videoFileName={vUploadedFileName}
              autoCapturing={autoCapturingCover}
              onChange={(nextUrl, isExplicit) => {
                setVThumbnail(nextUrl);
                if (isExplicit) setVHasExplicitCover(true);
              }}
            />

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                {locale === 'id' ? 'Resolusi & Format Audio' : 'Resolution & Audio'}
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <select
                  value={vResolution}
                  onChange={(e) =>
                    setVResolution(e.target.value as '4K HDR' | '4K UHD' | '1080p HD')
                  }
                  className={inputClass}
                >
                  <option value="4K HDR">4K HDR</option>
                  <option value="4K UHD">4K UHD</option>
                  <option value="1080p HD">1080p HD</option>
                </select>
                <input
                  type="text"
                  value={vAudio}
                  onChange={(e) => setVAudio(e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <span className="block text-xs font-semibold text-slate-900 dark:text-white">
                    {locale === 'id' ? 'Model Akses & Harga' : 'Access & Pricing Model'}
                  </span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    {locale === 'id'
                      ? 'Pilih apakah tayangan ini berbayar (PPV + pratinjau 5 menit) atau gratis penuh.'
                      : 'Choose whether viewers pay per view (5-min preview) or stream completely free.'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shrink-0">
                  <button
                    type="button"
                    onClick={() => setVPricingMode('paid')}
                    className={`min-h-[36px] px-3 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                      vPricingMode === 'paid'
                        ? 'bg-emerald-600 text-white'
                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {locale === 'id' ? 'Berbayar (PPV)' : 'Paid (PPV)'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setVPricingMode('free')}
                    className={`min-h-[36px] px-3 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                      vPricingMode === 'free'
                        ? 'bg-emerald-600 text-white'
                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {locale === 'id' ? 'Gratis (Bebas Akses)' : 'Free Release'}
                  </button>
                </div>
              </div>

              {vPricingMode === 'free' && (
                <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800/70 text-xs text-emerald-800 dark:text-emerald-300">
                  {locale === 'id'
                    ? 'Mode Gratis aktif (Rp 0 / $0.00 · 0 Kredit). Penonton dapat menonton tayangan penuh tanpa batas pratinjau 5 menit dan tanpa pembayaran.'
                    : 'Free Release active ($0.00 / Rp 0 · 0 Credits). Viewers can watch the full release immediately with no 5-minute paywall or checkout.'}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                  {locale === 'id' ? 'Durasi (menit)' : 'Duration (min)'}
                </label>
                <input
                  type="number"
                  min={1}
                  max={600}
                  value={vDuration}
                  onChange={(e) => setVDuration(Number(e.target.value))}
                  className={`${inputClass} font-mono tabular-nums`}
                />
              </div>
              {vPricingMode === 'paid' && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                      {locale === 'id' ? 'Harga (USD)' : 'Price (USD)'}
                    </label>
                    <input
                      type="number"
                      step="0.50"
                      min={0.99}
                      value={vPriceUsd}
                      onChange={(e) => setVPriceUsd(Number(e.target.value))}
                      className={`${inputClass} font-mono tabular-nums`}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                      {locale === 'id' ? 'Harga (IDR)' : 'Price (IDR)'}
                    </label>
                    <input
                      type="number"
                      step="1000"
                      min={10000}
                      value={vPriceIdr}
                      onChange={(e) => setVPriceIdr(Number(e.target.value))}
                      className={`${inputClass} font-mono tabular-nums`}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                      {locale === 'id' ? 'Harga Kredit' : 'Credit Cost'}
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={500}
                      value={vCreditCost}
                      onChange={(e) => setVCreditCost(Number(e.target.value))}
                      className={`${inputClass} font-mono tabular-nums`}
                    />
                  </div>
                </>
              )}
            </div>

            <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-3 pt-2">
              <Button
                variant="primary"
                size="md"
                className="w-full sm:w-auto"
                isLoading={submittingVideo}
                disabled={uploadingVideoFile || autoCapturingCover}
                onClick={() => void handleSubmitVideo('pending_review')}
              >
                {locale === 'id' ? 'Ajukan ke Moderasi' : 'Submit for Moderation'}
              </Button>
              <Button
                variant="outline"
                size="md"
                className="w-full sm:w-auto"
                isLoading={submittingVideo}
                disabled={uploadingVideoFile || autoCapturingCover}
                onClick={() => void handleSubmitVideo('draft')}
              >
                {locale === 'id' ? 'Simpan sebagai Draf' : 'Save as Draft'}
              </Button>
            </div>
          </div>
        </section>
      )}

      {/* ANALYTICS, EARNINGS & PAYOUTS */}
      {activeTab === 'analytics' && (
        <section className="space-y-6">
          {earningsError && (
            <ErrorState
              title={locale === 'id' ? 'Gagal Memuat Pendapatan' : 'Unable to Load Earnings Ledger'}
              description={earningsError}
              retryLabel={locale === 'id' ? 'Coba Lagi' : 'Retry'}
              onRetry={() => setEarningsRetryTick((t) => t + 1)}
            />
          )}

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-8 space-y-5 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">
                  {locale === 'id'
                    ? 'Analitik, Pendapatan & Penarikan Dana'
                    : 'Analytics, Earnings & Payouts'}
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                  {locale === 'id'
                    ? `Komisi platform aktif: ${earningsSummary?.commissionPercent ?? 20}%. Pendapatan bersih dihitung otomatis di server pada setiap pembelian.`
                    : `Active platform commission: ${earningsSummary?.commissionPercent ?? 20}%. Net creator revenue calculates server-side on every verified purchase.`}
                </p>
              </div>
              <span className="text-xs font-mono text-emerald-700 dark:text-emerald-400 font-semibold">
                {creatorProfile.verified ? 'Verified Creator' : 'Pending Verification'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <p className="text-xs text-slate-500 dark:text-slate-400">Available Net (USD)</p>
                <p className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1">
                  {formatPrice(earningsSummary?.availableUsd ?? 0, 0, 'USD')}
                </p>
                <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-1">
                  Gross: {formatPrice(earningsSummary?.grossUsd ?? 0, 0, 'USD')}
                </p>
              </div>
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <p className="text-xs text-slate-500 dark:text-slate-400">Available Net (IDR)</p>
                <p className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400 mt-1">
                  {formatPrice(0, earningsSummary?.availableIdr ?? 0, 'IDR')}
                </p>
                <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-1">
                  Gross: {formatPrice(0, earningsSummary?.grossIdr ?? 0, 'IDR')}
                </p>
              </div>
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {locale === 'id' ? 'Rilisan Tayang Aktif' : 'Active Published Releases'}
                </p>
                <p className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1">
                  {publishedCount}
                </p>
              </div>
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {locale === 'id' ? 'Akumulasi Penayangan' : 'Cumulative Stream Views'}
                </p>
                <p className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1">
                  {totalViews}
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Request Payout Form */}
            <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4 shadow-xs">
              <h3 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                {locale === 'id' ? 'Ajukan Penarikan Dana (Payout)' : 'Request Payout'}
              </h3>

              {payoutErr && (
                <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800/70 text-xs text-rose-700 dark:text-rose-300">
                  {payoutErr}
                </div>
              )}
              {payoutMsg && (
                <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/70 text-xs text-emerald-800 dark:text-emerald-300">
                  {payoutMsg}
                </div>
              )}

              <form onSubmit={handleRequestPayout} className="space-y-3.5">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                      Currency
                    </label>
                    <select
                      value={payoutCurrency}
                      onChange={(e) => {
                        const nextCur = e.target.value as 'USD' | 'IDR';
                        setPayoutCurrency(nextCur);
                        setPayoutMethod(
                          nextCur === 'IDR' ? 'bank_transfer_idr' : 'paypal_usd'
                        );
                      }}
                      className={inputClass}
                    >
                      <option value="USD">USD ($)</option>
                      <option value="IDR">IDR (Rp)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                      Amount
                    </label>
                    <input
                      type="number"
                      step={payoutCurrency === 'USD' ? '0.01' : '1000'}
                      min={payoutCurrency === 'USD' ? 1 : 10000}
                      value={payoutAmount}
                      onChange={(e) => setPayoutAmount(e.target.value)}
                      placeholder={payoutCurrency === 'USD' ? '25.00' : '250000'}
                      className={`${inputClass} font-mono tabular-nums`}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Payout Channel
                  </label>
                  <select
                    value={payoutMethod}
                    onChange={(e) =>
                      setPayoutMethod(
                        e.target.value as
                          | 'bank_transfer_idr'
                          | 'ewallet_idr'
                          | 'paypal_usd'
                      )
                    }
                    className={inputClass}
                  >
                    {payoutCurrency === 'USD' ? (
                      <option value="paypal_usd">PayPal Business / Personal (USD)</option>
                    ) : (
                      <>
                        <option value="bank_transfer_idr">Indonesian Bank Transfer (BCA/Mandiri/BRI)</option>
                        <option value="ewallet_idr">Indonesian E-Wallet (GoPay/OVO/DANA)</option>
                      </>
                    )}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Account / Destination
                  </label>
                  <input
                    type="text"
                    value={payoutDest}
                    onChange={(e) => setPayoutDest(e.target.value)}
                    placeholder="PayPal email or BCA 1234567890"
                    className={inputClass}
                  />
                </div>

                <Button
                  type="submit"
                  variant="primary"
                  size="md"
                  className="w-full"
                  isLoading={requestingPayout}
                >
                  {locale === 'id' ? 'Kirim Permintaan Payout' : 'Submit Payout Request'}
                </Button>
              </form>
            </div>

            {/* Earnings & Payout History Ledgers */}
            <div className="lg:col-span-7 space-y-6">
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-3 shadow-xs">
                <h3 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                  {locale === 'id' ? 'Riwayat Pendapatan Konten' : 'Earnings Ledger'}
                </h3>
                {loadingEarnings && !earningsSummary ? (
                  <div className="space-y-2.5">
                    <ListRowSkeleton />
                  </div>
                ) : !earningsSummary || earningsSummary.earnings.length === 0 ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {locale === 'id'
                      ? 'Belum ada pendapatan tercatat untuk karya Anda.'
                      : 'Verified Pay-Per-View and Credit unlocks on your published titles will appear here.'}
                  </p>
                ) : (
                  <div className="divide-y divide-slate-200 dark:divide-slate-800">
                    {earningsSummary.earnings.map((e) => (
                      <div key={e.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900 dark:text-white break-words">
                            {e.videoTitle}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-0.5">
                            {e.status.toUpperCase()} · Fee {e.commissionPercent}% ·{' '}
                            {formatLocalizedDate(e.createdAt, locale)}
                          </p>
                        </div>
                        <span className="text-sm font-mono tabular-nums font-semibold text-emerald-700 dark:text-emerald-400 shrink-0">
                          +
                          {e.method === 'qris'
                            ? formatPrice(0, e.netIdr, 'IDR')
                            : formatPrice(e.netUsd, 0, 'USD')}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-3 shadow-xs">
                <h3 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                  {locale === 'id' ? 'Riwayat Payout' : 'Payout History'}
                </h3>
                {!earningsSummary || earningsSummary.payouts.length === 0 ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {locale === 'id'
                      ? 'Belum ada pengajuan penarikan dana.'
                      : 'Your submitted payout requests and settlement status will appear here.'}
                  </p>
                ) : (
                  <div className="divide-y divide-slate-200 dark:divide-slate-800">
                    {earningsSummary.payouts.map((po) => (
                      <div key={po.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900 dark:text-white break-words">
                            {po.destination}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-0.5">
                            {po.method} · {po.status.toUpperCase()} ·{' '}
                            {formatLocalizedDate(po.createdAt, locale)}
                          </p>
                          {po.adminNote && (
                            <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-0.5">{po.adminNote}</p>
                          )}
                        </div>
                        <span className="text-sm font-mono tabular-nums font-semibold text-slate-900 dark:text-white shrink-0">
                          {po.currency === 'USD'
                            ? formatPrice(po.amountUsd, 0, 'USD')
                            : formatPrice(0, po.amountIdr, 'IDR')}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* CREATOR PROFILE */}
      {activeTab === 'profile' && (
        <section className="max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-8 space-y-5 shadow-xs">
          <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">
            {locale === 'id' ? 'Edit Profil Publik Kreator' : 'Edit Public Creator Profile'}
          </h2>
          {creatorMsg && (
            <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/70 text-xs text-emerald-800 dark:text-emerald-300">
              {creatorMsg}
            </div>
          )}
          {creatorErr && (
            <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800/70 text-xs text-rose-700 dark:text-rose-300">
              {creatorErr}
            </div>
          )}
          <form onSubmit={handleSaveCreatorProfile} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                  {locale === 'id' ? 'Nama Kreator' : 'Creator Name'}
                </label>
                <input
                  type="text"
                  value={cName}
                  onChange={(e) => setCName(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                  {locale === 'id' ? 'Lokasi' : 'Location'}
                </label>
                <input
                  type="text"
                  value={cLocation}
                  onChange={(e) => setCLocation(e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                Bio
              </label>
              <textarea
                rows={3}
                value={cBio}
                onChange={(e) => setCBio(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>
            <Button type="submit" variant="primary" size="md" className="w-full sm:w-auto" isLoading={savingCreator}>
              {locale === 'id' ? 'Perbarui Profil Kreator' : 'Update Creator Profile'}
            </Button>
          </form>
        </section>
      )}

      {/* Edit Existing Cover Modal */}
      {editingCoverItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/75 dark:bg-slate-950/85 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-cover-modal-title"
        >
          <div className="w-full max-w-2xl max-h-[90dvh] flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                  {locale === 'id' ? 'Perbarui Tampilan Galeri' : 'Update Gallery Cover'}
                </p>
                <h3
                  id="edit-cover-modal-title"
                  className="text-sm sm:text-base font-bold text-slate-900 dark:text-white truncate"
                >
                  {editingCoverItem.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingCoverItem(null)}
                aria-label="Close cover editor"
                className="min-w-[40px] min-h-[40px] inline-flex items-center justify-center rounded-xl text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/70 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4">
              {editingCoverErr && (
                <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800/70 text-xs text-rose-700 dark:text-rose-300">
                  {editingCoverErr}
                </div>
              )}

              <CoverPicker
                locale={locale}
                value={editingCoverUrl}
                titleHint={editingCoverItem.title}
                presets={THUMBNAIL_PRESETS}
                onChange={(nextUrl) => setEditingCoverUrl(nextUrl)}
              />
            </div>

            <div className="px-5 py-3.5 bg-slate-50 dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditingCoverItem(null)}
              >
                {locale === 'id' ? 'Batal' : 'Cancel'}
              </Button>
              <Button
                variant="primary"
                size="sm"
                isLoading={savingEditedCover}
                onClick={async () => {
                  setEditingCoverErr(null);
                  setSavingEditedCover(true);
                  try {
                    await updateVideoCover(editingCoverItem.id, editingCoverUrl);
                    setVideoMsg(
                      locale === 'id'
                        ? `Cover "${editingCoverItem.title}" berhasil diperbarui di galeri!`
                        : `Gallery cover for "${editingCoverItem.title}" updated!`
                    );
                    setEditingCoverItem(null);
                  } catch (err) {
                    setEditingCoverErr(
                      formatFriendlyError(
                        err,
                        'Gagal memperbarui cover tayangan.',
                        'Unable to update cover.'
                      )
                    );
                  } finally {
                    setSavingEditedCover(false);
                  }
                }}
              >
                {locale === 'id' ? 'Simpan Cover Baru' : 'Save New Cover'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
