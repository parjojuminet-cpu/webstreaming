import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import QRCode from 'qrcode';
import type {
  AdminFinanceOverview,
  CreatorEarningRecord,
  PaymentGateway,
  PaymentOrderRecord,
  PayoutRecord,
  PurchaseRecord,
  WalletTransactionRecord,
} from '../src/types/vyora';

export interface ServerEntitlement {
  id: string;
  userId: string;
  videoId: string;
  videoTitle: string;
  thumbnailUrl: string;
  grantedAtMs: number;
  expiresAtMs: number;
  resumeSeconds: number;
  status?: 'active' | 'revoked';
  source: 'phase3_trial_pass' | 'payment_verified';
}

export interface ServerWallet {
  userId: string;
  balanceCredits: number;
  totalSpentCredits: number;
  updatedAtMs: number;
}

export interface ServerCatalogEntry {
  id: string;
  title: string;
  category: string;
  creatorId: string;
  thumbnailUrl: string;
  priceUsd: number;
  priceIdr: number;
  creditCost: number;
}

export interface ServerCreditPackage {
  id: string;
  name: string;
  credits: number;
  bonusCredits: number;
  priceUsd: number;
  priceIdr: number;
}

interface IdempotencyEntry {
  status: number;
  body: unknown;
  createdAtMs: number;
}

export interface CreatorMediaBinding {
  videoId: string;
  creatorId: string;
  provider: 'cloudflare_stream' | 'private_storage' | 'youtube' | 'facebook';
  assetRef: string;
  mimeType?: string;
  updatedAtIso: string;
}

interface LedgerState {
  wallets: Record<string, ServerWallet>;
  walletTransactions: WalletTransactionRecord[];
  payments: Record<string, PaymentOrderRecord>;
  purchases: PurchaseRecord[];
  entitlements: Record<string, ServerEntitlement>;
  creatorEarnings: CreatorEarningRecord[];
  payouts: PayoutRecord[];
  idempotency: Record<string, IdempotencyEntry>;
  processedWebhooks: Record<string, number>;
  creatorMedia?: Record<string, CreatorMediaBinding>;
  platformSettings: {
    commissionPercent: number;
    minPriceUsd: number;
    minPriceIdr: number;
  };
}

export const PREVIEW_LIMIT_SECONDS = 300;
export const ACCESS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const PAYMENT_TTL_MS = 15 * 60 * 1000; // 15 minutes for QRIS / pending order

const SERVER_DATA_DIR =
  process.env.VERCEL === '1'
    ? path.resolve(os.tmpdir(), '.vyora_server_data')
    : path.resolve(process.cwd(), '.vyora_server_data');
const LEDGER_FILE = path.resolve(SERVER_DATA_DIR, 'ledger.json');
const LEGACY_ENTITLEMENTS_FILE = path.resolve(SERVER_DATA_DIR, 'entitlements.json');

export const SERVER_CATALOG: Record<string, ServerCatalogEntry> = {};

export const SERVER_CREDIT_PACKAGES: Record<string, ServerCreditPackage> = {
  'pack-starter': {
    id: 'pack-starter',
    name: 'Viewer Pack',
    credits: 10,
    bonusCredits: 0,
    priceUsd: 9.5,
    priceIdr: 149000,
  },
  'pack-cinema': {
    id: 'pack-cinema',
    name: 'Cinema Pass',
    credits: 25,
    bonusCredits: 4,
    priceUsd: 22.0,
    priceIdr: 349000,
  },
  'pack-studio': {
    id: 'pack-studio',
    name: 'Patron Vault',
    credits: 60,
    bonusCredits: 12,
    priceUsd: 49.0,
    priceIdr: 779000,
  },
};

let mutexTail: Promise<void> = Promise.resolve();

export async function withLedgerLock<T>(task: () => Promise<T>): Promise<T> {
  const previous = mutexTail;
  let release!: () => void;
  mutexTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await task();
  } finally {
    release();
  }
}

function ensureDataDir(): void {
  if (!fs.existsSync(SERVER_DATA_DIR)) {
    fs.mkdirSync(SERVER_DATA_DIR, { recursive: true });
  }
}

