import {
  bigint,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const wallets = pgTable('wallets', {
  userId: text('user_id').primaryKey(),
  balanceCredits: integer('balance_credits').notNull().default(0),
  totalSpentCredits: integer('total_spent_credits').notNull().default(0),
  updatedAtMs: bigint('updated_at_ms', { mode: 'number' }).notNull(),
});

export const walletTransactions = pgTable('wallet_transactions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  type: text('type').notNull(),
  creditsDelta: integer('credits_delta').notNull(),
  description: text('description').notNull(),
  createdAt: text('created_at').notNull(),
});

export const payments = pgTable('payments', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  userEmail: text('user_email'),
  purpose: text('purpose').notNull(),
  targetId: text('target_id').notNull(),
  targetTitle: text('target_title').notNull(),
  method: text('method').notNull(),
  amount: doublePrecision('amount').notNull(),
  currency: text('currency').notNull(),
  creditsDelta: integer('credits_delta').notNull().default(0),
  status: text('status').notNull(),
  gatewayOrderId: text('gateway_order_id').notNull(),
  gatewayMode: text('gateway_mode').notNull(),
  approvalUrl: text('approval_url'),
  qrString: text('qr_string'),
  expiresAt: text('expires_at'),
  refundedAt: text('refunded_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const purchases = pgTable('purchases', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  videoId: text('video_id').notNull(),
  videoTitle: text('video_title').notNull(),
  method: text('method').notNull(),
  amount: doublePrecision('amount').notNull(),
  currency: text('currency').notNull(),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
});

export const entitlements = pgTable('entitlements', {
  compositeKey: text('composite_key').primaryKey(),
  id: text('id').notNull(),
  userId: text('user_id').notNull(),
  videoId: text('video_id').notNull(),
  videoTitle: text('video_title').notNull(),
  thumbnailUrl: text('thumbnail_url').notNull().default(''),
  grantedAtMs: bigint('granted_at_ms', { mode: 'number' }).notNull(),
  expiresAtMs: bigint('expires_at_ms', { mode: 'number' }).notNull(),
  resumeSeconds: integer('resume_seconds').notNull().default(0),
  status: text('status').notNull().default('active'),
  source: text('source').notNull(),
});

export const creatorEarnings = pgTable('creator_earnings', {
  id: text('id').primaryKey(),
  creatorId: text('creator_id').notNull(),
  videoId: text('video_id').notNull(),
  videoTitle: text('video_title').notNull(),
  purchaseId: text('purchase_id').notNull(),
  buyerUserId: text('buyer_user_id').notNull(),
  method: text('method').notNull(),
  grossUsd: doublePrecision('gross_usd').notNull(),
  grossIdr: integer('gross_idr').notNull(),
  commissionPercent: integer('commission_percent').notNull(),
  netUsd: doublePrecision('net_usd').notNull(),
  netIdr: integer('net_idr').notNull(),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
});

export const payouts = pgTable('payouts', {
  id: text('id').primaryKey(),
  creatorId: text('creator_id').notNull(),
  creatorName: text('creator_name').notNull(),
  amountUsd: doublePrecision('amount_usd').notNull(),
  amountIdr: integer('amount_idr').notNull(),
  currency: text('currency').notNull(),
  method: text('method').notNull(),
  destination: text('destination').notNull(),
  status: text('status').notNull(),
  adminNote: text('admin_note').notNull().default(''),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const idempotencyRecords = pgTable('idempotency_records', {
  fullKey: text('full_key').primaryKey(),
  status: integer('status').notNull(),
  bodyJson: jsonb('body_json').notNull(),
  createdAtMs: bigint('created_at_ms', { mode: 'number' }).notNull(),
});

export const processedWebhooks = pgTable('processed_webhooks', {
  eventKey: text('event_key').primaryKey(),
  processedAtMs: bigint('processed_at_ms', { mode: 'number' }).notNull(),
});

export const creatorMedia = pgTable('creator_media', {
  videoId: text('video_id').primaryKey(),
  creatorId: text('creator_id').notNull(),
  provider: text('provider').notNull(),
  assetRef: text('asset_ref').notNull(),
  mimeType: text('mime_type'),
  updatedAtIso: text('updated_at_iso').notNull(),
});

export const platformSettings = pgTable('platform_settings', {
  id: text('id').primaryKey(),
  commissionPercent: integer('commission_percent').notNull().default(20),
  minPriceUsd: doublePrecision('min_price_usd').notNull().default(1.99),
  minPriceIdr: integer('min_price_idr').notNull().default(29000),
});
