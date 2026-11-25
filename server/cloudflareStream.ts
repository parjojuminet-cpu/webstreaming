import crypto from 'node:crypto';

export interface CloudflareDirectTusUploadResult {
  uid: string;
  uploadUrl: string;
  requiresSignedUrls: boolean;
}

export interface CloudflareVideoStatusResult {
  uid: string;
  readyToStream: boolean;
  state: string;
  pctComplete: number;
  durationSeconds: number;
  thumbnailUrl?: string;
}

export function isCloudflareStreamConfigured(): boolean {
  const accountId = process.env.CLOUDFLARE_STREAM_ACCOUNT_ID?.trim() || '';
  const apiToken = process.env.CLOUDFLARE_STREAM_API_TOKEN?.trim() || '';
  return accountId.length >= 8 && apiToken.length >= 10;
}

export function isCloudflareSigningConfigured(): boolean {
  const keyId = process.env.CLOUDFLARE_STREAM_SIGNING_KEY_ID?.trim() || '';
  const privKey = process.env.CLOUDFLARE_STREAM_SIGNING_PRIVATE_KEY?.trim() || '';
  return keyId.length >= 6 && privKey.length >= 20;
}

function getAccountAndToken(): { accountId: string; apiToken: string } {
  const accountId = process.env.CLOUDFLARE_STREAM_ACCOUNT_ID?.trim() || '';
  const apiToken = process.env.CLOUDFLARE_STREAM_API_TOKEN?.trim() || '';
  if (!accountId || !apiToken) {
    throw new Error(
      'Cloudflare Stream credentials are not configured on the server.'
    );
  }
  return { accountId, apiToken };
}

function parseCloudflarePrivateKey(rawInput: string): crypto.KeyObject {
  const trimmed = rawInput.trim().replace(/\\n/g, '\n');

  if (trimmed.startsWith('-----BEGIN')) {
    return crypto.createPrivateKey({ key: trimmed, format: 'pem' });
  }

  if (trimmed.startsWith('{')) {
    const jwk = JSON.parse(trimmed) as crypto.JsonWebKey;
    return crypto.createPrivateKey({ key: jwk, format: 'jwk' });
  }

  const decoded = Buffer.from(trimmed, 'base64').toString('utf-8').trim();
  if (decoded.startsWith('-----BEGIN')) {
    return crypto.createPrivateKey({ key: decoded, format: 'pem' });
  }
  if (decoded.startsWith('{')) {
    const jwk = JSON.parse(decoded) as crypto.JsonWebKey;
    return crypto.createPrivateKey({ key: jwk, format: 'jwk' });
  }

  throw new Error('Unsupported CLOUDFLARE_STREAM_SIGNING_PRIVATE_KEY format.');
}

function encodeBase64UrlJson(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj), 'utf-8').toString('base64url');
}

export function signCloudflareStreamToken(
  videoUid: string,
  options: { ttlSeconds: number }
): string | null {
  if (!isCloudflareSigningConfigured()) return null;

  const keyId = process.env.CLOUDFLARE_STREAM_SIGNING_KEY_ID!.trim();
  const rawPrivateKey = process.env.CLOUDFLARE_STREAM_SIGNING_PRIVATE_KEY!;
  const privateKey = parseCloudflarePrivateKey(rawPrivateKey);

  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = nowSec + Math.max(60, Math.min(86400, Math.round(options.ttlSeconds)));

  const header = encodeBase64UrlJson({ alg: 'RS256', kid: keyId, typ: 'JWT' });
  const payload = encodeBase64UrlJson({
    sub: videoUid,
    kid: keyId,
    exp: expSec,
    nbf: nowSec - 15,
    downloadable: false,
    accessRules: [{ type: 'any', action: 'allow' }],
  });

  const signingInput = `${header}.${payload}`;
  const signature = crypto
    .sign('RSA-SHA256', Buffer.from(signingInput, 'utf-8'), privateKey)
    .toString('base64url');

  return `${signingInput}.${signature}`;
}

