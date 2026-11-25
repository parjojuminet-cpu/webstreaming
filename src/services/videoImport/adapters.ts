import {
  extractYouTubeVideoId,
  getYouTubeNoCookieEmbedUrl,
  getYouTubeThumbnailUrl,
} from '../../utils/youtube';
import { extractFacebookVideoUrl, getFacebookEmbedUrl } from '../../utils/facebook';
import type { DirectStreamFormat } from '../../types/vyora';
import type { DetectedVideoSource, VideoPlatformAdapter } from './types';
import { parseStrictHttpsUrl } from './urlGuards';

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

const VIMEO_HOSTS = new Set([
  'vimeo.com',
  'www.vimeo.com',
  'player.vimeo.com',
]);

const DAILYMOTION_HOSTS = new Set([
  'dailymotion.com',
  'www.dailymotion.com',
  'dai.ly',
  'www.dai.ly',
  'geo.dailymotion.com',
]);

const STREAMABLE_HOSTS = new Set([
  'streamable.com',
  'www.streamable.com',
]);

const TIKTOK_HOSTS = new Set([
  'tiktok.com',
  'www.tiktok.com',
  'm.tiktok.com',
  'vt.tiktok.com',
  'vm.tiktok.com',
]);

const FACEBOOK_HOSTS = new Set([
  'facebook.com',
  'www.facebook.com',
  'm.facebook.com',
  'web.facebook.com',
  'mbasic.facebook.com',
  'fb.watch',
  'www.fb.watch',
]);

const X_HOSTS = new Set([
  'x.com',
  'www.x.com',
  'mobile.x.com',
  'twitter.com',
  'www.twitter.com',
  'mobile.twitter.com',
]);

const INSTAGRAM_HOSTS = new Set([
  'instagram.com',
  'www.instagram.com',
  'm.instagram.com',
]);

export function extractVimeoVideoRef(rawInput: string): {
  id: string;
  hash?: string;
  canonicalRef: string;
  canonicalUrl: string;
  embedUrl: string;
} | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.startsWith('vimeo:')
    ? trimmed.slice('vimeo:'.length).trim()
    : trimmed;

  if (/^\d{5,14}(?::[a-zA-Z0-9]{6,24})?$/.test(cleaned)) {
    const [id, hash] = cleaned.split(':');
    const qs = hash ? `?h=${encodeURIComponent(hash)}` : '';
    return {
      id,
      hash,
      canonicalRef: hash ? `${id}:${hash}` : id,
      canonicalUrl: hash
        ? `https://vimeo.com/${id}/${hash}`
        : `https://vimeo.com/${id}`,
      embedUrl: `https://player.vimeo.com/video/${id}${qs}`,
    };
  }

  const parsedRes = parseStrictHttpsUrl(cleaned, { allowBareHostname: true });
  if (!parsedRes.ok) return null;
  const parsed = parsedRes.url;
  const host = parsed.hostname.toLowerCase();
  if (!VIMEO_HOSTS.has(host)) return null;

  const segments = parsed.pathname.split('/').filter(Boolean);
  let id: string | null = null;
  let hash: string | undefined = parsed.searchParams.get('h') || undefined;

  if (host === 'player.vimeo.com' && segments[0] === 'video' && /^\d{5,14}$/.test(segments[1] || '')) {
    id = segments[1];
  } else if (segments.length >= 1) {
    // Handles /123456789, /123456789/unlistedhash, /channels/name/123456789, /groups/name/videos/123456789
    for (let i = 0; i < segments.length; i += 1) {
      if (/^\d{5,14}$/.test(segments[i])) {
        id = segments[i];
        if (!hash && segments[i + 1] && /^[a-zA-Z0-9]{6,24}$/.test(segments[i + 1])) {
          hash = segments[i + 1];
        }
        break;
      }
    }
  }

  if (!id) return null;
  const safeHash = hash && /^[a-zA-Z0-9]{6,24}$/.test(hash) ? hash : undefined;
  const qs = safeHash ? `?h=${encodeURIComponent(safeHash)}` : '';

  return {
    id,
    hash: safeHash,
    canonicalRef: safeHash ? `${id}:${safeHash}` : id,
    canonicalUrl: safeHash
      ? `https://vimeo.com/${id}/${safeHash}`
      : `https://vimeo.com/${id}`,
    embedUrl: `https://player.vimeo.com/video/${id}${qs}`,
  };
}

