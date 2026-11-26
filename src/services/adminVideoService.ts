import { auth } from '../lib/firebase';
import type {
  AdminVideoAssetInfo,
  ContentStatus,
  VideoDeletionJobRecord,
} from '../types/vyora';

export class AdminVideoApiError extends Error {
  code?: string;
  status: number;
  job?: VideoDeletionJobRecord;

  constructor(
    message: string,
    status: number,
    code?: string,
    job?: VideoDeletionJobRecord
  ) {
    super(message);
    this.name = 'AdminVideoApiError';
    this.status = status;
    this.code = code;
    this.job = job;
  }
}

async function getAdminAuthHeaders(): Promise<Record<string, string>> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new AdminVideoApiError('Admin authentication required.', 401, 'AUTH_REQUIRED');
  }
  const idToken = await currentUser.getIdToken();
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${idToken}`,
  };
}

async function parseErrorResponse(res: Response, fallbackMsg: string): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
    job?: VideoDeletionJobRecord;
  };
  throw new AdminVideoApiError(
    body.error || fallbackMsg,
    res.status,
    body.code,
    body.job
  );
}

export async function fetchAdminVideoDeletionJobs(): Promise<VideoDeletionJobRecord[]> {
  const headers = await getAdminAuthHeaders();
  const res = await fetch('/api/admin/video-deletion-jobs', { headers });
  if (!res.ok) {
    await parseErrorResponse(res, 'Failed to load video deletion audit logs.');
  }
  const data = (await res.json()) as { jobs?: VideoDeletionJobRecord[] };
  return data.jobs ?? [];
}

export async function fetchAdminVideoAssetInfo(videoId: string): Promise<{
  assetInfo: AdminVideoAssetInfo;
  latestJob: VideoDeletionJobRecord | null;
}> {
  const headers = await getAdminAuthHeaders();
  const res = await fetch(
    `/api/admin/videos/${encodeURIComponent(videoId)}/asset-info`,
    { headers }
  );
  if (!res.ok) {
    await parseErrorResponse(res, 'Failed to load video asset metadata.');
  }
  return (await res.json()) as {
    assetInfo: AdminVideoAssetInfo;
    latestJob: VideoDeletionJobRecord | null;
  };
}

export async function adminArchiveVideoApi(
  videoId: string,
  moderationNote?: string
): Promise<{
  ok: true;
  videoId: string;
  status: 'archived';
  previousStatus: ContentStatus | '';
}> {
  const headers = await getAdminAuthHeaders();
  const res = await fetch(
    `/api/admin/videos/${encodeURIComponent(videoId)}/archive`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ moderationNote }),
    }
  );
  if (!res.ok) {
    await parseErrorResponse(res, 'Failed to archive video.');
  }
  return (await res.json()) as {
    ok: true;
    videoId: string;
    status: 'archived';
    previousStatus: ContentStatus | '';
  };
}

export async function adminRestoreVideoApi(
  videoId: string,
  options?: {
    targetStatus?: Exclude<ContentStatus, 'archived' | 'deletion_pending'>;
    moderationNote?: string;
  }
): Promise<{
  ok: true;
  videoId: string;
  status: ContentStatus;
  restoredFromPreviousStatus: boolean;
}> {
  const headers = await getAdminAuthHeaders();
  const res = await fetch(
    `/api/admin/videos/${encodeURIComponent(videoId)}/restore`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(options ?? {}),
    }
  );
  if (!res.ok) {
    await parseErrorResponse(res, 'Failed to restore archived video.');
  }
  return (await res.json()) as {
    ok: true;
    videoId: string;
    status: ContentStatus;
    restoredFromPreviousStatus: boolean;
  };
}

export async function adminDeleteVideoPermanentlyApi(
  videoId: string,
  confirmationText: string
): Promise<{
  ok: true;
  idempotent?: boolean;
  job: VideoDeletionJobRecord;
  preservedFinancialRecords: boolean;
}> {
  const headers = await getAdminAuthHeaders();
  const res = await fetch(`/api/admin/videos/${encodeURIComponent(videoId)}`, {
    method: 'DELETE',
    headers,
    body: JSON.stringify({ confirmationText }),
  });
  if (!res.ok) {
    await parseErrorResponse(res, 'Failed to permanently delete video.');
  }
  return (await res.json()) as {
    ok: true;
    idempotent?: boolean;
    job: VideoDeletionJobRecord;
    preservedFinancialRecords: boolean;
  };
}

export interface BulkDeleteVideoResultItem {
  videoId: string;
  ok: boolean;
  error?: string;
  code?: string;
  job?: VideoDeletionJobRecord;
}

export interface BulkDeleteVideosResponse {
  ok: boolean;
  total: number;
  deletedCount: number;
  failedCount: number;
  preservedFinancialRecords: boolean;
  results: BulkDeleteVideoResultItem[];
}

export async function adminBulkDeleteVideosApi(
  videoIds: string[],
  confirmationPhrase: string
): Promise<BulkDeleteVideosResponse> {
  const headers = await getAdminAuthHeaders();
  const res = await fetch('/api/admin/videos/bulk-delete', {
    method: 'POST',
    headers,
    body: JSON.stringify({ videoIds, confirmationPhrase }),
  });
  if (!res.ok) {
    await parseErrorResponse(res, 'Failed to run bulk permanent video deletion.');
  }
  return (await res.json()) as BulkDeleteVideosResponse;
}
