import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import dotenv from 'dotenv';
import {
  ACCESS_WINDOW_MS,
  PAYMENT_TTL_MS,
  PREVIEW_LIMIT_SECONDS,
  SERVER_CREDIT_PACKAGES,
  buildQrisPayloadString,
  captureLivePayPalOrder,
  createLiveMidtransQris,
  createLivePayPalOrder,
  getPayPalAccessToken,
  getPayPalPaymentLink,
  isMidtransConfigured,
  isPayPalConfigured,
  loadLedger,
  resolveServerVideoEntry,
  resolveServerVideoState,
  saveLedger,
  verifyMidtransWebhookSignature,
  withLedgerLock,
  type CreatorMediaBinding,
  type ServerEntitlement,
} from './paymentService.ts';
import { isSqlConfigured } from '../src/db/index.ts';
import {
  checkIdempotencySql,
  createVideoDeletionJobSql,
  deleteCreatorMediaByVideoIdSql,
  deleteThumbnailAssetSql,
  findPaymentForWebhookSql,
  fulfillPaymentAtomicSql,
  getAdminFinanceOverviewSql,
  getCreatorEarningsSummarySql,
  getCreatorMediaByVideoIdSql,
  getLatestVideoDeletionJobSql,
  getPaymentByIdSql,
  getPaymentStatusSnapshotSql,
  getStreamAuthContextSql,
  getThumbnailAssetSql,
  getUserEntitlementsSql,
  getWalletSnapshotSql,
  isWebhookProcessedSql,
  listVideoDeletionJobsSql,
  precheckCreateOrderSql,
  recordWebhookOnlyOrFailureSql,
  refundPaymentAtomicSql,
  requestCreatorPayoutAtomicSql,
  savePendingPaymentOrderSql,
  saveThumbnailAssetSql,
  spendCreditsAtomicSql,
  updatePayoutStatusSql,
  updatePlatformSettingsSql,
  updatePlaybackProgressSql,
  updateVideoDeletionJobSql,
  upsertCreatorMediaSql,
  upsertTrialEntitlementSql,
} from '../src/db/ledgerRepository.ts';
import { getOrCreateSqlUser } from '../src/db/users.ts';
import {
  buildCloudflareHlsUrl,
  createCloudflareTusDirectUpload,
  deleteCloudflareVideo,
  getCloudflareVideoStatus,
  isCloudflareSigningConfigured,
  isCloudflareStreamConfigured,
  signCloudflareStreamToken,
} from './cloudflareStream.ts';
import {
  VALID_RESTORABLE_STATUSES,
  buildAssetRefFingerprint,
  deleteFileIfExists,
  firestoreCommitVideoFields,
  firestoreDeleteDocument,
  firestoreGetDocument,
  getExternalPlatformWarning,
  isExternalLinkProvider,
  normalizeMediaSource,
  validateExternalProviderAssetRef,
  validatePrivateStorageAssetRef,
  verifyExclusiveLocalThumbnail,
  type NormalizedMediaProvider,
} from './mediaLifecycle.ts';
import { inspectUniversalVideoLink } from './videoInspector.ts';
import firebaseConfig from '../firebase-applet-config.json' with { type: 'json' };
import { extractYouTubeEmbedTarget } from '../src/utils/youtube.ts';
import {
  extractFacebookVideoUrl,
  getFacebookEmbedUrl,
} from '../src/utils/facebook.ts';
import {
  extractDailymotionVideoId,
  extractInstagramPostInfo,
  extractStreamableId,
  extractTikTokVideoInfo,
  extractVimeoVideoRef,
  extractXPostInfo,
  inferDirectFormatFromUrl,
} from '../src/services/videoImport/adapters.ts';
import { parseStrictHttpsUrl } from '../src/services/videoImport/urlGuards.ts';
import type {
  AdminVideoAssetInfo,
  ContentStatus,
  DirectStreamFormat,
  PaymentGatewayMode,
  PaymentOrderRecord,
  PaymentPurpose,
  VideoAssetProvider,
  VideoDeletionJobRecord,
} from '../src/types/vyora';

dotenv.config();

const FIREBASE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
let cachedFirebaseCerts: { certs: Record<string, string>; expiresAtMs: number } | null = null;

async function getFirebasePublicCerts(forceRefresh = false): Promise<Record<string, string>> {
  const now = Date.now();
  if (!forceRefresh && cachedFirebaseCerts && now < cachedFirebaseCerts.expiresAtMs) {
    return cachedFirebaseCerts.certs;
  }
  const res = await fetch(FIREBASE_CERTS_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch Firebase public certificates (${res.status}).`);
  }
  const cacheControl = res.headers.get('cache-control') || '';
  const maxAgeMatch = /max-age=(\d+)/i.exec(cacheControl);
  const maxAgeSeconds = maxAgeMatch ? Number(maxAgeMatch[1]) : 3600;
  const certs = (await res.json()) as Record<string, string>;
  cachedFirebaseCerts = {
    certs,
    expiresAtMs: now + Math.max(60, maxAgeSeconds) * 1000,
  };
  return certs;
}

function decodeBase64UrlJson<T>(segment: string): T | null {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf-8')) as T;
  } catch {
    return null;
  }
}

async function verifyFirebaseIdToken(idToken: string): Promise<AuthenticatedUser | null> {
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;
  if (!headerB64 || !payloadB64 || !signatureB64) return null;

  const header = decodeBase64UrlJson<{ alg?: unknown; kid?: unknown }>(headerB64);
  if (!header || header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) {
    return null;
  }

  let certs = await getFirebasePublicCerts(false);
  let certPem = certs[header.kid];
  if (!certPem) {
    certs = await getFirebasePublicCerts(true);
    certPem = certs[header.kid];
  }
  if (typeof certPem !== 'string' || !certPem.includes('BEGIN CERTIFICATE')) {
    return null;
  }

  const signingInput = Buffer.from(`${headerB64}.${payloadB64}`, 'utf-8');
  const signatureBuf = Buffer.from(signatureB64, 'base64url');
  if (!crypto.verify('RSA-SHA256', signingInput, certPem, signatureBuf)) {
    return null;
  }

  const payload = decodeBase64UrlJson<{
    aud?: unknown;
    iss?: unknown;
    sub?: unknown;
    exp?: unknown;
    iat?: unknown;
    auth_time?: unknown;
    email?: unknown;
    email_verified?: unknown;
  }>(payloadB64);
  if (!payload) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  const expectedIssuer = `https://securetoken.google.com/${firebaseConfig.projectId}`;
  if (
    payload.aud !== firebaseConfig.projectId ||
    payload.iss !== expectedIssuer ||
    typeof payload.sub !== 'string' ||
    payload.sub.length === 0 ||
    payload.sub.length > 128 ||
    typeof payload.exp !== 'number' ||
    payload.exp <= nowSec ||
    typeof payload.iat !== 'number' ||
    payload.iat > nowSec + 300 ||
    typeof payload.auth_time !== 'number' ||
    payload.auth_time > nowSec + 300
  ) {
    return null;
  }

  return {
    uid: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : null,
    emailVerified: Boolean(payload.email_verified),
    rawIdToken: idToken,
  };
}

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const BOOTSTRAPPED_ADMIN_EMAIL = 'parjojuminet@gmail.com';
const PREVIEW_MAX_SEGMENT_INDEX = 29; // 30 segments * 10s = 300s (5 minutes)
const FULL_MAX_SEGMENT_INDEX = 35; // 36 segments * 10s = 360s demo master

const PLAYBACK_SECRET =
  process.env.PLAYBACK_TOKEN_SECRET && process.env.PLAYBACK_TOKEN_SECRET.length >= 16
    ? process.env.PLAYBACK_TOKEN_SECRET
    : crypto.randomBytes(32).toString('hex');

const PRIVATE_MEDIA_DIR =
  process.env.VERCEL === '1'
    ? path.resolve(os.tmpdir(), 'deloken_private_media')
    : path.resolve(process.cwd(), 'private_media');
const UPLOADS_DIR = path.resolve(PRIVATE_MEDIA_DIR, 'uploads');
const THUMBNAILS_DIR = path.resolve(PRIVATE_MEDIA_DIR, 'thumbnails');
const ALLOWED_STREAMS = new Set(['stream-cinema', 'stream-doc', 'uploaded-file']);
const ALLOWED_QUALITIES = new Set(['720p', '480p']);

const ALLOWED_VIDEO_MIME: Record<string, string> = {
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
};

const ALLOWED_IMAGE_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

interface AuthenticatedUser {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  rawIdToken: string;
}

interface AuthedRequest extends Request {
  user?: AuthenticatedUser;
}

interface PlaybackTokenPayload {
  v: 1;
  uid: string;
  videoId: string;
  streamKey: string;
  mode: 'preview' | 'full';
  maxSeg: number;
  exp: number;
  jti: string;
  fileRef?: string;
  mimeType?: string;
  creatorPreview?: boolean;
}

const blockedVideoStatuses = new Map<
  string,
  'archived' | 'deletion_pending' | 'deleted'
>();

async function saveDeletionJob(job: VideoDeletionJobRecord): Promise<VideoDeletionJobRecord> {
  if (isSqlConfigured()) {
    return createVideoDeletionJobSql(job);
  }
  return withLedgerLock(async () => {
    const ledger = loadLedger();
    const jobs = ledger.videoDeletionJobs ?? [];
    ledger.videoDeletionJobs = [job, ...jobs].slice(0, 200);
    saveLedger(ledger);
    return job;
  });
}

async function patchDeletionJob(
  operationId: string,
  patch: Partial<Omit<VideoDeletionJobRecord, 'operationId' | 'videoId'>>
): Promise<void> {
  if (isSqlConfigured()) {
    await updateVideoDeletionJobSql(operationId, patch);
    return;
  }
  await withLedgerLock(async () => {
    const ledger = loadLedger();
    const jobs = ledger.videoDeletionJobs ?? [];
    ledger.videoDeletionJobs = jobs.map((j) =>
      j.operationId === operationId ? { ...j, ...patch } : j
    );
    saveLedger(ledger);
  });
}

async function fetchLatestDeletionJob(
  videoId: string
): Promise<VideoDeletionJobRecord | null> {
  if (isSqlConfigured()) {
    return getLatestVideoDeletionJobSql(videoId);
  }
  const ledger = loadLedger();
  return (
    (ledger.videoDeletionJobs ?? [])
      .filter((j) => j.videoId === videoId)
      .sort((a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt))[0] ?? null
  );
}

async function fetchDeletionJobs(limitCount = 40): Promise<VideoDeletionJobRecord[]> {
  if (isSqlConfigured()) {
    return listVideoDeletionJobsSql(limitCount);
  }
  const ledger = loadLedger();
  return (ledger.videoDeletionJobs ?? [])
    .slice()
    .sort((a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt))
    .slice(0, limitCount);
}

async function fetchStoredMediaBinding(
  videoId: string
): Promise<CreatorMediaBinding | null> {
  if (isSqlConfigured()) {
    return getCreatorMediaByVideoIdSql(videoId);
  }
  const ledger = loadLedger();
  return ledger.creatorMedia?.[videoId] ?? null;
}

async function removeStoredMediaBinding(
  videoId: string
): Promise<{ deletedCount: number }> {
  if (isSqlConfigured()) {
    return deleteCreatorMediaByVideoIdSql(videoId);
  }
  return withLedgerLock(async () => {
    const ledger = loadLedger();
    if (ledger.creatorMedia && ledger.creatorMedia[videoId]) {
      delete ledger.creatorMedia[videoId];
      saveLedger(ledger);
      return { deletedCount: 1 };
    }
    return { deletedCount: 0 };
  });
}

async function isPlaybackBlockedForToken(payload: PlaybackTokenPayload): Promise<boolean> {
  if (blockedVideoStatuses.has(payload.videoId)) {
    return true;
  }
  try {
    const latestJob = await fetchLatestDeletionJob(payload.videoId);
    if (
      latestJob &&
      (latestJob.status === 'pending' ||
        latestJob.status === 'asset_deleted' ||
        latestJob.status === 'metadata_deleted' ||
        latestJob.status === 'completed')
    ) {
      blockedVideoStatuses.set(payload.videoId, 'deleted');
      return true;
    }
  } catch {
    // Fall through to Firestore check
  }
  if (!payload.creatorPreview) {
    const resolved = await resolveServerVideoState(
      payload.videoId,
      firebaseConfig.projectId,
      firebaseConfig.firestoreDatabaseId
    );
    if (resolved.state !== 'published') {
      return true;
    }
  }
  return false;
}

function isValidSafeId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 128 &&
    /^[a-zA-Z0-9_-]+$/.test(value)
  );
}

function getIdempotencyKey(req: Request): string | undefined {
  const headerKey = req.headers['idempotency-key'];
  if (typeof headerKey === 'string' && headerKey.trim().length >= 6 && headerKey.length <= 128) {
    return headerKey.trim();
  }
  const bodyKey = (req.body as { idempotencyKey?: unknown } | undefined)?.idempotencyKey;
  if (typeof bodyKey === 'string' && bodyKey.trim().length >= 6 && bodyKey.length <= 128) {
    return bodyKey.trim();
  }
  return undefined;
}

function pickStreamKey(videoId: string, category?: string): string {
  if (
    category === 'Documentary' ||
    category === 'Education' ||
    videoId.includes('caldera') ||
    videoId.includes('ocean') ||
    videoId.includes('optics')
  ) {
    return 'stream-doc';
  }
  return 'stream-cinema';
}

function signPlaybackToken(payload: PlaybackTokenPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', PLAYBACK_SECRET)
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

function verifyPlaybackToken(token: string): PlaybackTokenPayload | null {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', PLAYBACK_SECRET)
    .update(encoded)
    .digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf-8')
    ) as PlaybackTokenPayload;
    if (
      !parsed ||
      parsed.v !== 1 ||
      typeof parsed.exp !== 'number' ||
      Date.now() > parsed.exp ||
      !ALLOWED_STREAMS.has(parsed.streamKey)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function signSandboxOrderToken(paymentId: string, userId: string, amount: number): string {
  return crypto
    .createHmac('sha256', PLAYBACK_SECRET)
    .update(`sandbox:${paymentId}:${userId}:${amount}`)
    .digest('hex');
}

// Simple per-IP rate limiter for API routes
const rateBucket = new Map<string, { count: number; resetAt: number }>();
function rateLimitApi(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  if (rateBucket.size > 2000) {
    for (const [k, v] of rateBucket.entries()) {
      if (now > v.resetAt) {
        rateBucket.delete(k);
      }
    }
  }
  const entry = rateBucket.get(ip);
  if (!entry || now > entry.resetAt) {
    rateBucket.set(ip, { count: 1, resetAt: now + 60_000 });
    next();
    return;
  }
  entry.count += 1;
  if (entry.count > 240) {
    res.status(429).json({ error: 'Too many requests. Please slow down.' });
    return;
  }
  next();
}

async function extractUserFromBearer(req: Request): Promise<AuthenticatedUser | null> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  const idToken = header.slice(7).trim();
  if (!idToken) return null;
  try {
    return await verifyFirebaseIdToken(idToken);
  } catch {
    return null;
  }
}

async function optionalAuth(
  req: AuthedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const user = await extractUserFromBearer(req);
  if (user) req.user = user;
  next();
}

async function requireAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const user = await extractUserFromBearer(req);
  if (!user) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  try {
    if (isSqlConfigured()) {
      await getOrCreateSqlUser(user.uid, user.email);
    }
  } catch (err) {
    console.error('SQL user sync failed during requireAuth:', err);
  }
  req.user = user;
  next();
}