export function extractDailymotionVideoId(rawInput: string): string | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.startsWith('dailymotion:')
    ? trimmed.slice('dailymotion:'.length).trim()
    : trimmed;

  if (/^x[a-zA-Z0-9]{5,12}$/.test(cleaned)) {
    return cleaned;
  }

  const parsedRes = parseStrictHttpsUrl(cleaned, { allowBareHostname: true });
  if (!parsedRes.ok) return null;
  const parsed = parsedRes.url;
  const host = parsed.hostname.toLowerCase();
  if (!DAILYMOTION_HOSTS.has(host)) return null;

  const segs = parsed.pathname.split('/').filter(Boolean);
  let candidate: string | null = null;
  if (host === 'dai.ly' || host === 'www.dai.ly') {
    candidate = segs[0] || null;
  } else if (host === 'geo.dailymotion.com') {
    candidate = parsed.searchParams.get('video');
  } else if (segs[0] === 'video' && segs[1]) {
    candidate = segs[1].split('_')[0] || null;
  } else if (segs[0] === 'embed' && segs[1] === 'video' && segs[2]) {
    candidate = segs[2].split('_')[0] || null;
  }

  if (candidate && /^[a-zA-Z0-9]{5,16}$/.test(candidate)) {
    return candidate;
  }
  return null;
}

export function extractStreamableId(rawInput: string): string | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.startsWith('streamable:')
    ? trimmed.slice('streamable:'.length).trim()
    : trimmed;

  if (/^[a-zA-Z0-9]{4,14}$/.test(cleaned) && trimmed.startsWith('streamable:')) {
    return cleaned;
  }

  const parsedRes = parseStrictHttpsUrl(cleaned, { allowBareHostname: true });
  if (!parsedRes.ok) return null;
  const parsed = parsedRes.url;
  if (!STREAMABLE_HOSTS.has(parsed.hostname.toLowerCase())) return null;

  const segs = parsed.pathname.split('/').filter(Boolean);
  const candidate =
    segs[0] === 'e' || segs[0] === 'o' || segs[0] === 's' ? segs[1] : segs[0];
  if (candidate && /^[a-zA-Z0-9]{4,14}$/.test(candidate)) {
    return candidate;
  }
  return null;
}

export function extractTikTokVideoInfo(rawInput: string): {
  videoId: string | null;
  canonicalUrl: string;
  canonicalRef: string;
  isShortUrl: boolean;
} | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.startsWith('tiktok:')
    ? trimmed.slice('tiktok:'.length).trim()
    : trimmed;

  if (/^\d{15,24}$/.test(cleaned) && trimmed.startsWith('tiktok:')) {
    return {
      videoId: cleaned,
      canonicalUrl: `https://www.tiktok.com/video/${cleaned}`,
      canonicalRef: cleaned,
      isShortUrl: false,
    };
  }

  const parsedRes = parseStrictHttpsUrl(cleaned, { allowBareHostname: true });
  if (!parsedRes.ok) return null;
  const parsed = parsedRes.url;
  const host = parsed.hostname.toLowerCase();
  if (!TIKTOK_HOSTS.has(host)) return null;

  const segs = parsed.pathname.split('/').filter(Boolean);
  if (host === 'vm.tiktok.com' || host === 'vt.tiktok.com' || segs[0] === 't') {
    const code = host === 'vm.tiktok.com' || host === 'vt.tiktok.com' ? segs[0] : segs[1];
    if (!code || !/^[a-zA-Z0-9_-]{4,40}$/.test(code)) return null;
    const canonicalUrl = `https://${host}/${segs[0] === 't' ? `t/${code}` : code}/`;
    return {
      videoId: null,
      canonicalUrl,
      canonicalRef: canonicalUrl,
      isShortUrl: true,
    };
  }

  // /@handle/video/1234567890123456789 or /video/1234567890123456789
  const vidIndex = segs.indexOf('video');
  if (vidIndex >= 0 && segs[vidIndex + 1] && /^\d{15,24}$/.test(segs[vidIndex + 1])) {
    const videoId = segs[vidIndex + 1];
    const handle = vidIndex === 1 && segs[0].startsWith('@') ? segs[0] : null;
    const canonicalUrl = handle
      ? `https://www.tiktok.com/${handle}/video/${videoId}`
      : `https://www.tiktok.com/video/${videoId}`;
    return {
      videoId,
      canonicalUrl,
      canonicalRef: canonicalUrl,
      isShortUrl: false,
    };
  }

  if (segs[0] === 'embed' && segs[1] === 'v2' && segs[2] && /^\d{15,24}$/.test(segs[2])) {
    const videoId = segs[2];
    return {
      videoId,
      canonicalUrl: `https://www.tiktok.com/video/${videoId}`,
      canonicalRef: `https://www.tiktok.com/video/${videoId}`,
      isShortUrl: false,
    };
  }

  return null;
}

