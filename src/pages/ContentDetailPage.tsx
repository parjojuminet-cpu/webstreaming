import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  Film,
  Lock,
  Play,
  ShieldCheck,
  Star,
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
} from '../i18n/translations';
import { Button } from '../components/ui/Button';
import { ContentCard } from '../components/ui/ContentCard';
import { MediaImage } from '../components/ui/MediaImage';

interface ContentDetailPageProps {
  item: ContentItem;
  creator?: CreatorProfile;
  relatedItems: ContentItem[];
  reviews: ReviewItem[];
  locale: LocaleCode;
  currency: CurrencyCode;
  entitlementRefreshKey?: number;
  onBack: () => void;
  onWatchPreview: (item: ContentItem) => void;
  onSelectContent: (item: ContentItem) => void;
  onExploreCreator: (creatorId: string) => void;
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
  onBack,
  onWatchPreview,
  onSelectContent,
  onExploreCreator,
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
        authorName: userProfile?.displayName || firebaseUser.displayName || 'VYORA Viewer',
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

  const isUnlocked = streamAuth?.mode === 'full' && Boolean(streamAuth.entitlement);
  const resumeSeconds = streamAuth?.resumeSeconds ?? 0;
  const remainingDays = streamAuth?.entitlement?.remainingDays ?? 30;
  const categoryLabel = locale === 'id' ? CATEGORY_LABELS_ID[item.category] : item.category;
  const synopsis = locale === 'id' ? item.descriptionId : item.description;