async function isServerAdmin(user: AuthenticatedUser): Promise<boolean> {
  if (!user.emailVerified) return false;
  if (user.email === BOOTSTRAPPED_ADMIN_EMAIL) return true;
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      firebaseConfig.projectId
    )}/databases/${encodeURIComponent(
      firebaseConfig.firestoreDatabaseId
    )}/documents/admins/${encodeURIComponent(user.uid)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${user.rawIdToken}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function requireAdmin(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const user = await extractUserFromBearer(req);
  if (!user) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  const ok = await isServerAdmin(user);
  if (!ok) {
    res.status(403).json({ error: 'Administrator privileges required.' });
    return;
  }
  req.user = user;
  next();
}

async function resolveFirestoreVideoAssetForUser(
  videoId: string,
  userIdToken: string
): Promise<CreatorMediaBinding | null> {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      firebaseConfig.projectId
    )}/databases/${encodeURIComponent(
      firebaseConfig.firestoreDatabaseId
    )}/documents/video_assets/${encodeURIComponent(videoId)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${userIdToken}` },
    });
    if (!res.ok) return null;
    const doc = (await res.json()) as {
      fields?: Record<string, { stringValue?: string }>;
    };
    const f = doc.fields;
    if (!f?.assetRef?.stringValue || !f?.creatorId?.stringValue) return null;

    const rawProvider = f.provider?.stringValue || 'private_storage';
    const rawRef = f.assetRef.stringValue;
    const normalized = normalizeMediaSource(rawProvider, rawRef);
    const provider: CreatorMediaBinding['provider'] =
      normalized.provider === 'unknown' ? 'private_storage' : normalized.provider;
    const assetRef = normalized.assetRef;

    return {
      videoId,
      creatorId: f.creatorId.stringValue,
      provider,
      assetRef,
      updatedAtIso: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function safeResolveMediaFile(
  streamKey: string,
  quality: string,
  fileName: string
): string | null {
  if (!ALLOWED_STREAMS.has(streamKey) || !ALLOWED_QUALITIES.has(quality)) {
    return null;
  }
  const baseDir = path.resolve(PRIVATE_MEDIA_DIR, streamKey, quality);
  const target = path.resolve(baseDir, fileName);
  if (!target.startsWith(baseDir + path.sep)) {
    return null;
  }
  return target;
}

function safeResolveUploadedAsset(
  baseRoot: string,
  uid: string,
  fileName: string
): string | null {
  if (!isValidSafeId(uid) || !/^[a-zA-Z0-9._-]+$/.test(fileName)) {
    return null;
  }
  const userDir = path.resolve(baseRoot, uid);
  const target = path.resolve(userDir, fileName);
  if (!target.startsWith(userDir + path.sep)) {
    return null;
  }
  return target;
}

export function createApiApp(): Express {
  const app = express();
  app.set('trust proxy', 1);
  app.use('/api', (_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.use('/api', rateLimitApi);

  // Authenticated Creator Media Upload (Binary MP4/WebM/MOV up to 100MB, JPEG/PNG/WEBP up to 5MB)
  app.post(
    '/api/creator/upload-media',
    requireAuth,
    express.raw({
      type: [
        'video/mp4',
        'video/webm',
        'video/quicktime',
        'image/jpeg',
        'image/jpg',
        'image/png',
        'image/webp',
      ],
      limit: '100mb',
    }),
    async (req: AuthedRequest, res) => {
      const uid = req.user!.uid;
      if (!isValidSafeId(uid)) {
        res.status(400).json({ error: 'Invalid user identifier.' });
        return;
      }

      const contentType = String(req.headers['content-type'] || '')
        .split(';')[0]
        .trim()
        .toLowerCase();
      const bodyBuffer = Buffer.isBuffer(req.body) ? req.body : null;

      if (!bodyBuffer || bodyBuffer.length === 0) {
        res.status(400).json({
          error: 'Empty file upload. Select a valid MP4/WebM/MOV video or JPEG/PNG/WEBP image.',
        });
        return;
      }

      const videoExt = ALLOWED_VIDEO_MIME[contentType];
      const imageExt = ALLOWED_IMAGE_MIME[contentType];

      if (!videoExt && !imageExt) {
        res.status(400).json({
          error: 'Unsupported media format. Allowed: MP4, WebM, MOV, JPG, PNG, WEBP.',
        });
        return;
      }

      if (imageExt && bodyBuffer.length > 5 * 1024 * 1024) {
        res.status(413).json({ error: 'Thumbnail image exceeds 5MB limit.' });
        return;
      }

      const rawOriginal = String(
        req.headers['x-deloken-filename'] || req.headers['x-vyora-filename'] || 'media'
      )
        .replace(/[^a-zA-Z0-9_-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 48);
      const baseSlug = rawOriginal.length >= 2 ? rawOriginal.toLowerCase() : 'deloken-media';
      const uniqueName = `${baseSlug}-${Date.now().toString(36)}-${crypto
        .randomBytes(3)
        .toString('hex')}${videoExt || imageExt}`;

      if (videoExt) {
        const target = safeResolveUploadedAsset(UPLOADS_DIR, uid, uniqueName);
        if (!target) {
          res.status(400).json({ error: 'Invalid upload path.' });
          return;
        }
        try {
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, bodyBuffer);
        } catch (err) {
          res.status(503).json({
            error:
              err instanceof Error
                ? `Video upload storage unavailable: ${err.message}. Use YouTube, Facebook, or Cloudflare Stream.`
                : 'Video file storage unavailable in serverless mode.',
          });
          return;
        }
        res.json({
          kind: 'video',
          provider: 'private_storage',
          assetRef: `private/uploads/${uid}/${uniqueName}`,
          mimeType: contentType,
          sizeBytes: bodyBuffer.length,
        });
        return;
      }

      const target = safeResolveUploadedAsset(THUMBNAILS_DIR, uid, uniqueName);
      if (!target) {
        res.status(400).json({ error: 'Invalid thumbnail upload path.' });
        return;
      }

      try {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, bodyBuffer);
      } catch {
        // Non-fatal in serverless read-only filesystem when SQL thumbnail store is active
      }

      if (!isSqlConfigured()) {
        res.status(503).json({
          error: 'Database PostgreSQL belum dihubungkan. Set DATABASE_URL di Vercel untuk menyimpan cover thumbnail.',
        });
        return;
      }

      await saveThumbnailAssetSql({
        key: `thumb:${uid}:${uniqueName}`,
        creatorId: uid,
        mimeType: contentType,
        base64Data: bodyBuffer.toString('base64'),
        updatedAtIso: new Date().toISOString(),
      });

      res.json({
        kind: 'thumbnail',
        thumbnailUrl: `/api/media/thumb/${encodeURIComponent(uid)}/${encodeURIComponent(
          uniqueName
        )}`,
        mimeType: contentType,
        sizeBytes: bodyBuffer.length,
      });
    }
  );

  app.get('/api/media/thumb/:uid/:fileName', async (req, res) => {
    const { uid, fileName } = req.params;
    const target = safeResolveUploadedAsset(THUMBNAILS_DIR, uid, fileName);
    if (!target) {
      res.status(400).json({ error: 'Invalid thumbnail path.' });
      return;
    }

    try {
      if (fs.existsSync(target)) {
        const ext = path.extname(fileName).toLowerCase();
        const mime =
          ext === '.png'
            ? 'image/png'
            : ext === '.webp'
            ? 'image/webp'
            : 'image/jpeg';
        res.setHeader('Content-Type', mime);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        const stream = fs.createReadStream(target);
        stream.on('error', () => {
          if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to read thumbnail file.' });
          }
        });
        stream.pipe(res);
        return;
      }

      if (!isSqlConfigured()) {
        res.status(404).json({ error: 'Thumbnail not found.' });
        return;
      }

      const sqlThumb = await getThumbnailAssetSql(`thumb:${uid}:${fileName}`);
      if (!sqlThumb) {
        res.status(404).json({ error: 'Thumbnail not found.' });
        return;
      }

      const buf = Buffer.from(sqlThumb.base64Data, 'base64');
      try {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, buf);
      } catch {
        // Non-fatal if disk cache write fails
      }

      res.setHeader('Content-Type', sqlThumb.mimeType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(buf);
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Unable to load thumbnail asset.',
        });
      }
    }
  });

  app.use(express.json({ limit: '128kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      databaseConfigured: isSqlConfigured(),
      previewLimitSeconds: PREVIEW_LIMIT_SECONDS,
      accessDaysDuration: 30,
      gateways: {
        paypalConfigured: isPayPalConfigured(),
        paypalPaymentLinkConfigured: Boolean(getPayPalPaymentLink()),
        midtransQrisConfigured: isMidtransConfigured(),
        sandboxPreviewAllowed: !IS_PRODUCTION,
      },
      media: {
        cloudflareStreamConfigured: isCloudflareStreamConfigured(),
        cloudflareSigningConfigured: isCloudflareSigningConfigured(),
      },
      serverTimeIso: new Date().toISOString(),
    });
  });

  // =========================================================================
  // CLOUDFLARE STREAM DIRECT CREATOR UPLOAD (>100MB CHUNKED TUS + SIGNED HLS)
  // =========================================================================

  app.post(
    '/api/creator/cloudflare-direct-upload',
    requireAuth,
    async (req: AuthedRequest, res) => {
      if (!isCloudflareStreamConfigured()) {
        res.status(503).json({
          error:
            'Cloudflare Stream is not configured. Set CLOUDFLARE_STREAM_ACCOUNT_ID and CLOUDFLARE_STREAM_API_TOKEN in server Secrets.',
        });
        return;
      }

      const { uploadLength, filename, maxDurationSeconds } = req.body as {
        uploadLength?: unknown;
        filename?: unknown;
        maxDurationSeconds?: unknown;
      };

      const maxAllowedBytes = 30 * 1024 * 1024 * 1024; // 30 GB
      if (
        typeof uploadLength !== 'number' ||
        !Number.isFinite(uploadLength) ||
        uploadLength < 1024 ||
        uploadLength > maxAllowedBytes
      ) {
        res.status(400).json({
          error: 'Invalid uploadLength (expected 1 KB to 30 GB).',
        });
        return;
      }

      try {
        const result = await createCloudflareTusDirectUpload({
          uploadLength,
          creatorId: req.user!.uid,
          filename: typeof filename === 'string' ? filename : undefined,
          maxDurationSeconds:
            typeof maxDurationSeconds === 'number' ? maxDurationSeconds : 21600,
        });
        res.json({
          ...result,
          provider: 'cloudflare_stream' as const,
        });
      } catch (err) {
        res.status(502).json({
          error:
            err instanceof Error
              ? err.message
              : 'Failed to create Cloudflare Stream upload session.',
        });
      }
    }
  );

  app.get(
    '/api/creator/cloudflare-status/:uid',
    requireAuth,
    async (req: AuthedRequest, res) => {
      if (!isCloudflareStreamConfigured()) {
        res.status(503).json({ error: 'Cloudflare Stream is not configured.' });
        return;
      }
      const cfUid = req.params.uid;
      if (!isValidSafeId(cfUid)) {
        res.status(400).json({ error: 'Invalid Cloudflare Stream video UID.' });
        return;
      }
      try {
        const status = await getCloudflareVideoStatus(cfUid);
        res.json(status);
      } catch (err) {
        res.status(502).json({
          error:
            err instanceof Error
              ? err.message
              : 'Unable to query Cloudflare Stream video status.',
        });
      }
    }
  );

  // =========================================================================
  // PHASE 3: STREAMING AUTHORIZATION & SIGNED HLS DELIVERY
  // =========================================================================

  const inspectRateMap = new Map<string, { count: number; resetAt: number }>();

  app.post(
    '/api/creator/inspect-video-link',
    requireAuth,
    async (req: AuthedRequest, res) => {
      const uid = req.user!.uid;
      const now = Date.now();
      const bucket = inspectRateMap.get(uid);
      if (!bucket || now > bucket.resetAt) {
        inspectRateMap.set(uid, { count: 1, resetAt: now + 60_000 });
      } else {
        bucket.count += 1;
        if (bucket.count > 25) {
          res.status(429).json({
            error: 'Terlalu banyak pemeriksaan tautan dalam 1 menit. Tunggu sebentar lalu coba lagi.',
          });
          return;
        }
      }

      const { url } = req.body as { url?: unknown };
      if (typeof url !== 'string' || url.trim().length === 0 || url.trim().length > 980) {
        res.status(400).json({
          error: 'Masukkan tautan HTTPS video yang valid (maksimal 980 karakter).',
        });
        return;
      }

      try {
        const result = await inspectUniversalVideoLink(url.trim());
        res.json(result);
      } catch (err) {
        res.status(500).json({
          error:
            err instanceof Error
              ? err.message
              : 'Gagal memeriksa tautan video di server.',
        });
      }
    }
  );

  const ALLOWED_REGISTER_PROVIDERS = new Set<VideoAssetProvider>([
    'cloudflare_stream',
    'private_storage',
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

  app.post(
    '/api/creator/register-video-media',
    requireAuth,
    async (req: AuthedRequest, res) => {
      const uid = req.user!.uid;
      const { videoId, provider, assetRef, mimeType } = req.body as {
        videoId?: unknown;
        provider?: unknown;
        assetRef?: unknown;
        mimeType?: unknown;
      };

      if (
        !isValidSafeId(videoId) ||
        typeof provider !== 'string' ||
        !ALLOWED_REGISTER_PROVIDERS.has(provider as VideoAssetProvider) ||
        typeof assetRef !== 'string' ||
        assetRef.trim().length < 3 ||
        assetRef.trim().length > 1000
      ) {
        res.status(400).json({ error: 'Invalid video media registration payload.' });
        return;
      }

      const typedProvider = provider as VideoAssetProvider;
      let trimmedRef = assetRef.trim();

      if (typedProvider === 'youtube') {
        const ytTarget = extractYouTubeEmbedTarget(trimmedRef);
        if (!ytTarget) {
          res.status(400).json({
            error:
              'Invalid YouTube link or ID. Use a standard youtube.com/watch?v=..., youtu.be/..., or youtube.com/playlist?list=... link.',
          });
          return;
        }
        trimmedRef = ytTarget.canonicalRef;
      } else if (typedProvider === 'facebook') {
        const fbUrl = extractFacebookVideoUrl(trimmedRef);
        if (!fbUrl) {
          res.status(400).json({
            error:
              'Invalid Facebook video link. Use a public facebook.com/.../videos/..., facebook.com/watch?v=..., facebook.com/reel/..., or fb.watch/... URL.',
          });
          return;
        }
        trimmedRef = fbUrl;
      } else if (typedProvider === 'vimeo') {
        const vimeo = extractVimeoVideoRef(trimmedRef);
        if (!vimeo) {
          res.status(400).json({ error: 'Invalid Vimeo video URL or ID.' });
          return;
        }
        trimmedRef = vimeo.canonicalRef;
      } else if (typedProvider === 'dailymotion') {
        const dmId = extractDailymotionVideoId(trimmedRef);
        if (!dmId) {
          res.status(400).json({ error: 'Invalid Dailymotion video URL or ID.' });
          return;
        }
        trimmedRef = dmId;
      } else if (typedProvider === 'streamable') {
        const stId = extractStreamableId(trimmedRef);
        if (!stId) {
          res.status(400).json({ error: 'Invalid Streamable video URL or ID.' });
          return;
        }
        trimmedRef = stId;
      } else if (typedProvider === 'tiktok') {
        const tt = extractTikTokVideoInfo(trimmedRef);
        if (!tt) {
          res.status(400).json({ error: 'Invalid TikTok video URL.' });
          return;
        }
        trimmedRef = tt.canonicalRef;
      } else if (typedProvider === 'x') {
        const xInfo = extractXPostInfo(trimmedRef);
        if (!xInfo) {
          res.status(400).json({ error: 'Invalid X (Twitter) status URL.' });
          return;
        }
        trimmedRef = xInfo.canonicalUrl;
      } else if (typedProvider === 'instagram') {
        const ig = extractInstagramPostInfo(trimmedRef);
        if (!ig) {
          res.status(400).json({ error: 'Invalid Instagram post or reel URL.' });
          return;
        }
        trimmedRef = ig.canonicalUrl;
      } else if (typedProvider === 'direct_video') {
        const guard = parseStrictHttpsUrl(trimmedRef, { allowBareHostname: false });
        if (!guard.ok) {
          res.status(400).json({ error: guard.messageEn });
          return;
        }
        trimmedRef = guard.url.toString();
      } else if (trimmedRef.startsWith('private/uploads/')) {
        const expectedPrefix = `private/uploads/${uid}/`;
        if (!trimmedRef.startsWith(expectedPrefix)) {
          res.status(403).json({ error: 'You may only bind media uploaded by your account.' });
          return;
        }
      }

      try {
        await upsertCreatorMediaSql({
          videoId,
          creatorId: uid,
          provider: typedProvider,
          assetRef: trimmedRef,
          mimeType: typeof mimeType === 'string' ? mimeType.slice(0, 60) : undefined,
          updatedAtIso: new Date().toISOString(),
        });
        res.json({ ok: true, videoId });
      } catch (err) {
        res.status(isSqlConfigured() ? 500 : 503).json({
          error:
            err instanceof Error ? err.message : 'Failed to save video media mapping.',
        });
      }
    }
  );

  app.post('/api/stream/authorize', optionalAuth, async (req: AuthedRequest, res) => {
    const { videoId, category } = req.body as {
      videoId?: unknown;
      category?: unknown;
    };

    if (!isValidSafeId(videoId)) {
      res.status(400).json({ error: 'Invalid videoId.' });
      return;
    }

    const now = Date.now();
    const uid = req.user?.uid ?? 'anonymous';
    const sqlReady = isSqlConfigured();

    let record: ServerEntitlement | null = null;
    let mediaBinding: CreatorMediaBinding | null = null;
    let resolvedVideo = null;
    let videoLifecycleState: Awaited<ReturnType<typeof resolveServerVideoState>>['state'] =
      'unavailable';
    let latestDeletionJob: VideoDeletionJobRecord | null = null;

    try {
      const [ctx, videoState, priorJob] = await Promise.all([
        sqlReady
          ? getStreamAuthContextSql(req.user?.uid, videoId)
          : Promise.resolve({
              entitlement: null,
              mediaBinding: loadLedger().creatorMedia?.[videoId] ?? null,
            }),
        resolveServerVideoState(
          videoId,
          firebaseConfig.projectId,
          firebaseConfig.firestoreDatabaseId,
          req.user?.rawIdToken
        ),
        fetchLatestDeletionJob(videoId).catch(() => null),
      ]);
      record = ctx.entitlement;
      mediaBinding = ctx.mediaBinding;
      resolvedVideo = videoState.entry;
      videoLifecycleState = videoState.state;
      latestDeletionJob = priorJob;

      // Auto-resolve from Firestore video_assets for creator/admin & backfill SQL when available
      if (!mediaBinding && req.user?.rawIdToken) {
        const firestoreBinding = await resolveFirestoreVideoAssetForUser(
          videoId,
          req.user.rawIdToken
        );
        if (firestoreBinding) {
          mediaBinding = firestoreBinding;
          if (sqlReady) {
            void upsertCreatorMediaSql({
              videoId: firestoreBinding.videoId,
              creatorId: firestoreBinding.creatorId,
              provider: firestoreBinding.provider,
              assetRef: firestoreBinding.assetRef,
              updatedAtIso: firestoreBinding.updatedAtIso,
            }).catch(() => {});
          }
        }
      }
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to authorize stream.',
      });
      return;
    }

    const activeDeletionBlock =
      blockedVideoStatuses.get(videoId) === 'deletion_pending' ||
      blockedVideoStatuses.get(videoId) === 'deleted' ||
      Boolean(
        latestDeletionJob &&
          (latestDeletionJob.status === 'pending' ||
            latestDeletionJob.status === 'asset_deleted' ||
            latestDeletionJob.status === 'metadata_deleted' ||
            latestDeletionJob.status === 'completed')
      );

    if (videoLifecycleState === 'deletion_pending' || activeDeletionBlock) {
      res.status(410).json({
        error: 'Video ini telah dihapus atau sedang dalam proses penghapusan permanen.',
        code: 'VIDEO_DELETED_OR_PENDING',
      });
      return;
    }

    if (
      videoLifecycleState === 'archived' ||
      blockedVideoStatuses.get(videoId) === 'archived'
    ) {
      res.status(403).json({
        error: 'Video ini telah diarsipkan dan tidak lagi tersedia untuk pemutaran.',
        code: 'VIDEO_ARCHIVED',
      });
      return;
    }

    if (videoLifecycleState === 'not_found') {
      res.status(404).json({
        error: 'Video tidak ditemukan atau telah dihapus dari katalog.',
        code: 'VIDEO_NOT_FOUND',
      });
      return;
    }

    if (videoLifecycleState === 'unavailable') {
      res.status(403).json({
        error: 'Video ini belum dipublikasikan, telah diarsipkan, atau tidak tersedia.',
        code: 'VIDEO_UNAVAILABLE',
      });
      return;
    }

    if (videoLifecycleState === 'error') {
      res.status(503).json({
        error: 'Gagal memverifikasi status ketersediaan video dari server.',
        code: 'VIDEO_STATUS_CHECK_FAILED',
      });
      return;
    }

    const isCreatorPreview = Boolean(
      req.user?.uid &&
        ((resolvedVideo && resolvedVideo.creatorId === req.user.uid) ||
          (mediaBinding && mediaBinding.creatorId === req.user.uid))
    );

    if (videoLifecycleState !== 'published' && !isCreatorPreview) {
      res.status(403).json({
        error: 'Video ini belum tersedia untuk publik.',
        code: 'VIDEO_NOT_PUBLISHED',
      });
      return;
    }

    const isFreeRelease = Boolean(
      resolvedVideo &&
        resolvedVideo.priceUsd === 0 &&
        resolvedVideo.priceIdr === 0 &&
        resolvedVideo.creditCost === 0
    );
    const hasPaidEntitlement = Boolean(
      record && record.status !== 'revoked' && now < record.expiresAtMs
    );
    const isActive = Boolean(hasPaidEntitlement || isCreatorPreview || isFreeRelease);
    const mode: 'preview' | 'full' = isActive ? 'full' : 'preview';
    const maxSeg = isActive ? FULL_MAX_SEGMENT_INDEX : PREVIEW_MAX_SEGMENT_INDEX;

    const entitlementPayload =
      hasPaidEntitlement && record
        ? {
            status: 'active' as const,
            expiresAt: new Date(record.expiresAtMs).toISOString(),
            remainingDays: Math.max(
              1,
              Math.ceil((record.expiresAtMs - now) / (24 * 60 * 60 * 1000))
            ),
          }
        : isCreatorPreview
        ? {
            status: 'active' as const,
            expiresAt: new Date(now + ACCESS_WINDOW_MS).toISOString(),
            remainingDays: 30,
          }
        : null;

    // Check if this video has an uploaded MP4/WebM master file on disk
    if (
      mediaBinding &&
      mediaBinding.provider === 'private_storage' &&
      mediaBinding.assetRef.startsWith('private/uploads/')
    ) {
      const relParts = mediaBinding.assetRef.replace('private/uploads/', '').split('/');
      if (relParts.length === 2) {
        const [ownerUid, fileName] = relParts;
        const resolved = safeResolveUploadedAsset(UPLOADS_DIR, ownerUid, fileName);
        if (resolved && fs.existsSync(resolved)) {
          const token = signPlaybackToken({
            v: 1,
            uid,
            videoId,
            streamKey: 'uploaded-file',
            mode,
            maxSeg,
            exp: now + (isActive ? 1800_000 : 600_000),
            jti: crypto.randomUUID(),
            fileRef: `${ownerUid}/${fileName}`,
            mimeType: mediaBinding.mimeType || 'video/mp4',
            creatorPreview: isCreatorPreview && videoLifecycleState !== 'published',
          });
          res.json({
            mode,
            isFree: isFreeRelease,
            streamType: 'file',
            videoId,
            previewLimitSeconds: PREVIEW_LIMIT_SECONDS,
            resumeSeconds: hasPaidEntitlement && record ? record.resumeSeconds : 0,
            manifestUrl: `/api/stream/file?token=${encodeURIComponent(token)}`,
            entitlement: entitlementPayload,
            serverTimeIso: new Date(now).toISOString(),
          });
          return;
        }
      }
    }

    // Check if this video is bound to Cloudflare Stream (Encrypted Adaptive HLS)
    if (
      mediaBinding &&
      mediaBinding.provider === 'cloudflare_stream' &&
      isValidSafeId(mediaBinding.assetRef.trim()) &&
      mediaBinding.assetRef.trim() !== 'stream-cinema' &&
      mediaBinding.assetRef.trim() !== 'stream-doc'
    ) {
      const cfUid = mediaBinding.assetRef.trim();
      const ttlSeconds = isActive ? 3600 : 420;
      const signedToken = signCloudflareStreamToken(cfUid, { ttlSeconds });
      const manifestUrl = buildCloudflareHlsUrl(signedToken || cfUid);

      res.json({
        mode,
        isFree: isFreeRelease,
        streamType: 'hls',
        provider: 'cloudflare_stream',
        signedHls: Boolean(signedToken),
        videoId,
        previewLimitSeconds: PREVIEW_LIMIT_SECONDS,
        resumeSeconds: hasPaidEntitlement && record ? record.resumeSeconds : 0,
        manifestUrl,
        entitlement: entitlementPayload,
        serverTimeIso: new Date(now).toISOString(),
      });
      return;
    }

    // Check if this video is bound to YouTube (Unlisted / Public Embed via IFrame API)
    if (
      mediaBinding &&
      (mediaBinding.provider === 'youtube' ||
        (mediaBinding.provider === 'private_storage' &&
          mediaBinding.assetRef.startsWith('youtube:')))
    ) {
      const ytTarget = extractYouTubeEmbedTarget(mediaBinding.assetRef);
      if (ytTarget) {
        res.json({
          mode,
          isFree: isFreeRelease,
          streamType: 'youtube',
          provider: 'youtube',
          ...(ytTarget.kind === 'video'
            ? { youtubeVideoId: ytTarget.videoId }
            : { youtubePlaylistId: ytTarget.playlistId }),
          videoId,
          previewLimitSeconds: PREVIEW_LIMIT_SECONDS,
          resumeSeconds: hasPaidEntitlement && record ? record.resumeSeconds : 0,
          manifestUrl: ytTarget.embedUrl,
          entitlement: entitlementPayload,
          serverTimeIso: new Date(now).toISOString(),
        });
        return;
      }
    }

    // Check if this video is bound to Facebook (Public Embedded Video Plugin)
    if (
      mediaBinding &&
      (mediaBinding.provider === 'facebook' ||
        (mediaBinding.provider === 'private_storage' &&
          mediaBinding.assetRef.startsWith('facebook:')))
    ) {
      const fbUrl = extractFacebookVideoUrl(mediaBinding.assetRef);
      if (fbUrl) {
        const resumeAt = hasPaidEntitlement && record ? record.resumeSeconds : 0;

        res.json({
          mode,
          isFree: isFreeRelease,
          streamType: 'facebook',
          provider: 'facebook',
          facebookVideoUrl: fbUrl,
          videoId,
          previewLimitSeconds: PREVIEW_LIMIT_SECONDS,
          resumeSeconds: resumeAt,
          manifestUrl: getFacebookEmbedUrl(fbUrl, {
            autoplay: true,
            startSeconds: resumeAt,
          }),
          entitlement: entitlementPayload,
          serverTimeIso: new Date(now).toISOString(),
        });
        return;
      }
    }

    // Check Vimeo (Official Vimeo Player Embed + postMessage API)
    if (
      mediaBinding &&
      (mediaBinding.provider === 'vimeo' ||
        (mediaBinding.provider === 'private_storage' &&
          mediaBinding.assetRef.startsWith('vimeo:')))
    ) {
      const vimeo = extractVimeoVideoRef(mediaBinding.assetRef);
      if (vimeo) {
        res.json({
          mode,
          isFree: isFreeRelease,
          streamType: 'vimeo',
          provider: 'vimeo',
          vimeoVideoId: vimeo.id,
          vimeoHash: vimeo.hash,
          videoId,
          previewLimitSeconds: PREVIEW_LIMIT_SECONDS,
          resumeSeconds: hasPaidEntitlement && record ? record.resumeSeconds : 0,
          manifestUrl: vimeo.embedUrl,
          entitlement: entitlementPayload,
          serverTimeIso: new Date(now).toISOString(),
        });
        return;
      }
    }

    // Check Dailymotion (Official Embed Player API)
    if (
      mediaBinding &&
      (mediaBinding.provider === 'dailymotion' ||
        (mediaBinding.provider === 'private_storage' &&
          mediaBinding.assetRef.startsWith('dailymotion:')))
    ) {
      const dmId = extractDailymotionVideoId(mediaBinding.assetRef);
      if (dmId) {
        res.json({
          mode,
          isFree: isFreeRelease,
          streamType: 'dailymotion',
          provider: 'dailymotion',
          dailymotionVideoId: dmId,
          videoId,
          previewLimitSeconds: PREVIEW_LIMIT_SECONDS,
          resumeSeconds: hasPaidEntitlement && record ? record.resumeSeconds : 0,
          manifestUrl: `https://www.dailymotion.com/embed/video/${dmId}?api=postMessage&autoplay=1`,
          entitlement: entitlementPayload,
          serverTimeIso: new Date(now).toISOString(),
        });
        return;
      }
    }

    // Check Streamable / TikTok
    if (mediaBinding && mediaBinding.provider === 'streamable') {
      const stId = extractStreamableId(mediaBinding.assetRef);
      if (stId) {
        res.json({
          mode,
          isFree: isFreeRelease,
          streamType: 'streamable',
          provider: 'streamable',
          streamableId: stId,
          videoId,
          previewLimitSeconds: PREVIEW_LIMIT_SECONDS,
          resumeSeconds: hasPaidEntitlement && record ? record.resumeSeconds : 0,
          manifestUrl: `https://streamable.com/e/${stId}?autoplay=1`,
          entitlement: entitlementPayload,
          serverTimeIso: new Date(now).toISOString(),
        });
        return;
      }
    }

    if (mediaBinding && mediaBinding.provider === 'tiktok') {
      const tt = extractTikTokVideoInfo(mediaBinding.assetRef);
      if (tt?.videoId) {
        res.json({
          mode,
          isFree: isFreeRelease,
          streamType: 'tiktok',
          provider: 'tiktok',
          videoId,
          previewLimitSeconds: PREVIEW_LIMIT_SECONDS,
          resumeSeconds: hasPaidEntitlement && record ? record.resumeSeconds : 0,
          manifestUrl: `https://www.tiktok.com/player/v1/${tt.videoId}?autoplay=1&controls=1`,
          entitlement: entitlementPayload,
          serverTimeIso: new Date(now).toISOString(),
        });
        return;
      }
    }

    // Check Direct HTTPS Video / HLS (.m3u8) / MPEG-DASH (.mpd)
    if (
      mediaBinding &&
      (mediaBinding.provider === 'direct_video' ||
        (mediaBinding.provider === 'private_storage' &&
          mediaBinding.assetRef.startsWith('direct:')))
    ) {
      const cleanDirect = mediaBinding.assetRef.startsWith('direct:')
        ? mediaBinding.assetRef.slice('direct:'.length).trim()
        : mediaBinding.assetRef.trim();
      const guard = parseStrictHttpsUrl(cleanDirect, { allowBareHostname: false });
      if (guard.ok) {
        const mimeLower = (mediaBinding.mimeType || '').toLowerCase();
        const inferredFormat: DirectStreamFormat =
          mimeLower.includes('mpegurl') || mimeLower.includes('hls')
            ? 'hls'
            : mimeLower.includes('dash')
            ? 'dash'
            : inferDirectFormatFromUrl(guard.url) ?? 'mp4';

        res.json({
          mode,
          isFree: isFreeRelease,
          streamType: 'direct_video',
          provider: 'direct_video',
          directFormat: inferredFormat,
          videoId,
          previewLimitSeconds: PREVIEW_LIMIT_SECONDS,
          resumeSeconds: hasPaidEntitlement && record ? record.resumeSeconds : 0,
          manifestUrl: guard.url.toString(),
          entitlement: entitlementPayload,
          serverTimeIso: new Date(now).toISOString(),
        });
        return;
      }
    }

    const mappedPreset =
      mediaBinding?.assetRef === 'stream-doc'
        ? 'stream-doc'
        : mediaBinding?.assetRef === 'stream-cinema'
        ? 'stream-cinema'
        : null;
    const streamKey =
      mappedPreset ??
      pickStreamKey(videoId, typeof category === 'string' ? category : undefined);

    const token = signPlaybackToken({
      v: 1,
      uid,
      videoId,
      streamKey,
      mode,
      maxSeg,
      exp: now + (isActive ? 1800_000 : 600_000),
      jti: crypto.randomUUID(),
      creatorPreview: isCreatorPreview && videoLifecycleState !== 'published',
    });

    res.json({
      mode,
      isFree: isFreeRelease,
      streamType: 'hls',
      videoId,
      previewLimitSeconds: PREVIEW_LIMIT_SECONDS,
      resumeSeconds: hasPaidEntitlement && record ? record.resumeSeconds : 0,
      manifestUrl: `/api/stream/master.m3u8?token=${encodeURIComponent(token)}`,
      entitlement: entitlementPayload,
      serverTimeIso: new Date(now).toISOString(),
    });
  });

  app.get('/api/stream/file', async (req, res) => {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    const payload = verifyPlaybackToken(token);
    if (!payload || payload.streamKey !== 'uploaded-file' || !payload.fileRef) {
      res.status(403).json({ error: 'Invalid or expired file playback token.' });
      return;
    }

    if (await isPlaybackBlockedForToken(payload)) {
      res.status(403).json({ error: 'This release is archived or no longer available.' });
      return;
    }

    const parts = payload.fileRef.split('/');
    if (parts.length !== 2) {
      res.status(400).json({ error: 'Invalid media reference.' });
      return;
    }
    const targetFile = safeResolveUploadedAsset(UPLOADS_DIR, parts[0], parts[1]);
    if (!targetFile || !fs.existsSync(targetFile)) {
      res.status(404).json({ error: 'Uploaded media file not found.' });
      return;
    }

    const stat = fs.statSync(targetFile);
    const total = stat.size;
    const ext = path.extname(parts[1]).toLowerCase();
    const contentType =
      ext === '.webm'
        ? 'video/webm'
        : ext === '.mov'
        ? 'video/quicktime'
        : payload.mimeType || 'video/mp4';

    const range = req.headers.range;
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, no-store');

    if (range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(range);
      if (!match) {
        res.status(416).setHeader('Content-Range', `bytes */${total}`).end();
        return;
      }
      const start = Number(match[1]);
      const end = match[2] ? Math.min(total - 1, Number(match[2])) : Math.min(total - 1, start + 2 * 1024 * 1024 - 1);
      if (start >= total || start > end) {
        res.status(416).setHeader('Content-Range', `bytes */${total}`).end();
        return;
      }
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
      res.setHeader('Content-Length', String(end - start + 1));
      res.setHeader('Content-Type', contentType);
      const stream = fs.createReadStream(targetFile, { start, end });
      stream.pipe(res);
      res.on('close', () => stream.destroy());
      return;
    }

    res.setHeader('Content-Length', String(total));
    res.setHeader('Content-Type', contentType);
    const stream = fs.createReadStream(targetFile);
    stream.pipe(res);
    res.on('close', () => stream.destroy());
  });

  app.get('/api/stream/master.m3u8', async (req, res) => {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    const payload = verifyPlaybackToken(token);
    if (!payload) {
      res.status(403).json({ error: 'Invalid or expired playback token.' });
      return;
    }

    if (await isPlaybackBlockedForToken(payload)) {
      res.status(403).json({ error: 'This release is archived or no longer available.' });
      return;
    }

    const encodedToken = encodeURIComponent(token);
    const masterPlaylist = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-STREAM-INF:BANDWIDTH=980000,RESOLUTION=1280x720,NAME="720p"',
      `/api/stream/variant.m3u8?token=${encodedToken}&quality=720p`,
      '#EXT-X-STREAM-INF:BANDWIDTH=510000,RESOLUTION=854x480,NAME="480p"',
      `/api/stream/variant.m3u8?token=${encodedToken}&quality=480p`,
      '',
    ].join('\n');

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(masterPlaylist);
  });

  app.get('/api/stream/variant.m3u8', (req, res) => {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    const quality = typeof req.query.quality === 'string' ? req.query.quality : '720p';
    const payload = verifyPlaybackToken(token);
    if (!payload) {
      res.status(403).json({ error: 'Invalid or expired playback token.' });
      return;
    }
    if (blockedVideoStatuses.has(payload.videoId)) {
      res.status(403).json({ error: 'This release is archived or no longer available.' });
      return;
    }

    const playlistFile = safeResolveMediaFile(payload.streamKey, quality, 'index.m3u8');
    if (!playlistFile || !fs.existsSync(playlistFile)) {
      res.status(404).json({ error: 'Stream playlist unavailable.' });
      return;
    }

    const rawLines = fs.readFileSync(playlistFile, 'utf-8').split('\n');
    const outputLines: string[] = [];
    const encodedToken = encodeURIComponent(token);
    let pendingExtInf: string | null = null;

    for (const line of rawLines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith('#EXTINF:')) {
        pendingExtInf = trimmed;
        continue;
      }

      if (/^seg_(\d+)\.ts$/.test(trimmed)) {
        const match = /^seg_(\d+)\.ts$/.exec(trimmed);
        const segIndex = match ? Number(match[1]) : 9999;
        if (segIndex <= payload.maxSeg) {
          if (pendingExtInf) outputLines.push(pendingExtInf);
          outputLines.push(
            `/api/stream/segment/${segIndex}?token=${encodedToken}&quality=${encodeURIComponent(
              quality
            )}`
          );
        }
        pendingExtInf = null;
        continue;
      }

      if (trimmed === '#EXT-X-ENDLIST') {
        continue;
      }

      outputLines.push(trimmed);
    }

    outputLines.push('#EXT-X-ENDLIST', '');
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(outputLines.join('\n'));
  });

  app.get('/api/stream/segment/:index', (req, res) => {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    const quality = typeof req.query.quality === 'string' ? req.query.quality : '720p';
    const payload = verifyPlaybackToken(token);
    if (!payload) {
      res.status(403).json({ error: 'Invalid or expired playback token.' });
      return;
    }
    if (blockedVideoStatuses.has(payload.videoId)) {
      res.status(403).json({ error: 'This release is archived or no longer available.' });
      return;
    }

    const rawIndex = req.params.index;
    if (!/^\d{1,4}$/.test(rawIndex)) {
      res.status(400).json({ error: 'Invalid segment index.' });
      return;
    }
    const segIndex = Number(rawIndex);

    if (segIndex > payload.maxSeg) {
      res.status(402).json({
        error: 'PREVIEW_LIMIT_REACHED',
        message:
          'Five-minute free preview reached. Unlock 30-day access to continue playback.',
      });
      return;
    }

    const padded = String(segIndex).padStart(3, '0');
    const segFile = safeResolveMediaFile(payload.streamKey, quality, `seg_${padded}.ts`);
    if (!segFile || !fs.existsSync(segFile)) {
      res.status(404).json({ error: 'Segment not found.' });
      return;
    }

    res.setHeader('Content-Type', 'video/mp2t');
    res.setHeader('Cache-Control', 'private, no-store');
    const stream = fs.createReadStream(segFile);
    stream.on('error', () => {
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to stream media segment.' });
      } else {
        res.end();
      }
    });
    res.on('close', () => {
      stream.destroy();
    });
    stream.pipe(res);
  });

  app.get('/api/entitlements/me', requireAuth, async (req: AuthedRequest, res) => {
    if (!isSqlConfigured()) {
      res.json({ entitlements: [], serverTimeIso: new Date().toISOString() });
      return;
    }
    const uid = req.user!.uid;
    const now = Date.now();
    try {
      const entList = await getUserEntitlementsSql(uid);
      const items = entList.map((ent) => {
        const isRevoked = ent.status === 'revoked';
        const isExpired = isRevoked || now >= ent.expiresAtMs;
        return {
          id: ent.id,
          userId: ent.userId,
          videoId: ent.videoId,
          videoTitle: ent.videoTitle,
          thumbnailUrl: ent.thumbnailUrl,
          status: isRevoked ? 'revoked' : isExpired ? 'expired' : 'active',
          resumeSeconds: ent.resumeSeconds,
          expiresAt: new Date(ent.expiresAtMs).toISOString(),
          createdAt: new Date(ent.grantedAtMs).toISOString(),
          remainingDays: isExpired
            ? 0
            : Math.max(1, Math.ceil((ent.expiresAtMs - now) / (24 * 60 * 60 * 1000))),
        };
      });

      res.json({ entitlements: items, serverTimeIso: new Date(now).toISOString() });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Unable to load entitlements.',
      });
    }
  });

  app.post('/api/playback/progress', requireAuth, async (req: AuthedRequest, res) => {
    const { videoId, positionSeconds } = req.body as {
      videoId?: unknown;
      positionSeconds?: unknown;
    };
    if (!isValidSafeId(videoId) || typeof positionSeconds !== 'number') {
      res.status(400).json({ error: 'Invalid videoId or positionSeconds.' });
      return;
    }

    try {
      const videoState = await resolveServerVideoState(
        videoId,
        firebaseConfig.projectId,
        firebaseConfig.firestoreDatabaseId,
        req.user?.rawIdToken
      );
      if (
        blockedVideoStatuses.has(videoId) ||
        videoState.state === 'archived' ||
        videoState.state === 'deletion_pending' ||
        videoState.state === 'not_found' ||
        videoState.state === 'unavailable'
      ) {
        res.status(403).json({ error: 'Release is archived or unavailable.' });
        return;
      }

      const result = await updatePlaybackProgressSql(
        req.user!.uid,
        videoId,
        positionSeconds
      );
      if (!result.ok) {
        res.status(403).json({ error: 'No active entitlement for this release.' });
        return;
      }
      res.json(result);
    } catch (err) {
      res.status(isSqlConfigured() ? 500 : 503).json({
        error: err instanceof Error ? err.message : 'Failed to update progress.',
      });
    }
  });

  app.post(
    '/api/entitlements/activate-phase3-pass',
    requireAuth,
    async (req: AuthedRequest, res) => {
      if (IS_PRODUCTION) {
        res.status(403).json({
          error:
            'Trial entitlement activation is disabled in production. Use verified PayPal, QRIS, or Credit Wallet checkout.',
        });
        return;
      }

      const { videoId, videoTitle, thumbnailUrl, resumeSeconds } = req.body as {
        videoId?: unknown;
        videoTitle?: unknown;
        thumbnailUrl?: unknown;
        resumeSeconds?: unknown;
      };

      if (!isValidSafeId(videoId)) {
        res.status(400).json({ error: 'Invalid videoId.' });
        return;
      }

      const now = Date.now();
      const uid = req.user!.uid;
      const safeResume =
        typeof resumeSeconds === 'number'
          ? Math.max(0, Math.min(36000, Math.floor(resumeSeconds)))
          : PREVIEW_LIMIT_SECONDS;

      const record: ServerEntitlement = {
        id: `ent_${uid.slice(0, 8)}_${videoId}`,
        userId: uid,
        videoId,
        videoTitle:
          typeof videoTitle === 'string' ? videoTitle.slice(0, 140) : videoId,
        thumbnailUrl:
          typeof thumbnailUrl === 'string' ? thumbnailUrl.slice(0, 500) : '',
        grantedAtMs: now,
        expiresAtMs: now + ACCESS_WINDOW_MS,
        resumeSeconds: safeResume,
        status: 'active',
        source: 'phase3_trial_pass',
      };

      try {
        await upsertTrialEntitlementSql(record);
        res.json({
          entitlement: {
            id: record.id,
            videoId: record.videoId,
            status: 'active',
            resumeSeconds: record.resumeSeconds,
            expiresAt: new Date(record.expiresAtMs).toISOString(),
            remainingDays: 30,
          },
        });
      } catch (err) {
        res.status(isSqlConfigured() ? 500 : 503).json({
          error: err instanceof Error ? err.message : 'Unable to activate pass.',
        });
      }
    }
  );

  // =========================================================================
  // PHASE 4: CREDIT WALLET, PAYPAL, QRIS, WEBHOOKS, CREATOR PAYOUTS & REFUNDS
  // =========================================================================

  // Viewer Wallet, Immutable Ledger, and Purchase History
  app.get('/api/wallet/me', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const snapshot = await getWalletSnapshotSql(req.user!.uid);
      res.json({
        ...snapshot,
        serverTimeIso: new Date().toISOString(),
      });
    } catch (err) {
      res.status(isSqlConfigured() ? 500 : 503).json({
        error: err instanceof Error ? err.message : 'Failed to load wallet.',
      });
    }
  });

  // Spend Credits to Unlock Content (Atomic anti-double-spend + idempotency)
  app.post('/api/wallet/spend', requireAuth, async (req: AuthedRequest, res) => {
    const uid = req.user!.uid;
    const idemKey = getIdempotencyKey(req);
    const { videoId, resumeSeconds } = req.body as {
      videoId?: unknown;
      resumeSeconds?: unknown;
    };

    if (!isValidSafeId(videoId)) {
      res.status(400).json({ error: 'Invalid videoId.' });
      return;
    }

    const resolvedVideo = await resolveServerVideoEntry(
      videoId,
      firebaseConfig.projectId,
      firebaseConfig.firestoreDatabaseId
    );
    if (!resolvedVideo) {
      res.status(404).json({ error: 'Published video release not found.' });
      return;
    }
    if (
      resolvedVideo.priceUsd === 0 &&
      resolvedVideo.priceIdr === 0 &&
      resolvedVideo.creditCost === 0
    ) {
      res.status(400).json({ error: 'Free release does not require credits.' });
      return;
    }

    try {
      const paymentId = `pay_cr_${crypto.randomUUID().slice(0, 12)}`;
      const result = await spendCreditsAtomicSql({
        uid,
        userEmail: req.user!.email,
        video: resolvedVideo,
        resumeSeconds: typeof resumeSeconds === 'number' ? resumeSeconds : 0,
        paymentId,
        idemKey,
      });
      res.status(result.status).json(result.body);
    } catch (err) {
      res.status(isSqlConfigured() ? 500 : 503).json({
        error: err instanceof Error ? err.message : 'Failed to spend credits.',
      });
    }
  });

  // Create PayPal Order (Server-side pricing + real PayPal REST or Sandbox Preview)
  app.post('/api/payments/paypal/create-order', requireAuth, async (req: AuthedRequest, res) => {
    const uid = req.user!.uid;
    const idemKey = getIdempotencyKey(req);
    const { purpose, targetId, resumeSeconds } = req.body as {
      purpose?: unknown;
      targetId?: unknown;
      resumeSeconds?: unknown;
    };

    if (
      (purpose !== 'video_unlock' && purpose !== 'credit_topup') ||
      !isValidSafeId(targetId)
    ) {
      res.status(400).json({ error: 'Invalid payment purpose or targetId.' });
      return;
    }

    const useLivePayPal = isPayPalConfigured();
    const paypalPaymentLink = !useLivePayPal ? getPayPalPaymentLink() : null;
    if (IS_PRODUCTION && !useLivePayPal && !paypalPaymentLink) {
      res.status(503).json({
        error: 'PayPal gateway credentials are not configured in production.',
      });
      return;
    }

    let amountUsd = 0;
    let targetTitle = '';
    let creditsDelta = 0;

    if (purpose === 'credit_topup') {
      const pkg = SERVER_CREDIT_PACKAGES[targetId];
      if (!pkg) {
        res.status(404).json({ error: 'Credit package not found.' });
        return;
      }
      amountUsd = pkg.priceUsd;
      targetTitle = pkg.name;
      creditsDelta = pkg.credits + pkg.bonusCredits;
    } else {
      const vid = await resolveServerVideoEntry(
        targetId,
        firebaseConfig.projectId,
        firebaseConfig.firestoreDatabaseId
      );
      if (!vid) {
        res.status(404).json({ error: 'Published release not found.' });
        return;
      }
      if (vid.priceUsd === 0 && vid.priceIdr === 0 && vid.creditCost === 0) {
        res.status(400).json({ error: 'Free release does not require payment.' });
        return;
      }
      amountUsd = vid.priceUsd;
      targetTitle = vid.title;
    }

    try {
      const early = await precheckCreateOrderSql({
        scope: 'pp_create',
        uid,
        idemKey,
        purpose: purpose as PaymentPurpose,
        targetId,
      });
      if (early) {
        res.status(early.status).json(early.body);
        return;
      }
    } catch (err) {
      res.status(isSqlConfigured() ? 500 : 503).json({
        error: err instanceof Error ? err.message : 'Unable to validate checkout state.',
      });
      return;
    }

    const paymentId = `pay_pp_${crypto.randomUUID().slice(0, 12)}`;
    const now = Date.now();
    const nowIso = new Date(now).toISOString();

    let gatewayOrderId = `SBX-PP-${paymentId}`;
    let approvalUrl = '';
    let gatewayMode: PaymentGatewayMode = 'sandbox_preview';

    if (useLivePayPal) {
      try {
        const origin =
          process.env.APP_URL || `${req.protocol}://${req.get('host') || 'localhost:3000'}`;
        const ppOrder = await createLivePayPalOrder({
          orderId: paymentId,
          amountUsd,
          description: `DELOKEN: ${targetTitle}`,
          returnUrl: `${origin}/?paypalReturn=1&paymentId=${paymentId}`,
          cancelUrl: `${origin}/?paypalCancel=1&paymentId=${paymentId}`,
        });
        gatewayOrderId = ppOrder.paypalOrderId;
        approvalUrl = ppOrder.approvalUrl;
        gatewayMode = 'live';
      } catch (err) {
        res.status(502).json({
          error: err instanceof Error ? err.message : 'PayPal API order creation failed.',
        });
        return;
      }
    } else if (paypalPaymentLink) {
      gatewayMode = 'payment_link';
      gatewayOrderId = `PP-LINK-${paymentId.slice(-8).toUpperCase()}`;
      approvalUrl = paypalPaymentLink;
    }

    const sandboxCaptureToken =
      gatewayMode === 'sandbox_preview'
        ? signSandboxOrderToken(paymentId, uid, amountUsd)
        : undefined;

    const order: PaymentOrderRecord = {
      id: paymentId,
      userId: uid,
      userEmail: req.user!.email,
      purpose: purpose as PaymentPurpose,
      targetId,
      targetTitle,
      method: 'paypal',
      amount: amountUsd,
      currency: 'USD',
      creditsDelta,
      status: 'pending',
      gatewayOrderId,
      gatewayMode,
      approvalUrl: approvalUrl || undefined,
      expiresAt: new Date(now + PAYMENT_TTL_MS).toISOString(),
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    try {
      const responseBody = {
        payment: order,
        sandboxCaptureToken,
        resumeSeconds: typeof resumeSeconds === 'number' ? resumeSeconds : 0,
      };
      const finalResp = await savePendingPaymentOrderSql({
        scope: 'pp_create',
        uid,
        idemKey,
        order,
        responseBody,
      });
      res.status(finalResp.status).json(finalResp.body);
    } catch (err) {
      res.status(isSqlConfigured() ? 500 : 503).json({
        error: err instanceof Error ? err.message : 'Failed to store PayPal order.',
      });
    }
  });

  // Capture & Server-Verify PayPal Order
  app.post('/api/payments/paypal/capture', requireAuth, async (req: AuthedRequest, res) => {
    const uid = req.user!.uid;
    const idemKey = getIdempotencyKey(req);
    const { paymentId, sandboxCaptureToken, resumeSeconds } = req.body as {
      paymentId?: unknown;
      sandboxCaptureToken?: unknown;
      resumeSeconds?: unknown;
    };

    if (!isValidSafeId(paymentId)) {
      res.status(400).json({ error: 'Invalid paymentId.' });
      return;
    }

    let payment: PaymentOrderRecord | null = null;
    try {
      const cached = await checkIdempotencySql('pp_capture', uid, idemKey);
      if (cached) {
        res.status(cached.status).json(cached.body);
        return;
      }
      payment = await getPaymentByIdSql(paymentId);
    } catch (err) {
      res.status(isSqlConfigured() ? 500 : 503).json({
        error: err instanceof Error ? err.message : 'Unable to look up PayPal order.',
      });
      return;
    }

    if (!payment || payment.userId !== uid || payment.method !== 'paypal') {
      res.status(404).json({ error: 'PayPal payment order not found.' });
      return;
    }

    if (payment.status === 'completed') {
      try {
        const snap = await getPaymentStatusSnapshotSql(paymentId, uid);
        res.json({ payment, wallet: snap?.wallet });
      } catch (err) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Unable to read payment snapshot.',
        });
      }
      return;
    }

    if (payment.status !== 'pending') {
      res.status(409).json({
        error: `PayPal order cannot be captured from status '${payment.status}'.`,
      });
      return;
    }

    if (payment.gatewayMode === 'live') {
      try {
        const cap = await captureLivePayPalOrder(payment.gatewayOrderId);
        if (!cap.completed || Math.abs(cap.capturedUsd - payment.amount) > 0.02) {
          res.status(402).json({ error: 'PayPal capture incomplete or amount mismatch.' });
          return;
        }
      } catch (err) {
        res.status(502).json({
          error: err instanceof Error ? err.message : 'PayPal capture verification failed.',
        });
        return;
      }
    } else if (payment.gatewayMode === 'payment_link') {
      res.status(409).json({
        error:
          'PayPal Payment Link orders activate via PayPal webhook or Admin verification after payment is received.',
      });
      return;
    } else {
      if (IS_PRODUCTION) {
        res.status(403).json({ error: 'Sandbox PayPal capture is disabled in production.' });
        return;
      }
      const expectedToken = signSandboxOrderToken(payment.id, uid, payment.amount);
      const tokStr = typeof sandboxCaptureToken === 'string' ? sandboxCaptureToken : '';
      const a = Buffer.from(expectedToken, 'utf8');
      const b = Buffer.from(tokStr, 'utf8');
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        res.status(403).json({ error: 'Invalid server sandbox capture signature.' });
        return;
      }
    }

    const videoEntry =
      payment.purpose === 'video_unlock'
        ? await resolveServerVideoEntry(
            payment.targetId,
            firebaseConfig.projectId,
            firebaseConfig.firestoreDatabaseId
          )
        : null;

    try {
      const fulfilled = await fulfillPaymentAtomicSql({
        paymentId,
        videoEntry,
        resumeSeconds: typeof resumeSeconds === 'number' ? resumeSeconds : 0,
        idemScope: 'pp_capture',
        idemUid: uid,
        idemKey,
      });
      if (fulfilled.notFound) {
        res.status(404).json({ error: 'Order missing.' });
        return;
      }
      if (fulfilled.invalidStatus) {
        res.status(409).json({
          error: `Order cannot be fulfilled from status '${fulfilled.invalidStatus}'.`,
        });
        return;
      }
      res.status(200).json({
        payment: fulfilled.payment,
        purchase: fulfilled.purchase,
        entitlement: fulfilled.entitlement ?? null,
        wallet: fulfilled.wallet,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to capture PayPal payment.',
      });
    }
  });

  // Create QRIS Indonesia Charge (Midtrans Core API or EMVCo Sandbox Preview)
  app.post('/api/payments/qris/create', requireAuth, async (req: AuthedRequest, res) => {
    const uid = req.user!.uid;
    const idemKey = getIdempotencyKey(req);
    const { purpose, targetId, resumeSeconds } = req.body as {
      purpose?: unknown;
      targetId?: unknown;
      resumeSeconds?: unknown;
    };

    if (
      (purpose !== 'video_unlock' && purpose !== 'credit_topup') ||
      !isValidSafeId(targetId)
    ) {
      res.status(400).json({ error: 'Invalid payment purpose or targetId.' });
      return;
    }

    const useLiveMidtrans = isMidtransConfigured();
    if (IS_PRODUCTION && !useLiveMidtrans) {
      res.status(503).json({
        error: 'Indonesian QRIS gateway credentials are not configured in production.',
      });
      return;
    }

    let amountIdr = 0;
    let targetTitle = '';
    let creditsDelta = 0;

    if (purpose === 'credit_topup') {
      const pkg = SERVER_CREDIT_PACKAGES[targetId];
      if (!pkg) {
        res.status(404).json({ error: 'Credit package not found.' });
        return;
      }
      amountIdr = pkg.priceIdr;
      targetTitle = pkg.name;
      creditsDelta = pkg.credits + pkg.bonusCredits;
    } else {
      const vid = await resolveServerVideoEntry(
        targetId,
        firebaseConfig.projectId,
        firebaseConfig.firestoreDatabaseId
      );
      if (!vid) {
        res.status(404).json({ error: 'Published release not found.' });
        return;
      }
      if (vid.priceUsd === 0 && vid.priceIdr === 0 && vid.creditCost === 0) {
        res.status(400).json({ error: 'Free release does not require payment.' });
        return;
      }
      amountIdr = vid.priceIdr;
      targetTitle = vid.title;
    }

    try {
      const early = await precheckCreateOrderSql({
        scope: 'qris_create',
        uid,
        idemKey,
        purpose: purpose as PaymentPurpose,
        targetId,
      });
      if (early) {
        res.status(early.status).json(early.body);
        return;
      }
    } catch (err) {
      res.status(isSqlConfigured() ? 500 : 503).json({
        error: err instanceof Error ? err.message : 'Unable to validate QRIS checkout.',
      });
      return;
    }

    const paymentId = `pay_qr_${crypto.randomUUID().slice(0, 12)}`;
    const now = Date.now();
    const nowIso = new Date(now).toISOString();

    let qrString = '';
    let gatewayOrderId = `DELOKEN-QRIS-${paymentId}`;
    let gatewayMode: 'live' | 'sandbox_preview' = 'sandbox_preview';

    if (useLiveMidtrans) {
      try {
        const mt = await createLiveMidtransQris({
          orderId: paymentId,
          amountIdr,
        });
        qrString = mt.qrString;
        gatewayOrderId = mt.transactionId;
        gatewayMode = 'live';
      } catch (err) {
        res.status(502).json({
          error: err instanceof Error ? err.message : 'Midtrans QRIS charge creation failed.',
        });
        return;
      }
    } else {
      qrString = buildQrisPayloadString(paymentId, amountIdr);
    }

    const order: PaymentOrderRecord = {
      id: paymentId,
      userId: uid,
      userEmail: req.user!.email,
      purpose: purpose as PaymentPurpose,
      targetId,
      targetTitle,
      method: 'qris',
      amount: amountIdr,
      currency: 'IDR',
      creditsDelta,
      status: 'pending',
      gatewayOrderId,
      gatewayMode,
      qrString,
      expiresAt: new Date(now + PAYMENT_TTL_MS).toISOString(),
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    try {
      const responseBody = {
        payment: order,
        resumeSeconds: typeof resumeSeconds === 'number' ? resumeSeconds : 0,
      };
      const result = await savePendingPaymentOrderSql({
        scope: 'qris_create',
        uid,
        idemKey,
        order,
        responseBody,
      });
      res.status(result.status).json(result.body);
    } catch (err) {
      res.status(isSqlConfigured() ? 500 : 503).json({
        error: err instanceof Error ? err.message : 'Failed to store QRIS order.',
      });
    }
  });

  // Payment Status Polling (Owner-verified)
  app.get('/api/payments/:paymentId/status', requireAuth, async (req: AuthedRequest, res) => {
    const paymentId = req.params.paymentId;
    if (!isValidSafeId(paymentId)) {
      res.status(400).json({ error: 'Invalid paymentId.' });
      return;
    }
    try {
      const snapshot = await getPaymentStatusSnapshotSql(paymentId, req.user!.uid);
      if (!snapshot) {
        res.status(404).json({ error: 'Payment not found.' });
        return;
      }
      res.json(snapshot);
    } catch (err) {
      res.status(isSqlConfigured() ? 500 : 503).json({
        error: err instanceof Error ? err.message : 'Failed to fetch payment status.',
      });
    }
  });

  // Non-production QRIS Sandbox Settlement (Blocked with 403 in production)
  app.post(
    '/api/payments/qris/sandbox-settle',
    requireAuth,
    async (req: AuthedRequest, res) => {
      if (IS_PRODUCTION) {
        res.status(403).json({
          error:
            'Simulated QRIS settlement is strictly forbidden in production. Payments settle only via authenticated gateway webhooks.',
        });
        return;
      }

      const uid = req.user!.uid;
      const { paymentId, resumeSeconds } = req.body as {
        paymentId?: unknown;
        resumeSeconds?: unknown;
      };
      if (!isValidSafeId(paymentId)) {
        res.status(400).json({ error: 'Invalid paymentId.' });
        return;
      }

      let existingPayment: PaymentOrderRecord | null = null;
      try {
        existingPayment = await getPaymentByIdSql(paymentId);
      } catch (err) {
        res.status(isSqlConfigured() ? 500 : 503).json({
          error: err instanceof Error ? err.message : 'Failed to read QRIS order.',
        });
        return;
      }

      if (!existingPayment || existingPayment.userId !== uid || existingPayment.method !== 'qris') {
        res.status(404).json({ error: 'Pending QRIS order not found.' });
        return;
      }

      const videoEntry =
        existingPayment.purpose === 'video_unlock'
          ? await resolveServerVideoEntry(
              existingPayment.targetId,
              firebaseConfig.projectId,
              firebaseConfig.firestoreDatabaseId
            )
          : null;

      try {
        const settled = await fulfillPaymentAtomicSql({
          paymentId,
          videoEntry,
          resumeSeconds: typeof resumeSeconds === 'number' ? resumeSeconds : 0,
        });
        if (settled.notFound) {
          res.status(404).json({ error: 'QRIS order not found.' });
          return;
        }
        res.json({
          payment: settled.payment,
          purchase: settled.purchase,
          entitlement: settled.entitlement ?? null,
          wallet: settled.wallet,
        });
      } catch (err) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Failed to settle sandbox QRIS order.',
        });
      }
    }
  );

  // Authenticated PayPal Webhook
  app.post('/api/webhooks/paypal', async (req, res) => {
    const body = req.body as {
      id?: string;
      event_type?: string;
      resource?: {
        id?: string;
        custom_id?: string;
        amount?: { value?: string; currency_code?: string };
        supplementary_data?: { related_ids?: { order_id?: string } };
      };
    };

    const webhookId = process.env.PAYPAL_WEBHOOK_ID;
    if (webhookId && isPayPalConfigured()) {
      try {
        const token = await getPayPalAccessToken();
        const base =
          process.env.PAYPAL_MODE === 'live'
            ? 'https://api-m.paypal.com'
            : 'https://api-m.sandbox.paypal.com';
        const verifyRes = await fetch(`${base}/v1/notifications/verify-webhook-signature`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            auth_algo: req.headers['paypal-auth-algo'],
            cert_url: req.headers['paypal-cert-url'],
            transmission_id: req.headers['paypal-transmission-id'],
            transmission_sig: req.headers['paypal-transmission-sig'],
            transmission_time: req.headers['paypal-transmission-time'],
            webhook_id: webhookId,
            webhook_event: body,
          }),
        });
        const verifyJson = (await verifyRes.json()) as { verification_status?: string };
        if (!verifyRes.ok || verifyJson.verification_status !== 'SUCCESS') {
          res.status(401).json({ error: 'Invalid PayPal webhook signature.' });
          return;
        }
      } catch {
        res.status(401).json({ error: 'PayPal webhook verification failed.' });
        return;
      }
    } else {
      const secret = process.env.PAYPAL_WEBHOOK_SECRET || (!IS_PRODUCTION ? PLAYBACK_SECRET : '');
      const sigHeader = String(req.headers['x-vyora-webhook-signature'] || '');
      if (!secret || !sigHeader) {
        res.status(401).json({ error: 'Missing PayPal webhook authentication.' });
        return;
      }
      const expected = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(body))
        .digest('hex');
      const a = Buffer.from(expected, 'utf8');
      const b = Buffer.from(sigHeader, 'utf8');
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        res.status(401).json({ error: 'Invalid PayPal webhook HMAC signature.' });
        return;
      }
    }

    const eventId = body.id || '';
    if (!eventId) {
      res.status(400).json({ error: 'Missing webhook event id.' });
      return;
    }

    const webhookKey = `pp:${eventId}`;
    const targetPaymentId = body.resource?.custom_id || '';
    const gatewayOrderId =
      body.resource?.supplementary_data?.related_ids?.order_id || body.resource?.id || '';

    try {
      if (await isWebhookProcessedSql(webhookKey)) {
        res.json({ ok: true, duplicate: true });
        return;
      }

      const payment = await findPaymentForWebhookSql(targetPaymentId, gatewayOrderId);
      const reportedUsd = Number(body.resource?.amount?.value);
      const amountMatches =
        !Number.isFinite(reportedUsd) ||
        !payment ||
        Math.abs(reportedUsd - payment.amount) <= 0.02;

      if (
        payment &&
        amountMatches &&
        (body.event_type === 'PAYMENT.CAPTURE.COMPLETED' ||
          body.event_type === 'CHECKOUT.ORDER.APPROVED')
      ) {
        const video =
          payment.purpose === 'video_unlock'
            ? await resolveServerVideoEntry(
                payment.targetId,
                firebaseConfig.projectId,
                firebaseConfig.firestoreDatabaseId
              )
            : null;
        const settled = await fulfillPaymentAtomicSql({
          paymentId: payment.id,
          videoEntry: video,
          webhookEventKey: webhookKey,
        });
        res.json({ ok: true, duplicate: Boolean(settled.duplicateWebhook) });
        return;
      }

      const rec = await recordWebhookOnlyOrFailureSql({ webhookEventKey: webhookKey });
      res.json({ ok: true, duplicate: rec.duplicate });
    } catch (err) {
      res.status(isSqlConfigured() ? 500 : 503).json({
        error: err instanceof Error ? err.message : 'PayPal webhook processing failed.',
      });
    }
  });

  // Authenticated Indonesian QRIS Webhook (Midtrans SHA-512 or HMAC)
  app.post('/api/webhooks/qris', async (req, res) => {
    const body = req.body as {
      order_id?: string;
      status_code?: string;
      gross_amount?: string;
      transaction_status?: string;
      signature_key?: string;
      transaction_id?: string;
    };

    const orderId = body.order_id || '';
    const statusCode = body.status_code || '200';
    const grossAmount = body.gross_amount || '';

    if (isMidtransConfigured()) {
      const valid = verifyMidtransWebhookSignature({
        orderId,
        statusCode,
        grossAmount,
        signatureKey: body.signature_key || '',
      });
      if (!valid) {
        res.status(401).json({ error: 'Invalid Midtrans QRIS webhook signature.' });
        return;
      }
    } else {
      const secret = process.env.QRIS_WEBHOOK_SECRET || (!IS_PRODUCTION ? PLAYBACK_SECRET : '');
      const sigHeader = String(req.headers['x-vyora-webhook-signature'] || '');
      if (!secret || !sigHeader) {
        res.status(401).json({ error: 'Missing QRIS webhook authentication.' });
        return;
      }
      const expected = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(body))
        .digest('hex');
      const a = Buffer.from(expected, 'utf8');
      const b = Buffer.from(sigHeader, 'utf8');
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        res.status(401).json({ error: 'Invalid QRIS webhook signature.' });
        return;
      }
    }

    if (!isValidSafeId(orderId)) {
      res.status(400).json({ error: 'Invalid order_id.' });
      return;
    }

    const eventKey = `qris:${orderId}:${body.transaction_status || 'unknown'}`;

    try {
      if (await isWebhookProcessedSql(eventKey)) {
        res.json({ ok: true, duplicate: true });
        return;
      }

      const payment = await getPaymentByIdSql(orderId);
      if (!payment) {
        res.status(404).json({ error: 'QRIS payment order not found.' });
        return;
      }

      const parsedGross = Number(grossAmount);
      const qrisAmountValid =
        !grossAmount ||
        (Number.isFinite(parsedGross) && Math.round(parsedGross) === payment.amount);

      if (
        qrisAmountValid &&
        (body.transaction_status === 'settlement' ||
          body.transaction_status === 'capture')
      ) {
        const video =
          payment.purpose === 'video_unlock'
            ? await resolveServerVideoEntry(
                payment.targetId,
                firebaseConfig.projectId,
                firebaseConfig.firestoreDatabaseId
              )
            : null;
        const settled = await fulfillPaymentAtomicSql({
          paymentId: payment.id,
          videoEntry: video,
          webhookEventKey: eventKey,
        });
        res.json({
          ok: true,
          duplicate: Boolean(settled.duplicateWebhook),
          status: settled.payment?.status ?? 'completed',
        });
        return;
      }

      const nextStatus =
        body.transaction_status === 'expire'
          ? 'expired'
          : body.transaction_status === 'cancel' || body.transaction_status === 'deny'
          ? 'failed'
          : undefined;

      const recorded = await recordWebhookOnlyOrFailureSql({
        webhookEventKey: eventKey,
        paymentId: orderId,
        nextStatus,
      });
      if (recorded.notFound) {
        res.status(404).json({ error: 'QRIS payment order not found.' });
        return;
      }
      res.json({ ok: true, duplicate: recorded.duplicate, status: recorded.status });
    } catch (err) {
      res.status(isSqlConfigured() ? 500 : 503).json({
        error: err instanceof Error ? err.message : 'QRIS webhook processing failed.',
      });
    }
  });

  // =========================================================================
  // CREATOR EARNINGS & PAYOUTS
  // =========================================================================

  app.get('/api/creator/earnings/me', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const summary = await getCreatorEarningsSummarySql(req.user!.uid);
      res.json(summary);
    } catch (err) {
      res.status(isSqlConfigured() ? 500 : 503).json({
        error: err instanceof Error ? err.message : 'Unable to load creator earnings.',
      });
    }
  });

  app.post('/api/creator/payouts/request', requireAuth, async (req: AuthedRequest, res) => {
    const uid = req.user!.uid;
    const idemKey = getIdempotencyKey(req);
    const { creatorName, currency, amount, method, destination } = req.body as {
      creatorName?: unknown;
      currency?: unknown;
      amount?: unknown;
      method?: unknown;
      destination?: unknown;
    };

    const validMethod =
      method === 'bank_transfer_idr' ||
      method === 'ewallet_idr' ||
      method === 'paypal_usd'
        ? method
        : null;

    if (
      (currency !== 'USD' && currency !== 'IDR') ||
      !validMethod ||
      (currency === 'USD' && validMethod !== 'paypal_usd') ||
      (currency === 'IDR' &&
        validMethod !== 'bank_transfer_idr' &&
        validMethod !== 'ewallet_idr') ||
      typeof amount !== 'number' ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      typeof destination !== 'string' ||
      destination.trim().length < 4
    ) {
      res.status(400).json({ error: 'Invalid payout request fields or currency/channel mismatch.' });
      return;
    }

    try {
      const result = await requestCreatorPayoutAtomicSql({
        uid,
        creatorName:
          typeof creatorName === 'string' && creatorName.trim().length >= 2
            ? creatorName.trim().slice(0, 80)
            : req.user!.email || 'DELOKEN Creator',
        currency,
        amount,
        method: validMethod,
        destination: destination.trim().slice(0, 160),
        payoutId: `payo_${crypto.randomUUID().slice(0, 10)}`,
        idemKey,
      });
      res.status(result.status).json(result.body);
    } catch (err) {
      res.status(isSqlConfigured() ? 500 : 503).json({
        error: err instanceof Error ? err.message : 'Failed to request creator payout.',
      });
    }
  });

  // =========================================================================
  // ADMIN FINANCE, REFUNDS, PAYOUT APPROVALS & COMMISSION SYNC
  // =========================================================================

  app.get('/api/admin/finance/overview', requireAdmin, async (_req, res) => {
    try {
      const overview = await getAdminFinanceOverviewSql();
      res.json(overview);
    } catch (err) {
      res.status(isSqlConfigured() ? 500 : 503).json({
        error: err instanceof Error ? err.message : 'Failed to load admin overview.',
      });
    }
  });

  app.post('/api/admin/refunds', requireAdmin, async (req: AuthedRequest, res) => {
    const idemKey = getIdempotencyKey(req);
    const { paymentId } = req.body as { paymentId?: unknown };
    if (!isValidSafeId(paymentId)) {
      res.status(400).json({ error: 'Invalid paymentId.' });
      return;
    }

    try {
      const result = await refundPaymentAtomicSql({
        adminUid: req.user!.uid,
        paymentId,
        idemKey,
      });
      res.status(result.status).json(result.body);
    } catch (err) {
      res.status(isSqlConfigured() ? 500 : 503).json({
        error: err instanceof Error ? err.message : 'Refund processing failed.',
      });
    }
  });

  app.post('/api/admin/payments/:paymentId/approve', requireAdmin, async (req: AuthedRequest, res) => {
    const paymentId = req.params.paymentId;
    const idemKey = getIdempotencyKey(req);
    if (!isValidSafeId(paymentId)) {
      res.status(400).json({ error: 'Invalid paymentId.' });
      return;
    }

    try {
      const cached = await checkIdempotencySql('admin_approve', req.user!.uid, idemKey);
      if (cached) {
        res.status(cached.status).json(cached.body);
        return;
      }

      const payment = await getPaymentByIdSql(paymentId);
      if (!payment) {
        res.status(404).json({ error: 'Payment order not found.' });
        return;
      }

      if (
        payment.status === 'refunded' ||
        payment.status === 'failed' ||
        payment.status === 'expired'
      ) {
        res.status(400).json({
          error: `Cannot approve payment in '${payment.status}' status.`,
        });
        return;
      }

      const videoEntry =
        payment.purpose === 'video_unlock'
          ? await resolveServerVideoEntry(
              payment.targetId,
              firebaseConfig.projectId,
              firebaseConfig.firestoreDatabaseId
            )
          : null;

      const settled = await fulfillPaymentAtomicSql({
        paymentId,
        videoEntry,
        idemScope: 'admin_approve',
        idemUid: req.user!.uid,
        idemKey,
      });

      if (settled.notFound) {
        res.status(404).json({ error: 'Payment order not found.' });
        return;
      }
      if (settled.invalidStatus) {
        res.status(400).json({
          error: `Cannot approve payment in '${settled.invalidStatus}' status.`,
        });
        return;
      }

      const overview = await getAdminFinanceOverviewSql();
      res.json({
        ok: true,
        payment: settled.payment,
        overview,
      });
    } catch (err) {
      res.status(isSqlConfigured() ? 500 : 503).json({
        error: err instanceof Error ? err.message : 'Failed to approve pending payment.',
      });
    }
  });

  app.post('/api/admin/payouts/:payoutId/status', requireAdmin, async (req, res) => {
    const payoutId = req.params.payoutId;
    const { status, adminNote } = req.body as {
      status?: unknown;
      adminNote?: unknown;
    };

    if (
      !isValidSafeId(payoutId) ||
      (status !== 'processing' && status !== 'paid' && status !== 'rejected')
    ) {
      res.status(400).json({ error: 'Invalid payoutId or status.' });
      return;
    }

    try {
      const result = await updatePayoutStatusSql({
        payoutId,
        status,
        adminNote: typeof adminNote === 'string' ? adminNote : undefined,
      });
      res.status(result.status).json(result.body);
    } catch (err) {
      res.status(isSqlConfigured() ? 500 : 503).json({
        error: err instanceof Error ? err.message : 'Failed to update payout status.',
      });
    }
  });

  app.post('/api/admin/settings', requireAdmin, async (req, res) => {
    const { commissionPercent, minPriceUsd, minPriceIdr } = req.body as {
      commissionPercent?: unknown;
      minPriceUsd?: unknown;
      minPriceIdr?: unknown;
    };

    if (
      typeof commissionPercent !== 'number' ||
      commissionPercent < 0 ||
      commissionPercent > 50
    ) {
      res.status(400).json({ error: 'Invalid commissionPercent (0-50).' });
      return;
    }

    try {
      await updatePlatformSettingsSql({
        commissionPercent,
        minPriceUsd: typeof minPriceUsd === 'number' ? minPriceUsd : undefined,
        minPriceIdr: typeof minPriceIdr === 'number' ? minPriceIdr : undefined,
      });
      res.json({ ok: true });
    } catch (err) {
      res.status(isSqlConfigured() ? 500 : 503).json({
        error: err instanceof Error ? err.message : 'Failed to update settings.',
      });
    }
  });

  // =========================================================================
  // ADMIN VIDEO LIFECYCLE: ARCHIVE, RESTORE & PERMANENT DELETE
  // =========================================================================

  app.get('/api/admin/video-deletion-jobs', requireAdmin, async (_req, res) => {
    try {
      const jobs = await fetchDeletionJobs(40);
      res.json({ jobs });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to load video deletion audit logs.',
      });
    }
  });

  app.get('/api/admin/videos/:videoId/asset-info', requireAdmin, async (req: AuthedRequest, res) => {
    const videoId = req.params.videoId;
    if (!isValidSafeId(videoId)) {
      res.status(400).json({ error: 'Invalid videoId.' });
      return;
    }

    try {
      const bearerToken = req.user!.rawIdToken;
      const [videoDoc, assetDoc, sqlMedia, latestJob] = await Promise.all([
        firestoreGetDocument(
          firebaseConfig.projectId,
          firebaseConfig.firestoreDatabaseId,
          'videos',
          videoId,
          bearerToken
        ),
        firestoreGetDocument(
          firebaseConfig.projectId,
          firebaseConfig.firestoreDatabaseId,
          'video_assets',
          videoId,
          bearerToken
        ),
        fetchStoredMediaBinding(videoId).catch(() => null),
        fetchLatestDeletionJob(videoId).catch(() => null),
      ]);

      if (!videoDoc.exists && !latestJob) {
        res.status(404).json({ error: 'Video not found.' });
        return;
      }

      const rawProvider =
        assetDoc.fields.provider?.stringValue || sqlMedia?.provider || '';
      const rawRef =
        assetDoc.fields.assetRef?.stringValue || sqlMedia?.assetRef || '';
      const normalized =
        rawProvider || rawRef
          ? normalizeMediaSource(rawProvider, rawRef)
          : {
              provider: (latestJob?.provider || 'unknown') as NormalizedMediaProvider,
              assetRef: '',
            };

      const title =
        videoDoc.fields.title?.stringValue ||
        latestJob?.videoTitleSnapshot ||
        videoId;
      const status = (videoDoc.fields.status?.stringValue ||
        (latestJob?.status === 'completed' ? 'deletion_pending' : 'draft')) as ContentStatus;
      const previousStatus = (videoDoc.fields.previousStatus?.stringValue ||
        '') as ContentStatus | '';
      const thumbnailUrl = videoDoc.fields.thumbnailUrl?.stringValue || '';
      const creatorId =
        videoDoc.fields.creatorId?.stringValue ||
        assetDoc.fields.creatorId?.stringValue ||
        sqlMedia?.creatorId ||
        '';

      const assetRefFingerprint =
        rawRef
          ? buildAssetRefFingerprint(normalized.provider, normalized.assetRef)
          : latestJob?.assetRefFingerprint || 'unknown:unavailable';

      const assetInfo: AdminVideoAssetInfo = {
        videoId,
        title,
        status,
        previousStatus,
        provider: normalized.provider,
        assetRefFingerprint,
        isExternalPlatform: isExternalLinkProvider(normalized.provider),
        externalMediaWarning: getExternalPlatformWarning(normalized.provider),
        thumbnailUrl,
        creatorId,
      };

      res.json({ assetInfo, latestJob });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Unable to inspect video asset metadata.',
      });
    }
  });

  app.post('/api/admin/videos/:videoId/archive', requireAdmin, async (req: AuthedRequest, res) => {
    const videoId = req.params.videoId;
    if (!isValidSafeId(videoId)) {
      res.status(400).json({ error: 'Invalid videoId.' });
      return;
    }

    const body = (req.body || {}) as { moderationNote?: unknown };
    const rawNote = typeof body.moderationNote === 'string' ? body.moderationNote.trim().slice(0, 500) : '';

    try {
      const bearerToken = req.user!.rawIdToken;
      const videoDoc = await firestoreGetDocument(
        firebaseConfig.projectId,
        firebaseConfig.firestoreDatabaseId,
        'videos',
        videoId,
        bearerToken
      );

      if (!videoDoc.exists) {
        res.status(404).json({ error: 'Video not found.' });
        return;
      }

      const currentStatus = (videoDoc.fields.status?.stringValue || 'draft') as ContentStatus;
      if (currentStatus === 'deletion_pending') {
        res.status(409).json({
          error: 'Video sedang dalam proses penghapusan permanen dan tidak dapat diarsipkan.',
        });
        return;
      }

      const existingPrevious = (videoDoc.fields.previousStatus?.stringValue || '') as ContentStatus | '';
      const previousStatus =
        currentStatus === 'archived'
          ? VALID_RESTORABLE_STATUSES.has(existingPrevious as ContentStatus)
            ? existingPrevious
            : ''
          : VALID_RESTORABLE_STATUSES.has(currentStatus)
          ? currentStatus
          : '';

      const nextNote =
        rawNote || videoDoc.fields.moderationNote?.stringValue || 'Archived by Admin';

      await firestoreCommitVideoFields(
        firebaseConfig.projectId,
        firebaseConfig.firestoreDatabaseId,
        videoId,
        {
          status: { stringValue: 'archived' },
          previousStatus: { stringValue: previousStatus },
          moderationNote: { stringValue: nextNote },
        },
        bearerToken
      );

      blockedVideoStatuses.set(videoId, 'archived');

      res.json({
        ok: true,
        videoId,
        status: 'archived' as const,
        previousStatus,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to archive video.',
      });
    }
  });

  app.post('/api/admin/videos/:videoId/restore', requireAdmin, async (req: AuthedRequest, res) => {
    const videoId = req.params.videoId;
    if (!isValidSafeId(videoId)) {
      res.status(400).json({ error: 'Invalid videoId.' });
      return;
    }

    const body = (req.body || {}) as {
      targetStatus?: unknown;
      moderationNote?: unknown;
    };
    const requestedTarget =
      typeof body.targetStatus === 'string' &&
      VALID_RESTORABLE_STATUSES.has(body.targetStatus as ContentStatus)
        ? (body.targetStatus as ContentStatus)
        : null;
    const rawNote =
      typeof body.moderationNote === 'string' ? body.moderationNote.trim().slice(0, 500) : '';

    try {
      const bearerToken = req.user!.rawIdToken;
      const videoDoc = await firestoreGetDocument(
        firebaseConfig.projectId,
        firebaseConfig.firestoreDatabaseId,
        'videos',
        videoId,
        bearerToken
      );

      if (!videoDoc.exists) {
        res.status(404).json({ error: 'Video not found.' });
        return;
      }

      const currentStatus = (videoDoc.fields.status?.stringValue || 'draft') as ContentStatus;
      if (currentStatus === 'deletion_pending') {
        res.status(409).json({
          error: 'Video sedang dalam proses penghapusan permanen.',
        });
        return;
      }
      if (currentStatus !== 'archived') {
        res.status(409).json({
          error: `Video tidak berada dalam status arsip (status saat ini: ${currentStatus}).`,
        });
        return;
      }

      const storedPrevious = (videoDoc.fields.previousStatus?.stringValue || '') as ContentStatus | '';
      const hasValidPrevious = VALID_RESTORABLE_STATUSES.has(
        storedPrevious as ContentStatus
      );

      let restoredStatus: ContentStatus;
      if (hasValidPrevious) {
        restoredStatus = storedPrevious as ContentStatus;
      } else if (requestedTarget) {
        restoredStatus = requestedTarget;
      } else {
        res.status(400).json({
          error:
            'Status asal video tidak tersedia. Pilih status tujuan pemulihan secara eksplisit (tidak dipublikasikan otomatis).',
          code: 'TARGET_STATUS_REQUIRED',
        });
        return;
      }

      const existingPublishedAt = videoDoc.fields.publishedAt?.stringValue || '';
      const nextPublishedAt =
        restoredStatus === 'published' && !existingPublishedAt
          ? new Date().toISOString().slice(0, 10)
          : existingPublishedAt;
      const nextNote =
        rawNote || `Restored by Admin to ${restoredStatus.replace('_', ' ')}`;

      await firestoreCommitVideoFields(
        firebaseConfig.projectId,
        firebaseConfig.firestoreDatabaseId,
        videoId,
        {
          status: { stringValue: restoredStatus },
          previousStatus: { stringValue: '' },
          publishedAt: { stringValue: nextPublishedAt },
          moderationNote: { stringValue: nextNote },
        },
        bearerToken
      );

      blockedVideoStatuses.delete(videoId);

      res.json({
        ok: true,
        videoId,
        status: restoredStatus,
        restoredFromPreviousStatus: hasValidPrevious,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to restore archived video.',
      });
    }
  });

  interface PermanentDeleteParams {
    videoId: string;
    adminUid: string;
    bearerToken: string;
    confirmationMode: 'exact_title' | 'bulk_verified';
    confirmationText?: string;
  }

  type PermanentDeleteOutcome =
    | {
        ok: true;
        idempotent?: boolean;
        job: VideoDeletionJobRecord;
        preservedFinancialRecords: true;
      }
    | {
        ok: false;
        status: number;
        error: string;
        code?: string;
        job?: VideoDeletionJobRecord;
      };

  const performPermanentVideoDelete = async (
    params: PermanentDeleteParams
  ): Promise<PermanentDeleteOutcome> => {
    const { videoId, adminUid, bearerToken, confirmationMode, confirmationText = '' } = params;
    if (!isValidSafeId(videoId)) {
      return { ok: false, status: 400, error: 'Invalid videoId.' };
    }

    let videoDoc;
    let assetDoc;
    let sqlMedia: CreatorMediaBinding | null = null;
    let priorJob: VideoDeletionJobRecord | null = null;

    try {
      [videoDoc, assetDoc, sqlMedia, priorJob] = await Promise.all([
        firestoreGetDocument(
          firebaseConfig.projectId,
          firebaseConfig.firestoreDatabaseId,
          'videos',
          videoId,
          bearerToken
        ),
        firestoreGetDocument(
          firebaseConfig.projectId,
          firebaseConfig.firestoreDatabaseId,
          'video_assets',
          videoId,
          bearerToken
        ),
        fetchStoredMediaBinding(videoId).catch(() => null),
        fetchLatestDeletionJob(videoId).catch(() => null),
      ]);
    } catch (err) {
      return {
        ok: false,
        status: 500,
        error: err instanceof Error ? err.message : 'Failed to read authoritative video records.',
      };
    }

    if (
      priorJob?.status === 'completed' &&
      !videoDoc.exists &&
      !assetDoc.exists &&
      !sqlMedia
    ) {
      blockedVideoStatuses.set(videoId, 'deleted');
      return {
        ok: true,
        idempotent: true,
        job: priorJob,
        preservedFinancialRecords: true,
      };
    }

    const titleSnapshot = (
      videoDoc.fields.title?.stringValue ||
      priorJob?.videoTitleSnapshot ||
      ''
    ).trim();

    if (!titleSnapshot) {
      return { ok: false, status: 404, error: 'Video record not found.' };
    }

    if (confirmationMode === 'exact_title') {
      const rawConfirmation = confirmationText.trim();
      if (
        !rawConfirmation ||
        rawConfirmation.toLowerCase() !== titleSnapshot.toLowerCase()
      ) {
        return {
          ok: false,
          status: 400,
          error: `Konfirmasi penghapusan gagal. Ketik judul video secara persis: "${titleSnapshot}".`,
          code: 'CONFIRMATION_MISMATCH',
        };
      }
    }

    // Never trust client-supplied provider or assetRef: read strictly from server records
    const rawProvider =
      assetDoc.fields.provider?.stringValue || sqlMedia?.provider || '';
    const rawRef =
      assetDoc.fields.assetRef?.stringValue || sqlMedia?.assetRef || '';

    const normalized =
      rawProvider || rawRef
        ? normalizeMediaSource(rawProvider, rawRef)
        : priorJob &&
          (priorJob.providerResult === 'deleted' ||
            priorJob.providerResult === 'already_missing' ||
            priorJob.providerResult === 'external_retained' ||
            priorJob.providerResult === 'shared_preset_retained')
        ? {
            provider: priorJob.provider as NormalizedMediaProvider,
            assetRef: '',
          }
        : { provider: 'unknown' as const, assetRef: '' };

    const providerAlreadyResolved = Boolean(
      priorJob &&
        (priorJob.providerResult === 'deleted' ||
          priorJob.providerResult === 'already_missing' ||
          priorJob.providerResult === 'external_retained' ||
          priorJob.providerResult === 'shared_preset_retained')
    );

    const fingerprint =
      normalized.assetRef
        ? buildAssetRefFingerprint(normalized.provider, normalized.assetRef)
        : priorJob?.assetRefFingerprint || 'unknown:unavailable';
    const externalWarning = getExternalPlatformWarning(normalized.provider);

    // Pre-validate provider & assetRef BEFORE changing status or deleting metadata
    let validatedPrivateFile:
      | ReturnType<typeof validatePrivateStorageAssetRef>
      | null = null;

    if (!providerAlreadyResolved) {
      if (normalized.provider === 'unknown' || !normalized.assetRef) {
        return {
          ok: false,
          status: 422,
          error:
            'Provider media tidak dikenal atau metadata aset video tidak ditemukan. Penghapusan dihentikan aman tanpa menghapus metadata.',
          code: 'UNKNOWN_OR_MISSING_ASSET_PROVIDER',
        };
      }

      if (normalized.provider === 'cloudflare_stream') {
        if (!/^[a-zA-Z0-9_-]{8,128}$/.test(normalized.assetRef)) {
          return {
            ok: false,
            status: 422,
            error:
              'ID aset Cloudflare Stream tidak valid. Penghapusan dihentikan aman tanpa menghapus metadata.',
            code: 'INVALID_CLOUDFLARE_UID',
          };
        }
        if (!isCloudflareStreamConfigured()) {
          return {
            ok: false,
            status: 503,
            error:
              'Kredensial Cloudflare Stream server belum aktif sehingga penghapusan file Cloudflare tidak dapat dilakukan.',
            code: 'CLOUDFLARE_NOT_CONFIGURED',
          };
        }
      } else if (normalized.provider === 'private_storage') {
        validatedPrivateFile = validatePrivateStorageAssetRef(
          UPLOADS_DIR,
          normalized.assetRef
        );
        if (validatedPrivateFile.kind === 'invalid') {
          return {
            ok: false,
            status: 422,
            error:
              'Referensi file penyimpanan lokal tidak valid atau keluar dari direktori upload. Penghapusan dihentikan aman.',
            code: 'INVALID_ASSET_REF',
          };
        }
      } else if (isExternalLinkProvider(normalized.provider)) {
        if (!validateExternalProviderAssetRef(normalized.provider, normalized.assetRef)) {
          return {
            ok: false,
            status: 422,
            error: `Referensi tautan eksternal (${normalized.provider}) tidak valid.`,
            code: 'INVALID_EXTERNAL_REF',
          };
        }
      }
    }

    // 1. Create audit job record BEFORE destructive steps
    const operationId = `del_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const nowIso = new Date().toISOString();
    let job: VideoDeletionJobRecord = {
      operationId,
      videoId,
      videoTitleSnapshot: titleSnapshot.slice(0, 140),
      provider: normalized.provider,
      assetRefFingerprint: fingerprint,
      requestedBy: adminUid,
      requestedAt: nowIso,
      status: 'pending',
      providerResult: providerAlreadyResolved
        ? priorJob!.providerResult
        : 'pending',
      firestoreResult:
        !videoDoc.exists && !assetDoc.exists ? 'already_missing' : 'pending',
      sqlResult: !sqlMedia ? 'already_missing' : 'pending',
      thumbnailResult: 'skipped',
      externalMediaWarning: externalWarning,
      errorCode: null,
      errorMessage: null,
      completedAt: null,
    };

    try {
      job = await saveDeletionJob(job);
    } catch (err) {
      return {
        ok: false,
        status: 500,
        error: err instanceof Error ? err.message : 'Unable to create deletion audit record.',
      };
    }

    // 2. Mark Firestore document as deletion_pending tombstone & block playback immediately
    blockedVideoStatuses.set(videoId, 'deletion_pending');
    if (videoDoc.exists) {
      const currentStatus = (videoDoc.fields.status?.stringValue || 'draft') as ContentStatus;
      if (currentStatus !== 'deletion_pending') {
        try {
          await firestoreCommitVideoFields(
            firebaseConfig.projectId,
            firebaseConfig.firestoreDatabaseId,
            videoId,
            {
              status: { stringValue: 'deletion_pending' },
              moderationNote: {
                stringValue: `Permanent deletion in progress (${operationId})`,
              },
            },
            bearerToken
          );
        } catch (err) {
          const safeMsg =
            err instanceof Error
              ? err.message
              : 'Failed to set deletion_pending tombstone.';
          await patchDeletionJob(operationId, {
            status: 'failed',
            errorCode: 'TOMBSTONE_FAILED',
            errorMessage: safeMsg.slice(0, 280),
          }).catch(() => {});
          return {
            ok: false,
            status: 502,
            error: safeMsg,
            code: 'TOMBSTONE_FAILED',
            job,
          };
        }
      }
    }

    // 3. Execute Provider Media Deletion
    if (!providerAlreadyResolved) {
      try {
        if (normalized.provider === 'cloudflare_stream') {
          const cfRes = await deleteCloudflareVideo(normalized.assetRef);
          job.providerResult = cfRes.alreadyMissing ? 'already_missing' : 'deleted';
        } else if (
          normalized.provider === 'private_storage' &&
          validatedPrivateFile
        ) {
          if (validatedPrivateFile.kind === 'shared_preset') {
            job.providerResult = 'shared_preset_retained';
          } else if (validatedPrivateFile.kind === 'uploaded_file') {
            job.providerResult = deleteFileIfExists(validatedPrivateFile.resolvedPath);
          }
        } else if (isExternalLinkProvider(normalized.provider)) {
          job.providerResult = 'external_retained';
        }
        job.status = 'asset_deleted';
        await patchDeletionJob(operationId, {
          status: job.status,
          providerResult: job.providerResult,
        });
      } catch (err) {
        const safeMsg =
          err instanceof Error
            ? err.message
            : 'Provider asset deletion failed.';
        job.status = 'failed';
        job.errorCode = 'PROVIDER_DELETE_FAILED';
        job.errorMessage = safeMsg.slice(0, 280);
        await patchDeletionJob(operationId, {
          status: 'failed',
          providerResult: 'failed',
          errorCode: job.errorCode,
          errorMessage: job.errorMessage,
        }).catch(() => {});
        return {
          ok: false,
          status: 502,
          error: safeMsg,
          code: 'PROVIDER_DELETE_FAILED',
          job,
        };
      }
    } else {
      job.status = 'asset_deleted';
      await patchDeletionJob(operationId, {
        status: 'asset_deleted',
        providerResult: job.providerResult,
      }).catch(() => {});
    }

    // 4. Exclusive Thumbnail Cleanup (retain if shared or ownership unclear)
    const thumbUrl = videoDoc.fields.thumbnailUrl?.stringValue || '';
    const creatorId =
      videoDoc.fields.creatorId?.stringValue ||
      assetDoc.fields.creatorId?.stringValue ||
      sqlMedia?.creatorId ||
      '';
    if (thumbUrl) {
      const thumbCheck = await verifyExclusiveLocalThumbnail({
        thumbnailsDir: THUMBNAILS_DIR,
        thumbUrl,
        excludeVideoId: videoId,
        expectedCreatorId: creatorId,
        projectId: firebaseConfig.projectId,
        databaseId: firebaseConfig.firestoreDatabaseId,
        bearerToken,
      });

      if (thumbCheck.safeToDelete) {
        try {
          const fileStatus = deleteFileIfExists(thumbCheck.resolvedPath);
          let sqlThumbDeleted = 0;
          if (isSqlConfigured()) {
            const sqlRes = await deleteThumbnailAssetSql(thumbCheck.sqlThumbKey);
            sqlThumbDeleted = sqlRes.deletedCount;
          }
          job.thumbnailResult =
            fileStatus === 'deleted' || sqlThumbDeleted > 0
              ? 'deleted'
              : 'already_missing';
        } catch {
          job.thumbnailResult = 'retained_cleanup_error';
        }
      } else {
        job.thumbnailResult = thumbCheck.reason;
      }
    }

    // 5. Delete Firestore video_assets/{videoId} & videos/{videoId} (404-safe for retry)
    try {
      const [assetDel, videoDel] = await Promise.all([
        firestoreDeleteDocument(
          firebaseConfig.projectId,
          firebaseConfig.firestoreDatabaseId,
          'video_assets',
          videoId,
          bearerToken
        ),
        firestoreDeleteDocument(
          firebaseConfig.projectId,
          firebaseConfig.firestoreDatabaseId,
          'videos',
          videoId,
          bearerToken
        ),
      ]);
      blockedVideoStatuses.set(videoId, 'deleted');
      job.firestoreResult =
        assetDel.alreadyMissing && videoDel.alreadyMissing
          ? 'already_missing'
          : 'deleted';
      job.status = 'metadata_deleted';
      await patchDeletionJob(operationId, {
        status: job.status,
        firestoreResult: job.firestoreResult,
        thumbnailResult: job.thumbnailResult,
      });
    } catch (err) {
      const safeMsg =
        err instanceof Error
          ? err.message
          : 'Failed to delete Firestore video metadata.';
      job.status = 'asset_deleted';
      job.errorCode = 'FIRESTORE_DELETE_FAILED';
      job.errorMessage = safeMsg.slice(0, 280);
      await patchDeletionJob(operationId, {
        status: 'asset_deleted',
        firestoreResult: 'failed',
        thumbnailResult: job.thumbnailResult,
        errorCode: job.errorCode,
        errorMessage: job.errorMessage,
      }).catch(() => {});
      return {
        ok: false,
        status: 502,
        error: safeMsg,
        code: 'FIRESTORE_DELETE_FAILED',
        job,
      };
    }

    // 6. Delete PostgreSQL / Ledger creator_media mapping ONLY (financial tables preserved)
    try {
      const sqlCleanup = await removeStoredMediaBinding(videoId);
      job.sqlResult =
        sqlCleanup.deletedCount > 0 ? 'deleted' : 'already_missing';
      job.status = 'completed';
      job.completedAt = new Date().toISOString();
      job.errorCode = null;
      job.errorMessage = null;
      await patchDeletionJob(operationId, {
        status: 'completed',
        sqlResult: job.sqlResult,
        completedAt: job.completedAt,
        errorCode: null,
        errorMessage: null,
      });
    } catch (err) {
      const safeMsg =
        err instanceof Error
          ? err.message
          : 'Failed to remove creator_media mapping.';
      job.status = 'metadata_deleted';
      job.errorCode = 'SQL_CLEANUP_FAILED';
      job.errorMessage = safeMsg.slice(0, 280);
      await patchDeletionJob(operationId, {
        status: 'metadata_deleted',
        sqlResult: 'failed',
        errorCode: job.errorCode,
        errorMessage: job.errorMessage,
      }).catch(() => {});
      return {
        ok: false,
        status: 502,
        error: safeMsg,
        code: 'SQL_CLEANUP_FAILED',
        job,
      };
    }

    return {
      ok: true,
      job,
      preservedFinancialRecords: true,
    };
  };

  app.delete('/api/admin/videos/:videoId', requireAdmin, async (req: AuthedRequest, res) => {
    const videoId = req.params.videoId;
    const body = (req.body || {}) as { confirmationText?: unknown };
    const headerConf = req.headers['x-delete-confirmation'];
    const rawConfirmation =
      typeof body.confirmationText === 'string'
        ? body.confirmationText.trim()
        : typeof headerConf === 'string'
        ? headerConf.trim()
        : '';

    const outcome = await performPermanentVideoDelete({
      videoId,
      adminUid: req.user!.uid,
      bearerToken: req.user!.rawIdToken,
      confirmationMode: 'exact_title',
      confirmationText: rawConfirmation,
    });

    if (!outcome.ok) {
      res.status(outcome.status).json({
        error: outcome.error,
        ...(outcome.code ? { code: outcome.code } : {}),
        ...(outcome.job ? { job: outcome.job } : {}),
      });
      return;
    }

    res.json(outcome);
  });

  app.post('/api/admin/videos/bulk-delete', requireAdmin, async (req: AuthedRequest, res) => {
    const body = (req.body || {}) as {
      videoIds?: unknown;
      confirmationPhrase?: unknown;
    };

    if (!Array.isArray(body.videoIds) || body.videoIds.length === 0) {
      res.status(400).json({ error: 'Pilih minimal satu video untuk dihapus permanen.' });
      return;
    }

    const uniqueIds = Array.from(
      new Set(
        body.videoIds
          .filter((id): id is string => typeof id === 'string')
          .map((id) => id.trim())
          .filter(Boolean)
      )
    );

    if (uniqueIds.length === 0 || uniqueIds.length > 50) {
      res.status(400).json({
        error: 'Jumlah video untuk penghapusan massal harus antara 1 sampai 50 video.',
      });
      return;
    }

    for (const id of uniqueIds) {
      if (!isValidSafeId(id)) {
        res.status(400).json({ error: `Invalid videoId in selection: ${id}` });
        return;
      }
    }

    const rawPhrase =
      typeof body.confirmationPhrase === 'string'
        ? body.confirmationPhrase.trim().toUpperCase().replace(/\s+/g, ' ')
        : '';
    const expectedIdPhrase = `HAPUS ${uniqueIds.length} VIDEO`;
    const expectedEnPhrase = `DELETE ${uniqueIds.length} VIDEOS`;
    const expectedEnSingular = `DELETE ${uniqueIds.length} VIDEO`;

    if (
      rawPhrase !== expectedIdPhrase &&
      rawPhrase !== expectedEnPhrase &&
      rawPhrase !== expectedEnSingular
    ) {
      res.status(400).json({
        error: `Konfirmasi penghapusan massal tidak cocok. Ketik "${expectedIdPhrase}" untuk melanjutkan.`,
        code: 'BULK_CONFIRMATION_MISMATCH',
      });
      return;
    }

    const results: Array<{
      videoId: string;
      ok: boolean;
      error?: string;
      code?: string;
      job?: VideoDeletionJobRecord;
    }> = [];

    let deletedCount = 0;
    let failedCount = 0;

    for (const videoId of uniqueIds) {
      const outcome = await performPermanentVideoDelete({
        videoId,
        adminUid: req.user!.uid,
        bearerToken: req.user!.rawIdToken,
        confirmationMode: 'bulk_verified',
      });

      if (outcome.ok) {
        deletedCount += 1;
        results.push({ videoId, ok: true, job: outcome.job });
      } else {
        failedCount += 1;
        results.push({
          videoId,
          ok: false,
          error: outcome.error,
          code: outcome.code,
          job: outcome.job,
        });
      }
    }

    res.json({
      ok: deletedCount > 0 || failedCount === 0,
      total: uniqueIds.length,
      deletedCount,
      failedCount,
      preservedFinancialRecords: true,
      results,
    });
  });

  return app;
}
