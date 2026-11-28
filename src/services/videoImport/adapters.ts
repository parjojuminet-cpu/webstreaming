import {
  extractYouTubeEmbedTarget,
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

const DROPBOX_HOSTS = new Set([
  'dropbox.com',
  'www.dropbox.com',
  'dl.dropboxusercontent.com',
]);

const GOOGLE_DRIVE_HOSTS = new Set([
  'drive.google.com',
  'docs.google.com',
]);

const ARCHIVE_ORG_HOSTS = new Set([
  'archive.org',
  'www.archive.org',
]);

const TWITCH_HOSTS = new Set([
  'twitch.tv',
  'www.twitch.tv',
  'm.twitch.tv',
  'clips.twitch.tv',
  'player.twitch.tv',
]);

const RUMBLE_HOSTS = new Set([
  'rumble.com',
  'www.rumble.com',
]);

const ODYSEE_HOSTS = new Set([
  'odysee.com',
  'www.odysee.com',
]);

const LOOM_HOSTS = new Set([
  'loom.com',
  'www.loom.com',
]);

const BILIBILI_HOSTS = new Set([
  'bilibili.com',
  'www.bilibili.com',
  'm.bilibili.com',
  'player.bilibili.com',
  'bilibili.tv',
  'www.bilibili.tv',
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

export function normalizeDropboxDirectUrl(rawInput: string): string | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;
  const parsedRes = parseStrictHttpsUrl(trimmed, { allowBareHostname: true });
  if (!parsedRes.ok) return null;
  const parsed = parsedRes.url;
  const host = parsed.hostname.toLowerCase();
  if (!DROPBOX_HOSTS.has(host)) return null;

  const segs = parsed.pathname.split('/').filter(Boolean);
  if (host === 'dl.dropboxusercontent.com') {
    return parsed.toString();
  }
  if (segs[0] === 's' || segs[0] === 'scl' || segs[0] === 'sh') {
    if (segs[0] === 'sh') return null; // Shared folders are not single video files
    const clone = new URL(parsed.toString());
    clone.searchParams.delete('dl');
    clone.searchParams.set('raw', '1');
    return clone.toString();
  }
  return null;
}

export function extractGoogleDriveFileInfo(rawInput: string): {
  id: string;
  canonicalUrl: string;
  embedUrl: string;
} | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.startsWith('google_drive:')
    ? trimmed.slice('google_drive:'.length).trim()
    : trimmed;

  if (/^[a-zA-Z0-9_-]{18,80}$/.test(cleaned) && trimmed.startsWith('google_drive:')) {
    return {
      id: cleaned,
      canonicalUrl: `https://drive.google.com/file/d/${cleaned}/view`,
      embedUrl: `https://drive.google.com/file/d/${cleaned}/preview`,
    };
  }

  const parsedRes = parseStrictHttpsUrl(cleaned, { allowBareHostname: true });
  if (!parsedRes.ok) return null;
  const parsed = parsedRes.url;
  if (!GOOGLE_DRIVE_HOSTS.has(parsed.hostname.toLowerCase())) return null;

  const segs = parsed.pathname.split('/').filter(Boolean);
  let id: string | null = null;
  const dIdx = segs.indexOf('d');
  if (dIdx >= 0 && segs[dIdx + 1] && /^[a-zA-Z0-9_-]{15,80}$/.test(segs[dIdx + 1])) {
    id = segs[dIdx + 1];
  } else {
    const qpId = parsed.searchParams.get('id');
    if (qpId && /^[a-zA-Z0-9_-]{15,80}$/.test(qpId)) {
      id = qpId;
    }
  }
  if (!id) return null;

  return {
    id,
    canonicalUrl: `https://drive.google.com/file/d/${id}/view`,
    embedUrl: `https://drive.google.com/file/d/${id}/preview`,
  };
}

export function extractArchiveOrgInfo(rawInput: string): {
  id: string;
  canonicalUrl: string;
  embedUrl: string;
  metadataUrl: string;
  thumbnailUrl: string;
} | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.startsWith('archive_org:')
    ? trimmed.slice('archive_org:'.length).trim()
    : trimmed;

  if (/^[a-zA-Z0-9._-]{3,120}$/.test(cleaned) && trimmed.startsWith('archive_org:')) {
    return {
      id: cleaned,
      canonicalUrl: `https://archive.org/details/${encodeURIComponent(cleaned)}`,
      embedUrl: `https://archive.org/embed/${encodeURIComponent(cleaned)}`,
      metadataUrl: `https://archive.org/metadata/${encodeURIComponent(cleaned)}`,
      thumbnailUrl: `https://archive.org/services/img/${encodeURIComponent(cleaned)}`,
    };
  }

  const parsedRes = parseStrictHttpsUrl(cleaned, { allowBareHostname: true });
  if (!parsedRes.ok) return null;
  const parsed = parsedRes.url;
  if (!ARCHIVE_ORG_HOSTS.has(parsed.hostname.toLowerCase())) return null;

  const segs = parsed.pathname.split('/').filter(Boolean);
  if (segs.length < 2) return null;
  if (segs[0] !== 'details' && segs[0] !== 'embed' && segs[0] !== 'download') {
    return null;
  }
  const id = decodeURIComponent(segs[1]);
  if (!id || !/^[a-zA-Z0-9._-]{2,140}$/.test(id)) return null;

  return {
    id,
    canonicalUrl: `https://archive.org/details/${encodeURIComponent(id)}`,
    embedUrl: `https://archive.org/embed/${encodeURIComponent(id)}`,
    metadataUrl: `https://archive.org/metadata/${encodeURIComponent(id)}`,
    thumbnailUrl: `https://archive.org/services/img/${encodeURIComponent(id)}`,
  };
}