export function extractXPostInfo(rawInput: string): {
  statusId: string;
  username: string;
  canonicalUrl: string;
} | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.startsWith('x:')
    ? trimmed.slice('x:'.length).trim()
    : trimmed;

  const parsedRes = parseStrictHttpsUrl(cleaned, { allowBareHostname: true });
  if (!parsedRes.ok) return null;
  const parsed = parsedRes.url;
  const host = parsed.hostname.toLowerCase();
  if (!X_HOSTS.has(host)) return null;

  const segs = parsed.pathname.split('/').filter(Boolean);
  // /{username}/status/{id} or /i/web/status/{id}
  let statusId: string | null = null;
  let username = 'i';
  if (segs.length >= 3 && (segs[1] === 'status' || segs[1] === 'statuses') && /^\d{10,24}$/.test(segs[2])) {
    username = segs[0];
    statusId = segs[2];
  } else if (segs.length >= 4 && segs[0] === 'i' && segs[2] === 'status' && /^\d{10,24}$/.test(segs[3])) {
    username = 'i';
    statusId = segs[3];
  }

  if (!statusId || !/^[a-zA-Z0-9_]{1,32}$/.test(username)) return null;
  const canonicalUrl = `https://x.com/${username}/status/${statusId}`;
  return { statusId, username, canonicalUrl };
}

export function extractInstagramPostInfo(rawInput: string): {
  kind: 'p' | 'reel' | 'tv';
  shortcode: string;
  canonicalUrl: string;
  embedUrl: string;
} | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.startsWith('instagram:')
    ? trimmed.slice('instagram:'.length).trim()
    : trimmed;

  const parsedRes = parseStrictHttpsUrl(cleaned, { allowBareHostname: true });
  if (!parsedRes.ok) return null;
  const parsed = parsedRes.url;
  if (!INSTAGRAM_HOSTS.has(parsed.hostname.toLowerCase())) return null;

  const segs = parsed.pathname.split('/').filter(Boolean);
  // /p/{code}, /reel/{code}, /reels/{code}, /tv/{code}
  if (segs.length < 2) return null;
  const rawKind = segs[0];
  const kind: 'p' | 'reel' | 'tv' | null =
    rawKind === 'p'
      ? 'p'
      : rawKind === 'reel' || rawKind === 'reels'
      ? 'reel'
      : rawKind === 'tv'
      ? 'tv'
      : null;
  const shortcode = segs[1];
  if (!kind || !shortcode || !/^[a-zA-Z0-9_-]{5,40}$/.test(shortcode)) return null;

  const canonicalUrl = `https://www.instagram.com/${kind}/${shortcode}/`;
  const embedUrl = `https://www.instagram.com/${kind}/${shortcode}/embed/`;
  return { kind, shortcode, canonicalUrl, embedUrl };
}

export function inferDirectFormatFromUrl(url: URL): DirectStreamFormat | null {
  const pathname = url.pathname.toLowerCase();
  if (pathname.endsWith('.m3u8')) return 'hls';
  if (pathname.endsWith('.mpd')) return 'dash';
  if (
    pathname.endsWith('.mp4') ||
    pathname.endsWith('.m4v') ||
    pathname.endsWith('.webm') ||
    pathname.endsWith('.mov') ||
    pathname.endsWith('.ogv') ||
    pathname.endsWith('.ogg')
  ) {
    return 'mp4';
  }
  const formatParam = (url.searchParams.get('format') || '').toLowerCase();
  if (formatParam === 'm3u8' || formatParam === 'hls') return 'hls';
  if (formatParam === 'mpd' || formatParam === 'dash') return 'dash';
  if (formatParam === 'mp4' || formatParam === 'webm') return 'mp4';
  return null;
}