export function loadLedger(): LedgerState {
  ensureDataDir();
  if (fs.existsSync(LEDGER_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(LEDGER_FILE, 'utf-8')) as Partial<LedgerState>;
      return {
        wallets: parsed.wallets ?? {},
        walletTransactions: parsed.walletTransactions ?? [],
        payments: parsed.payments ?? {},
        purchases: parsed.purchases ?? [],
        entitlements: parsed.entitlements ?? {},
        creatorEarnings: parsed.creatorEarnings ?? [],
        payouts: parsed.payouts ?? [],
        idempotency: parsed.idempotency ?? {},
        processedWebhooks: parsed.processedWebhooks ?? {},
        creatorMedia: parsed.creatorMedia ?? {},
        platformSettings: parsed.platformSettings ?? {
          commissionPercent: 20,
          minPriceUsd: 1.99,
          minPriceIdr: 29000,
        },
      };
    } catch {
      // Fall through to clean initialized state
    }
  }

  let initialEntitlements: Record<string, ServerEntitlement> = {};
  if (fs.existsSync(LEGACY_ENTITLEMENTS_FILE)) {
    try {
      initialEntitlements = JSON.parse(
        fs.readFileSync(LEGACY_ENTITLEMENTS_FILE, 'utf-8')
      ) as Record<string, ServerEntitlement>;
    } catch {
      initialEntitlements = {};
    }
  }

  const initial: LedgerState = {
    wallets: {},
    walletTransactions: [],
    payments: {},
    purchases: [],
    entitlements: initialEntitlements,
    creatorEarnings: [],
    payouts: [],
    idempotency: {},
    processedWebhooks: {},
    creatorMedia: {},
    platformSettings: {
      commissionPercent: 20,
      minPriceUsd: 1.99,
      minPriceIdr: 29000,
    },
  };
  saveLedger(initial);
  return initial;
}

export function saveLedger(state: LedgerState): void {
  ensureDataDir();
  // Prune old idempotency cache beyond 1,000 entries
  const idemKeys = Object.keys(state.idempotency);
  if (idemKeys.length > 1000) {
    idemKeys
      .sort((a, b) => state.idempotency[a].createdAtMs - state.idempotency[b].createdAtMs)
      .slice(0, idemKeys.length - 1000)
      .forEach((k) => {
        delete state.idempotency[k];
      });
  }

  const tempFile = path.resolve(
    SERVER_DATA_DIR,
    `ledger.${process.pid}.${Date.now()}.tmp`
  );
  fs.writeFileSync(tempFile, JSON.stringify(state, null, 2), 'utf-8');
  fs.renameSync(tempFile, LEDGER_FILE);
}

export function entitlementKey(uid: string, videoId: string): string {
  return `${uid}::${videoId}`;
}

export function getOrInitWallet(state: LedgerState, userId: string): ServerWallet {
  if (!state.wallets[userId]) {
    state.wallets[userId] = {
      userId,
      balanceCredits: 0,
      totalSpentCredits: 0,
      updatedAtMs: Date.now(),
    };
  }
  return state.wallets[userId];
}

export function checkIdempotency(
  state: LedgerState,
  scope: string,
  userId: string,
  key: string | undefined
): IdempotencyEntry | null {
  if (!key) return null;
  const fullKey = `${scope}:${userId}:${key}`;
  return state.idempotency[fullKey] ?? null;
}

export function storeIdempotency(
  state: LedgerState,
  scope: string,
  userId: string,
  key: string | undefined,
  status: number,
  body: unknown
): void {
  if (!key) return;
  const fullKey = `${scope}:${userId}:${key}`;
  state.idempotency[fullKey] = {
    status,
    body,
    createdAtMs: Date.now(),
  };
}

