import type { LanguageCode, VideoProvider } from '../types/deloken';
import {
  extractGoogleDriveFileId,
  extractYoutubeVideoId,
  validateVideoProviderUrl,
} from '../utils/validation';

export interface ResolvedVideoAdapter {
  provider: VideoProvider;
  providerName: string;
  renderMode: 'youtube_iframe' | 'html5_mp4' | 'google_drive_iframe' | 'deloken_hls_future';
  playableUrl: string | null;
  isValidConfig: boolean;
  caveat: string;
  errorMessage?: string;
}

export function resolveVideoProviderAdapter(
  provider: VideoProvider,
  rawUrl: string,
  language: LanguageCode
): ResolvedVideoAdapter {
  const urlCheck = validateVideoProviderUrl(provider, rawUrl);

  if (provider === 'youtube_unlisted') {
    const videoId = extractYoutubeVideoId(rawUrl);
    if (!urlCheck.valid || !videoId) {
      return {
        provider,
        providerName: 'YouTube Unlisted (IFrame Player API)',
        renderMode: 'youtube_iframe',
        playableUrl: null,
        isValidConfig: false,
        caveat: '',
        errorMessage: language === 'id' ? urlCheck.messageId : urlCheck.messageEn,
      };
    }
    return {
      provider,
      providerName: 'YouTube Unlisted (IFrame Player API)',
      renderMode: 'youtube_iframe',
      playableUrl: `https://www.youtube-nocookie.com/embed/${videoId}?enablejsapi=1&rel=0&modestbranding=1`,
      isValidConfig: true,
      caveat:
        language === 'id'
          ? 'Diputar melalui YouTube IFrame Player API. Kontrol dan branding standar YouTube tetap berlaku.'
          : 'Loaded via YouTube IFrame Player API. Standard YouTube player controls and branding apply.',
    };
  }

  if (provider === 'archive_org_mp4') {
    if (!urlCheck.valid) {
      return {
        provider,
        providerName: 'Archive.org Direct MP4 (HTML5)',
        renderMode: 'html5_mp4',
        playableUrl: null,
        isValidConfig: false,
        caveat: '',
        errorMessage: language === 'id' ? urlCheck.messageId : urlCheck.messageEn,
      };
    }
    return {
      provider,
      providerName: 'Archive.org Direct MP4 (HTML5)',
      renderMode: 'html5_mp4',
      playableUrl: rawUrl.trim(),
      isValidConfig: true,
      caveat:
        language === 'id'
          ? 'Stream langsung HTML5 MP4 dari Archive.org. Jika server sumber lambat/offline, pesan error ditampilkan apa adanya.'
          : 'Direct HTML5 MP4 stream from Archive.org. Remote availability errors are reported directly.',
    };
  }

  if (provider === 'google_drive') {
    const fileId = extractGoogleDriveFileId(rawUrl);
    if (!urlCheck.valid || !fileId) {
      return {
        provider,
        providerName: 'Google Drive Video (Embed Adapter)',
        renderMode: 'google_drive_iframe',
        playableUrl: null,
        isValidConfig: false,
        caveat: '',
        errorMessage: language === 'id' ? urlCheck.messageId : urlCheck.messageEn,
      };
    }
    return {
      provider,
      providerName: 'Google Drive Video (Embed Adapter)',
      renderMode: 'google_drive_iframe',
      playableUrl: `https://drive.google.com/file/d/${fileId}/preview`,
      isValidConfig: true,
      caveat:
        language === 'id'
          ? 'Google Drive Embed memerlukan izin file "Anyone with the link" atau akses viewer yang diizinkan. File Restricted akan menolak pemutaran.'
          : 'Google Drive Embed requires accessible link permissions. Restricted files will fail to play until access is granted.',
    };
  }

  // deloken_hosted
  return {
    provider: 'deloken_hosted',
    providerName: 'DELOKEN Hosted Video (Cloudflare Stream / R2 Ready)',
    renderMode: 'deloken_hls_future',
    playableUrl: rawUrl.trim() || null,
    isValidConfig: Boolean(rawUrl.trim()),
    caveat:
      language === 'id'
        ? 'Adapter siap produksi untuk Cloudflare Stream HLS & R2 Signed Delivery. Gunakan Timer Simulasi di bawah untuk menguji kunci 5 menit.'
        : 'Production-ready adapter for Cloudflare Stream HLS & R2 Signed Delivery. Use the Simulation Timer below to test the 5-minute lock.',
  };
}