export function extractTwitchRef(rawInput: string): {
  kind: 'video' | 'clip' | 'channel';
  target: string;
  canonicalRef: string;
  canonicalUrl: string;
} | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.startsWith('twitch:')
    ? trimmed.slice('twitch:'.length).trim()
    : trimmed;

  const directRefMatch = /^(video|clip|channel):([a-zA-Z0-9_-]{2,80})$/.exec(cleaned);
  if (directRefMatch && trimmed.startsWith('twitch:')) {
    const [, kind, target] = directRefMatch as unknown as [string, 'video' | 'clip' | 'channel', string];
    const canonicalUrl =
      kind === 'video'
        ? `https://www.twitch.tv/videos/${target}`
        : kind === 'clip'
        ? `https://clips.twitch.tv/${target}`
        : `https://www.twitch.tv/${target}`;
    return {
      kind,
      target,
      canonicalRef: `twitch:${kind}:${target}`,
      canonicalUrl,
    };
  }

  const parsedRes = parseStrictHttpsUrl(cleaned, { allowBareHostname: true });
  if (!parsedRes.ok) return null;
  const parsed = parsedRes.url;
  const host = parsed.hostname.toLowerCase();
  if (!TWITCH_HOSTS.has(host)) return null;

  const segs = parsed.pathname.split('/').filter(Boolean);
  if (host === 'clips.twitch.tv') {
    const slug = segs[0] === 'embed' ? parsed.searchParams.get('clip') : segs[0];
    if (!slug || !/^[a-zA-Z0-9_-]{4,80}$/.test(slug)) return null;
    return {
      kind: 'clip',
      target: slug,
      canonicalRef: `twitch:clip:${slug}`,
      canonicalUrl: `https://clips.twitch.tv/${slug}`,
    };
  }

  if (host === 'player.twitch.tv') {
    const vid = parsed.searchParams.get('video');
    const chan = parsed.searchParams.get('channel');
    if (vid && /^v?\d{5,20}$/.test(vid)) {
      const cleanId = vid.replace(/^v/, '');
      return {
        kind: 'video',
        target: cleanId,
        canonicalRef: `twitch:video:${cleanId}`,
        canonicalUrl: `https://www.twitch.tv/videos/${cleanId}`,
      };
    }
    if (chan && /^[a-zA-Z0-9_]{2,32}$/.test(chan)) {
      return {
        kind: 'channel',
        target: chan,
        canonicalRef: `twitch:channel:${chan}`,
        canonicalUrl: `https://www.twitch.tv/${chan}`,
      };
    }
    return null;
  }

  if (segs[0] === 'videos' && segs[1] && /^\d{5,20}$/.test(segs[1])) {
    return {
      kind: 'video',
      target: segs[1],
      canonicalRef: `twitch:video:${segs[1]}`,
      canonicalUrl: `https://www.twitch.tv/videos/${segs[1]}`,
    };
  }

  if (segs.length >= 3 && segs[1] === 'clip' && /^[a-zA-Z0-9_-]{4,80}$/.test(segs[2])) {
    return {
      kind: 'clip',
      target: segs[2],
      canonicalRef: `twitch:clip:${segs[2]}`,
      canonicalUrl: `https://clips.twitch.tv/${segs[2]}`,
    };
  }

  if (
    segs.length === 1 &&
    /^[a-zA-Z0-9_]{2,32}$/.test(segs[0]) &&
    !['directory', 'videos', 'downloads', 'jobs', 'turbo', 'p'].includes(segs[0].toLowerCase())
  ) {
    return {
      kind: 'channel',
      target: segs[0],
      canonicalRef: `twitch:channel:${segs[0]}`,
      canonicalUrl: `https://www.twitch.tv/${segs[0]}`,
    };
  }

  return null;
}