// Resolve published video pricing from server catalog or Firestore public REST endpoint
export async function resolveServerVideoEntry(
  videoId: string,
  projectId: string,
  databaseId: string
): Promise<ServerCatalogEntry | null> {
  if (SERVER_CATALOG[videoId]) {
    return SERVER_CATALOG[videoId];
  }

  try {
    const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      projectId
    )}/databases/${encodeURIComponent(databaseId)}/documents/videos/${encodeURIComponent(
      videoId
    )}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const doc = (await res.json()) as {
      fields?: Record<
        string,
        { stringValue?: string; integerValue?: string; doubleValue?: number }
      >;
    };
    const f = doc.fields;
    if (!f || f.status?.stringValue !== 'published') return null;

    const parseFirestoreNumber = (
      field: { integerValue?: string; doubleValue?: number } | undefined,
      fallback: number
    ): number => {
      if (!field) return fallback;
      if (typeof field.doubleValue === 'number' && Number.isFinite(field.doubleValue)) {
        return field.doubleValue;
      }
      if (field.integerValue !== undefined) {
        const parsed = Number(field.integerValue);
        if (Number.isFinite(parsed)) return parsed;
      }
      return fallback;
    };

    const priceUsd = parseFirestoreNumber(f.priceUsd, 4.99);
    const priceIdr = Math.round(parseFirestoreNumber(f.priceIdr, 75000));
    const creditCost = Math.round(parseFirestoreNumber(f.creditCost, 5));

    return {
      id: videoId,
      title: f.title?.stringValue || videoId,
      category: f.category?.stringValue || 'Movies',
      creatorId: f.creatorId?.stringValue || 'creator-unknown',
      thumbnailUrl: f.thumbnailUrl?.stringValue || '',
      priceUsd,
      priceIdr,
      creditCost,
    };
  } catch {
    return null;
  }
}

export function hasActiveEntitlement(
  state: LedgerState,
  userId: string,
  videoId: string,
  now = Date.now()
): boolean {
  const ent = state.entitlements[entitlementKey(userId, videoId)];
  return Boolean(ent && ent.status !== 'revoked' && now < ent.expiresAtMs);
}

// Compute CRC-16/CCITT-FALSE for EMVCo QRIS string formatting
function crc16Ccitt(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i += 1) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j += 1) {
      crc = (crc & 0x8000) !== 0 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export async function generateQrisSvg(qrString: string): Promise<string> {
  return QRCode.toString(qrString, {
    type: 'svg',
    margin: 1,
    width: 220,
    color: {
      dark: '#11121A',
      light: '#FFFFFF',
    },
  });
}

export function buildQrisPayloadString(orderId: string, amountIdr: number): string {
  const amountStr = String(Math.round(amountIdr));
  const amtTag = `54${String(amountStr.length).padStart(2, '0')}${amountStr}`;
  const refTag = `05${String(orderId.length).padStart(2, '0')}${orderId}`;
  const addlData = `62${String(refTag.length).padStart(2, '0')}${refTag}`;
  const bodyWithoutCrc =
    `000201010212` +
    `26590014ID.CO.QRIS.WWW01189360091430000000010215ID10200000000010303UME` +
    `520458155303360${amtTag}5802ID` +
    `5914DELOKEN STREAM6007JAKARTA610512190${addlData}6304`;
  return `${bodyWithoutCrc}${crc16Ccitt(bodyWithoutCrc)}`;
}

// PayPal Live / Payment Link / Sandbox REST Client helpers
export const DEFAULT_PAYPAL_PAYMENT_LINK = 'https://www.paypal.com/ncp/payment/NNY5BAAE3XSMG';

export function isAllowedPayPalUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'https:') return null;
    const host = parsed.hostname.toLowerCase();
    if (host !== 'paypal.com' && !host.endsWith('.paypal.com')) return null;
    parsed.username = '';
    parsed.password = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

export function getPayPalPaymentLink(): string | null {
  const raw = process.env.PAYPAL_PAYMENT_LINK?.trim() || DEFAULT_PAYPAL_PAYMENT_LINK;
  return isAllowedPayPalUrl(raw);
}

