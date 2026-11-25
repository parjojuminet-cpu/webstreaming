import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ContentStatus, VideoAssetProvider } from '../src/types/vyora';
import { extractFacebookVideoUrl } from '../src/utils/facebook.ts';
import { extractYouTubeVideoId } from '../src/utils/youtube.ts';
import {
  extractDailymotionVideoId,
  extractInstagramPostInfo,
  extractStreamableId,
  extractTikTokVideoInfo,
  extractVimeoVideoRef,
  extractXPostInfo,
} from '../src/services/videoImport/adapters.ts';
import { parseStrictHttpsUrl } from '../src/services/videoImport/urlGuards.ts';

export type NormalizedMediaProvider = VideoAssetProvider | 'unknown';

const EXTERNAL_LINK_PROVIDERS = new Set<VideoAssetProvider>([
  'youtube',
  'vimeo',
  'dailymotion',
  'tiktok',
  'facebook',
  'x',
  'instagram',
  'streamable',
  'direct_video',
]);

export function isExternalLinkProvider(
  provider: NormalizedMediaProvider
): provider is VideoAssetProvider {
  return provider !== 'unknown' && EXTERNAL_LINK_PROVIDERS.has(provider);
}

export const VALID_RESTORABLE_STATUSES = new Set<ContentStatus>([
  'draft',
  'pending_review',
  'approved',
  'rejected',
  'published',
]);

export interface FirestoreRestValue {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  booleanValue?: boolean;
  timestampValue?: string;
  nullValue?: null;
}

export interface FirestoreDocResult {
  exists: boolean;
  status: number;
  fields: Record<string, FirestoreRestValue>;
}

export function isValidSafePathSegment(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 128 &&
    /^[a-zA-Z0-9_-]+$/.test(value)
  );
}

export function safeResolveInUploadsDir(
  uploadsDir: string,
  ownerUid: string,
  fileName: string
): string | null {
  if (!isValidSafePathSegment(ownerUid) || !/^[a-zA-Z0-9._-]+$/.test(fileName)) {
    return null;
  }
  if (fileName === '.' || fileName === '..' || fileName.includes('..')) {
    return null;
  }
  const rootResolved = path.resolve(uploadsDir);
  const ownerDir = path.resolve(rootResolved, ownerUid);
  const target = path.resolve(ownerDir, fileName);
  if (
    !ownerDir.startsWith(rootResolved + path.sep) ||
    !target.startsWith(ownerDir + path.sep)
  ) {
    return null;
  }
  return target;
}

export function validatePrivateStorageAssetRef(
  uploadsDir: string,
  rawRef: string
):
  | { kind: 'shared_preset'; preset: 'stream-cinema' | 'stream-doc' }
  | { kind: 'uploaded_file'; ownerUid: string; fileName: string; resolvedPath: string }
  | { kind: 'invalid'; reason: string } {
  const trimmed = rawRef.trim();
  if (trimmed === 'stream-cinema' || trimmed === 'stream-doc') {
    return { kind: 'shared_preset', preset: trimmed };
  }

  if (
    !trimmed.startsWith('private/uploads/') ||
    trimmed.includes('..') ||
    trimmed.includes('\\') ||
    trimmed.includes('?') ||
    trimmed.includes('#')
  ) {
    return { kind: 'invalid', reason: 'Asset path violates private/uploads/ format.' };
  }

  const match = /^private\/uploads\/([a-zA-Z0-9_-]{1,128})\/([a-zA-Z0-9._-]+)$/.exec(
    trimmed
  );
  if (!match) {
    return { kind: 'invalid', reason: 'Asset path segments contain disallowed characters.' };
  }

  const [, ownerUid, fileName] = match;
  const resolvedPath = safeResolveInUploadsDir(uploadsDir, ownerUid, fileName);
  if (!resolvedPath) {
    return { kind: 'invalid', reason: 'Resolved path escaped upload root directory.' };
  }

  return {
    kind: 'uploaded_file',
    ownerUid,
    fileName,
    resolvedPath,
  };
}