export function buildTwitchEmbedUrl(rawRefOrUrl: string, parentHostname: string): string | null {
  const info = extractTwitchRef(rawRefOrUrl);
  if (!info) return null;
  const safeHost = parentHostname.trim() || 'localhost';
  const parentParam = encodeURIComponent(safeHost);
  if (info.kind === 'video') {
    return `https://player.twitch.tv/?video=${encodeURIComponent(info.target)}&parent=${parentParam}&autoplay=false`;
  }
  if (info.kind === 'clip') {
    return `https://clips.twitch.tv/embed?clip=${encodeURIComponent(info.target)}&parent=${parentParam}&autoplay=false`;
  }
  return `https://player.twitch.tv/?channel=${encodeURIComponent(info.target)}&parent=${parentParam}&autoplay=false`;
}

export function extractRumbleInfo(rawInput: string): {
  canonicalRef: string;
  canonicalUrl: string;
  embedUrl?: string;
} | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.startsWith('rumble:')
    ? trimmed.slice('rumble:'.length).trim()
    : trimmed;

  const parsedRes = parseStrictHttpsUrl(cleaned, { allowBareHostname: true });
  if (!parsedRes.ok) return null;
  const parsed = parsedRes.url;
  if (!RUMBLE_HOSTS.has(parsed.hostname.toLowerCase())) return null;

  const segs = parsed.pathname.split('/').filter(Boolean);
  if (segs.length === 0) return null;
  if (segs[0] === 'embed' && segs[1] && /^v[a-zA-Z0-9_-]{3,32}$/.test(segs[1])) {
    return {
      canonicalRef: `https://rumble.com/embed/${segs[1]}/`,
      canonicalUrl: `https://rumble.com/embed/${segs[1]}/`,
      embedUrl: `https://rumble.com/embed/${segs[1]}/`,
    };
  }
  if (/^v[a-zA-Z0-9_-]{3,80}\.html$/i.test(segs[0]) || /^v[a-zA-Z0-9_-]{3,80}/.test(segs[0])) {
    const cleanUrl = `https://rumble.com/${segs.join('/')}`;
    return {
      canonicalRef: cleanUrl,
      canonicalUrl: cleanUrl,
    };
  }
  return null;
}

export function extractOdyseeInfo(rawInput: string): {
  canonicalRef: string;
  canonicalUrl: string;
  embedUrl: string;
} | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;
  const parsedRes = parseStrictHttpsUrl(trimmed, { allowBareHostname: true });
  if (!parsedRes.ok) return null;
  const parsed = parsedRes.url;
  if (!ODYSEE_HOSTS.has(parsed.hostname.toLowerCase())) return null;

  const segs = parsed.pathname.split('/').filter(Boolean);
  if (segs.length === 0) return null;

  if (segs[0] === '$' && segs[1] === 'embed' && segs.length >= 3) {
    const rest = segs.slice(2).join('/');
    const embedUrl = `https://odysee.com/$/embed/${rest}`;
    return {
      canonicalRef: embedUrl,
      canonicalUrl: `https://odysee.com/${rest}`,
      embedUrl,
    };
  }

  if (segs.length >= 2 || segs[0].includes(':')) {
    const pathPart = segs.join('/');
    const canonicalUrl = `https://odysee.com/${pathPart}`;
    const embedUrl = `https://odysee.com/$/embed/${pathPart}`;
    return {
      canonicalRef: canonicalUrl,
      canonicalUrl,
      embedUrl,
    };
  }

  return null;
}

