import React, { useCallback, useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import {
  CheckCircle2,
  Lock,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  Unlock,
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
import { formatPrice, isFreeContent } from '../../i18n/translations';
import { getFacebookEmbedUrl } from '../../utils/facebook';
import { Button } from '../ui/Button';

interface YTPlayerInstance {
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  mute: () => void;
  unMute: () => void;
  isMuted: () => boolean;
  destroy: () => void;
}

interface YTNamespace {
  Player: new (
    element: HTMLElement | string,
    options: {
      videoId: string;
      host?: string;
      width?: string | number;
      height?: string | number;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: (event: { target: YTPlayerInstance }) => void;
        onStateChange?: (event: { data: number; target: YTPlayerInstance }) => void;
        onError?: (event: { data: number }) => void;
      };
    }
  ) => YTPlayerInstance;
  PlayerState?: {
    ENDED: number;
    PLAYING: number;
    PAUSED: number;
  };
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApiPromise: Promise<YTNamespace> | null = null;

function loadYouTubeIframeApi(): Promise<YTNamespace> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('YouTube player requires a browser environment.'));
  }
  if (window.YT && typeof window.YT.Player === 'function') {
    return Promise.resolve(window.YT);
  }
  if (ytApiPromise) {
    return ytApiPromise;
  }

  ytApiPromise = new Promise<YTNamespace>((resolve, reject) => {
    const previousCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof previousCallback === 'function') {
        previousCallback();
      }
      if (window.YT && typeof window.YT.Player === 'function') {
        resolve(window.YT);
      } else {
        ytApiPromise = null;
        reject(new Error('YouTube IFrame API loaded without YT.Player.'));
      }
    };

    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[src="https://www.youtube.com/iframe_api"]'
    );
    if (!existingScript) {
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.onerror = () => {
        ytApiPromise = null;
        reject(new Error('Failed to load YouTube IFrame Player API.'));
      };
      document.head.appendChild(script);
    }
  });

  return ytApiPromise;
}

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
  const playerStageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const ytContainerRef = useRef<HTMLDivElement>(null);
  const ytPlayerRef = useRef<YTPlayerInstance | null>(null);
  const startSeekRef = useRef<number>(0);
  const lockHintTimerRef = useRef<number | null>(null);
  const fullscreenExitAtRef = useRef<number>(0);

  const [authData, setAuthData] = useState<StreamAuthorizationResponse | null>(null);
  const [loadingStream, setLoadingStream] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(300);
  const [paywallReached, setPaywallReached] = useState(false);
  const [isSurfaceLocked, setIsSurfaceLocked] = useState(true);
  const [lockHintVisible, setLockHintVisible] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const [qualityLevels, setQualityLevels] = useState<{ index: number; label: string }[]>([]);
  const [selectedLevel, setSelectedLevel] = useState<number>(-1);
  const [fbIframeLoaded, setFbIframeLoaded] = useState(false);
  const [fbReplayNonce, setFbReplayNonce] = useState(0);

  const isYoutubeStream =
    authData?.streamType === 'youtube' && Boolean(authData?.youtubeVideoId);
  const isFacebookStream =
    authData?.streamType === 'facebook' &&
    Boolean(authData?.facebookVideoUrl || authData?.manifestUrl);
  const isFreeRelease = Boolean(
    authData?.isFree || (item ? isFreeContent(item) : false)
  );
  const isFullUnlocked = authData?.mode === 'full' || isFreeRelease;
  const isFullUnlockedRef = useRef(isFullUnlocked);
  isFullUnlockedRef.current = isFullUnlocked;

  const showLockHint = useCallback(() => {
    setLockHintVisible(true);
    if (lockHintTimerRef.current) {
      window.clearTimeout(lockHintTimerRef.current);
    }
    lockHintTimerRef.current = window.setTimeout(() => {
      setLockHintVisible(false);
    }, 2400);
  }, []);

  useEffect(() => {
    const onFsChange = () => {
      const fsActive = Boolean(document.fullscreenElement);
      if (!fsActive) {
        fullscreenExitAtRef.current = Date.now();
      }
      setIsFullscreen(fsActive);
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      if (lockHintTimerRef.current) {
        window.clearTimeout(lockHintTimerRef.current);
      }
    };
  }, []);

  const getPlaybackCurrentTime = useCallback((): number => {
    if (isYoutubeStream && ytPlayerRef.current) {
      try {
        const t = ytPlayerRef.current.getCurrentTime();
        return Number.isFinite(t) ? t : currentTime;
      } catch {
        return currentTime;
      }
    }
    if (videoRef.current && Number.isFinite(videoRef.current.currentTime)) {
      return videoRef.current.currentTime;
    }
    return currentTime;
  }, [isYoutubeStream, currentTime]);

  const persistCurrentProgress = useCallback(
    (
      targetItem: ContentItem,
      pos: number,
      auth: StreamAuthorizationResponse | null
    ) => {
      if (auth?.mode === 'full' && auth.entitlement && firebaseUser) {
        void savePlaybackProgress(targetItem.id, pos).catch(() => {});
      }
    },
    [firebaseUser]
  );

  const loadAuthorizedStream = useCallback(
    async (targetItem: ContentItem, overrideSeekSeconds?: number) => {
      setLoadingStream(true);
      setStreamError(null);
      setPaywallReached(false);
      setFbIframeLoaded(false);

      try {
        const authResp = await authorizeVideoStream(targetItem.id, targetItem.category);
        setAuthData(authResp);

        const startSeek =
          typeof overrideSeekSeconds === 'number'
            ? overrideSeekSeconds
            : authResp.mode === 'full'
            ? authResp.resumeSeconds
            : 0;
        startSeekRef.current = startSeek;
        setCurrentTime(startSeek);

        if (authResp.streamType === 'youtube' || authResp.streamType === 'facebook') {
          if (hlsRef.current) {
            hlsRef.current.destroy();
            hlsRef.current = null;
          }
          setQualityLevels([]);
          return;
        }

        const videoEl = videoRef.current;
        if (!videoEl) return;

        if (hlsRef.current) {
          hlsRef.current.destroy();
          hlsRef.current = null;
        }

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
            void videoEl.play().catch(() => {});
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
                  locale === 'id'
                    ? 'Stream HLS Cloudflare masih diproses atau belum siap diputar. Coba beberapa saat lagi.'
                    : 'Cloudflare Stream HLS manifest is still processing or unavailable right now. Please retry shortly.'
                );
              } else {
                setStreamError(
                  locale === 'id'
                    ? 'Gagal memuat segmen HLS adaptif saat ini.'
                    : 'Unable to stream adaptive HLS segments right now.'
                );
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
          setStreamError(
            locale === 'id'
              ? 'Browser Anda tidak mendukung pemutaran HLS adaptif.'
              : 'Your browser does not support adaptive HLS playback.'
          );
        }
      } catch (err) {
        setStreamError(
          err instanceof Error ? err.message : 'Stream authorization failed.'
        );
      } finally {
        setLoadingStream(false);
      }
    },
    [locale]
  );

  // Initialize YouTube IFrame Player API when streamType === 'youtube'
  useEffect(() => {
    if (!item || authData?.streamType !== 'youtube' || !authData.youtubeVideoId) {
      if (ytPlayerRef.current) {
        try {
          ytPlayerRef.current.destroy();
        } catch {
          // Ignore destroy failure
        }
        ytPlayerRef.current = null;
      }
      return;
    }

    let cancelled = false;
    const ytId = authData.youtubeVideoId;

    void loadYouTubeIframeApi()
      .then((YT) => {
        if (cancelled || !ytContainerRef.current) return;

        if (ytPlayerRef.current) {
          try {
            ytPlayerRef.current.destroy();
          } catch {
            // Ignore destroy failure
          }
          ytPlayerRef.current = null;
        }

        const hostEl = document.createElement('div');
        hostEl.className = 'w-full h-full';
        ytContainerRef.current.innerHTML = '';
        ytContainerRef.current.appendChild(hostEl);

        const player = new YT.Player(hostEl, {
          videoId: ytId,
          host: 'https://www.youtube-nocookie.com',
          width: '100%',
          height: '100%',
          playerVars: {
            autoplay: 1,
            controls: 0,
            disablekb: 1,
            fs: 0,
            iv_load_policy: 3,
            rel: 0,
            modestbranding: 1,
            playsinline: 1,
            enablejsapi: 1,
            start: Math.max(0, Math.floor(startSeekRef.current)),
            origin: window.location.origin,
          },
          events: {
            onReady: (event) => {
              if (cancelled) return;
              const d = event.target.getDuration();
              if (Number.isFinite(d) && d > 0) {
                setDuration(d);
              }
              if (startSeekRef.current > 0) {
                event.target.seekTo(startSeekRef.current, true);
              }
              if (typeof event.target.isMuted === 'function') {
                setIsMuted(event.target.isMuted());
              }
              event.target.playVideo();
            },
            onStateChange: (event) => {
              if (cancelled) return;
              const playingState = YT.PlayerState?.PLAYING ?? 1;
              const endedState = YT.PlayerState?.ENDED ?? 0;
              if (event.data === playingState) {
                setIsPlaying(true);
              } else {
                setIsPlaying(false);
                if (event.data === endedState && !isFullUnlockedRef.current) {
                  setPaywallReached(true);
                }
              }
            },
            onError: (event) => {
              if (cancelled) return;
              const code = event.data;
              if (code === 101 || code === 150) {
                setStreamError(
                  locale === 'id'
                    ? 'Pemilik video YouTube menonaktifkan pemutaran embed. Aktifkan "Izinkan penyematan" di YouTube Studio.'
                    : 'The YouTube video owner disabled embedded playback. Enable "Allow embedding" in YouTube Studio.'
                );
              } else if (code === 100) {
                setStreamError(
                  locale === 'id'
                    ? 'Video YouTube tidak ditemukan atau disetel Private. Gunakan status Unlisted atau Publik.'
                    : 'YouTube video not found or set to Private. Please set visibility to Unlisted or Public.'
                );
              } else {
                setStreamError(
                  locale === 'id'
                    ? `Video YouTube gagal dimuat (kode ${code}). Periksa tautan atau izin embed video.`
                    : `Unable to load YouTube video (error ${code}). Check video URL or embed permissions.`
                );
              }
            },
          },
        });

        ytPlayerRef.current = player;
      })
      .catch((err) => {
        if (!cancelled) {
          setStreamError(
            err instanceof Error
              ? err.message
              : 'Failed to initialize YouTube player.'
          );
        }
      });

    return () => {
      cancelled = true;
      if (ytPlayerRef.current) {
        try {
          ytPlayerRef.current.destroy();
        } catch {
          // Ignore
        }
        ytPlayerRef.current = null;
      }
    };
  }, [item, authData?.streamType, authData?.youtubeVideoId, locale]);

  // Enforce 5-minute preview cap & sync playback clock for YouTube IFrame Player
  useEffect(() => {
    if (!item || !isYoutubeStream || paywallReached || streamError) return;
    const pollId = window.setInterval(() => {
      const player = ytPlayerRef.current;
      if (!player) return;
      try {
        const t = player.getCurrentTime();
        const d = player.getDuration();
        if (Number.isFinite(d) && d > 0) {
          setDuration(d);
        }
        if (Number.isFinite(t)) {
          setCurrentTime(t);
          if (!isFullUnlockedRef.current && t >= 299.5) {
            player.pauseVideo();
            player.seekTo(299, true);
            setIsPlaying(false);
            setPaywallReached(true);
          }
        }
      } catch {
        // Ignore transient YouTube API readiness errors
      }
    }, 250);

    return () => window.clearInterval(pollId);
  }, [item, isYoutubeStream, paywallReached, streamError]);

  // Enforce 5-minute preview timer & playback clock for Facebook Embedded Video Player
  useEffect(() => {
    if (!item || !isFacebookStream || !fbIframeLoaded || paywallReached || streamError) {
      if (isFacebookStream && (paywallReached || streamError)) {
        setIsPlaying(false);
      }
      return;
    }

    setIsPlaying(true);
    const tickId = window.setInterval(() => {
      setCurrentTime((prev) => {
        const next = prev + 1;
        if (!isFullUnlockedRef.current && next >= 300) {
          setIsPlaying(false);
          setPaywallReached(true);
          return 300;
        }
        return next;
      });
    }, 1000);

    return () => {
      window.clearInterval(tickId);
    };
  }, [item, isFacebookStream, fbIframeLoaded, paywallReached, streamError]);

  useEffect(() => {
    if (!item) return;
    setCurrentTime(0);
    setPaywallReached(false);
    setIsSurfaceLocked(true);
    setLockHintVisible(false);
    setAuthData(null);
    void loadAuthorizedStream(item);

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (ytPlayerRef.current) {
        try {
          ytPlayerRef.current.destroy();
        } catch {
          // Ignore
        }
        ytPlayerRef.current = null;
      }
    };
  }, [item, loadAuthorizedStream]);

  useEffect(() => {
    if (!item || authRefreshKey === 0) return;
    const resumeAt = Math.min(Math.floor(getPlaybackCurrentTime()), 300);
    void loadAuthorizedStream(item, resumeAt >= 290 ? 300 : resumeAt);
  }, [authRefreshKey]);

  useEffect(() => {
    if (!item) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (document.fullscreenElement || Date.now() - fullscreenExitAtRef.current < 350) {
          return;
        }
        persistCurrentProgress(item, getPlaybackCurrentTime(), authData);
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [item, authData, onClose, persistCurrentProgress, getPlaybackCurrentTime]);

  useEffect(() => {
    if (!item || authData?.mode !== 'full' || !authData.entitlement || !isPlaying) return;
    const id = window.setInterval(() => {
      const pos = getPlaybackCurrentTime();
      persistCurrentProgress(item, pos, authData);
    }, 10_000);
    return () => window.clearInterval(id);
  }, [item, authData, isPlaying, persistCurrentProgress, getPlaybackCurrentTime]);

  if (!item) return null;

  const maxAllowedDisplay = isFullUnlocked ? duration || 360 : 300;
  const progressPct =
    maxAllowedDisplay > 0
      ? Math.min(100, (currentTime / maxAllowedDisplay) * 100)
      : 0;

  const handleTogglePlay = () => {
    if (paywallReached) return;
    if (isYoutubeStream && ytPlayerRef.current) {
      try {
        if (isPlaying) {
          ytPlayerRef.current.pauseVideo();
          setIsPlaying(false);
          persistCurrentProgress(item, getPlaybackCurrentTime(), authData);
        } else {
          ytPlayerRef.current.playVideo();
          setIsPlaying(true);
        }
      } catch {
        // Ignore transient YouTube API readiness error
      }
      return;
    }

    const videoEl = videoRef.current;
    if (!videoEl) return;
    if (videoEl.paused) {
      void videoEl.play().catch(() => {});
    } else {
      videoEl.pause();
      persistCurrentProgress(item, videoEl.currentTime, authData);
    }
  };

  const handleToggleMute = () => {
    if (isYoutubeStream && ytPlayerRef.current) {
      try {
        if (isMuted) {
          ytPlayerRef.current.unMute();
          setIsMuted(false);
        } else {
          ytPlayerRef.current.mute();
          setIsMuted(true);
        }
      } catch {
        // Ignore transient YouTube API readiness error
      }
      return;
    }
    setIsMuted((prev) => !prev);
  };

  const handleToggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen?.().catch(() => {});
      return;
    }
    if (playerStageRef.current?.requestFullscreen) {
      void playerStageRef.current.requestFullscreen().catch(() => {});
    } else if (videoRef.current?.requestFullscreen) {
      void videoRef.current.requestFullscreen().catch(() => {});
    }
  };

  const handleSeek = (nextSec: number) => {
    if (isFacebookStream) {
      setFbIframeLoaded(false);
      setFbReplayNonce((n) => n + 1);
      setCurrentTime(0);
      return;
    }

    if (isYoutubeStream && ytPlayerRef.current) {
      try {
        if (!isFullUnlocked && nextSec >= 299) {
          ytPlayerRef.current.seekTo(299, true);
          ytPlayerRef.current.pauseVideo();
          setPaywallReached(true);
          return;
        }
        ytPlayerRef.current.seekTo(nextSec, true);
        setCurrentTime(nextSec);
      } catch {
        // Ignore transient YouTube API readiness error
      }
      return;
    }

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
    if (isFreeRelease) return;
    if (!firebaseUser) {
      onClose();
      onRequireSignIn();
      return;
    }
    const resumeAt = Math.min(Math.floor(getPlaybackCurrentTime()), 300);
    onRequestCheckout(item, preferredMethod, resumeAt >= 290 ? 300 : resumeAt);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/75 dark:bg-slate-950/85 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="stream-modal-title"
    >
      <div className="w-full max-w-4xl max-h-[92dvh] flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
        {/* Top Bar */}
        <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 shrink-0">
          <div className="min-w-0">
            <p className="text-[11px] sm:text-xs text-emerald-700 dark:text-emerald-400 font-semibold truncate">
              {isFreeRelease
                ? locale === 'id'
                  ? 'Tayangan Gratis · Akses Penuh Tanpa Batas'
                  : 'Free Release · Unlimited Full Access'
                : isFullUnlocked
                ? locale === 'id'
                  ? `Akses Penuh 30 Hari · Tersisa ${authData?.entitlement?.remainingDays ?? 30} Hari`
                  : `30-Day Full Access · ${authData?.entitlement?.remainingDays ?? 30} Days Remaining`
                : isYoutubeStream
                ? locale === 'id'
                  ? 'Pratinjau YouTube Terverifikasi · Maksimal 5 Menit'
                  : 'Verified YouTube Stream · 5-Minute Free Preview'
                : isFacebookStream
                ? locale === 'id'
                  ? 'Pratinjau Facebook Publik · Maksimal 5 Menit'
                  : 'Embedded Facebook Video · 5-Minute Free Preview'
                : locale === 'id'
                ? 'Pratinjau HLS Terenkripsi 5 Menit'
                : 'Signed 5-Minute Adaptive HLS Preview'}
            </p>
            <h3
              id="stream-modal-title"
              className="text-sm sm:text-base font-semibold text-slate-900 dark:text-white truncate"
            >
              {item.title}
            </h3>
          </div>
          <button
            type="button"
            onClick={() => {
              persistCurrentProgress(item, getPlaybackCurrentTime(), authData);
              onClose();
            }}
            aria-label="Close streaming player"
            className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-xl text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/70 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Player & Paywall Region */}
        <div className="relative flex-1 overflow-y-auto">
          <div
            ref={playerStageRef}
            onContextMenu={(e) => e.preventDefault()}
            className="relative aspect-video bg-slate-950 overflow-hidden select-none"
          >
            {isYoutubeStream ? (
              <div
                ref={ytContainerRef}
                className={`w-full h-full bg-black select-none ${
                  isSurfaceLocked ? 'pointer-events-none' : ''
                }`}
                aria-label={`${item.title} YouTube video player`}
              />
            ) : isFacebookStream ? (
              (() => {
                const rawFbSrc = authData?.facebookVideoUrl
                  ? getFacebookEmbedUrl(authData.facebookVideoUrl, {
                      autoplay: true,
                      startSeconds:
                        fbReplayNonce > 0 && !isFullUnlocked
                          ? 0
                          : startSeekRef.current,
                    })
                  : authData?.manifestUrl &&
                    authData.manifestUrl.startsWith(
                      'https://www.facebook.com/plugins/video.php'
                    )
                  ? authData.manifestUrl
                  : '';

                if (paywallReached || !rawFbSrc) {
                  return <div className="w-full h-full bg-slate-950" />;
                }

                return (
                  <div
                    className={`w-full h-full bg-black select-none ${
                      isSurfaceLocked ? 'pointer-events-none' : ''
                    }`}
                  >
                    <iframe
                      key={`${authData?.videoId}-${authData?.mode}-${fbReplayNonce}`}
                      src={rawFbSrc}
                      title={`${item.title} Facebook video player`}
                      className="w-full h-full border-0 bg-black"
                      allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
                      allowFullScreen
                      referrerPolicy="strict-origin-when-cross-origin"
                      onLoad={() => setFbIframeLoaded(true)}
                      onError={() =>
                        setStreamError(
                          locale === 'id'
                            ? 'Gagal memuat embed video Facebook. Pastikan video disetel Publik dan tidak diblokir browser.'
                            : 'Unable to load Facebook video embed. Ensure the post is Public and not blocked by browser privacy extensions.'
                        )
                      }
                    />
                  </div>
                );
              })()
            ) : (
              <video
                ref={videoRef}
                poster={item.backdropUrl}
                playsInline
                muted={isMuted}
                controlsList="nodownload noplaybackrate"
                disablePictureInPicture
                onContextMenu={(e) => e.preventDefault()}
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
                className="w-full h-full object-cover bg-black pointer-events-none"
              />
            )}

            {/* Anti-Redirect Click-Shield over Video Area */}
            {!loadingStream && !streamError && !paywallReached && isSurfaceLocked && (
              <div
                aria-hidden="true"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  showLockHint();
                }}
                onDoubleClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                className="absolute inset-0 z-10 cursor-default select-none bg-transparent"
              />
            )}

            {lockHintVisible && !paywallReached && !loadingStream && !streamError && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 pointer-events-none px-3 py-1.5 rounded-lg bg-slate-950/90 border border-emerald-500/40 text-[11px] font-medium text-emerald-300 shadow-lg whitespace-nowrap">
                {locale === 'id'
                  ? 'Area video dikunci agar tidak berpindah ke sumber eksternal · Gunakan kontrol di bawah'
                  : 'Video area is locked to block external redirects · Use controls below'}
              </div>
            )}

            {loadingStream && (
              <div className="absolute inset-0 bg-slate-950/80 flex items-center justify-center px-4 text-center z-30">
                <div className="text-xs font-mono text-emerald-400">
                  {locale === 'id'
                    ? 'Mengotorisasi pemutar video...'
                    : 'Authorizing video stream...'}
                </div>
              </div>
            )}

            {streamError && !paywallReached && (
              <div className="absolute inset-0 bg-slate-950/90 flex flex-col items-center justify-center p-4 sm:p-6 text-center space-y-3 z-30">
                <p className="text-xs sm:text-sm text-rose-300 max-w-md">{streamError}</p>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void loadAuthorizedStream(item)}
                >
                  {locale === 'id' ? 'Coba Lagi' : 'Retry Stream'}
                </Button>
              </div>
            )}

            {/* Centered Play CTA when paused */}
            {!paywallReached && !loadingStream && !streamError && !isFacebookStream && !isPlaying && (
              <div className="absolute inset-0 z-[15] pointer-events-none flex items-center justify-center">
                <button
                  type="button"
                  onClick={handleTogglePlay}
                  aria-label="Play"
                  className="pointer-events-auto w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-emerald-600/95 hover:bg-emerald-600 text-white flex items-center justify-center shadow-xl transition-transform hover:scale-105 active:scale-95 cursor-pointer"
                >
                  <Play className="w-5 h-5 ml-0.5 fill-current" />
                </button>
              </div>
            )}

            {/* Unified DELOKEN Control Overlay (sits above z-10 shield so controls remain usable while video stage stays protected) */}
            {!paywallReached && !loadingStream && !streamError && (
              <div
                className={`absolute inset-x-0 bottom-0 z-20 flex flex-col justify-end p-3 sm:p-4 bg-gradient-to-t from-slate-950/95 via-slate-950/75 to-transparent transition-opacity ${
                  isFacebookStream && !isSurfaceLocked
                    ? 'pointer-events-none'
                    : 'pointer-events-auto'
                }`}
                onClick={(e) => e.stopPropagation()}
              >

                <div
                  className={`space-y-1.5 sm:space-y-2 ${
                    isFacebookStream && !isSurfaceLocked ? 'pointer-events-auto' : ''
                  }`}
                >
                  {!isFacebookStream && (
                    <input
                      type="range"
                      min={0}
                      max={maxAllowedDisplay}
                      value={Math.min(currentTime, maxAllowedDisplay)}
                      onChange={(e) => handleSeek(Number(e.target.value))}
                      aria-label="Seek timeline"
                      className="w-full accent-emerald-500 cursor-pointer h-2 sm:h-1.5"
                    />
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums text-white">
                    <div className="flex items-center gap-1.5 sm:gap-2.5">
                      {!isFacebookStream ? (
                        <>
                          <button
                            type="button"
                            onClick={handleTogglePlay}
                            aria-label={isPlaying ? 'Pause' : 'Play'}
                            className="min-w-[36px] min-h-[36px] inline-flex items-center justify-center text-white hover:text-emerald-400 cursor-pointer"
                          >
                            {isPlaying ? (
                              <Pause className="w-4 h-4" />
                            ) : (
                              <Play className="w-4 h-4 fill-current" />
                            )}
                          </button>

                          <span>
                            {formatClock(currentTime)} / {formatClock(maxAllowedDisplay)}
                          </span>

                          <button
                            type="button"
                            onClick={handleToggleMute}
                            aria-label={isMuted ? 'Unmute' : 'Mute'}
                            className="min-w-[36px] min-h-[36px] inline-flex items-center justify-center text-slate-300 hover:text-white cursor-pointer"
                          >
                            {isMuted ? (
                              <VolumeX className="w-4 h-4" />
                            ) : (
                              <Volume2 className="w-4 h-4" />
                            )}
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => handleSeek(0)}
                            className="min-h-[34px] px-2.5 inline-flex items-center gap-1.5 rounded-lg bg-slate-900/90 border border-white/15 text-[11px] font-sans font-medium text-white hover:border-emerald-500 cursor-pointer"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>{locale === 'id' ? 'Muat Ulang' : 'Reload'}</span>
                          </button>
                          <span className="text-slate-300">
                            {isFullUnlocked
                              ? formatClock(currentTime)
                              : `${formatClock(currentTime)} / 05:00`}
                          </span>
                        </>
                      )}

                      <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-950/80 border border-emerald-500/30 text-[10px] font-sans font-semibold text-emerald-300">
                        <Lock className="w-3 h-3" aria-hidden="true" />
                        {isSurfaceLocked
                          ? locale === 'id'
                            ? 'Area Terkunci'
                            : 'Surface Locked'
                          : locale === 'id'
                          ? 'Kontrol FB Terbuka'
                          : 'FB Controls Open'}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 sm:gap-2.5">
                      {!isYoutubeStream && !isFacebookStream && qualityLevels.length > 0 && (
                        <select
                          aria-label="Stream quality"
                          value={selectedLevel}
                          onChange={(e) => handleQualityChange(Number(e.target.value))}
                          className="min-h-[32px] px-2 py-1 rounded-md bg-slate-900/90 border border-white/20 text-[11px] font-mono text-white cursor-pointer"
                        >
                          <option value={-1}>Auto ABR</option>
                          {qualityLevels.map((lvl) => (
                            <option key={lvl.index} value={lvl.index}>
                              {lvl.label}
                            </option>
                          ))}
                        </select>
                      )}

                      {isFacebookStream && (
                        <button
                          type="button"
                          onClick={() => setIsSurfaceLocked((prev) => !prev)}
                          className="min-h-[34px] px-2.5 inline-flex items-center gap-1 rounded-lg bg-slate-900/90 border border-white/15 text-[11px] font-sans font-medium text-slate-200 hover:text-white cursor-pointer whitespace-nowrap"
                        >
                          {isSurfaceLocked ? (
                            <>
                              <Unlock className="w-3.5 h-3.5" />
                              <span>{locale === 'id' ? 'Buka Kontrol FB' : 'FB Controls'}</span>
                            </>
                          ) : (
                            <>
                              <Lock className="w-3.5 h-3.5 text-emerald-400" />
                              <span>{locale === 'id' ? 'Kunci Area' : 'Lock Area'}</span>
                            </>
                          )}
                        </button>
                      )}

                      {!isFullUnlocked && !isFreeRelease && (
                        <button
                          type="button"
                          onClick={() => {
                            if (isYoutubeStream) {
                              try {
                                ytPlayerRef.current?.pauseVideo();
                              } catch {
                                // Ignore
                              }
                            } else {
                              videoRef.current?.pause();
                            }
                            setIsPlaying(false);
                            setPaywallReached(true);
                          }}
                          className="min-h-[34px] px-2.5 rounded-lg bg-emerald-600/90 hover:bg-emerald-600 text-[11px] font-sans font-semibold text-white cursor-pointer whitespace-nowrap"
                        >
                          {locale === 'id' ? 'Buka Akses' : 'Unlock Full'}
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={handleToggleFullscreen}
                        aria-label={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
                        className="min-w-[36px] min-h-[36px] inline-flex items-center justify-center text-slate-300 hover:text-white cursor-pointer"
                      >
                        {isFullscreen ? (
                          <Minimize className="w-4 h-4" />
                        ) : (
                          <Maximize className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Paywall Gate Panel */}
          {paywallReached && !isFreeRelease && (
            <div className="sm:absolute sm:inset-0 z-30 bg-white dark:bg-slate-900 sm:bg-white/95 sm:dark:bg-slate-900/95 sm:backdrop-blur-md flex items-center justify-center p-5 border-t border-slate-200 dark:border-slate-800 sm:border-t-0 overflow-y-auto">
              <div className="max-w-lg w-full text-center space-y-4 sm:space-y-5">
                <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/70 text-emerald-700 dark:text-emerald-400 flex items-center justify-center mx-auto">
                  <Lock className="w-5 h-5" />
                </div>

                <div className="space-y-1.5">
                  <h4 className="text-lg sm:text-2xl font-bold text-slate-900 dark:text-white">
                    {locale === 'id'
                      ? 'Pratinjau Gratis 5 Menit Selesai'
                      : '5-Minute Free Preview Limit Reached'}
                  </h4>
                  <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                    {locale === 'id'
                      ? 'Pemutaran berhenti di 05:00. Buka tayangan penuh untuk melanjutkan tepat dari 05:00 dengan akses 30 hari.'
                      : 'Playback stopped at 05:00. Unlock full access to continue right from 05:00 for 30 days.'}
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">
                  <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">
                      {locale === 'id' ? 'Pay-Per-View Langsung' : 'Direct Pay-Per-View'}
                    </p>
                    <p className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                      {formatPrice(item.priceUsd, item.priceIdr, currency)}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                      PayPal · QRIS Indonesia
                    </p>
                  </div>
                  <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">
                      {locale === 'id' ? 'Dompet Kredit DELOKEN' : 'DELOKEN Credit Wallet'}
                    </p>
                    <p className="text-lg font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                      {item.creditCost} {locale === 'id' ? 'Kredit' : 'Credits'}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
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
                      if (isYoutubeStream) {
                        try {
                          ytPlayerRef.current?.playVideo();
                        } catch {
                          // Ignore
                        }
                      } else {
                        void videoRef.current?.play().catch(() => {});
                      }
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
        <div className="px-4 sm:px-5 py-3.5 bg-slate-50 dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 shrink-0 pb-safe">
          <div className="flex items-start sm:items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <ShieldCheck className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0 mt-0.5 sm:mt-0" aria-hidden="true" />
            <span>
              {isFreeRelease
                ? locale === 'id'
                  ? 'Tayangan gratis · Diputar di pemutar terproteksi DELOKEN (klik area video dikunci agar tidak pindah ke situs sumber).'
                  : 'Free release · Playing inside DELOKEN protected player (video surface locked against external redirects).'
                : isFullUnlocked && authData?.entitlement
                ? locale === 'id'
                  ? `Streaming terotorisasi aktif · Berakhir ${new Date(
                      authData.entitlement.expiresAt
                    ).toLocaleDateString('id-ID')}`
                  : `Signed 30-day entitlement active · Expires ${new Date(
                      authData.entitlement.expiresAt
                    ).toLocaleDateString('en-US')} · Progress ${Math.round(
                      progressPct
                    )}%`
                : isYoutubeStream
                ? locale === 'id'
                  ? `Pratinjau YouTube (${formatClock(currentTime)} / 05:00) · Area video dikunci agar klik tidak membuka YouTube.`
                  : `YouTube preview (${formatClock(currentTime)} / 05:00) · Surface locked so clicks stay inside DELOKEN.`
                : isFacebookStream
                ? locale === 'id'
                  ? `Pratinjau Facebook (${formatClock(currentTime)} / 05:00) · Area video dikunci agar klik tidak membuka Facebook.`
                  : `Facebook preview (${formatClock(currentTime)} / 05:00) · Surface locked so clicks stay inside DELOKEN.`
                : locale === 'id'
                ? 'Segmen HLS dibatasi ketat di server maksimal 300 detik hingga pembayaran terverifikasi.'
                : 'HLS segments strictly capped at 300s on the server until 30-day entitlement is verified.'}
            </span>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => {
                persistCurrentProgress(item, getPlaybackCurrentTime(), authData);
                onClose();
                onViewDetails(item);
              }}
              className="min-h-[36px] text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer text-left sm:text-right inline-flex items-center"
            >
              {locale === 'id' ? 'Lihat Detail Tayangan →' : 'View Full Details →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
