const YOUTUBE_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;
const YOUTUBE_PLAYLIST_ID_REGEX = /^[a-zA-Z0-9_-]{10,64}$/;

const ALLOWED_YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

export type YouTubeEmbedTarget =
  | {
      kind: 'video';
      videoId: string;
      canonicalRef: string;
      canonicalUrl: string;
      embedUrl: string;
    }
  | {
      kind: 'playlist';
      playlistId: string;
      canonicalRef: string;
      canonicalUrl: string;
      embedUrl: string;
    };

/**
 * Safely extracts and validates an 11-character YouTube Video ID
 * from standard YouTube URLs (watch, youtu.be, embed, shorts, live)
 * or a raw 11-character ID. Rejects untrusted hosts and non-HTTP schemes.
 */
export function extractYouTubeVideoId(rawInput: string): string | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  const withoutPrefix = trimmed.startsWith('youtube:')
    ? trimmed.slice('youtube:'.length).trim()
    : trimmed;

  if (withoutPrefix.startsWith('playlist:')) {
    return null;
  }

  if (YOUTUBE_ID_REGEX.test(withoutPrefix)) {
    return withoutPrefix;
  }

  let parsed: URL;
  try {
    const withScheme =
      withoutPrefix.startsWith('http://') || withoutPrefix.startsWith('https://')
        ? withoutPrefix
        : `https://${withoutPrefix}`;
    parsed = new URL(withScheme);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  if (!ALLOWED_YOUTUBE_HOSTS.has(host)) {
    return null;
  }

  let candidate: string | null = null;

  if (host === 'youtu.be' || host === 'www.youtu.be') {
    const seg = parsed.pathname.split('/').filter(Boolean)[0] || '';
    candidate = seg;
  } else {
    const vParam = parsed.searchParams.get('v');
    if (vParam) {
      candidate = vParam;
    } else {
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (
        parts.length >= 2 &&
        (parts[0] === 'embed' || parts[0] === 'shorts' || parts[0] === 'live' || parts[0] === 'v') &&
        parts[1] !== 'videoseries'
      ) {
        candidate = parts[1];
      }
    }
  }

  if (candidate && YOUTUBE_ID_REGEX.test(candidate)) {
    return candidate;
  }

  return null;
}

/**
 * Safely extracts a YouTube Playlist ID from playlist URLs
 * (e.g. youtube.com/playlist?list=PL..., youtube.com/embed/videoseries?list=PL...)
 * or canonical playlist:<id> references.
 */
export function extractYouTubePlaylistId(rawInput: string): string | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  const withoutPrefix = trimmed.startsWith('youtube:')
    ? trimmed.slice('youtube:'.length).trim()
    : trimmed;

  if (withoutPrefix.startsWith('playlist:')) {
    const candidate = withoutPrefix.slice('playlist:'.length).trim();
    return YOUTUBE_PLAYLIST_ID_REGEX.test(candidate) ? candidate : null;
  }

  let parsed: URL;
  try {
    const withScheme =
      withoutPrefix.startsWith('http://') || withoutPrefix.startsWith('https://')
        ? withoutPrefix
        : `https://${withoutPrefix}`;
    parsed = new URL(withScheme);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  if (!ALLOWED_YOUTUBE_HOSTS.has(host)) {
    return null;
  }

  const parts = parsed.pathname.split('/').filter(Boolean);
  const isPlaylistPath =
    parts[0] === 'playlist' ||
    (parts[0] === 'embed' && parts[1] === 'videoseries');
  if (!isPlaylistPath) {
    return null;
  }

  const listParam = parsed.searchParams.get('list')?.trim() || '';
  if (YOUTUBE_PLAYLIST_ID_REGEX.test(listParam)) {
    return listParam;
  }

  return null;
}

export function extractYouTubeEmbedTarget(rawInput: string): YouTubeEmbedTarget | null {
  const videoId = extractYouTubeVideoId(rawInput);
  if (videoId) {
    return {
      kind: 'video',
      videoId,
      canonicalRef: videoId,
      canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
      embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}`,
    };
  }

  const playlistId = extractYouTubePlaylistId(rawInput);
  if (playlistId) {
    return {
      kind: 'playlist',
      playlistId,
      canonicalRef: `playlist:${playlistId}`,
      canonicalUrl: `https://www.youtube.com/playlist?list=${playlistId}`,
      embedUrl: `https://www.youtube-nocookie.com/embed/videoseries?list=${playlistId}`,
    };
  }

  return null;
}

export function getYouTubeThumbnailUrl(videoId: string): string {
  const cleanId = extractYouTubeVideoId(videoId);
  if (!cleanId) return '';
  return `https://i.ytimg.com/vi/${cleanId}/hqdefault.jpg`;
}

export function getYouTubeNoCookieEmbedUrl(videoOrPlaylistRef: string): string {
  const target = extractYouTubeEmbedTarget(videoOrPlaylistRef);
  return target ? target.embedUrl : '';
}