export const youtubeAdapter: VideoPlatformAdapter = {
  id: 'youtube',
  label: 'YouTube',
  allowedHosts: YOUTUBE_HOSTS,
  verifiability: 'verifiable',
  detect: (rawInput): DetectedVideoSource | null => {
    const trimmed = rawInput.trim();
    if (!trimmed) return null;

    // Enforce HTTPS if URL scheme is explicitly provided
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
      const check = parseStrictHttpsUrl(trimmed, { allowBareHostname: false });
      if (!check.ok) return null;
      if (!YOUTUBE_HOSTS.has(check.url.hostname.toLowerCase())) return null;
    } else if (!trimmed.startsWith('youtube:') && !/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
      const check = parseStrictHttpsUrl(trimmed, { allowBareHostname: true });
      if (!check.ok || !YOUTUBE_HOSTS.has(check.url.hostname.toLowerCase())) return null;
    }

    const ytId = extractYouTubeVideoId(trimmed);
    if (!ytId) return null;

    return {
      provider: 'youtube',
      platformLabel: 'YouTube',
      originalUrl: trimmed,
      canonicalRef: ytId,
      canonicalUrl: `https://www.youtube.com/watch?v=${ytId}`,
      embedUrl: getYouTubeNoCookieEmbedUrl(ytId),
      thumbnailUrl: getYouTubeThumbnailUrl(ytId),
      verifiability: 'verifiable',
      verifiabilityNoteId:
        'Menggunakan YouTube IFrame Player API resmi. Sistem dapat memverifikasi pemutaran nyata dan izin penyematan.',
      verifiabilityNoteEn:
        'Uses official YouTube IFrame Player API. Real playback and embed permissions are verified directly.',
    };
  },
};

export const vimeoAdapter: VideoPlatformAdapter = {
  id: 'vimeo',
  label: 'Vimeo',
  allowedHosts: VIMEO_HOSTS,
  verifiability: 'verifiable',
  detect: (rawInput): DetectedVideoSource | null => {
    const info = extractVimeoVideoRef(rawInput);
    if (!info) return null;
    return {
      provider: 'vimeo',
      platformLabel: 'Vimeo',
      originalUrl: rawInput.trim(),
      canonicalRef: info.canonicalRef,
      canonicalUrl: info.canonicalUrl,
      embedUrl: info.embedUrl,
      verifiability: 'verifiable',
      verifiabilityNoteId:
        'Menggunakan Vimeo Player API resmi (postMessage). Pemutaran nyata diverifikasi langsung dari event player.',
      verifiabilityNoteEn:
        'Uses official Vimeo Player API (postMessage). Real playback is verified from live player events.',
    };
  },
};

export const dailymotionAdapter: VideoPlatformAdapter = {
  id: 'dailymotion',
  label: 'Dailymotion',
  allowedHosts: DAILYMOTION_HOSTS,
  verifiability: 'verifiable',
  detect: (rawInput): DetectedVideoSource | null => {
    const dmId = extractDailymotionVideoId(rawInput);
    if (!dmId) return null;
    return {
      provider: 'dailymotion',
      platformLabel: 'Dailymotion',
      originalUrl: rawInput.trim(),
      canonicalRef: dmId,
      canonicalUrl: `https://www.dailymotion.com/video/${dmId}`,
      embedUrl: `https://www.dailymotion.com/embed/video/${dmId}?api=postMessage&autoplay=0`,
      verifiability: 'verifiable',
      verifiabilityNoteId:
        'Menggunakan Dailymotion Embed Player API resmi. Status putar diverifikasi dari event player resmi.',
      verifiabilityNoteEn:
        'Uses official Dailymotion Embed Player API. Playback status is verified from live player events.',
    };
  },
};

