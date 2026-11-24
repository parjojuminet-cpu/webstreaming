import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  Film,
  Image as ImageIcon,
  LayoutGrid,
  Upload,
} from 'lucide-react';
import type { LocaleCode } from '../../types/vyora';
import { uploadCreatorMedia } from '../../services/streamService';
import { captureVideoFrameAsFile } from '../../utils/videoThumbnail';
import { getYouTubeThumbnailUrl } from '../../utils/youtube';
import { Button } from '../ui/Button';
import { MediaImage } from '../ui/MediaImage';

interface CoverPreset {
  label: string;
  url: string;
}

interface CoverPickerProps {
  locale: LocaleCode;
  value: string;
  titleHint?: string;
  presets: CoverPreset[];
  youtubeVideoId?: string | null;
  videoPreviewUrl?: string | null;
  videoFileName?: string | null;
  autoCapturing?: boolean;
  onChange: (nextCoverUrl: string, isExplicitUserChoice?: boolean) => void;
}

type CoverTab = 'frame' | 'image' | 'preset';

function formatSecs(sec: number): string {
  const safe = Math.max(0, Math.floor(sec));
  const mins = Math.floor(safe / 60);
  const rem = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

export const CoverPicker: React.FC<CoverPickerProps> = ({
  locale,
  value,
  titleHint,
  presets,
  youtubeVideoId,
  videoPreviewUrl,
  videoFileName,
  autoCapturing = false,
  onChange,
}) => {
  const [tab, setTab] = useState<CoverTab>(videoPreviewUrl ? 'frame' : 'image');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [capturingFrame, setCapturingFrame] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [localSampleVideoUrl, setLocalSampleVideoUrl] = useState<string | null>(null);
  const [localSampleName, setLocalSampleName] = useState<string | null>(null);
  const [frameDuration, setFrameDuration] = useState(0);
  const [frameCurrentTime, setFrameCurrentTime] = useState(0);

  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const sampleVideoInputRef = useRef<HTMLInputElement | null>(null);
  const frameVideoRef = useRef<HTMLVideoElement | null>(null);

  const activeVideoSrc = localSampleVideoUrl || videoPreviewUrl || null;
  const activeVideoLabel = localSampleName || videoFileName || 'video-deloken';

  useEffect(() => {
    if (videoPreviewUrl) {
      setTab('frame');
    }
  }, [videoPreviewUrl]);

  useEffect(() => {
    return () => {
      if (localSampleVideoUrl) {
        URL.revokeObjectURL(localSampleVideoUrl);
      }
    };
  }, [localSampleVideoUrl]);

  const handleImageFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    setSuccessMsg(null);

    if (file.size > 5 * 1024 * 1024) {
      setErrorMsg(
        locale === 'id'
          ? 'Ukuran gambar sampul maksimal 5 MB.'
          : 'Cover image must be 5 MB or smaller.'
      );
      e.target.value = '';
      return;
    }

    setUploadingImage(true);
    try {
      const uploaded = await uploadCreatorMedia(file);
      if (uploaded.kind === 'thumbnail') {
        onChange(uploaded.thumbnailUrl, true);
        setSuccessMsg(
          locale === 'id'
            ? 'Cover gambar berhasil diunggah & dipasang.'
            : 'Custom cover image uploaded & applied.'
        );
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : locale === 'id'
          ? 'Gagal mengunggah gambar cover.'
          : 'Failed to upload cover image.'
      );
    } finally {
      setUploadingImage(false);
      e.target.value = '';
    }
  };

  const handleSampleVideoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    if (localSampleVideoUrl) {
      URL.revokeObjectURL(localSampleVideoUrl);
    }
    const nextUrl = URL.createObjectURL(file);
    setLocalSampleVideoUrl(nextUrl);
    setLocalSampleName(file.name);
    setFrameCurrentTime(0);
    setFrameDuration(0);
    setTab('frame');
    e.target.value = '';
  };

  const handleCaptureFrame = async () => {
    const videoEl = frameVideoRef.current;
    if (!videoEl) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    setCapturingFrame(true);

    try {
      const frameFile = await captureVideoFrameAsFile(videoEl, activeVideoLabel);
      const uploaded = await uploadCreatorMedia(frameFile);
      if (uploaded.kind === 'thumbnail') {
        onChange(uploaded.thumbnailUrl, true);
        setSuccessMsg(
          locale === 'id'
            ? `Potongan frame di ${formatSecs(frameCurrentTime)} berhasil dijadikan cover!`
            : `Video frame at ${formatSecs(frameCurrentTime)} applied as cover!`
        );
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : locale === 'id'
          ? 'Gagal mengambil potongan frame video. Pastikan video sudah termuat.'
          : 'Unable to capture video frame. Ensure the video metadata is loaded.'
      );
    } finally {
      setCapturingFrame(false);
    }
  };

  return (
    <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <span className="text-xs font-semibold text-slate-900 dark:text-white">
            {locale === 'id'
              ? 'Cover / Tampilan Awal di Galeri'
              : 'Gallery Cover / Initial Preview'}
          </span>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            {locale === 'id'
              ? 'Pilih gambar sendiri atau tangkap potongan frame langsung dari video Anda.'
              : 'Upload a custom image or capture any frame directly from your video.'}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
          {[
            {
              id: 'frame' as CoverTab,
              label: locale === 'id' ? 'Potongan Video' : 'Video Frame',
              icon: <Film className="w-3.5 h-3.5" />,
            },
            {
              id: 'image' as CoverTab,
              label: locale === 'id' ? 'Upload Gambar' : 'Image File',
              icon: <ImageIcon className="w-3.5 h-3.5" />,
            },
            {
              id: 'preset' as CoverTab,
              label: locale === 'id' ? 'Preset' : 'Presets',
              icon: <LayoutGrid className="w-3.5 h-3.5" />,
            },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`min-h-[34px] inline-flex items-center justify-center gap-1.5 px-2.5 rounded-md text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                tab === t.id
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Live 16:9 Gallery Cover Preview */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3.5 p-3 rounded-xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
        <div className="w-full sm:w-44 aspect-video rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shrink-0 relative">
          <MediaImage
            src={value}
            alt="Gallery cover preview"
            fallbackTitle={titleHint || 'DELOKEN'}
            className="w-full h-full"
          />
          {autoCapturing && (
            <div className="absolute inset-0 bg-slate-900/65 flex items-center justify-center px-2 text-center">
              <span className="text-[11px] font-medium text-white">
                {locale === 'id'
                  ? 'Mengambil cover dari video...'
                  : 'Extracting video frame...'}
              </span>
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0 space-y-1.5">
          <p className="text-xs font-semibold text-slate-900 dark:text-white">
            {locale === 'id'
              ? 'Pratinjau Cover Galeri (16:9)'
              : 'Live Gallery Cover Preview (16:9)'}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 break-all line-clamp-2">
            {value.startsWith('/api/media/thumb/')
              ? locale === 'id'
                ? 'Cover kustom / potongan frame video tersimpan permanen di server.'
                : 'Custom image / video frame cover saved persistently.'
              : value}
          </p>
          {youtubeVideoId && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                const ytThumb = getYouTubeThumbnailUrl(youtubeVideoId);
                if (ytThumb) {
                  onChange(ytThumb, true);
                  setSuccessMsg(
                    locale === 'id'
                      ? 'Thumbnail resmi YouTube dipasang sebagai cover.'
                      : 'Official YouTube thumbnail applied as cover.'
                  );
                }
              }}
            >
              {locale === 'id'
                ? 'Gunakan Thumbnail YouTube'
                : 'Use YouTube Thumbnail'}
            </Button>
          )}
        </div>
      </div>

      {errorMsg && (
        <p className="text-xs text-rose-600 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800/70 rounded-lg px-3 py-2">
          {errorMsg}
        </p>
      )}
      {successMsg && (
        <p className="text-xs text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/70 rounded-lg px-3 py-2 flex items-center gap-1.5">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{successMsg}</span>
        </p>
      )}

      {/* TAB 1: Video Frame Capture */}
      {tab === 'frame' && (
        <div className="space-y-3">
          <input
            ref={sampleVideoInputRef}
            type="file"
            accept="video/*,.mp4,.webm,.mov"
            onChange={handleSampleVideoSelect}
            className="hidden"
          />

          {activeVideoSrc ? (
            <div className="p-3 rounded-xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3">
              <div className="aspect-video rounded-lg overflow-hidden bg-slate-950">
                <video
                  ref={frameVideoRef}
                  src={activeVideoSrc}
                  muted
                  playsInline
                  preload="auto"
                  onLoadedMetadata={() => {
                    const v = frameVideoRef.current;
                    if (!v) return;
                    const dur = Number.isFinite(v.duration) ? v.duration : 0;
                    setFrameDuration(dur);
                    const initialSec = Math.min(2, Math.max(0, dur * 0.15));
                    v.currentTime = initialSec;
                    setFrameCurrentTime(initialSec);
                  }}
                  onTimeUpdate={() => {
                    if (frameVideoRef.current) {
                      setFrameCurrentTime(frameVideoRef.current.currentTime);
                    }
                  }}
                  className="w-full h-full object-contain"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px] font-mono text-slate-600 dark:text-slate-400">
                  <span>
                    {locale === 'id'
                      ? 'Geser untuk memilih momen potongan video:'
                      : 'Scrub to pick video cover moment:'}
                  </span>
                  <span>
                    {formatSecs(frameCurrentTime)} / {formatSecs(frameDuration)}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={frameDuration > 0 ? frameDuration : 10}
                  step={0.1}
                  value={Math.min(frameCurrentTime, frameDuration || 10)}
                  onChange={(e) => {
                    const nextSec = Number(e.target.value);
                    setFrameCurrentTime(nextSec);
                    if (frameVideoRef.current) {
                      frameVideoRef.current.currentTime = nextSec;
                    }
                  }}
                  className="w-full accent-emerald-600 cursor-pointer"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  leftIcon={<Camera className="w-3.5 h-3.5" />}
                  isLoading={capturingFrame}
                  onClick={() => void handleCaptureFrame()}
                >
                  {locale === 'id'
                    ? 'Tangkap Frame Ini Jadi Cover'
                    : 'Use This Frame as Cover'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => sampleVideoInputRef.current?.click()}
                >
                  {locale === 'id'
                    ? 'Pilih Video Lain untuk Sampel'
                    : 'Pick Another Video Sample'}
                </Button>
              </div>
            </div>
          ) : (
            <div className="p-4 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-center space-y-2.5">
              <p className="text-xs text-slate-600 dark:text-slate-300">
                {locale === 'id'
                  ? 'Unggah file video di langkah 1 atau pilih file video dari perangkat untuk mengambil potongan gambar (frame) otomatis sebagai cover.'
                  : 'Upload a video file in Step 1 or choose a local video file to capture any frame as the gallery cover.'}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                leftIcon={<Film className="w-3.5 h-3.5" />}
                onClick={() => sampleVideoInputRef.current?.click()}
              >
                {locale === 'id'
                  ? 'Pilih File Video untuk Ambil Cover'
                  : 'Choose Video File for Cover Frame'}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: Upload Custom Image */}
      {tab === 'image' && (
        <div className="p-4 rounded-xl border border-dashed border-emerald-500 dark:border-emerald-700 bg-white dark:bg-slate-950 text-center space-y-2.5">
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*,.jpg,.jpeg,.png,.webp"
            disabled={uploadingImage}
            onChange={(e) => void handleImageFileSelect(e)}
            className="hidden"
          />
          <p className="text-xs text-slate-600 dark:text-slate-300">
            {locale === 'id'
              ? 'Unggah gambar poster / thumbnail kustom (.JPG, .PNG, .WEBP · maks 5 MB, rasio disarankan 16:9).'
              : 'Upload a custom poster image (.JPG, .PNG, .WEBP · max 5 MB, 16:9 recommended).'}
          </p>
          <Button
            type="button"
            variant="primary"
            size="sm"
            leftIcon={<Upload className="w-3.5 h-3.5" />}
            isLoading={uploadingImage}
            onClick={() => imageInputRef.current?.click()}
          >
            {locale === 'id'
              ? 'Pilih Gambar Cover dari Perangkat'
              : 'Choose Cover Image File'}
          </Button>
        </div>
      )}

      {/* TAB 3: Studio Presets */}
      {tab === 'preset' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {presets.map((preset) => {
            const active = value === preset.url;
            return (
              <button
                key={preset.url}
                type="button"
                onClick={() => {
                  onChange(preset.url, true);
                  setSuccessMsg(null);
                }}
                className={`group rounded-lg overflow-hidden border text-left transition-all cursor-pointer bg-white dark:bg-slate-950 ${
                  active
                    ? 'border-emerald-600 dark:border-emerald-500 ring-2 ring-emerald-600/30'
                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                <div className="aspect-video overflow-hidden bg-slate-100 dark:bg-slate-800">
                  <img
                    src={preset.url}
                    alt={preset.label}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                  />
                </div>
                <p className="px-2 py-1.5 text-[11px] font-medium text-slate-700 dark:text-slate-300 truncate">
                  {preset.label}
                </p>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
