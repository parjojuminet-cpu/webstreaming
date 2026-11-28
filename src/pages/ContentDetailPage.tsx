import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Bookmark,
  Calendar,
  CheckCircle2,
  Clock,
  Eye,
  Film,
  Lock,
  Play,
  ShieldCheck,
  Star,
  UserCheck,
  UserPlus,
  Wallet,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  submitContentReview,
  subscribeContentReviews,
} from '../services/firestoreService';
import {
  authorizeVideoStream,
  type StreamAuthorizationResponse,
} from '../services/streamService';
import type {
  ContentItem,
  CreatorProfile,
  CurrencyCode,
  LocaleCode,
  ReviewItem,
} from '../types/vyora';
import {
  CATEGORY_LABELS_ID,
  formatDuration,
  formatLocalizedDate,
  formatPrice,
  isFreeContent,
} from '../i18n/translations';
import { buildAbsoluteShareUrl } from '../utils/navigation';
import { formatViewCount } from '../utils/share';
import { Button } from '../components/ui/Button';
import { ContentCard } from '../components/ui/ContentCard';
import { MediaImage } from '../components/ui/MediaImage';
import { ShareActions } from '../components/ui/ShareActions';

interface ContentDetailPageProps {
  item: ContentItem;
  creator?: CreatorProfile;
  relatedItems: ContentItem[];
  reviews: ReviewItem[];
  locale: LocaleCode;
  currency: CurrencyCode;
  entitlementRefreshKey?: number;
  savedVideoIds?: Set<string>;
  followedCreatorIds?: Set<string>;
  onBack: () => void;
  onWatchPreview: (item: ContentItem) => void;
  onSelectContent: (item: ContentItem) => void;
  onExploreCreator: (creatorId: string) => void;
  onToggleSave?: (item: ContentItem) => void;
  onToggleFollow?: (creatorId: string) => void;
  onRequestUnlock: (method: 'ppv' | 'credits', item: ContentItem) => void;
  onReportContent?: (item: ContentItem) => void;
}

function formatResumeTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export const ContentDetailPage: React.FC<ContentDetailPageProps> = ({
  item,
  creator,
  relatedItems,
  reviews,
  locale,
  currency,
  entitlementRefreshKey = 0,
  savedVideoIds,
  followedCreatorIds,
  onBack,
  onWatchPreview,
  onSelectContent,
  onExploreCreator,
  onToggleSave,
  onToggleFollow,
  onRequestUnlock,
  onReportContent,
}) => {
  const { firebaseUser, userProfile } = useAuth();
  const [streamAuth, setStreamAuth] = useState<StreamAuthorizationResponse | null>(null);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [liveReviews, setLiveReviews] = useState<ReviewItem[]>([]);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewMsg, setReviewMsg] = useState<string | null>(null);
  const [reviewErr, setReviewErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCheckingAccess(true);
    void authorizeVideoStream(item.id, item.category)
      .then((res) => {
        if (!cancelled) setStreamAuth(res);
      })
      .catch(() => {
        if (!cancelled) setStreamAuth(null);
      })
      .finally(() => {
        if (!cancelled) setCheckingAccess(false);
      });
    return () => {
      cancelled = true;
    };
  }, [item.id, item.category, firebaseUser?.uid, entitlementRefreshKey]);

  useEffect(() => {
    const unsub = subscribeContentReviews(item.id, setLiveReviews);
    return () => unsub();
  }, [item.id]);

  const combinedReviews = React.useMemo(() => {
    const map = new Map<string, ReviewItem>();
    for (const r of liveReviews) map.set(r.id, r);
    for (const r of reviews) {
      if (!map.has(r.id)) map.set(r.id, r);
    }
    return Array.from(map.values()).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );
  }, [liveReviews, reviews]);

  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser) return;
    setReviewErr(null);
    setReviewMsg(null);
    if (reviewComment.trim().length < 5) {
      setReviewErr(
        locale === 'id'
          ? 'Ulasan minimal 5 karakter.'
          : 'Review comment must be at least 5 characters.'
      );
      return;
    }
    setSubmittingReview(true);
    try {
      await submitContentReview({
        userId: firebaseUser.uid,
        contentId: item.id,
        authorName: userProfile?.displayName || firebaseUser.displayName || 'DELOKEN Viewer',
        rating: reviewRating,
        comment: reviewComment,
      });
      setReviewComment('');
      setReviewRating(5);
      setReviewMsg(
        locale === 'id' ? 'Ulasan Anda telah diterbitkan.' : 'Your review has been posted.'
      );
    } catch (err) {
      setReviewErr(err instanceof Error ? err.message : 'Unable to post review.');
    } finally {
      setSubmittingReview(false);
    }
  };

  const isFree = isFreeContent(item) || Boolean(streamAuth?.isFree);
  const isUnlocked = streamAuth?.mode === 'full' && Boolean(streamAuth.entitlement);
  const resumeSeconds = streamAuth?.resumeSeconds ?? 0;
  const remainingDays = streamAuth?.entitlement?.remainingDays ?? 30;
  const categoryLabel = locale === 'id' ? CATEGORY_LABELS_ID[item.category] : item.category;
  const synopsis = locale === 'id' ? item.descriptionId : item.description;

  return (
    <div className="pb-8 sm:pb-12">
      {/* Cinematic Backdrop Header (high-contrast slate-950 scrim over 16:9 key art) */}
      <section className="relative min-h-[280px] sm:min-h-[420px] lg:min-h-[480px] flex items-end overflow-hidden border-b border-slate-200 dark:border-slate-800 bg-slate-950">
        <div className="absolute inset-0">
          <MediaImage
            src={item.backdropUrl}
            alt={item.title}
            fallbackTitle={item.title}
            loading="eager"
            className="w-full h-full"
          />
          <div
            className="absolute inset-0 bg-gradient-to-r from-slate-950 via-slate-950/85 sm:via-slate-950/80 to-slate-950/35 sm:to-slate-950/25"
            aria-hidden="true"
          />
          <div
            className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/55 sm:via-slate-950/45 to-transparent"
            aria-hidden="true"
          />
        </div>

        <div className="relative z-10 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-3 sm:pt-8 pb-5 sm:pb-10 space-y-2.5 sm:space-y-5">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 min-h-[36px] text-xs font-semibold text-slate-300 hover:text-white transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            <span>{locale === 'id' ? 'Kembali ke Katalog' : 'Back to Catalog'}</span>
          </button>

          <div className="max-w-3xl space-y-2 sm:space-y-3.5">
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 text-[11px] sm:text-sm text-slate-300">
              <span className="text-emerald-400 font-semibold">{categoryLabel}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                {formatDuration(item.durationMinutes, locale)}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">{item.releaseYear}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">{item.resolution}</span>
              {item.aspectRatio && item.aspectRatio !== 'auto' && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">{item.aspectRatio}</span>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1 font-mono tabular-nums text-white">
                <Star className="w-3.5 h-3.5 text-emerald-400 fill-current" aria-hidden="true" />
                {item.rating.toFixed(1)} ({item.reviewCount})
              </span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1 font-mono tabular-nums text-slate-200">
                <Eye className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                {formatViewCount(item.viewCount, locale)}
              </span>
              {Boolean(item.trending || (item.viewCount ?? 0) >= 25) && (
                <span className="px-1.5 py-0.5 rounded-[5px] bg-amber-500/90 text-slate-950 text-[10px] font-bold leading-none">
                  {locale === 'id' ? 'Populer' : 'Popular'}
                </span>
              )}
            </div>

            <h1 className="font-display text-xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-white leading-tight">
              {item.title}
            </h1>

            <p className="text-xs sm:text-base text-slate-200 leading-relaxed line-clamp-2 sm:line-clamp-none">
              {item.subtitle}
            </p>

            <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2.5 sm:gap-3 pt-1 sm:pt-2">
              <Button
                variant="primary"
                size="lg"
                className="w-full sm:w-auto"
                leftIcon={<Play className="w-4 h-4 fill-current" />}
                onClick={() => onWatchPreview(item)}
              >
                {isFree
                  ? locale === 'id'
                    ? 'Tonton Gratis Sekarang'
                    : 'Watch Free Now'
                  : isUnlocked
                  ? resumeSeconds > 0
                    ? locale === 'id'
                      ? `Lanjutkan Tayangan (${formatResumeTime(resumeSeconds)})`
                      : `Resume Watching (${formatResumeTime(resumeSeconds)})`
                    : locale === 'id'
                    ? 'Tonton Tayangan Penuh'
                    : 'Watch Full Release'
                  : locale === 'id'
                  ? 'Tonton Pratinjau 5 Menit'
                  : 'Watch 5-Min Free Preview'}
              </Button>
              {!isFree && !isUnlocked && (
                <Button
                  variant="secondary"
                  size="lg"
                  className="w-full sm:w-auto"
                  onClick={() => onRequestUnlock('ppv', item)}
                >
                  {locale === 'id'
                    ? `Buka Akses · ${formatPrice(item.priceUsd, item.priceIdr, currency)}`
                    : `Unlock Title · ${formatPrice(item.priceUsd, item.priceIdr, currency)}`}
                </Button>
              )}

              <div className="flex items-center gap-2">
                {onToggleSave && (
                  <button
                    type="button"
                    onClick={() => onToggleSave(item)}
                    aria-pressed={Boolean(savedVideoIds?.has(item.id))}
                    className={`min-h-[42px] inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl border text-xs sm:text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                      savedVideoIds?.has(item.id)
                        ? 'bg-emerald-600 text-white border-emerald-500'
                        : 'bg-white/95 dark:bg-slate-900/95 border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100 hover:bg-white dark:hover:bg-slate-800'
                    }`}
                  >
                    <Bookmark
                      className={`w-4 h-4 ${savedVideoIds?.has(item.id) ? 'fill-current' : ''}`}
                      aria-hidden="true"
                    />
                    <span>
                      {savedVideoIds?.has(item.id)
                        ? locale === 'id'
                          ? 'Tersimpan'
                          : 'Saved'
                        : locale === 'id'
                        ? 'Simpan'
                        : 'Save'}
                    </span>
                  </button>
                )}

                <ShareActions
                  title={item.title}
                  url={buildAbsoluteShareUrl({ route: 'detail', contentId: item.id })}
                  locale={locale}
                />
              </div>
            </div>

            {isFree ? (
              <p className="text-xs text-emerald-300 pt-0.5">
                {locale === 'id'
                  ? 'Tayangan gratis dari kreator · Akses penuh tanpa batasan 5 menit & tanpa pembayaran'
                  : 'Free creator release · Unlimited full playback with no 5-minute cap or checkout'}
              </p>
            ) : (
              !isUnlocked && (
                <p className="text-xs text-slate-300 pt-0.5 tabular-nums">
                  {locale === 'id'
                    ? `Akses 30 hari penuh · atau gunakan ${item.creditCost} Kredit DELOKEN`
                    : `30-day streaming access · or unlock with ${item.creditCost} DELOKEN Credits`}
                </p>
              )
            )}
          </div>
        </div>
      </section>

      {/* Main Content Layout: Synopsis + Credits flow first on mobile; sticky Access sidebar on lg desktop */}
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 pt-4 sm:pt-8 grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-8">
        {/* Left Column: Synopsis, Technical Specs, Credits, Reviews */}
        <div className="lg:col-span-8 space-y-5 sm:space-y-8">
          <section className="space-y-1.5 sm:space-y-2.5">
            <h2 className="font-display text-base sm:text-xl font-bold text-slate-900 dark:text-white">
              {locale === 'id' ? 'Sinopsis' : 'Synopsis'}
            </h2>
            <p className="text-xs sm:text-base text-slate-600 dark:text-slate-300 leading-relaxed">{synopsis}</p>
          </section>

          {/* Creator & Production Credits */}
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 space-y-4 sm:space-y-5 shadow-xs">
            {creator && (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 pb-4 sm:pb-5 border-b border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full overflow-hidden border border-slate-200 dark:border-slate-700 shrink-0 bg-slate-100 dark:bg-slate-800">
                    <MediaImage
                      src={creator.avatarUrl}
                      alt={creator.name}
                      fallbackTitle={creator.name}
                      className="w-full h-full"
                    />
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {locale === 'id' ? 'Dipublikasikan oleh' : 'Published by'}
                    </p>
                    <p className="text-base font-semibold text-slate-900 dark:text-white">{creator.name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {creator.location}
                      {(creator.followerCount ?? 0) > 0 &&
                        ` · ${creator.followerCount} ${locale === 'id' ? 'pengikut' : 'followers'}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {onToggleFollow && (
                    <Button
                      variant={followedCreatorIds?.has(creator.id) ? 'secondary' : 'primary'}
                      size="sm"
                      leftIcon={
                        followedCreatorIds?.has(creator.id) ? (
                          <UserCheck className="w-4 h-4" aria-hidden="true" />
                        ) : (
                          <UserPlus className="w-4 h-4" aria-hidden="true" />
                        )
                      }
                      onClick={() => onToggleFollow(creator.id)}
                    >
                      {followedCreatorIds?.has(creator.id)
                        ? locale === 'id'
                          ? 'Mengikuti'
                          : 'Following'
                        : locale === 'id'
                        ? 'Ikuti'
                        : 'Follow'}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onExploreCreator(creator.id)}
                  >
                    {locale === 'id' ? 'Lihat Profil Kreator' : 'Explore Creator'}
                  </Button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {locale === 'id' ? 'Sutradara' : 'Director'}
                </p>
                <p className="font-medium text-slate-900 dark:text-slate-100 mt-0.5">{item.credits.director}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {locale === 'id' ? 'Sinematografi' : 'Cinematography'}
                </p>
                <p className="font-medium text-slate-900 dark:text-slate-100 mt-0.5">
                  {item.credits.cinematography}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {locale === 'id' ? 'Desain Suara' : 'Sound & Mastering'}
                </p>
                <p className="font-medium text-slate-900 dark:text-slate-100 mt-0.5">{item.credits.sound}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {locale === 'id' ? 'Audio & Bahasa' : 'Audio & Languages'}
                </p>
                <p className="font-medium text-slate-900 dark:text-slate-100 mt-0.5">
                  {item.audioFormat} · {item.languages.join(', ')}
                </p>
              </div>
            </div>
          </section>

          {/* Viewer Reviews */}
          <section className="space-y-4">
            <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">
              {locale === 'id' ? 'Ulasan Penonton' : 'Viewer Reviews'}
            </h2>

            {firebaseUser && (
              <form
                onSubmit={handleSubmitReview}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3 shadow-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs font-semibold text-slate-900 dark:text-white">
                    {locale === 'id' ? 'Tulis Ulasan Anda' : 'Share Your Review'}
                  </span>
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setReviewRating(star)}
                        aria-label={`Rate ${star} stars`}
                        className={`min-w-[44px] min-h-[44px] sm:min-w-[32px] sm:min-h-[32px] flex items-center justify-center rounded-lg cursor-pointer transition-colors ${
                          star <= reviewRating ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-300 dark:text-slate-600'
                        }`}
                      >
                        <Star className="w-4 h-4 fill-current" aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                </div>
                {reviewErr && (
                  <p role="alert" className="text-xs text-rose-700 dark:text-rose-400">
                    {reviewErr}
                  </p>
                )}
                {reviewMsg && (
                  <p role="status" className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                    {reviewMsg}
                  </p>
                )}
                <textarea
                  rows={2}
                  maxLength={1000}
                  value={reviewComment}
                  onChange={(e) => setReviewComment(e.target.value)}
                  placeholder={
                    locale === 'id'
                      ? 'Bagikan kesan Anda tentang kualitas sinematografi, audio, atau materi...'
                      : 'Share your thoughts on cinematography, sound design, or pacing...'
                  }
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
                <div className="flex justify-end">
                  <Button type="submit" variant="primary" size="sm" isLoading={submittingReview}>
                    {locale === 'id' ? 'Kirim Ulasan' : 'Post Review'}
                  </Button>
                </div>
              </form>
            )}

            {combinedReviews.length === 0 ? (
              <p className="text-sm text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
                {locale === 'id'
                  ? 'Belum ada ulasan untuk tayangan ini. Jadilah penonton pertama yang membagikan ulasan.'
                  : 'No viewer reviews yet. Be the first viewer to leave a review for this release.'}
              </p>
            ) : (
              <div className="space-y-3">
                {combinedReviews.map((rev) => (
                  <article
                    key={rev.id}
                    className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-2 shadow-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span className="font-semibold text-slate-900 dark:text-white inline-flex flex-wrap items-center gap-2">
                        <span>
                          {rev.authorName} · {rev.authorLocation}
                        </span>
                        <span className="inline-flex items-center gap-0.5 text-emerald-700 dark:text-emerald-400 font-mono">
                          <Star className="w-3 h-3 fill-current" aria-hidden="true" />
                          {rev.rating}
                        </span>
                      </span>
                      <span className="font-mono tabular-nums">
                        {formatLocalizedDate(rev.createdAt, locale)}
                      </span>
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{rev.comment}</p>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Right Column: Pay-Per-View & Credit Wallet Access Card */}
        <aside className="lg:col-span-4">
          <div className="lg:sticky lg:top-24 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-5 shadow-xs">
            {checkingAccess && !streamAuth && !isFree ? (
              <div aria-busy="true" className="space-y-4 animate-pulse">
                <div className="h-3 w-32 bg-slate-200 dark:bg-slate-800 rounded" />
                <div className="h-9 w-28 bg-slate-200 dark:bg-slate-800 rounded" />
                <div className="space-y-2.5 pt-2 border-t border-slate-200 dark:border-slate-800">
                  <div className="h-3 w-full bg-slate-200 dark:bg-slate-800 rounded" />
                  <div className="h-3 w-5/6 bg-slate-200 dark:bg-slate-800 rounded" />
                  <div className="h-3 w-4/5 bg-slate-200 dark:bg-slate-800 rounded" />
                </div>
                <div className="h-11 w-full bg-slate-200 dark:bg-slate-800 rounded-xl" />
              </div>
            ) : isFree ? (
              <>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                    <span>{locale === 'id' ? 'Akses Gratis Penuh' : 'Free Open Access'}</span>
                  </div>
                  <div className="text-3xl font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                    {locale === 'id' ? 'Gratis' : 'Free'}
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    {locale === 'id'
                      ? 'Dirilis gratis oleh kreator · Tanpa batasan 5 menit'
                      : 'Released free by the creator · No 5-minute preview cap'}
                  </p>
                </div>

                <div className="space-y-3 pt-3 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300">
                  <div className="flex items-center gap-2.5">
                    <Clock className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />
                    <span>
                      {locale === 'id'
                        ? 'Streaming penuh tanpa perlu checkout atau kredit'
                        : 'Full unlimited playback with zero checkout required'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <Film className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />
                    <span>
                      {item.resolution} · {item.audioFormat}
                    </span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />
                    <span>
                      {locale === 'id'
                        ? 'Pemutar terproteksi dari klik keluar sumber'
                        : 'Protected player blocks accidental external redirects'}
                    </span>
                  </div>
                </div>

                <div className="space-y-2.5 pt-2">
                  <Button
                    variant="primary"
                    size="md"
                    className="w-full"
                    leftIcon={<Play className="w-4 h-4 fill-current" />}
                    onClick={() => onWatchPreview(item)}
                  >
                    {locale === 'id' ? 'Putar Tayangan Gratis' : 'Watch Free Release'}
                  </Button>
                  {onReportContent && (
                    <button
                      type="button"
                      onClick={() => onReportContent(item)}
                      className="w-full pt-2 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                    >
                      {locale === 'id' ? 'Laporkan Tayangan Ini' : 'Report this release'}
                    </button>
                  )}
                </div>
              </>
            ) : isUnlocked && streamAuth?.entitlement ? (
              <>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                    <span>
                      {locale === 'id' ? 'Akses 30 Hari Aktif' : '30-Day Access Active'}
                    </span>
                  </div>
                  <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                    {locale === 'id'
                      ? `Tersisa ${remainingDays} Hari`
                      : `${remainingDays} Days Remaining`}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                    {locale === 'id' ? 'Berakhir pada ' : 'Expires '}
                    {formatLocalizedDate(streamAuth.entitlement.expiresAt, locale)}
                    {resumeSeconds > 0
                      ? ` · ${
                          locale === 'id' ? 'Posisi tersimpan' : 'Saved'
                        } ${formatResumeTime(resumeSeconds)}`
                      : ''}
                  </p>
                </div>

                <div className="space-y-2.5 pt-2 border-t border-slate-200 dark:border-slate-800">
                  <Button
                    variant="primary"
                    size="md"
                    className="w-full"
                    leftIcon={<Play className="w-4 h-4 fill-current" />}
                    onClick={() => onWatchPreview(item)}
                  >
                    {resumeSeconds > 0
                      ? locale === 'id'
                        ? `Lanjutkan dari ${formatResumeTime(resumeSeconds)}`
                        : `Resume from ${formatResumeTime(resumeSeconds)}`
                      : locale === 'id'
                      ? 'Putar Tayangan Penuh'
                      : 'Watch Full Release'}
                  </Button>
                  {onReportContent && (
                    <button
                      type="button"
                      onClick={() => onReportContent(item)}
                      className="w-full pt-2 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                    >
                      {locale === 'id' ? 'Laporkan Tayangan Ini' : 'Report this release'}
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                    <Lock className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>
                      {locale === 'id' ? 'Akses Pay-Per-View' : 'Pay-Per-View Access'}
                    </span>
                  </div>
                  <div className="text-3xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                    {formatPrice(item.priceUsd, item.priceIdr, currency)}
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    {locale === 'id'
                      ? `Atau buka dengan ${item.creditCost} Kredit DELOKEN`
                      : `Or unlock with ${item.creditCost} DELOKEN Credits`}
                  </p>
                </div>

                <div className="space-y-3 pt-3 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300">
                  <div className="flex items-center gap-2.5">
                    <Clock className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />
                    <span>
                      {locale === 'id'
                        ? 'Pratinjau gratis 5 menit langsung tersedia'
                        : 'First 5 minutes free before paying'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <Calendar className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />
                    <span>
                      {locale === 'id'
                        ? 'Akses streaming penuh selama 30 hari'
                        : '30 days of unlimited streaming after purchase'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <Film className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />
                    <span>
                      {item.resolution} · {item.audioFormat}
                    </span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />
                    <span>
                      {locale === 'id'
                        ? 'Mendukung PayPal & QRIS Indonesia'
                        : 'Supports PayPal & Indonesian QRIS'}
                    </span>
                  </div>
                </div>

                <div className="space-y-2.5 pt-2">
                  <Button
                    variant="primary"
                    size="md"
                    className="w-full"
                    onClick={() => onRequestUnlock('ppv', item)}
                  >
                    {locale === 'id' ? 'Buka dengan PayPal / QRIS' : 'Unlock via PayPal / QRIS'}
                  </Button>
                  <Button
                    variant="outline"
                    size="md"
                    className="w-full"
                    leftIcon={<Wallet className="w-4 h-4" />}
                    onClick={() => onRequestUnlock('credits', item)}
                  >
                    {locale === 'id'
                      ? `Gunakan ${item.creditCost} Kredit`
                      : `Unlock with ${item.creditCost} Credits`}
                  </Button>
                  {onReportContent && (
                    <button
                      type="button"
                      onClick={() => onReportContent(item)}
                      className="w-full pt-2 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                    >
                      {locale === 'id' ? 'Laporkan Tayangan Ini' : 'Report this release'}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </aside>
      </div>

      {/* Related Releases */}
      {relatedItems.length > 0 && (
        <section className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 pt-6 sm:pt-12 space-y-3 sm:space-y-5">
          <h2 className="font-display text-lg sm:text-2xl font-bold text-slate-900 dark:text-white">
            {locale === 'id' ? 'Tayangan Terkait' : 'More to Experience'}
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-5">
            {relatedItems.map((rel) => (
              <ContentCard
                key={rel.id}
                item={rel}
                locale={locale}
                currency={currency}
                isSaved={savedVideoIds?.has(rel.id)}
                onSelectContent={onSelectContent}
                onWatchPreview={onWatchPreview}
                onSelectCreator={onExploreCreator}
                onToggleSave={onToggleSave}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