export function isPayPalConfigured(): boolean {
  return Boolean(
    process.env.PAYPAL_CLIENT_ID &&
      process.env.PAYPAL_CLIENT_SECRET &&
      process.env.PAYPAL_CLIENT_ID.trim().length > 5 &&
      process.env.PAYPAL_CLIENT_SECRET.trim().length > 5
  );
}

function getPayPalBaseUrl(): string {
  return process.env.PAYPAL_MODE === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

export async function getPayPalAccessToken(): Promise<string> {
  const clientId = process.env.PAYPAL_CLIENT_ID || '';
  const secret = process.env.PAYPAL_CLIENT_SECRET || '';
  const basic = Buffer.from(`${clientId}:${secret}`).toString('base64');
  const res = await fetch(`${getPayPalBaseUrl()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) {
    throw new Error('Failed to authenticate with PayPal REST API.');
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

export async function createLivePayPalOrder(input: {
  orderId: string;
  amountUsd: number;
  description: string;
  returnUrl: string;
  cancelUrl: string;
}): Promise<{ paypalOrderId: string; approvalUrl: string }> {
  const accessToken = await getPayPalAccessToken();
  const res = await fetch(`${getPayPalBaseUrl()}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': input.orderId,
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: input.orderId,
          custom_id: input.orderId,
          description: input.description.slice(0, 127),
          amount: {
            currency_code: 'USD',
            value: input.amountUsd.toFixed(2),
          },
        },
      ],
      application_context: {
        brand_name: 'DELOKEN Streaming',
        user_action: 'PAY_NOW',
        return_url: input.returnUrl,
        cancel_url: input.cancelUrl,
      },
    }),
  });
  if (!res.ok) {
    throw new Error('Unable to create PayPal checkout order.');
  }
  const data = (await res.json()) as {
    id: string;
    links?: { rel: string; href: string }[];
  };
  const approve = data.links?.find((l) => l.rel === 'approve')?.href ?? '';
  return { paypalOrderId: data.id, approvalUrl: approve };
}