export function extractLoomInfo(rawInput: string): {
  id: string;
  canonicalUrl: string;
  embedUrl: string;
} | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.startsWith('loom:')
    ? trimmed.slice('loom:'.length).trim()
    : trimmed;

  if (/^[a-fA-F0-9]{24,40}$/.test(cleaned) && trimmed.startsWith('loom:')) {
    return {
      id: cleaned,
      canonicalUrl: `https://www.loom.com/share/${cleaned}`,
      embedUrl: `https://www.loom.com/embed/${cleaned}`,
    };
  }

  const parsedRes = parseStrictHttpsUrl(cleaned, { allowBareHostname: true });
  if (!parsedRes.ok) return null;
  const parsed = parsedRes.url;
  if (!LOOM_HOSTS.has(parsed.hostname.toLowerCase())) return null;

  const segs = parsed.pathname.split('/').filter(Boolean);
  if ((segs[0] === 'share' || segs[0] === 'embed') && segs[1] && /^[a-zA-Z0-9]{16,48}$/.test(segs[1])) {
    return {
      id: segs[1],
      canonicalUrl: `https://www.loom.com/share/${segs[1]}`,
      embedUrl: `https://www.loom.com/embed/${segs[1]}`,
    };
  }
  return null;
}

export function extractBilibiliInfo(rawInput: string): {
  kind: 'bvid' | 'tv';
  id: string;
  canonicalRef: string;
  canonicalUrl: string;
  embedUrl: string;
} | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;
  const parsedRes = parseStrictHttpsUrl(trimmed, { allowBareHostname: true });
  if (!parsedRes.ok) return null;
  const parsed = parsedRes.url;
  const host = parsed.hostname.toLowerCase();
  if (!BILIBILI_HOSTS.has(host)) return null;

  const segs = parsed.pathname.split('/').filter(Boolean);
  if (host === 'player.bilibili.com') {
    const bvid = parsed.searchParams.get('bvid');
    if (bvid && /^BV[a-zA-Z0-9]{8,16}$/.test(bvid)) {
      return {
        kind: 'bvid',
        id: bvid,
        canonicalRef: `https://www.bilibili.com/video/${bvid}`,
        canonicalUrl: `https://www.bilibili.com/video/${bvid}`,
        embedUrl: `https://player.bilibili.com/player.html?bvid=${encodeURIComponent(bvid)}&autoplay=0&danmaku=0`,
      };
    }
    return null;
  }

  if (host.endsWith('bilibili.com')) {
    const videoIdx = segs.indexOf('video');
    const candidate = videoIdx >= 0 ? segs[videoIdx + 1] : segs[0];
    if (candidate && /^BV[a-zA-Z0-9]{8,16}$/.test(candidate)) {
      return {
        kind: 'bvid',
        id: candidate,
        canonicalRef: `https://www.bilibili.com/video/${candidate}`,
        canonicalUrl: `https://www.bilibili.com/video/${candidate}`,
        embedUrl: `https://player.bilibili.com/player.html?bvid=${encodeURIComponent(candidate)}&autoplay=0&danmaku=0`,
      };
    }
    return null;
  }

  // bilibili.tv/{lang}/video/{id} or /video/{id}
  const vIdx = segs.indexOf('video');
  const tvId = vIdx >= 0 ? segs[vIdx + 1] : null;
  if (tvId && /^\d{5,20}$/.test(tvId)) {
    const lang = vIdx === 1 && /^[a-z]{2}$/i.test(segs[0]) ? segs[0].toLowerCase() : 'en';
    const canonicalUrl = `https://www.bilibili.tv/${lang}/video/${tvId}`;
    return {
      kind: 'tv',
      id: tvId,
      canonicalRef: canonicalUrl,
      canonicalUrl,
      embedUrl: canonicalUrl,
    };
  }

  return null;
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

    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
      const check = parseStrictHttpsUrl(trimmed, { allowBareHostname: false });
      if (!check.ok) return null;
      if (!YOUTUBE_HOSTS.has(check.url.hostname.toLowerCase())) return null;
    } else if (!trimmed.startsWith('youtube:') && !/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
      const check = parseStrictHttpsUrl(trimmed, { allowBareHostname: true });
      if (!check.ok || !YOUTUBE_HOSTS.has(check.url.hostname.toLowerCase())) return null;
    }

    const target = extractYouTubeEmbedTarget(trimmed);
    if (!target) return null;

    if (target.kind === 'playlist') {
      return {
        provider: 'youtube',
        platformLabel: 'YouTube Playlist',
        originalUrl: trimmed,
        canonicalRef: target.canonicalRef,
        canonicalUrl: target.canonicalUrl,
        embedUrl: target.embedUrl,
        verifiability: 'verifiable',
        verifiabilityNoteId:
          'Menggunakan YouTube IFrame Player API resmi (Playlist). Sistem memverifikasi pemutaran nyata dan izin penyematan.',
        verifiabilityNoteEn:
          'Uses official YouTube IFrame Player API (Playlist). Real playback and embed permissions are verified directly.',
      };
    }

    return {
      provider: 'youtube',
      platformLabel: 'YouTube',
      originalUrl: trimmed,
      canonicalRef: target.canonicalRef,
      canonicalUrl: target.canonicalUrl,
      embedUrl: target.embedUrl,
      thumbnailUrl: getYouTubeThumbnailUrl(target.videoId),
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
        'Menggunakan embed resmi Streamable. Anda dapat memutar preview atau mengonfirmasi langsung jika frame player sudah siap.',
      verifiabilityNoteEn:
        'Uses official Streamable embed. Press Play or confirm frame playback once loaded.',
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

export const dropboxAdapter: VideoPlatformAdapter = {
  id: 'direct_video',
  label: 'Dropbox Video',
  allowedHosts: DROPBOX_HOSTS,
  verifiability: 'verifiable',
  detect: (rawInput): DetectedVideoSource | null => {
    const rawUrl = normalizeDropboxDirectUrl(rawInput);
    if (!rawUrl) return null;
    return {
      provider: 'direct_video',
      platformLabel: 'Dropbox Direct Video',
      originalUrl: rawInput.trim(),
      canonicalRef: rawUrl,
      canonicalUrl: rawUrl,
      directFormat: 'mp4',
      verifiability: 'verifiable',
      verifiabilityNoteId:
        'Tautan Dropbox otomatis dikonversi menjadi stream video langsung (?raw=1) dan diverifikasi melalui HTML5 Video.',
      verifiabilityNoteEn:
        'Dropbox link is automatically converted to a direct video stream (?raw=1) and verified via HTML5 Video.',
    };
  },
};

export const googleDriveAdapter: VideoPlatformAdapter = {
  id: 'google_drive',
  label: 'Google Drive',
  allowedHosts: GOOGLE_DRIVE_HOSTS,
  verifiability: 'conditional',
  detect: (rawInput): DetectedVideoSource | null => {
    const info = extractGoogleDriveFileInfo(rawInput);
    if (!info) return null;
    return {
      provider: 'google_drive',
      platformLabel: 'Google Drive',
      originalUrl: rawInput.trim(),
      canonicalRef: info.id,
      canonicalUrl: info.canonicalUrl,
      embedUrl: info.embedUrl,
      verifiability: 'conditional',
      verifiabilityNoteId:
        'Menggunakan Google Drive Preview Embed. Pastikan akses file disetel "Siapa saja yang memiliki link" lalu buka Preview dan konfirmasi pemutaran.',
      verifiabilityNoteEn:
        'Uses Google Drive Preview Embed. Ensure sharing is set to "Anyone with the link", then open Preview and confirm playback.',
    };
  },
};

export const archiveOrgAdapter: VideoPlatformAdapter = {
  id: 'archive_org',
  label: 'Internet Archive',
  allowedHosts: ARCHIVE_ORG_HOSTS,
  verifiability: 'conditional',
  detect: (rawInput): DetectedVideoSource | null => {
    const info = extractArchiveOrgInfo(rawInput);
    if (!info) return null;
    return {
      provider: 'archive_org',
      platformLabel: 'Internet Archive',
      originalUrl: rawInput.trim(),
      canonicalRef: info.id,
      canonicalUrl: info.canonicalUrl,
      embedUrl: info.embedUrl,
      thumbnailUrl: info.thumbnailUrl,
      verifiability: 'conditional',
      verifiabilityNoteId:
        'Menggunakan Internet Archive (otomatis mengambil file MP4 langsung jika tersedia atau embed resmi Archive.org).',
      verifiabilityNoteEn:
        'Uses Internet Archive (automatically upgrades to direct MP4 stream when available or uses official Archive.org embed).',
    };
  },
};

export const twitchAdapter: VideoPlatformAdapter = {
  id: 'twitch',
  label: 'Twitch',
  allowedHosts: TWITCH_HOSTS,
  verifiability: 'conditional',
  detect: (rawInput): DetectedVideoSource | null => {
    const info = extractTwitchRef(rawInput);
    if (!info) return null;
    return {
      provider: 'twitch',
      platformLabel: 'Twitch',
      originalUrl: rawInput.trim(),
      canonicalRef: info.canonicalRef,
      canonicalUrl: info.canonicalUrl,
      verifiability: 'conditional',
      verifiabilityNoteId:
        'Menggunakan Twitch Interactive Embed Player resmi (otomatis menyesuaikan parameter parent domain aktif).',
      verifiabilityNoteEn:
        'Uses official Twitch Embed Player (automatically attaches the active host domain parent parameter).',
    };
  },
};

export const rumbleAdapter: VideoPlatformAdapter = {
  id: 'rumble',
  label: 'Rumble',
  allowedHosts: RUMBLE_HOSTS,
  verifiability: 'conditional',
  detect: (rawInput): DetectedVideoSource | null => {
    const info = extractRumbleInfo(rawInput);
    if (!info) return null;
    return {
      provider: 'rumble',
      platformLabel: 'Rumble',
      originalUrl: rawInput.trim(),
      canonicalRef: info.canonicalRef,
      canonicalUrl: info.canonicalUrl,
      embedUrl: info.embedUrl,
      verifiability: 'conditional',
      verifiabilityNoteId:
        'Menggunakan embed resmi Rumble melalui oEmbed API.',
      verifiabilityNoteEn:
        'Uses official Rumble embed resolved via oEmbed API.',
    };
  },
};

export const odyseeAdapter: VideoPlatformAdapter = {
  id: 'odysee',
  label: 'Odysee',
  allowedHosts: ODYSEE_HOSTS,
  verifiability: 'conditional',
  detect: (rawInput): DetectedVideoSource | null => {
    const info = extractOdyseeInfo(rawInput);
    if (!info) return null;
    return {
      provider: 'odysee',
      platformLabel: 'Odysee',
      originalUrl: rawInput.trim(),
      canonicalRef: info.canonicalRef,
      canonicalUrl: info.canonicalUrl,
      embedUrl: info.embedUrl,
      verifiability: 'conditional',
      verifiabilityNoteId:
        'Menggunakan Odysee Embed Player atau stream media langsung dari halaman Odysee.',
      verifiabilityNoteEn:
        'Uses Odysee Embed Player or direct media stream extracted from the Odysee page.',
    };
  },
};

export const loomAdapter: VideoPlatformAdapter = {
  id: 'loom',
  label: 'Loom',
  allowedHosts: LOOM_HOSTS,
  verifiability: 'conditional',
  detect: (rawInput): DetectedVideoSource | null => {
    const info = extractLoomInfo(rawInput);
    if (!info) return null;
    return {
      provider: 'loom',
      platformLabel: 'Loom',
      originalUrl: rawInput.trim(),
      canonicalRef: info.id,
      canonicalUrl: info.canonicalUrl,
      embedUrl: info.embedUrl,
      verifiability: 'conditional',
      verifiabilityNoteId:
        'Menggunakan Loom Embed Player resmi (oEmbed API).',
      verifiabilityNoteEn:
        'Uses official Loom Embed Player (oEmbed API).',
    };
  },
};

export const bilibiliAdapter: VideoPlatformAdapter = {
  id: 'bilibili',
  label: 'Bilibili',
  allowedHosts: BILIBILI_HOSTS,
  verifiability: 'conditional',
  detect: (rawInput): DetectedVideoSource | null => {
    const info = extractBilibiliInfo(rawInput);
    if (!info) return null;
    return {
      provider: 'bilibili',
      platformLabel: 'Bilibili',
      originalUrl: rawInput.trim(),
      canonicalRef: info.canonicalRef,
      canonicalUrl: info.canonicalUrl,
      embedUrl: info.embedUrl,
      verifiability: 'conditional',
      verifiabilityNoteId:
        'Menggunakan Bilibili Video Embed Player.',
      verifiabilityNoteEn:
        'Uses Bilibili Video Embed Player.',
    };
  },
};

export const htmlEmbedPrefixAdapter: VideoPlatformAdapter = {
  id: 'html_embed',
  label: 'HTML Web Page',
  verifiability: 'conditional',
  detect: (rawInput): DetectedVideoSource | null => {
    const trimmed = rawInput.trim();
    if (!trimmed.startsWith('html:')) return null;
    const clean = trimmed.slice('html:'.length).trim();
    const parsedRes = parseStrictHttpsUrl(clean, {
      allowBareHostname: false,
      allowLocalHttp: false,
    });
    if (!parsedRes.ok) return null;
    const urlStr = parsedRes.url.toString();
    return {
      provider: 'html_embed',
      platformLabel: 'Halaman Web HTML (Embed)',
      originalUrl: trimmed,
      canonicalRef: urlStr,
      canonicalUrl: urlStr,
      embedUrl: urlStr,
      verifiability: 'conditional',
      verifiabilityNoteId:
        'Halaman web HTML disematkan melalui iframe aman DELOKEN. Pastikan video tampil dan dapat diputar saat Preview.',
      verifiabilityNoteEn:
        'HTML web page embedded via DELOKEN sandboxed iframe. Confirm playback works inside Preview.',
    };
  },
};

export const directVideoAdapter: VideoPlatformAdapter = {
  id: 'direct_video',
  label: 'Direct Video / Web Page',
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
    if (
      YOUTUBE_HOSTS.has(host) ||
      VIMEO_HOSTS.has(host) ||
      DAILYMOTION_HOSTS.has(host) ||
      STREAMABLE_HOSTS.has(host) ||
      TIKTOK_HOSTS.has(host) ||
      FACEBOOK_HOSTS.has(host) ||
      X_HOSTS.has(host) ||
      INSTAGRAM_HOSTS.has(host) ||
      DROPBOX_HOSTS.has(host) ||
      GOOGLE_DRIVE_HOSTS.has(host) ||
      ARCHIVE_ORG_HOSTS.has(host) ||
      TWITCH_HOSTS.has(host) ||
      RUMBLE_HOSTS.has(host) ||
      ODYSEE_HOSTS.has(host) ||
      LOOM_HOSTS.has(host) ||
      BILIBILI_HOSTS.has(host)
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
        : 'Web / HTML / Stream URL';

    return {
      provider: 'direct_video',
      platformLabel: formatLabel,
      originalUrl: trimmed,
      canonicalRef: parsedRes.url.toString(),
      canonicalUrl: parsedRes.url.toString(),
      directFormat,
      verifiability: 'verifiable',
      verifiabilityNoteId:
        'Mendukung URL video langsung (MP4, WebM, MOV, HLS .m3u8, DASH .mpd) maupun ekstraksi otomatis video dari halaman HTML.',
      verifiabilityNoteEn:
        'Supports direct video URLs (MP4, WebM, MOV, HLS .m3u8, DASH .mpd) as well as automatic video extraction from HTML pages.',
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
  dropboxAdapter,
  googleDriveAdapter,
  archiveOrgAdapter,
  twitchAdapter,
  rumbleAdapter,
  odyseeAdapter,
  loomAdapter,
  bilibiliAdapter,
  htmlEmbedPrefixAdapter,
  directVideoAdapter,
];
