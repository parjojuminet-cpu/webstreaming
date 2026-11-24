import type { LanguageCode, VideoProvider } from '../types/deloken';

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB

const ALLOWED_ATTACHMENT_EXTENSIONS = new Set(['pdf', 'zip', 'png', 'jpg', 'jpeg']);
const ALLOWED_ATTACHMENT_MIMES = new Set([
  'application/pdf',
  'application/zip',
  'application/x-zip-compressed',
  'image/png',
  'image/jpeg',
]);

export interface UrlValidationResult {
  valid: boolean;
  normalizedIdOrPath?: string;
  messageId: string;
  messageEn: string;
}

export function validateVideoProviderUrl(
  provider: VideoProvider,
  rawUrl: string
): UrlValidationResult {
  const url = rawUrl.trim();
  if (!url) {
    return {
      valid: false,
      messageId: 'URL video wajib diisi.',
      messageEn: 'Video URL is required.',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      valid: false,
      messageId: 'Format URL tidak valid. Pastikan diawali https://.',
      messageEn: 'Invalid URL format. Make sure it starts with https://.',
    };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return {
      valid: false,
      messageId: 'Protokol URL harus https:// atau http://.',
      messageEn: 'URL protocol must be https:// or http://.',
    };
  }

  const host = parsed.hostname.toLowerCase();

  if (provider === 'youtube_unlisted') {
    const isYoutube =
      host === 'youtu.be' ||
      host.endsWith('youtube.com') ||
      host.endsWith('youtube-nocookie.com');
    const videoId = extractYoutubeVideoId(url);
    if (!isYoutube || !videoId) {
      return {
        valid: false,
        messageId:
          'Format URL YouTube Unlisted tidak valid. Gunakan link youtube.com/watch?v=... atau youtu.be/...',
        messageEn:
          'Invalid YouTube Unlisted URL. Use youtube.com/watch?v=... or youtu.be/...',
      };
    }
    return {
      valid: true,
      normalizedIdOrPath: videoId,
      messageId:
        'Format URL YouTube Unlisted terdeteksi valid. Ketersediaan pemutaran tetap harus diuji langsung di pemutar.',
      messageEn:
        'YouTube Unlisted URL format looks valid. Actual playback still requires testing in the player.',
    };
  }

  if (provider === 'archive_org_mp4') {
    const isArchive = host.endsWith('archive.org');
    const isMp4 = parsed.pathname.toLowerCase().endsWith('.mp4');
    if (!isArchive && !isMp4) {
      return {
        valid: false,
        messageId:
          'Gunakan URL langsung berkas .mp4 dari archive.org (mis. https://archive.org/download/.../video.mp4).',
        messageEn:
          'Provide a direct .mp4 file URL from archive.org (e.g. https://archive.org/download/.../video.mp4).',
      };
    }
    if (!isMp4) {
      return {
        valid: false,
        messageId: 'Archive.org Direct MP4 harus berakhiran .mp4.',
        messageEn: 'Archive.org Direct MP4 must end with .mp4.',
      };
    }
    return {
      valid: true,
      normalizedIdOrPath: url,
      messageId:
        'Format URL Archive.org Direct MP4 valid secara sintaks. Pemutaran bergantung pada akses CORS & server sumber.',
      messageEn:
        'Archive.org Direct MP4 syntax is valid. Playback depends on remote server availability.',
    };
  }

  if (provider === 'google_drive') {
    const isDrive = host === 'drive.google.com' || host === 'docs.google.com';
    const fileId = extractGoogleDriveFileId(url);
    if (!isDrive || !fileId) {
      return {
        valid: false,
        messageId:
          'Format URL Google Drive tidak valid. Gunakan link drive.google.com/file/d/<ID>/view atau ?id=<ID>.',
        messageEn:
          'Invalid Google Drive URL. Use drive.google.com/file/d/<ID>/view or ?id=<ID>.',
      };
    }
    return {
      valid: true,
      normalizedIdOrPath: fileId,
      messageId:
        'Format ID file Google Drive valid. Video hanya dapat diputar jika izin berbagi file sudah kompatibel untuk embed.',
      messageEn:
        'Google Drive file ID detected. Playback works only if file sharing permissions allow embedding.',
    };
  }

  // deloken_hosted
  return {
    valid: true,
    normalizedIdOrPath: url,
    messageId:
      'Referensi DELOKEN Hosted Video tercatat (siap untuk integrasi Cloudflare Stream / R2).',
    messageEn:
      'DELOKEN Hosted Video reference recorded (ready for Cloudflare Stream / R2 integration).',
  };
}

