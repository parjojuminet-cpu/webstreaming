const YOUTUBE_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;

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
        (parts[0] === 'embed' || parts[0] === 'shorts' || parts[0] === 'live' || parts[0] === 'v')
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

export function getYouTubeThumbnailUrl(videoId: string): string {
  const cleanId = extractYouTubeVideoId(videoId);
  if (!cleanId) return '';
  return `https://i.ytimg.com/vi/${cleanId}/hqdefault.jpg`;
}

export function getYouTubeNoCookieEmbedUrl(videoId: string): string {
  const cleanId = extractYouTubeVideoId(videoId);
  if (!cleanId) return '';
  return `https://www.youtube-nocookie.com/embed/${cleanId}`;
}
