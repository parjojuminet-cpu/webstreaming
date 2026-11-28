import { auth } from '../lib/firebase';
import type {
  ContentCategory,
  DirectStreamFormat,
  EntitlementRecord,
  VideoAssetProvider,
} from '../types/vyora';
import type { LinkInspectionDiagnostics } from './videoImport/types';

export interface StreamAuthorizationResponse {
  mode: 'preview' | 'full';
  isFree?: boolean;
  streamType?:
    | 'hls'
    | 'file'
    | 'youtube'
    | 'facebook'
    | 'vimeo'
    | 'dailymotion'
    | 'streamable'
    | 'tiktok'
    | 'google_drive'
    | 'archive_org'
    | 'twitch'
    | 'rumble'
    | 'odysee'
    | 'loom'
    | 'bilibili'
    | 'html_embed'
    | 'direct_video';
  provider?: VideoAssetProvider;
  youtubeVideoId?: string;
  youtubePlaylistId?: string;
  facebookVideoUrl?: string;
  vimeoVideoId?: string;
  vimeoHash?: string;
  dailymotionVideoId?: string;
  streamableId?: string;
  twitchRef?: string;
  directFormat?: DirectStreamFormat;
  signedHls?: boolean;
  videoId: string;
  previewLimitSeconds: number;
  resumeSeconds: number;
  manifestUrl: string;
  entitlement: {
    status: 'active';
    expiresAt: string;
    remainingDays: number;
  } | null;
  serverTimeIso: string;
}

export interface StreamCapabilities {
  cloudflareStreamConfigured: boolean;
  cloudflareSigningConfigured: boolean;
}

export interface CloudflareVideoStatus {
  uid: string;
  readyToStream: boolean;
  state: string;
  pctComplete: number;
  durationSeconds: number;
  thumbnailUrl?: string;
}

export interface UploadedVideoMediaResult {
  kind: 'video';
  provider: 'private_storage' | 'cloudflare_stream';
  assetRef: string;
  mimeType: string;
  sizeBytes: number;
}

export interface UploadedThumbnailMediaResult {
  kind: 'thumbnail';
  thumbnailUrl: string;
  mimeType: string;
  sizeBytes: number;
}

export interface ServerEntitlementItem extends EntitlementRecord {
  remainingDays: number;
}

async function getBearerHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const currentUser = auth.currentUser;
  if (currentUser) {
    const idToken = await currentUser.getIdToken();
    headers.Authorization = `Bearer ${idToken}`;
  }
  return headers;
}

function inferUploadMimeType(file: File): string {
  if (file.type && file.type.trim().length > 0) {
    return file.type;
  }
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/octet-stream';
}

export async function fetchStreamCapabilities(): Promise<StreamCapabilities> {
  try {
    const res = await fetch('/api/health');
    if (!res.ok) {
      return {
        cloudflareStreamConfigured: false,
        cloudflareSigningConfigured: false,
      };
    }
    const data = (await res.json()) as {
      media?: {
        cloudflareStreamConfigured?: boolean;
        cloudflareSigningConfigured?: boolean;
      };
    };
    return {
      cloudflareStreamConfigured: Boolean(data.media?.cloudflareStreamConfigured),
      cloudflareSigningConfigured: Boolean(data.media?.cloudflareSigningConfigured),
    };
  } catch {
    return {
      cloudflareStreamConfigured: false,
      cloudflareSigningConfigured: false,
    };
  }
}

export async function uploadVideoToCloudflareStream(
  file: File,
  onProgress?: (percent: number) => void
): Promise<UploadedVideoMediaResult> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Authentication required before uploading media.');
  }
  const headers = await getBearerHeaders();
  const initRes = await fetch('/api/creator/cloudflare-direct-upload', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      uploadLength: file.size,
      filename: file.name,
      maxDurationSeconds: 21600,
    }),
  });

  if (!initRes.ok) {
    const body = (await initRes.json().catch(() => ({}))) as { error?: string };
    throw new Error(
      body.error || 'Failed to initialize Cloudflare Stream direct upload.'
    );
  }

  const session = (await initRes.json()) as {
    uid: string;
    uploadUrl: string;
  };

  // Upload directly from browser to Cloudflare Stream edge using TUS 10MB chunks
  // so zero video bytes consume server RAM or disk even for >100MB films.
  const chunkSize = 10 * 1024 * 1024;
  let offset = 0;
  onProgress?.(0);

  while (offset < file.size) {
    const end = Math.min(file.size, offset + chunkSize);
    const slice = file.slice(offset, end);

    let uploadedChunk = false;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const patchRes = await fetch(session.uploadUrl, {
          method: 'PATCH',
          headers: {
            'Tus-Resumable': '1.0.0',
            'Upload-Offset': String(offset),
            'Content-Type': 'application/offset+octet-stream',
          },
          body: slice,
        });

        if (!patchRes.ok) {
          throw new Error(`Cloudflare TUS chunk upload failed (${patchRes.status}).`);
        }

        const nextOffsetHeader = patchRes.headers.get('upload-offset');
        offset = nextOffsetHeader ? Number(nextOffsetHeader) : end;
        uploadedChunk = true;
        break;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error('Chunk upload error');
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        }
      }
    }

    if (!uploadedChunk) {
      throw lastError || new Error('Failed while uploading video chunks to Cloudflare Stream.');
    }

    const pct = Math.min(100, Math.round((offset / file.size) * 100));
    onProgress?.(pct);
  }

  return {
    kind: 'video',
    provider: 'cloudflare_stream',
    assetRef: session.uid,
    mimeType: inferUploadMimeType(file),
    sizeBytes: file.size,
  };
}