export function buildCloudflareHlsUrl(uidOrSignedToken: string): string {
  const rawSubdomain = (process.env.CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN || '').trim();
  const cleanSubdomain = rawSubdomain.replace(/^https?:\/\//i, '').replace(/\/+$/, '');

  if (cleanSubdomain && /^[a-zA-Z0-9.-]+$/.test(cleanSubdomain)) {
    const host = cleanSubdomain.includes('.')
      ? cleanSubdomain
      : `${cleanSubdomain}.cloudflarestream.com`;
    return `https://${host}/${encodeURIComponent(uidOrSignedToken)}/manifest/video.m3u8`;
  }

  return `https://videodelivery.net/${encodeURIComponent(uidOrSignedToken)}/manifest/video.m3u8`;
}

function encodeTusMetaValue(value: string): string {
  return Buffer.from(value, 'utf-8').toString('base64');
}

export async function createCloudflareTusDirectUpload(input: {
  uploadLength: number;
  creatorId: string;
  filename?: string;
  maxDurationSeconds?: number;
}): Promise<CloudflareDirectTusUploadResult> {
  const { accountId, apiToken } = getAccountAndToken();
  const safeDuration = Math.max(
    60,
    Math.min(21600, Math.round(input.maxDurationSeconds ?? 21600))
  );
  const requiresSignedUrls = isCloudflareSigningConfigured();
  const safeName = (input.filename || 'vyora-release')
    .replace(/[^\w.\- ]/g, '_')
    .slice(0, 120);

  const metaParts: string[] = [
    `name ${encodeTusMetaValue(safeName)}`,
    `maxdurationseconds ${encodeTusMetaValue(String(safeDuration))}`,
  ];
  if (requiresSignedUrls) {
    metaParts.push('requiresignedurls');
  }

  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
    accountId
  )}/stream?direct_user=true`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Tus-Resumable': '1.0.0',
      'Upload-Length': String(Math.round(input.uploadLength)),
      'Upload-Creator': input.creatorId.slice(0, 64),
      'Upload-Metadata': metaParts.join(','),
    },
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(
      `Cloudflare Stream Direct Upload failed (${res.status}): ${errText.slice(0, 200)}`
    );
  }

  const uploadUrl = res.headers.get('location') || '';
  const uid = res.headers.get('stream-media-id') || '';

  if (!uploadUrl || !uid) {
    throw new Error(
      'Cloudflare Stream response missing TUS upload Location or stream-media-id.'
    );
  }

  return {
    uid,
    uploadUrl,
    requiresSignedUrls,
  };
}

export async function getCloudflareVideoStatus(
  uid: string
): Promise<CloudflareVideoStatusResult> {
  const { accountId, apiToken } = getAccountAndToken();
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
    accountId
  )}/stream/${encodeURIComponent(uid)}`;

  const res = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${apiToken}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Unable to fetch Cloudflare Stream video status (${res.status}).`);
  }

  const data = (await res.json()) as {
    success?: boolean;
    result?: {
      uid?: string;
      readyToStream?: boolean;
      duration?: number;
      thumbnail?: string;
      status?: {
        state?: string;
        pctComplete?: string | number;
      };
    };
  };

  const result = data.result;
  return {
    uid: result?.uid || uid,
    readyToStream: Boolean(result?.readyToStream),
    state: result?.status?.state || 'queued',
    pctComplete: Number(result?.status?.pctComplete ?? 0),
    durationSeconds: Number(result?.duration ?? 0),
    thumbnailUrl: result?.thumbnail,
  };
}

export async function deleteCloudflareVideo(
  uid: string
): Promise<{ deleted: boolean; alreadyMissing: boolean }> {
  const cleanUid = uid.trim();
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(cleanUid)) {
    throw new Error('Invalid Cloudflare Stream video UID.');
  }

  const { accountId, apiToken } = getAccountAndToken();
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
    accountId
  )}/stream/${encodeURIComponent(cleanUid)}`;

  const res = await fetch(endpoint, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${apiToken}`,
    },
  });

  if (res.status === 404) {
    return { deleted: true, alreadyMissing: true };
  }

  if (!res.ok) {
    throw new Error(`Cloudflare Stream deletion failed with HTTP ${res.status}.`);
  }

  return { deleted: true, alreadyMissing: false };
}

