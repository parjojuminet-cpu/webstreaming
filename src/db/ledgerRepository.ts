import fs from 'node:fs';
import path from 'node:path';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db, isSqlConfigured } from './index.ts';
import {
  creatorEarnings,
  creatorMedia,
  entitlements,
  idempotencyRecords,
  payments,
  payouts,
  platformSettings,
  processedWebhooks,
  purchases,
  videoDeletionJobs,
  walletTransactions,
  wallets,
} from './schema.ts';
import {
  ACCESS_WINDOW_MS,
  SERVER_CATALOG,
  entitlementKey,
  type CreatorMediaBinding,
  type ServerCatalogEntry,
  type ServerEntitlement,
  type ServerWallet,
} from '../../server/paymentService.ts';
import type {
  AdminFinanceOverview,
  CreatorEarningRecord,
  PaymentGateway,
  PaymentGatewayMode,
  PaymentOrderRecord,
  PaymentPurpose,
  PaymentStatus,
  PayoutRecord,
  PurchaseRecord,
  VideoDeletionJobRecord,
  VideoDeletionJobStatus,
  WalletTransactionRecord,
} from '../types/vyora';

const SERVER_DATA_DIR = path.resolve(process.cwd(), '.vyora_server_data');
const LEGACY_LEDGER_FILE = path.resolve(SERVER_DATA_DIR, 'ledger.json');

interface LegacyLedgerJson {
  wallets?: Record<string, ServerWallet>;
  walletTransactions?: WalletTransactionRecord[];
  payments?: Record<string, PaymentOrderRecord>;
  purchases?: PurchaseRecord[];
  entitlements?: Record<string, ServerEntitlement>;
  creatorEarnings?: CreatorEarningRecord[];
  payouts?: PayoutRecord[];
  idempotency?: Record<string, { status: number; body: unknown; createdAtMs: number }>;
  processedWebhooks?: Record<string, number>;
  creatorMedia?: Record<string, CreatorMediaBinding>;
  platformSettings?: {
    commissionPercent: number;
    minPriceUsd: number;
    minPriceIdr: number;
  };
}

let migrationPromise: Promise<void> | null = null;

const TABLE_DDL_STATEMENTS: Array<{ tableName: string; ddl: ReturnType<typeof sql> }> = [
  {
    tableName: 'users',
    ddl: sql`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        uid TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `,
  },
  {
    tableName: 'wallets',
    ddl: sql`
      CREATE TABLE IF NOT EXISTS wallets (
        user_id TEXT PRIMARY KEY,
        balance_credits INTEGER NOT NULL DEFAULT 0,
        total_spent_credits INTEGER NOT NULL DEFAULT 0,
        updated_at_ms BIGINT NOT NULL
      )
    `,
  },
  {
    tableName: 'wallet_transactions',
    ddl: sql`
      CREATE TABLE IF NOT EXISTS wallet_transactions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        credits_delta INTEGER NOT NULL,
        description TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `,
  },
  {
    tableName: 'payments',
    ddl: sql`
      CREATE TABLE IF NOT EXISTS payments (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        user_email TEXT,
        purpose TEXT NOT NULL,
        target_id TEXT NOT NULL,
        target_title TEXT NOT NULL,
        method TEXT NOT NULL,
        amount DOUBLE PRECISION NOT NULL,
        currency TEXT NOT NULL,
        credits_delta INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        gateway_order_id TEXT NOT NULL,
        gateway_mode TEXT NOT NULL,
        approval_url TEXT,
        qr_string TEXT,
        expires_at TEXT,
        refunded_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `,
  },
  {
    tableName: 'purchases',
    ddl: sql`
      CREATE TABLE IF NOT EXISTS purchases (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        video_id TEXT NOT NULL,
        video_title TEXT NOT NULL,
        method TEXT NOT NULL,
        amount DOUBLE PRECISION NOT NULL,
        currency TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `,
  },
  {
    tableName: 'entitlements',
    ddl: sql`
      CREATE TABLE IF NOT EXISTS entitlements (
        composite_key TEXT PRIMARY KEY,
        id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        video_id TEXT NOT NULL,
        video_title TEXT NOT NULL,
        thumbnail_url TEXT NOT NULL DEFAULT '',
        granted_at_ms BIGINT NOT NULL,
        expires_at_ms BIGINT NOT NULL,
        resume_seconds INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active',
        source TEXT NOT NULL
      )
    `,
  },
  {
    tableName: 'creator_earnings',
    ddl: sql`
      CREATE TABLE IF NOT EXISTS creator_earnings (
        id TEXT PRIMARY KEY,
        creator_id TEXT NOT NULL,
        video_id TEXT NOT NULL,
        video_title TEXT NOT NULL,
        purchase_id TEXT NOT NULL,
        buyer_user_id TEXT NOT NULL,
        method TEXT NOT NULL,
        gross_usd DOUBLE PRECISION NOT NULL,
        gross_idr INTEGER NOT NULL,
        commission_percent INTEGER NOT NULL,
        net_usd DOUBLE PRECISION NOT NULL,
        net_idr INTEGER NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `,
  },
  {
    tableName: 'payouts',
    ddl: sql`
      CREATE TABLE IF NOT EXISTS payouts (
        id TEXT PRIMARY KEY,
        creator_id TEXT NOT NULL,
        creator_name TEXT NOT NULL,
        amount_usd DOUBLE PRECISION NOT NULL,
        amount_idr INTEGER NOT NULL,
        currency TEXT NOT NULL,
        method TEXT NOT NULL,
        destination TEXT NOT NULL,
        status TEXT NOT NULL,
        admin_note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `,
  },
  {
    tableName: 'idempotency_records',
    ddl: sql`
      CREATE TABLE IF NOT EXISTS idempotency_records (
        full_key TEXT PRIMARY KEY,
        status INTEGER NOT NULL,
        body_json JSONB NOT NULL,
        created_at_ms BIGINT NOT NULL
      )
    `,
  },
  {
    tableName: 'processed_webhooks',
    ddl: sql`
      CREATE TABLE IF NOT EXISTS processed_webhooks (
        event_key TEXT PRIMARY KEY,
        processed_at_ms BIGINT NOT NULL
      )
    `,
  },
  {
    tableName: 'creator_media',
    ddl: sql`
      CREATE TABLE IF NOT EXISTS creator_media (
        video_id TEXT PRIMARY KEY,
        creator_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        asset_ref TEXT NOT NULL,
        mime_type TEXT,
        updated_at_iso TEXT NOT NULL
      )
    `,
  },
  {
    tableName: 'platform_settings',
    ddl: sql`
      CREATE TABLE IF NOT EXISTS platform_settings (
        id TEXT PRIMARY KEY,
        commission_percent INTEGER NOT NULL DEFAULT 20,
        min_price_usd DOUBLE PRECISION NOT NULL DEFAULT 1.99,
        min_price_idr INTEGER NOT NULL DEFAULT 29000
      )
    `,
  },
  {
    tableName: 'video_deletion_jobs',
    ddl: sql`
      CREATE TABLE IF NOT EXISTS video_deletion_jobs (
        operation_id TEXT PRIMARY KEY,
        video_id TEXT NOT NULL,
        video_title_snapshot TEXT NOT NULL,
        provider TEXT NOT NULL,
        asset_ref_fingerprint TEXT NOT NULL,
        requested_by TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        status TEXT NOT NULL,
        provider_result TEXT NOT NULL DEFAULT 'pending',
        firestore_result TEXT NOT NULL DEFAULT 'pending',
        sql_result TEXT NOT NULL DEFAULT 'pending',
        thumbnail_result TEXT NOT NULL DEFAULT 'skipped',
        external_media_warning TEXT,
        error_code TEXT,
        error_message TEXT,
        completed_at TEXT
      )
    `,
  },
];

