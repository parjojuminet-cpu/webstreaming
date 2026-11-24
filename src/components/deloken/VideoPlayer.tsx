import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  FastForward,
  Lock,
  Maximize,
  Pause,
  Play,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { getTranslation } from '../../data/translations';
import { resolveVideoProviderAdapter } from '../../services/videoProvider';
import type { LanguageCode, Project } from '../../types/deloken';
import { formatTimeSeconds } from '../../utils/currency';

const SIMULATION_DURATION_SECONDS = 1800; // 30:00
const PREVIEW_LIMIT_SECONDS = 300; // 05:00

interface VideoPlayerProps {
  project: Project;
  language: LanguageCode;
  isUnlocked: boolean;
  initialResumeSeconds: number;
  onSaveResumeSeconds: (seconds: number) => void;
  onLockTriggered: (resumeSeconds: number) => void;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  project,
  language,
  isUnlocked,
  initialResumeSeconds,
  onSaveResumeSeconds,
  onLockTriggered,
}) => {
  const t = getTranslation(language);
  const containerRef = useRef<HTMLDivElement>(null);
  const html5VideoRef = useRef<HTMLVideoElement>(null);

  const [playerMode, setPlayerMode] = useState<'simulation' | 'provider'>('simulation');
  const [simPlaying, setSimPlaying] = useState(false);
  const [simTime, setSimTime] = useState<number>(initialResumeSeconds);
  const [volume, setVolume] = useState(0.85);
  const [muted, setMuted] = useState(false);
  const [lockedOverlay, setLockedOverlay] = useState(false);
  const [providerLoading, setProviderLoading] = useState(false);
  const [providerError, setProviderError] = useState<string | null>(null);

  const adapter = resolveVideoProviderAdapter(
    project.videoProvider,
    project.videoUrl,
    language
  );

  // Sync resumeSeconds when unlocked after checkout
  useEffect(() => {
    if (isUnlocked && lockedOverlay) {
      setLockedOverlay(false);
      setSimPlaying(true);
    }
  }, [isUnlocked, lockedOverlay]);

  // Reset provider error when project or mode switches
  useEffect(() => {
    setProviderError(adapter.errorMessage ?? null);
    setProviderLoading(playerMode === 'provider' && adapter.isValidConfig);
  }, [project.id, project.videoUrl, project.videoProvider, playerMode, adapter.errorMessage, adapter.isValidConfig]);

  // Simulation Timer Loop (00:00 -> 30:00), explicitly enforcing 05:00 lock when unpaid
  useEffect(() => {
    if (playerMode !== 'simulation' || !simPlaying) return;

    const timer = window.setInterval(() => {
      setSimTime((prev) => {
        const next = prev + 1;
        if (!isUnlocked && next >= PREVIEW_LIMIT_SECONDS) {
          setSimPlaying(false);
          setLockedOverlay(true);
          onSaveResumeSeconds(PREVIEW_LIMIT_SECONDS);
          onLockTriggered(PREVIEW_LIMIT_SECONDS);
          return PREVIEW_LIMIT_SECONDS;
        }
        if (next >= SIMULATION_DURATION_SECONDS) {
          setSimPlaying(false);
          return SIMULATION_DURATION_SECONDS;
        }
        return next;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [playerMode, simPlaying, isUnlocked, onLockTriggered, onSaveResumeSeconds]);

  const handleTogglePlay = () => {
    if (playerMode === 'simulation') {
      if (!isUnlocked && simTime >= PREVIEW_LIMIT_SECONDS) {
        setLockedOverlay(true);
        onLockTriggered(PREVIEW_LIMIT_SECONDS);
        return;
      }
      setSimPlaying((p) => !p);
      return;
    }

    const vid = html5VideoRef.current;
    if (vid) {
      if (vid.paused) {
        void vid.play().catch(() => {
          setProviderError(
            language === 'id'
              ? `Pemutaran langsung gagal dari ${adapter.providerName}. Periksa akses URL sumber.`
              : `Direct playback failed from ${adapter.providerName}. Check remote source access.`
          );
        });
      } else {
        vid.pause();
      }
    }
  };

  const handleSeek = (rawNextSeconds: number) => {
    if (!isUnlocked && rawNextSeconds >= PREVIEW_LIMIT_SECONDS) {
      setSimPlaying(false);
      setSimTime(PREVIEW_LIMIT_SECONDS);
      setLockedOverlay(true);
      onSaveResumeSeconds(PREVIEW_LIMIT_SECONDS);
      onLockTriggered(PREVIEW_LIMIT_SECONDS);
      return;
    }
    setLockedOverlay(false);
    setSimTime(Math.max(0, Math.min(SIMULATION_DURATION_SECONDS, rawNextSeconds)));
  };

  const handleJumpTo0455 = () => {
    setPlayerMode('simulation');
    setLockedOverlay(false);
    setSimTime(295); // 04:55
    setSimPlaying(true);
  };

  const handleToggleFullscreen = () => {
    const el = containerRef.current;
    if (!el || !document.fullscreenEnabled) return;
    if (!document.fullscreenElement) {
      void el.requestFullscreen().catch(() => undefined);
    } else {
      void document.exitFullscreen().catch(() => undefined);
    }
  };

  return (
    <div
      ref={containerRef}
      className="bg-slate-900 rounded-xl overflow-hidden border border-slate-200"
    >
      {/* Top Adapter Mode Switcher */}
      <div className="px-3.5 py-2.5 bg-slate-950 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2 text-slate-300">
          <span className="font-semibold text-emerald-400">DELOKEN Player</span>
          <span aria-hidden="true" className="text-slate-600">·</span>
          <span className="text-slate-400 truncate max-w-[240px] sm:max-w-none">
            {adapter.providerName}
          </span>
        </div>

        <div className="flex items-center gap-1 p-0.5 rounded-lg bg-slate-900 border border-slate-800">
          <button
            type="button"
            onClick={() => setPlayerMode('simulation')}
            className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap cursor-pointer transition-colors ${
              playerMode === 'simulation'
                ? 'bg-emerald-600 text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            {language === 'id' ? 'Mode Simulasi Timer' : 'Timer Simulation'}
          </button>
          <button
            type="button"
            onClick={() => setPlayerMode('provider')}
            className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap cursor-pointer transition-colors ${
              playerMode === 'provider'
                ? 'bg-emerald-600 text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            {language === 'id' ? 'Sumber Eksternal' : 'Provider Embed'}
          </button>
        </div>
      </div>

      {/* Viewport Stage */}
      <div className="relative aspect-video w-full bg-slate-950">
        {playerMode === 'simulation' ? (
          <div className="relative w-full h-full">
            <img
              src={project.thumbnailUrl}
              alt={project.title[language]}
              referrerPolicy="no-referrer"
              className={`w-full h-full object-cover transition-all duration-300 ${
                lockedOverlay ? 'blur-lg scale-105 opacity-40' : 'opacity-80'
              }`}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/35 to-slate-950/40" />

            {!lockedOverlay && (
              <div className="absolute inset-0 flex flex-col items-center justify-center px-4 text-center">
                <button
                  type="button"
                  onClick={handleTogglePlay}
                  aria-label={simPlaying ? 'Pause simulation' : 'Play simulation'}
                  className="w-16 h-16 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center shadow-lg transition-transform active:scale-95 cursor-pointer mb-3"
                >
                  {simPlaying ? (
                    <Pause className="w-7 h-7" aria-hidden="true" />
                  ) : (
                    <Play className="w-7 h-7 ml-0.5" aria-hidden="true" />
                  )}
                </button>
                <p className="font-mono tabular-nums text-2xl sm:text-3xl font-bold text-white tracking-tight">
                  {formatTimeSeconds(simTime)}{' '}
                  <span className="text-slate-400 text-lg font-normal">
                    / {formatTimeSeconds(SIMULATION_DURATION_SECONDS)}
                  </span>
                </p>
                <p className="mt-1.5 text-xs text-slate-300 max-w-md">
                  {t.player.simNotice}
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="relative w-full h-full bg-slate-950 flex items-center justify-center">
            {providerError ? (
              <div className="max-w-md mx-auto p-5 text-center space-y-2.5">
                <AlertCircle className="w-9 h-9 text-rose-400 mx-auto" aria-hidden="true" />
                <p className="text-sm font-semibold text-white">
                  {t.player.providerErrorTitle} ({adapter.providerName})
                </p>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {providerError}
                </p>
                <p className="text-[11px] font-mono text-slate-400 break-all">
                  {project.videoUrl}
                </p>
              </div>
            ) : adapter.renderMode === 'html5_mp4' && adapter.playableUrl ? (
              <video
                ref={html5VideoRef}
                src={adapter.playableUrl}
                controls
                playsInline
                onLoadedData={() => setProviderLoading(false)}
                onError={() => {
                  setProviderLoading(false);
                  setProviderError(
                    language === 'id'
                      ? 'Gagal memuat stream MP4 dari Archive.org. Pastikan URL valid dan mendukung pemutaran browser.'
                      : 'Failed to load direct MP4 stream from Archive.org. Verify URL accessibility.'
                  );
                }}
                onTimeUpdate={(e) => {
                  const sec = e.currentTarget.currentTime;
                  if (!isUnlocked && sec >= PREVIEW_LIMIT_SECONDS) {
                    e.currentTarget.pause();
                    e.currentTarget.currentTime = PREVIEW_LIMIT_SECONDS;
                    setLockedOverlay(true);
                    onSaveResumeSeconds(PREVIEW_LIMIT_SECONDS);
                    onLockTriggered(PREVIEW_LIMIT_SECONDS);
                  }
                }}
                className="w-full h-full object-contain"
              />
            ) : (adapter.renderMode === 'youtube_iframe' ||
                adapter.renderMode === 'google_drive_iframe') &&
              adapter.playableUrl ? (
              <iframe
                src={adapter.playableUrl}
                title={project.title[language]}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                allowFullScreen
                onLoad={() => setProviderLoading(false)}
                onError={() => {
                  setProviderLoading(false);
                  setProviderError(
                    language === 'id'
                      ? `Iframe dari ${adapter.providerName} gagal dimuat atau diblokir oleh izin file.`
                      : `Iframe from ${adapter.providerName} failed to load or was blocked by permissions.`
                  );
                }}
                className="w-full h-full border-0"
              />
            ) : (
              <div className="max-w-md mx-auto p-6 text-center space-y-2">
                <p className="text-sm font-semibold text-white">{adapter.providerName}</p>
                <p className="text-xs text-slate-300">{adapter.caveat}</p>
              </div>
            )}

            {providerLoading && !providerError && (
              <div className="absolute inset-0 bg-slate-950/75 flex items-center justify-center pointer-events-none">
                <span className="text-xs font-medium text-slate-200">
                  {language === 'id' ? 'Memuat sumber video...' : 'Loading video provider...'}
                </span>
              </div>
            )}
          </div>
        )}

        {/* 5-Minute Paywall Blur Overlay */}
        {lockedOverlay && !isUnlocked && (
          <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 z-20">
            <div className="max-w-md w-full bg-white rounded-xl p-5 sm:p-6 text-center shadow-2xl border border-slate-200 space-y-3">
              <div className="w-11 h-11 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center mx-auto">
                <Lock className="w-5 h-5" aria-hidden="true" />
              </div>
              <h4 className="font-display text-base sm:text-lg font-bold text-slate-900">
                {t.player.lockTitle}
              </h4>
              <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                {t.player.lockDesc}
              </p>
              <button
                type="button"
                onClick={() => onLockTriggered(PREVIEW_LIMIT_SECONDS)}
                className="min-h-[44px] w-full px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold cursor-pointer transition-colors"
              >
                {t.player.unlockBtn}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Unified Control Bar + 04:55 Lock Tester */}
      <div className="p-3 sm:p-4 bg-slate-900 text-slate-200 space-y-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleTogglePlay}
            className="w-9 h-9 rounded-lg bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-white cursor-pointer shrink-0"
            aria-label={simPlaying ? 'Pause' : 'Play'}
          >
            {simPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>

          <div className="flex-1 flex items-center gap-2.5">
            <span className="font-mono tabular-nums text-xs text-slate-300 w-11 shrink-0">
              {formatTimeSeconds(simTime)}
            </span>
            <input
              type="range"
              min={0}
              max={SIMULATION_DURATION_SECONDS}
              value={simTime}
              onChange={(e) => handleSeek(Number(e.target.value))}
              aria-label="Simulation video timeline"
              className="w-full accent-emerald-500 cursor-pointer"
            />
            <span className="font-mono tabular-nums text-xs text-slate-400 w-11 shrink-0 text-right">
              {formatTimeSeconds(SIMULATION_DURATION_SECONDS)}
            </span>
          </div>

          <div className="hidden sm:flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setMuted((m) => !m)}
              aria-label={muted ? 'Unmute' : 'Mute'}
              className="p-1.5 rounded hover:bg-slate-800 text-slate-300 cursor-pointer"
            >
              {muted || volume === 0 ? (
                <VolumeX className="w-4 h-4" />
              ) : (
                <Volume2 className="w-4 h-4" />
              )}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(e) => {
                setMuted(false);
                const val = Number(e.target.value);
                setVolume(val);
                if (html5VideoRef.current) html5VideoRef.current.volume = val;
              }}
              aria-label="Volume"
              className="w-16 accent-emerald-500 cursor-pointer"
            />
          </div>

          <button
            type="button"
            onClick={handleToggleFullscreen}
            aria-label="Fullscreen"
            className="p-1.5 rounded hover:bg-slate-800 text-slate-300 cursor-pointer shrink-0"
          >
            <Maximize className="w-4 h-4" />
          </button>
        </div>

        {/* 5-Minute Lock Test Bar + Provider Caveat */}
        <div className="pt-2 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
          <p className="text-slate-400 flex-1 min-w-[200px]">
            {adapter.caveat || project.videoNote}
          </p>
          <button
            type="button"
            onClick={handleJumpTo0455}
            className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/30 text-amber-300 font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors"
          >
            <FastForward className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>{t.player.jumpTo455}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