export function normalizeMediaSource(
  rawProvider: string | undefined | null,
  rawRef: string | undefined | null
): { provider: NormalizedMediaProvider; assetRef: string } {
  const p = (rawProvider || '').trim();
  const r = (rawRef || '').trim();

  if (p === 'cloudflare_stream') {
    return { provider: 'cloudflare_stream', assetRef: r };
  }
  if (p === 'youtube' || r.startsWith('youtube:')) {
    return {
      provider: 'youtube',
      assetRef: r.startsWith('youtube:') ? r.slice('youtube:'.length).trim() : r,
    };
  }
  if (p === 'facebook' || r.startsWith('facebook:')) {
    return {
      provider: 'facebook',
      assetRef: r.startsWith('facebook:') ? r.slice('facebook:'.length).trim() : r,
    };
  }
  if (p === 'vimeo' || r.startsWith('vimeo:')) {
    return {
      provider: 'vimeo',
      assetRef: r.startsWith('vimeo:') ? r.slice('vimeo:'.length).trim() : r,
    };
  }
  if (p === 'dailymotion' || r.startsWith('dailymotion:')) {
    return {
      provider: 'dailymotion',
      assetRef: r.startsWith('dailymotion:') ? r.slice('dailymotion:'.length).trim() : r,
    };
  }
  if (p === 'streamable' || r.startsWith('streamable:')) {
    return {
      provider: 'streamable',
      assetRef: r.startsWith('streamable:') ? r.slice('streamable:'.length).trim() : r,
    };
  }
  if (p === 'tiktok' || r.startsWith('tiktok:')) {
    return {
      provider: 'tiktok',
      assetRef: r.startsWith('tiktok:') ? r.slice('tiktok:'.length).trim() : r,
    };
  }
  if (p === 'x' || r.startsWith('x:')) {
    return {
      provider: 'x',
      assetRef: r.startsWith('x:') ? r.slice('x:'.length).trim() : r,
    };
  }
  if (p === 'instagram' || r.startsWith('instagram:')) {
    return {
      provider: 'instagram',
      assetRef: r.startsWith('instagram:') ? r.slice('instagram:'.length).trim() : r,
    };
  }
  if (p === 'direct_video' || r.startsWith('direct:')) {
    return {
      provider: 'direct_video',
      assetRef: r.startsWith('direct:') ? r.slice('direct:'.length).trim() : r,
    };
  }
  if (p === 'private_storage') {
    return { provider: 'private_storage', assetRef: r };
  }
  return { provider: 'unknown', assetRef: r };
}

export function validateExternalProviderAssetRef(
  provider: NormalizedMediaProvider,
  assetRef: string
): boolean {
  if (provider === 'youtube') return Boolean(extractYouTubeVideoId(assetRef));
  if (provider === 'facebook') return Boolean(extractFacebookVideoUrl(assetRef));
  if (provider === 'vimeo') return Boolean(extractVimeoVideoRef(assetRef));
  if (provider === 'dailymotion') return Boolean(extractDailymotionVideoId(assetRef));
  if (provider === 'streamable') return Boolean(extractStreamableId(assetRef));
  if (provider === 'tiktok') return Boolean(extractTikTokVideoInfo(assetRef));
  if (provider === 'x') return Boolean(extractXPostInfo(assetRef));
  if (provider === 'instagram') return Boolean(extractInstagramPostInfo(assetRef));
  if (provider === 'direct_video') {
    return parseStrictHttpsUrl(assetRef, { allowBareHostname: false }).ok;
  }
  return false;
}