export const streamableAdapter: VideoPlatformAdapter = {
  id: 'streamable',
  label: 'Streamable',
  allowedHosts: STREAMABLE_HOSTS,
  verifiability: 'conditional',
  detect: (rawInput): DetectedVideoSource | null => {
    const id = extractStreamableId(rawInput);
    if (!id) return null;
    return {
      provider: 'streamable',
      platformLabel: 'Streamable',
      originalUrl: rawInput.trim(),
      canonicalRef: id,
      canonicalUrl: `https://streamable.com/${id}`,
      embedUrl: `https://streamable.com/e/${id}`,
      verifiability: 'conditional',
      verifiabilityNoteId:
        'Menggunakan embed resmi Streamable. Tombol Lanjutkan aktif hanya jika player mengirim event pemutaran nyata.',
      verifiabilityNoteEn:
        'Uses official Streamable embed. Continue unlocks only if the embed emits real playback events.',
    };
  },
};

export const tiktokAdapter: VideoPlatformAdapter = {
  id: 'tiktok',
  label: 'TikTok',
  allowedHosts: TIKTOK_HOSTS,
  verifiability: 'conditional',
  detect: (rawInput): DetectedVideoSource | null => {
    const info = extractTikTokVideoInfo(rawInput);
    if (!info) return null;
    return {
      provider: 'tiktok',
      platformLabel: 'TikTok',
      originalUrl: rawInput.trim(),
      canonicalRef: info.canonicalRef,
      canonicalUrl: info.canonicalUrl,
      embedUrl: info.videoId
        ? `https://www.tiktok.com/player/v1/${info.videoId}?autoplay=0&controls=1`
        : undefined,
      verifiability: 'conditional',
      verifiabilityNoteId:
        'Menggunakan TikTok Embed Player resmi. Jika browser atau TikTok membatasi event lintas-domain, status akan dilaporkan jujur sebagai Tidak Dapat Diverifikasi.',
      verifiabilityNoteEn:
        'Uses official TikTok Embed Player. If cross-origin playback events are blocked by TikTok or the browser, status will honestly report as Not Verifiable.',
    };
  },
};

export const facebookAdapter: VideoPlatformAdapter = {
  id: 'facebook',
  label: 'Facebook',
  allowedHosts: FACEBOOK_HOSTS,
  verifiability: 'unverifiable',
  detect: (rawInput): DetectedVideoSource | null => {
    const trimmed = rawInput.trim();
    if (!trimmed) return null;
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
      const check = parseStrictHttpsUrl(trimmed, { allowBareHostname: false });
      if (!check.ok || !FACEBOOK_HOSTS.has(check.url.hostname.toLowerCase())) return null;
    } else if (!trimmed.startsWith('facebook:')) {
      const check = parseStrictHttpsUrl(trimmed, { allowBareHostname: true });
      if (!check.ok || !FACEBOOK_HOSTS.has(check.url.hostname.toLowerCase())) return null;
    }

    const fbUrl = extractFacebookVideoUrl(trimmed);
    if (!fbUrl) return null;

    return {
      provider: 'facebook',
      platformLabel: 'Facebook',
      originalUrl: trimmed,
      canonicalRef: fbUrl,
      canonicalUrl: fbUrl,
      embedUrl: getFacebookEmbedUrl(fbUrl, { autoplay: false }),
      verifiability: 'unverifiable',
      verifiabilityNoteId:
        'Facebook Video Plugin berjalan di iframe terisolasi dan tidak menyediakan konfirmasi status PLAY lintas-domain. Pemutaran video ini tidak dapat diverifikasi otomatis oleh sistem.',
      verifiabilityNoteEn:
        'Facebook Video Plugin runs in an isolated iframe without reliable cross-origin PLAY verification. Playback cannot be automatically confirmed.',
    };
  },
};

