const ALLOWED_FACEBOOK_HOSTS = new Set([
  'facebook.com',
  'www.facebook.com',
  'm.facebook.com',
  'web.facebook.com',
  'mbasic.facebook.com',
  'fb.watch',
  'www.fb.watch',
]);

/**
 * Safely validates and canonicalizes a Facebook video, watch, reel, or fb.watch URL.
 * Rejects non-HTTP schemes, untrusted domains, and overly long strings (> 280 chars).
 */
export function extractFacebookVideoUrl(rawInput: string): string | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  const withoutPrefix = trimmed.startsWith('facebook:')
    ? trimmed.slice('facebook:'.length).trim()
    : trimmed;

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
  if (!ALLOWED_FACEBOOK_HOSTS.has(host)) {
    return null;
  }

  // Unwrap plugins/video.php?href=... only when the inner href is also a valid Facebook URL
  if (parsed.pathname === '/plugins/video.php') {
    const innerHref = parsed.searchParams.get('href');
    if (!innerHref || innerHref === rawInput) {
      return null;
    }
    return extractFacebookVideoUrl(innerHref);
  }

  if (host === 'fb.watch' || host === 'www.fb.watch') {
    const segs = parsed.pathname.split('/').filter(Boolean);
    if (segs.length === 0 || !/^[a-zA-Z0-9_-]{3,64}$/.test(segs[0])) {
      return null;
    }
    return `https://fb.watch/${segs[0]}/`;
  }

  const cleanPath = parsed.pathname.replace(/\/+$/, '');
  const videoIdParam = parsed.searchParams.get('v');

  const isWatchPath =
    (cleanPath === '/watch' || cleanPath === '/video.php') &&
    Boolean(videoIdParam && /^[0-9]{5,30}$/.test(videoIdParam));
  const isVideoPath =
    /\/videos\/(?:[a-zA-Z0-9._-]+\/)?[0-9]{5,30}$/.test(cleanPath) ||
    /^\/reel\/[a-zA-Z0-9_-]{5,30}$/.test(cleanPath) ||
    /^\/share\/[vr]\/[a-zA-Z0-9_-]{4,64}$/.test(cleanPath);

  if (!isWatchPath && !isVideoPath) {
    return null;
  }

  const canonical = isWatchPath
    ? `https://www.facebook.com${cleanPath}?v=${encodeURIComponent(videoIdParam!)}`
    : `https://www.facebook.com${cleanPath}`;

  if (canonical.length > 280) {
    return null;
  }

  return canonical;
}

export function getFacebookEmbedUrl(
  rawUrl: string,
  options?: { autoplay?: boolean; startSeconds?: number }
): string {
  const canonical = extractFacebookVideoUrl(rawUrl);
  if (!canonical) return '';

  const params = new URLSearchParams({
    href: canonical,
    show_text: 'false',
    autoplay: options?.autoplay === false ? 'false' : 'true',
  });

  if (
    typeof options?.startSeconds === 'number' &&
    Number.isFinite(options.startSeconds) &&
    options.startSeconds > 0
  ) {
    params.set('t', String(Math.floor(options.startSeconds)));
  }

  return `https://www.facebook.com/plugins/video.php?${params.toString()}`;
}