export async function fetchCloudflareVideoStatus(
  uid: string
): Promise<CloudflareVideoStatus | null> {
  if (!auth.currentUser) return null;
  const headers = await getBearerHeaders();
  const res = await fetch(
    `/api/creator/cloudflare-status/${encodeURIComponent(uid)}`,
    { headers }
  );
  if (!res.ok) return null;
  return (await res.json()) as CloudflareVideoStatus;
}

export async function uploadCreatorMedia(
  file: File
): Promise<UploadedVideoMediaResult | UploadedThumbnailMediaResult> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Authentication required before uploading media.');
  }
  const idToken = await currentUser.getIdToken();
  const safeHeaderName = file.name
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .slice(0, 48);
  const contentType = inferUploadMimeType(file);

  const res = await fetch('/api/creator/upload-media', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': contentType,
      'x-deloken-filename': safeHeaderName || 'deloken-media',
    },
    body: file,
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || 'Media upload failed.');
  }

  return (await res.json()) as
    | UploadedVideoMediaResult
    | UploadedThumbnailMediaResult;
}

export async function inspectCreatorVideoLink(
  url: string
): Promise<LinkInspectionDiagnostics> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Authentication required before checking a video link.');
  }
  const headers = await getBearerHeaders();
  const res = await fetch('/api/creator/inspect-video-link', {
    method: 'POST',
    headers,
    body: JSON.stringify({ url }),
  });
  const body = (await res.json().catch(() => ({}))) as LinkInspectionDiagnostics & {
    error?: string;
  };
  if (!res.ok) {
    throw new Error(body.error || 'Failed to inspect video link.');
  }
  return body;
}

export async function registerCreatorVideoMedia(input: {
  videoId: string;
  provider: VideoAssetProvider;
  assetRef: string;
  mimeType?: string;
}): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser) return;
  const headers = await getBearerHeaders();
  const res = await fetch('/api/creator/register-video-media', {
    method: 'POST',
    headers,
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || 'Failed to register creator media mapping.');
  }
}

export async function authorizeVideoStream(
  videoId: string,
  category?: ContentCategory
): Promise<StreamAuthorizationResponse> {
  const headers = await getBearerHeaders();
  const res = await fetch('/api/stream/authorize', {
    method: 'POST',
    headers,
    body: JSON.stringify({ videoId, category }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || 'Failed to authorize stream.');
  }
  return (await res.json()) as StreamAuthorizationResponse;
}

export async function savePlaybackProgress(
  videoId: string,
  positionSeconds: number
): Promise<void> {
  if (!auth.currentUser) return;
  const headers = await getBearerHeaders();
  await fetch('/api/playback/progress', {
    method: 'POST',
    headers,
    body: JSON.stringify({ videoId, positionSeconds }),
  });
}

export async function fetchMyServerEntitlements(): Promise<ServerEntitlementItem[]> {
  if (!auth.currentUser) return [];
  const headers = await getBearerHeaders();
  const res = await fetch('/api/entitlements/me', { headers });
  if (!res.ok) return [];
  const data = (await res.json()) as { entitlements?: ServerEntitlementItem[] };
  return data.entitlements ?? [];
}

export async function activatePhase3PreviewPass(input: {
  videoId: string;
  videoTitle: string;
  thumbnailUrl: string;
  resumeSeconds: number;
}): Promise<{ expiresAt: string; remainingDays: number; resumeSeconds: number }> {
  const headers = await getBearerHeaders();
  const res = await fetch('/api/entitlements/activate-phase3-pass', {
    method: 'POST',
    headers,
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || 'Unable to activate 30-day preview pass.');
  }
  const data = (await res.json()) as {
    entitlement: { expiresAt: string; remainingDays: number; resumeSeconds: number };
  };
  return data.entitlement;
}
