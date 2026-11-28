import dns from 'node:dns/promises';
import net from 'node:net';
import {
  extractArchiveOrgInfo,
  extractBilibiliInfo,
  extractGoogleDriveFileInfo,
  extractLoomInfo,
  extractOdyseeInfo,
  extractRumbleInfo,
  extractTikTokVideoInfo,
  extractTwitchRef,
  inferDirectFormatFromUrl,
} from '../src/services/videoImport/adapters.ts';
import { detectVideoSourceFromInput } from '../src/services/videoImport/registry.ts';
import type { LinkInspectionDiagnostics } from '../src/services/videoImport/types.ts';
import { parseStrictHttpsUrl } from '../src/services/videoImport/urlGuards.ts';
import type { DirectStreamFormat } from '../src/types/vyora';
import { inferAspectRatioFromUrlOrProvider } from '../src/utils/videoAspect.ts';

const INSPECT_TIMEOUT_MS = 7500;
const MAX_REDIRECT_HOPS = 3;
const MAX_PROBE_BYTES = 32 * 1024;
const MAX_HTML_BYTES = 192 * 1024;
const MAX_ARCHIVE_METADATA_BYTES = 192 * 1024;

const TIKTOK_ALLOWED_HOSTS = new Set([
  'tiktok.com',
  'www.tiktok.com',
  'm.tiktok.com',
  'vt.tiktok.com',
  'vm.tiktok.com',
]);

const IGNORED_IFRAME_HOSTS = new Set([
  'www.googletagmanager.com',
  'googletagmanager.com',
  'www.google-analytics.com',
  'doubleclick.net',
  'googleads.g.doubleclick.net',
  'www.google.com',
  'accounts.google.com',
  'recaptcha.net',
  'www.recaptcha.net',
  'challenges.cloudflare.com',
  'platform.twitter.com',
  'connect.facebook.net',
]);

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map(Number);
  return (
    ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
  );
}

function inCidr4(ipInt: number, base: string, maskBits: number): boolean {
  const baseInt = ipv4ToInt(base);
  const mask = maskBits === 0 ? 0 : (~0 << (32 - maskBits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

export function isPrivateOrReservedIp(rawIp: string): boolean {
  const ip = rawIp.trim().toLowerCase().replace(/%.*$/, '');
  const kind = net.isIP(ip);
  if (kind === 0) return true;

  if (kind === 4) {
    const n = ipv4ToInt(ip);
    return (
      inCidr4(n, '0.0.0.0', 8) || // "This" network
      inCidr4(n, '10.0.0.0', 8) || // RFC1918
      inCidr4(n, '100.64.0.0', 10) || // CGNAT
      inCidr4(n, '127.0.0.0', 8) || // Loopback
      inCidr4(n, '169.254.0.0', 16) || // Link-local & AWS/GCP metadata
      inCidr4(n, '172.16.0.0', 12) || // RFC1918
      inCidr4(n, '192.0.0.0', 24) || // IETF Protocol Assignments
      inCidr4(n, '192.0.2.0', 24) || // TEST-NET-1
      inCidr4(n, '192.168.0.0', 16) || // RFC1918
      inCidr4(n, '198.18.0.0', 15) || // Benchmarking
      inCidr4(n, '198.51.100.0', 24) || // TEST-NET-2
      inCidr4(n, '203.0.113.0', 24) || // TEST-NET-3
      inCidr4(n, '224.0.0.0', 4) || // Multicast
      inCidr4(n, '240.0.0.0', 4) // Reserved / Broadcast
    );
  }

  // IPv6 checks
  if (ip === '::' || ip === '::1') return true;
  if (ip.startsWith('::ffff:')) {
    const mapped = ip.slice('::ffff:'.length);
    if (net.isIPv4(mapped)) {
      return isPrivateOrReservedIp(mapped);
    }
    return true;
  }
  if (
    ip.startsWith('fc') ||
    ip.startsWith('fd') || // ULA fc00::/7
    ip.startsWith('fe8') ||
    ip.startsWith('fe9') ||
    ip.startsWith('fea') ||
    ip.startsWith('feb') || // Link-local fe80::/10
    ip.startsWith('ff') // Multicast
  ) {
    return true;
  }
  return false;
}

async function assertPublicRoutableTarget(
  rawUrl: string,
  allowedHosts?: ReadonlySet<string>
): Promise<URL> {
  const parsedGuard = parseStrictHttpsUrl(rawUrl, {
    allowBareHostname: false,
    allowLocalHttp: false,
  });
  if (!parsedGuard.ok) {
    throw new Error(parsedGuard.messageEn);
  }

  const parsed = parsedGuard.url;
  if (parsed.port && parsed.port !== '443') {
    throw new Error('Only standard HTTPS port 443 is allowed.');
  }

  const host = parsed.hostname.toLowerCase();
  if (allowedHosts && !allowedHosts.has(host)) {
    throw new Error('Target host outside allowed platform domains.');
  }

  if (net.isIP(host)) {
    if (isPrivateOrReservedIp(host)) {
      throw new Error('Direct private/internal IP targets are blocked.');
    }
    return parsed;
  }

  const records = await dns.lookup(host, { all: true });
  if (!records || records.length === 0) {
    throw new Error('DNS lookup returned no addresses.');
  }
  for (const rec of records) {
    if (isPrivateOrReservedIp(rec.address)) {
      throw new Error('Target domain resolved to a blocked private or internal IP address.');
    }
  }

  return parsed;
}

async function readCappedTextSnippet(
  response: Response,
  maxBytes: number
): Promise<{ text: string; bytes: Uint8Array }> {
  if (!response.body) {
    return { text: '', bytes: new Uint8Array(0) };
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const take = Math.min(value.byteLength, maxBytes - total);
      chunks.push(value.subarray(0, take));
      total += take;
      if (total >= maxBytes) {
        await reader.cancel().catch(() => {});
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {
    text: new TextDecoder('utf-8', { fatal: false }).decode(combined),
    bytes: combined,
  };
}

async function safePublicFetch(
  initialUrl: string,
  options: {
    method: 'HEAD' | 'GET';
    headers?: Record<string, string>;
    allowedHosts?: ReadonlySet<string>;
  }
): Promise<{ response: Response; finalUrl: string }> {
  let currentUrl = initialUrl;

  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
    const validatedUrl = await assertPublicRoutableTarget(
      currentUrl,
      options.allowedHosts
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), INSPECT_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(validatedUrl.toString(), {
        method: options.method,
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': 'DELOKEN-MediaInspector/1.0',
          ...(options.headers || {}),
        },
      });
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) {
        return { response: res, finalUrl: validatedUrl.toString() };
      }
      if (hop === MAX_REDIRECT_HOPS) {
        throw new Error('Too many HTTP redirects while inspecting video link.');
      }
      currentUrl = new URL(location, validatedUrl).toString();
      continue;
    }

    return { response: res, finalUrl: validatedUrl.toString() };
  }

  throw new Error('Redirect limit exceeded.');
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d{1,6});/g, (_m, dec) => {
      const cp = Number(dec);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff
        ? String.fromCodePoint(cp)
        : '';
    })
    .replace(/&#x([0-9a-f]{1,6});/gi, (_m, hex) => {
      const cp = parseInt(hex, 16);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff
        ? String.fromCodePoint(cp)
        : '';
    });
}

function resolveValidatedExtractedUrl(rawCandidate: string, baseUrl: string): string | null {
  const decoded = decodeHtmlEntities(rawCandidate.trim())
    .replace(/\\u002F/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/\\u0026/gi, '&')
    .trim();

  if (
    !decoded ||
    decoded.startsWith('data:') ||
    decoded.startsWith('blob:') ||
    decoded.startsWith('javascript:')
  ) {
    return null;
  }

  let absUrl: string;
  try {
    absUrl = new URL(decoded, baseUrl).toString();
  } catch {
    return null;
  }

  const guard = parseStrictHttpsUrl(absUrl, {
    allowBareHostname: false,
    allowLocalHttp: false,
  });
  return guard.ok ? guard.url.toString() : null;
}

function isFrameBlockedByHeaders(headers: Headers): { blocked: boolean; reason?: string } {
  const xfo = (headers.get('x-frame-options') || '').trim().toUpperCase();
  if (xfo === 'DENY' || xfo === 'SAMEORIGIN') {
    return { blocked: true, reason: `X-Frame-Options: ${xfo}` };
  }

  const csp = headers.get('content-security-policy') || '';
  const faMatch = /frame-ancestors\s+([^;]+)/i.exec(csp);
  if (faMatch) {
    const directive = faMatch[1].trim().toLowerCase();
    if (
      directive.includes("'none'") ||
      (directive.includes("'self'") &&
        !directive.includes('*') &&
        !directive.includes('https:'))
    ) {
      return { blocked: true, reason: `CSP frame-ancestors ${directive}` };
    }
    // Restrictive allowlist (without * or https:) blocks external iframe embedding
    if (!directive.includes('*') && !/\bhttps:\b/.test(directive)) {
      return { blocked: true, reason: 'CSP frame-ancestors restricted' };
    }
  }

  return { blocked: false };
}

function extractTagAttr(tag: string, attrName: string): string | null {
  const rx = new RegExp(
    `\\b${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>` + '`]+))',
    'i'
  );
  const match = rx.exec(tag);
  return match ? match[1] ?? match[2] ?? match[3] ?? null : null;
}

function extractMetaContents(html: string, keys: string[]): string[] {
  const out: string[] = [];
  const lowerKeys = new Set(keys.map((k) => k.toLowerCase()));
  const metaRx = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = metaRx.exec(html)) !== null) {
    const tag = m[0];
    const prop = (extractTagAttr(tag, 'property') || extractTagAttr(tag, 'name') || '')
      .trim()
      .toLowerCase();
    if (!prop || !lowerKeys.has(prop)) continue;
    const content = extractTagAttr(tag, 'content');
    if (content && content.trim()) {
      out.push(decodeHtmlEntities(content.trim()));
    }
  }
  return out;
}