  return (
    <div className="pb-16">
      {/* Cinematic Backdrop Header */}
      <section className="relative min-h-[380px] sm:min-h-[460px] lg:min-h-[540px] flex items-end overflow-hidden border-b border-white/8">
        <div className="absolute inset-0">
          <MediaImage
            src={item.backdropUrl}
            alt={item.title}
            fallbackTitle={item.title}
            loading="eager"
            className="w-full h-full"
          />
          <div
            className="absolute inset-0 bg-gradient-to-r from-[#11121A] via-[#11121A]/85 sm:via-[#11121A]/80 to-[#11121A]/30 sm:to-[#11121A]/25"
            aria-hidden="true"
          />
          <div
            className="absolute inset-0 bg-gradient-to-t from-[#11121A] via-[#11121A]/55 sm:via-[#11121A]/45 to-transparent"
            aria-hidden="true"
          />
        </div>

        <div className="relative z-10 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 pt-6 sm:pt-10 pb-8 sm:pb-12 space-y-4 sm:space-y-6">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 min-h-[44px] text-xs font-semibold text-[#A5A6B2] hover:text-[#F5F5F7] transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            <span>{locale === 'id' ? 'Kembali ke Katalog' : 'Back to Catalog'}</span>
          </button>

          <div className="max-w-3xl space-y-3 sm:space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm text-[#A5A6B2]">
              <span className="text-[#A78BFA] font-semibold">{categoryLabel}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                {formatDuration(item.durationMinutes, locale)}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">{item.releaseYear}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">{item.resolution}</span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1 font-mono tabular-nums text-[#F5F5F7]">
                <Star className="w-3.5 h-3.5 text-[#A78BFA] fill-current" aria-hidden="true" />
                {item.rating.toFixed(1)} ({item.reviewCount})
              </span>
            </div>

            <h1 className="font-display text-2xl sm:text-5xl font-bold tracking-tight text-[#F5F5F7] leading-tight">
              {item.title}
            </h1>

            <p className="text-sm sm:text-lg text-[#F5F5F7]/85 leading-relaxed">
              {item.subtitle}
            </p>

            <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3 pt-1 sm:pt-2">
              <Button
                variant="primary"
                size="lg"
                className="w-full sm:w-auto"
                leftIcon={<Play className="w-4 h-4 fill-current" />}
                onClick={() => onWatchPreview(item)}
              >
                {isUnlocked
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
              {!isUnlocked && (
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
            </div>

            {!isUnlocked && (
              <p className="text-xs text-[#A5A6B2] pt-0.5 tabular-nums">
                {locale === 'id'
                  ? `Akses 30 hari penuh · atau gunakan ${item.creditCost} Kredit VYORA`
                  : `30-day streaming access · or unlock with ${item.creditCost} VYORA Credits`}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Main Content Layout: Synopsis + Credits flow first on mobile; sticky Access sidebar on lg desktop */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 sm:pt-10 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10">
        {/* Left Column: Synopsis, Technical Specs, Credits, Reviews */}
        <div className="lg:col-span-8 space-y-7 sm:space-y-10">
          <section className="space-y-2.5 sm:space-y-3">
            <h2 className="font-display text-lg sm:text-xl font-bold text-[#F5F5F7]">
              {locale === 'id' ? 'Sinopsis' : 'Synopsis'}
            </h2>
            <p className="text-sm sm:text-base text-[#A5A6B2] leading-relaxed">{synopsis}</p>
          </section>

          {/* Creator & Production Credits */}
          <section className="bg-[#1B1C27] border border-white/8 rounded-2xl p-5 sm:p-6 space-y-5 sm:space-y-6">
            {creator && (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-white/8">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full overflow-hidden border border-white/15 shrink-0">
                    <MediaImage
                      src={creator.avatarUrl}
                      alt={creator.name}
                      fallbackTitle={creator.name}
                      className="w-full h-full"
                    />
                  </div>
                  <div>
                    <p className="text-xs text-[#A5A6B2]">
                      {locale === 'id' ? 'Dipublikasikan oleh' : 'Published by'}
                    </p>
                    <p className="text-base font-semibold text-[#F5F5F7]">{creator.name}</p>
                    <p className="text-xs text-[#A5A6B2]">{creator.location}</p>
                  </div>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onExploreCreator(creator.id)}
                >
                  {locale === 'id' ? 'Lihat Profil Kreator' : 'Explore Creator'}
                </Button>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-[#A5A6B2]">
                  {locale === 'id' ? 'Sutradara' : 'Director'}
                </p>
                <p className="font-medium text-[#F5F5F7] mt-0.5">{item.credits.director}</p>
              </div>
              <div>
                <p className="text-xs text-[#A5A6B2]">
                  {locale === 'id' ? 'Sinematografi' : 'Cinematography'}
                </p>
                <p className="font-medium text-[#F5F5F7] mt-0.5">
                  {item.credits.cinematography}
                </p>
              </div>
              <div>
                <p className="text-xs text-[#A5A6B2]">
                  {locale === 'id' ? 'Desain Suara' : 'Sound & Mastering'}
                </p>
                <p className="font-medium text-[#F5F5F7] mt-0.5">{item.credits.sound}</p>
              </div>
              <div>
                <p className="text-xs text-[#A5A6B2]">
                  {locale === 'id' ? 'Audio & Bahasa' : 'Audio & Languages'}
                </p>
                <p className="font-medium text-[#F5F5F7] mt-0.5">
                  {item.audioFormat} · {item.languages.join(', ')}
                </p>
              </div>
            </div>
          </section>

          {/* Viewer Reviews */}
          <section className="space-y-4">
            <h2 className="font-display text-xl font-bold text-[#F5F5F7]">
              {locale === 'id' ? 'Ulasan Penonton' : 'Viewer Reviews'}
            </h2>

            {firebaseUser && (
              <form
                onSubmit={handleSubmitReview}
                className="bg-[#1B1C27] border border-white/8 rounded-xl p-5 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs font-semibold text-[#F5F5F7]">
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
                          star <= reviewRating ? 'text-[#A78BFA]' : 'text-[#A5A6B2]/40'
                        }`}
                      >
                        <Star className="w-4 h-4 fill-current" aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                </div>
                {reviewErr && (
                  <p role="alert" className="text-xs text-rose-300">
                    {reviewErr}
                  </p>
                )}
                {reviewMsg && (
                  <p role="status" className="text-xs text-[#A78BFA]">
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
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#11121A] border border-white/12 text-sm text-[#F5F5F7] placeholder:text-[#A5A6B2]/60 focus:outline-none focus:ring-2 focus:ring-[#7957ED]"
                />
                <div className="flex justify-end">
                  <Button type="submit" variant="secondary" size="sm" isLoading={submittingReview}>
                    {locale === 'id' ? 'Kirim Ulasan' : 'Post Review'}
                  </Button>
                </div>
              </form>
            )}

            {combinedReviews.length === 0 ? (
              <p className="text-sm text-[#A5A6B2] bg-[#1B1C27] border border-white/8 rounded-xl p-5">
                {locale === 'id'
                  ? 'Belum ada ulasan untuk tayangan ini. Jadilah penonton pertama yang membagikan ulasan.'
                  : 'No viewer reviews yet. Be the first viewer to leave a review for this release.'}
              </p>
            ) : (
              <div className="space-y-3">
                {combinedReviews.map((rev) => (
                  <article
                    key={rev.id}
                    className="bg-[#1B1C27] border border-white/8 rounded-xl p-5 space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#A5A6B2]">
                      <span className="font-semibold text-[#F5F5F7] inline-flex flex-wrap items-center gap-2">
                        <span>
                          {rev.authorName} · {rev.authorLocation}
                        </span>
                        <span className="inline-flex items-center gap-0.5 text-[#A78BFA] font-mono">
                          <Star className="w-3 h-3 fill-current" aria-hidden="true" />
                          {rev.rating}
                        </span>
                      </span>
                      <span className="font-mono tabular-nums">
                        {formatLocalizedDate(rev.createdAt, locale)}
                      </span>
                    </div>
                    <p className="text-sm text-[#A5A6B2] leading-relaxed">{rev.comment}</p>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Right Column: Pay-Per-View & Credit Wallet Access Card */}
        <aside className="lg:col-span-4">
          <div className="lg:sticky lg:top-24 bg-[#1B1C27] border border-white/10 rounded-2xl p-5 sm:p-6 space-y-5">
            {checkingAccess && !streamAuth ? (
              <div aria-busy="true" className="space-y-4 animate-pulse">
                <div className="h-3 w-32 bg-[#242636] rounded" />
                <div className="h-9 w-28 bg-[#242636] rounded" />
                <div className="space-y-2.5 pt-2 border-t border-white/8">
                  <div className="h-3 w-full bg-[#242636] rounded" />
                  <div className="h-3 w-5/6 bg-[#242636] rounded" />
                  <div className="h-3 w-4/5 bg-[#242636] rounded" />
                </div>
                <div className="h-11 w-full bg-[#242636] rounded-xl" />
              </div>
            ) : isUnlocked && streamAuth?.entitlement ? (
              <>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-xs font-semibold text-[#A78BFA]">
                    <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                    <span>
                      {locale === 'id' ? 'Akses 30 Hari Aktif' : '30-Day Access Active'}
                    </span>
                  </div>
                  <div className="text-2xl font-bold font-mono tabular-nums text-[#F5F5F7]">
                    {locale === 'id'
                      ? `Tersisa ${remainingDays} Hari`
                      : `${remainingDays} Days Remaining`}
                  </div>
                  <p className="text-xs text-[#A5A6B2] font-mono tabular-nums">
                    {locale === 'id' ? 'Berakhir pada ' : 'Expires '}
                    {formatLocalizedDate(streamAuth.entitlement.expiresAt, locale)}
                    {resumeSeconds > 0
                      ? ` · ${
                          locale === 'id' ? 'Posisi tersimpan' : 'Saved'
                        } ${formatResumeTime(resumeSeconds)}`
                      : ''}
                  </p>
                </div>

                <div className="space-y-2.5 pt-2 border-t border-white/8">
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
                      className="w-full pt-2 text-xs text-[#A5A6B2] hover:text-[#F5F5F7] transition-colors cursor-pointer"
                    >
                      {locale === 'id' ? 'Laporkan Tayangan Ini' : 'Report this release'}
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-xs font-semibold text-[#A78BFA]">
                    <Lock className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>
                      {locale === 'id' ? 'Akses Pay-Per-View' : 'Pay-Per-View Access'}
                    </span>
                  </div>
                  <div className="text-3xl font-bold font-mono tabular-nums text-[#F5F5F7]">
                    {formatPrice(item.priceUsd, item.priceIdr, currency)}
                  </div>
                  <p className="text-xs text-[#A5A6B2]">
                    {locale === 'id'
                      ? `Atau buka dengan ${item.creditCost} Kredit VYORA`
                      : `Or unlock with ${item.creditCost} VYORA Credits`}
                  </p>
                </div>

                <div className="space-y-3 pt-2 border-t border-white/8 text-xs text-[#A5A6B2]">
                  <div className="flex items-center gap-2.5">
                    <Clock className="w-4 h-4 text-[#A78BFA] shrink-0" aria-hidden="true" />
                    <span>
                      {locale === 'id'
                        ? 'Pratinjau gratis 5 menit langsung tersedia'
                        : 'First 5 minutes free before paying'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <Calendar className="w-4 h-4 text-[#A78BFA] shrink-0" aria-hidden="true" />
                    <span>
                      {locale === 'id'
                        ? 'Akses streaming penuh selama 30 hari'
                        : '30 days of unlimited streaming after purchase'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <Film className="w-4 h-4 text-[#A78BFA] shrink-0" aria-hidden="true" />
                    <span>
                      {item.resolution} · {item.audioFormat}
                    </span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <ShieldCheck className="w-4 h-4 text-[#A78BFA] shrink-0" aria-hidden="true" />
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
                    variant="secondary"
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
                      className="w-full pt-2 text-xs text-[#A5A6B2] hover:text-[#F5F5F7] transition-colors cursor-pointer"
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
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 sm:pt-16 space-y-4 sm:space-y-6">
          <h2 className="font-display text-xl sm:text-2xl font-bold text-[#F5F5F7]">
            {locale === 'id' ? 'Tayangan Terkait' : 'More to Experience'}
          </h2>
          <div className="vyora-scroll flex sm:grid sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5 overflow-x-auto sm:overflow-visible pb-2 sm:pb-0 -mx-4 px-4 sm:mx-0 sm:px-0 snap-x snap-mandatory scroll-pl-4 sm:scroll-pl-0">
            {relatedItems.map((rel) => (
              <div
                key={rel.id}
                className="snap-start shrink-0 w-[82vw] max-w-[310px] sm:w-auto sm:max-w-none"
              >
                <ContentCard
                  item={rel}
                  locale={locale}
                  currency={currency}
                  onSelectContent={onSelectContent}
                  onWatchPreview={onWatchPreview}
                  onSelectCreator={onExploreCreator}
                />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