export function buildAssetRefFingerprint(
  provider: NormalizedMediaProvider,
  assetRef: string
): string {
  const clean = assetRef.trim();
  if (!clean) return `${provider}:empty`;
  const shortHash = crypto
    .createHash('sha256')
    .update(`${provider}:${clean}`)
    .digest('hex')
    .slice(0, 10);

  if (provider === 'cloudflare_stream') {
    const head = clean.slice(0, 6);
    const tail = clean.length > 10 ? clean.slice(-4) : '';
    return `cf:${head}...${tail}#${shortHash}`;
  }

  if (provider === 'private_storage') {
    if (clean === 'stream-cinema' || clean === 'stream-doc') {
      return `preset:${clean}`;
    }
    const base = path.posix.basename(clean).slice(0, 28);
    return `local:${base}#${shortHash}`;
  }

  if (provider === 'youtube') {
    const ytId = extractYouTubeVideoId(clean);
    return ytId ? `yt:${ytId}` : `yt:#${shortHash}`;
  }

  if (provider === 'vimeo') {
    const vimeo = extractVimeoVideoRef(clean);
    return vimeo ? `vimeo:${vimeo.id}` : `vimeo:#${shortHash}`;
  }

  if (provider === 'dailymotion') {
    const dmId = extractDailymotionVideoId(clean);
    return dmId ? `dm:${dmId}` : `dm:#${shortHash}`;
  }

  if (provider === 'streamable') {
    const stId = extractStreamableId(clean);
    return stId ? `streamable:${stId}` : `streamable:#${shortHash}`;
  }

  if (provider === 'tiktok') {
    return `tiktok:#${shortHash}`;
  }

  if (provider === 'x') {
    return `x:#${shortHash}`;
  }

  if (provider === 'instagram') {
    return `ig:#${shortHash}`;
  }

  if (provider === 'direct_video') {
    try {
      const u = new URL(clean);
      return `direct:${u.hostname}#${shortHash}`;
    } catch {
      return `direct:#${shortHash}`;
    }
  }

  if (provider === 'facebook') {
    const fbUrl = extractFacebookVideoUrl(clean);
    return fbUrl ? `fb:#${shortHash}` : `fb:invalid#${shortHash}`;
  }

  return `unknown:#${shortHash}`;
}

const PROVIDER_DISPLAY_NAMES: Partial<Record<NormalizedMediaProvider, string>> = {
  youtube: 'YouTube',
  facebook: 'Facebook',
  vimeo: 'Vimeo',
  dailymotion: 'Dailymotion',
  tiktok: 'TikTok',
  x: 'X (Twitter)',
  instagram: 'Instagram',
  streamable: 'Streamable',
  direct_video: 'URL Video/Stream Eksternal',
};

export function getExternalPlatformWarning(
  provider: NormalizedMediaProvider
): string | null {
  const label = PROVIDER_DISPLAY_NAMES[provider];
  if (!label) return null;
  return `Video berasal dari ${label}. Menghapus dari DELOKEN hanya menghapus katalog dan referensi tautan internal; media asli di sumber eksternal tidak dihapus.`;
}

function getFirestoreBaseUrl(projectId: string, databaseId: string): string {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    projectId
  )}/databases/${encodeURIComponent(databaseId)}/documents`;
}

export async function firestoreGetDocument(
  projectId: string,
  databaseId: string,
  collectionName: string,
  docId: string,
  bearerToken: string
): Promise<FirestoreDocResult> {
  const url = `${getFirestoreBaseUrl(projectId, databaseId)}/${encodeURIComponent(
    collectionName
  )}/${encodeURIComponent(docId)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${bearerToken}` },
  });

  if (res.status === 404) {
    return { exists: false, status: 404, fields: {} };
  }
  if (!res.ok) {
    throw new Error(
      `Firestore read failed for ${collectionName}/${docId} (HTTP ${res.status}).`
    );
  }
  const json = (await res.json()) as { fields?: Record<string, FirestoreRestValue> };
  return {
    exists: true,
    status: res.status,
    fields: json.fields ?? {},
  };
}

export async function firestoreCommitVideoFields(
  projectId: string,
  databaseId: string,
  videoId: string,
  fields: Record<string, FirestoreRestValue>,
  bearerToken: string
): Promise<void> {
  const baseUrl = getFirestoreBaseUrl(projectId, databaseId);
  const docName = `projects/${projectId}/databases/${databaseId}/documents/videos/${videoId}`;
  const fieldPaths = Object.keys(fields);

  const res = await fetch(`${baseUrl}:commit`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      writes: [
        {
          update: {
            name: docName,
            fields,
          },
          updateMask: {
            fieldPaths,
          },
          updateTransforms: [
            {
              fieldPath: 'updatedAt',
              setToServerValue: 'REQUEST_TIME',
            },
          ],
          currentDocument: {
            exists: true,
          },
        },
      ],
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(
      `Firestore commit failed for videos/${videoId} (HTTP ${res.status}): ${errBody.slice(0, 180)}`
    );
  }
}

export async function firestoreDeleteDocument(
  projectId: string,
  databaseId: string,
  collectionName: string,
  docId: string,
  bearerToken: string
): Promise<{ deleted: true; alreadyMissing: boolean }> {
  const url = `${getFirestoreBaseUrl(projectId, databaseId)}/${encodeURIComponent(
    collectionName
  )}/${encodeURIComponent(docId)}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${bearerToken}` },
  });

  if (res.status === 404) {
    return { deleted: true, alreadyMissing: true };
  }
  if (!res.ok) {
    throw new Error(
      `Firestore delete failed for ${collectionName}/${docId} (HTTP ${res.status}).`
    );
  }
  return { deleted: true, alreadyMissing: false };
}

async function runFirestoreEqualityQuery(
  projectId: string,
  databaseId: string,
  collectionId: string,
  fieldPath: string,
  value: string,
  limit: number,
  bearerToken: string
): Promise<string[]> {
  const url = `${getFirestoreBaseUrl(projectId, databaseId)}:runQuery`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId }],
        where: {
          fieldFilter: {
            field: { fieldPath },
            op: 'EQUAL',
            value: { stringValue: value },
          },
        },
        limit,
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Firestore runQuery failed (${res.status}).`);
  }

  const rows = (await res.json()) as Array<{ document?: { name?: string } }>;
  return rows
    .map((r) => r.document?.name)
    .filter((n): n is string => typeof n === 'string' && n.length > 0)
    .map((n) => n.split('/').pop() || '')
    .filter(Boolean);
}