function extractHtmlVideoMetadataAndCandidates(
  html: string,
  baseUrl: string
): {
  title?: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  directUrls: string[];
  embedUrls: string[];
} {
  const directSet = new Set<string>();
  const embedSet = new Set<string>();

  const titleCandidates = extractMetaContents(html, ['og:title', 'twitter:title']);
  const titleTagMatch = /<title\b[^>]*>([\s\S]{1,300}?)<\/title>/i.exec(html);
  if (titleTagMatch?.[1]) {
    titleCandidates.push(decodeHtmlEntities(titleTagMatch[1].replace(/\s+/g, ' ').trim()));
  }
  const title = titleCandidates.find((t) => t.length >= 2)?.slice(0, 140);

  let thumbnailUrl: string | undefined;
  const thumbCandidates = extractMetaContents(html, [
    'og:image',
    'og:image:secure_url',
    'twitter:image',
  ]);
  for (const tc of thumbCandidates) {
    const safeThumb = resolveValidatedExtractedUrl(tc, baseUrl);
    if (safeThumb) {
      thumbnailUrl = safeThumb.slice(0, 500);
      break;
    }
  }

  const widthRaw = Number(extractMetaContents(html, ['og:video:width'])[0] || 0);
  const heightRaw = Number(extractMetaContents(html, ['og:video:height'])[0] || 0);
  const width = Number.isFinite(widthRaw) && widthRaw > 0 ? Math.round(widthRaw) : undefined;
  const height = Number.isFinite(heightRaw) && heightRaw > 0 ? Math.round(heightRaw) : undefined;

  const pushDirect = (raw: string) => {
    const resolved = resolveValidatedExtractedUrl(raw, baseUrl);
    if (resolved) directSet.add(resolved);
  };

  const pushEmbed = (raw: string) => {
    const resolved = resolveValidatedExtractedUrl(raw, baseUrl);
    if (!resolved) return;
    try {
      const h = new URL(resolved).hostname.toLowerCase();
      if (IGNORED_IFRAME_HOSTS.has(h)) return;
    } catch {
      return;
    }
    embedSet.add(resolved);
  };

  // 1. <video> & <source> tags
  const videoTagRx = /<(?:video|source)\b[^>]*>/gi;
  let vm: RegExpExecArray | null;
  while ((vm = videoTagRx.exec(html)) !== null) {
    const tag = vm[0];
    const src =
      extractTagAttr(tag, 'src') ||
      extractTagAttr(tag, 'data-src') ||
      extractTagAttr(tag, 'data-hls') ||
      extractTagAttr(tag, 'data-video-src');
    if (src) pushDirect(src);
    if (!thumbnailUrl) {
      const poster = extractTagAttr(tag, 'poster');
      if (poster) {
        const safePoster = resolveValidatedExtractedUrl(poster, baseUrl);
        if (safePoster) thumbnailUrl = safePoster.slice(0, 500);
      }
    }
  }

  // 2. OpenGraph / Twitter meta tags
  const ogVideos = extractMetaContents(html, [
    'og:video',
    'og:video:url',
    'og:video:secure_url',
    'twitter:player:stream',
  ]);
  for (const v of ogVideos) {
    if (/\.(?:mp4|webm|mov|m4v|m3u8|mpd)(?:[?#]|$)/i.test(v)) {
      pushDirect(v);
    } else if (/\.(?:html?|php)(?:[?#]|$)/i.test(v) || /\/embed\//i.test(v)) {
      pushEmbed(v);
    } else {
      pushDirect(v);
      pushEmbed(v);
    }
  }

  for (const tp of extractMetaContents(html, ['twitter:player'])) {
    pushEmbed(tp);
  }

  // 3. JSON-LD <script type="application/ld+json">
  const jsonLdRx =
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let jm: RegExpExecArray | null;
  while ((jm = jsonLdRx.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(jm[1].trim()) as unknown;
      const walk = (node: unknown) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) {
          node.forEach(walk);
          return;
        }
        const rec = node as Record<string, unknown>;
        if (typeof rec.contentUrl === 'string') pushDirect(rec.contentUrl);
        if (typeof rec.embedUrl === 'string') pushEmbed(rec.embedUrl);
        if (!thumbnailUrl && typeof rec.thumbnailUrl === 'string') {
          const safeThumb = resolveValidatedExtractedUrl(rec.thumbnailUrl, baseUrl);
          if (safeThumb) thumbnailUrl = safeThumb.slice(0, 500);
        }
        Object.values(rec).forEach((val) => {
          if (val && typeof val === 'object') walk(val);
        });
      };
      walk(parsed);
    } catch {
      // Ignore malformed JSON-LD blocks
    }
  }

  // 4. Inline .m3u8 / .mpd / .mp4 / .webm URLs inside scripts/attributes
  const inlineMediaRx =
    /https:(?:\/\/|\\\/\\\/)[^\s"'<>\\`]+\.(?:m3u8|mpd|mp4|webm|mov)(?:\?[^\s"'<>\\`]*)?/gi;
  let mm: RegExpExecArray | null;
  while ((mm = inlineMediaRx.exec(html)) !== null) {
    pushDirect(mm[0]);
    if (directSet.size >= 8) break;
  }

  // 5. Embedded <iframe> players
  const iframeRx = /<iframe\b[^>]*>/gi;
  let im: RegExpExecArray | null;
  while ((im = iframeRx.exec(html)) !== null) {
    const src =
      extractTagAttr(im[0], 'src') ||
      extractTagAttr(im[0], 'data-src') ||
      extractTagAttr(im[0], 'data-lazy-src');
    if (src) pushEmbed(src);
    if (embedSet.size >= 8) break;
  }

  return {
    title,
    thumbnailUrl,
    width,
    height,
    directUrls: Array.from(directSet),
    embedUrls: Array.from(embedSet),
  };
}

async function probeOfficialOEmbed(
  oEmbedUrl: string,
  platformLabel: string
): Promise<{
  status: 'ok' | 'blocked' | 'not_found' | 'uncertain';
  httpStatus?: number;
  title?: string;
  authorName?: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  html?: string;
  errorDetail?: string;
}> {
  try {
    const { response } = await safePublicFetch(oEmbedUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    if (response.ok) {
      const snippet = await readCappedTextSnippet(response, MAX_PROBE_BYTES);
      try {
        const parsed = JSON.parse(snippet.text) as {
          title?: string;
          author_name?: string;
          thumbnail_url?: string;
          duration?: number;
          width?: number;
          height?: number;
          html?: string;
        };
        return {
          status: 'ok',
          httpStatus: response.status,
          title: typeof parsed.title === 'string' ? parsed.title.slice(0, 140) : undefined,
          authorName:
            typeof parsed.author_name === 'string'
              ? parsed.author_name.slice(0, 80)
              : undefined,
          thumbnailUrl:
            typeof parsed.thumbnail_url === 'string' &&
            parsed.thumbnail_url.startsWith('https://')
              ? parsed.thumbnail_url.slice(0, 500)
              : undefined,
          durationSeconds:
            typeof parsed.duration === 'number' && Number.isFinite(parsed.duration)
              ? Math.round(parsed.duration)
              : undefined,
          width:
            typeof parsed.width === 'number' && Number.isFinite(parsed.width) && parsed.width > 0
              ? Math.round(parsed.width)
              : undefined,
          height:
            typeof parsed.height === 'number' && Number.isFinite(parsed.height) && parsed.height > 0
              ? Math.round(parsed.height)
              : undefined,
          html: typeof parsed.html === 'string' ? parsed.html : undefined,
        };
      } catch {
        return {
          status: 'uncertain',
          httpStatus: response.status,
          errorDetail: `${platformLabel} returned an unexpected oEmbed response.`,
        };
      }
    }

    if (response.status === 401 || response.status === 403) {
      return { status: 'blocked', httpStatus: response.status };
    }
    if (response.status === 404 || response.status === 400 || response.status === 410) {
      return { status: 'not_found', httpStatus: response.status };
    }
    return { status: 'uncertain', httpStatus: response.status };
  } catch (err) {
    return {
      status: 'uncertain',
      errorDetail: err instanceof Error ? err.message : 'Network timeout during link probe.',
    };
  }
}

function detectDirectFormatFromProbe(
  urlObj: URL,
  contentTypeRaw: string,
  snippetText: string,
  snippetBytes: Uint8Array
): {
  isLikelyVideo: boolean;
  isHtmlPage: boolean;
  directFormat: DirectStreamFormat | undefined;
} {
  const mime = contentTypeRaw.split(';')[0].trim().toLowerCase();
  const trimmedLower = snippetText.trimStart().toLowerCase();
  const isHtmlPage =
    mime === 'text/html' ||
    mime === 'application/xhtml+xml' ||
    trimmedLower.startsWith('<!doctype html') ||
    trimmedLower.startsWith('<html') ||
    trimmedLower.startsWith('<head') ||
    trimmedLower.startsWith('<meta');

  if (isHtmlPage) {
    return { isLikelyVideo: false, isHtmlPage: true, directFormat: undefined };
  }

  if (
    mime === 'application/vnd.apple.mpegurl' ||
    mime === 'application/x-mpegurl' ||
    mime === 'audio/mpegurl' ||
    snippetText.trimStart().startsWith('#EXTM3U')
  ) {
    return { isLikelyVideo: true, isHtmlPage: false, directFormat: 'hls' };
  }

  if (
    mime === 'application/dash+xml' ||
    (snippetText.includes('<MPD') && snippetText.includes('urn:mpeg:dash:schema:mpd'))
  ) {
    return { isLikelyVideo: true, isHtmlPage: false, directFormat: 'dash' };
  }

  const hasMp4Box =
    snippetBytes.byteLength >= 8 &&
    snippetBytes[4] === 0x66 &&
    snippetBytes[5] === 0x74 &&
    snippetBytes[6] === 0x79 &&
    snippetBytes[7] === 0x70; // "ftyp"

  const hasWebmHeader =
    snippetBytes.byteLength >= 4 &&
    snippetBytes[0] === 0x1a &&
    snippetBytes[1] === 0x45 &&
    snippetBytes[2] === 0xdf &&
    snippetBytes[3] === 0xa3;

  if (mime.startsWith('video/') || hasMp4Box || hasWebmHeader) {
    const inferred = inferDirectFormatFromUrl(urlObj) ?? 'mp4';
    return { isLikelyVideo: true, isHtmlPage: false, directFormat: inferred };
  }

  // Some CDNs serve MP4/HLS/DASH as application/octet-stream or binary/octet-stream
  const urlFormat = inferDirectFormatFromUrl(urlObj);
  if (
    urlFormat &&
    (mime === '' || mime === 'application/octet-stream' || mime === 'binary/octet-stream')
  ) {
    return { isLikelyVideo: true, isHtmlPage: false, directFormat: urlFormat };
  }

  return { isLikelyVideo: false, isHtmlPage: false, directFormat: urlFormat ?? undefined };
}

async function inspectHtmlWebPage(
  targetUrl: string,
  depth: number,
  options?: { preferIframe?: boolean }
): Promise<LinkInspectionDiagnostics> {
  try {
    const { response, finalUrl } = await safePublicFetch(targetUrl, {
      method: 'GET',
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    if (!response.ok) {
      return {
        detected: true,
        provider: 'html_embed',
        platformLabel: 'Halaman Web HTML',
        canonicalRef: finalUrl,
        canonicalUrl: finalUrl,
        embedUrl: finalUrl,
        linkStatus: 'unavailable',
        reasonCode: `HTML_HTTP_${response.status}`,
        messageId: `Halaman web HTML gagal diakses (HTTP ${response.status}).`,
        messageEn: `HTML web page returned HTTP ${response.status}.`,
        verifiability: 'conditional',
        verifiabilityNoteId: 'Halaman tidak tersedia.',
        verifiabilityNoteEn: 'Page unavailable.',
      };
    }

    const contentType = response.headers.get('content-type') || '';
    const snippet = await readCappedTextSnippet(response, MAX_HTML_BYTES);

    // If the URL turned out to be a direct media file rather than HTML
    const directCheck = detectDirectFormatFromProbe(
      new URL(finalUrl),
      contentType,
      snippet.text,
      snippet.bytes
    );
    if (!directCheck.isHtmlPage && directCheck.isLikelyVideo && depth < 1) {
      return inspectUniversalVideoLink(finalUrl, depth + 1);
    }

    const frameCheck = isFrameBlockedByHeaders(response.headers);
    const extracted = extractHtmlVideoMetadataAndCandidates(snippet.text, finalUrl);
    const pageAspectHint =
      extracted.width && extracted.height
        ? inferAspectRatioFromUrlOrProvider({
            url: finalUrl,
            width: extracted.width,
            height: extracted.height,
          })
        : undefined;

    if (!options?.preferIframe && depth < 1) {
      // 1. Try extracted direct MP4 / HLS (.m3u8) / MPEG-DASH (.mpd) URLs from HTML
      for (const candidateUrl of extracted.directUrls.slice(0, 3)) {
        if (candidateUrl === finalUrl) continue;
        const inner = await inspectUniversalVideoLink(candidateUrl, depth + 1);
        if (
          inner.detected &&
          inner.provider === 'direct_video' &&
          (inner.linkStatus === 'embeddable' || inner.linkStatus === 'uncertain')
        ) {
          return {
            ...inner,
            platformLabel: `${inner.platformLabel} (Ekstrak HTML)`,
            titleHint: inner.titleHint || extracted.title,
            thumbnailUrl: inner.thumbnailUrl || extracted.thumbnailUrl,
            aspectRatioHint: inner.aspectRatioHint || pageAspectHint,
            messageId: `Video langsung berhasil diekstrak otomatis dari halaman HTML (${inner.directFormat?.toUpperCase() || 'STREAM'}). Klik PREVIEW lalu PLAY untuk verifikasi.`,
            messageEn: `Direct video (${inner.directFormat?.toUpperCase() || 'STREAM'}) automatically extracted from the HTML page. Click PREVIEW then PLAY to verify.`,
          };
        }
      }

      // 2. Try extracted iframe embed URLs from HTML
      for (const embedCandidate of extracted.embedUrls.slice(0, 3)) {
        if (embedCandidate === finalUrl) continue;
        const detectedEmbed = detectVideoSourceFromInput(embedCandidate);
        if (
          detectedEmbed.detected &&
          detectedEmbed.detected.provider !== 'direct_video' &&
          detectedEmbed.detected.provider !== 'html_embed'
        ) {
          const inner = await inspectUniversalVideoLink(embedCandidate, depth + 1);
          if (
            inner.detected &&
            inner.verifiability !== 'unverifiable' &&
            (inner.linkStatus === 'embeddable' || inner.linkStatus === 'uncertain')
          ) {
            return {
              ...inner,
              titleHint: inner.titleHint || extracted.title,
              thumbnailUrl: inner.thumbnailUrl || extracted.thumbnailUrl,
              aspectRatioHint: inner.aspectRatioHint || pageAspectHint,
              messageId: `Pemutar ${inner.platformLabel} ditemukan di dalam halaman HTML. Klik PREVIEW untuk memverifikasi.`,
              messageEn: `${inner.platformLabel} player found embedded inside the HTML page. Click PREVIEW to verify.`,
            };
          }
        } else {
          // Generic iframe player inside the HTML page (e.g. Bunny Stream, PeerTube, Cloudflare iframe)
          try {
            const iframeProbe = await safePublicFetch(embedCandidate, { method: 'HEAD' });
            const iframeFrameCheck = isFrameBlockedByHeaders(iframeProbe.response.headers);
            if (iframeProbe.response.ok && !iframeFrameCheck.blocked) {
              return {
                detected: true,
                provider: 'html_embed',
                platformLabel: 'Pemutar Embed HTML',
                canonicalRef: iframeProbe.finalUrl,
                canonicalUrl: iframeProbe.finalUrl,
                embedUrl: iframeProbe.finalUrl,
                linkStatus: 'embeddable',
                reasonCode: 'HTML_EMBED_IFRAME_EXTRACTED',
                titleHint: extracted.title,
                thumbnailUrl: extracted.thumbnailUrl,
                aspectRatioHint: pageAspectHint,
                messageId:
                  'Pemutar video iframe ditemukan di halaman HTML dan mengizinkan embed. Klik PREVIEW lalu konfirmasi bahwa video dapat diputar.',
                messageEn:
                  'Embedded video player iframe extracted from HTML page with framing allowed. Open PREVIEW and confirm playback.',
                verifiability: 'conditional',
                verifiabilityNoteId:
                  'Iframe pemutar dari halaman HTML berjalan di sandbox aman. Buka Preview lalu klik Konfirmasi jika video terputar.',
                verifiabilityNoteEn:
                  'Extracted player iframe runs in a sandbox. Open Preview and click Confirm once video plays.',
              };
            }
          } catch {
            // Try next candidate
          }
        }
      }
    }

    // 3. Fallback: embed the HTML page itself via sandboxed iframe if framing headers permit
    if (!frameCheck.blocked) {
      return {
        detected: true,
        provider: 'html_embed',
        platformLabel: 'Halaman Web HTML (Embed)',
        canonicalRef: finalUrl,
        canonicalUrl: finalUrl,
        embedUrl: finalUrl,
        linkStatus: 'embeddable',
        reasonCode: 'HTML_PAGE_EMBEDDABLE',
        titleHint: extracted.title,
        thumbnailUrl: extracted.thumbnailUrl,
        aspectRatioHint: pageAspectHint,
        messageId:
          'Halaman web HTML mengizinkan penyematan iframe aman. Buka PREVIEW lalu konfirmasi bahwa video di halaman tersebut tampil & berjalan.',
        messageEn:
          'HTML web page permits sandboxed iframe embedding. Open PREVIEW and confirm the video plays cleanly.',
        verifiability: 'conditional',
        verifiabilityNoteId:
          'Halaman HTML disematkan di iframe terproteksi DELOKEN. Klik PREVIEW dan konfirmasi jika tayangan berhasil diputar.',
        verifiabilityNoteEn:
          'HTML page is embedded in DELOKEN sandboxed iframe. Open PREVIEW and confirm playback.',
      };
    }

    return {
      detected: true,
      provider: 'html_embed',
      platformLabel: 'Halaman Web HTML (Diblokir)',
      canonicalRef: finalUrl,
      canonicalUrl: finalUrl,
      linkStatus: 'unavailable',
      reasonCode: 'HTML_NO_VIDEO_OR_FRAME_BLOCKED',
      titleHint: extracted.title,
      thumbnailUrl: extracted.thumbnailUrl,
      messageId: `Halaman HTML ini tidak memiliki tautan video/stream yang bisa diekstrak dan situs menolak embed iframe (${frameCheck.reason || 'X-Frame-Options / CSP'}). Gunakan tautan langsung (.mp4/.m3u8) atau platform video yang didukung.`,
      messageEn: `This HTML page contains no extractable video/stream URL and blocks iframe embedding (${frameCheck.reason || 'X-Frame-Options / CSP'}). Provide a direct video URL (.mp4/.m3u8) or supported platform link.`,
      verifiability: 'unverifiable',
      verifiabilityNoteId: 'Situs memblokir penyematan iframe dan tidak mengekspos URL video langsung.',
      verifiabilityNoteEn: 'Site blocks iframe embedding and exposes no direct video URL.',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Network error during HTML inspection.';
    const isSecurityBlock =
      msg.toLowerCase().includes('blocked') ||
      msg.toLowerCase().includes('private') ||
      msg.toLowerCase().includes('https');
    return {
      detected: true,
      provider: 'html_embed',
      platformLabel: 'Halaman Web HTML',
      canonicalRef: targetUrl,
      canonicalUrl: targetUrl,
      linkStatus: isSecurityBlock ? 'unavailable' : 'uncertain',
      reasonCode: isSecurityBlock ? 'SSRF_OR_PROTOCOL_BLOCKED' : 'HTML_PROBE_FAILED',
      messageId: isSecurityBlock
        ? `Tautan ditolak kebijakan keamanan: ${msg}`
        : `Gagal memeriksa halaman HTML (${msg}). Anda masih bisa mencoba PREVIEW jika menggunakan awalan html:.`,
      messageEn: isSecurityBlock
        ? `Rejected by security policy: ${msg}`
        : `Unable to inspect HTML page (${msg}).`,
      verifiability: isSecurityBlock ? 'unverifiable' : 'conditional',
      verifiabilityNoteId: 'Pemeriksaan halaman HTML tidak dapat diselesaikan.',
      verifiabilityNoteEn: 'HTML page probe did not complete.',
    };
  }
}

export async function inspectUniversalVideoLink(
  rawUrl: string,
  depth = 0
): Promise<LinkInspectionDiagnostics> {
  const detectedOutcome = detectVideoSourceFromInput(rawUrl);

  if (!detectedOutcome.detected) {
    return {
      detected: false,
      provider: null,
      platformLabel: 'Tidak Dikenal',
      canonicalRef: '',
      canonicalUrl: '',
      linkStatus: 'unavailable',
      reasonCode: detectedOutcome.errorCode || 'UNSUPPORTED_URL',
      messageId:
        detectedOutcome.errorMessageId ||
        'Tautan tidak valid atau platform tidak didukung.',
      messageEn:
        detectedOutcome.errorMessageEn ||
        'Invalid link or unsupported platform.',
      verifiability: 'unverifiable',
      verifiabilityNoteId: 'Tautan tidak dapat ditampilkan.',
      verifiabilityNoteEn: 'Link cannot be embedded or played.',
    };
  }

  const source = detectedOutcome.detected;

  // YouTube / Vimeo / Dailymotion / Streamable (Official oEmbed)
  if (
    source.provider === 'youtube' ||
    source.provider === 'vimeo' ||
    source.provider === 'dailymotion' ||
    source.provider === 'streamable'
  ) {
    const oEmbedEndpoint =
      source.provider === 'youtube'
        ? `https://www.youtube.com/oembed?url=${encodeURIComponent(
            source.canonicalUrl
          )}&format=json`
        : source.provider === 'vimeo'
        ? `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(
            source.canonicalUrl
          )}`
        : source.provider === 'dailymotion'
        ? `https://www.dailymotion.com/services/oembed?url=${encodeURIComponent(
            source.canonicalUrl
          )}&format=json`
        : `https://api.streamable.com/oembed.json?url=${encodeURIComponent(
            source.canonicalUrl
          )}`;

    const probe = await probeOfficialOEmbed(oEmbedEndpoint, source.platformLabel);

    if (probe.status === 'ok') {
      const urlBasedRatio = inferAspectRatioFromUrlOrProvider({
        provider: source.provider,
        url: rawUrl,
        width: probe.width,
        height: probe.height,
      });
      return {
        detected: true,
        provider: source.provider,
        platformLabel: source.platformLabel,
        canonicalRef: source.canonicalRef,
        canonicalUrl: source.canonicalUrl,
        embedUrl: source.embedUrl,
        linkStatus: 'embeddable',
        reasonCode: 'OEMBED_VERIFIED',
        messageId: `${source.platformLabel} mengenali video ini dan mengizinkan embed resmi. Klik PREVIEW lalu PLAY untuk memverifikasi pemutaran nyata.`,
        messageEn: `${source.platformLabel} confirmed official embed availability. Click PREVIEW and then PLAY to verify real playback.`,
        titleHint: probe.title,
        authorHint: probe.authorName,
        thumbnailUrl: probe.thumbnailUrl || source.thumbnailUrl,
        durationSecondsHint: probe.durationSeconds,
        detectedWidth: probe.width,
        detectedHeight: probe.height,
        aspectRatioHint: urlBasedRatio,
        verifiability: source.verifiability,
        verifiabilityNoteId: source.verifiabilityNoteId,
        verifiabilityNoteEn: source.verifiabilityNoteEn,
      };
    }

    if (probe.status === 'blocked') {
      return {
        detected: true,
        provider: source.provider,
        platformLabel: source.platformLabel,
        canonicalRef: source.canonicalRef,
        canonicalUrl: source.canonicalUrl,
        embedUrl: source.embedUrl,
        linkStatus: 'unavailable',
        reasonCode: 'EMBED_DISABLED_BY_OWNER',
        messageId: `${source.platformLabel} menolak penyematan (HTTP ${probe.httpStatus}). Pemilik video menonaktifkan izin embed atau mengatur video menjadi privat.`,
        messageEn: `${source.platformLabel} rejected embedding (HTTP ${probe.httpStatus}). Embedding is disabled by owner or video is private.`,
        thumbnailUrl: source.thumbnailUrl,
        verifiability: source.verifiability,
        verifiabilityNoteId: source.verifiabilityNoteId,
        verifiabilityNoteEn: source.verifiabilityNoteEn,
      };
    }

    if (probe.status === 'not_found') {
      return {
        detected: true,
        provider: source.provider,
        platformLabel: source.platformLabel,
        canonicalRef: source.canonicalRef,
        canonicalUrl: source.canonicalUrl,
        embedUrl: source.embedUrl,
        linkStatus: 'unavailable',
        reasonCode: 'VIDEO_NOT_FOUND_OR_PRIVATE',
        messageId: `Video tidak ditemukan di ${source.platformLabel} atau berstatus privat (HTTP ${probe.httpStatus}).`,
        messageEn: `Video not found on ${source.platformLabel} or marked private (HTTP ${probe.httpStatus}).`,
        verifiability: source.verifiability,
        verifiabilityNoteId: source.verifiabilityNoteId,
        verifiabilityNoteEn: source.verifiabilityNoteEn,
      };
    }

    return {
      detected: true,
      provider: source.provider,
      platformLabel: source.platformLabel,
      canonicalRef: source.canonicalRef,
      canonicalUrl: source.canonicalUrl,
      embedUrl: source.embedUrl,
      linkStatus: 'uncertain',
      reasonCode: 'OEMBED_INCONCLUSIVE',
      messageId: `Format ${source.platformLabel} valid, namun respons pemeriksaan oEmbed belum dapat dipastikan (${probe.httpStatus || probe.errorDetail || 'timeout'}). Anda tetap dapat menekan PREVIEW dan PLAY untuk menguji pemutaran langsung.`,
      messageEn: `${source.platformLabel} link format is valid, but oEmbed probe was inconclusive (${probe.httpStatus || probe.errorDetail || 'timeout'}). You can still press PREVIEW and PLAY to test live playback.`,
      thumbnailUrl: source.thumbnailUrl,
      verifiability: source.verifiability,
      verifiabilityNoteId: source.verifiabilityNoteId,
      verifiabilityNoteEn: source.verifiabilityNoteEn,
    };
  }

  // Google Drive Preview
  if (source.provider === 'google_drive') {
    const info = extractGoogleDriveFileInfo(source.canonicalRef) || extractGoogleDriveFileInfo(rawUrl);
    if (!info) {
      return {
        detected: false,
        provider: null,
        platformLabel: 'Google Drive',
        canonicalRef: '',
        canonicalUrl: '',
        linkStatus: 'unavailable',
        reasonCode: 'INVALID_GDRIVE_ID',
        messageId: 'ID file Google Drive tidak valid.',
        messageEn: 'Invalid Google Drive file ID.',
        verifiability: 'unverifiable',
        verifiabilityNoteId: 'ID Google Drive tidak valid.',
        verifiabilityNoteEn: 'Invalid Google Drive ID.',
      };
    }

    try {
      const { response, finalUrl } = await safePublicFetch(info.embedUrl, { method: 'GET' });
      const snippet = await readCappedTextSnippet(response, MAX_PROBE_BYTES);
      const redirectedToLogin =
        finalUrl.includes('accounts.google.com') || response.status === 401 || response.status === 403;
      if (redirectedToLogin) {
        return {
          detected: true,
          provider: 'google_drive',
          platformLabel: 'Google Drive',
          canonicalRef: info.id,
          canonicalUrl: info.canonicalUrl,
          embedUrl: info.embedUrl,
          linkStatus: 'unavailable',
          reasonCode: 'GDRIVE_PRIVATE_OR_DENIED',
          messageId: 'File Google Drive masih bersifat Privat. Ubah izin berbagi menjadi "Siapa saja yang memiliki link" agar dapat diputar.',
          messageEn: 'Google Drive file is private. Set sharing to "Anyone with the link" to enable playback.',
          verifiability: 'conditional',
          verifiabilityNoteId: source.verifiabilityNoteId,
          verifiabilityNoteEn: source.verifiabilityNoteEn,
        };
      }
      if (response.status === 404) {
        return {
          detected: true,
          provider: 'google_drive',
          platformLabel: 'Google Drive',
          canonicalRef: info.id,
          canonicalUrl: info.canonicalUrl,
          embedUrl: info.embedUrl,
          linkStatus: 'unavailable',
          reasonCode: 'GDRIVE_NOT_FOUND',
          messageId: 'File Google Drive tidak ditemukan atau telah dihapus (HTTP 404).',
          messageEn: 'Google Drive file not found or deleted (HTTP 404).',
          verifiability: 'conditional',
          verifiabilityNoteId: source.verifiabilityNoteId,
          verifiabilityNoteEn: source.verifiabilityNoteEn,
        };
      }
      const titleMatch = /<title\b[^>]*>([\s\S]{1,180}?)<\/title>/i.exec(snippet.text);
      const rawTitle = titleMatch ? decodeHtmlEntities(titleMatch[1]).replace(/\s*-\s*Google Drive$/i, '').trim() : undefined;
      return {
        detected: true,
        provider: 'google_drive',
        platformLabel: 'Google Drive',
        canonicalRef: info.id,
        canonicalUrl: info.canonicalUrl,
        embedUrl: info.embedUrl,
        linkStatus: response.ok ? 'embeddable' : 'uncertain',
        reasonCode: 'GDRIVE_PREVIEW_READY',
        titleHint: rawTitle && rawTitle !== 'Google Drive' ? rawTitle : undefined,
        messageId: 'Tautan Google Drive siap disematkan via Preview Embed. Klik PREVIEW lalu konfirmasi bahwa video berjalan lancar.',
        messageEn: 'Google Drive link is ready for Preview Embed. Click PREVIEW and confirm smooth playback.',
        verifiability: 'conditional',
        verifiabilityNoteId: source.verifiabilityNoteId,
        verifiabilityNoteEn: source.verifiabilityNoteEn,
      };
    } catch {
      return {
        detected: true,
        provider: 'google_drive',
        platformLabel: 'Google Drive',
        canonicalRef: info.id,
        canonicalUrl: info.canonicalUrl,
        embedUrl: info.embedUrl,
        linkStatus: 'uncertain',
        reasonCode: 'GDRIVE_PROBE_UNCERTAIN',
        messageId: 'ID Google Drive valid, namun pemeriksaan server timeout. Tekan PREVIEW untuk menguji langsung.',
        messageEn: 'Google Drive ID is valid, but server check timed out. Press PREVIEW to test directly.',
        verifiability: 'conditional',
        verifiabilityNoteId: source.verifiabilityNoteId,
        verifiabilityNoteEn: source.verifiabilityNoteEn,
      };
    }
  }

  // Internet Archive (auto-upgrades to direct MP4 if metadata lists MP4/WebM!)
  if (source.provider === 'archive_org') {
    const info = extractArchiveOrgInfo(rawUrl) || extractArchiveOrgInfo(`archive_org:${source.canonicalRef}`);
    if (!info) {
      return {
        detected: false,
        provider: null,
        platformLabel: 'Internet Archive',
        canonicalRef: '',
        canonicalUrl: '',
        linkStatus: 'unavailable',
        reasonCode: 'INVALID_ARCHIVE_ID',
        messageId: 'ID item Internet Archive tidak valid.',
        messageEn: 'Invalid Internet Archive item identifier.',
        verifiability: 'unverifiable',
        verifiabilityNoteId: 'ID tidak valid.',
        verifiabilityNoteEn: 'Invalid identifier.',
      };
    }

    try {
      const { response } = await safePublicFetch(info.metadataUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      if (response.ok) {
        const snippet = await readCappedTextSnippet(response, MAX_ARCHIVE_METADATA_BYTES);
        const meta = JSON.parse(snippet.text) as {
          server?: string;
          dir?: string;
          metadata?: {
            title?: string | string[];
            creator?: string | string[];
          };
          files?: Array<{
            name?: string;
            format?: string;
            source?: string;
            width?: string | number;
            height?: string | number;
            length?: string | number;
          }>;
        };

        const titleVal = Array.isArray(meta.metadata?.title)
          ? meta.metadata?.title[0]
          : meta.metadata?.title;
        const authorVal = Array.isArray(meta.metadata?.creator)
          ? meta.metadata?.creator[0]
          : meta.metadata?.creator;

        if (!meta.server || !meta.dir) {
          return {
            detected: true,
            provider: 'archive_org',
            platformLabel: 'Internet Archive',
            canonicalRef: info.id,
            canonicalUrl: info.canonicalUrl,
            embedUrl: info.embedUrl,
            thumbnailUrl: info.thumbnailUrl,
            linkStatus: 'unavailable',
            reasonCode: 'ARCHIVE_NOT_FOUND',
            messageId: 'Item Internet Archive tidak ditemukan atau belum tersedia.',
            messageEn: 'Internet Archive item not found or unavailable.',
            verifiability: 'conditional',
            verifiabilityNoteId: source.verifiabilityNoteId,
            verifiabilityNoteEn: source.verifiabilityNoteEn,
          };
        }

        const files = Array.isArray(meta.files) ? meta.files : [];
        const mp4File =
          files.find((f) => typeof f.name === 'string' && /\.mp4$/i.test(f.name) && (f.format || '').toLowerCase().includes('h.264')) ||
          files.find((f) => typeof f.name === 'string' && /\.(?:mp4|m4v|webm)$/i.test(f.name));

        if (mp4File?.name) {
          const encodedPath = mp4File.name
            .split('/')
            .map((part) => encodeURIComponent(part))
            .join('/');
          const directCandidate = `https://${meta.server}${meta.dir}/${encodedPath}`;
          const guard = parseStrictHttpsUrl(directCandidate, { allowBareHostname: false });
          if (guard.ok) {
            const w = mp4File.width ? Number(mp4File.width) : undefined;
            const h = mp4File.height ? Number(mp4File.height) : undefined;
            const len = mp4File.length ? Math.round(Number(mp4File.length)) : undefined;
            return {
              detected: true,
              provider: 'direct_video',
              platformLabel: 'Internet Archive (MP4 Langsung)',
              canonicalRef: guard.url.toString(),
              canonicalUrl: guard.url.toString(),
              directFormat: 'mp4',
              mimeType: mp4File.name.toLowerCase().endsWith('.webm') ? 'video/webm' : 'video/mp4',
              titleHint: typeof titleVal === 'string' ? titleVal.slice(0, 140) : undefined,
              authorHint: typeof authorVal === 'string' ? authorVal.slice(0, 80) : undefined,
              thumbnailUrl: info.thumbnailUrl,
              durationSecondsHint: len && Number.isFinite(len) && len > 0 ? len : undefined,
              detectedWidth: w && Number.isFinite(w) ? w : undefined,
              detectedHeight: h && Number.isFinite(h) ? h : undefined,
              aspectRatioHint: inferAspectRatioFromUrlOrProvider({
                provider: 'direct_video',
                url: guard.url.toString(),
                width: w,
                height: h,
              }),
              linkStatus: 'embeddable',
              reasonCode: 'ARCHIVE_MP4_UPGRADED',
              messageId: 'Internet Archive terdeteksi dan otomatis dikonversi ke stream MP4 langsung. Klik PREVIEW lalu PLAY untuk verifikasi.',
              messageEn: 'Internet Archive item resolved and upgraded to a direct MP4 stream. Click PREVIEW then PLAY to verify.',
              verifiability: 'verifiable',
              verifiabilityNoteId: 'Menggunakan file MP4 langsung dari Internet Archive (verifikasi penuh HTML5 Video).',
              verifiabilityNoteEn: 'Uses direct MP4 file from Internet Archive (full HTML5 Video verification).',
            };
          }
        }

        return {
          detected: true,
          provider: 'archive_org',
          platformLabel: 'Internet Archive',
          canonicalRef: info.id,
          canonicalUrl: info.canonicalUrl,
          embedUrl: info.embedUrl,
          thumbnailUrl: info.thumbnailUrl,
          titleHint: typeof titleVal === 'string' ? titleVal.slice(0, 140) : undefined,
          authorHint: typeof authorVal === 'string' ? authorVal.slice(0, 80) : undefined,
          linkStatus: 'embeddable',
          reasonCode: 'ARCHIVE_EMBED_READY',
          messageId: 'Item Internet Archive ditemukan dan siap disematkan via Archive.org Embed Player.',
          messageEn: 'Internet Archive item found and ready for Archive.org Embed Player.',
          verifiability: 'conditional',
          verifiabilityNoteId: source.verifiabilityNoteId,
          verifiabilityNoteEn: source.verifiabilityNoteEn,
        };
      }
    } catch {
      // Fallback to embed URL as uncertain
    }

    return {
      detected: true,
      provider: 'archive_org',
      platformLabel: 'Internet Archive',
      canonicalRef: info.id,
      canonicalUrl: info.canonicalUrl,
      embedUrl: info.embedUrl,
      thumbnailUrl: info.thumbnailUrl,
      linkStatus: 'uncertain',
      reasonCode: 'ARCHIVE_PROBE_UNCERTAIN',
      messageId: 'Tautan Internet Archive valid. Klik PREVIEW untuk menguji embed player Archive.org.',
      messageEn: 'Internet Archive link is valid. Click PREVIEW to test the Archive.org embed player.',
      verifiability: 'conditional',
      verifiabilityNoteId: source.verifiabilityNoteId,
      verifiabilityNoteEn: source.verifiabilityNoteEn,
    };
  }

  // Rumble (Official oEmbed API)
  if (source.provider === 'rumble') {
    const info = extractRumbleInfo(rawUrl) || extractRumbleInfo(source.canonicalUrl);
    if (!info) {
      return {
        detected: false,
        provider: null,
        platformLabel: 'Rumble',
        canonicalRef: '',
        canonicalUrl: '',
        linkStatus: 'unavailable',
        reasonCode: 'INVALID_RUMBLE_URL',
        messageId: 'Tautan Rumble tidak valid.',
        messageEn: 'Invalid Rumble URL.',
        verifiability: 'unverifiable',
        verifiabilityNoteId: 'Tautan tidak valid.',
        verifiabilityNoteEn: 'Invalid URL.',
      };
    }

    const probe = await probeOfficialOEmbed(
      `https://rumble.com/api/Media/oembed.json?url=${encodeURIComponent(info.canonicalUrl)}`,
      'Rumble'
    );

    let extractedEmbed = info.embedUrl;
    if (probe.html) {
      const srcMatch = /src=["'](https:\/\/rumble\.com\/embed\/[^"']+)["']/i.exec(probe.html);
      if (srcMatch?.[1]) {
        const guard = parseStrictHttpsUrl(srcMatch[1], { allowBareHostname: false });
        if (guard.ok) extractedEmbed = guard.url.toString();
      }
    }

    if (probe.status === 'ok' && extractedEmbed) {
      return {
        detected: true,
        provider: 'rumble',
        platformLabel: 'Rumble',
        canonicalRef: extractedEmbed,
        canonicalUrl: info.canonicalUrl,
        embedUrl: extractedEmbed,
        titleHint: probe.title,
        authorHint: probe.authorName,
        thumbnailUrl: probe.thumbnailUrl,
        detectedWidth: probe.width,
        detectedHeight: probe.height,
        aspectRatioHint: inferAspectRatioFromUrlOrProvider({
          provider: 'rumble',
          url: info.canonicalUrl,
          width: probe.width,
          height: probe.height,
        }),
        linkStatus: 'embeddable',
        reasonCode: 'RUMBLE_OEMBED_VERIFIED',
        messageId: 'Rumble oEmbed mengembalikan pemutar video resmi. Klik PREVIEW lalu konfirmasi bahwa video dapat diputar.',
        messageEn: 'Rumble oEmbed returned an official embed player. Click PREVIEW and confirm playback.',
        verifiability: 'conditional',
        verifiabilityNoteId: source.verifiabilityNoteId,
        verifiabilityNoteEn: source.verifiabilityNoteEn,
      };
    }

    return {
      detected: true,
      provider: 'rumble',
      platformLabel: 'Rumble',
      canonicalRef: extractedEmbed || info.canonicalRef,
      canonicalUrl: info.canonicalUrl,
      embedUrl: extractedEmbed,
      linkStatus: probe.status === 'not_found' || probe.status === 'blocked' ? 'unavailable' : 'uncertain',
      reasonCode: probe.status === 'not_found' ? 'RUMBLE_NOT_FOUND' : 'RUMBLE_OEMBED_UNCERTAIN',
      messageId:
        probe.status === 'not_found'
          ? 'Video Rumble tidak ditemukan atau privat.'
          : 'Pemeriksaan Rumble oEmbed belum pasti. Anda bisa mencoba PREVIEW jika URL embed tersedia.',
      messageEn:
        probe.status === 'not_found'
          ? 'Rumble video not found or private.'
          : 'Rumble oEmbed check was inconclusive.',
      verifiability: 'conditional',
      verifiabilityNoteId: source.verifiabilityNoteId,
      verifiabilityNoteEn: source.verifiabilityNoteEn,
    };
  }

  // Loom (Official oEmbed API)
  if (source.provider === 'loom') {
    const info = extractLoomInfo(rawUrl) || extractLoomInfo(`loom:${source.canonicalRef}`);
    if (!info) {
      return {
        detected: false,
        provider: null,
        platformLabel: 'Loom',
        canonicalRef: '',
        canonicalUrl: '',
        linkStatus: 'unavailable',
        reasonCode: 'INVALID_LOOM_URL',
        messageId: 'Tautan Loom tidak valid.',
        messageEn: 'Invalid Loom URL.',
        verifiability: 'unverifiable',
        verifiabilityNoteId: 'Tautan tidak valid.',
        verifiabilityNoteEn: 'Invalid URL.',
      };
    }

    const probe = await probeOfficialOEmbed(
      `https://www.loom.com/v1/oembed?url=${encodeURIComponent(info.canonicalUrl)}`,
      'Loom'
    );

    if (probe.status === 'not_found' || probe.status === 'blocked') {
      return {
        detected: true,
        provider: 'loom',
        platformLabel: 'Loom',
        canonicalRef: info.id,
        canonicalUrl: info.canonicalUrl,
        embedUrl: info.embedUrl,
        linkStatus: 'unavailable',
        reasonCode: 'LOOM_UNAVAILABLE',
        messageId: `Video Loom tidak ditemukan atau berstatus privat (HTTP ${probe.httpStatus}).`,
        messageEn: `Loom video unavailable or private (HTTP ${probe.httpStatus}).`,
        verifiability: 'conditional',
        verifiabilityNoteId: source.verifiabilityNoteId,
        verifiabilityNoteEn: source.verifiabilityNoteEn,
      };
    }

    return {
      detected: true,
      provider: 'loom',
      platformLabel: 'Loom',
      canonicalRef: info.id,
      canonicalUrl: info.canonicalUrl,
      embedUrl: info.embedUrl,
      titleHint: probe.title,
      authorHint: probe.authorName,
      thumbnailUrl: probe.thumbnailUrl,
      durationSecondsHint: probe.durationSeconds,
      detectedWidth: probe.width,
      detectedHeight: probe.height,
      aspectRatioHint: inferAspectRatioFromUrlOrProvider({
        provider: 'loom',
        url: info.canonicalUrl,
        width: probe.width,
        height: probe.height,
      }),
      linkStatus: probe.status === 'ok' ? 'embeddable' : 'uncertain',
      reasonCode: probe.status === 'ok' ? 'LOOM_OEMBED_VERIFIED' : 'LOOM_OEMBED_UNCERTAIN',
      messageId: 'Video Loom siap diputar lewat Loom Embed Player. Buka PREVIEW dan konfirmasi pemutaran.',
      messageEn: 'Loom video ready via Loom Embed Player. Open PREVIEW and confirm playback.',
      verifiability: 'conditional',
      verifiabilityNoteId: source.verifiabilityNoteId,
      verifiabilityNoteEn: source.verifiabilityNoteEn,
    };
  }

  // Twitch (VOD, Clip, or Live Channel — client dynamically binds ?parent=hostname)
  if (source.provider === 'twitch') {
    const info = extractTwitchRef(rawUrl) || extractTwitchRef(source.canonicalRef);
    if (!info) {
      return {
        detected: false,
        provider: null,
        platformLabel: 'Twitch',
        canonicalRef: '',
        canonicalUrl: '',
        linkStatus: 'unavailable',
        reasonCode: 'INVALID_TWITCH_URL',
        messageId: 'Tautan Twitch tidak valid.',
        messageEn: 'Invalid Twitch URL.',
        verifiability: 'unverifiable',
        verifiabilityNoteId: 'Tautan tidak valid.',
        verifiabilityNoteEn: 'Invalid URL.',
      };
    }

    let titleHint: string | undefined;
    let thumbnailUrl: string | undefined;
    try {
      const { response } = await safePublicFetch(info.canonicalUrl, { method: 'GET' });
      if (response.ok) {
        const snippet = await readCappedTextSnippet(response, 64 * 1024);
        const extracted = extractHtmlVideoMetadataAndCandidates(snippet.text, info.canonicalUrl);
        titleHint = extracted.title?.replace(/\s*-\s*Twitch$/i, '').trim();
        thumbnailUrl = extracted.thumbnailUrl;
      }
    } catch {
      // Metadata optional for Twitch embed
    }

    return {
      detected: true,
      provider: 'twitch',
      platformLabel: 'Twitch',
      canonicalRef: info.canonicalRef,
      canonicalUrl: info.canonicalUrl,
      titleHint,
      thumbnailUrl,
      linkStatus: 'embeddable',
      reasonCode: 'TWITCH_EMBED_READY',
      messageId: 'Tautan Twitch terdeteksi (VOD/Clip/Channel). Klik PREVIEW lalu konfirmasi bahwa player Twitch berjalan.',
      messageEn: 'Twitch link detected. Click PREVIEW and confirm Twitch player playback.',
      verifiability: 'conditional',
      verifiabilityNoteId: source.verifiabilityNoteId,
      verifiabilityNoteEn: source.verifiabilityNoteEn,
    };
  }

  // Odysee (LBRY)
  if (source.provider === 'odysee') {
    const info = extractOdyseeInfo(rawUrl) || extractOdyseeInfo(source.canonicalUrl);
    if (!info) {
      return {
        detected: false,
        provider: null,
        platformLabel: 'Odysee',
        canonicalRef: '',
        canonicalUrl: '',
        linkStatus: 'unavailable',
        reasonCode: 'INVALID_ODYSEE_URL',
        messageId: 'Tautan Odysee tidak valid.',
        messageEn: 'Invalid Odysee URL.',
        verifiability: 'unverifiable',
        verifiabilityNoteId: 'Tautan tidak valid.',
        verifiabilityNoteEn: 'Invalid URL.',
      };
    }

    let titleHint: string | undefined;
    let thumbnailUrl: string | undefined;
    try {
      const { response } = await safePublicFetch(info.canonicalUrl, { method: 'GET' });
      if (response.status === 404) {
        return {
          detected: true,
          provider: 'odysee',
          platformLabel: 'Odysee',
          canonicalRef: info.canonicalRef,
          canonicalUrl: info.canonicalUrl,
          embedUrl: info.embedUrl,
          linkStatus: 'unavailable',
          reasonCode: 'ODYSEE_NOT_FOUND',
          messageId: 'Video Odysee tidak ditemukan (HTTP 404).',
          messageEn: 'Odysee video not found (HTTP 404).',
          verifiability: 'conditional',
          verifiabilityNoteId: source.verifiabilityNoteId,
          verifiabilityNoteEn: source.verifiabilityNoteEn,
        };
      }
      if (response.ok) {
        const snippet = await readCappedTextSnippet(response, 96 * 1024);
        const extracted = extractHtmlVideoMetadataAndCandidates(snippet.text, info.canonicalUrl);
        titleHint = extracted.title;
        thumbnailUrl = extracted.thumbnailUrl;
      }
    } catch {
      // Metadata probe optional; embedUrl still works
    }

    return {
      detected: true,
      provider: 'odysee',
      platformLabel: 'Odysee',
      canonicalRef: info.canonicalRef,
      canonicalUrl: info.canonicalUrl,
      embedUrl: info.embedUrl,
      titleHint,
      thumbnailUrl,
      linkStatus: 'embeddable',
      reasonCode: 'ODYSEE_EMBED_READY',
      messageId: 'Tautan Odysee siap disematkan via Odysee Player. Buka PREVIEW dan konfirmasi pemutaran.',
      messageEn: 'Odysee video ready via Odysee Player. Open PREVIEW and confirm playback.',
      verifiability: 'conditional',
      verifiabilityNoteId: source.verifiabilityNoteId,
      verifiabilityNoteEn: source.verifiabilityNoteEn,
    };
  }

  // Bilibili
  if (source.provider === 'bilibili') {
    const info = extractBilibiliInfo(rawUrl) || extractBilibiliInfo(source.canonicalUrl);
    if (!info) {
      return {
        detected: false,
        provider: null,
        platformLabel: 'Bilibili',
        canonicalRef: '',
        canonicalUrl: '',
        linkStatus: 'unavailable',
        reasonCode: 'INVALID_BILIBILI_URL',
        messageId: 'Tautan Bilibili tidak valid.',
        messageEn: 'Invalid Bilibili URL.',
        verifiability: 'unverifiable',
        verifiabilityNoteId: 'Tautan tidak valid.',
        verifiabilityNoteEn: 'Invalid URL.',
      };
    }

    if (info.kind === 'tv' && depth < 1) {
      return inspectHtmlWebPage(info.canonicalUrl, depth);
    }

    let titleHint: string | undefined;
    let thumbnailUrl: string | undefined;
    try {
      const { response } = await safePublicFetch(info.canonicalUrl, { method: 'GET' });
      if (response.ok) {
        const snippet = await readCappedTextSnippet(response, 64 * 1024);
        const extracted = extractHtmlVideoMetadataAndCandidates(snippet.text, info.canonicalUrl);
        titleHint = extracted.title;
        thumbnailUrl = extracted.thumbnailUrl;
      }
    } catch {
      // Ignore metadata error
    }

    return {
      detected: true,
      provider: 'bilibili',
      platformLabel: 'Bilibili',
      canonicalRef: info.canonicalRef,
      canonicalUrl: info.canonicalUrl,
      embedUrl: info.embedUrl,
      titleHint,
      thumbnailUrl,
      linkStatus: 'embeddable',
      reasonCode: 'BILIBILI_EMBED_READY',
      messageId: 'Video Bilibili siap diputar via Bilibili Embed Player. Klik PREVIEW dan konfirmasi pemutaran.',
      messageEn: 'Bilibili video ready via Bilibili Embed Player. Click PREVIEW and confirm playback.',
      verifiability: 'conditional',
      verifiabilityNoteId: source.verifiabilityNoteId,
      verifiabilityNoteEn: source.verifiabilityNoteEn,
    };
  }

  // Explicit html:https://... prefix -> HTML page embed / extractor
  if (source.provider === 'html_embed') {
    return inspectHtmlWebPage(source.canonicalUrl, depth, { preferIframe: true });
  }

  // TikTok
  if (source.provider === 'tiktok') {
    let resolvedUrl = source.canonicalUrl;
    let resolvedRef = source.canonicalRef;
    let resolvedEmbedUrl = source.embedUrl;

    if (!resolvedEmbedUrl) {
      try {
        const redirectRes = await safePublicFetch(source.canonicalUrl, {
          method: 'HEAD',
          allowedHosts: TIKTOK_ALLOWED_HOSTS,
        });
        const resolvedInfo = extractTikTokVideoInfo(redirectRes.finalUrl);
        if (resolvedInfo?.videoId) {
          resolvedUrl = resolvedInfo.canonicalUrl;
          resolvedRef = resolvedInfo.canonicalRef;
          resolvedEmbedUrl = `https://www.tiktok.com/player/v1/${resolvedInfo.videoId}?autoplay=0&controls=1`;
        }
      } catch {
        // Fallback to original canonical URL
      }
    }

    const probe = await probeOfficialOEmbed(
      `https://www.tiktok.com/oembed?url=${encodeURIComponent(resolvedUrl)}`,
      'TikTok'
    );

    if (probe.status === 'ok') {
      return {
        detected: true,
        provider: 'tiktok',
        platformLabel: 'TikTok',
        canonicalRef: resolvedRef,
        canonicalUrl: resolvedUrl,
        embedUrl: resolvedEmbedUrl,
        linkStatus: resolvedEmbedUrl ? 'embeddable' : 'uncertain',
        reasonCode: resolvedEmbedUrl ? 'OEMBED_VERIFIED' : 'SHORT_URL_NO_VIDEO_ID',
        messageId: resolvedEmbedUrl
          ? 'TikTok mengembalikan metadata embed resmi. Klik PREVIEW lalu PLAY atau konfirmasi pemutaran jika video sudah tampil.'
          : 'Tautan pendek TikTok ditemukan, namun ID numerik video belum berhasil diurai untuk player embed.',
        messageEn: resolvedEmbedUrl
          ? 'TikTok returned official embed metadata. Click PREVIEW then PLAY or confirm playback.'
          : 'TikTok short URL resolved metadata, but numeric video ID could not be extracted for embed playback.',
        titleHint: probe.title,
        authorHint: probe.authorName,
        thumbnailUrl: probe.thumbnailUrl,
        detectedWidth: probe.width,
        detectedHeight: probe.height,
        aspectRatioHint: inferAspectRatioFromUrlOrProvider({
          provider: 'tiktok',
          url: resolvedUrl,
          width: probe.width,
          height: probe.height,
        }),
        verifiability: source.verifiability,
        verifiabilityNoteId: source.verifiabilityNoteId,
        verifiabilityNoteEn: source.verifiabilityNoteEn,
      };
    }

    if (probe.status === 'not_found') {
      return {
        detected: true,
        provider: 'tiktok',
        platformLabel: 'TikTok',
        canonicalRef: resolvedRef,
        canonicalUrl: resolvedUrl,
        embedUrl: resolvedEmbedUrl,
        linkStatus: 'unavailable',
        reasonCode: 'TIKTOK_UNAVAILABLE',
        messageId: 'Video TikTok tidak ditemukan, privat, atau penyematan dinonaktifkan.',
        messageEn: 'TikTok video is unavailable, private, or embedding is disabled.',
        verifiability: source.verifiability,
        verifiabilityNoteId: source.verifiabilityNoteId,
        verifiabilityNoteEn: source.verifiabilityNoteEn,
      };
    }

    return {
      detected: true,
      provider: 'tiktok',
      platformLabel: 'TikTok',
      canonicalRef: resolvedRef,
      canonicalUrl: resolvedUrl,
      embedUrl: resolvedEmbedUrl,
      linkStatus: 'uncertain',
      reasonCode: 'TIKTOK_OEMBED_UNCERTAIN',
      messageId:
        'Pemeriksaan TikTok belum dapat dipastikan karena pembatasan jaringan/API platform. Anda bisa mencoba PREVIEW untuk melihat perilaku embed.',
      messageEn:
        'TikTok embed support could not be confirmed due to network/platform restrictions. You can still test PREVIEW.',
      verifiability: source.verifiability,
      verifiabilityNoteId: source.verifiabilityNoteId,
      verifiabilityNoteEn: source.verifiabilityNoteEn,
    };
  }

  // X (Twitter)
  if (source.provider === 'x') {
    const probe = await probeOfficialOEmbed(
      `https://publish.twitter.com/oembed?url=${encodeURIComponent(
        source.canonicalUrl
      )}&omit_script=true`,
      'X (Twitter)'
    );

    if (probe.status === 'ok') {
      return {
        detected: true,
        provider: 'x',
        platformLabel: 'X (Twitter)',
        canonicalRef: source.canonicalRef,
        canonicalUrl: source.canonicalUrl,
        linkStatus: 'embeddable',
        reasonCode: 'OEMBED_POST_FOUND',
        messageId:
          'Postingan X ditemukan melalui oEmbed resmi. Catatan: X tidak menyediakan konfirmasi status pemutaran video lintas-domain yang dapat diverifikasi.',
        messageEn:
          'X post confirmed via official oEmbed. Note: X does not provide verifiable cross-origin video playback state.',
        authorHint: probe.authorName,
        verifiability: 'unverifiable',
        verifiabilityNoteId: source.verifiabilityNoteId,
        verifiabilityNoteEn: source.verifiabilityNoteEn,
      };
    }

    if (probe.status === 'not_found' || probe.status === 'blocked') {
      return {
        detected: true,
        provider: 'x',
        platformLabel: 'X (Twitter)',
        canonicalRef: source.canonicalRef,
        canonicalUrl: source.canonicalUrl,
        linkStatus: 'unavailable',
        reasonCode: 'X_POST_UNAVAILABLE',
        messageId: `Postingan X tidak ditemukan atau bersifat privat (HTTP ${probe.httpStatus}).`,
        messageEn: `X post not found or protected (HTTP ${probe.httpStatus}).`,
        verifiability: 'unverifiable',
        verifiabilityNoteId: source.verifiabilityNoteId,
        verifiabilityNoteEn: source.verifiabilityNoteEn,
      };
    }

    return {
      detected: true,
      provider: 'x',
      platformLabel: 'X (Twitter)',
      canonicalRef: source.canonicalRef,
      canonicalUrl: source.canonicalUrl,
      linkStatus: 'uncertain',
      reasonCode: 'X_OEMBED_UNCERTAIN',
      messageId:
        'Pemeriksaan oEmbed X belum dapat dipastikan karena batas akses jaringan/platform.',
      messageEn: 'X oEmbed verification was inconclusive due to network or platform limits.',
      verifiability: 'unverifiable',
      verifiabilityNoteId: source.verifiabilityNoteId,
      verifiabilityNoteEn: source.verifiabilityNoteEn,
    };
  }

  if (source.provider === 'facebook' || source.provider === 'instagram') {
    return {
      detected: true,
      provider: source.provider,
      platformLabel: source.platformLabel,
      canonicalRef: source.canonicalRef,
      canonicalUrl: source.canonicalUrl,
      embedUrl: source.embedUrl,
      aspectRatioHint: inferAspectRatioFromUrlOrProvider({
        provider: source.provider,
        url: rawUrl,
      }),
      linkStatus: 'uncertain',
      reasonCode: 'PLATFORM_NO_PUBLIC_OEMBED',
      messageId: `Tautan ${source.platformLabel} dikenali, tetapi ketersediaan privasi dan status putar lintas-domain tidak dapat dipastikan dari server. Anda dapat mencoba PREVIEW, namun pemutaran di iframe ${source.platformLabel} tidak dapat diverifikasi oleh sistem.`,
      messageEn: `${source.platformLabel} URL recognized, but privacy and cross-origin playback cannot be verified automatically. You may try PREVIEW, though playback inside ${source.platformLabel} iframe cannot be confirmed.`,
      verifiability: 'unverifiable',
      verifiabilityNoteId: source.verifiabilityNoteId,
      verifiabilityNoteEn: source.verifiabilityNoteEn,
    };
  }

  // Direct Video / HLS (.m3u8) / MPEG-DASH (.mpd) / Dropbox / Generic Web HTML Page
  try {
    let headResult = await safePublicFetch(source.canonicalUrl, {
      method: 'HEAD',
    });

    if (
      headResult.response.status === 405 ||
      headResult.response.status === 403 ||
      headResult.response.status === 501
    ) {
      headResult = await safePublicFetch(source.canonicalUrl, {
        method: 'GET',
        headers: { Range: 'bytes=0-2047' },
      });
    }

    const res = headResult.response;
    const finalParsed = new URL(headResult.finalUrl);

    if (!res.ok) {
      return {
        detected: true,
        provider: 'direct_video',
        platformLabel: source.platformLabel,
        canonicalRef: headResult.finalUrl,
        canonicalUrl: headResult.finalUrl,
        directFormat: source.directFormat,
        linkStatus: 'unavailable',
        reasonCode: `DIRECT_HTTP_${res.status}`,
        messageId:
          res.status === 401 || res.status === 403
            ? `Akses ke file video ditolak atau URL kedaluwarsa (HTTP ${res.status}).`
            : `Tautan video/web gagal diakses (HTTP ${res.status}).`,
        messageEn:
          res.status === 401 || res.status === 403
            ? `Direct video access denied or link expired (HTTP ${res.status}).`
            : `Direct video or web URL returned HTTP ${res.status}.`,
        verifiability: 'verifiable',
        verifiabilityNoteId: source.verifiabilityNoteId,
        verifiabilityNoteEn: source.verifiabilityNoteEn,
      };
    }

    const contentType = res.headers.get('content-type') || '';
    const contentLengthHeader = res.headers.get('content-length');
    const acceptRanges = res.headers.get('accept-ranges') || '';
    const acao = res.headers.get('access-control-allow-origin');

    // If HEAD already announces text/html -> route immediately to full HTML extractor / iframe probe!
    const mimeLower = contentType.split(';')[0].trim().toLowerCase();
    if (mimeLower === 'text/html' || mimeLower === 'application/xhtml+xml') {
      return inspectHtmlWebPage(headResult.finalUrl, depth);
    }

    let snippetText = '';
    let snippetBytes: Uint8Array = new Uint8Array(0);
    if (
      contentType.includes('mpegurl') ||
      contentType.includes('dash+xml') ||
      !contentType ||
      contentType.includes('octet-stream')
    ) {
      try {
        const rangeRes = await safePublicFetch(headResult.finalUrl, {
          method: 'GET',
          headers: { Range: 'bytes=0-4095' },
        });
        if (rangeRes.response.ok) {
          const snip = await readCappedTextSnippet(rangeRes.response, MAX_PROBE_BYTES);
          snippetText = snip.text;
          snippetBytes = snip.bytes;
        }
      } catch {
        // Proceed with HEAD headers
      }
    }

    const formatInspection = detectDirectFormatFromProbe(
      finalParsed,
      contentType,
      snippetText,
      snippetBytes
    );

    if (formatInspection.isHtmlPage) {
      return inspectHtmlWebPage(headResult.finalUrl, depth);
    }

    if (!formatInspection.isLikelyVideo) {
      return {
        detected: true,
        provider: 'direct_video',
        platformLabel: 'URL Bukan Media Video',
        canonicalRef: headResult.finalUrl,
        canonicalUrl: headResult.finalUrl,
        linkStatus: 'unavailable',
        reasonCode: 'UNSUPPORTED_MIME_TYPE',
        mimeType: contentType.split(';')[0].trim() || undefined,
        messageId: `Tipe media server (${contentType || 'tidak diketahui'}) tidak dikenali sebagai format video, halaman HTML, atau manifest streaming yang didukung.`,
        messageEn: `Server media type (${contentType || 'unknown'}) is not a supported video, HTML page, or streaming manifest format.`,
        verifiability: 'verifiable',
        verifiabilityNoteId: source.verifiabilityNoteId,
        verifiabilityNoteEn: source.verifiabilityNoteEn,
      };
    }

    const resolvedFormat = formatInspection.directFormat || 'mp4';
    const needsCorsForXhr = resolvedFormat === 'hls' || resolvedFormat === 'dash';
    const corsReady = acao ? acao.trim().length > 0 : null;

    const labelByFormat =
      resolvedFormat === 'hls'
        ? 'Direct Stream (HLS .m3u8)'
        : resolvedFormat === 'dash'
        ? 'Direct Stream (MPEG-DASH .mpd)'
        : source.platformLabel.includes('Dropbox')
        ? 'Dropbox Direct Video'
        : 'Direct Video (MP4 / WebM / MOV)';

    if (needsCorsForXhr && corsReady === null) {
      return {
        detected: true,
        provider: 'direct_video',
        platformLabel: labelByFormat,
        canonicalRef: headResult.finalUrl,
        canonicalUrl: headResult.finalUrl,
        directFormat: resolvedFormat,
        mimeType: contentType.split(';')[0].trim() || undefined,
        contentLength: contentLengthHeader ? Number(contentLengthHeader) : undefined,
        supportsRange: acceptRanges.toLowerCase().includes('bytes') || res.status === 206,
        corsReady: false,
        linkStatus: 'uncertain',
        reasonCode: 'MISSING_CORS_HEADER_FOR_MANIFEST',
        messageId: `${labelByFormat} ditemukan, namun header CORS (Access-Control-Allow-Origin) tidak terdeteksi. Klik PREVIEW lalu PLAY untuk menguji apakah browser mengizinkan pemutarannya.`,
        messageEn: `${labelByFormat} detected, but Access-Control-Allow-Origin header was not present. Click PREVIEW and PLAY to test browser playback.`,
        verifiability: 'verifiable',
        verifiabilityNoteId: source.verifiabilityNoteId,
        verifiabilityNoteEn: source.verifiabilityNoteEn,
      };
    }

    return {
      detected: true,
      provider: 'direct_video',
      platformLabel: labelByFormat,
      canonicalRef: headResult.finalUrl,
      canonicalUrl: headResult.finalUrl,
      directFormat: resolvedFormat,
      mimeType: contentType.split(';')[0].trim() || undefined,
      contentLength: contentLengthHeader ? Number(contentLengthHeader) : undefined,
      supportsRange: acceptRanges.toLowerCase().includes('bytes') || res.status === 206,
      corsReady: corsReady ?? true,
      linkStatus: 'embeddable',
      reasonCode: 'DIRECT_MEDIA_READY',
      messageId: `${labelByFormat} valid (${contentType.split(';')[0].trim() || 'stream ready'}). Klik PREVIEW lalu PLAY untuk memverifikasi pemutaran di browser Anda.`,
      messageEn: `${labelByFormat} verified (${contentType.split(';')[0].trim() || 'stream ready'}). Click PREVIEW and PLAY to confirm browser playback.`,
      verifiability: 'verifiable',
      verifiabilityNoteId: source.verifiabilityNoteId,
      verifiabilityNoteEn: source.verifiabilityNoteEn,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Network error during media inspection.';
    const isBlockedIp =
      msg.toLowerCase().includes('blocked') ||
      msg.toLowerCase().includes('private') ||
      msg.toLowerCase().includes('https');
    return {
      detected: true,
      provider: 'direct_video',
      platformLabel: source.platformLabel,
      canonicalRef: source.canonicalRef,
      canonicalUrl: source.canonicalUrl,
      directFormat: source.directFormat,
      linkStatus: isBlockedIp ? 'unavailable' : 'uncertain',
      reasonCode: isBlockedIp ? 'SSRF_OR_PROTOCOL_BLOCKED' : 'DIRECT_PROBE_TIMEOUT_OR_ERROR',
      messageId: isBlockedIp
        ? `Tautan ditolak oleh kebijakan keamanan: ${msg}`
        : `Pemeriksaan server belum dapat memastikan tautan ini (${msg}). Anda masih bisa menekan PREVIEW dan PLAY untuk menguji langsung di browser.`,
      messageEn: isBlockedIp
        ? `Rejected by security policy: ${msg}`
        : `Server probe could not confirm this URL (${msg}). You can still test PREVIEW and PLAY directly in your browser.`,
      verifiability: 'verifiable',
      verifiabilityNoteId: source.verifiabilityNoteId,
      verifiabilityNoteEn: source.verifiabilityNoteEn,
    };
  }
}
