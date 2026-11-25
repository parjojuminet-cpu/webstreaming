import dns from 'node:dns/promises';
import net from 'node:net';
import {
  extractTikTokVideoInfo,
  inferDirectFormatFromUrl,
} from '../src/services/videoImport/adapters.ts';
import { detectVideoSourceFromInput } from '../src/services/videoImport/registry.ts';
import type { LinkInspectionDiagnostics } from '../src/services/videoImport/types.ts';
import { parseStrictHttpsUrl } from '../src/services/videoImport/urlGuards.ts';
import type { DirectStreamFormat } from '../src/types/vyora';

const INSPECT_TIMEOUT_MS = 7000;
const MAX_REDIRECT_HOPS = 3;
const MAX_PROBE_BYTES = 32 * 1024;

const TIKTOK_ALLOWED_HOSTS = new Set([
  'tiktok.com',
  'www.tiktok.com',
  'm.tiktok.com',
  'vt.tiktok.com',
  'vm.tiktok.com',
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
  const isHtmlPage =
    mime === 'text/html' ||
    mime === 'application/xhtml+xml' ||
    snippetText.trimStart().toLowerCase().startsWith('<!doctype html') ||
    snippetText.trimStart().toLowerCase().startsWith('<html');

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

  if (
    mime.startsWith('video/') ||
    hasMp4Box ||
    hasWebmHeader
  ) {
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

export async function inspectUniversalVideoLink(
  rawUrl: string
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

  if (source.provider === 'tiktok') {
    let resolvedUrl = source.canonicalUrl;
    let resolvedRef = source.canonicalRef;
    let resolvedEmbedUrl = source.embedUrl;

    // Safely resolve vm.tiktok.com / vt.tiktok.com short links within TikTok allowlist
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
          ? 'TikTok mengembalikan metadata embed resmi. Klik PREVIEW lalu PLAY — sistem akan jujur melaporkan apakah player TikTok mengirim status putar nyata.'
          : 'Tautan pendek TikTok ditemukan, namun ID numerik video belum berhasil diurai untuk player embed.',
        messageEn: resolvedEmbedUrl
          ? 'TikTok returned official embed metadata. Click PREVIEW then PLAY — the player will verify whether TikTok emits real playback events.'
          : 'TikTok short URL resolved metadata, but numeric video ID could not be extracted for embed playback.',
        titleHint: probe.title,
        authorHint: probe.authorName,
        thumbnailUrl: probe.thumbnailUrl,
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
      linkStatus: 'uncertain',
      reasonCode: 'PLATFORM_NO_PUBLIC_OEMBED',
      messageId: `Tautan ${source.platformLabel} dikenali, tetapi ketersediaan privasi dan status putar lintas-domain tidak dapat dipastikan dari server. Anda dapat mencoba PREVIEW, namun pemutaran di iframe ${source.platformLabel} tidak dapat diverifikasi oleh sistem.`,
      messageEn: `${source.platformLabel} URL recognized, but privacy and cross-origin playback cannot be verified automatically. You may try PREVIEW, though playback inside ${source.platformLabel} iframe cannot be confirmed.`,
      verifiability: 'unverifiable',
      verifiabilityNoteId: source.verifiabilityNoteId,
      verifiabilityNoteEn: source.verifiabilityNoteEn,
    };
  }

  // Direct Video / HLS (.m3u8) / MPEG-DASH (.mpd)
  try {
    let headResult = await safePublicFetch(source.canonicalUrl, {
      method: 'HEAD',
    });

    // Some object storage/CDNs reject HEAD with 403/405/501; fallback to minimal Range GET
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
            : `Tautan video langsung gagal diakses (HTTP ${res.status}).`,
        messageEn:
          res.status === 401 || res.status === 403
            ? `Direct video access denied or link expired (HTTP ${res.status}).`
            : `Direct video URL returned HTTP ${res.status}.`,
        verifiability: 'verifiable',
        verifiabilityNoteId: source.verifiabilityNoteId,
        verifiabilityNoteEn: source.verifiabilityNoteEn,
      };
    }

    const contentType = res.headers.get('content-type') || '';
    const contentLengthHeader = res.headers.get('content-length');
    const acceptRanges = res.headers.get('accept-ranges') || '';
    const acao = res.headers.get('access-control-allow-origin');

    let snippetText = '';
    let snippetBytes: Uint8Array = new Uint8Array(0);
    // If HEAD succeeded but MIME is generic/missing, or manifest check needed, probe small byte range safely
    if (
      contentType.includes('mpegurl') ||
      contentType.includes('dash+xml') ||
      contentType.includes('text/html') ||
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

    if (formatInspection.isHtmlPage || !formatInspection.isLikelyVideo) {
      return {
        detected: true,
        provider: 'direct_video',
        platformLabel: 'URL Bukan Media Video',
        canonicalRef: headResult.finalUrl,
        canonicalUrl: headResult.finalUrl,
        linkStatus: 'unavailable',
        reasonCode: formatInspection.isHtmlPage ? 'HTML_PAGE_NOT_VIDEO' : 'UNSUPPORTED_MIME_TYPE',
        mimeType: contentType.split(';')[0].trim() || undefined,
        messageId: formatInspection.isHtmlPage
          ? 'Tautan ini mengarah ke halaman web HTML, bukan file video langsung (.mp4/.webm/.mov/.m3u8/.mpd).'
          : `Tipe media server (${contentType || 'tidak diketahui'}) tidak dikenali sebagai format video atau manifest streaming yang didukung.`,
        messageEn: formatInspection.isHtmlPage
          ? 'URL points to an HTML web page rather than a direct video or streaming manifest (.mp4/.webm/.mov/.m3u8/.mpd).'
          : `Server media type (${contentType || 'unknown'}) is not a supported video or streaming manifest format.`,
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
    const isBlockedIp = msg.toLowerCase().includes('blocked') || msg.toLowerCase().includes('private') || msg.toLowerCase().includes('https');
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