export async function verifyExclusiveLocalThumbnail(input: {
  thumbnailsDir: string;
  thumbUrl: string;
  excludeVideoId: string;
  expectedCreatorId: string;
  projectId: string;
  databaseId: string;
  bearerToken: string;
}): Promise<
  | {
      safeToDelete: true;
      ownerUid: string;
      fileName: string;
      resolvedPath: string;
      sqlThumbKey: string;
    }
  | { safeToDelete: false; reason: string }
> {
  const rawUrl = (input.thumbUrl || '').trim();
  const match = /^\/api\/media\/thumb\/([^/]+)\/([^/?#]+)$/.exec(rawUrl);
  if (!match) {
    return { safeToDelete: false, reason: 'external_or_builtin_asset' };
  }

  let ownerUid = '';
  let fileName = '';
  try {
    ownerUid = decodeURIComponent(match[1]);
    fileName = decodeURIComponent(match[2]);
  } catch {
    return { safeToDelete: false, reason: 'invalid_thumbnail_encoding' };
  }

  const resolvedPath = safeResolveInUploadsDir(
    input.thumbnailsDir,
    ownerUid,
    fileName
  );
  if (!resolvedPath) {
    return { safeToDelete: false, reason: 'invalid_thumbnail_path' };
  }

  if (!input.expectedCreatorId || ownerUid !== input.expectedCreatorId) {
    return { safeToDelete: false, reason: 'thumbnail_ownership_unclear' };
  }

  try {
    const [thumbMatches, backdropMatches, creatorAvatarMatches] = await Promise.all([
      runFirestoreEqualityQuery(
        input.projectId,
        input.databaseId,
        'videos',
        'thumbnailUrl',
        rawUrl,
        5,
        input.bearerToken
      ),
      runFirestoreEqualityQuery(
        input.projectId,
        input.databaseId,
        'videos',
        'backdropUrl',
        rawUrl,
        5,
        input.bearerToken
      ),
      runFirestoreEqualityQuery(
        input.projectId,
        input.databaseId,
        'creators',
        'avatarUrl',
        rawUrl,
        2,
        input.bearerToken
      ),
    ]);

    const otherVideos = [...thumbMatches, ...backdropMatches].filter(
      (id) => id !== input.excludeVideoId
    );
    if (otherVideos.length > 0 || creatorAvatarMatches.length > 0) {
      return { safeToDelete: false, reason: 'shared_thumbnail_retained' };
    }

    return {
      safeToDelete: true,
      ownerUid,
      fileName,
      resolvedPath,
      sqlThumbKey: `thumb:${ownerUid}:${fileName}`,
    };
  } catch {
    // Fail closed: never delete thumbnail if sharing verification cannot complete
    return { safeToDelete: false, reason: 'sharing_check_failed_retained' };
  }
}

export function deleteFileIfExists(resolvedPath: string): 'deleted' | 'already_missing' {
  if (!fs.existsSync(resolvedPath)) {
    return 'already_missing';
  }
  fs.unlinkSync(resolvedPath);
  return 'deleted';
}
