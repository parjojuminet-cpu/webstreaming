import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import * as dashjs from 'dashjs';
import {
  CheckCircle2,
  Link2,
  Loader2,
  Play,
  Square,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import { inspectCreatorVideoLink } from '../../services/streamService';
import { buildTwitchEmbedUrl } from '../../services/videoImport/adapters';
import {
  parseBatchVideoInput,
} from '../../services/videoImport/batchParser';
import type { LinkInspectionDiagnostics } from '../../services/videoImport/types';
import type {
  ContentCategory,
  DirectStreamFormat,
  LinkCheckStatus,
  LocaleCode,
  PlaybackCheckStatus,
  VideoAspectRatio,
  VideoAssetProvider,
  VideoFitMode,
} from '../../types/vyora';
import { CATEGORY_LIST } from '../../i18n/translations';
import {
  VIDEO_ASPECT_OPTIONS,
  getAdaptiveFrameStyle,
  inferAspectRatioFromUrlOrProvider,
  resolveEffectiveAspectRatio,
} from '../../utils/videoAspect';
import { loadYouTubeIframeApi, type YTPlayerInstance } from '../../utils/youtubeApi';
import { Button } from '../ui/Button';

export interface BatchSaveVideoInput {
  title: string;
  subtitle: string;
  description: string;
  category: ContentCategory;
  thumbnailUrl: string;
  durationMinutes: number;
  isFree: boolean;
  priceUsd: number;
  priceIdr: number;
  creditCost: number;
  releaseYear: number;
  resolution: '4K HDR' | '4K UHD' | '1080p HD';
  aspectRatio: VideoAspectRatio;
  videoFitMode: VideoFitMode;
  audioFormat: string;
  languages: string[];
  assetProvider: VideoAssetProvider;
  assetRef: string;
  mimeType?: string;
  initialStatus: 'draft' | 'pending_review' | 'published';
}

interface BatchQueueItem {
  id: string;
  rawUrl: string;
  title: string;
  subtitle: string;
  description: string;
  thumbnailUrl: string;
  durationMinutes: number;
  aspectRatio: VideoAspectRatio;
  linkStatus: LinkCheckStatus;
  playbackStatus: PlaybackCheckStatus;
  inspection: LinkInspectionDiagnostics | null;
  statusNote: string;
  saved: boolean;
  saveError?: string;
}

interface BatchVideoImportPanelProps {
  locale: LocaleCode;
  isAdmin?: boolean;
  defaultCategory?: ContentCategory;
  initialText?: string;
  onSaveBatchItem: (input: BatchSaveVideoInput) => Promise<void>;
  onBatchFinished?: (savedCount: number) => void;
  onViewSavedContent?: () => void;
}

const FALLBACK_COVER = '/src/assets/images/thumb_acoustic_session_1794930899091.jpg';

const inputClass =
  'w-full min-h-[40px] px-3 py-2 rounded-xl bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-xs sm:text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-600';

export const BatchVideoImportPanel: React.FC<BatchVideoImportPanelProps> = ({
  locale,
  isAdmin = false,
  defaultCategory = 'Events',
  initialText = '',
  onSaveBatchItem,
  onBatchFinished,
  onViewSavedContent,
}) => {
  const [rawText, setRawText] = useState(initialText);
  const [items, setItems] = useState<BatchQueueItem[]>([]);
  const [parsingAndInspecting, setParsingAndInspecting] = useState(false);
  const [inspectProgress, setInspectProgress] = useState<{ done: number; total: number } | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  const [verifyingQueue, setVerifyingQueue] = useState(false);
  const [activePreviewItemId, setActivePreviewItemId] = useState<string | null>(null);
  const [verifyProgress, setVerifyProgress] = useState<{ done: number; total: number } | null>(null);

  // Shared batch publish metadata
  const [batchCategory, setBatchCategory] = useState<ContentCategory>(defaultCategory);
  const [batchPricingMode, setBatchPricingMode] = useState<'free' | 'paid'>('free');
  const [batchPriceUsd, setBatchPriceUsd] = useState(1.99);
  const [batchPriceIdr, setBatchPriceIdr] = useState(29000);
  const [batchCreditCost, setBatchCreditCost] = useState(2);
  const [batchLanguages, setBatchLanguages] = useState('Indonesian');
  const [batchInitialStatus, setBatchInitialStatus] = useState<
    'draft' | 'pending_review' | 'published'
  >(isAdmin ? 'published' : 'pending_review');

  const [savingBatch, setSavingBatch] = useState(false);
  const [saveProgress, setSaveProgress] = useState<{ done: number; total: number } | null>(null);
  const [batchSummaryMsg, setBatchSummaryMsg] = useState<string | null>(null);

  const ytHostRef = useRef<HTMLDivElement | null>(null);
  const htmlVideoRef = useRef<HTMLVideoElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const cancelVerifyRef = useRef(false);
  const mountedRef = useRef(true);

  const activePreviewItem = items.find((i) => i.id === activePreviewItemId) ?? null;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelVerifyRef.current = true;
    };
  }, []);

  useEffect(() => {
    if (initialText && initialText.trim()) {
      setRawText(initialText);
    }
  }, [initialText]);

  const updateItem = (id: string, patch: Partial<BatchQueueItem>) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item))
    );
  };

  const handleParseAndInspect = async () => {
    setParseError(null);
    setBatchSummaryMsg(null);
    const parsed = parseBatchVideoInput(rawText);

    if (parsed.length === 0) {
      setParseError(
        locale === 'id'
          ? 'Tidak ada tautan HTTPS (YouTube/video) yang ditemukan di teks Anda.'
          : 'No valid HTTPS video or YouTube links were detected in your text.'
      );
      return;
    }

    const initialItems: BatchQueueItem[] = parsed.map((p) => ({
      id: p.id,
      rawUrl: p.url,
      title: (p.title || '').slice(0, 140),
      subtitle: '',
      description: (p.description || '').slice(0, 2000),
      thumbnailUrl: FALLBACK_COVER,
      durationMinutes: 15,
      aspectRatio: inferAspectRatioFromUrlOrProvider({ url: p.url }),
      linkStatus: 'checking',
      playbackStatus: 'waiting_play',
      inspection: null,
      statusNote:
        locale === 'id' ? 'Memeriksa tautan...' : 'Inspecting link...',
      saved: false,
    }));

    setItems(initialItems);
    setParsingAndInspecting(true);
    setInspectProgress({ done: 0, total: initialItems.length });

    const queue = [...initialItems];
    let doneCount = 0;

    const runWorker = async () => {
      while (queue.length > 0) {
        const current = queue.shift();
        if (!current || !mountedRef.current) return;

        try {
          const diag = await inspectCreatorVideoLink(current.rawUrl);
          const resolvedTitle = (
            current.title.trim() ||
            diag.titleHint ||
            diag.platformLabel ||
            'Video DELOKEN'
          ).slice(0, 140);

          const resolvedSubtitle = (
            diag.authorHint
              ? `${diag.authorHint} · ${diag.platformLabel}`
              : `${diag.platformLabel} · DELOKEN`
          ).slice(0, 220);

          const rawDesc = current.description.trim();
          const resolvedDesc = (
            rawDesc.length >= 10
              ? rawDesc
              : `${resolvedTitle}${diag.authorHint ? ` oleh ${diag.authorHint}` : ''} (${diag.platformLabel}). Tayangan terverifikasi di DELOKEN.`
          ).slice(0, 2000);

          const resolvedDuration = diag.durationSecondsHint
            ? Math.max(1, Math.min(600, Math.round(diag.durationSecondsHint / 60)))
            : 15;

          const resolvedThumb = diag.thumbnailUrl || FALLBACK_COVER;
          const resolvedRatio =
            diag.aspectRatioHint ||
            inferAspectRatioFromUrlOrProvider({
              provider: diag.provider,
              url: diag.canonicalUrl || current.rawUrl,
              width: diag.detectedWidth,
              height: diag.detectedHeight,
            });

          if (!mountedRef.current) return;
          updateItem(current.id, {
            title: resolvedTitle,
            subtitle: resolvedSubtitle.length >= 4 ? resolvedSubtitle : `${resolvedSubtitle} HD`,
            description: resolvedDesc,
            thumbnailUrl: resolvedThumb,
            durationMinutes: resolvedDuration,
            aspectRatio: resolvedRatio,
            inspection: diag,
            linkStatus: diag.linkStatus,
            playbackStatus:
              diag.verifiability === 'unverifiable' ? 'unverifiable' : 'waiting_play',
            statusNote:
              locale === 'id' ? diag.messageId : diag.messageEn,
          });
        } catch (err) {
          if (!mountedRef.current) return;
          updateItem(current.id, {
            linkStatus: 'uncertain',
            playbackStatus: 'play_failed',
            statusNote:
              err instanceof Error
                ? err.message
                : locale === 'id'
                ? 'Gagal memeriksa tautan.'
                : 'Failed to inspect link.',
          });
        } finally {
          doneCount += 1;
          if (mountedRef.current) {
            setInspectProgress({ done: doneCount, total: initialItems.length });
          }
        }
      }
    };

    const workers = Array.from({ length: Math.min(4, initialItems.length) }, () =>
      runWorker()
    );
    await Promise.all(workers);

    if (mountedRef.current) {
      setParsingAndInspecting(false);
    }
  };

  const verifySingleItemPlayback = async (
    item: BatchQueueItem
  ): Promise<{ ok: boolean; status: PlaybackCheckStatus; note: string; durationMin?: number }> => {
    const diag = item.inspection;
    if (!diag || !diag.detected || !diag.provider) {
      return {
        ok: false,
        status: 'play_failed',
        note: locale === 'id' ? 'Tautan belum terdeteksi.' : 'Link not detected.',
      };
    }
    if (diag.verifiability === 'unverifiable') {
      return {
        ok: false,
        status: 'unverifiable',
        note: locale === 'id' ? diag.verifiabilityNoteId : diag.verifiabilityNoteEn,
      };
    }

    setActivePreviewItemId(item.id);
    updateItem(item.id, {
      playbackStatus: 'verifying',
      statusNote:
        locale === 'id'
          ? 'Memulai pemutaran nyata untuk verifikasi...'
          : 'Starting real playback verification...',
    });

    // Wait one animation frame for preview container DOM to mount
    await new Promise((r) => window.requestAnimationFrame(() => r(undefined)));

    if (diag.provider === 'youtube') {
      const YT = await loadYouTubeIframeApi();
      return await new Promise((resolve) => {
        if (!ytHostRef.current) {
          resolve({
            ok: false,
            status: 'play_failed',
            note: 'Preview player container missing.',
          });
          return;
        }

        let settled = false;
        let player: YTPlayerInstance | null = null;
        let pollTimer: number | null = null;
        let timeoutTimer: number | null = null;

        const finish = (res: {
          ok: boolean;
          status: PlaybackCheckStatus;
          note: string;
          durationMin?: number;
        }) => {
          if (settled) return;
          settled = true;
          if (pollTimer) window.clearInterval(pollTimer);
          if (timeoutTimer) window.clearTimeout(timeoutTimer);
          if (player) {
            try {
              player.destroy();
            } catch {
              // Ignore cleanup errors
            }
          }
          resolve(res);
        };

        const rawRef = diag.canonicalRef;
        const isPlaylist = rawRef.startsWith('playlist:');
        const ytPlaylistId = isPlaylist ? rawRef.slice('playlist:'.length) : undefined;
        const ytId = isPlaylist ? undefined : rawRef;

        const container = document.createElement('div');
        container.className = 'w-full h-full';
        ytHostRef.current.innerHTML = '';
        ytHostRef.current.appendChild(container);

        const playerVars: Record<string, string | number> = {
          autoplay: 1,
          mute: 1,
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

        player = new YT.Player(container, {
          ...(ytId ? { videoId: ytId } : {}),
          host: 'https://www.youtube-nocookie.com',
          width: '100%',
          height: '100%',
          playerVars,
          events: {
            onReady: (ev) => {
              if (settled || cancelVerifyRef.current) return;
              try {
                ev.target.mute();
                ev.target.playVideo();
              } catch {
                // Ignore
              }
            },
            onError: (ev) => {
              const code = ev.data;
              const msg =
                code === 101 || code === 150
                  ? locale === 'id'
                    ? 'YouTube memblokir embed pada video ini (kode 101/150).'
                    : 'YouTube blocked embedding on this video (code 101/150).'
                  : code === 100
                  ? locale === 'id'
                    ? 'Video YouTube tidak ditemukan atau Private (kode 100).'
                    : 'YouTube video unavailable or Private (code 100).'
                  : locale === 'id'
                  ? `Pemutar YouTube gagal memutar (kode ${code}).`
                  : `YouTube player error (code ${code}).`;
              finish({ ok: false, status: 'play_failed', note: msg });
            },
          },
        });

        pollTimer = window.setInterval(() => {
          if (cancelVerifyRef.current) {
            finish({
              ok: false,
              status: 'waiting_play',
              note: locale === 'id' ? 'Verifikasi dihentikan.' : 'Verification cancelled.',
            });
            return;
          }
          if (!player) return;
          try {
            const t = player.getCurrentTime();
            const d = player.getDuration();
            if (Number.isFinite(t) && t >= 0.25) {
              const durMin =
                Number.isFinite(d) && d > 0 ? Math.max(1, Math.min(600, Math.round(d / 60))) : undefined;
              finish({
                ok: true,
                status: 'verified_playing',
                durationMin: durMin,
                note:
                  locale === 'id'
                    ? `Pemutaran YouTube terverifikasi aktif (${t.toFixed(1)}s).`
                    : `YouTube playback verified (${t.toFixed(1)}s).`,
              });
            }
          } catch {
            // Ignore transient readiness exceptions
          }
        }, 250);

        timeoutTimer = window.setTimeout(() => {
          finish({
            ok: false,
            status: 'play_failed',
            note:
              locale === 'id'
                ? 'Pemutaran YouTube tidak dimulai dalam 15 detik.'
                : 'YouTube playback did not start within 15 seconds.',
          });
        }, 15000);
      });
    }

    if (diag.provider === 'direct_video') {
      return await new Promise((resolve) => {
        const videoEl = htmlVideoRef.current;
        if (!videoEl) {
          resolve({
            ok: false,
            status: 'play_failed',
            note: 'Video element missing.',
          });
          return;
        }
        let settled = false;
        let hls: Hls | null = null;
        let dashPlayer: dashjs.MediaPlayerClass | null = null;
        let timeoutTimer: number | null = null;

        const finish = (res: {
          ok: boolean;
          status: PlaybackCheckStatus;
          note: string;
          durationMin?: number;
        }) => {
          if (settled) return;
          settled = true;
          if (timeoutTimer) window.clearTimeout(timeoutTimer);
          videoEl.removeEventListener('timeupdate', onTime);
          videoEl.removeEventListener('error', onErr);
          videoEl.pause();
          videoEl.removeAttribute('src');
          videoEl.load();
          if (hls) hls.destroy();
          if (dashPlayer) {
            try {
              dashPlayer.reset();
            } catch {
              // Ignore
            }
          }
          resolve(res);
        };

        const onTime = () => {
          if (cancelVerifyRef.current) {
            finish({
              ok: false,
              status: 'waiting_play',
              note: locale === 'id' ? 'Verifikasi dihentikan.' : 'Cancelled.',
            });
            return;
          }
          if (videoEl.currentTime >= 0.25 && videoEl.readyState >= 2) {
            const durMin =
              Number.isFinite(videoEl.duration) && videoEl.duration > 0
                ? Math.max(1, Math.min(600, Math.round(videoEl.duration / 60)))
                : undefined;
            finish({
              ok: true,
              status: 'verified_playing',
              durationMin: durMin,
              note:
                locale === 'id'
                  ? `Stream berhasil diputar (${videoEl.currentTime.toFixed(1)}s).`
                  : `Stream playback verified (${videoEl.currentTime.toFixed(1)}s).`,
            });
          }
        };

        const onErr = () => {
          finish({
            ok: false,
            status: 'play_failed',
            note:
              locale === 'id'
                ? 'Stream video gagal diputar (periksa URL/CORS).'
                : 'Stream playback failed (check URL/CORS).',
          });
        };

        videoEl.muted = true;
        videoEl.addEventListener('timeupdate', onTime);
        videoEl.addEventListener('error', onErr);

        const format: DirectStreamFormat = diag.directFormat || 'mp4';
        if (format === 'hls' && Hls.isSupported()) {
          hls = new Hls({ enableWorker: true });
          hls.on(Hls.Events.ERROR, (_ev, data) => {
            if (data.fatal) onErr();
          });
          hls.loadSource(diag.canonicalUrl);
          hls.attachMedia(videoEl);
        } else if (format === 'dash') {
          try {
            dashPlayer = dashjs.MediaPlayer().create();
            dashPlayer.on(dashjs.MediaPlayer.events.ERROR, onErr);
            dashPlayer.initialize(videoEl, diag.canonicalUrl, true);
          } catch {
            onErr();
          }
        } else {
          videoEl.src = diag.canonicalUrl;
        }

        void videoEl.play().catch(() => {
          // Wait for autoplay/load or timeout
        });

        timeoutTimer = window.setTimeout(() => {
          finish({
            ok: false,
            status: 'play_failed',
            note:
              locale === 'id'
                ? 'Stream tidak berjalan dalam 15 detik.'
                : 'Stream did not start within 15 seconds.',
          });
        }, 15000);
      });
    }

    // Passive/conditional iframe embeds (Facebook, X, Instagram, Streamable, TikTok, Google Drive, Internet Archive, Twitch, Rumble, Odysee, Loom, Bilibili, HTML embed)
    if (
      diag.provider === 'facebook' ||
      diag.provider === 'x' ||
      diag.provider === 'instagram' ||
      diag.provider === 'streamable' ||
      diag.provider === 'tiktok' ||
      diag.provider === 'google_drive' ||
      diag.provider === 'archive_org' ||
      diag.provider === 'twitch' ||
      diag.provider === 'rumble' ||
      diag.provider === 'odysee' ||
      diag.provider === 'loom' ||
      diag.provider === 'bilibili' ||
      diag.provider === 'html_embed'
    ) {
      return await new Promise((resolve) => {
        const frameEl = iframeRef.current;
        if (!frameEl) {
          resolve({
            ok: false,
            status: 'play_failed',
            note: 'Preview iframe container missing.',
          });
          return;
        }
        let settled = false;
        let timeoutTimer: number | null = null;
        const cleanup = () => {
          if (timeoutTimer) window.clearTimeout(timeoutTimer);
          frameEl.removeEventListener('load', onLoad);
          frameEl.removeEventListener('error', onErr);
        };
        const finish = (res: {
          ok: boolean;
          status: PlaybackCheckStatus;
          note: string;
        }) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(res);
        };
        const onLoad = () => {
          finish({
            ok: true,
            status: 'verified_playing',
            note:
              locale === 'id'
                ? `${diag.platformLabel} frame berhasil dimuat dan siap diputar.`
                : `${diag.platformLabel} frame loaded and ready.`,
          });
        };
        const onErr = () => {
          finish({
            ok: false,
            status: 'play_failed',
            note:
              locale === 'id'
                ? `Gagal memuat frame ${diag.platformLabel}.`
                : `Failed to load ${diag.platformLabel} frame.`,
          });
        };
        frameEl.addEventListener('load', onLoad);
        frameEl.addEventListener('error', onErr);
        timeoutTimer = window.setTimeout(() => {
          finish({
            ok: false,
            status: 'play_failed',
            note:
              locale === 'id'
                ? `Frame ${diag.platformLabel} tidak merespons dalam 15 detik.`
                : `${diag.platformLabel} frame did not respond within 15 seconds.`,
          });
        }, 15000);
      });
    }

    // Vimeo / Dailymotion / Streamable / TikTok postMessage fallback verifier
    return await new Promise((resolve) => {
      let settled = false;
      let timeoutTimer: number | null = null;

      const finish = (res: {
        ok: boolean;
        status: PlaybackCheckStatus;
        note: string;
        durationMin?: number;
      }) => {
        if (settled) return;
        settled = true;
        if (timeoutTimer) window.clearTimeout(timeoutTimer);
        window.removeEventListener('message', onMessage);
        resolve(res);
      };

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

        if (diag.provider === 'vimeo' && origin === 'https://player.vimeo.com') {
          if (payload.event === 'ready') {
            const win = iframeRef.current?.contentWindow;
            win?.postMessage(JSON.stringify({ method: 'addEventListener', value: 'timeupdate' }), 'https://player.vimeo.com');
            win?.postMessage(JSON.stringify({ method: 'setVolume', value: 0 }), 'https://player.vimeo.com');
            win?.postMessage(JSON.stringify({ method: 'play' }), 'https://player.vimeo.com');
          } else if (payload.event === 'timeupdate') {
            const sec = Number((payload.data as { seconds?: number })?.seconds ?? 0);
            if (sec > 0.25) {
              finish({
                ok: true,
                status: 'verified_playing',
                note: locale === 'id' ? 'Pemutaran Vimeo terverifikasi.' : 'Vimeo playback verified.',
              });
            }
          }
        } else if (diag.provider === 'dailymotion' && origin.endsWith('dailymotion.com')) {
          const evName = String(payload.event || '');
          if (evName === 'apiready') {
            iframeRef.current?.contentWindow?.postMessage(JSON.stringify({ command: 'mute', parameters: [] }), '*');
            iframeRef.current?.contentWindow?.postMessage(JSON.stringify({ command: 'play', parameters: [] }), '*');
          } else if ((evName === 'timeupdate' || evName === 'video_timeupdate') && Number(payload.time ?? 0) > 0.25) {
            finish({
              ok: true,
              status: 'verified_playing',
              note: locale === 'id' ? 'Pemutaran Dailymotion terverifikasi.' : 'Dailymotion playback verified.',
            });
          }
        }
      };

      window.addEventListener('message', onMessage);
      timeoutTimer = window.setTimeout(() => {
        finish({
          ok: false,
          status: diag.verifiability === 'conditional' ? 'unverifiable' : 'play_failed',
          note:
            locale === 'id'
              ? 'Player tidak mengirim konfirmasi pemutaran dalam 15 detik.'
              : 'Player did not confirm playback within 15 seconds.',
        });
      }, 15000);
    });
  };

  const handleVerifyAllPlayback = async () => {
    const candidates = items.filter(
      (it) =>
        !it.saved &&
        it.playbackStatus !== 'verified_playing' &&
        (it.linkStatus === 'embeddable' || it.linkStatus === 'uncertain') &&
        it.inspection?.verifiability !== 'unverifiable'
    );
    if (candidates.length === 0) return;

    cancelVerifyRef.current = false;
    setVerifyingQueue(true);
    setVerifyProgress({ done: 0, total: candidates.length });

    let done = 0;
    for (const candidate of candidates) {
      if (cancelVerifyRef.current || !mountedRef.current) break;
      const result = await verifySingleItemPlayback(candidate);
      if (!mountedRef.current) break;
      updateItem(candidate.id, {
        playbackStatus: result.status,
        statusNote: result.note,
        ...(result.durationMin ? { durationMinutes: result.durationMin } : {}),
      });
      done += 1;
      setVerifyProgress({ done, total: candidates.length });
    }

    if (mountedRef.current) {
      setVerifyingQueue(false);
      setActivePreviewItemId(null);
    }
  };

  const handleVerifyOne = async (item: BatchQueueItem) => {
    if (verifyingQueue) return;
    cancelVerifyRef.current = false;
    setVerifyingQueue(true);
    setVerifyProgress({ done: 0, total: 1 });
    const result = await verifySingleItemPlayback(item);
    if (mountedRef.current) {
      updateItem(item.id, {
        playbackStatus: result.status,
        statusNote: result.note,
        ...(result.durationMin ? { durationMinutes: result.durationMin } : {}),
      });
      setVerifyProgress({ done: 1, total: 1 });
      setVerifyingQueue(false);
      setActivePreviewItemId(null);
    }
  };

  const handleSaveAllVerified = async () => {
    const readyItems = items.filter(
      (it) =>
        !it.saved &&
        it.playbackStatus === 'verified_playing' &&
        it.inspection?.provider
    );
    if (readyItems.length === 0) return;

    setSavingBatch(true);
    setBatchSummaryMsg(null);
    setSaveProgress({ done: 0, total: readyItems.length });

    const parsedLangs = batchLanguages
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 8);
    const languages = parsedLangs.length > 0 ? parsedLangs : ['Indonesian'];
    const isFree = batchPricingMode === 'free';

    let savedOk = 0;
    let failedCount = 0;

    for (let idx = 0; idx < readyItems.length; idx += 1) {
      const item = readyItems[idx];
      const diag = item.inspection!;
      const safeTitle = item.title.trim().length >= 2
        ? item.title.trim().slice(0, 140)
        : (diag.titleHint || diag.platformLabel || 'DELOKEN Video').slice(0, 140);
      const safeSubtitle = item.subtitle.trim().length >= 4
        ? item.subtitle.trim().slice(0, 220)
        : `${diag.authorHint || 'DELOKEN'} · ${diag.platformLabel}`.slice(0, 220);
      const safeDesc = item.description.trim().length >= 10
        ? item.description.trim().slice(0, 2000)
        : `${safeTitle} — ${safeSubtitle}. Tayangan resmi di DELOKEN.`.slice(0, 2000);

      try {
        await onSaveBatchItem({
          title: safeTitle,
          subtitle: safeSubtitle,
          description: safeDesc,
          category: batchCategory,
          thumbnailUrl: item.thumbnailUrl || FALLBACK_COVER,
          durationMinutes: Math.max(1, Math.min(600, item.durationMinutes || 15)),
          isFree,
          priceUsd: isFree ? 0 : Number(batchPriceUsd),
          priceIdr: isFree ? 0 : Number(batchPriceIdr),
          creditCost: isFree ? 0 : Number(batchCreditCost),
          releaseYear: new Date().getFullYear(),
          resolution: '1080p HD',
          aspectRatio: resolveEffectiveAspectRatio(item.aspectRatio, diag.aspectRatioHint),
          videoFitMode: 'contain',
          audioFormat: 'Studio Stereo',
          languages,
          assetProvider: diag.provider!,
          assetRef: diag.canonicalRef,
          mimeType: diag.mimeType || `video/${diag.provider}`,
          initialStatus: batchInitialStatus,
        });
        savedOk += 1;
        updateItem(item.id, {
          saved: true,
          saveError: undefined,
          statusNote:
            locale === 'id'
              ? 'Berhasil disimpan ke akun Anda.'
              : 'Saved to your account.',
        });
      } catch (err) {
        failedCount += 1;
        const msg = err instanceof Error ? err.message : 'Save failed';
        updateItem(item.id, { saveError: msg });
      }
      setSaveProgress({ done: idx + 1, total: readyItems.length });
    }

    setSavingBatch(false);
    setBatchSummaryMsg(
      locale === 'id'
        ? `${savedOk} video berhasil disimpan ke akun Anda${failedCount > 0 ? `, ${failedCount} gagal` : ''}.`
        : `${savedOk} videos saved to your account${failedCount > 0 ? `, ${failedCount} failed` : ''}.`
    );
    if (savedOk > 0) {
      onBatchFinished?.(savedOk);
    }
  };

  const verifiedReadyCount = items.filter(
    (it) => !it.saved && it.playbackStatus === 'verified_playing'
  ).length;
  const savedTotalCount = items.filter((it) => it.saved).length;
  const pendingVerifyCount = items.filter(
    (it) =>
      !it.saved &&
      it.playbackStatus !== 'verified_playing' &&
      (it.linkStatus === 'embeddable' || it.linkStatus === 'uncertain') &&
      it.inspection?.verifiability !== 'unverifiable'
  ).length;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label
          htmlFor="batch-video-links-textarea"
          className="block text-xs font-semibold text-slate-900 dark:text-white"
        >
          {locale === 'id'
            ? 'Tempel Banyak Tautan / Daftar Video Sekaligus (Tanpa Batas 980 Karakter Total)'
            : 'Paste Multiple Links or Full Video List (No 980-Char Total Limit)'}
        </label>
        <textarea
          id="batch-video-links-textarea"
          rows={5}
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          placeholder={
            locale === 'id'
              ? 'Tempel daftar tautan YouTube / playlist / video di sini (pisahkan baris, spasi, atau tempel langsung format Judul + Deskripsi: + Link:)...'
              : 'Paste multiple YouTube / video / playlist URLs (separated by lines or spaces), or Title + Description + Link blocks...'
          }
          className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-xs font-mono text-slate-900 dark:text-slate-100 placeholder:font-sans placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-600"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            {locale === 'id'
              ? 'Mendukung banyak URL YouTube (termasuk Playlist), Vimeo, Dailymotion, Dropbox, Google Drive, Internet Archive, Twitch, Rumble, Odysee, Loom, Bilibili, halaman web HTML, serta stream MP4/HLS/MPEG-DASH.'
              : 'Supports batch YouTube videos & playlists, Vimeo, Dailymotion, Dropbox, Google Drive, Internet Archive, Twitch, Rumble, Odysee, Loom, Bilibili, HTML web pages, and direct MP4/HLS/MPEG-DASH links.'}
          </p>
          <div className="flex items-center gap-2">
            {items.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={parsingAndInspecting || verifyingQueue || savingBatch}
                onClick={() => {
                  setItems([]);
                  setRawText('');
                  setParseError(null);
                  setBatchSummaryMsg(null);
                }}
              >
                {locale === 'id' ? 'Bersihkan' : 'Clear'}
              </Button>
            )}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              leftIcon={<Link2 className="w-3.5 h-3.5" />}
              isLoading={parsingAndInspecting}
              disabled={!rawText.trim() || verifyingQueue || savingBatch}
              onClick={() => void handleParseAndInspect()}
            >
              {locale === 'id' ? 'URAIKAN & PERIKSA SEMUA' : 'PARSE & CHECK ALL'}
            </Button>
          </div>
        </div>
      </div>

      {parseError && (
        <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800/70 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
          <XCircle className="w-4 h-4 shrink-0" />
          <span>{parseError}</span>
        </div>
      )}

      {inspectProgress && parsingAndInspecting && (
        <div className="p-3 rounded-xl bg-sky-50 dark:bg-sky-950/50 border border-sky-200 dark:border-sky-800/70 text-xs text-sky-800 dark:text-sky-300 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          <span>
            {locale === 'id'
              ? `Mengambil metadata & memeriksa tautan (${inspectProgress.done} / ${inspectProgress.total})...`
              : `Inspecting links & metadata (${inspectProgress.done} / ${inspectProgress.total})...`}
          </span>
        </div>
      )}

      {/* Active Batch Verification Player Stage */}
      {activePreviewItem && (
        <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-emerald-300 dark:border-emerald-700 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                {locale === 'id' ? 'Memverifikasi Pemutaran:' : 'Verifying Playback:'}{' '}
                {activePreviewItem.title || activePreviewItem.rawUrl}
              </p>
              <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate">
                {activePreviewItem.inspection?.canonicalUrl || activePreviewItem.rawUrl}
              </p>
            </div>
            {verifyProgress && (
              <span className="text-xs font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                {verifyProgress.done} / {verifyProgress.total}
              </span>
            )}
          </div>

          <div className="w-full rounded-xl overflow-hidden bg-slate-950 border border-slate-800 flex items-center justify-center">
            <div
              style={getAdaptiveFrameStyle(
                resolveEffectiveAspectRatio(
                  activePreviewItem.aspectRatio,
                  activePreviewItem.inspection?.aspectRatioHint
                ),
                '260px'
              )}
              className="bg-black overflow-hidden"
            >
              {activePreviewItem.inspection?.provider === 'youtube' && (
                <div ref={ytHostRef} className="w-full h-full" />
              )}
              {activePreviewItem.inspection?.provider === 'direct_video' && (
                <video
                  ref={htmlVideoRef}
                  controls
                  muted
                  playsInline
                  className="w-full h-full object-contain bg-black"
                />
              )}
              {activePreviewItem.inspection?.provider !== 'youtube' &&
                activePreviewItem.inspection?.provider !== 'direct_video' &&
                (() => {
                  const diag = activePreviewItem.inspection;
                  if (!diag) return null;
                  const batchEmbedSrc =
                    diag.provider === 'twitch'
                      ? buildTwitchEmbedUrl(
                          diag.canonicalRef,
                          typeof window !== 'undefined'
                            ? window.location.hostname
                            : 'localhost'
                        )
                      : diag.embedUrl;
                  if (!batchEmbedSrc) return null;
                  return (
                    <iframe
                      ref={iframeRef}
                      src={batchEmbedSrc}
                      title="Batch Playback Verifier"
                      className="w-full h-full border-0 bg-black"
                      allow="autoplay; fullscreen; picture-in-picture"
                      sandbox={
                        diag.provider === 'html_embed'
                          ? 'allow-scripts allow-same-origin allow-presentation allow-forms'
                          : undefined
                      }
                      referrerPolicy="strict-origin-when-cross-origin"
                    />
                  );
                })()}
            </div>
          </div>
        </div>
      )}

      {/* Batch Queue Toolbar & Items */}
      {items.length > 0 && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <div className="text-xs text-slate-700 dark:text-slate-300 space-y-0.5">
              <p className="font-semibold text-slate-900 dark:text-white">
                {locale === 'id'
                  ? `Antrean: ${items.length} tautan · ${verifiedReadyCount} siap simpan · ${savedTotalCount} tersimpan`
                  : `Queue: ${items.length} links · ${verifiedReadyCount} ready · ${savedTotalCount} saved`}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {locale === 'id'
                  ? 'Semua link wajib melewati tes putar nyata sebelum disimpan ke akun Anda.'
                  : 'Every link must pass real playback verification before saving to your account.'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {verifyingQueue ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/50"
                  leftIcon={<Square className="w-3.5 h-3.5 fill-current" />}
                  onClick={() => {
                    cancelVerifyRef.current = true;
                  }}
                >
                  {locale === 'id' ? 'Hentikan Tes Putar' : 'Stop Play Check'}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  leftIcon={<Play className="w-3.5 h-3.5 fill-current" />}
                  disabled={parsingAndInspecting || pendingVerifyCount === 0 || savingBatch}
                  onClick={() => void handleVerifyAllPlayback()}
                >
                  {locale === 'id'
                    ? `VERIFIKASI PUTAR SEMUA (${pendingVerifyCount})`
                    : `VERIFY PLAYBACK ALL (${pendingVerifyCount})`}
                </Button>
              )}
            </div>
          </div>

          <div className="space-y-2.5 max-h-[460px] overflow-y-auto pr-1 deloken-scroll">
            {items.map((item, index) => (
              <div
                key={item.id}
                className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row gap-3"
              >
                <div className="w-full sm:w-32 aspect-video rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-800 shrink-0 relative">
                  <img
                    src={item.thumbnailUrl}
                    alt={item.title || `Video ${index + 1}`}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                  <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-slate-950/80 text-[10px] font-mono text-white">
                    #{index + 1}
                  </span>
                </div>

                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
                      <span className="text-slate-600 dark:text-slate-300 font-mono">
                        {item.inspection?.platformLabel || 'Link'}
                      </span>
                      <span aria-hidden="true">·</span>
                      {item.saved ? (
                        <span className="text-emerald-700 dark:text-emerald-400">
                          ✓ {locale === 'id' ? 'TERSIMPAN' : 'SAVED'}
                        </span>
                      ) : item.playbackStatus === 'verified_playing' ? (
                        <span className="text-emerald-700 dark:text-emerald-400">
                          ✓ {locale === 'id' ? 'VIDEO BERHASIL DIPUTAR' : 'PLAYBACK VERIFIED'}
                        </span>
                      ) : item.playbackStatus === 'play_failed' || item.linkStatus === 'unavailable' ? (
                        <span className="text-rose-700 dark:text-rose-400">
                          ✕ {locale === 'id' ? 'GAGAL / TIDAK BISA' : 'FAILED / UNAVAILABLE'}
                        </span>
                      ) : item.playbackStatus === 'verifying' || item.linkStatus === 'checking' ? (
                        <span className="text-sky-700 dark:text-sky-400">
                          {locale === 'id' ? 'MEMVERIFIKASI...' : 'VERIFYING...'}
                        </span>
                      ) : (
                        <span className="text-slate-500 dark:text-slate-400">
                          {locale === 'id' ? 'MENUNGGU TES PUTAR' : 'AWAITING PLAY CHECK'}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5">
                      <select
                        aria-label={locale === 'id' ? 'Rasio video' : 'Video aspect ratio'}
                        disabled={item.saved || savingBatch}
                        value={item.aspectRatio}
                        onChange={(e) =>
                          updateItem(item.id, {
                            aspectRatio: e.target.value as VideoAspectRatio,
                          })
                        }
                        className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] font-mono font-semibold text-slate-700 dark:text-slate-200 cursor-pointer disabled:opacity-50"
                      >
                        {VIDEO_ASPECT_OPTIONS.filter((opt) => opt.value !== 'auto').map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.shortLabel}
                          </option>
                        ))}
                      </select>
                      {!item.saved &&
                        item.playbackStatus !== 'verified_playing' &&
                        (item.linkStatus === 'embeddable' || item.linkStatus === 'uncertain') &&
                        item.inspection?.verifiability !== 'unverifiable' && (
                          <button
                            type="button"
                            disabled={verifyingQueue || savingBatch}
                            onClick={() => void handleVerifyOne(item)}
                            className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-emerald-600 hover:text-white text-[11px] font-semibold text-slate-700 dark:text-slate-200 transition-colors cursor-pointer disabled:opacity-50"
                          >
                            {locale === 'id' ? 'Putar' : 'Play'}
                          </button>
                        )}
                      {!item.saved && (
                        <button
                          type="button"
                          disabled={verifyingQueue || savingBatch}
                          onClick={() =>
                            setItems((prev) => prev.filter((x) => x.id !== item.id))
                          }
                          aria-label={locale === 'id' ? 'Hapus dari antrean' : 'Remove item'}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer disabled:opacity-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  <input
                    type="text"
                    maxLength={140}
                    disabled={item.saved || savingBatch}
                    value={item.title}
                    onChange={(e) => updateItem(item.id, { title: e.target.value })}
                    placeholder={locale === 'id' ? 'Judul video...' : 'Video title...'}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-emerald-600"
                  />

                  <textarea
                    rows={2}
                    maxLength={2000}
                    disabled={item.saved || savingBatch}
                    value={item.description}
                    onChange={(e) => updateItem(item.id, { description: e.target.value })}
                    placeholder={locale === 'id' ? 'Deskripsi video...' : 'Video description...'}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-[11px] text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-emerald-600"
                  />

                  <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    {item.saveError ? (
                      <span className="text-rose-600 dark:text-rose-400 font-medium">
                        {item.saveError}
                      </span>
                    ) : (
                      item.statusNote
                    )}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Shared Batch Metadata & Submit */}
          {verifiedReadyCount > 0 && (
            <div className="p-4 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/70 space-y-4">
              <div className="flex items-center gap-2 text-xs font-bold text-emerald-900 dark:text-emerald-200">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>
                  {locale === 'id'
                    ? `Pengaturan Massal untuk ${verifiedReadyCount} Video Terverifikasi`
                    : `Batch Settings for ${verifiedReadyCount} Verified Videos`}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
                    {locale === 'id' ? 'Kategori' : 'Category'}
                  </label>
                  <select
                    value={batchCategory}
                    onChange={(e) => setBatchCategory(e.target.value as ContentCategory)}
                    className={inputClass}
                  >
                    {CATEGORY_LIST.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
                    {locale === 'id' ? 'Model Akses' : 'Access Model'}
                  </label>
                  <select
                    value={batchPricingMode}
                    onChange={(e) =>
                      setBatchPricingMode(e.target.value as 'free' | 'paid')
                    }
                    className={inputClass}
                  >
                    <option value="free">
                      {locale === 'id' ? 'Gratis (Semua Bisa Tonton)' : 'Free Release'}
                    </option>
                    <option value="paid">
                      {locale === 'id' ? 'Berbayar (Preview 5 Menit)' : 'Paid Release'}
                    </option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
                    {locale === 'id' ? 'Status Simpan' : 'Save As'}
                  </label>
                  <select
                    value={batchInitialStatus}
                    onChange={(e) =>
                      setBatchInitialStatus(
                        e.target.value as 'draft' | 'pending_review' | 'published'
                      )
                    }
                    className={inputClass}
                  >
                    {isAdmin && (
                      <option value="published">
                        {locale === 'id' ? 'Langsung Tayang Publik' : 'Publish Immediately'}
                      </option>
                    )}
                    <option value="pending_review">
                      {locale === 'id' ? 'Ajukan Moderasi Admin' : 'Submit for Review'}
                    </option>
                    <option value="draft">
                      {locale === 'id' ? 'Simpan Sebagai Draf' : 'Save as Draft'}
                    </option>
                  </select>
                </div>
              </div>

              {batchPricingMode === 'paid' && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
                      USD (30 hari)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min={0.99}
                      max={500}
                      value={batchPriceUsd}
                      onChange={(e) => setBatchPriceUsd(Number(e.target.value))}
                      className={`${inputClass} font-mono`}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
                      IDR (30 hari)
                    </label>
                    <input
                      type="number"
                      step="1000"
                      min={10000}
                      max={10000000}
                      value={batchPriceIdr}
                      onChange={(e) => setBatchPriceIdr(Number(e.target.value))}
                      className={`${inputClass} font-mono`}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
                      Kredit
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={500}
                      value={batchCreditCost}
                      onChange={(e) => setBatchCreditCost(Number(e.target.value))}
                      className={`${inputClass} font-mono`}
                    />
                  </div>
                </div>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <input
                  type="text"
                  value={batchLanguages}
                  onChange={(e) => setBatchLanguages(e.target.value)}
                  placeholder="Indonesian"
                  aria-label="Languages"
                  className={`${inputClass} sm:max-w-xs`}
                />
                <Button
                  type="button"
                  variant="primary"
                  size="md"
                  leftIcon={<Upload className="w-4 h-4" />}
                  isLoading={savingBatch}
                  disabled={verifyingQueue || verifiedReadyCount === 0}
                  onClick={() => void handleSaveAllVerified()}
                >
                  {savingBatch && saveProgress
                    ? locale === 'id'
                      ? `MENYIMPAN (${saveProgress.done} / ${saveProgress.total})...`
                      : `SAVING (${saveProgress.done} / ${saveProgress.total})...`
                    : locale === 'id'
                    ? `SIMPAN ${verifiedReadyCount} VIDEO TERVERIFIKASI`
                    : `SAVE ${verifiedReadyCount} VERIFIED VIDEOS`}
                </Button>
              </div>
            </div>
          )}

          {batchSummaryMsg && (
            <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/70 text-xs text-emerald-800 dark:text-emerald-300 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>{batchSummaryMsg}</span>
              </div>
              {savedTotalCount > 0 && onViewSavedContent && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={onViewSavedContent}
                >
                  {locale === 'id' ? 'Lihat di Kelola Konten' : 'View in Manage Content'}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
