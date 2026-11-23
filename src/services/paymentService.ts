import { auth } from '../lib/firebase';
import type {
  AdminFinanceOverview,
  CreatorEarningRecord,
  PaymentOrderRecord,
  PaymentPurpose,
  PayoutRecord,
  PurchaseRecord,
  WalletRecord,
  WalletTransactionRecord,
} from '../types/vyora';

async function getAuthHeaders(idempotencyKey?: string): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const user = auth.currentUser;
  if (user) {
    const token = await user.getIdToken();
    headers.Authorization = `Bearer ${token}`;
  }
  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey;
  }
  return headers;
}

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export interface WalletOverviewResponse {
  wallet: WalletRecord;
  transactions: WalletTransactionRecord[];
  purchases: PurchaseRecord[];
  payments: PaymentOrderRecord[];
  serverTimeIso: string;
}

export async function fetchMyWalletSummary(): Promise<WalletOverviewResponse> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/wallet/me', { headers });
  return parseJsonOrThrow<WalletOverviewResponse>(res);
}

export async function spendCreditsForVideo(
  videoId: string,
  resumeSeconds: number,
  idempotencyKey: string
): Promise<{
  payment: PaymentOrderRecord;
  purchase: PurchaseRecord;
  wallet: WalletRecord;
}> {
  const headers = await getAuthHeaders(idempotencyKey);
  const res = await fetch('/api/wallet/spend', {
    method: 'POST',
    headers,
    body: JSON.stringify({ videoId, resumeSeconds }),
  });
  return parseJsonOrThrow(res);
}

export async function createPayPalOrder(
  purpose: PaymentPurpose,
  targetId: string,
  resumeSeconds: number,
  idempotencyKey: string
): Promise<{
  payment: PaymentOrderRecord;
  sandboxCaptureToken?: string;
}> {
  const headers = await getAuthHeaders(idempotencyKey);
  const res = await fetch('/api/payments/paypal/create-order', {
    method: 'POST',
    headers,
    body: JSON.stringify({ purpose, targetId, resumeSeconds }),
  });
  return parseJsonOrThrow(res);
}

export async function capturePayPalOrder(
  paymentId: string,
  sandboxCaptureToken: string | undefined,
  resumeSeconds: number,
  idempotencyKey: string
): Promise<{
  payment: PaymentOrderRecord;
  purchase?: PurchaseRecord | null;
  wallet: WalletRecord;
}> {
  const headers = await getAuthHeaders(idempotencyKey);
  const res = await fetch('/api/payments/paypal/capture', {
    method: 'POST',
    headers,
    body: JSON.stringify({ paymentId, sandboxCaptureToken, resumeSeconds }),
  });
  return parseJsonOrThrow(res);
}

export async function createQrisCharge(
  purpose: PaymentPurpose,
  targetId: string,
  resumeSeconds: number,
  idempotencyKey: string
): Promise<{ payment: PaymentOrderRecord }> {
  const headers = await getAuthHeaders(idempotencyKey);
  const res = await fetch('/api/payments/qris/create', {
    method: 'POST',
    headers,
    body: JSON.stringify({ purpose, targetId, resumeSeconds }),
  });
  return parseJsonOrThrow(res);
}

export async function fetchPaymentStatus(paymentId: string): Promise<{
  payment: PaymentOrderRecord;
  wallet: WalletRecord;
}> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/payments/${encodeURIComponent(paymentId)}/status`, {
    headers,
  });
  return parseJsonOrThrow(res);
}

export async function settleSandboxQrisPayment(
  paymentId: string,
  resumeSeconds: number
): Promise<{
  payment: PaymentOrderRecord;
  wallet: WalletRecord;
}> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/payments/qris/sandbox-settle', {
    method: 'POST',
    headers,
    body: JSON.stringify({ paymentId, resumeSeconds }),
  });
  return parseJsonOrThrow(res);
}

export interface CreatorEarningsSummary {
  commissionPercent: number;
  grossUsd: number;
  grossIdr: number;
  netUsd: number;
  netIdr: number;
  withdrawnUsd: number;
  withdrawnIdr: number;
  availableUsd: number;
  availableIdr: number;
  earnings: CreatorEarningRecord[];
  payouts: PayoutRecord[];
}

export async function fetchCreatorEarningsSummary(): Promise<CreatorEarningsSummary> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/creator/earnings/me', { headers });
  return parseJsonOrThrow<CreatorEarningsSummary>(res);
}

export async function requestCreatorPayout(
  input: {
    creatorName: string;
    currency: 'USD' | 'IDR';
    amount: number;
    method: 'bank_transfer_idr' | 'ewallet_idr' | 'paypal_usd';
    destination: string;
  },
  idempotencyKey: string
): Promise<{ payout: PayoutRecord; summary: CreatorEarningsSummary }> {
  const headers = await getAuthHeaders(idempotencyKey);
  const res = await fetch('/api/creator/payouts/request', {
    method: 'POST',
    headers,
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow(res);
}

export async function fetchAdminFinanceOverview(): Promise<AdminFinanceOverview> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/admin/finance/overview', { headers });
  return parseJsonOrThrow<AdminFinanceOverview>(res);
}

export async function adminRefundPayment(
  paymentId: string,
  idempotencyKey: string
): Promise<{ ok: boolean; payment: PaymentOrderRecord; overview: AdminFinanceOverview }> {
  const headers = await getAuthHeaders(idempotencyKey);
  const res = await fetch('/api/admin/refunds', {
    method: 'POST',
    headers,
    body: JSON.stringify({ paymentId }),
  });
  return parseJsonOrThrow(res);
}

export async function adminUpdatePayoutStatus(
  payoutId: string,
  status: 'processing' | 'paid' | 'rejected',
  adminNote: string
): Promise<{ payout: PayoutRecord; overview: AdminFinanceOverview }> {
  const headers = await getAuthHeaders();
  const res = await fetch(
    `/api/admin/payouts/${encodeURIComponent(payoutId)}/status`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ status, adminNote }),
    }
  );
  return parseJsonOrThrow(res);
}

export async function syncAdminPlatformSettings(input: {
  commissionPercent: number;
  minPriceUsd: number;
  minPriceIdr: number;
}): Promise<void> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/admin/settings', {
    method: 'POST',
    headers,
    body: JSON.stringify(input),
  });
  await parseJsonOrThrow<{ ok: boolean }>(res);
}
