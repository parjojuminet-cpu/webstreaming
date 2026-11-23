import React, { useCallback, useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import {
  CheckCircle2,
  Lock,
  Maximize,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  Volume2,
  VolumeX,
  Wallet,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import {
  authorizeVideoStream,
  savePlaybackProgress,
  type StreamAuthorizationResponse,
} from '../../services/streamService';
import type {
  ContentItem,
  CurrencyCode,
  LocaleCode,
  PaymentGateway,
} from '../../types/vyora';
import { formatPrice } from '../../i18n/translations';
import { Button } from '../ui/Button';

interface StreamingPlayerModalProps {
  item: ContentItem | null;
  locale: LocaleCode;
  currency: CurrencyCode;
  authRefreshKey?: number;
  onClose: () => void;
  onViewDetails: (item: ContentItem) => void;
  onRequireSignIn: () => void;
  onRequestCheckout: (
    item: ContentItem,
    method: PaymentGateway,
    resumeSeconds: number
  ) => void;
}

function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export const StreamingPlayerModal: React.FC<StreamingPlayerModalProps> = ({
  item,
  locale,
  currency,
  authRefreshKey = 0,
  onClose,
  onViewDetails,
  onRequireSignIn,
  onRequestCheckout,
}) => {
  const { firebaseUser } = useAuth();
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [authData, setAuthData] = useState<StreamAuthorizationResponse | null>(null);
  const [loadingStream, setLoadingStream] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(300);
  const [paywallReached, setPaywallReached] = useState(false);

  const [qualityLevels, setQualityLevels] = useState<{ index: number; label: string }[]>([]);
  const [selectedLevel, setSelectedLevel] = useState<number>(-1); // -1 = Auto ABR

  const persistCurrentProgress = useCallback(
    (targetItem: ContentItem, pos: number, mode?: 'preview' | 'full') => {
      if (mode === 'full' && firebaseUser) {
        void savePlaybackProgress(targetItem.id, pos);
      }
    },
    [firebaseUser]
  );

  const loadAuthorizedStream = useCallback(
    async (targetItem: ContentItem, overrideSeekSeconds?: number) => {
      setLoadingStream(true);
      setStreamError(null);
      setPaywallReached(false);

      try {
        const authResp = await authorizeVideoStream(targetItem.id, targetItem.category);
        setAuthData(authResp);

        const videoEl = videoRef.current;
        if (!videoEl) return;

        if (hlsRef.current) {
          hlsRef.current.destroy();
          hlsRef.current = null;
        }

        const startSeek =
          typeof overrideSeekSeconds === 'number'
            ? overrideSeekSeconds
            : authResp.mode === 'full'
            ? authResp.resumeSeconds
            : 0;

        if (authResp.streamType === 'file') {
          setQualityLevels([]);
          videoEl.src = authResp.manifestUrl;
          videoEl.addEventListener(
            'loadedmetadata',
            () => {
              if (startSeek > 0) videoEl.currentTime = startSeek;
              void videoEl.play().catch(() => {});
            },
            { once: true }
          );
        } else if (Hls.isSupported()) {
          const hls = new Hls({
            startPosition: startSeek > 0 ? startSeek : -1,
            enableWorker: true,
          });
          hlsRef.current = hls;

          hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
            const levels = data.levels.map((lvl, idx) => ({
              index: idx,
              label: lvl.height ? `${lvl.height}p` : `Stream ${idx + 1}`,
            }));
            setQualityLevels(levels);
            setSelectedLevel(-1);
            if (startSeek > 0) {
              videoEl.currentTime = startSeek;
            }
            void videoEl.play().catch(() => {
              // Autoplay fallback: user clicks play button
            });
          });

          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.response?.code === 402) {
              setPaywallReached(true);
              videoEl.pause();
              return;
            }
            if (data.fatal) {
              if (authResp.provider === 'cloudflare_stream') {
                setStreamError(
                  'Cloudflare Stream HLS manifest is still processing or unavailable right now. Please retry shortly.'
                );
              } else {
                setStreamError('Unable to stream adaptive HLS segments right now.');
              }
            }
          });

          hls.loadSource(authResp.manifestUrl);
          hls.attachMedia(videoEl);
        } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
          videoEl.src = authResp.manifestUrl;
          videoEl.addEventListener(
            'loadedmetadata',
            () => {
              if (startSeek > 0) videoEl.currentTime = startSeek;
              void videoEl.play().catch(() => {});
            },
            { once: true }
          );
        } else {
          setStreamError('Your browser does not support adaptive HLS playback.');
        }
      } catch (err) {
        setStreamError(
          err instanceof Error ? err.message : 'Stream authorization failed.'
        );
      } finally {
        setLoadingStream(false);
      }
    },
    []
  );

  useEffect(() => {
    if (!item) return;
    setCurrentTime(0);
    setPaywallReached(false);
    void loadAuthorizedStream(item);

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [item, loadAuthorizedStream]);

  // Reload stream immediately after completing payment in CheckoutModal
  useEffect(() => {
    if (!item || authRefreshKey === 0) return;
    const resumeAt = Math.min(Math.floor(currentTime), 300);
    void loadAuthorizedStream(item, resumeAt >= 290 ? 300 : resumeAt);
  }, [authRefreshKey]);

  useEffect(() => {
    if (!item) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        persistCurrentProgress(item, currentTime, authData?.mode);
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [item, currentTime, authData?.mode, onClose, persistCurrentProgress]);

  // Periodic server-side resume progress sync every 10s while playing full stream
  useEffect(() => {
    if (!item || authData?.mode !== 'full' || !isPlaying) return;
    const id = window.setInterval(() => {
      if (videoRef.current) {
        persistCurrentProgress(item, videoRef.current.currentTime, 'full');
      }
    }, 10_000);
    return () => window.clearInterval(id);
  }, [item, authData?.mode, isPlaying, persistCurrentProgress]);

  if (!item) return null;

  const isFullUnlocked = authData?.mode === 'full';
  const maxAllowedDisplay = isFullUnlocked ? duration || 360 : 300;
  const progressPct =
    maxAllowedDisplay > 0
      ? Math.min(100, (currentTime / maxAllowedDisplay) * 100)
      : 0;

  const handleTogglePlay = () => {
    const videoEl = videoRef.current;
    if (!videoEl || paywallReached) return;
    if (videoEl.paused) {
      void videoEl.play().catch(() => {});
    } else {
      videoEl.pause();
      persistCurrentProgress(item, videoEl.currentTime, authData?.mode);
    }
  };

  const handleSeek = (nextSec: number) => {
    const videoEl = videoRef.current;
    if (!videoEl) return;
    if (!isFullUnlocked && nextSec >= 299) {
      videoEl.currentTime = 299;
      setPaywallReached(true);
      videoEl.pause();
      return;
    }
    videoEl.currentTime = nextSec;
    setCurrentTime(nextSec);
  };

  const handleQualityChange = (lvlIndex: number) => {
    setSelectedLevel(lvlIndex);
    if (hlsRef.current) {
      hlsRef.current.currentLevel = lvlIndex;
    }
  };

  const triggerCheckout = (preferredMethod: PaymentGateway) => {
    if (!firebaseUser) {
      onClose();
      onRequireSignIn();
      return;
    }
    const resumeAt = Math.min(Math.floor(currentTime), 300);
    onRequestCheckout(item, preferredMethod, resumeAt >= 290 ? 300 : resumeAt);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/85 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="stream-modal-title"
    >
      <div className="w-full max-w-4xl max-h-[92dvh] flex flex-col bg-[#1B1C27] border border-white/10 rounded-2xl overflow-hidden shadow-2xl">
        {/* Top Bar */}
        <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-b border-white/8 bg-[#11121A] shrink-0">
          <div className="min-w-0">
            <p className="text-[11px] sm:text-xs text-[#A78BFA] font-medium truncate">
              {isFullUnlocked
                ? locale === 'id'
                  ? `Akses Penuh 30 Hari · Tersisa ${authData?.entitlement?.remainingDays ?? 30} Hari`
                  : `30-Day Full Access · ${authData?.entitlement?.remainingDays ?? 30} Days Remaining`
                : locale === 'id'
                ? 'Pratinjau HLS Terenkripsi 5 Menit'
                : 'Signed 5-Minute Adaptive HLS Preview'}
            </p>
            <h3
              id="stream-modal-title"
              className="text-sm sm:text-base font-semibold text-[#F5F5F7] truncate"
            >
              {item.title}
            </h3>
          </div>
          <button
            type="button"
            onClick={() => {
              persistCurrentProgress(item, currentTime, authData?.mode);
              onClose();
            }}
            aria-label="Close streaming player"
            className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-xl text-[#A5A6B2] hover:text-[#F5F5F7] hover:bg-white/5 transition-colors cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Player & Paywall Region on Mobile */}
        <div className="relative flex-1 overflow-y-auto">
          {/* 16:9 Adaptive HLS Video Viewport */}
          <div className="relative aspect-video bg-[#11121A] overflow-hidden">
            <video
              ref={videoRef}
              poster={item.backdropUrl}
              playsInline
              muted={isMuted}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onTimeUpdate={() => {
                if (!videoRef.current) return;
                const t = videoRef.current.currentTime;
                setCurrentTime(t);
                if (!isFullUnlocked && t >= 299.5) {
                  videoRef.current.pause();
                  setPaywallReached(true);
                }
              }}
              onLoadedMetadata={() => {
                if (videoRef.current && Number.isFinite(videoRef.current.duration)) {
                  setDuration(videoRef.current.duration);
                }
              }}
              onEnded={() => {
                setIsPlaying(false);
                if (!isFullUnlocked) {
                  setPaywallReached(true);
                }
              }}
              className="w-full h-full object-cover bg-black"
            />

            {/* Loading / Error overlays */}
            {loadingStream && (
              <div className="absolute inset-0 bg-[#11121A]/80 flex items-center justify-center px-4 text-center">
                <div className="text-xs font-mono text-[#A78BFA]">
                  {locale === 'id'
                    ? 'Mengotorisasi stream HLS...'
                    : 'Authorizing signed HLS stream...'}
                </div>
              </div>
            )}

            {streamError && !paywallReached && (
              <div className="absolute inset-0 bg-[#11121A]/90 flex flex-col items-center justify-center p-4 sm:p-6 text-center space-y-3">
                <p className="text-xs sm:text-sm text-rose-300">{streamError}</p>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void loadAuthorizedStream(item)}
                >
                  {locale === 'id' ? 'Coba Lagi' : 'Retry Stream'}
                </Button>
              </div>
            )}

            {/* Active Player Controls Overlay */}
            {!paywallReached && !loadingStream && !streamError && (
              <div className="absolute inset-0 flex flex-col justify-between p-3 sm:p-5 bg-gradient-to-t from-[#11121A]/90 via-transparent to-[#11121A]/40">
                <div className="flex items-center justify-between gap-2 text-xs text-[#F5F5F7]">
                  <span className="font-mono tabular-nums truncate max-w-[45%]">
                    {item.resolution}
                    <span className="hidden sm:inline"> · {item.audioFormat}</span>
                  </span>

                  <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                    {!isFullUnlocked && (
                      <button
                        type="button"
                        onClick={() => handleSeek(295)}
                        className="min-h-[34px] sm:min-h-[30px] px-2.5 py-1 rounded-md bg-[#11121A]/85 hover:bg-[#7957ED] text-[#F5F5F7] text-[11px] sm:text-xs border border-white/15 transition-colors cursor-pointer whitespace-nowrap"
                      >
                        {locale === 'id' ? 'Ke 04:55' : 'Skip 04:55'}
                      </button>
                    )}

                    {qualityLevels.length > 0 && (
                      <select
                        aria-label="Stream quality"
                        value={selectedLevel}
                        onChange={(e) => handleQualityChange(Number(e.target.value))}
                        className="min-h-[34px] sm:min-h-[30px] px-2 py-1 rounded-md bg-[#11121A]/85 border border-white/15 text-[11px] sm:text-xs font-mono text-[#F5F5F7] cursor-pointer"
                      >
                        <option value={-1}>Auto ABR</option>
                        {qualityLevels.map((lvl) => (
                          <option key={lvl.index} value={lvl.index}>
                            {lvl.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>

                {/* Center Play/Pause */}
                <div className="flex items-center justify-center">
                  <button
                    type="button"
                    onClick={handleTogglePlay}
                    aria-label={isPlaying ? 'Pause' : 'Play'}
                    className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-[#7957ED]/95 hover:bg-[#7957ED] text-[#F5F5F7] flex items-center justify-center shadow-xl transition-transform hover:scale-105 active:scale-95 cursor-pointer"
                  >
                    {isPlaying ? (
                      <Pause className="w-6 h-6" />
                    ) : (
                      <Play className="w-6 h-6 ml-0.5 fill-current" />
                    )}
                  </button>
                </div>

                {/* Bottom Scrubber & Transport */}
                <div className="space-y-1.5 sm:space-y-2">
                  <input
                    type="range"
                    min={0}
                    max={maxAllowedDisplay}
                    value={Math.min(currentTime, maxAllowedDisplay)}
                    onChange={(e) => handleSeek(Number(e.target.value))}
                    aria-label="Seek timeline"
                    className="w-full accent-[#7957ED] cursor-pointer h-2 sm:h-1.5"
                  />

                  <div className="flex items-center justify-between text-xs font-mono tabular-nums text-[#F5F5F7]">
                    <div className="flex items-center gap-1.5 sm:gap-3">
                      <span>
                        {formatClock(currentTime)} / {formatClock(maxAllowedDisplay)}
                      </span>
                      <button
                        type="button"
                        onClick={() => setIsMuted((prev) => !prev)}
                        aria-label={isMuted ? 'Unmute' : 'Mute'}
                        className="min-w-[36px] min-h-[36px] inline-flex items-center justify-center text-[#A5A6B2] hover:text-[#F5F5F7] cursor-pointer"
                      >
                        {isMuted ? (
                          <VolumeX className="w-4 h-4" />
                        ) : (
                          <Volume2 className="w-4 h-4" />
                        )}
                      </button>
                    </div>

                    <div className="flex items-center gap-2 sm:gap-3">
                      {!isFullUnlocked && (
                        <button
                          type="button"
                          onClick={() => {
                            videoRef.current?.pause();
                            setPaywallReached(true);
                          }}
                          className="min-h-[36px] px-2 text-xs font-sans font-semibold text-[#A78BFA] hover:text-[#F5F5F7] cursor-pointer whitespace-nowrap"
                        >
                          {locale === 'id' ? 'Buka Akses' : 'Unlock Full'}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void videoRef.current?.requestFullscreen?.()}
                        aria-label="Fullscreen"
                        className="min-w-[36px] min-h-[36px] inline-flex items-center justify-center text-[#A5A6B2] hover:text-[#F5F5F7] cursor-pointer"
                      >
                        <Maximize className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Paywall Gate Panel: Stacks cleanly below video on mobile phones, overlays on sm+ */}
          {paywallReached && (
            <div className="sm:absolute sm:inset-0 bg-[#1B1C27] sm:bg-[#11121A]/92 sm:backdrop-blur-md flex items-center justify-center p-5 border-t border-white/10 sm:border-t-0 overflow-y-auto">
              <div className="max-w-lg w-full text-center space-y-4 sm:space-y-5">
                <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-[#7957ED]/20 border border-[#7957ED]/40 text-[#A78BFA] flex items-center justify-center mx-auto">
                  <Lock className="w-5 h-5" />
                </div>

                <div className="space-y-1.5">
                  <h4 className="text-lg sm:text-2xl font-bold text-[#F5F5F7]">
                    {locale === 'id'
                      ? 'Pratinjau Gratis 5 Menit Selesai'
                      : '5-Minute Free Preview Limit Reached'}
                  </h4>
                  <p className="text-xs sm:text-sm text-[#A5A6B2] leading-relaxed">
                    {locale === 'id'
                      ? 'Server menghentikan streaming di 05:00. Buka tayangan penuh untuk melanjutkan tepat dari 05:00 dengan akses 30 hari.'
                      : 'Playback stopped by the server at 05:00. Unlock full access to continue right from 05:00 for 30 days.'}
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">
                  <div className="p-3.5 rounded-xl bg-[#11121A] sm:bg-[#1B1C27] border border-white/10">
                    <p className="text-xs text-[#A5A6B2] mb-1">
                      {locale === 'id' ? 'Pay-Per-View Langsung' : 'Direct Pay-Per-View'}
                    </p>
                    <p className="text-lg font-bold font-mono tabular-nums text-[#F5F5F7]">
                      {formatPrice(item.priceUsd, item.priceIdr, currency)}
                    </p>
                    <p className="text-[11px] text-[#A5A6B2] mt-1">
                      PayPal · QRIS Indonesia
                    </p>
                  </div>
                  <div className="p-3.5 rounded-xl bg-[#11121A] sm:bg-[#1B1C27] border border-white/10">
                    <p className="text-xs text-[#A5A6B2] mb-1">
                      {locale === 'id' ? 'Dompet Kredit VYORA' : 'VYORA Credit Wallet'}
                    </p>
                    <p className="text-lg font-bold font-mono tabular-nums text-[#A78BFA]">
                      {item.creditCost} {locale === 'id' ? 'Kredit' : 'Credits'}
                    </p>
                    <p className="text-[11px] text-[#A5A6B2] mt-1">
                      30-Day Server Entitlement
                    </p>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center justify-center gap-2.5 pt-1">
                  <Button
                    variant="primary"
                    size="md"
                    className="w-full sm:w-auto"
                    leftIcon={<CheckCircle2 className="w-4 h-4" />}
                    onClick={() =>
                      triggerCheckout(currency === 'IDR' ? 'qris' : 'paypal')
                    }
                  >
                    {firebaseUser
                      ? locale === 'id'
                        ? 'Bayar via PayPal / QRIS'
                        : 'Unlock via PayPal / QRIS'
                      : locale === 'id'
                      ? 'Masuk untuk Membayar'
                      : 'Sign In to Unlock'}
                  </Button>

                  <Button
                    variant="secondary"
                    size="md"
                    className="w-full sm:w-auto"
                    leftIcon={<Wallet className="w-4 h-4" />}
                    onClick={() => triggerCheckout('credits')}
                  >
                    {locale === 'id'
                      ? `Gunakan ${item.creditCost} Kredit`
                      : `Use ${item.creditCost} Credits`}
                  </Button>

                  <Button
                    variant="ghost"
                    size="md"
                    className="w-full sm:w-auto"
                    leftIcon={<RotateCcw className="w-4 h-4" />}
                    onClick={() => {
                      setPaywallReached(false);
                      handleSeek(0);
                      void videoRef.current?.play().catch(() => {});
                    }}
                  >
                    {locale === 'id' ? 'Putar Ulang' : 'Replay Preview'}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Bottom Security & Entitlement Strip */}
        <div className="px-4 sm:px-5 py-3.5 bg-[#11121A] border-t border-white/8 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 shrink-0 pb-safe">
          <div className="flex items-start sm:items-center gap-2 text-xs text-[#A5A6B2]">
            <ShieldCheck className="w-4 h-4 text-[#A78BFA] shrink-0 mt-0.5 sm:mt-0" aria-hidden="true" />
            <span>
              {isFullUnlocked
                ? locale === 'id'
                  ? `Streaming terotorisasi aktif · Berakhir ${new Date(
                      authData?.entitlement?.expiresAt ?? ''
                    ).toLocaleDateString('id-ID')}`
                  : `Signed 30-day entitlement active · Expires ${new Date(
                      authData?.entitlement?.expiresAt ?? ''
                    ).toLocaleDateString('en-US')} · Progress ${Math.round(
                      progressPct
                    )}%`
                : locale === 'id'
                ? 'Segmen HLS dibatasi ketat di server maksimal 300 detik hingga pembayaran terverifikasi.'
                : 'HLS segments strictly capped at 300s on the server until 30-day entitlement is verified.'}
            </span>
          </div>

          <button
            type="button"
            onClick={() => {
              persistCurrentProgress(item, currentTime, authData?.mode);
              onClose();
              onViewDetails(item);
            }}
            className="min-h-[36px] text-xs font-semibold text-[#A78BFA] hover:text-[#F5F5F7] transition-colors whitespace-nowrap shrink-0 cursor-pointer text-left sm:text-right inline-flex items-center"
          >
            {locale === 'id' ? 'Lihat Detail Tayangan →' : 'View Full Details →'}
          </button>
        </div>
      </div>
    </div>
  );
};