export const xAdapter: VideoPlatformAdapter = {
  id: 'x',
  label: 'X (Twitter)',
  allowedHosts: X_HOSTS,
  verifiability: 'unverifiable',
  detect: (rawInput): DetectedVideoSource | null => {
    const info = extractXPostInfo(rawInput);
    if (!info) return null;
    return {
      provider: 'x',
      platformLabel: 'X (Twitter)',
      originalUrl: rawInput.trim(),
      canonicalRef: info.canonicalUrl,
      canonicalUrl: info.canonicalUrl,
      verifiability: 'unverifiable',
      verifiabilityNoteId:
        'X (Twitter) hanya menyediakan embed postingan (oEmbed) tanpa API verifikasi playback video langsung yang andal lintas-domain.',
      verifiabilityNoteEn:
        'X (Twitter) provides post oEmbed cards without a reliable cross-origin HTML5 video playback confirmation API.',
    };
  },
};

export const instagramAdapter: VideoPlatformAdapter = {
  id: 'instagram',
  label: 'Instagram',
  allowedHosts: INSTAGRAM_HOSTS,
  verifiability: 'unverifiable',
  detect: (rawInput): DetectedVideoSource | null => {
    const info = extractInstagramPostInfo(rawInput);
    if (!info) return null;
    return {
      provider: 'instagram',
      platformLabel: 'Instagram',
      originalUrl: rawInput.trim(),
      canonicalRef: info.canonicalUrl,
      canonicalUrl: info.canonicalUrl,
      embedUrl: info.embedUrl,
      verifiability: 'unverifiable',
      verifiabilityNoteId:
        'Embed Instagram tidak menyediakan API status pemutaran lintas-domain dan sering meminta login Instagram.',
      verifiabilityNoteEn:
        'Instagram embeds expose no cross-origin playback verification API and frequently trigger login walls.',
    };
  },
};

export const directVideoAdapter: VideoPlatformAdapter = {
  id: 'direct_video',
  label: 'Direct Video / Stream',
  verifiability: 'verifiable',
  detect: (rawInput): DetectedVideoSource | null => {
    const trimmed = rawInput.trim();
    if (!trimmed) return null;

    const clean = trimmed.startsWith('direct:')
      ? trimmed.slice('direct:'.length).trim()
      : trimmed;

    const parsedRes = parseStrictHttpsUrl(clean, {
      allowBareHostname: false,
      allowLocalHttp: false,
    });
    if (!parsedRes.ok) return null;

    const host = parsedRes.url.hostname.toLowerCase();
    // Never let known social/video page URLs fall through to DirectVideoAdapter
    if (
      YOUTUBE_HOSTS.has(host) ||
      VIMEO_HOSTS.has(host) ||
      DAILYMOTION_HOSTS.has(host) ||
      STREAMABLE_HOSTS.has(host) ||
      TIKTOK_HOSTS.has(host) ||
      FACEBOOK_HOSTS.has(host) ||
      X_HOSTS.has(host) ||
      INSTAGRAM_HOSTS.has(host)
    ) {
      return null;
    }

    const directFormat = inferDirectFormatFromUrl(parsedRes.url) ?? undefined;
    const formatLabel =
      directFormat === 'hls'
        ? 'Direct Stream (HLS .m3u8)'
        : directFormat === 'dash'
        ? 'Direct Stream (MPEG-DASH .mpd)'
        : directFormat === 'mp4'
        ? 'Direct Video (MP4 / WebM / MOV)'
        : 'Direct HTTPS Video URL';

    return {
      provider: 'direct_video',
      platformLabel: formatLabel,
      originalUrl: trimmed,
      canonicalRef: parsedRes.url.toString(),
      canonicalUrl: parsedRes.url.toString(),
      directFormat,
      verifiability: 'verifiable',
      verifiabilityNoteId:
        'Pemutaran MP4, WebM, MOV, HLS (.m3u8), atau MPEG-DASH (.mpd) diverifikasi langsung melalui HTML5 Video, hls.js, atau dash.js.',
      verifiabilityNoteEn:
        'MP4, WebM, MOV, HLS (.m3u8), or MPEG-DASH (.mpd) playback is verified directly via HTML5 Video, hls.js, or dash.js.',
    };
  },
};

export const VIDEO_PLATFORM_ADAPTERS: readonly VideoPlatformAdapter[] = [
  youtubeAdapter,
  vimeoAdapter,
  dailymotionAdapter,
  streamableAdapter,
  tiktokAdapter,
  facebookAdapter,
  xAdapter,
  instagramAdapter,
  directVideoAdapter,
];
