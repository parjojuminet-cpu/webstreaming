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
    | 'x'
    | 'instagram'
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
  xPostUrl?: string;
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
  if (lower.endsWith('.mp4') || lower.endsWith('.m4v')) return 'video/mp4';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (lower.endsWith('.mkv')) return 'video/x-matroska';
  if (lower.endsWith('.ogv')) return 'video/ogg';
  if (lower.endsWith('.3gp')) return 'video/3gpp';
  if (lower.endsWith('.avi')) return 'video/x-msvideo';
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

async function readUploadErrorMessage(res: Response, fallback: string): Promise<string> {
  const rawText = await res.text().catch(() => '');
  if (rawText) {
    try {
      const parsed = JSON.parse(rawText) as { error?: string };
      if (parsed.error) return parsed.error;
    } catch {
      // Non-JSON proxy error (e.g. HTTP 413/502 HTML)
    }
  }
  if (res.status === 413) {
    return 'Ukuran permintaan unggahan melebihi batas server (HTTP 413).';
  }
  return `${fallback} (HTTP ${res.status})`;
}

export async function uploadCreatorMedia(
  file: File,
  onProgress?: (percent: number) => void
): Promise<UploadedVideoMediaResult | UploadedThumbnailMediaResult> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Authentication required before uploading media.');
  }
  const idToken = await currentUser.getIdToken();
  const safeAsciiName = file.name.replace(/[^\x20-\x7E]/g, '-').slice(0, 160) || 'video.mp4';
  const safeHeaderSlug = safeAsciiName
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .slice(0, 48);
  const contentType = inferUploadMimeType(file);

  // Use 8MB chunked upload for local video files > 8MB so requests stay safely under Cloud Run 32MB limit
  const LOCAL_CHUNK_BYTES = 8 * 1024 * 1024;
  if (file.size > LOCAL_CHUNK_BYTES && !contentType.startsWith('image/')) {
    const totalChunks = Math.ceil(file.size / LOCAL_CHUNK_BYTES);
    onProgress?.(0);

    const initRes = await fetch('/api/creator/upload-media/init', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filename: safeAsciiName,
        mimeType: contentType,
        totalBytes: file.size,
        totalChunks,
      }),
    });
    if (!initRes.ok) {
      throw new Error(await readUploadErrorMessage(initRes, 'Failed to initialize video upload'));
    }
    const { uploadId } = (await initRes.json()) as { uploadId: string };

    for (let idx = 0; idx < totalChunks; idx += 1) {
      const start = idx * LOCAL_CHUNK_BYTES;
      const end = Math.min(file.size, start + LOCAL_CHUNK_BYTES);
      const slice = file.slice(start, end);

      let uploaded = false;
      let lastErr: Error | null = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const chunkRes = await fetch('/api/creator/upload-media/chunk', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${idToken}`,
              'Content-Type': 'application/octet-stream',
              'x-upload-id': uploadId,
              'x-chunk-index': String(idx),
            },
            body: slice,
          });
          if (!chunkRes.ok) {
            throw new Error(
              await readUploadErrorMessage(chunkRes, `Chunk #${idx + 1} upload failed`)
            );
          }
          uploaded = true;
          break;
        } catch (err) {
          lastErr = err instanceof Error ? err : new Error('Chunk upload error');
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
          }
        }
      }
      if (!uploaded) {
        throw lastErr || new Error('Failed to upload video chunk.');
      }
      onProgress?.(Math.min(96, Math.round((end / file.size) * 96)));
    }

    const completeRes = await fetch('/api/creator/upload-media/complete', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ uploadId }),
    });
    if (!completeRes.ok) {
      throw new Error(await readUploadErrorMessage(completeRes, 'Failed to finalize video upload'));
    }
    onProgress?.(100);
    return (await completeRes.json()) as UploadedVideoMediaResult;
  }

  const res = await fetch('/api/creator/upload-media', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': contentType,
      'x-deloken-filename': safeHeaderSlug || 'deloken-media',
      'x-deloken-original-filename': safeAsciiName,
    },
    body: file,
  });

  if (!res.ok) {
    throw new Error(await readUploadErrorMessage(res, 'Media upload failed'));
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

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const headers = await getBearerHeaders();
      const res = await fetch('/api/creator/register-video-media', {
        method: 'POST',
        headers,
        body: JSON.stringify(input),
      });
      if (res.ok) return;
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      lastError = new Error(body.error || `Failed to register creator media mapping (${res.status}).`);
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        break;
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error('Network error registering media.');
    }
    if (attempt < 2) {
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw lastError || new Error('Failed to register creator media mapping.');
}