async function ensureSqlTablesExist(): Promise<void> {
  const existingResult = await db.execute(sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
  `);
  const existingTables = new Set<string>(
    ((existingResult as { rows?: Array<{ table_name?: unknown }> }).rows ?? [])
      .map((row) => String(row.table_name ?? '').trim())
      .filter(Boolean)
  );

  const missingTables = TABLE_DDL_STATEMENTS.filter(
    ({ tableName }) => !existingTables.has(tableName)
  );
  if (missingTables.length === 0) {
    return;
  }

  for (const { tableName, ddl } of missingTables) {
    try {
      await db.execute(ddl);
    } catch (err) {
      const code = (err as { code?: string; cause?: { code?: string } })?.code
        ?? (err as { cause?: { code?: string } })?.cause?.code;
      if (code === '42501') {
        throw new Error(
          `Database table "${tableName}" is missing and the runtime SQL role lacks schema CREATE privileges. Push the Drizzle schema using admin credentials.`,
          { cause: err }
        );
      }
      throw err;
    }
  }
}

async function ensureLegacyLedgerMigrated(): Promise<void> {
  if (!isSqlConfigured()) {
    throw new Error('Database PostgreSQL belum dihubungkan (set DATABASE_URL atau SQL_HOST).');
  }
  if (!migrationPromise) {
    migrationPromise = (async () => {
      try {
        await ensureSqlTablesExist();
        // Ensure default global platform_settings row always exists
        await db
          .insert(platformSettings)
          .values({
            id: 'global',
            commissionPercent: 20,
            minPriceUsd: 1.99,
            minPriceIdr: 29000,
          })
          .onConflictDoNothing();

        if (!fs.existsSync(LEGACY_LEDGER_FILE)) return;

        const raw = fs.readFileSync(LEGACY_LEDGER_FILE, 'utf-8');
        const parsed = JSON.parse(raw) as LegacyLedgerJson;

        await db.transaction(async (tx) => {
          if (parsed.platformSettings) {
            await tx
              .insert(platformSettings)
              .values({
                id: 'global',
                commissionPercent: parsed.platformSettings.commissionPercent ?? 20,
                minPriceUsd: parsed.platformSettings.minPriceUsd ?? 1.99,
                minPriceIdr: parsed.platformSettings.minPriceIdr ?? 29000,
              })
              .onConflictDoNothing();
          }

          for (const w of Object.values(parsed.wallets ?? {})) {
            await tx
              .insert(wallets)
              .values({
                userId: w.userId,
                balanceCredits: w.balanceCredits ?? 0,
                totalSpentCredits: w.totalSpentCredits ?? 0,
                updatedAtMs: w.updatedAtMs ?? Date.now(),
              })
              .onConflictDoNothing();
          }

          for (const wtx of parsed.walletTransactions ?? []) {
            await tx
              .insert(walletTransactions)
              .values({
                id: wtx.id,
                userId: wtx.userId,
                type: wtx.type,
                creditsDelta: wtx.creditsDelta,
                description: wtx.description,
                createdAt: wtx.createdAt,
              })
              .onConflictDoNothing();
          }

          for (const pay of Object.values(parsed.payments ?? {})) {
            await tx
              .insert(payments)
              .values({
                id: pay.id,
                userId: pay.userId,
                userEmail: pay.userEmail ?? null,
                purpose: pay.purpose,
                targetId: pay.targetId,
                targetTitle: pay.targetTitle,
                method: pay.method,
                amount: pay.amount,
                currency: pay.currency,
                creditsDelta: pay.creditsDelta ?? 0,
                status: pay.status,
                gatewayOrderId: pay.gatewayOrderId,
                gatewayMode: pay.gatewayMode,
                approvalUrl: pay.approvalUrl ?? null,
                qrString: pay.qrString ?? null,
                expiresAt: pay.expiresAt ?? null,
                refundedAt: pay.refundedAt ?? null,
                createdAt: pay.createdAt,
                updatedAt: pay.updatedAt,
              })
              .onConflictDoNothing();
          }

          for (const pur of parsed.purchases ?? []) {
            await tx
              .insert(purchases)
              .values({
                id: pur.id,
                userId: pur.userId,
                videoId: pur.videoId,
                videoTitle: pur.videoTitle,
                method: pur.method,
                amount: pur.amount,
                currency: pur.currency,
                status: pur.status,
                createdAt: pur.createdAt,
              })
              .onConflictDoNothing();
          }

          for (const [key, ent] of Object.entries(parsed.entitlements ?? {})) {
            await tx
              .insert(entitlements)
              .values({
                compositeKey: key,
                id: ent.id,
                userId: ent.userId,
                videoId: ent.videoId,
                videoTitle: ent.videoTitle,
                thumbnailUrl: ent.thumbnailUrl ?? '',
                grantedAtMs: ent.grantedAtMs,
                expiresAtMs: ent.expiresAtMs,
                resumeSeconds: ent.resumeSeconds ?? 0,
                status: ent.status ?? 'active',
                source: ent.source,
              })
              .onConflictDoNothing();
          }

          for (const earn of parsed.creatorEarnings ?? []) {
            await tx
              .insert(creatorEarnings)
              .values({
                id: earn.id,
                creatorId: earn.creatorId,
                videoId: earn.videoId,
                videoTitle: earn.videoTitle,
                purchaseId: earn.purchaseId,
                buyerUserId: earn.buyerUserId,
                method: earn.method,
                grossUsd: earn.grossUsd,
                grossIdr: earn.grossIdr,
                commissionPercent: earn.commissionPercent,
                netUsd: earn.netUsd,
                netIdr: earn.netIdr,
                status: earn.status,
                createdAt: earn.createdAt,
              })
              .onConflictDoNothing();
          }

          for (const po of parsed.payouts ?? []) {
            await tx
              .insert(payouts)
              .values({
                id: po.id,
                creatorId: po.creatorId,
                creatorName: po.creatorName,
                amountUsd: po.amountUsd,
                amountIdr: po.amountIdr,
                currency: po.currency,
                method: po.method,
                destination: po.destination,
                status: po.status,
                adminNote: po.adminNote ?? '',
                createdAt: po.createdAt,
                updatedAt: po.updatedAt,
              })
              .onConflictDoNothing();
          }

          for (const [eventKey, processedAtMs] of Object.entries(
            parsed.processedWebhooks ?? {}
          )) {
            await tx
              .insert(processedWebhooks)
              .values({ eventKey, processedAtMs })
              .onConflictDoNothing();
          }

          for (const media of Object.values(parsed.creatorMedia ?? {})) {
            await tx
              .insert(creatorMedia)
              .values({
                videoId: media.videoId,
                creatorId: media.creatorId,
                provider: media.provider,
                assetRef: media.assetRef,
                mimeType: media.mimeType ?? null,
                updatedAtIso: media.updatedAtIso,
              })
              .onConflictDoNothing();
          }
        });
      } catch (err) {
        console.error('Legacy ledger migration warning:', err);
        migrationPromise = null;
        throw err;
      }
    })();
  }
  await migrationPromise;
}

function mapPaymentRow(row: typeof payments.$inferSelect): PaymentOrderRecord {
  return {
    id: row.id,
    userId: row.userId,
    userEmail: row.userEmail ?? null,
    purpose: row.purpose as PaymentPurpose,
    targetId: row.targetId,
    targetTitle: row.targetTitle,
    method: row.method as PaymentGateway,
    amount: row.amount,
    currency: row.currency as 'USD' | 'IDR' | 'CREDITS',
    creditsDelta: row.creditsDelta,
    status: row.status as PaymentStatus,
    gatewayOrderId: row.gatewayOrderId,
    gatewayMode: row.gatewayMode as PaymentGatewayMode,
    approvalUrl: row.approvalUrl ?? undefined,
    qrString: row.qrString ?? undefined,
    expiresAt: row.expiresAt ?? undefined,
    refundedAt: row.refundedAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapEntitlementRow(row: typeof entitlements.$inferSelect): ServerEntitlement {
  return {
    id: row.id,
    userId: row.userId,
    videoId: row.videoId,
    videoTitle: row.videoTitle,
    thumbnailUrl: row.thumbnailUrl,
    grantedAtMs: row.grantedAtMs,
    expiresAtMs: row.expiresAtMs,
    resumeSeconds: row.resumeSeconds,
    status: row.status as 'active' | 'revoked',
    source: row.source as 'phase3_trial_pass' | 'payment_verified',
  };
}

function mapPurchaseRow(row: typeof purchases.$inferSelect): PurchaseRecord {
  return {
    id: row.id,
    userId: row.userId,
    videoId: row.videoId,
    videoTitle: row.videoTitle,
    method: row.method as PaymentGateway,
    amount: row.amount,
    currency: row.currency as 'USD' | 'IDR' | 'CREDITS',
    status: row.status as 'completed' | 'refunded',
    createdAt: row.createdAt,
  };
}

function mapPayoutRow(row: typeof payouts.$inferSelect): PayoutRecord {
  return {
    id: row.id,
    creatorId: row.creatorId,
    creatorName: row.creatorName,
    amountUsd: row.amountUsd,
    amountIdr: row.amountIdr,
    currency: row.currency as 'USD' | 'IDR',
    method: row.method as 'bank_transfer_idr' | 'ewallet_idr' | 'paypal_usd',
    destination: row.destination,
    status: row.status as PayoutRecord['status'],
    adminNote: row.adminNote,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapEarningRow(row: typeof creatorEarnings.$inferSelect): CreatorEarningRecord {
  return {
    id: row.id,
    creatorId: row.creatorId,
    videoId: row.videoId,
    videoTitle: row.videoTitle,
    purchaseId: row.purchaseId,
    buyerUserId: row.buyerUserId,
    method: row.method as PaymentGateway,
    grossUsd: row.grossUsd,
    grossIdr: row.grossIdr,
    commissionPercent: row.commissionPercent,
    netUsd: row.netUsd,
    netIdr: row.netIdr,
    status: row.status as 'available' | 'reversed',
    createdAt: row.createdAt,
  };
}

function makeIdemKey(scope: string, userId: string, key: string): string {
  return `${scope}:${userId}:${key}`;
}

export async function upsertCreatorMediaSql(binding: CreatorMediaBinding): Promise<void> {
  try {
    await ensureLegacyLedgerMigrated();
    await db
      .insert(creatorMedia)
      .values({
        videoId: binding.videoId,
        creatorId: binding.creatorId,
        provider: binding.provider,
        assetRef: binding.assetRef,
        mimeType: binding.mimeType ?? null,
        updatedAtIso: binding.updatedAtIso,
      })
      .onConflictDoUpdate({
        target: creatorMedia.videoId,
        set: {
          creatorId: binding.creatorId,
          provider: binding.provider,
          assetRef: binding.assetRef,
          mimeType: binding.mimeType ?? null,
          updatedAtIso: binding.updatedAtIso,
        },
      });
  } catch (error) {
    console.error('upsertCreatorMediaSql failed:', error);
    throw new Error('Failed to persist creator media reference.', { cause: error });
  }
}

export async function saveThumbnailAssetSql(input: {
  key: string;
  creatorId: string;
  mimeType: string;
  base64Data: string;
  updatedAtIso: string;
}): Promise<void> {
  try {
    await ensureLegacyLedgerMigrated();
    await db
      .insert(creatorMedia)
      .values({
        videoId: input.key,
        creatorId: input.creatorId,
        provider: 'thumbnail',
        assetRef: input.base64Data,
        mimeType: input.mimeType,
        updatedAtIso: input.updatedAtIso,
      })
      .onConflictDoUpdate({
        target: creatorMedia.videoId,
        set: {
          creatorId: input.creatorId,
          provider: 'thumbnail',
          assetRef: input.base64Data,
          mimeType: input.mimeType,
          updatedAtIso: input.updatedAtIso,
        },
      });
  } catch (error) {
    console.error('saveThumbnailAssetSql failed:', error);
  }
}

export async function getThumbnailAssetSql(
  key: string
): Promise<{ mimeType: string; base64Data: string } | null> {
  try {
    await ensureLegacyLedgerMigrated();
    const rows = await db
      .select()
      .from(creatorMedia)
      .where(and(eq(creatorMedia.videoId, key), eq(creatorMedia.provider, 'thumbnail')));
    const row = rows[0];
    if (!row || !row.assetRef) return null;
    return {
      mimeType: row.mimeType || 'image/jpeg',
      base64Data: row.assetRef,
    };
  } catch (error) {
    console.error('getThumbnailAssetSql failed:', error);
    return null;
  }
}

export async function getStreamAuthContextSql(
  uid: string | undefined,
  videoId: string
): Promise<{
  entitlement: ServerEntitlement | null;
  mediaBinding: CreatorMediaBinding | null;
}> {
  try {
    await ensureLegacyLedgerMigrated();
    const [mediaRows, entRows] = await Promise.all([
      db.select().from(creatorMedia).where(eq(creatorMedia.videoId, videoId)),
      uid
        ? db
            .select()
            .from(entitlements)
            .where(eq(entitlements.compositeKey, entitlementKey(uid, videoId)))
        : Promise.resolve([]),
    ]);

    const m = mediaRows[0];
    const e = entRows[0];
    return {
      mediaBinding: m
        ? {
            videoId: m.videoId,
            creatorId: m.creatorId,
            provider: m.provider as
              | 'cloudflare_stream'
              | 'private_storage'
              | 'youtube'
              | 'facebook',
            assetRef: m.assetRef,
            mimeType: m.mimeType ?? undefined,
            updatedAtIso: m.updatedAtIso,
          }
        : null,
      entitlement: e ? mapEntitlementRow(e) : null,
    };
  } catch (error) {
    console.error('getStreamAuthContextSql failed:', error);
    throw new Error('Failed to load stream authorization state.', { cause: error });
  }
}

export async function getUserEntitlementsSql(uid: string): Promise<ServerEntitlement[]> {
  try {
    await ensureLegacyLedgerMigrated();
    const rows = await db
      .select()
      .from(entitlements)
      .where(eq(entitlements.userId, uid));
    return rows.map(mapEntitlementRow);
  } catch (error) {
    console.error('getUserEntitlementsSql failed:', error);
    throw new Error('Failed to load entitlements.', { cause: error });
  }
}

export async function updatePlaybackProgressSql(
  uid: string,
  videoId: string,
  positionSeconds: number
): Promise<{ ok: true; resumeSeconds: number } | { ok: false }> {
  try {
    await ensureLegacyLedgerMigrated();
    const key = entitlementKey(uid, videoId);
    const now = Date.now();
    const safeSec = Math.max(0, Math.min(36000, Math.floor(positionSeconds)));

    return await db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(entitlements)
        .where(eq(entitlements.compositeKey, key));
      const existing = rows[0];
      if (!existing || existing.status === 'revoked' || now >= existing.expiresAtMs) {
        return { ok: false as const };
      }
      await tx
        .update(entitlements)
        .set({ resumeSeconds: safeSec })
        .where(eq(entitlements.compositeKey, key));
      return { ok: true as const, resumeSeconds: safeSec };
    });
  } catch (error) {
    console.error('updatePlaybackProgressSql failed:', error);
    throw new Error('Failed to save playback progress.', { cause: error });
  }
}

export async function upsertTrialEntitlementSql(
  record: ServerEntitlement
): Promise<void> {
  try {
    await ensureLegacyLedgerMigrated();
    const key = entitlementKey(record.userId, record.videoId);
    await db
      .insert(entitlements)
      .values({
        compositeKey: key,
        id: record.id,
        userId: record.userId,
        videoId: record.videoId,
        videoTitle: record.videoTitle,
        thumbnailUrl: record.thumbnailUrl,
        grantedAtMs: record.grantedAtMs,
        expiresAtMs: record.expiresAtMs,
        resumeSeconds: record.resumeSeconds,
        status: record.status ?? 'active',
        source: record.source,
      })
      .onConflictDoUpdate({
        target: entitlements.compositeKey,
        set: {
          id: record.id,
          videoTitle: record.videoTitle,
          thumbnailUrl: record.thumbnailUrl,
          grantedAtMs: record.grantedAtMs,
          expiresAtMs: record.expiresAtMs,
          resumeSeconds: record.resumeSeconds,
          status: record.status ?? 'active',
          source: record.source,
        },
      });
  } catch (error) {
    console.error('upsertTrialEntitlementSql failed:', error);
    throw new Error('Failed to activate preview entitlement.', { cause: error });
  }
}

export async function getWalletSnapshotSql(uid: string): Promise<{
  wallet: { userId: string; balanceCredits: number; totalSpentCredits: number };
  transactions: WalletTransactionRecord[];
  purchases: PurchaseRecord[];
  payments: PaymentOrderRecord[];
}> {
  try {
    await ensureLegacyLedgerMigrated();
    await db
      .insert(wallets)
      .values({
        userId: uid,
        balanceCredits: 0,
        totalSpentCredits: 0,
        updatedAtMs: Date.now(),
      })
      .onConflictDoNothing();

    const [walletRows, txRows, purchaseRows, paymentRows] = await Promise.all([
      db.select().from(wallets).where(eq(wallets.userId, uid)),
      db
        .select()
        .from(walletTransactions)
        .where(eq(walletTransactions.userId, uid))
        .orderBy(desc(walletTransactions.createdAt)),
      db
        .select()
        .from(purchases)
        .where(eq(purchases.userId, uid))
        .orderBy(desc(purchases.createdAt)),
      db
        .select()
        .from(payments)
        .where(eq(payments.userId, uid))
        .orderBy(desc(payments.createdAt)),
    ]);

    const w = walletRows[0] ?? {
      userId: uid,
      balanceCredits: 0,
      totalSpentCredits: 0,
    };

    return {
      wallet: {
        userId: w.userId,
        balanceCredits: w.balanceCredits,
        totalSpentCredits: w.totalSpentCredits,
      },
      transactions: txRows.map((r) => ({
        id: r.id,
        userId: r.userId,
        type: r.type as 'topup' | 'spend' | 'refund',
        creditsDelta: r.creditsDelta,
        description: r.description,
        createdAt: r.createdAt,
      })),
      purchases: purchaseRows.map(mapPurchaseRow),
      payments: paymentRows.map(mapPaymentRow),
    };
  } catch (error) {
    console.error('getWalletSnapshotSql failed:', error);
    throw new Error('Failed to load wallet ledger.', { cause: error });
  }
}

export async function spendCreditsAtomicSql(input: {
  uid: string;
  userEmail: string | null;
  video: ServerCatalogEntry;
  resumeSeconds: number;
  paymentId: string;
  idemKey?: string;
}): Promise<{ status: number; body: unknown }> {
  try {
    await ensureLegacyLedgerMigrated();
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const fullIdemKey = input.idemKey
      ? makeIdemKey('wallet_spend', input.uid, input.idemKey)
      : null;

    return await db.transaction(async (tx) => {
      if (fullIdemKey) {
        const cached = await tx
          .select()
          .from(idempotencyRecords)
          .where(eq(idempotencyRecords.fullKey, fullIdemKey));
        if (cached[0]) {
          return { status: cached[0].status, body: cached[0].bodyJson };
        }
      }

      const entKey = entitlementKey(input.uid, input.video.id);
      const entRows = await tx
        .select()
        .from(entitlements)
        .where(eq(entitlements.compositeKey, entKey));
      const existingEnt = entRows[0];
      if (existingEnt && existingEnt.status !== 'revoked' && now < existingEnt.expiresAtMs) {
        const resp = {
          status: 409,
          body: { error: 'You already have an active 30-day entitlement for this title.' },
        };
        if (fullIdemKey) {
          await tx
            .insert(idempotencyRecords)
            .values({
              fullKey: fullIdemKey,
              status: resp.status,
              bodyJson: resp.body,
              createdAtMs: now,
            })
            .onConflictDoNothing();
        }
        return resp;
      }

      await tx
        .insert(wallets)
        .values({
          userId: input.uid,
          balanceCredits: 0,
          totalSpentCredits: 0,
          updatedAtMs: now,
        })
        .onConflictDoNothing();

      // Atomic conditional debit prevents race-condition double spend
      const debitedWallets = await tx
        .update(wallets)
        .set({
          balanceCredits: sql`${wallets.balanceCredits} - ${input.video.creditCost}`,
          totalSpentCredits: sql`${wallets.totalSpentCredits} + ${input.video.creditCost}`,
          updatedAtMs: now,
        })
        .where(
          and(
            eq(wallets.userId, input.uid),
            gte(wallets.balanceCredits, input.video.creditCost)
          )
        )
        .returning();

      if (!debitedWallets[0]) {
        const curWallet = await tx
          .select()
          .from(wallets)
          .where(eq(wallets.userId, input.uid));
        const bal = curWallet[0]?.balanceCredits ?? 0;
        return {
          status: 400,
          body: {
            error: `Insufficient credits. Requires ${input.video.creditCost} credits, available ${bal}.`,
            requiredCredits: input.video.creditCost,
            balanceCredits: bal,
          },
        };
      }

      const updatedWallet = debitedWallets[0];

      await tx.insert(walletTransactions).values({
        id: `wtx_${input.paymentId}`,
        userId: input.uid,
        type: 'spend',
        creditsDelta: -input.video.creditCost,
        description: `Unlocked "${input.video.title}" (30-Day Access)`,
        createdAt: nowIso,
      });

      const paymentRow: typeof payments.$inferInsert = {
        id: input.paymentId,
        userId: input.uid,
        userEmail: input.userEmail,
        purpose: 'video_unlock',
        targetId: input.video.id,
        targetTitle: input.video.title,
        method: 'credits',
        amount: input.video.creditCost,
        currency: 'CREDITS',
        creditsDelta: -input.video.creditCost,
        status: 'completed',
        gatewayOrderId: input.paymentId,
        gatewayMode: 'live',
        approvalUrl: null,
        qrString: null,
        expiresAt: null,
        refundedAt: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      await tx.insert(payments).values(paymentRow);

      const safeResume = Math.max(0, Math.min(36000, Math.floor(input.resumeSeconds)));
      const entRow: typeof entitlements.$inferInsert = {
        compositeKey: entKey,
        id: `ent_${input.uid.slice(0, 8)}_${input.video.id}`,
        userId: input.uid,
        videoId: input.video.id,
        videoTitle: input.video.title,
        thumbnailUrl: input.video.thumbnailUrl,
        grantedAtMs: now,
        expiresAtMs: now + ACCESS_WINDOW_MS,
        resumeSeconds: safeResume,
        status: 'active',
        source: 'payment_verified',
      };
      await tx
        .insert(entitlements)
        .values(entRow)
        .onConflictDoUpdate({
          target: entitlements.compositeKey,
          set: {
            id: entRow.id,
            videoTitle: entRow.videoTitle,
            thumbnailUrl: entRow.thumbnailUrl,
            grantedAtMs: entRow.grantedAtMs,
            expiresAtMs: entRow.expiresAtMs,
            resumeSeconds: entRow.resumeSeconds,
            status: 'active',
            source: 'payment_verified',
          },
        });

      const purchaseObj: PurchaseRecord = {
        id: `pur_${input.paymentId}`,
        userId: input.uid,
        videoId: input.video.id,
        videoTitle: input.video.title,
        method: 'credits',
        amount: input.video.creditCost,
        currency: 'CREDITS',
        status: 'completed',
        createdAt: nowIso,
      };
      await tx.insert(purchases).values(purchaseObj);

      const settingsRows = await tx
        .select()
        .from(platformSettings)
        .where(eq(platformSettings.id, 'global'));
      const commissionPct = settingsRows[0]?.commissionPercent ?? 20;
      const grossUsd = input.video.priceUsd;
      const grossIdr = input.video.priceIdr;
      const netUsd = Number((grossUsd * (1 - commissionPct / 100)).toFixed(2));
      const netIdr = Math.round(grossIdr * (1 - commissionPct / 100));

      await tx.insert(creatorEarnings).values({
        id: `earn_${input.paymentId}`,
        creatorId: input.video.creatorId,
        videoId: input.video.id,
        videoTitle: input.video.title,
        purchaseId: purchaseObj.id,
        buyerUserId: input.uid,
        method: 'credits',
        grossUsd,
        grossIdr,
        commissionPercent: commissionPct,
        netUsd,
        netIdr,
        status: 'available',
        createdAt: nowIso,
      });

      const body = {
        payment: {
          ...paymentRow,
          userEmail: paymentRow.userEmail ?? null,
        },
        purchase: purchaseObj,
        entitlement: {
          id: entRow.id,
          userId: entRow.userId,
          videoId: entRow.videoId,
          videoTitle: entRow.videoTitle,
          thumbnailUrl: entRow.thumbnailUrl,
          grantedAtMs: entRow.grantedAtMs,
          expiresAtMs: entRow.expiresAtMs,
          resumeSeconds: entRow.resumeSeconds,
          status: 'active' as const,
          source: 'payment_verified' as const,
          expiresAt: new Date(entRow.expiresAtMs).toISOString(),
          remainingDays: 30,
        },
        wallet: {
          userId: updatedWallet.userId,
          balanceCredits: updatedWallet.balanceCredits,
          totalSpentCredits: updatedWallet.totalSpentCredits,
        },
      };

      if (fullIdemKey) {
        await tx
          .insert(idempotencyRecords)
          .values({
            fullKey: fullIdemKey,
            status: 200,
            bodyJson: body,
            createdAtMs: now,
          })
          .onConflictDoNothing();
      }

      return { status: 200, body };
    });
  } catch (error) {
    console.error('spendCreditsAtomicSql failed:', error);
    throw new Error('Failed to complete credit wallet transaction.', { cause: error });
  }
}

export async function precheckCreateOrderSql(input: {
  scope: string;
  uid: string;
  idemKey?: string;
  purpose: PaymentPurpose;
  targetId: string;
}): Promise<{ status: number; body: unknown } | null> {
  try {
    await ensureLegacyLedgerMigrated();
    const now = Date.now();
    const fullIdemKey = input.idemKey
      ? makeIdemKey(input.scope, input.uid, input.idemKey)
      : null;

    return await db.transaction(async (tx) => {
      if (fullIdemKey) {
        const cached = await tx
          .select()
          .from(idempotencyRecords)
          .where(eq(idempotencyRecords.fullKey, fullIdemKey));
        if (cached[0]) {
          return { status: cached[0].status, body: cached[0].bodyJson };
        }
      }

      if (input.purpose === 'video_unlock') {
        const entRows = await tx
          .select()
          .from(entitlements)
          .where(eq(entitlements.compositeKey, entitlementKey(input.uid, input.targetId)));
        const ent = entRows[0];
        if (ent && ent.status !== 'revoked' && now < ent.expiresAtMs) {
          const resp = {
            status: 409,
            body: { error: 'This release is already unlocked for your account.' },
          };
          if (fullIdemKey) {
            await tx
              .insert(idempotencyRecords)
              .values({
                fullKey: fullIdemKey,
                status: resp.status,
                bodyJson: resp.body,
                createdAtMs: now,
              })
              .onConflictDoNothing();
          }
          return resp;
        }
      }
      return null;
    });
  } catch (error) {
    console.error('precheckCreateOrderSql failed:', error);
    throw new Error('Failed to validate checkout state.', { cause: error });
  }
}

export async function savePendingPaymentOrderSql(input: {
  scope: string;
  uid: string;
  idemKey?: string;
  order: PaymentOrderRecord;
  responseBody: unknown;
}): Promise<{ status: number; body: unknown }> {
  try {
    await ensureLegacyLedgerMigrated();
    const now = Date.now();
    const fullIdemKey = input.idemKey
      ? makeIdemKey(input.scope, input.uid, input.idemKey)
      : null;

    return await db.transaction(async (tx) => {
      if (fullIdemKey) {
        const cached = await tx
          .select()
          .from(idempotencyRecords)
          .where(eq(idempotencyRecords.fullKey, fullIdemKey));
        if (cached[0]) {
          return { status: cached[0].status, body: cached[0].bodyJson };
        }
      }

      await tx.insert(payments).values({
        id: input.order.id,
        userId: input.order.userId,
        userEmail: input.order.userEmail ?? null,
        purpose: input.order.purpose,
        targetId: input.order.targetId,
        targetTitle: input.order.targetTitle,
        method: input.order.method,
        amount: input.order.amount,
        currency: input.order.currency,
        creditsDelta: input.order.creditsDelta ?? 0,
        status: input.order.status,
        gatewayOrderId: input.order.gatewayOrderId,
        gatewayMode: input.order.gatewayMode,
        approvalUrl: input.order.approvalUrl ?? null,
        qrString: input.order.qrString ?? null,
        expiresAt: input.order.expiresAt ?? null,
        refundedAt: input.order.refundedAt ?? null,
        createdAt: input.order.createdAt,
        updatedAt: input.order.updatedAt,
      });

      if (fullIdemKey) {
        await tx
          .insert(idempotencyRecords)
          .values({
            fullKey: fullIdemKey,
            status: 200,
            bodyJson: input.responseBody,
            createdAtMs: now,
          })
          .onConflictDoNothing();
      }

      return { status: 200, body: input.responseBody };
    });
  } catch (error) {
    console.error('savePendingPaymentOrderSql failed:', error);
    throw new Error('Failed to store payment order.', { cause: error });
  }
}

export async function checkIdempotencySql(
  scope: string,
  uid: string,
  idemKey?: string
): Promise<{ status: number; body: unknown } | null> {
  if (!idemKey) return null;
  try {
    await ensureLegacyLedgerMigrated();
    const rows = await db
      .select()
      .from(idempotencyRecords)
      .where(eq(idempotencyRecords.fullKey, makeIdemKey(scope, uid, idemKey)));
    return rows[0] ? { status: rows[0].status, body: rows[0].bodyJson } : null;
  } catch (error) {
    console.error('checkIdempotencySql failed:', error);
    throw new Error('Failed to check idempotency key.', { cause: error });
  }
}

export async function getPaymentByIdSql(
  paymentId: string
): Promise<PaymentOrderRecord | null> {
  try {
    await ensureLegacyLedgerMigrated();
    const rows = await db
      .select()
      .from(payments)
      .where(eq(payments.id, paymentId));
    return rows[0] ? mapPaymentRow(rows[0]) : null;
  } catch (error) {
    console.error('getPaymentByIdSql failed:', error);
    throw new Error('Failed to look up payment record.', { cause: error });
  }
}

export async function getPaymentStatusSnapshotSql(
  paymentId: string,
  uid: string
): Promise<{
  payment: PaymentOrderRecord;
  wallet: { userId: string; balanceCredits: number; totalSpentCredits: number };
  entitlement: (ServerEntitlement & { expiresAt: string; remainingDays: number }) | null;
} | null> {
  try {
    await ensureLegacyLedgerMigrated();
    const payRows = await db
      .select()
      .from(payments)
      .where(eq(payments.id, paymentId));
    const payRow = payRows[0];
    if (!payRow || payRow.userId !== uid) return null;

    await db
      .insert(wallets)
      .values({
        userId: uid,
        balanceCredits: 0,
        totalSpentCredits: 0,
        updatedAtMs: Date.now(),
      })
      .onConflictDoNothing();

    const [walletRows, entRows] = await Promise.all([
      db.select().from(wallets).where(eq(wallets.userId, uid)),
      payRow.purpose === 'video_unlock'
        ? db
            .select()
            .from(entitlements)
            .where(eq(entitlements.compositeKey, entitlementKey(uid, payRow.targetId)))
        : Promise.resolve([]),
    ]);

    const w = walletRows[0] ?? {
      userId: uid,
      balanceCredits: 0,
      totalSpentCredits: 0,
    };
    const ent = entRows[0] ? mapEntitlementRow(entRows[0]) : null;

    return {
      payment: mapPaymentRow(payRow),
      wallet: {
        userId: w.userId,
        balanceCredits: w.balanceCredits,
        totalSpentCredits: w.totalSpentCredits,
      },
      entitlement: ent
        ? {
            ...ent,
            expiresAt: new Date(ent.expiresAtMs).toISOString(),
            remainingDays: Math.max(
              0,
              Math.ceil((ent.expiresAtMs - Date.now()) / (24 * 60 * 60 * 1000))
            ),
          }
        : null,
    };
  } catch (error) {
    console.error('getPaymentStatusSnapshotSql failed:', error);
    throw new Error('Failed to load payment status.', { cause: error });
  }
}

export async function findPaymentForWebhookSql(
  targetPaymentId: string,
  gatewayOrderId: string
): Promise<PaymentOrderRecord | null> {
  try {
    await ensureLegacyLedgerMigrated();
    if (targetPaymentId) {
      const byId = await db
        .select()
        .from(payments)
        .where(eq(payments.id, targetPaymentId));
      if (byId[0]) return mapPaymentRow(byId[0]);
    }
    if (gatewayOrderId) {
      const byGw = await db
        .select()
        .from(payments)
        .where(eq(payments.gatewayOrderId, gatewayOrderId));
      if (byGw[0]) return mapPaymentRow(byGw[0]);
    }
    return null;
  } catch (error) {
    console.error('findPaymentForWebhookSql failed:', error);
    throw new Error('Failed to query payment for webhook.', { cause: error });
  }
}

export async function isWebhookProcessedSql(eventKey: string): Promise<boolean> {
  try {
    await ensureLegacyLedgerMigrated();
    const rows = await db
      .select()
      .from(processedWebhooks)
      .where(eq(processedWebhooks.eventKey, eventKey));
    return Boolean(rows[0]);
  } catch (error) {
    console.error('isWebhookProcessedSql failed:', error);
    throw new Error('Failed to check webhook status.', { cause: error });
  }
}

export async function fulfillPaymentAtomicSql(input: {
  paymentId: string;
  videoEntry?: ServerCatalogEntry | null;
  resumeSeconds?: number;
  idemScope?: string;
  idemUid?: string;
  idemKey?: string;
  webhookEventKey?: string;
}): Promise<{
  notFound?: boolean;
  duplicateWebhook?: boolean;
  invalidStatus?: PaymentStatus;
  payment?: PaymentOrderRecord;
  purchase?: PurchaseRecord | null;
  entitlement?: (ServerEntitlement & { expiresAt: string; remainingDays: number }) | null;
  wallet?: { userId: string; balanceCredits: number; totalSpentCredits: number };
}> {
  try {
    await ensureLegacyLedgerMigrated();
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const fullIdemKey =
      input.idemKey && input.idemScope && input.idemUid
        ? makeIdemKey(input.idemScope, input.idemUid, input.idemKey)
        : null;

    return await db.transaction(async (tx) => {
      if (input.webhookEventKey) {
        const existingHook = await tx
          .select()
          .from(processedWebhooks)
          .where(eq(processedWebhooks.eventKey, input.webhookEventKey));
        if (existingHook[0]) {
          return { duplicateWebhook: true };
        }
      }

      const existingRows = await tx
        .select()
        .from(payments)
        .where(eq(payments.id, input.paymentId));
      const existingPay = existingRows[0];
      if (!existingPay) {
        if (input.webhookEventKey) {
          await tx
            .insert(processedWebhooks)
            .values({ eventKey: input.webhookEventKey, processedAtMs: now })
            .onConflictDoNothing();
        }
        return { notFound: true };
      }

      if (existingPay.status !== 'pending' && existingPay.status !== 'completed') {
        return { invalidStatus: existingPay.status as PaymentStatus };
      }

      // Ensure buyer wallet exists
      await tx
        .insert(wallets)
        .values({
          userId: existingPay.userId,
          balanceCredits: 0,
          totalSpentCredits: 0,
          updatedAtMs: now,
        })
        .onConflictDoNothing();

      // Atomically claim pending->completed transition so concurrent requests cannot double-fulfill
      const transitioned =
        existingPay.status === 'pending'
          ? await tx
              .update(payments)
              .set({ status: 'completed', updatedAt: nowIso })
              .where(and(eq(payments.id, input.paymentId), eq(payments.status, 'pending')))
              .returning()
          : [];

      if (!transitioned[0]) {
        const latestRows = await tx
          .select()
          .from(payments)
          .where(eq(payments.id, input.paymentId));
        const latestPay = latestRows[0] ?? existingPay;
        if (latestPay.status !== 'completed') {
          return { invalidStatus: latestPay.status as PaymentStatus };
        }
        // Already completed earlier — return idempotent snapshot
        const [walletRows, purRows, entRows] = await Promise.all([
          tx.select().from(wallets).where(eq(wallets.userId, latestPay.userId)),
          tx
            .select()
            .from(purchases)
            .where(eq(purchases.id, `pur_${latestPay.id}`)),
          latestPay.purpose === 'video_unlock'
            ? tx
                .select()
                .from(entitlements)
                .where(
                  eq(
                    entitlements.compositeKey,
                    entitlementKey(latestPay.userId, latestPay.targetId)
                  )
                )
            : Promise.resolve([]),
        ]);
        const w = walletRows[0];
        const ent = entRows[0] ? mapEntitlementRow(entRows[0]) : null;
        if (input.webhookEventKey) {
          await tx
            .insert(processedWebhooks)
            .values({ eventKey: input.webhookEventKey, processedAtMs: now })
            .onConflictDoNothing();
        }
        return {
          payment: mapPaymentRow(latestPay),
          purchase: purRows[0] ? mapPurchaseRow(purRows[0]) : null,
          entitlement: ent
            ? {
                ...ent,
                expiresAt: new Date(ent.expiresAtMs).toISOString(),
                remainingDays: 30,
              }
            : null,
          wallet: {
            userId: latestPay.userId,
            balanceCredits: w?.balanceCredits ?? 0,
            totalSpentCredits: w?.totalSpentCredits ?? 0,
          },
        };
      }

      const settledPay = mapPaymentRow(transitioned[0]);

      if (settledPay.purpose === 'credit_topup') {
        const creditsToAdd = Math.max(0, Math.round(settledPay.creditsDelta));
        const updatedWallets = await tx
          .update(wallets)
          .set({
            balanceCredits: sql`${wallets.balanceCredits} + ${creditsToAdd}`,
            updatedAtMs: now,
          })
          .where(eq(wallets.userId, settledPay.userId))
          .returning();

        const w = updatedWallets[0];

        await tx
          .insert(walletTransactions)
          .values({
            id: `wtx_${settledPay.id}`,
            userId: settledPay.userId,
            type: 'topup',
            creditsDelta: creditsToAdd,
            description: `Top-up ${settledPay.targetTitle} via ${settledPay.method.toUpperCase()}`,
            createdAt: nowIso,
          })
          .onConflictDoNothing();

        const purObj: PurchaseRecord = {
          id: `pur_${settledPay.id}`,
          userId: settledPay.userId,
          videoId: settledPay.targetId,
          videoTitle: `${settledPay.targetTitle} (${creditsToAdd} Credits)`,
          method: settledPay.method,
          amount: settledPay.amount,
          currency: settledPay.currency,
          status: 'completed',
          createdAt: nowIso,
        };
        await tx.insert(purchases).values(purObj).onConflictDoNothing();

        const body = {
          payment: settledPay,
          purchase: purObj,
          entitlement: null,
          wallet: {
            userId: w.userId,
            balanceCredits: w.balanceCredits,
            totalSpentCredits: w.totalSpentCredits,
          },
        };

        if (fullIdemKey) {
          await tx
            .insert(idempotencyRecords)
            .values({
              fullKey: fullIdemKey,
              status: 200,
              bodyJson: body,
              createdAtMs: now,
            })
            .onConflictDoNothing();
        }
        if (input.webhookEventKey) {
          await tx
            .insert(processedWebhooks)
            .values({ eventKey: input.webhookEventKey, processedAtMs: now })
            .onConflictDoNothing();
        }
        return body;
      }

      // Video Unlock fulfillment
      const video = input.videoEntry ?? SERVER_CATALOG[settledPay.targetId] ?? null;
      const entKey = entitlementKey(settledPay.userId, settledPay.targetId);
      const prevEntRows = await tx
        .select()
        .from(entitlements)
        .where(eq(entitlements.compositeKey, entKey));

      const safeResume =
        typeof input.resumeSeconds === 'number'
          ? Math.max(0, Math.min(36000, Math.floor(input.resumeSeconds)))
          : prevEntRows[0]?.resumeSeconds ?? 0;

      const entRecord: ServerEntitlement = {
        id: `ent_${settledPay.userId.slice(0, 8)}_${settledPay.targetId}`,
        userId: settledPay.userId,
        videoId: settledPay.targetId,
        videoTitle: video?.title || settledPay.targetTitle,
        thumbnailUrl: video?.thumbnailUrl || '',
        grantedAtMs: now,
        expiresAtMs: now + ACCESS_WINDOW_MS,
        resumeSeconds: safeResume,
        status: 'active',
        source: 'payment_verified',
      };

      await tx
        .insert(entitlements)
        .values({
          compositeKey: entKey,
          ...entRecord,
          status: 'active',
        })
        .onConflictDoUpdate({
          target: entitlements.compositeKey,
          set: {
            id: entRecord.id,
            videoTitle: entRecord.videoTitle,
            thumbnailUrl: entRecord.thumbnailUrl,
            grantedAtMs: entRecord.grantedAtMs,
            expiresAtMs: entRecord.expiresAtMs,
            resumeSeconds: entRecord.resumeSeconds,
            status: 'active',
            source: 'payment_verified',
          },
        });

      const purObj: PurchaseRecord = {
        id: `pur_${settledPay.id}`,
        userId: settledPay.userId,
        videoId: settledPay.targetId,
        videoTitle: entRecord.videoTitle,
        method: settledPay.method,
        amount: settledPay.amount,
        currency: settledPay.currency,
        status: 'completed',
        createdAt: nowIso,
      };
      await tx.insert(purchases).values(purObj).onConflictDoNothing();

      if (video) {
        const settingsRows = await tx
          .select()
          .from(platformSettings)
          .where(eq(platformSettings.id, 'global'));
        const commissionPct = settingsRows[0]?.commissionPercent ?? 20;
        const grossUsd = settledPay.currency === 'USD' ? settledPay.amount : video.priceUsd;
        const grossIdr = settledPay.currency === 'IDR' ? settledPay.amount : video.priceIdr;
        const netUsd = Number((grossUsd * (1 - commissionPct / 100)).toFixed(2));
        const netIdr = Math.round(grossIdr * (1 - commissionPct / 100));

        await tx
          .insert(creatorEarnings)
          .values({
            id: `earn_${settledPay.id}`,
            creatorId: video.creatorId,
            videoId: video.id,
            videoTitle: video.title,
            purchaseId: purObj.id,
            buyerUserId: settledPay.userId,
            method: settledPay.method,
            grossUsd,
            grossIdr,
            commissionPercent: commissionPct,
            netUsd,
            netIdr,
            status: 'available',
            createdAt: nowIso,
          })
          .onConflictDoNothing();
      }

      const wRows = await tx
        .select()
        .from(wallets)
        .where(eq(wallets.userId, settledPay.userId));
      const w = wRows[0];

      const body = {
        payment: settledPay,
        purchase: purObj,
        entitlement: {
          ...entRecord,
          expiresAt: new Date(entRecord.expiresAtMs).toISOString(),
          remainingDays: 30,
        },
        wallet: {
          userId: settledPay.userId,
          balanceCredits: w?.balanceCredits ?? 0,
          totalSpentCredits: w?.totalSpentCredits ?? 0,
        },
      };

      if (fullIdemKey) {
        await tx
          .insert(idempotencyRecords)
          .values({
            fullKey: fullIdemKey,
            status: 200,
            bodyJson: body,
            createdAtMs: now,
          })
          .onConflictDoNothing();
      }
      if (input.webhookEventKey) {
        await tx
          .insert(processedWebhooks)
          .values({ eventKey: input.webhookEventKey, processedAtMs: now })
          .onConflictDoNothing();
      }

      return body;
    });
  } catch (error) {
    console.error('fulfillPaymentAtomicSql failed:', error);
    throw new Error('Failed to fulfill verified payment.', { cause: error });
  }
}

export async function recordWebhookOnlyOrFailureSql(input: {
  webhookEventKey: string;
  paymentId?: string;
  nextStatus?: 'expired' | 'failed';
}): Promise<{ duplicate: boolean; notFound?: boolean; status?: string }> {
  try {
    await ensureLegacyLedgerMigrated();
    const now = Date.now();
    const nowIso = new Date(now).toISOString();

    return await db.transaction(async (tx) => {
      const hookRows = await tx
        .select()
        .from(processedWebhooks)
        .where(eq(processedWebhooks.eventKey, input.webhookEventKey));
      if (hookRows[0]) {
        return { duplicate: true };
      }

      let currentStatus: string | undefined;
      if (input.paymentId) {
        const payRows = await tx
          .select()
          .from(payments)
          .where(eq(payments.id, input.paymentId));
        if (!payRows[0]) {
          return { duplicate: false, notFound: true };
        }
        currentStatus = payRows[0].status;
        if (input.nextStatus && payRows[0].status === 'pending') {
          await tx
            .update(payments)
            .set({ status: input.nextStatus, updatedAt: nowIso })
            .where(and(eq(payments.id, input.paymentId), eq(payments.status, 'pending')));
          currentStatus = input.nextStatus;
        }
      }

      await tx
        .insert(processedWebhooks)
        .values({ eventKey: input.webhookEventKey, processedAtMs: now })
        .onConflictDoNothing();

      return { duplicate: false, status: currentStatus };
    });
  } catch (error) {
    console.error('recordWebhookOnlyOrFailureSql failed:', error);
    throw new Error('Failed to record webhook status.', { cause: error });
  }
}

function computeCreatorEarningsSummaryFromRows(
  commissionPercent: number,
  earningRows: CreatorEarningRecord[],
  payoutRows: PayoutRecord[]
) {
  const availableRows = earningRows.filter((e) => e.status === 'available');
  const grossUsd = Number(availableRows.reduce((s, e) => s + e.grossUsd, 0).toFixed(2));
  const grossIdr = Math.round(availableRows.reduce((s, e) => s + e.grossIdr, 0));
  const netUsd = Number(availableRows.reduce((s, e) => s + e.netUsd, 0).toFixed(2));
  const netIdr = Math.round(availableRows.reduce((s, e) => s + e.netIdr, 0));

  const committedPayouts = payoutRows.filter((p) => p.status !== 'rejected');
  const withdrawnUsd = Number(
    committedPayouts.reduce((s, p) => s + p.amountUsd, 0).toFixed(2)
  );
  const withdrawnIdr = Math.round(
    committedPayouts.reduce((s, p) => s + p.amountIdr, 0)
  );

  return {
    commissionPercent,
    grossUsd,
    grossIdr,
    netUsd,
    netIdr,
    withdrawnUsd,
    withdrawnIdr,
    availableUsd: Math.max(0, Number((netUsd - withdrawnUsd).toFixed(2))),
    availableIdr: Math.max(0, netIdr - withdrawnIdr),
    earnings: earningRows,
    payouts: payoutRows,
  };
}

export async function getCreatorEarningsSummarySql(creatorId: string) {
  try {
    await ensureLegacyLedgerMigrated();
    const [settingsRows, earnRows, payoutRows] = await Promise.all([
      db.select().from(platformSettings).where(eq(platformSettings.id, 'global')),
      db
        .select()
        .from(creatorEarnings)
        .where(eq(creatorEarnings.creatorId, creatorId))
        .orderBy(desc(creatorEarnings.createdAt)),
      db
        .select()
        .from(payouts)
        .where(eq(payouts.creatorId, creatorId))
        .orderBy(desc(payouts.createdAt)),
    ]);

    const commissionPercent = settingsRows[0]?.commissionPercent ?? 20;
    return computeCreatorEarningsSummaryFromRows(
      commissionPercent,
      earnRows.map(mapEarningRow),
      payoutRows.map(mapPayoutRow)
    );
  } catch (error) {
    console.error('getCreatorEarningsSummarySql failed:', error);
    throw new Error('Failed to load creator earnings summary.', { cause: error });
  }
}

export async function requestCreatorPayoutAtomicSql(input: {
  uid: string;
  creatorName: string;
  currency: 'USD' | 'IDR';
  amount: number;
  method: 'bank_transfer_idr' | 'ewallet_idr' | 'paypal_usd';
  destination: string;
  payoutId: string;
  idemKey?: string;
}): Promise<{ status: number; body: unknown }> {
  try {
    await ensureLegacyLedgerMigrated();
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const fullIdemKey = input.idemKey
      ? makeIdemKey('creator_payout', input.uid, input.idemKey)
      : null;

    return await db.transaction(async (tx) => {
      if (fullIdemKey) {
        const cached = await tx
          .select()
          .from(idempotencyRecords)
          .where(eq(idempotencyRecords.fullKey, fullIdemKey));
        if (cached[0]) {
          return { status: cached[0].status, body: cached[0].bodyJson };
        }
      }

      const [settingsRows, earnRows, payoutRows] = await Promise.all([
        tx.select().from(platformSettings).where(eq(platformSettings.id, 'global')),
        tx
          .select()
          .from(creatorEarnings)
          .where(eq(creatorEarnings.creatorId, input.uid))
          .orderBy(desc(creatorEarnings.createdAt)),
        tx
          .select()
          .from(payouts)
          .where(eq(payouts.creatorId, input.uid))
          .orderBy(desc(payouts.createdAt)),
      ]);

      const commissionPercent = settingsRows[0]?.commissionPercent ?? 20;
      const mappedEarnings = earnRows.map(mapEarningRow);
      const mappedPayouts = payoutRows.map(mapPayoutRow);
      const summary = computeCreatorEarningsSummaryFromRows(
        commissionPercent,
        mappedEarnings,
        mappedPayouts
      );

      if (input.currency === 'USD' && input.amount > summary.availableUsd + 0.001) {
        return {
          status: 400,
          body: {
            error: `Requested $${input.amount.toFixed(
              2
            )} exceeds available USD balance ($${summary.availableUsd.toFixed(2)}).`,
          },
        };
      }
      if (input.currency === 'IDR' && input.amount > summary.availableIdr) {
        return {
          status: 400,
          body: {
            error: `Requested Rp ${input.amount} exceeds available IDR balance (Rp ${summary.availableIdr}).`,
          },
        };
      }

      const payoutRecord: PayoutRecord = {
        id: input.payoutId,
        creatorId: input.uid,
        creatorName: input.creatorName,
        amountUsd: input.currency === 'USD' ? Number(input.amount.toFixed(2)) : 0,
        amountIdr: input.currency === 'IDR' ? Math.round(input.amount) : 0,
        currency: input.currency,
        method: input.method,
        destination: input.destination,
        status: 'requested',
        adminNote: '',
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      await tx.insert(payouts).values(payoutRecord);

      const updatedSummary = computeCreatorEarningsSummaryFromRows(
        commissionPercent,
        mappedEarnings,
        [payoutRecord, ...mappedPayouts]
      );
      const body = { payout: payoutRecord, summary: updatedSummary };

      if (fullIdemKey) {
        await tx
          .insert(idempotencyRecords)
          .values({
            fullKey: fullIdemKey,
            status: 200,
            bodyJson: body,
            createdAtMs: now,
          })
          .onConflictDoNothing();
      }

      return { status: 200, body };
    });
  } catch (error) {
    console.error('requestCreatorPayoutAtomicSql failed:', error);
    throw new Error('Failed to submit payout request.', { cause: error });
  }
}

async function computeAdminOverviewFromDb(
  executor: Pick<typeof db, 'select'>
): Promise<AdminFinanceOverview> {
  const now = Date.now();
  const [settingsRows, paymentRows, purchaseRows, payoutRows, earningRows, entRows] =
    await Promise.all([
      executor.select().from(platformSettings).where(eq(platformSettings.id, 'global')),
      executor.select().from(payments).orderBy(desc(payments.createdAt)),
      executor.select().from(purchases).orderBy(desc(purchases.createdAt)),
      executor.select().from(payouts).orderBy(desc(payouts.createdAt)),
      executor.select().from(creatorEarnings),
      executor.select().from(entitlements),
    ]);

  const commissionPercent = settingsRows[0]?.commissionPercent ?? 20;
  const completedPayments = paymentRows.filter((p) => p.status === 'completed');

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

  const validEarnings = earningRows.filter((e) => e.status === 'available');
  const platformCommissionUsd = Number(
    validEarnings.reduce((s, e) => s + (e.grossUsd - e.netUsd), 0).toFixed(2)
  );
  const platformCommissionIdr = Math.round(
    validEarnings.reduce((s, e) => s + (e.grossIdr - e.netIdr), 0)
  );

  const activeEntitlementsCount = entRows.filter(
    (e) => e.status !== 'revoked' && now < e.expiresAtMs
  ).length;

  return {
    commissionPercent,
    totalGrossUsd,
    totalGrossIdr,
    platformCommissionUsd,
    platformCommissionIdr,
    payments: paymentRows.map(mapPaymentRow),
    purchases: purchaseRows.map(mapPurchaseRow),
    payouts: payoutRows.map(mapPayoutRow),
    activeEntitlementsCount,
  };
}

export async function getAdminFinanceOverviewSql(): Promise<AdminFinanceOverview> {
  try {
    await ensureLegacyLedgerMigrated();
    return await computeAdminOverviewFromDb(db);
  } catch (error) {
    console.error('getAdminFinanceOverviewSql failed:', error);
    throw new Error('Failed to load admin finance overview.', { cause: error });
  }
}

export async function refundPaymentAtomicSql(input: {
  adminUid: string;
  paymentId: string;
  idemKey?: string;
}): Promise<{ status: number; body: unknown }> {
  try {
    await ensureLegacyLedgerMigrated();
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const fullIdemKey = input.idemKey
      ? makeIdemKey('admin_refund', input.adminUid, input.idemKey)
      : null;

    return await db.transaction(async (tx) => {
      if (fullIdemKey) {
        const cached = await tx
          .select()
          .from(idempotencyRecords)
          .where(eq(idempotencyRecords.fullKey, fullIdemKey));
        if (cached[0]) {
          return { status: cached[0].status, body: cached[0].bodyJson };
        }
      }

      const payRows = await tx
        .select()
        .from(payments)
        .where(eq(payments.id, input.paymentId));
      const payment = payRows[0];
      if (!payment) {
        return { status: 404, body: { error: 'Payment transaction not found.' } };
      }
      if (payment.status !== 'completed') {
        return {
          status: 400,
          body: { error: `Cannot refund payment in status "${payment.status}".` },
        };
      }

      const updatedPayments = await tx
        .update(payments)
        .set({ status: 'refunded', refundedAt: nowIso, updatedAt: nowIso })
        .where(and(eq(payments.id, input.paymentId), eq(payments.status, 'completed')))
        .returning();

      if (!updatedPayments[0]) {
        return { status: 409, body: { error: 'Payment was already refunded.' } };
      }

      await tx
        .update(purchases)
        .set({ status: 'refunded' })
        .where(eq(purchases.id, `pur_${input.paymentId}`));

      if (payment.purpose === 'video_unlock') {
        await tx
          .update(entitlements)
          .set({ status: 'revoked', expiresAtMs: now })
          .where(
            eq(
              entitlements.compositeKey,
              entitlementKey(payment.userId, payment.targetId)
            )
          );

        await tx
          .update(creatorEarnings)
          .set({ status: 'reversed' })
          .where(eq(creatorEarnings.id, `earn_${input.paymentId}`));

        if (payment.method === 'credits') {
          const refundCredits = Math.abs(payment.creditsDelta);
          await tx
            .insert(wallets)
            .values({
              userId: payment.userId,
              balanceCredits: 0,
              totalSpentCredits: 0,
              updatedAtMs: now,
            })
            .onConflictDoNothing();

          await tx
            .update(wallets)
            .set({
              balanceCredits: sql`${wallets.balanceCredits} + ${refundCredits}`,
              updatedAtMs: now,
            })
            .where(eq(wallets.userId, payment.userId));

          await tx.insert(walletTransactions).values({
            id: `wtx_ref_${input.paymentId}`,
            userId: payment.userId,
            type: 'refund',
            creditsDelta: refundCredits,
            description: `Refund for "${payment.targetTitle}"`,
            createdAt: nowIso,
          });
        }
      } else if (payment.purpose === 'credit_topup') {
        const wRows = await tx
          .select()
          .from(wallets)
          .where(eq(wallets.userId, payment.userId));
        const curBal = wRows[0]?.balanceCredits ?? 0;
        const deduct = Math.min(curBal, Math.max(0, payment.creditsDelta));
        if (deduct > 0) {
          await tx
            .update(wallets)
            .set({
              balanceCredits: sql`GREATEST(0, ${wallets.balanceCredits} - ${deduct})`,
              updatedAtMs: now,
            })
            .where(eq(wallets.userId, payment.userId));
        }
        await tx.insert(walletTransactions).values({
          id: `wtx_ref_${input.paymentId}`,
          userId: payment.userId,
          type: 'refund',
          creditsDelta: -deduct,
          description: `Top-up refunded (${payment.targetTitle})`,
          createdAt: nowIso,
        });
      }

      const overview = await computeAdminOverviewFromDb(tx);
      const body = {
        ok: true,
        payment: mapPaymentRow(updatedPayments[0]),
        overview,
      };

      if (fullIdemKey) {
        await tx
          .insert(idempotencyRecords)
          .values({
            fullKey: fullIdemKey,
            status: 200,
            bodyJson: body,
            createdAtMs: now,
          })
          .onConflictDoNothing();
      }

      return { status: 200, body };
    });
  } catch (error) {
    console.error('refundPaymentAtomicSql failed:', error);
    throw new Error('Failed to process refund.', { cause: error });
  }
}

export async function updatePayoutStatusSql(input: {
  payoutId: string;
  status: 'processing' | 'paid' | 'rejected';
  adminNote?: string;
}): Promise<{ status: number; body: unknown }> {
  try {
    await ensureLegacyLedgerMigrated();
    const nowIso = new Date().toISOString();
    return await db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(payouts)
        .where(eq(payouts.id, input.payoutId));
      if (!existing[0]) {
        return { status: 404, body: { error: 'Payout request not found.' } };
      }

      const nextNote =
        typeof input.adminNote === 'string'
          ? input.adminNote.trim().slice(0, 240)
          : existing[0].adminNote;

      const updated = await tx
        .update(payouts)
        .set({
          status: input.status,
          adminNote: nextNote,
          updatedAt: nowIso,
        })
        .where(eq(payouts.id, input.payoutId))
        .returning();

      const overview = await computeAdminOverviewFromDb(tx);
      return {
        status: 200,
        body: {
          payout: mapPayoutRow(updated[0]),
          overview,
        },
      };
    });
  } catch (error) {
    console.error('updatePayoutStatusSql failed:', error);
    throw new Error('Failed to update payout status.', { cause: error });
  }
}

export async function updatePlatformSettingsSql(input: {
  commissionPercent: number;
  minPriceUsd?: number;
  minPriceIdr?: number;
}): Promise<void> {
  try {
    await ensureLegacyLedgerMigrated();
    const existing = await db
      .select()
      .from(platformSettings)
      .where(eq(platformSettings.id, 'global'));
    const cur = existing[0] ?? {
      commissionPercent: 20,
      minPriceUsd: 1.99,
      minPriceIdr: 29000,
    };

    const nextCommission = Math.round(input.commissionPercent);
    const nextMinUsd =
      typeof input.minPriceUsd === 'number' && input.minPriceUsd >= 0.99
        ? Number(input.minPriceUsd.toFixed(2))
        : cur.minPriceUsd;
    const nextMinIdr =
      typeof input.minPriceIdr === 'number' && input.minPriceIdr >= 10000
        ? Math.round(input.minPriceIdr)
        : cur.minPriceIdr;

    await db
      .insert(platformSettings)
      .values({
        id: 'global',
        commissionPercent: nextCommission,
        minPriceUsd: nextMinUsd,
        minPriceIdr: nextMinIdr,
      })
      .onConflictDoUpdate({
        target: platformSettings.id,
        set: {
          commissionPercent: nextCommission,
          minPriceUsd: nextMinUsd,
          minPriceIdr: nextMinIdr,
        },
      });
  } catch (error) {
    console.error('updatePlatformSettingsSql failed:', error);
    throw new Error('Failed to save platform settings.', { cause: error });
  }
}

function mapDeletionJobRow(
  row: typeof videoDeletionJobs.$inferSelect
): VideoDeletionJobRecord {
  return {
    operationId: row.operationId,
    videoId: row.videoId,
    videoTitleSnapshot: row.videoTitleSnapshot,
    provider: row.provider,
    assetRefFingerprint: row.assetRefFingerprint,
    requestedBy: row.requestedBy,
    requestedAt: row.requestedAt,
    status: row.status as VideoDeletionJobStatus,
    providerResult: row.providerResult,
    firestoreResult: row.firestoreResult,
    sqlResult: row.sqlResult,
    thumbnailResult: row.thumbnailResult,
    externalMediaWarning: row.externalMediaWarning ?? null,
    errorCode: row.errorCode ?? null,
    errorMessage: row.errorMessage ?? null,
    completedAt: row.completedAt ?? null,
  };
}

export async function createVideoDeletionJobSql(
  job: VideoDeletionJobRecord
): Promise<VideoDeletionJobRecord> {
  await ensureLegacyLedgerMigrated();
  await db.insert(videoDeletionJobs).values({
    operationId: job.operationId,
    videoId: job.videoId,
    videoTitleSnapshot: job.videoTitleSnapshot,
    provider: job.provider,
    assetRefFingerprint: job.assetRefFingerprint,
    requestedBy: job.requestedBy,
    requestedAt: job.requestedAt,
    status: job.status,
    providerResult: job.providerResult,
    firestoreResult: job.firestoreResult,
    sqlResult: job.sqlResult,
    thumbnailResult: job.thumbnailResult,
    externalMediaWarning: job.externalMediaWarning ?? null,
    errorCode: job.errorCode ?? null,
    errorMessage: job.errorMessage ?? null,
    completedAt: job.completedAt ?? null,
  });
  return job;
}

export async function updateVideoDeletionJobSql(
  operationId: string,
  patch: Partial<Omit<VideoDeletionJobRecord, 'operationId' | 'videoId'>>
): Promise<void> {
  await ensureLegacyLedgerMigrated();
  await db
    .update(videoDeletionJobs)
    .set({
      ...(patch.videoTitleSnapshot !== undefined
        ? { videoTitleSnapshot: patch.videoTitleSnapshot }
        : {}),
      ...(patch.provider !== undefined ? { provider: patch.provider } : {}),
      ...(patch.assetRefFingerprint !== undefined
        ? { assetRefFingerprint: patch.assetRefFingerprint }
        : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.providerResult !== undefined
        ? { providerResult: patch.providerResult }
        : {}),
      ...(patch.firestoreResult !== undefined
        ? { firestoreResult: patch.firestoreResult }
        : {}),
      ...(patch.sqlResult !== undefined ? { sqlResult: patch.sqlResult } : {}),
      ...(patch.thumbnailResult !== undefined
        ? { thumbnailResult: patch.thumbnailResult }
        : {}),
      ...(patch.externalMediaWarning !== undefined
        ? { externalMediaWarning: patch.externalMediaWarning }
        : {}),
      ...(patch.errorCode !== undefined ? { errorCode: patch.errorCode } : {}),
      ...(patch.errorMessage !== undefined ? { errorMessage: patch.errorMessage } : {}),
      ...(patch.completedAt !== undefined ? { completedAt: patch.completedAt } : {}),
    })
    .where(eq(videoDeletionJobs.operationId, operationId));
}

export async function getLatestVideoDeletionJobSql(
  videoId: string
): Promise<VideoDeletionJobRecord | null> {
  await ensureLegacyLedgerMigrated();
  const rows = await db
    .select()
    .from(videoDeletionJobs)
    .where(eq(videoDeletionJobs.videoId, videoId))
    .orderBy(desc(videoDeletionJobs.requestedAt));
  return rows[0] ? mapDeletionJobRow(rows[0]) : null;
}

export async function listVideoDeletionJobsSql(
  limitCount = 40
): Promise<VideoDeletionJobRecord[]> {
  await ensureLegacyLedgerMigrated();
  const rows = await db
    .select()
    .from(videoDeletionJobs)
    .orderBy(desc(videoDeletionJobs.requestedAt))
    .limit(Math.max(1, Math.min(100, limitCount)));
  return rows.map(mapDeletionJobRow);
}

export async function getCreatorMediaByVideoIdSql(
  videoId: string
): Promise<CreatorMediaBinding | null> {
  await ensureLegacyLedgerMigrated();
  const rows = await db
    .select()
    .from(creatorMedia)
    .where(eq(creatorMedia.videoId, videoId));
  const m = rows[0];
  if (!m || m.provider === 'thumbnail') return null;
  return {
    videoId: m.videoId,
    creatorId: m.creatorId,
    provider: m.provider as CreatorMediaBinding['provider'],
    assetRef: m.assetRef,
    mimeType: m.mimeType ?? undefined,
    updatedAtIso: m.updatedAtIso,
  };
}

// Idempotently remove only media mapping (never financial/purchase/entitlement/payout rows)
export async function deleteCreatorMediaByVideoIdSql(
  videoId: string
): Promise<{ deletedCount: number }> {
  await ensureLegacyLedgerMigrated();
  const deleted = await db
    .delete(creatorMedia)
    .where(eq(creatorMedia.videoId, videoId))
    .returning();
  return { deletedCount: deleted.length };
}

export async function deleteThumbnailAssetSql(
  key: string
): Promise<{ deletedCount: number }> {
  await ensureLegacyLedgerMigrated();
  const deleted = await db
    .delete(creatorMedia)
    .where(and(eq(creatorMedia.videoId, key), eq(creatorMedia.provider, 'thumbnail')))
    .returning();
  return { deletedCount: deleted.length };
}

