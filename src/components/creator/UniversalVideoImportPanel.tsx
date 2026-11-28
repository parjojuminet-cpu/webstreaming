import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import * as dashjs from 'dashjs';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Eye,
  HelpCircle,
  Link2,
  Loader2,
  Play,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { inspectCreatorVideoLink } from '../../services/streamService';
import { buildTwitchEmbedUrl } from '../../services/videoImport/adapters';
import type { LinkInspectionDiagnostics } from '../../services/videoImport/types';
import type {
  DirectStreamFormat,
  LinkCheckStatus,
  LocaleCode,
  PlaybackCheckStatus,
  VideoAspectRatio,
  VideoAssetProvider,
  VideoFitMode,
} from '../../types/vyora';
import {
  VIDEO_ASPECT_OPTIONS,
  getAdaptiveFrameStyle,
  inferAspectRatioFromDimensions,
  inferAspectRatioFromUrlOrProvider,
  resolveEffectiveAspectRatio,
  type FixedVideoAspectRatio,
} from '../../utils/videoAspect';
import { loadYouTubeIframeApi, type YTPlayerInstance } from '../../utils/youtubeApi';
import { Button } from '../ui/Button';

export interface VerifiedImportedVideoPayload {
  provider: VideoAssetProvider;
  assetRef: string;
  canonicalUrl: string;
  platformLabel: string;
  titleHint?: string;
  thumbnailUrl?: string;
  durationMinutesHint?: number;
  aspectRatio?: VideoAspectRatio;
  videoFitMode?: VideoFitMode;
  mimeType?: string;
  directFormat?: DirectStreamFormat;
}

interface UniversalVideoImportPanelProps {
  locale: LocaleCode;
  isContinued: boolean;
  onContinue: (payload: VerifiedImportedVideoPayload) => void;
  onInvalidate: () => void;
  onSwitchToBatch?: (rawText: string) => void;
}

const LINK_STATUS_META: Record<
  LinkCheckStatus,
  {
    labelId: string;
    labelEn: string;
    toneClass: string;
  }
> = {
  waiting: {
    labelId: 'MENUNGGU PEMERIKSAAN',
    labelEn: 'AWAITING CHECK',
    toneClass:
      'bg-slate-100 dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300',
  },
  checking: {
    labelId: 'SEDANG DIPERIKSA',
    labelEn: 'CHECKING LINK',
    toneClass:
      'bg-sky-50 dark:bg-sky-950/50 border-sky-200 dark:border-sky-800/70 text-sky-800 dark:text-sky-300',
  },
  embeddable: {
    labelId: 'BISA DITAMPILKAN',
    labelEn: 'EMBEDDABLE',
    toneClass:
      'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800/70 text-emerald-800 dark:text-emerald-300',
  },
  unavailable: {
    labelId: 'TIDAK BISA DITAMPILKAN',
    labelEn: 'CANNOT BE DISPLAYED',
    toneClass:
      'bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-800/70 text-rose-800 dark:text-rose-300',
  },
  uncertain: {
    labelId: 'BELUM DAPAT DIPASTIKAN',
    labelEn: 'UNCERTAIN',
    toneClass:
      'bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800/70 text-amber-800 dark:text-amber-300',
  },
};

const PLAYBACK_STATUS_META: Record<
  PlaybackCheckStatus,
  {
    labelId: string;
    labelEn: string;
    toneClass: string;
  }
> = {
  waiting_play: {
    labelId: 'MENUNGGU PLAY',
    labelEn: 'AWAITING PLAY',
    toneClass:
      'bg-slate-100 dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300',
  },
  verifying: {
    labelId: 'MEMVERIFIKASI PEMUTARAN...',
    labelEn: 'VERIFYING PLAYBACK...',
    toneClass:
      'bg-sky-50 dark:bg-sky-950/50 border-sky-200 dark:border-sky-800/70 text-sky-800 dark:text-sky-300',
  },
  verified_playing: {
    labelId: 'VIDEO BERHASIL DIPUTAR',
    labelEn: 'PLAYBACK VERIFIED',
    toneClass:
      'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-300',
  },
  play_failed: {
    labelId: 'GAGAL DIPUTAR',
    labelEn: 'PLAYBACK FAILED',
    toneClass:
      'bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-800/70 text-rose-800 dark:text-rose-300',
  },
  unverifiable: {
    labelId: 'TIDAK DAPAT DIVERIFIKASI',
    labelEn: 'NOT VERIFIABLE',
    toneClass:
      'bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800/70 text-amber-800 dark:text-amber-300',
  },
};