export interface MediaSyncBatchItem {
  videoId: string;
  creatorId: string;
  provider: string;
  assetRef: string;
  mimeType?: string;
}

export async function syncCreatorVideoMediaBatch(
  items: MediaSyncBatchItem[]
): Promise<{ synced: number; skipped: number; failed: number }> {
  if (!auth.currentUser || items.length === 0) {
    return { synced: 0, skipped: 0, failed: 0 };
  }
  const headers = await getBearerHeaders();
  let synced = 0;
  let skipped = 0;
  let failed = 0;
  for (let i = 0; i < items.length; i += 150) {
    const chunk = items.slice(i, i + 150);
    const res = await fetch('/api/creator/sync-video-media-batch', {
      method: 'POST',
      headers,
      body: JSON.stringify({ items: chunk }),
    });
    if (res.ok) {
      const data = (await res.json()) as { synced?: number; skipped?: number; failed?: number };
      synced += data.synced ?? 0;
      skipped += data.skipped ?? 0;
      failed += data.failed ?? 0;
    } else {
      failed += chunk.length;
    }
  }
  return { synced, skipped, failed };
}

export async function adminSyncCreatorMediaBatch(
  items: MediaSyncBatchItem[]
): Promise<{ synced: number; skipped: number; failed: number }> {
  if (!auth.currentUser || items.length === 0) {
    return { synced: 0, skipped: 0, failed: 0 };
  }
  const headers = await getBearerHeaders();
  let synced = 0;
  let skipped = 0;
  let failed = 0;
  for (let i = 0; i < items.length; i += 200) {
    const chunk = items.slice(i, i + 200);
    const res = await fetch('/api/admin/sync-creator-media', {
      method: 'POST',
      headers,
      body: JSON.stringify({ items: chunk }),
    });
    if (res.ok) {
      const data = (await res.json()) as { synced?: number; skipped?: number; failed?: number };
      synced += data.synced ?? 0;
      skipped += data.skipped ?? 0;
      failed += data.failed ?? 0;
    } else {
      failed += chunk.length;
    }
  }
  return { synced, skipped, failed };
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

export interface PublicMetricsSnapshot {
  videoViews: Record<string, number>;
  creatorFollowers: Record<string, number>;
}

export async function fetchPublicMetrics(): Promise<PublicMetricsSnapshot> {
  try {
    const res = await fetch('/api/videos/metrics');
    if (!res.ok) return { videoViews: {}, creatorFollowers: {} };
    const data = (await res.json()) as Partial<PublicMetricsSnapshot>;
    return {
      videoViews: data.videoViews ?? {},
      creatorFollowers: data.creatorFollowers ?? {},
    };
  } catch {
    return { videoViews: {}, creatorFollowers: {} };
  }
}

export async function recordVideoView(videoId: string): Promise<number | null> {
  try {
    const headers = await getBearerHeaders();
    const res = await fetch(`/api/videos/${encodeURIComponent(videoId)}/view`, {
      method: 'POST',
      headers,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { viewCount?: number };
    return typeof data.viewCount === 'number' ? data.viewCount : null;
  } catch {
    return null;
  }
}

export async function syncCreatorFollowCount(
  creatorId: string,
  following: boolean
): Promise<number | null> {
  if (!auth.currentUser) return null;
  try {
    const headers = await getBearerHeaders();
    const res = await fetch(
      `/api/creators/${encodeURIComponent(creatorId)}/follow-sync`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ following }),
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { followerCount?: number };
    return typeof data.followerCount === 'number' ? data.followerCount : null;
  } catch {
    return null;
  }
}
