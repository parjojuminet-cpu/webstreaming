import type {
  LocaleCode,
  VideoAspectRatio,
  VideoAssetProvider,
  VideoFitMode,
} from '../types/vyora';

export type FixedVideoAspectRatio = Exclude<VideoAspectRatio, 'auto'>;

export interface VideoAspectOption {
  value: VideoAspectRatio;
  shortLabel: string;
  labelId: string;
  labelEn: string;
  cssRatio: string;
  numericRatio: number;
  isPortrait: boolean;
}

export const VIDEO_ASPECT_OPTIONS: VideoAspectOption[] = [
  {
    value: 'auto',
    shortLabel: 'Auto',
    labelId: 'Otomatis',
    labelEn: 'Auto Detect',
    cssRatio: '16 / 9',
    numericRatio: 16 / 9,
    isPortrait: false,
  },
  {
    value: '16:9',
    shortLabel: '16:9',
    labelId: '16:9 (Landscape)',
    labelEn: '16:9 (Widescreen)',
    cssRatio: '16 / 9',
    numericRatio: 16 / 9,
    isPortrait: false,
  },
  {
    value: '9:16',
    shortLabel: '9:16',
    labelId: '9:16 (Vertikal / Shorts)',
    labelEn: '9:16 (Vertical / Shorts)',
    cssRatio: '9 / 16',
    numericRatio: 9 / 16,
    isPortrait: true,
  },
  {
    value: '4:5',
    shortLabel: '4:5',
    labelId: '4:5 (Potret Feed)',
    labelEn: '4:5 (Portrait Feed)',
    cssRatio: '4 / 5',
    numericRatio: 4 / 5,
    isPortrait: true,
  },
  {
    value: '1:1',
    shortLabel: '1:1',
    labelId: '1:1 (Persegi)',
    labelEn: '1:1 (Square)',
    cssRatio: '1 / 1',
    numericRatio: 1,
    isPortrait: false,
  },
  {
    value: '4:3',
    shortLabel: '4:3',
    labelId: '4:3 (Klasik)',
    labelEn: '4:3 (Classic)',
    cssRatio: '4 / 3',
    numericRatio: 4 / 3,
    isPortrait: false,
  },
  {
    value: '21:9',
    shortLabel: '21:9',
    labelId: '21:9 (Sinema)',
    labelEn: '21:9 (Cinema)',
    cssRatio: '21 / 9',
    numericRatio: 21 / 9,
    isPortrait: false,
  },
];

const VALID_ASPECT_SET = new Set<string>([
  'auto',
  '16:9',
  '9:16',
  '4:5',
  '1:1',
  '4:3',
  '21:9',
]);

export function normalizeVideoAspectRatio(
  raw: unknown,
  fallback: VideoAspectRatio = 'auto'
): VideoAspectRatio {
  if (typeof raw === 'string' && VALID_ASPECT_SET.has(raw)) {
    return raw as VideoAspectRatio;
  }
  return fallback;
}

export function normalizeVideoFitMode(
  raw: unknown,
  fallback: VideoFitMode = 'contain'
): VideoFitMode {
  return raw === 'cover' || raw === 'contain' ? raw : fallback;
}

export function inferAspectRatioFromDimensions(
  width?: number | null,
  height?: number | null
): FixedVideoAspectRatio {
  if (
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return '16:9';
  }
  const ratio = width / height;
  if (ratio <= 0.68) return '9:16';
  if (ratio <= 0.90) return '4:5';
  if (ratio <= 1.15) return '1:1';
  if (ratio <= 1.52) return '4:3';
  if (ratio <= 2.05) return '16:9';
  return '21:9';
}

export function inferAspectRatioFromUrlOrProvider(params: {
  provider?: VideoAssetProvider | string | null;
  url?: string | null;
  width?: number | null;
  height?: number | null;
}): FixedVideoAspectRatio {
  if (
    typeof params.width === 'number' &&
    typeof params.height === 'number' &&
    params.width > 0 &&
    params.height > 0
  ) {
    return inferAspectRatioFromDimensions(params.width, params.height);
  }

  const lowerUrl = (params.url || '').toLowerCase();
  if (
    lowerUrl.includes('/shorts/') ||
    lowerUrl.includes('/reel/') ||
    lowerUrl.includes('/reels/') ||
    params.provider === 'tiktok'
  ) {
    return '9:16';
  }

  return '16:9';
}

export function resolveEffectiveAspectRatio(
  selected: VideoAspectRatio | undefined,
  autoDetected?: FixedVideoAspectRatio | null
): FixedVideoAspectRatio {
  if (selected && selected !== 'auto') {
    return selected;
  }
  return autoDetected || '16:9';
}

export function getAspectOption(ratio: VideoAspectRatio): VideoAspectOption {
  return (
    VIDEO_ASPECT_OPTIONS.find((opt) => opt.value === ratio) || VIDEO_ASPECT_OPTIONS[1]
  );
}

export function formatAspectRatioLabel(
  ratio: VideoAspectRatio,
  locale: LocaleCode
): string {
  const opt = getAspectOption(ratio);
  return locale === 'id' ? opt.labelId : opt.labelEn;
}

/**
 * Returns inline frame dimensions that preserve the exact target aspect ratio
 * while preventing tall portrait frames (9:16, 4:5, 1:1) from overflowing
 * the viewport height.
 */
export function getAdaptiveFrameStyle(
  effectiveRatio: FixedVideoAspectRatio,
  maxHeightCss: string
): {
  aspectRatio: string;
  width: string;
  maxWidth: string;
  maxHeight: string;
} {
  const opt = getAspectOption(effectiveRatio);
  const ratioValue = opt.cssRatio;
  if (opt.isPortrait || effectiveRatio === '1:1' || effectiveRatio === '4:3') {
    return {
      aspectRatio: ratioValue,
      width: `min(100%, calc(${maxHeightCss} * ${opt.numericRatio.toFixed(4)}))`,
      maxWidth: '100%',
      maxHeight: maxHeightCss,
    };
  }
  return {
    aspectRatio: ratioValue,
    width: '100%',
    maxWidth: '100%',
    maxHeight: maxHeightCss,
  };
}