export function extractYoutubeVideoId(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl.trim());
    const host = parsed.hostname.toLowerCase();
    if (host === 'youtu.be') {
      const id = parsed.pathname.replace(/^\/+/, '').split('/')[0];
      return id && /^[a-zA-Z0-9_-]{6,20}$/.test(id) ? id : null;
    }
    if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
      const vParam = parsed.searchParams.get('v');
      if (vParam && /^[a-zA-Z0-9_-]{6,20}$/.test(vParam)) return vParam;
      const parts = parsed.pathname.split('/').filter(Boolean);
      const embedIdx = parts.findIndex((p) => p === 'embed' || p === 'shorts');
      if (embedIdx >= 0 && parts[embedIdx + 1]) {
        return parts[embedIdx + 1];
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function extractGoogleDriveFileId(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl.trim());
    const idParam = parsed.searchParams.get('id');
    if (idParam && /^[a-zA-Z0-9_-]{10,80}$/.test(idParam)) return idParam;
    const match = parsed.pathname.match(/\/(?:file\/d|d)\/([a-zA-Z0-9_-]{10,80})/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export interface AttachmentValidationResult {
  valid: boolean;
  error?: string;
  sizeLabel?: string;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function validateLocalAttachmentFile(
  file: File,
  language: LanguageCode
): AttachmentValidationResult {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (!ALLOWED_ATTACHMENT_EXTENSIONS.has(ext)) {
    return {
      valid: false,
      error:
        language === 'id'
          ? 'Format lampiran harus PDF, ZIP, PNG, atau JPG.'
          : 'Attachment format must be PDF, ZIP, PNG, or JPG.',
    };
  }

  if (file.type && !ALLOWED_ATTACHMENT_MIMES.has(file.type.toLowerCase())) {
    return {
      valid: false,
      error:
        language === 'id'
          ? `Tipe MIME tidak diizinkan (${file.type}). Gunakan PDF, ZIP, PNG, atau JPG.`
          : `Unsupported MIME type (${file.type}). Use PDF, ZIP, PNG, or JPG.`,
    };
  }

  if (file.size <= 0 || file.size > MAX_ATTACHMENT_BYTES) {
    return {
      valid: false,
      error:
        language === 'id'
          ? 'Ukuran file melebihi batas maksimal 10 MB.'
          : 'File size exceeds the 10 MB maximum limit.',
    };
  }

  return {
    valid: true,
    sizeLabel: formatFileSize(file.size),
  };
}

export function validateDriveAttachmentUrl(
  rawUrl: string,
  language: LanguageCode
): { valid: boolean; error?: string } {
  const url = rawUrl.trim();
  if (!url) {
    return {
      valid: false,
      error:
        language === 'id'
          ? 'URL Google Drive Restricted wajib diisi.'
          : 'Google Drive Restricted URL is required.',
    };
  }
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.toLowerCase().includes('drive.google.com')) {
      return {
        valid: false,
        error:
          language === 'id'
            ? 'Lampiran tautan harus menggunakan domain drive.google.com.'
            : 'Link attachment must use the drive.google.com domain.',
      };
    }
    return { valid: true };
  } catch {
    return {
      valid: false,
      error:
        language === 'id'
          ? 'Format URL lampiran Google Drive tidak valid.'
          : 'Invalid Google Drive attachment URL format.',
    };
  }
}