export async function captureLivePayPalOrder(paypalOrderId: string): Promise<{
  completed: boolean;
  capturedUsd: number;
}> {
  const accessToken = await getPayPalAccessToken();
  const res = await fetch(
    `${getPayPalBaseUrl()}/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );
  if (!res.ok) {
    throw new Error('PayPal capture verification failed.');
  }
  const data = (await res.json()) as {
    status?: string;
    purchase_units?: {
      payments?: {
        captures?: { status?: string; amount?: { value?: string; currency_code?: string } }[];
      };
    }[];
  };
  const capture = data.purchase_units?.[0]?.payments?.captures?.[0];
  const completed =
    data.status === 'COMPLETED' &&
    capture?.status === 'COMPLETED' &&
    capture?.amount?.currency_code === 'USD';
  return {
    completed,
    capturedUsd: Number(capture?.amount?.value ?? 0),
  };
}

// Midtrans Core API QRIS helpers
export function isMidtransConfigured(): boolean {
  return Boolean(
    process.env.MIDTRANS_SERVER_KEY && process.env.MIDTRANS_SERVER_KEY.trim().length > 5
  );
}

function getMidtransBaseUrl(): string {
  return process.env.MIDTRANS_IS_PRODUCTION === 'true'
    ? 'https://api.midtrans.com'
    : 'https://api.sandbox.midtrans.com';
}

export async function createLiveMidtransQris(input: {
  orderId: string;
  amountIdr: number;
}): Promise<{ qrString: string; transactionId: string }> {
  const serverKey = process.env.MIDTRANS_SERVER_KEY || '';
  const auth = Buffer.from(`${serverKey}:`).toString('base64');
  const res = await fetch(`${getMidtransBaseUrl()}/v2/charge`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      payment_type: 'qris',
      transaction_details: {
        order_id: input.orderId,
        gross_amount: Math.round(input.amountIdr),
      },
    }),
  });
  if (!res.ok) {
    throw new Error('Unable to create Midtrans QRIS charge.');
  }
  const data = (await res.json()) as {
    transaction_id?: string;
    qr_string?: string;
    status_code?: string;
  };
  if (!data.qr_string) {
    throw new Error('Midtrans QRIS response missing qr_string.');
  }
  return {
    qrString: data.qr_string,
    transactionId: data.transaction_id || input.orderId,
  };
}

export function verifyMidtransWebhookSignature(input: {
  orderId: string;
  statusCode: string;
  grossAmount: string;
  signatureKey: string;
}): boolean {
  const serverKey = process.env.MIDTRANS_SERVER_KEY || '';
  if (!serverKey) return false;
  const expected = crypto
    .createHash('sha512')
    .update(`${input.orderId}${input.statusCode}${input.grossAmount}${serverKey}`)
    .digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(input.signatureKey || '', 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Fulfill a verified completed payment atomically (idempotent against duplicate settlement)
export function fulfillVerifiedPayment(
  state: LedgerState,
  payment: PaymentOrderRecord,
  context: {
    videoEntry?: ServerCatalogEntry | null;
    resumeSeconds?: number;
  }
): {
  purchase: PurchaseRecord | null;
  entitlement: ServerEntitlement | null;
  wallet: ServerWallet;
} {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const wallet = getOrInitWallet(state, payment.userId);

  // Guard against duplicate fulfillment if already completed
  if (payment.status === 'completed') {
    const existingEnt =
      payment.purpose === 'video_unlock'
        ? state.entitlements[entitlementKey(payment.userId, payment.targetId)] ?? null
        : null;
    const existingPurchase =
      state.purchases.find((p) => p.id === `pur_${payment.id}`) ?? null;
    return { purchase: existingPurchase, entitlement: existingEnt, wallet };
  }

  payment.status = 'completed';
  payment.updatedAt = nowIso;
  state.payments[payment.id] = payment;

  if (payment.purpose === 'credit_topup') {
    const creditsToAdd = Math.max(0, Math.round(payment.creditsDelta));
    wallet.balanceCredits += creditsToAdd;
    wallet.updatedAtMs = now;

    state.walletTransactions.unshift({
      id: `wtx_${payment.id}`,
      userId: payment.userId,
      type: 'topup',
      creditsDelta: creditsToAdd,
      description: `Top-up ${payment.targetTitle} via ${payment.method.toUpperCase()}`,
      createdAt: nowIso,
    });

    const purchase: PurchaseRecord = {
      id: `pur_${payment.id}`,
      userId: payment.userId,
      videoId: payment.targetId,
      videoTitle: `${payment.targetTitle} (${creditsToAdd} Credits)`,
      method: payment.method,
      amount: payment.amount,
      currency: payment.currency,
      status: 'completed',
      createdAt: nowIso,
    };
    state.purchases.unshift(purchase);
    return { purchase, entitlement: null, wallet };
  }

  // Video Unlock fulfillment (30-day access + Creator Earnings split)
  const video = context.videoEntry ?? SERVER_CATALOG[payment.targetId] ?? null;
  const entKey = entitlementKey(payment.userId, payment.targetId);
  const existingEnt = state.entitlements[entKey];
  const safeResume =
    typeof context.resumeSeconds === 'number'
      ? Math.max(0, Math.min(36000, Math.floor(context.resumeSeconds)))
      : existingEnt?.resumeSeconds ?? 0;

  const ent: ServerEntitlement = {
    id: `ent_${payment.userId.slice(0, 8)}_${payment.targetId}`,
    userId: payment.userId,
    videoId: payment.targetId,
    videoTitle: video?.title || payment.targetTitle,
    thumbnailUrl: video?.thumbnailUrl || '',
    grantedAtMs: now,
    expiresAtMs: now + ACCESS_WINDOW_MS,
    resumeSeconds: safeResume,
    status: 'active',
    source: 'payment_verified',
  };
  state.entitlements[entKey] = ent;

  const purchase: PurchaseRecord = {
    id: `pur_${payment.id}`,
    userId: payment.userId,
    videoId: payment.targetId,
    videoTitle: ent.videoTitle,
    method: payment.method,
    amount: payment.amount,
    currency: payment.currency,
    status: 'completed',
    createdAt: nowIso,
  };
  state.purchases.unshift(purchase);

  if (video) {
    const commissionPct = state.platformSettings.commissionPercent;
    const grossUsd = payment.currency === 'USD' ? payment.amount : video.priceUsd;
    const grossIdr = payment.currency === 'IDR' ? payment.amount : video.priceIdr;
    const netUsd = Number((grossUsd * (1 - commissionPct / 100)).toFixed(2));
    const netIdr = Math.round(grossIdr * (1 - commissionPct / 100));

    state.creatorEarnings.unshift({
      id: `earn_${payment.id}`,
      creatorId: video.creatorId,
      videoId: video.id,
      videoTitle: video.title,
      purchaseId: purchase.id,
      buyerUserId: payment.userId,
      method: payment.method,
      grossUsd,
      grossIdr,
      commissionPercent: commissionPct,
      netUsd,
      netIdr,
      status: 'available',
      createdAt: nowIso,
    });
  }

  return { purchase, entitlement: ent, wallet };
}

export function buildCreatorEarningsSummary(
  state: LedgerState,
  creatorId: string
): {
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
} {
  const earnings = state.creatorEarnings.filter(
    (e) => e.creatorId === creatorId && e.status === 'available'
  );
  const allCreatorEarnings = state.creatorEarnings.filter((e) => e.creatorId === creatorId);
  const payouts = state.payouts.filter((p) => p.creatorId === creatorId);

  const grossUsd = Number(earnings.reduce((s, e) => s + e.grossUsd, 0).toFixed(2));
  const grossIdr = Math.round(earnings.reduce((s, e) => s + e.grossIdr, 0));
  const netUsd = Number(earnings.reduce((s, e) => s + e.netUsd, 0).toFixed(2));
  const netIdr = Math.round(earnings.reduce((s, e) => s + e.netIdr, 0));

  const committedPayouts = payouts.filter((p) => p.status !== 'rejected');
  const withdrawnUsd = Number(
    committedPayouts.reduce((s, p) => s + p.amountUsd, 0).toFixed(2)
  );
  const withdrawnIdr = Math.round(
    committedPayouts.reduce((s, p) => s + p.amountIdr, 0)
  );

  return {
    commissionPercent: state.platformSettings.commissionPercent,
    grossUsd,
    grossIdr,
    netUsd,
    netIdr,
    withdrawnUsd,
    withdrawnIdr,
    availableUsd: Math.max(0, Number((netUsd - withdrawnUsd).toFixed(2))),
    availableIdr: Math.max(0, netIdr - withdrawnIdr),
    earnings: allCreatorEarnings,
    payouts,
  };
}

export function buildAdminFinanceOverview(state: LedgerState): AdminFinanceOverview {
  const now = Date.now();
  const completedPayments = Object.values(state.payments).filter(
    (p) => p.status === 'completed'
  );
  const totalGrossUsd = Number(
    completedPayments
      .filter((p) => p.currency === 'USD')
      .reduce((s, p) => s + p.amount, 0)
      .toFixed(2)
  );
  const totalGrossIdr = Math.round(
    completedPayments
      .filter((p) => p.currency === 'IDR')
      .reduce((s, p) => s + p.amount, 0)
  );

  const validEarnings = state.creatorEarnings.filter((e) => e.status === 'available');
  const platformCommissionUsd = Number(
    validEarnings.reduce((s, e) => s + (e.grossUsd - e.netUsd), 0).toFixed(2)
  );
  const platformCommissionIdr = Math.round(
    validEarnings.reduce((s, e) => s + (e.grossIdr - e.netIdr), 0)
  );

  const activeEntitlementsCount = Object.values(state.entitlements).filter(
    (e) => e.status !== 'revoked' && now < e.expiresAtMs
  ).length;

  return {
    commissionPercent: state.platformSettings.commissionPercent,
    totalGrossUsd,
    totalGrossIdr,
    platformCommissionUsd,
    platformCommissionIdr,
    payments: Object.values(state.payments).sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
    ),
    purchases: state.purchases,
    payouts: state.payouts,
    activeEntitlementsCount,
  };
}