export const UniversalVideoImportPanel: React.FC<UniversalVideoImportPanelProps> = ({
  locale,
  isContinued,
  onContinue,
  onInvalidate,
  onSwitchToBatch,
}) => {
  const [urlInput, setUrlInput] = useState('');
  const [linkStatus, setLinkStatus] = useState<LinkCheckStatus>('waiting');
  const [inspection, setInspection] = useState<LinkInspectionDiagnostics | null>(null);
  const [inspectErr, setInspectErr] = useState<string | null>(null);

  const [previewOpened, setPreviewOpened] = useState(false);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [previewGraceReady, setPreviewGraceReady] = useState(false);
  const [playbackStatus, setPlaybackStatus] = useState<PlaybackCheckStatus>('waiting_play');
  const [playbackNote, setPlaybackNote] = useState<string>('');
  const [observedPlaySeconds, setObservedPlaySeconds] = useState(0);
  const [detectedDurationSec, setDetectedDurationSec] = useState<number | undefined>(
    undefined
  );
  const [selectedAspectRatio, setSelectedAspectRatio] = useState<VideoAspectRatio>('auto');
  const [detectedAspectRatio, setDetectedAspectRatio] =
    useState<FixedVideoAspectRatio | null>(null);
  const [videoFitMode, setVideoFitMode] = useState<VideoFitMode>('contain');

  // Refs for official player verification instances
  const ytHostRef = useRef<HTMLDivElement | null>(null);
  const ytPlayerRef = useRef<YTPlayerInstance | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const htmlVideoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const dashRef = useRef<dashjs.MediaPlayerClass | null>(null);
  const playAttemptTimeoutRef = useRef<number | null>(null);
  const playbackStatusRef = useRef<PlaybackCheckStatus>('waiting_play');
  playbackStatusRef.current = playbackStatus;

  const cleanupPlayers = () => {
    if (playAttemptTimeoutRef.current) {
      window.clearTimeout(playAttemptTimeoutRef.current);
      playAttemptTimeoutRef.current = null;
    }
    if (ytPlayerRef.current) {
      try {
        ytPlayerRef.current.destroy();
      } catch {
        // Ignore cleanup errors
      }
      ytPlayerRef.current = null;
    }
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    if (dashRef.current) {
      try {
        dashRef.current.reset();
      } catch {
        // Ignore cleanup errors
      }
      dashRef.current = null;
    }
    if (htmlVideoRef.current) {
      htmlVideoRef.current.pause();
      htmlVideoRef.current.removeAttribute('src');
      htmlVideoRef.current.load();
    }
  };

  useEffect(() => {
    return () => {
      cleanupPlayers();
    };
  }, []);

  const resetVerificationState = () => {
    cleanupPlayers();
    setPreviewOpened(false);
    setIframeLoaded(false);
    setPlaybackStatus('waiting_play');
    setPlaybackNote('');
    setObservedPlaySeconds(0);
    setDetectedDurationSec(undefined);
    setSelectedAspectRatio('auto');
    setDetectedAspectRatio(null);
    setVideoFitMode('contain');
    onInvalidate();
  };

  const handleUrlChange = (nextVal: string) => {
    setUrlInput(nextVal);
    setLinkStatus('waiting');
    setInspection(null);
    setInspectErr(null);
    resetVerificationState();
  };

  const handleCheckLink = async () => {
    const trimmed = urlInput.trim();
    resetVerificationState();
    setInspectErr(null);

    if (!trimmed) {
      setLinkStatus('unavailable');
      setInspectErr(
        locale === 'id'
          ? 'Tempel tautan video terlebih dahulu sebelum memeriksa.'
          : 'Paste a video URL before checking.'
      );
      return;
    }

    setLinkStatus('checking');
    try {
      const diag = await inspectCreatorVideoLink(trimmed);
      setInspection(diag);
      setLinkStatus(diag.linkStatus);
      if (diag.durationSecondsHint) {
        setDetectedDurationSec(diag.durationSecondsHint);
      }
      const inferredRatio =
        diag.aspectRatioHint ||
        inferAspectRatioFromUrlOrProvider({
          provider: diag.provider,
          url: diag.canonicalUrl || trimmed,
          width: diag.detectedWidth,
          height: diag.detectedHeight,
        });
      setDetectedAspectRatio(inferredRatio);
    } catch (err) {
      setLinkStatus('uncertain');
      setInspectErr(
        err instanceof Error
          ? err.message
          : locale === 'id'
          ? 'Gagal menghubungi server pemeriksaan tautan.'
          : 'Failed to contact server link inspector.'
      );
    }
  };

  useEffect(() => {
    if (!previewOpened) {
      setPreviewGraceReady(false);
      return;
    }
    const timer = window.setTimeout(() => setPreviewGraceReady(true), 2000);
    return () => window.clearTimeout(timer);
  }, [previewOpened]);

  const handleOpenPreview = () => {
    if (!inspection || !inspection.detected || linkStatus === 'unavailable') return;
    cleanupPlayers();
    setPreviewOpened(true);
    setIframeLoaded(false);
    setPreviewGraceReady(false);
    setObservedPlaySeconds(0);
    onInvalidate();

    if (inspection.verifiability === 'unverifiable') {
      setPlaybackStatus('unverifiable');
      setPlaybackNote(
        locale === 'id' ? inspection.verifiabilityNoteId : inspection.verifiabilityNoteEn
      );
    } else if (
      inspection.verifiability === 'conditional' &&
      inspection.provider !== 'streamable' &&
      inspection.provider !== 'tiktok'
    ) {
      setPlaybackStatus('waiting_play');
      setPlaybackNote(
        locale === 'id'
          ? `Silakan uji tombol putar langsung di dalam frame ${inspection.platformLabel}, lalu tekan tombol Konfirmasi Video Terputar di bawah.`
          : `Test playback directly inside the ${inspection.platformLabel} frame, then click Confirm Playback Works below.`
      );
    } else {
      setPlaybackStatus('waiting_play');
      setPlaybackNote(
        locale === 'id'
          ? 'Tekan tombol PLAY di bawah untuk memulai pemutaran nyata dan verifikasi player.'
          : 'Click PLAY below to start real playback and verify the player.'
      );
    }
  };

  const handleConfirmConditionalEmbed = () => {
    if (!previewOpened || !inspection || inspection.verifiability !== 'conditional') return;
    if (playAttemptTimeoutRef.current) {
      window.clearTimeout(playAttemptTimeoutRef.current);
      playAttemptTimeoutRef.current = null;
    }
    setPlaybackStatus('verified_playing');
    setPlaybackNote(
      locale === 'id'
        ? `Pemutaran embed ${inspection.platformLabel} dikonfirmasi aktif. Tombol LANJUTKAN kini aktif.`
        : `${inspection.platformLabel} embed playback confirmed. CONTINUE is now enabled.`
    );
  };

  // Initialize official YouTube preview verifier
  useEffect(() => {
    if (!previewOpened || inspection?.provider !== 'youtube' || !inspection.canonicalRef) {
      return;
    }
    let cancelled = false;
    const rawRef = inspection.canonicalRef;
    const isPlaylist = rawRef.startsWith('playlist:');
    const ytPlaylistId = isPlaylist ? rawRef.slice('playlist:'.length) : undefined;
    const ytId = isPlaylist ? undefined : rawRef;

    void loadYouTubeIframeApi()
      .then((YT) => {
        if (cancelled || !ytHostRef.current) return;
        const container = document.createElement('div');
        container.className = 'w-full h-full';
        ytHostRef.current.innerHTML = '';
        ytHostRef.current.appendChild(container);

        const playerVars: Record<string, string | number> = {
          autoplay: 0,
          controls: 1,
          rel: 0,
          playsinline: 1,
          enablejsapi: 1,
          origin: window.location.origin,
        };
        if (ytPlaylistId) {
          playerVars.listType = 'playlist';
          playerVars.list = ytPlaylistId;
        }

        const player = new YT.Player(container, {
          ...(ytId ? { videoId: ytId } : {}),
          host: 'https://www.youtube-nocookie.com',
          width: '100%',
          height: '100%',
          playerVars,
          events: {
            onReady: (ev) => {
              if (cancelled) return;
              const dur = ev.target.getDuration();
              if (Number.isFinite(dur) && dur > 0) {
                setDetectedDurationSec(Math.round(dur));
              }
            },
            onStateChange: (ev) => {
              if (cancelled) return;
              const playing = YT.PlayerState?.PLAYING ?? 1;
              if (ev.data === playing) {
                if (playbackStatusRef.current === 'waiting_play') {
                  setPlaybackStatus('verifying');
                }
              }
            },
            onError: (ev) => {
              if (cancelled) return;
              const code = ev.data;
              setPlaybackStatus('play_failed');
              onInvalidate();
              if (code === 101 || code === 150) {
                setPlaybackNote(
                  locale === 'id'
                    ? 'YouTube memblokir embed pada video ini (kode 101/150). Aktifkan "Izinkan penyematan" di YouTube Studio.'
                    : 'YouTube blocked embedding on this video (code 101/150). Enable "Allow embedding" in YouTube Studio.'
                );
              } else if (code === 100) {
                setPlaybackNote(
                  locale === 'id'
                    ? 'Video YouTube tidak ditemukan atau disetel Private (kode 100).'
                    : 'YouTube video not found or set to Private (code 100).'
                );
              } else {
                setPlaybackNote(
                  locale === 'id'
                    ? `Pemutar YouTube gagal memutar video (kode error ${code}).`
                    : `YouTube player failed to play (error code ${code}).`
                );
              }
            },
          },
        });
        ytPlayerRef.current = player;
      })
      .catch((err) => {
        if (!cancelled) {
          setPlaybackStatus('play_failed');
          setPlaybackNote(
            err instanceof Error ? err.message : 'Unable to load YouTube Player API.'
          );
        }
      });

    const poll = window.setInterval(() => {
      const p = ytPlayerRef.current;
      if (!p) return;
      try {
        const t = p.getCurrentTime();
        const d = p.getDuration();
        if (Number.isFinite(d) && d > 0) {
          setDetectedDurationSec(Math.round(d));
        }
        if (Number.isFinite(t) && t > 0) {
          setObservedPlaySeconds(t);
          if (t >= 0.25 && playbackStatusRef.current !== 'play_failed') {
            if (playAttemptTimeoutRef.current) {
              window.clearTimeout(playAttemptTimeoutRef.current);
              playAttemptTimeoutRef.current = null;
            }
            setPlaybackStatus('verified_playing');
            setPlaybackNote(
              locale === 'id'
                ? `Pemutaran YouTube terverifikasi aktif (${t.toFixed(1)} detik berjalan). Tombol LANJUTKAN kini aktif.`
                : `YouTube playback verified (${t.toFixed(1)}s elapsed). CONTINUE is now enabled.`
            );
          }
        }
      } catch {
        // Ignore transient readiness exceptions
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      if (ytPlayerRef.current) {
        try {
          ytPlayerRef.current.destroy();
        } catch {
          // Ignore
        }
        ytPlayerRef.current = null;
      }
    };
  }, [previewOpened, inspection?.provider, inspection?.canonicalRef, locale]);

  // Initialize Vimeo / Dailymotion / Streamable / TikTok postMessage event verification
  useEffect(() => {
    if (
      !previewOpened ||
      !inspection ||
      (inspection.provider !== 'vimeo' &&
        inspection.provider !== 'dailymotion' &&
        inspection.provider !== 'streamable' &&
        inspection.provider !== 'tiktok')
    ) {
      return;
    }

    let playSeen = false;

    const onMessage = (event: MessageEvent) => {
      const origin = event.origin.toLowerCase();
      let payload: Record<string, unknown> | null = null;
      if (typeof event.data === 'string') {
        try {
          payload = JSON.parse(event.data) as Record<string, unknown>;
        } catch {
          return;
        }
      } else if (event.data && typeof event.data === 'object') {
        payload = event.data as Record<string, unknown>;
      }
      if (!payload) return;

      if (inspection.provider === 'vimeo' && origin === 'https://player.vimeo.com') {
        const evName = payload.event;
        if (evName === 'ready') {
          const target = iframeRef.current?.contentWindow;
          target?.postMessage(JSON.stringify({ method: 'addEventListener', value: 'play' }), 'https://player.vimeo.com');
          target?.postMessage(JSON.stringify({ method: 'addEventListener', value: 'timeupdate' }), 'https://player.vimeo.com');
          target?.postMessage(JSON.stringify({ method: 'addEventListener', value: 'error' }), 'https://player.vimeo.com');
        } else if (evName === 'play') {
          playSeen = true;
          if (playbackStatusRef.current === 'waiting_play') {
            setPlaybackStatus('verifying');
          }
        } else if (evName === 'timeupdate') {
          const dataObj = payload.data as { seconds?: number; duration?: number } | undefined;
          const sec = Number(dataObj?.seconds ?? 0);
          const dur = Number(dataObj?.duration ?? 0);
          if (Number.isFinite(dur) && dur > 0) setDetectedDurationSec(Math.round(dur));
          if (sec > 0.25 && (playSeen || sec > 0.5)) {
            if (playAttemptTimeoutRef.current) {
              window.clearTimeout(playAttemptTimeoutRef.current);
              playAttemptTimeoutRef.current = null;
            }
            setObservedPlaySeconds(sec);
            setPlaybackStatus('verified_playing');
            setPlaybackNote(
              locale === 'id'
                ? `Pemutaran Vimeo terverifikasi (${sec.toFixed(1)} detik). Tombol LANJUTKAN kini aktif.`
                : `Vimeo playback verified (${sec.toFixed(1)}s). CONTINUE is now enabled.`
            );
          }
        } else if (evName === 'error') {
          setPlaybackStatus('play_failed');
          onInvalidate();
          setPlaybackNote(
            locale === 'id'
              ? 'Vimeo melaporkan kesalahan pemutaran atau pembatasan domain.'
              : 'Vimeo reported a playback or domain privacy error.'
          );
        }
      }

      if (
        inspection.provider === 'dailymotion' &&
        origin.endsWith('dailymotion.com')
      ) {
        const evName = String(payload.event || '');
        if (evName === 'play' || evName === 'playing' || evName === 'video_start') {
          playSeen = true;
          if (playbackStatusRef.current === 'waiting_play') {
            setPlaybackStatus('verifying');
          }
        } else if (evName === 'timeupdate' || evName === 'video_timeupdate') {
          const sec = Number(payload.time ?? 0);
          const dur = Number(payload.duration ?? 0);
          if (Number.isFinite(dur) && dur > 0) setDetectedDurationSec(Math.round(dur));
          if (sec > 0.25) {
            if (playAttemptTimeoutRef.current) {
              window.clearTimeout(playAttemptTimeoutRef.current);
              playAttemptTimeoutRef.current = null;
            }
            setObservedPlaySeconds(sec);
            setPlaybackStatus('verified_playing');
            setPlaybackNote(
              locale === 'id'
                ? `Pemutaran Dailymotion terverifikasi (${sec.toFixed(1)} detik).`
                : `Dailymotion playback verified (${sec.toFixed(1)}s).`
            );
          }
        } else if (evName === 'error') {
          setPlaybackStatus('play_failed');
          onInvalidate();
          setPlaybackNote(
            locale === 'id'
              ? 'Dailymotion gagal memutar video ini.'
              : 'Dailymotion failed to play this video.'
          );
        }
      }

      if (
        inspection.provider === 'streamable' &&
        origin === 'https://streamable.com'
      ) {
        const evName = String(payload.event || '');
        if (evName === 'ready') {
          const target = iframeRef.current?.contentWindow;
          target?.postMessage(JSON.stringify({ context: 'player.js', version: '0.0.11', method: 'addEventListener', value: 'play' }), 'https://streamable.com');
          target?.postMessage(JSON.stringify({ context: 'player.js', version: '0.0.11', method: 'addEventListener', value: 'timeupdate' }), 'https://streamable.com');
        } else if (evName === 'play') {
          playSeen = true;
        } else if (evName === 'timeupdate') {
          const val = payload.value as { seconds?: number; duration?: number } | undefined;
          const sec = Number(val?.seconds ?? 0);
          const dur = Number(val?.duration ?? 0);
          if (Number.isFinite(dur) && dur > 0) setDetectedDurationSec(Math.round(dur));
          if (sec > 0.25 && playSeen) {
            if (playAttemptTimeoutRef.current) {
              window.clearTimeout(playAttemptTimeoutRef.current);
              playAttemptTimeoutRef.current = null;
            }
            setObservedPlaySeconds(sec);
            setPlaybackStatus('verified_playing');
            setPlaybackNote(
              locale === 'id'
                ? `Pemutaran Streamable terverifikasi (${sec.toFixed(1)} detik).`
                : `Streamable playback verified (${sec.toFixed(1)}s).`
            );
          }
        }
      }

      if (
        inspection.provider === 'tiktok' &&
        origin.endsWith('tiktok.com') &&
        payload['x-tiktok-player']
      ) {
        const msgType = String(payload.type || '');
        if (msgType === 'onStateChange' && Number(payload.value) === 1) {
          playSeen = true;
          if (playbackStatusRef.current === 'waiting_play') {
            setPlaybackStatus('verifying');
          }
        } else if (msgType === 'onCurrentTime') {
          const val = payload.value as { currentTime?: number; duration?: number } | undefined;
          const sec = Number(val?.currentTime ?? 0);
          const dur = Number(val?.duration ?? 0);
          if (Number.isFinite(dur) && dur > 0) setDetectedDurationSec(Math.round(dur));
          if (sec > 0.25 && playSeen) {
            if (playAttemptTimeoutRef.current) {
              window.clearTimeout(playAttemptTimeoutRef.current);
              playAttemptTimeoutRef.current = null;
            }
            setObservedPlaySeconds(sec);
            setPlaybackStatus('verified_playing');
            setPlaybackNote(
              locale === 'id'
                ? `Pemutaran TikTok terverifikasi (${sec.toFixed(1)} detik).`
                : `TikTok playback verified (${sec.toFixed(1)}s).`
            );
          }
        } else if (msgType === 'onError') {
          setPlaybackStatus('play_failed');
          onInvalidate();
          setPlaybackNote(
            locale === 'id'
              ? 'Pemutar TikTok melaporkan kesalahan pemutaran.'
              : 'TikTok player reported a playback error.'
          );
        }
      }
    };

    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
    };
  }, [previewOpened, inspection, locale]);

  // Initialize Direct Video (MP4 / WebM / MOV / HLS .m3u8 / MPEG-DASH .mpd)
  useEffect(() => {
    if (
      !previewOpened ||
      inspection?.provider !== 'direct_video' ||
      !inspection.canonicalUrl
    ) {
      return;
    }

    const videoEl = htmlVideoRef.current;
    if (!videoEl) return;

    const streamUrl = inspection.canonicalUrl;
    const format = inspection.directFormat || 'mp4';

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    if (dashRef.current) {
      try {
        dashRef.current.reset();
      } catch {
        // Ignore
      }
      dashRef.current = null;
    }

    if (format === 'hls') {
      if (Hls.isSupported()) {
        const hls = new Hls({ enableWorker: true });
        hlsRef.current = hls;
        hls.on(Hls.Events.ERROR, (_ev, data) => {
          if (data.fatal) {
            setPlaybackStatus('play_failed');
            onInvalidate();
            const code = data.response?.code;
            setPlaybackNote(
              code
                ? locale === 'id'
                  ? `Stream HLS gagal dimuat (HTTP ${code} / ${data.details}). Periksa izin CORS atau masa berlaku tautan.`
                  : `HLS stream failed (HTTP ${code} / ${data.details}). Check CORS headers or URL expiration.`
                : locale === 'id'
                ? `Stream HLS gagal diputar (${data.details}). Kemungkinan diblokir CORS atau format manifest tidak valid.`
                : `HLS stream failed to play (${data.details}). Likely CORS block or invalid manifest.`
            );
          }
        });
        hls.loadSource(streamUrl);
        hls.attachMedia(videoEl);
      } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
        videoEl.src = streamUrl;
      } else {
        setPlaybackStatus('play_failed');
        setPlaybackNote(
          locale === 'id'
            ? 'Browser tidak mendukung pemutaran HLS.'
            : 'Browser does not support HLS playback.'
        );
      }
    } else if (format === 'dash') {
      try {
        const dashPlayer = dashjs.MediaPlayer().create();
        dashRef.current = dashPlayer;
        dashPlayer.on(dashjs.MediaPlayer.events.ERROR, (ev: unknown) => {
          setPlaybackStatus('play_failed');
          onInvalidate();
          const errDetail =
            typeof ev === 'object' && ev !== null && 'error' in ev
              ? JSON.stringify((ev as { error: unknown }).error).slice(0, 120)
              : 'DASH stream error';
          setPlaybackNote(
            locale === 'id'
              ? `Stream MPEG-DASH (.mpd) gagal diputar (${errDetail}). Pastikan server mengizinkan CORS.`
              : `MPEG-DASH (.mpd) failed to play (${errDetail}). Ensure CORS is enabled.`
          );
        });
        dashPlayer.initialize(videoEl, streamUrl, false);
      } catch (err) {
        setPlaybackStatus('play_failed');
        setPlaybackNote(
          err instanceof Error ? err.message : 'Unable to initialize MPEG-DASH player.'
        );
      }
    } else {
      videoEl.src = streamUrl;
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (dashRef.current) {
        try {
          dashRef.current.reset();
        } catch {
          // Ignore
        }
        dashRef.current = null;
      }
    };
  }, [previewOpened, inspection?.provider, inspection?.canonicalUrl, inspection?.directFormat, locale]);

  const handlePlayVerifyClick = async () => {
    if (!previewOpened || !inspection) return;

    if (inspection.verifiability === 'unverifiable') {
      setPlaybackStatus('unverifiable');
      setPlaybackNote(
        locale === 'id' ? inspection.verifiabilityNoteId : inspection.verifiabilityNoteEn
      );
      return;
    }

    setPlaybackStatus('verifying');
    setPlaybackNote(
      locale === 'id'
        ? 'Memulai pemutaran & menunggu bukti frame waktu berjalan...'
        : 'Starting playback & waiting for live time progression proof...'
    );

    if (playAttemptTimeoutRef.current) {
      window.clearTimeout(playAttemptTimeoutRef.current);
    }

    // Timeout safety: never leave user hanging in "verifying" forever
    playAttemptTimeoutRef.current = window.setTimeout(() => {
      if (playbackStatusRef.current === 'verifying') {
        if (inspection.verifiability === 'conditional') {
          setPlaybackStatus('waiting_play');
          setPlaybackNote(
            locale === 'id'
              ? `${inspection.platformLabel} tidak mengirim konfirmasi otomatis. Uji pemutaran langsung di frame di atas lalu klik Konfirmasi Video Terputar.`
              : `${inspection.platformLabel} did not emit automatic events. Play directly inside the frame above, then click Confirm Playback Works.`
          );
        } else {
          setPlaybackStatus('play_failed');
          setPlaybackNote(
            locale === 'id'
              ? 'Pemutaran tidak dimulai dalam 15 detik. Pastikan video publik/izinkan embed atau periksa koneksi/CORS.'
              : 'Playback did not advance within 15 seconds. Check embed privacy, CORS headers, or press Play inside the player.'
          );
        }
      }
    }, 15000);

    if (inspection.provider === 'youtube') {
      try {
        ytPlayerRef.current?.playVideo();
      } catch {
        setPlaybackStatus('play_failed');
      }
      return;
    }

    if (inspection.provider === 'vimeo') {
      iframeRef.current?.contentWindow?.postMessage(
        JSON.stringify({ method: 'play' }),
        'https://player.vimeo.com'
      );
      return;
    }

    if (inspection.provider === 'dailymotion') {
      iframeRef.current?.contentWindow?.postMessage(
        JSON.stringify({ command: 'play', parameters: [] }),
        '*'
      );
      return;
    }

    if (inspection.provider === 'streamable') {
      iframeRef.current?.contentWindow?.postMessage(
        JSON.stringify({ context: 'player.js', version: '0.0.11', method: 'play' }),
        'https://streamable.com'
      );
      return;
    }

    if (inspection.provider === 'tiktok') {
      iframeRef.current?.contentWindow?.postMessage(
        { type: 'play', 'x-tiktok-player': true },
        'https://www.tiktok.com'
      );
      return;
    }

    if (inspection.provider === 'direct_video' && htmlVideoRef.current) {
      try {
        await htmlVideoRef.current.play();
      } catch (err) {
        // Retry muted in case browser autoplay policy blocks unmuted play()
        try {
          htmlVideoRef.current.muted = true;
          await htmlVideoRef.current.play();
        } catch (mutedErr) {
          if (playAttemptTimeoutRef.current) {
            window.clearTimeout(playAttemptTimeoutRef.current);
            playAttemptTimeoutRef.current = null;
          }
          const finalErr = mutedErr instanceof Error ? mutedErr : err;
          setPlaybackStatus('play_failed');
          setPlaybackNote(
            finalErr instanceof Error
              ? locale === 'id'
                ? `Browser gagal memutar media: ${finalErr.message}`
                : `Browser failed to play media: ${finalErr.message}`
              : locale === 'id'
              ? 'Browser gagal memutar stream video ini.'
              : 'Browser failed to play this video stream.'
          );
        }
      }
    }
  };

  const isConditionalEmbedProvider = Boolean(inspection?.verifiability === 'conditional');
  const canPreview =
    Boolean(inspection?.detected) &&
    (linkStatus === 'embeddable' || linkStatus === 'uncertain');
  const canContinue =
    playbackStatus === 'verified_playing' && Boolean(inspection?.provider);
  const detectedUrlCount = (urlInput.match(/https?:\/\//gi) || []).length;
  const looksLikeBatchPaste =
    Boolean(onSwitchToBatch) &&
    (detectedUrlCount > 1 || urlInput.trim().length > 980);

  const linkMeta = LINK_STATUS_META[linkStatus];
  const playMeta = PLAYBACK_STATUS_META[playbackStatus];

  return (
    <div className="space-y-4">
      {/* Universal URL Input */}
      <div className="space-y-2">
        <label
          htmlFor="universal-video-url"
          className="block text-xs font-semibold text-slate-900 dark:text-white"
        >
          {locale === 'id'
            ? 'Tautan Video Universal (Deteksi Platform Otomatis)'
            : 'Universal Video Link (Automatic Platform Detection)'}
        </label>
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Link2
              className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              id="universal-video-url"
              type="url"
              value={urlInput}
              onChange={(e) => handleUrlChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleCheckLink();
                }
              }}
              placeholder={
                locale === 'id'
                  ? 'Tempel tautan video dari platform yang didukung...'
                  : 'Paste a video link from a supported platform or stream URL...'
              }
              className="w-full min-h-[44px] pl-10 pr-3.5 py-2.5 rounded-xl bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-xs sm:text-sm font-mono text-slate-900 dark:text-slate-100 placeholder:font-sans placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />
          </div>
          <Button
            type="button"
            variant="secondary"
            size="md"
            className="shrink-0"
            isLoading={linkStatus === 'checking'}
            onClick={() => void handleCheckLink()}
          >
            {locale === 'id' ? 'PERIKSA TAUTAN' : 'CHECK LINK'}
          </Button>
        </div>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
          {locale === 'id'
            ? 'Mendukung deteksi otomatis Halaman Web HTML (ekstraksi video otomatis atau awalan html:), YouTube (termasuk Playlist), Vimeo, Dailymotion, Dropbox, Google Drive, Internet Archive, Twitch, Rumble, Odysee, Loom, Bilibili, Streamable, serta stream langsung MP4 / WebM / MOV / HLS (.m3u8) / MPEG-DASH (.mpd).'
            : 'Auto-detects HTML Web Pages (auto video extraction or html: prefix), YouTube (including Playlists), Vimeo, Dailymotion, Dropbox, Google Drive, Internet Archive, Twitch, Rumble, Odysee, Loom, Bilibili, Streamable, and direct HTTPS MP4 / WebM / MOV / HLS (.m3u8) / MPEG-DASH (.mpd).'}
        </p>
        {looksLikeBatchPaste && onSwitchToBatch && (
          <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800/70 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-900 dark:text-amber-200">
            <span>
              {locale === 'id'
                ? `Terdeteksi ${detectedUrlCount > 1 ? `${detectedUrlCount} tautan` : 'teks >980 karakter'}. Gunakan mode Banyak Tautan Sekaligus agar semua tautan terurai tanpa batas 980 karakter.`
                : `Detected ${detectedUrlCount > 1 ? `${detectedUrlCount} links` : '>980 characters'}. Switch to Batch Mode to parse and import all links without the 980-character limit.`}
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => onSwitchToBatch(urlInput)}
            >
              {locale === 'id' ? 'Pindahkan ke Banyak Tautan' : 'Switch to Batch Mode'}
            </Button>
          </div>
        )}
      </div>

      {/* Status Check Panel (Link Check Status - separate from Playback Verification) */}
      <div className={`p-3.5 rounded-xl border space-y-2 ${linkMeta.toneClass}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-bold tracking-wide">
            {linkStatus === 'checking' && <Loader2 className="w-4 h-4 animate-spin shrink-0" />}
            {linkStatus === 'embeddable' && <CheckCircle2 className="w-4 h-4 shrink-0" />}
            {linkStatus === 'unavailable' && <XCircle className="w-4 h-4 shrink-0" />}
            {linkStatus === 'uncertain' && <HelpCircle className="w-4 h-4 shrink-0" />}
            {linkStatus === 'waiting' && <AlertCircle className="w-4 h-4 shrink-0" />}
            <span>
              {locale === 'id' ? 'Status Tautan:' : 'Link Status:'}{' '}
              {locale === 'id' ? linkMeta.labelId : linkMeta.labelEn}
            </span>
          </div>

          {inspection?.detected && (
            <span className="text-[11px] font-mono font-semibold">
              {inspection.platformLabel}
            </span>
          )}
        </div>

        <p className="text-xs leading-relaxed">
          {inspectErr
            ? inspectErr
            : inspection
            ? locale === 'id'
              ? inspection.messageId
              : inspection.messageEn
            : locale === 'id'
            ? 'Belum ada pemeriksaan. Tempel URL video HTTPS lalu klik PERIKSA TAUTAN.'
            : 'No check run yet. Paste an HTTPS video URL and click CHECK LINK.'}
        </p>

        {inspection?.detected && (
          <div className="pt-2 border-t border-current/15 flex flex-col sm:flex-row sm:items-center gap-3">
            {inspection.thumbnailUrl && (
              <div className="w-28 aspect-video rounded-lg overflow-hidden bg-slate-900 shrink-0 border border-current/20">
                <img
                  src={inspection.thumbnailUrl}
                  alt={inspection.titleHint || inspection.platformLabel}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              </div>
            )}
            <div className="min-w-0 flex-1 space-y-0.5 text-[11px]">
              {inspection.titleHint && (
                <p className="font-semibold truncate">{inspection.titleHint}</p>
              )}
              {inspection.authorHint && (
                <p className="opacity-85 truncate">
                  {locale === 'id' ? 'Sumber / Kanal:' : 'Channel / Author:'} {inspection.authorHint}
                </p>
              )}
              <p className="font-mono opacity-80 truncate">{inspection.canonicalUrl}</p>
              {inspection.mimeType && (
                <p className="font-mono opacity-80">
                  MIME: {inspection.mimeType}
                  {inspection.corsReady === false ? ' · CORS header missing' : ''}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Preview Button Row */}
      {canPreview && !previewOpened && (
        <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <p className="text-xs text-slate-600 dark:text-slate-300">
            {locale === 'id'
              ? 'Langkah selanjutnya: buka pemutar Preview lalu tekan PLAY untuk membuktikan video benar-benar berjalan.'
              : 'Next step: open the Preview player and press PLAY to prove real playback.'}
          </p>
          <Button
            type="button"
            variant="primary"
            size="sm"
            leftIcon={<Eye className="w-4 h-4" />}
            onClick={handleOpenPreview}
          >
            PREVIEW
          </Button>
        </div>
      )}

      {/* Live Preview Player + Mandatory PLAY Verification */}
      {previewOpened && inspection?.detected && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden space-y-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-bold text-slate-900 dark:text-white">
                {locale === 'id'
                  ? `Preview Pemutar Resmi · ${inspection.platformLabel}`
                  : `Official Preview Player · ${inspection.platformLabel}`}
              </p>
              <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate max-w-md">
                {inspection.canonicalUrl}
              </p>
            </div>
            {observedPlaySeconds > 0 && (
              <span className="text-xs font-mono tabular-nums text-emerald-700 dark:text-emerald-400 font-semibold">
                {observedPlaySeconds.toFixed(1)}s
                {detectedDurationSec ? ` / ${detectedDurationSec}s` : ''}
              </span>
            )}
          </div>

          {/* Aspect Ratio & Framing Controls */}
          {(() => {
            const effectiveRatio = resolveEffectiveAspectRatio(
              selectedAspectRatio,
              detectedAspectRatio
            );
            const stageStyle = getAdaptiveFrameStyle(effectiveRatio, '56dvh');

            return (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 mr-1">
                      {locale === 'id' ? 'Rasio:' : 'Aspect:'}
                    </span>
                    {VIDEO_ASPECT_OPTIONS.map((opt) => {
                      const active = selectedAspectRatio === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setSelectedAspectRatio(opt.value)}
                          className={`min-h-[30px] px-2 py-1 rounded-lg text-[11px] font-mono font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                            active
                              ? 'bg-emerald-600 text-white'
                              : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-800 hover:border-emerald-500'
                          }`}
                        >
                          {opt.value === 'auto'
                            ? `${opt.shortLabel} (${effectiveRatio})`
                            : opt.shortLabel}
                        </button>
                      );
                    })}
                  </div>

                  {inspection.provider === 'direct_video' && (
                    <div className="inline-flex items-center gap-1 p-0.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                      <button
                        type="button"
                        onClick={() => setVideoFitMode('contain')}
                        className={`px-2 py-1 rounded-md text-[11px] font-semibold cursor-pointer transition-colors ${
                          videoFitMode === 'contain'
                            ? 'bg-slate-900 dark:bg-emerald-600 text-white'
                            : 'text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {locale === 'id' ? 'Utuh (Fit)' : 'Fit'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setVideoFitMode('cover')}
                        className={`px-2 py-1 rounded-md text-[11px] font-semibold cursor-pointer transition-colors ${
                          videoFitMode === 'cover'
                            ? 'bg-slate-900 dark:bg-emerald-600 text-white'
                            : 'text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {locale === 'id' ? 'Penuh (Fill)' : 'Fill'}
                      </button>
                    </div>
                  )}
                </div>

                {/* Adaptive Player Stage */}
                <div className="w-full rounded-xl overflow-hidden bg-slate-950 border border-slate-800 flex items-center justify-center">
                  <div style={stageStyle} className="relative bg-black overflow-hidden">
                    {inspection.provider === 'youtube' && (
                      <div ref={ytHostRef} className="w-full h-full" />
                    )}

                    {inspection.provider !== 'youtube' &&
                      inspection.provider !== 'direct_video' &&
                      (() => {
                        const resolvedEmbedSrc =
                          inspection.provider === 'twitch'
                            ? buildTwitchEmbedUrl(
                                inspection.canonicalRef,
                                typeof window !== 'undefined'
                                  ? window.location.hostname
                                  : 'localhost'
                              )
                            : inspection.embedUrl;
                        if (!resolvedEmbedSrc) return null;
                        return (
                          <iframe
                            ref={iframeRef}
                            src={resolvedEmbedSrc}
                            title={`${inspection.platformLabel} Preview`}
                            className="w-full h-full border-0 bg-black"
                            allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
                            sandbox={
                              inspection.provider === 'html_embed'
                                ? 'allow-scripts allow-same-origin allow-presentation allow-forms'
                                : undefined
                            }
                            allowFullScreen
                            referrerPolicy="strict-origin-when-cross-origin"
                            onLoad={() => setIframeLoaded(true)}
                          />
                        );
                      })()}

                    {inspection.provider === 'direct_video' && (
                      <video
                        ref={htmlVideoRef}
                        controls
                        playsInline
                        preload="metadata"
                        onLoadedMetadata={() => {
                          const v = htmlVideoRef.current;
                          if (!v) return;
                          if (Number.isFinite(v.duration) && v.duration > 0) {
                            setDetectedDurationSec(Math.round(v.duration));
                          }
                          if (v.videoWidth > 0 && v.videoHeight > 0) {
                            setDetectedAspectRatio(
                              inferAspectRatioFromDimensions(v.videoWidth, v.videoHeight)
                            );
                          }
                        }}
                        onPlaying={() => {
                          if (playbackStatusRef.current === 'waiting_play') {
                            setPlaybackStatus('verifying');
                          }
                        }}
                        onTimeUpdate={() => {
                          const v = htmlVideoRef.current;
                          if (!v) return;
                          if (v.currentTime > 0) {
                            setObservedPlaySeconds(v.currentTime);
                          }
                          if (v.currentTime >= 0.25 && v.readyState >= 2) {
                            if (playAttemptTimeoutRef.current) {
                              window.clearTimeout(playAttemptTimeoutRef.current);
                              playAttemptTimeoutRef.current = null;
                            }
                            setPlaybackStatus('verified_playing');
                            setPlaybackNote(
                              locale === 'id'
                                ? `Stream video berhasil diputar (${v.currentTime.toFixed(1)} detik berjalan). Tombol LANJUTKAN kini aktif.`
                                : `Direct video stream verified (${v.currentTime.toFixed(1)}s elapsed). CONTINUE is now enabled.`
                            );
                          }
                        }}
                        onError={() => {
                          const err = htmlVideoRef.current?.error;
                          setPlaybackStatus('play_failed');
                          onInvalidate();
                          setPlaybackNote(
                            locale === 'id'
                              ? `Gagal memutar file/stream video (kode MediaError ${err?.code ?? 'unknown'}). Periksa codec, status HTTP, atau header CORS.`
                              : `Video playback failed (MediaError code ${err?.code ?? 'unknown'}). Check codec, HTTP access, or CORS headers.`
                          );
                        }}
                        className={`w-full h-full bg-black ${
                          videoFitMode === 'cover' ? 'object-cover' : 'object-contain'
                        }`}
                      />
                    )}
                  </div>
                </div>
              </>
            );
          })()}

          {/* Playback Verification Status & Action Controls */}
          <div className={`p-3.5 rounded-xl border space-y-2 ${playMeta.toneClass}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold tracking-wide">
                {locale === 'id' ? 'Status Pemutaran:' : 'Playback Status:'}{' '}
                {locale === 'id' ? playMeta.labelId : playMeta.labelEn}
              </span>
              {inspection.verifiability === 'unverifiable' && (
                <span className="text-[11px] font-medium">
                  {locale === 'id' ? 'Tidak menyediakan API verifikasi putar' : 'No playback API'}
                </span>
              )}
            </div>
            <p className="text-xs leading-relaxed">
              {playbackNote ||
                (locale === 'id'
                  ? inspection.verifiabilityNoteId
                  : inspection.verifiabilityNoteEn)}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
            <div className="flex flex-wrap items-center gap-2">
              {(!isConditionalEmbedProvider ||
                inspection.provider === 'streamable' ||
                inspection.provider === 'tiktok') && (
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  leftIcon={<Play className="w-4 h-4 fill-current" />}
                  isLoading={playbackStatus === 'verifying'}
                  disabled={inspection.verifiability === 'unverifiable'}
                  onClick={() => void handlePlayVerifyClick()}
                >
                  PLAY
                </Button>
              )}
              {isConditionalEmbedProvider && playbackStatus !== 'verified_playing' && (
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  leftIcon={<CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />}
                  disabled={!iframeLoaded && !previewGraceReady}
                  onClick={handleConfirmConditionalEmbed}
                >
                  {locale === 'id' ? 'Konfirmasi Video Terputar' : 'Confirm Playback Works'}
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="md"
                onClick={() => void handleOpenPreview()}
              >
                {locale === 'id' ? 'Muat Ulang Preview' : 'Reload Preview'}
              </Button>
            </div>

            <Button
              type="button"
              variant="primary"
              size="md"
              disabled={!canContinue}
              rightIcon={<ArrowRight className="w-4 h-4" />}
              onClick={() => {
                if (!canContinue || !inspection?.provider) return;
                onContinue({
                  provider: inspection.provider,
                  assetRef: inspection.canonicalRef,
                  canonicalUrl: inspection.canonicalUrl,
                  platformLabel: inspection.platformLabel,
                  titleHint: inspection.titleHint,
                  thumbnailUrl: inspection.thumbnailUrl,
                  durationMinutesHint: detectedDurationSec
                    ? Math.max(1, Math.round(detectedDurationSec / 60))
                    : undefined,
                  aspectRatio: resolveEffectiveAspectRatio(
                    selectedAspectRatio,
                    detectedAspectRatio
                  ),
                  videoFitMode,
                  mimeType:
                    inspection.mimeType ||
                    `video/${inspection.provider}`,
                  directFormat: inspection.directFormat,
                });
              }}
            >
              {isContinued
                ? locale === 'id'
                  ? 'LANJUTKAN (TERVERIFIKASI)'
                  : 'CONTINUE (VERIFIED)'
                : locale === 'id'
                ? 'LANJUTKAN'
                : 'CONTINUE'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
