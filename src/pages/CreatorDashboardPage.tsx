import React, { useEffect, useRef, useState } from 'react';
import {
  Archive,
  BarChart3,
  CheckCircle2,
  Film,
  Image as ImageIcon,
  Send,
  Upload,
  UserCheck,
  Video,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  creatorArchiveVideo,
  createCreatorVideo,
  creatorPublishApprovedVideo,
  creatorSubmitForReview,
  subscribeCreatorVideos,
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
  CATEGORY_LIST,
  formatDuration,
  formatLocalizedDate,
  formatPrice,
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
    label: 'Obsidian Observatory',
    url: '/src/assets/images/hero_featured_film_1794930897673.jpg',
  },
  {
    label: 'Volcanic Caldera',
    url: '/src/assets/images/thumb_archipelago_doc_1794930897547.jpg',
  },
  {
    label: 'Tokyo Nocturne',
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

const AVATAR_PRESETS = [
  '/src/assets/images/creator_portrait_aria_1794930901280.jpg',
  '/src/assets/images/creator_portrait_kenji_1794930900668.jpg',
  '/src/assets/images/creator_portrait_elena_1794930901501.jpg',
  '/src/assets/images/creator_portrait_dimas_1794930901730.jpg',
];

export const CreatorDashboardPage: React.FC<CreatorDashboardPageProps> = ({
  locale,
  currency,
  onNavigate,
}) => {
  const { firebaseUser, userProfile, creatorProfile, authReady } = useAuth();
  const [activeTab, setActiveTab] = useState<CreatorTab>('content');
  const [videos, setVideos] = useState<ContentItem[]>([]);
  const [uploadHighlight, setUploadHighlight] = useState(false);
  const uploadSectionRef = useRef<HTMLElement | null>(null);
  const videoFileInputRef = useRef<HTMLInputElement | null>(null);
  const thumbFileInputRef = useRef<HTMLInputElement | null>(null);

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
    creatorProfile?.avatarUrl || AVATAR_PRESETS[3]
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
  const [vDuration, setVDuration] = useState(65);
  const [vResolution, setVResolution] = useState<'4K HDR' | '4K UHD' | '1080p HD'>(
    '4K HDR'
  );
  const [vAudio, setVAudio] = useState('Dolby Atmos');
  const [vPriceUsd, setVPriceUsd] = useState(4.99);
  const [vPriceIdr, setVPriceIdr] = useState(75000);
  const [vCreditCost, setVCreditCost] = useState(5);
  const [vSourceMode, setVSourceMode] = useState<'file' | 'preset' | 'manual'>('file');
  const [vProvider, setVProvider] = useState<'cloudflare_stream' | 'private_storage'>(
    'private_storage'
  );
  const [vAssetRef, setVAssetRef] = useState('');
  const [vUploadedFileName, setVUploadedFileName] = useState<string | null>(null);
  const [vUploadedMimeType, setVUploadedMimeType] = useState<string | undefined>(undefined);
  const [uploadingVideoFile, setUploadingVideoFile] = useState(false);
  const [videoUploadProgress, setVideoUploadProgress] = useState<number | null>(null);
  const [streamCaps, setStreamCaps] = useState<StreamCapabilities>({
    cloudflareStreamConfigured: false,
    cloudflareSigningConfigured: false,
  });
  const [uploadingThumbFile, setUploadingThumbFile] = useState(false);
  const [submittingVideo, setSubmittingVideo] = useState(false);
  const [videoMsg, setVideoMsg] = useState<string | null>(null);
  const [videoErr, setVideoErr] = useState<string | null>(null);

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
    } else if (userProfile?.displayName && !cName) {
      setCName(userProfile.displayName);
    }
  }, [creatorProfile, userProfile]);

  useEffect(() => {
    if (!authReady || !firebaseUser || !creatorProfile) return;
    const unsub = subscribeCreatorVideos(firebaseUser.uid, setVideos);
    return () => unsub();
  }, [authReady, firebaseUser, creatorProfile]);

  useEffect(() => {
    void fetchStreamCapabilities().then(setStreamCaps);
  }, []);

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
              ? 'Masuk terlebih dahulu untuk mengakses Studio Kreator VYORA.'
              : 'Sign in with your VYORA account to open or apply for Creator Studio.'
          }
          actionLabel={locale === 'id' ? 'Masuk ke VYORA' : 'Sign In'}
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
      ? 10 * 1024 * 1024 * 1024 // 10 GB direct via Cloudflare Stream TUS
      : 100 * 1024 * 1024; // 100 MB fallback on server disk

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

    // Best-effort read duration locally from video metadata
    try {
      const objectUrl = URL.createObjectURL(file);
      const probe = document.createElement('video');
      probe.preload = 'metadata';
      probe.onloadedmetadata = () => {
        if (Number.isFinite(probe.duration) && probe.duration > 0) {
          setVDuration(Math.max(1, Math.round(probe.duration / 60)));
        }
        URL.revokeObjectURL(objectUrl);
      };
      probe.src = objectUrl;
    } catch {
      // Ignore duration probe errors
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

  const handleThumbnailFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setVideoErr(null);

    if (file.size > 5 * 1024 * 1024) {
      setVideoErr(
        locale === 'id'
          ? 'Ukuran gambar sampul maksimal 5MB.'
          : 'Cover thumbnail image must be 5MB or smaller.'
      );
      e.target.value = '';
      return;
    }

    setUploadingThumbFile(true);
    try {
      const uploaded = await uploadCreatorMedia(file);
      if (uploaded.kind === 'thumbnail') {
        setVThumbnail(uploaded.thumbnailUrl);
      }
    } catch (err) {
      setVideoErr(
        formatFriendlyError(
          err,
          'Gagal mengunggah gambar sampul.',
          'Failed to upload cover thumbnail.'
        )
      );
    } finally {
      setUploadingThumbFile(false);
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

    const effectiveProvider =
      vSourceMode === 'preset' ? 'private_storage' : vProvider;
    const effectiveAssetRef =
      vSourceMode === 'preset' && vAssetRef.trim().length < 3
        ? vCategory === 'Documentary' || vCategory === 'Education'
          ? 'stream-doc'
          : 'stream-cinema'
        : vAssetRef.trim();

    if (effectiveAssetRef.length < 3) {
      setVideoErr(
        locale === 'id'
          ? 'Silakan unggah file video terlebih dahulu, atau pilih tab "Stream Studio" jika ingin memakai master siap tayang.'
          : 'Please upload a video file first, or select "Ready Studio Stream" / enter a stream UID.'
      );
      return;
    }

    setSubmittingVideo(true);
    try {
      const videoId = await createCreatorVideo(firebaseUser.uid, creatorProfile.name, {
        title: vTitle,
        subtitle: vSubtitle,
        description: vDescription,
        descriptionId: vDescription,
        category: vCategory,
        thumbnailUrl: vThumbnail,
        durationMinutes: Number(vDuration),
        priceUsd: Number(vPriceUsd),
        priceIdr: Number(vPriceIdr),
        creditCost: Number(vCreditCost),
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
        mimeType: vUploadedMimeType,
      }).catch(() => {
        // Non-blocking fallback
      });

      setVTitle('');
      setVSubtitle('');
      setVDescription('');
      setVAssetRef('');
      setVUploadedFileName(null);
      setVUploadedMimeType(undefined);
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
        <div className="bg-[#1B1C27] border border-white/10 rounded-2xl p-5 sm:p-9 space-y-6">
          <div className="space-y-2">
            <p className="text-xs font-semibold text-[#A78BFA]">
              {locale === 'id' ? 'Studio Kreator VYORA' : 'VYORA Creator Studio'}
            </p>
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#F5F5F7]">
              {locale === 'id'
                ? 'Aktifkan Profil Kreator Anda'
                : 'Set Up Your Creator Studio Profile'}
            </h1>
            <p className="text-sm text-[#A5A6B2] leading-relaxed">
              {locale === 'id'
                ? 'Buat profil studio kreator Anda untuk mulai menyusun draf dan mengajukan film, dokumenter, kelas master, atau acara langsung ke moderasi.'
                : 'Register your studio profile to draft and submit films, documentaries, masterclasses, or live events for moderation.'}
            </p>
          </div>

          {creatorErr && (
            <div
              role="alert"
              className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300"
            >
              {creatorErr}
            </div>
          )}

          <form onSubmit={handleSaveCreatorProfile} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[#A5A6B2] mb-1.5">
                  {locale === 'id' ? 'Nama Kreator / Studio' : 'Creator / Studio Name'}
                </label>
                <input
                  type="text"
                  required
                  value={cName}
                  onChange={(e) => setCName(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[#11121A] border border-white/12 text-sm text-[#F5F5F7] focus:outline-none focus:ring-2 focus:ring-[#7957ED]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#A5A6B2] mb-1.5">
                  Handle (@username)
                </label>
                <input
                  type="text"
                  required
                  value={cHandle}
                  onChange={(e) => setCHandle(e.target.value)}
                  placeholder="@studio_name"
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[#11121A] border border-white/12 text-sm text-[#F5F5F7] focus:outline-none focus:ring-2 focus:ring-[#7957ED]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-[#A5A6B2] mb-1.5">
                  {locale === 'id' ? 'Peran / Bidang' : 'Role / Craft'}
                </label>
                <input
                  type="text"
                  required
                  value={cRole}
                  onChange={(e) => setCRole(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[#11121A] border border-white/12 text-sm text-[#F5F5F7] focus:outline-none focus:ring-2 focus:ring-[#7957ED]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#A5A6B2] mb-1.5">
                  {locale === 'id' ? 'Lokasi' : 'Location'}
                </label>
                <input
                  type="text"
                  required
                  value={cLocation}
                  onChange={(e) => setCLocation(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[#11121A] border border-white/12 text-sm text-[#F5F5F7] focus:outline-none focus:ring-2 focus:ring-[#7957ED]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#A5A6B2] mb-1.5">
                  {locale === 'id' ? 'Kategori Utama' : 'Primary Category'}
                </label>
                <select
                  value={cSpecialty}
                  onChange={(e) => setCSpecialty(e.target.value as ContentCategory)}
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[#11121A] border border-white/12 text-sm text-[#F5F5F7] focus:outline-none focus:ring-2 focus:ring-[#7957ED]"
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
                <label className="block text-xs font-medium text-[#A5A6B2]">
                  {locale === 'id' ? 'Bio Kreator' : 'Creator Bio'}
                </label>
                <span className="text-[11px] font-mono text-[#A5A6B2]">
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
                    ? 'Ceritakan profil film, dokumenter, atau kelas master Anda (minimal 10 karakter)...'
                    : 'Tell viewers about your filmmaking, educational focus, or studio work (min. 10 characters)...'
                }
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#11121A] border border-white/12 text-sm text-[#F5F5F7] focus:outline-none focus:ring-2 focus:ring-[#7957ED]"
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
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 sm:pb-6 border-b border-white/8">
        <div className="flex items-center gap-3.5 sm:gap-4 min-w-0">
          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full overflow-hidden border border-white/15 shrink-0">
            <MediaImage
              src={creatorProfile.avatarUrl}
              alt={creatorProfile.name}
              fallbackTitle={creatorProfile.name}
              className="w-full h-full"
            />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-[#A78BFA] font-semibold">
              <span>{locale === 'id' ? 'Studio Kreator' : 'Creator Studio'}</span>
              <span aria-hidden="true">·</span>
              <span className="capitalize">
                {creatorProfile.verified
                  ? locale === 'id'
                    ? 'Kreator Terverifikasi'
                    : 'Verified Creator'
                  : `Status: ${creatorProfile.status ?? 'pending'}`}
              </span>
            </div>
            <h1 className="font-display text-xl sm:text-3xl font-bold text-[#F5F5F7] truncate">
              {creatorProfile.name}
            </h1>
            <p className="text-xs text-[#A5A6B2] truncate">
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

      {/* Navigation Tabs (placed directly below header so tab switches stay above the fold) */}
      <div
        role="tablist"
        aria-label="Creator studio sections"
        className="flex items-center gap-2 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0 vyora-scroll"
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
                ? 'bg-[#7957ED] text-[#F5F5F7]'
                : 'bg-[#1B1C27] text-[#A5A6B2] hover:text-[#F5F5F7] border border-white/8'
            }`}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* KPI Strip (shown on content & analytics views so upload form stays immediately in view) */}
      {(activeTab === 'content' || activeTab === 'analytics') && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <div className="bg-[#1B1C27] border border-white/8 rounded-xl p-4 sm:p-5">
            <p className="text-xs text-[#A5A6B2]">
              {locale === 'id' ? 'Total Konten' : 'Total Submissions'}
            </p>
            <p className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-[#F5F5F7] mt-1">
              {videos.length}
            </p>
          </div>
          <div className="bg-[#1B1C27] border border-white/8 rounded-xl p-4 sm:p-5">
            <p className="text-xs text-[#A5A6B2]">
              {locale === 'id' ? 'Tayang Publik' : 'Published'}
            </p>
            <p className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-[#A78BFA] mt-1">
              {publishedCount}
            </p>
          </div>
          <div className="bg-[#1B1C27] border border-white/8 rounded-xl p-4 sm:p-5">
            <p className="text-xs text-[#A5A6B2]">
              {locale === 'id' ? 'Menunggu Moderasi' : 'Pending Moderation'}
            </p>
            <p className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-[#F5F5F7] mt-1">
              {pendingCount}
            </p>
          </div>
          <div className="bg-[#1B1C27] border border-white/8 rounded-xl p-4 sm:p-5">
            <p className="text-xs text-[#A5A6B2]">
              {locale === 'id' ? 'Total Penayangan' : 'Total Views'}
            </p>
            <p className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-[#F5F5F7] mt-1">
              {totalViews}
            </p>
          </div>
        </div>
      )}

      {/* CONTENT MANAGEMENT */}
      {activeTab === 'content' && (
        <section className="space-y-4">
          {videoMsg && (
            <div className="p-4 rounded-xl bg-[#7957ED]/15 border border-[#7957ED]/40 text-xs text-[#F5F5F7] flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-[#A78BFA] shrink-0" />
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
                  className="bg-[#1B1C27] border border-white/8 rounded-xl p-3.5 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-3.5 sm:gap-4"
                >
                  <div className="flex items-start gap-3 sm:gap-4 min-w-0">
                    <div className="w-24 sm:w-36 aspect-video rounded-lg overflow-hidden shrink-0 bg-[#11121A]">
                      <MediaImage
                        src={vid.thumbnailUrl}
                        alt={vid.title}
                        fallbackTitle={vid.title}
                        className="w-full h-full"
                      />
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] sm:text-xs text-[#A5A6B2]">
                        <span className="text-[#A78BFA] font-semibold uppercase tracking-wide">
                          {vid.status.replace('_', ' ')}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{vid.category}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          {formatDuration(vid.durationMinutes, locale)}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          {formatPrice(vid.priceUsd, vid.priceIdr, currency)}
                        </span>
                      </div>
                      <h3 className="text-sm sm:text-base font-semibold text-[#F5F5F7] break-words line-clamp-2 sm:line-clamp-none">
                        {vid.title}
                      </h3>
                      <p className="text-xs text-[#A5A6B2] line-clamp-1">{vid.subtitle}</p>
                      {vid.moderationNote && (
                        <p className="text-xs text-amber-300 mt-1">
                          {locale === 'id' ? 'Catatan moderasi: ' : 'Moderation note: '}
                          {vid.moderationNote}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-2.5 border-t border-white/6 md:border-t-0 md:pt-0 shrink-0">
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
          className={`max-w-3xl bg-[#1B1C27] border rounded-2xl p-5 sm:p-8 space-y-6 scroll-mt-20 transition-all duration-300 ${
            uploadHighlight
              ? 'border-[#A78BFA] ring-2 ring-[#7957ED]/60'
              : 'border-white/10'
          }`}
        >
          <div>
            <h2 className="font-display text-xl font-bold text-[#F5F5F7]">
              {locale === 'id'
                ? 'Unggah Video & Ajukan Tayangan Baru'
                : 'Upload Video & Submit New Release'}
            </h2>
            <p className="text-xs text-[#A5A6B2] mt-1">
              {locale === 'id'
                ? 'Unggah file video (.MP4 / .WebM / .MOV) langsung dari perangkat Anda atau pilih Stream Master Studio. Metadata tersimpan di Firestore dan berkas video diamankan di penyimpanan privat.'
                : 'Upload a video file (.MP4 / .WebM / .MOV) directly from your device or select a ready Studio Stream. Metadata writes to Firestore while video assets stay strictly private.'}
            </p>
          </div>

          {videoErr && (
            <div
              role="alert"
              className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300"
            >
              {videoErr}
            </div>
          )}

          <div className="space-y-5">
            {/* Step 1: Video Media Source Picker */}
            <div className="p-4 rounded-xl bg-[#11121A] border border-white/10 space-y-3.5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[#F5F5F7]">
                  {locale === 'id' ? '1. Sumber Berkas Video' : '1. Video Media Source'}
                </span>
                <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-[#1B1C27] border border-white/10">
                  {[
                    {
                      id: 'file' as const,
                      label: locale === 'id' ? 'Unggah File' : 'Upload File',
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
                        } else if (modeOpt.id === 'manual') {
                          setVProvider('cloudflare_stream');
                          if (vAssetRef === 'stream-cinema' || vAssetRef === 'stream-doc') {
                            setVAssetRef('');
                          }
                        }
                      }}
                      className={`min-h-[34px] px-2.5 rounded-md text-[11px] font-semibold transition-colors cursor-pointer ${
                        vSourceMode === modeOpt.id
                          ? 'bg-[#7957ED] text-[#F5F5F7]'
                          : 'text-[#A5A6B2] hover:text-[#F5F5F7]'
                      }`}
                    >
                      {modeOpt.label}
                    </button>
                  ))}
                </div>
              </div>

              {vSourceMode === 'file' && (
                <div className="space-y-3">
                  <div className="relative flex flex-col items-center justify-center gap-2 p-5 rounded-xl border border-dashed border-[#7957ED]/50 bg-[#1B1C27]/60 hover:bg-[#1B1C27] transition-colors text-center">
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
                      <Video className="w-6 h-6 text-[#A78BFA]" aria-hidden="true" />
                      <span className="text-xs font-semibold text-[#F5F5F7]">
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
                      <span className="text-[11px] text-[#A5A6B2]">
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
                      <div className="h-2 w-full rounded-full bg-[#1B1C27] overflow-hidden border border-white/10">
                        <div
                          className="h-full bg-[#7957ED] transition-all duration-200"
                          style={{ width: `${videoUploadProgress}%` }}
                        />
                      </div>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="secondary"
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
                      <span className="text-[11px] font-mono text-[#A78BFA] truncate max-w-xs">
                        ✓ {vUploadedFileName}
                        {vProvider === 'cloudflare_stream' ? ' · Cloudflare HLS' : ''}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {vSourceMode === 'preset' && (
                <div className="space-y-2">
                  <label className="block text-xs text-[#A5A6B2]">
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
                    className="w-full min-h-[44px] px-3.5 py-2 rounded-xl bg-[#1B1C27] border border-white/12 text-sm text-[#F5F5F7]"
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
                    <label className="block text-xs font-medium text-[#A5A6B2] mb-1.5">
                      {locale === 'id' ? 'Penyedia Stream' : 'Stream Provider'}
                    </label>
                    <select
                      value={vProvider}
                      onChange={(e) =>
                        setVProvider(
                          e.target.value as 'cloudflare_stream' | 'private_storage'
                        )
                      }
                      className="w-full min-h-[44px] px-3 py-2 rounded-xl bg-[#1B1C27] border border-white/12 text-sm text-[#F5F5F7]"
                    >
                      <option value="cloudflare_stream">Cloudflare Stream</option>
                      <option value="private_storage">Private Object Storage</option>
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-[#A5A6B2] mb-1.5">
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
                      className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[#1B1C27] border border-white/12 text-sm font-mono text-[#F5F5F7]"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[#A5A6B2] mb-1.5">
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
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[#11121A] border border-white/12 text-sm text-[#F5F5F7] focus:outline-none focus:ring-2 focus:ring-[#7957ED]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#A5A6B2] mb-1.5">
                  {locale === 'id' ? 'Kategori' : 'Category'}
                </label>
                <select
                  value={vCategory}
                  onChange={(e) => setVCategory(e.target.value as ContentCategory)}
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[#11121A] border border-white/12 text-sm text-[#F5F5F7] focus:outline-none focus:ring-2 focus:ring-[#7957ED]"
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
              <label className="block text-xs font-medium text-[#A5A6B2] mb-1.5">
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
                className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[#11121A] border border-white/12 text-sm text-[#F5F5F7] focus:outline-none focus:ring-2 focus:ring-[#7957ED]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#A5A6B2] mb-1.5">
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
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#11121A] border border-white/12 text-sm text-[#F5F5F7] focus:outline-none focus:ring-2 focus:ring-[#7957ED]"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="block text-xs font-medium text-[#A5A6B2]">
                  {locale === 'id' ? 'Poster / Cover Tayangan' : 'Thumbnail Artwork'}
                </label>
                <div className="flex items-center gap-3">
                  <div className="w-20 aspect-video rounded-lg overflow-hidden bg-[#11121A] border border-white/10 shrink-0">
                    <MediaImage
                      src={vThumbnail}
                      alt="Cover preview"
                      fallbackTitle={vTitle || 'VYORA'}
                      className="w-full h-full"
                    />
                  </div>
                  <div className="flex-1 min-w-0 space-y-2">
                    <select
                      value={
                        THUMBNAIL_PRESETS.some((p) => p.url === vThumbnail)
                          ? vThumbnail
                          : ''
                      }
                      onChange={(e) => {
                        if (e.target.value) setVThumbnail(e.target.value);
                      }}
                      className="w-full min-h-[40px] px-3 py-1.5 rounded-xl bg-[#11121A] border border-white/12 text-xs text-[#F5F5F7] focus:outline-none focus:ring-2 focus:ring-[#7957ED]"
                    >
                      {!THUMBNAIL_PRESETS.some((p) => p.url === vThumbnail) && (
                        <option value="">
                          {locale === 'id' ? 'Gambar Kustom Terunggah' : 'Custom Uploaded Cover'}
                        </option>
                      )}
                      {THUMBNAIL_PRESETS.map((preset) => (
                        <option key={preset.url} value={preset.url}>
                          {preset.label}
                        </option>
                      ))}
                    </select>
                    <div className="flex items-center gap-2">
                      <input
                        ref={thumbFileInputRef}
                        type="file"
                        accept="image/*,.jpg,.jpeg,.png,.webp"
                        disabled={uploadingThumbFile}
                        onChange={(e) => void handleThumbnailFileChange(e)}
                        className="hidden"
                      />
                      <button
                        type="button"
                        disabled={uploadingThumbFile}
                        onClick={() => thumbFileInputRef.current?.click()}
                        className="inline-flex items-center gap-1.5 min-h-[34px] px-2.5 py-1 rounded-lg bg-[#11121A] border border-white/12 text-[11px] font-semibold text-[#A78BFA] hover:text-[#F5F5F7] hover:border-[#7957ED]/60 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        <ImageIcon className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>
                          {uploadingThumbFile
                            ? locale === 'id'
                              ? 'Mengunggah sampul...'
                              : 'Uploading cover...'
                            : locale === 'id'
                            ? 'Atau Unggah Cover Sendiri (JPG/PNG)'
                            : 'Or Upload Custom Cover (JPG/PNG)'}
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#A5A6B2] mb-1.5">
                  {locale === 'id' ? 'Resolusi & Format Audio' : 'Resolution & Audio'}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={vResolution}
                    onChange={(e) =>
                      setVResolution(e.target.value as '4K HDR' | '4K UHD' | '1080p HD')
                    }
                    className="min-h-[44px] px-3 py-2 rounded-xl bg-[#11121A] border border-white/12 text-sm text-[#F5F5F7]"
                  >
                    <option value="4K HDR">4K HDR</option>
                    <option value="4K UHD">4K UHD</option>
                    <option value="1080p HD">1080p HD</option>
                  </select>
                  <input
                    type="text"
                    value={vAudio}
                    onChange={(e) => setVAudio(e.target.value)}
                    className="min-h-[44px] px-3 py-2 rounded-xl bg-[#11121A] border border-white/12 text-sm text-[#F5F5F7]"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-medium text-[#A5A6B2] mb-1.5">
                  {locale === 'id' ? 'Durasi (menit)' : 'Duration (min)'}
                </label>
                <input
                  type="number"
                  min={1}
                  max={600}
                  value={vDuration}
                  onChange={(e) => setVDuration(Number(e.target.value))}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl bg-[#11121A] border border-white/12 text-sm font-mono tabular-nums text-[#F5F5F7]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#A5A6B2] mb-1.5">
                  {locale === 'id' ? 'Harga (USD)' : 'Price (USD)'}
                </label>
                <input
                  type="number"
                  step="0.50"
                  min={0.99}
                  value={vPriceUsd}
                  onChange={(e) => setVPriceUsd(Number(e.target.value))}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl bg-[#11121A] border border-white/12 text-sm font-mono tabular-nums text-[#F5F5F7]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#A5A6B2] mb-1.5">
                  {locale === 'id' ? 'Harga (IDR)' : 'Price (IDR)'}
                </label>
                <input
                  type="number"
                  step="1000"
                  min={10000}
                  value={vPriceIdr}
                  onChange={(e) => setVPriceIdr(Number(e.target.value))}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl bg-[#11121A] border border-white/12 text-sm font-mono tabular-nums text-[#F5F5F7]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#A5A6B2] mb-1.5">
                  {locale === 'id' ? 'Harga Kredit' : 'Credit Cost'}
                </label>
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={vCreditCost}
                  onChange={(e) => setVCreditCost(Number(e.target.value))}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl bg-[#11121A] border border-white/12 text-sm font-mono tabular-nums text-[#F5F5F7]"
                />
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-3 pt-2">
              <Button
                variant="primary"
                size="md"
                className="w-full sm:w-auto"
                isLoading={submittingVideo}
                disabled={uploadingVideoFile || uploadingThumbFile}
                onClick={() => void handleSubmitVideo('pending_review')}
              >
                {locale === 'id' ? 'Ajukan ke Moderasi' : 'Submit for Moderation'}
              </Button>
              <Button
                variant="secondary"
                size="md"
                className="w-full sm:w-auto"
                isLoading={submittingVideo}
                disabled={uploadingVideoFile || uploadingThumbFile}
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

          <div className="bg-[#1B1C27] border border-white/10 rounded-2xl p-5 sm:p-8 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-xl font-bold text-[#F5F5F7]">
                  {locale === 'id'
                    ? 'Analitik, Pendapatan & Penarikan Dana'
                    : 'Analytics, Earnings & Payouts'}
                </h2>
                <p className="text-xs text-[#A5A6B2] mt-1">
                  {locale === 'id'
                    ? `Komisi platform aktif: ${earningsSummary?.commissionPercent ?? 20}%. Pendapatan bersih dihitung otomatis di server pada setiap pembelian.`
                    : `Active platform commission: ${earningsSummary?.commissionPercent ?? 20}%. Net creator revenue calculates server-side on every verified purchase.`}
                </p>
              </div>
              <span className="text-xs font-mono text-[#A78BFA] font-semibold">
                {creatorProfile.verified ? 'Verified Creator' : 'Pending Verification'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <div className="p-4 rounded-xl bg-[#11121A] border border-white/8">
                <p className="text-xs text-[#A5A6B2]">Available Net (USD)</p>
                <p className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-[#F5F5F7] mt-1">
                  {formatPrice(earningsSummary?.availableUsd ?? 0, 0, 'USD')}
                </p>
                <p className="text-[11px] font-mono text-[#A5A6B2] mt-1">
                  Gross: {formatPrice(earningsSummary?.grossUsd ?? 0, 0, 'USD')}
                </p>
              </div>
              <div className="p-4 rounded-xl bg-[#11121A] border border-white/8">
                <p className="text-xs text-[#A5A6B2]">Available Net (IDR)</p>
                <p className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-[#A78BFA] mt-1">
                  {formatPrice(0, earningsSummary?.availableIdr ?? 0, 'IDR')}
                </p>
                <p className="text-[11px] font-mono text-[#A5A6B2] mt-1">
                  Gross: {formatPrice(0, earningsSummary?.grossIdr ?? 0, 'IDR')}
                </p>
              </div>
              <div className="p-4 rounded-xl bg-[#11121A] border border-white/8">
                <p className="text-xs text-[#A5A6B2]">
                  {locale === 'id' ? 'Rilisan Tayang Aktif' : 'Active Published Releases'}
                </p>
                <p className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-[#F5F5F7] mt-1">
                  {publishedCount}
                </p>
              </div>
              <div className="p-4 rounded-xl bg-[#11121A] border border-white/8">
                <p className="text-xs text-[#A5A6B2]">
                  {locale === 'id' ? 'Akumulasi Penayangan' : 'Cumulative Stream Views'}
                </p>
                <p className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-[#F5F5F7] mt-1">
                  {totalViews}
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Request Payout Form */}
            <div className="lg:col-span-5 bg-[#1B1C27] border border-white/10 rounded-2xl p-6 space-y-4">
              <h3 className="font-display text-lg font-bold text-[#F5F5F7]">
                {locale === 'id' ? 'Ajukan Penarikan Dana (Payout)' : 'Request Payout'}
              </h3>

              {payoutErr && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300">
                  {payoutErr}
                </div>
              )}
              {payoutMsg && (
                <div className="p-3 rounded-xl bg-[#7957ED]/15 border border-[#7957ED]/40 text-xs text-[#F5F5F7]">
                  {payoutMsg}
                </div>
              )}

              <form onSubmit={handleRequestPayout} className="space-y-3.5">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-[#A5A6B2] mb-1">
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
                      className="w-full min-h-[42px] px-3 py-2 rounded-xl bg-[#11121A] border border-white/12 text-sm text-[#F5F5F7]"
                    >
                      <option value="USD">USD ($)</option>
                      <option value="IDR">IDR (Rp)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#A5A6B2] mb-1">
                      Amount
                    </label>
                    <input
                      type="number"
                      step={payoutCurrency === 'USD' ? '0.01' : '1000'}
                      min={payoutCurrency === 'USD' ? 1 : 10000}
                      value={payoutAmount}
                      onChange={(e) => setPayoutAmount(e.target.value)}
                      placeholder={payoutCurrency === 'USD' ? '25.00' : '250000'}
                      className="w-full min-h-[42px] px-3 py-2 rounded-xl bg-[#11121A] border border-white/12 text-sm font-mono tabular-nums text-[#F5F5F7]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#A5A6B2] mb-1">
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
                    className="w-full min-h-[42px] px-3 py-2 rounded-xl bg-[#11121A] border border-white/12 text-sm text-[#F5F5F7]"
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
                  <label className="block text-xs font-medium text-[#A5A6B2] mb-1">
                    Account / Destination
                  </label>
                  <input
                    type="text"
                    value={payoutDest}
                    onChange={(e) => setPayoutDest(e.target.value)}
                    placeholder="PayPal email or BCA 1234567890"
                    className="w-full min-h-[42px] px-3 py-2 rounded-xl bg-[#11121A] border border-white/12 text-sm text-[#F5F5F7]"
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
              <div className="bg-[#1B1C27] border border-white/10 rounded-2xl p-6 space-y-3">
                <h3 className="font-display text-lg font-bold text-[#F5F5F7]">
                  {locale === 'id' ? 'Riwayat Pendapatan Konten' : 'Earnings Ledger'}
                </h3>
                {loadingEarnings && !earningsSummary ? (
                  <div className="space-y-2.5">
                    <ListRowSkeleton />
                  </div>
                ) : !earningsSummary || earningsSummary.earnings.length === 0 ? (
                  <p className="text-xs text-[#A5A6B2]">
                    {locale === 'id'
                      ? 'Belum ada pendapatan tercatat untuk karya Anda.'
                      : 'Verified Pay-Per-View and Credit unlocks on your published titles will appear here.'}
                  </p>
                ) : (
                  <div className="divide-y divide-white/8">
                    {earningsSummary.earnings.map((e) => (
                      <div key={e.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-[#F5F5F7] break-words">
                            {e.videoTitle}
                          </p>
                          <p className="text-xs text-[#A5A6B2] font-mono mt-0.5">
                            {e.status.toUpperCase()} · Fee {e.commissionPercent}% ·{' '}
                            {formatLocalizedDate(e.createdAt, locale)}
                          </p>
                        </div>
                        <span className="text-sm font-mono tabular-nums font-semibold text-[#A78BFA] shrink-0">
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

              <div className="bg-[#1B1C27] border border-white/10 rounded-2xl p-5 sm:p-6 space-y-3">
                <h3 className="font-display text-lg font-bold text-[#F5F5F7]">
                  {locale === 'id' ? 'Riwayat Payout' : 'Payout History'}
                </h3>
                {!earningsSummary || earningsSummary.payouts.length === 0 ? (
                  <p className="text-xs text-[#A5A6B2]">
                    {locale === 'id'
                      ? 'Belum ada pengajuan penarikan dana.'
                      : 'Your submitted payout requests and settlement status will appear here.'}
                  </p>
                ) : (
                  <div className="divide-y divide-white/8">
                    {earningsSummary.payouts.map((po) => (
                      <div key={po.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-[#F5F5F7] break-words">
                            {po.destination}
                          </p>
                          <p className="text-xs text-[#A5A6B2] font-mono mt-0.5">
                            {po.method} · {po.status.toUpperCase()} ·{' '}
                            {formatLocalizedDate(po.createdAt, locale)}
                          </p>
                          {po.adminNote && (
                            <p className="text-xs text-[#A78BFA] mt-0.5">{po.adminNote}</p>
                          )}
                        </div>
                        <span className="text-sm font-mono tabular-nums font-semibold text-[#F5F5F7] shrink-0">
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
        <section className="max-w-2xl bg-[#1B1C27] border border-white/10 rounded-2xl p-5 sm:p-8 space-y-5">
          <h2 className="font-display text-xl font-bold text-[#F5F5F7]">
            {locale === 'id' ? 'Edit Profil Publik Kreator' : 'Edit Public Creator Profile'}
          </h2>
          {creatorMsg && (
            <div className="p-3.5 rounded-xl bg-[#7957ED]/15 border border-[#7957ED]/40 text-xs text-[#F5F5F7]">
              {creatorMsg}
            </div>
          )}
          {creatorErr && (
            <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300">
              {creatorErr}
            </div>
          )}
          <form onSubmit={handleSaveCreatorProfile} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[#A5A6B2] mb-1.5">
                  {locale === 'id' ? 'Nama Kreator' : 'Creator Name'}
                </label>
                <input
                  type="text"
                  value={cName}
                  onChange={(e) => setCName(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[#11121A] border border-white/12 text-sm text-[#F5F5F7]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#A5A6B2] mb-1.5">
                  {locale === 'id' ? 'Lokasi' : 'Location'}
                </label>
                <input
                  type="text"
                  value={cLocation}
                  onChange={(e) => setCLocation(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[#11121A] border border-white/12 text-sm text-[#F5F5F7]"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#A5A6B2] mb-1.5">
                Bio
              </label>
              <textarea
                rows={3}
                value={cBio}
                onChange={(e) => setCBio(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#11121A] border border-white/12 text-sm text-[#F5F5F7]"
              />
            </div>
            <Button type="submit" variant="primary" size="md" className="w-full sm:w-auto" isLoading={savingCreator}>
              {locale === 'id' ? 'Perbarui Profil Kreator' : 'Update Creator Profile'}
            </Button>
          </form>
        </section>
      )}
    </div>
  );
};
