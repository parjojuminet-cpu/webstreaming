var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// server/app.ts
import crypto3 from "node:crypto";
import fs2 from "node:fs";
import os2 from "node:os";
import path3 from "node:path";
import express from "express";
import dotenv from "dotenv";
import { getApp, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

// server/paymentService.ts
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import QRCode from "qrcode";
var PREVIEW_LIMIT_SECONDS = 300;
var ACCESS_WINDOW_MS = 30 * 24 * 60 * 60 * 1e3;
var PAYMENT_TTL_MS = 15 * 60 * 1e3;
var SERVER_DATA_DIR = process.env.VERCEL === "1" ? path.resolve(os.tmpdir(), ".vyora_server_data") : path.resolve(process.cwd(), ".vyora_server_data");
var LEDGER_FILE = path.resolve(SERVER_DATA_DIR, "ledger.json");
var LEGACY_ENTITLEMENTS_FILE = path.resolve(SERVER_DATA_DIR, "entitlements.json");
var SERVER_CATALOG = {};
var SERVER_CREDIT_PACKAGES = {
  "pack-starter": {
    id: "pack-starter",
    name: "Viewer Pack",
    credits: 10,
    bonusCredits: 0,
    priceUsd: 9.5,
    priceIdr: 149e3
  },
  "pack-cinema": {
    id: "pack-cinema",
    name: "Cinema Pass",
    credits: 25,
    bonusCredits: 4,
    priceUsd: 22,
    priceIdr: 349e3
  },
  "pack-studio": {
    id: "pack-studio",
    name: "Patron Vault",
    credits: 60,
    bonusCredits: 12,
    priceUsd: 49,
    priceIdr: 779e3
  }
};
var mutexTail = Promise.resolve();
function entitlementKey(uid, videoId) {
  return `${uid}::${videoId}`;
}
async function resolveServerVideoEntry(videoId, projectId, databaseId) {
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
    const doc = await res.json();
    const f = doc.fields;
    if (!f || f.status?.stringValue !== "published") return null;
    const parseFirestoreNumber = (field, fallback) => {
      if (!field) return fallback;
      if (typeof field.doubleValue === "number" && Number.isFinite(field.doubleValue)) {
        return field.doubleValue;
      }
      if (field.integerValue !== void 0) {
        const parsed = Number(field.integerValue);
        if (Number.isFinite(parsed)) return parsed;
      }
      return fallback;
    };
    const priceUsd = parseFirestoreNumber(f.priceUsd, 4.99);
    const priceIdr = Math.round(parseFirestoreNumber(f.priceIdr, 75e3));
    const creditCost = Math.round(parseFirestoreNumber(f.creditCost, 5));
    return {
      id: videoId,
      title: f.title?.stringValue || videoId,
      category: f.category?.stringValue || "Movies",
      creatorId: f.creatorId?.stringValue || "creator-unknown",
      thumbnailUrl: f.thumbnailUrl?.stringValue || "",
      priceUsd,
      priceIdr,
      creditCost
    };
  } catch {
    return null;
  }
}
function crc16Ccitt(payload) {
  let crc = 65535;
  for (let i = 0; i < payload.length; i += 1) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j += 1) {
      crc = (crc & 32768) !== 0 ? crc << 1 ^ 4129 : crc << 1;
      crc &= 65535;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}
function buildQrisPayloadString(orderId, amountIdr) {
  const amountStr = String(Math.round(amountIdr));
  const amtTag = `54${String(amountStr.length).padStart(2, "0")}${amountStr}`;
  const refTag = `05${String(orderId.length).padStart(2, "0")}${orderId}`;
  const addlData = `62${String(refTag.length).padStart(2, "0")}${refTag}`;
  const bodyWithoutCrc = `00020101021226590014ID.CO.QRIS.WWW01189360091430000000010215ID10200000000010303UME520458155303360${amtTag}5802ID5914DELOKEN STREAM6007JAKARTA610512190${addlData}6304`;
  return `${bodyWithoutCrc}${crc16Ccitt(bodyWithoutCrc)}`;
}
var DEFAULT_PAYPAL_PAYMENT_LINK = "https://www.paypal.com/ncp/payment/NNY5BAAE3XSMG";
function isAllowedPayPalUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== "https:") return null;
    const host = parsed.hostname.toLowerCase();
    if (host !== "paypal.com" && !host.endsWith(".paypal.com")) return null;
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return null;
  }
}
function getPayPalPaymentLink() {
  const raw = process.env.PAYPAL_PAYMENT_LINK?.trim() || DEFAULT_PAYPAL_PAYMENT_LINK;
  return isAllowedPayPalUrl(raw);
}
function isPayPalConfigured() {
  return Boolean(
    process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET && process.env.PAYPAL_CLIENT_ID.trim().length > 5 && process.env.PAYPAL_CLIENT_SECRET.trim().length > 5
  );
}
function getPayPalBaseUrl() {
  return process.env.PAYPAL_MODE === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}
async function getPayPalAccessToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID || "";
  const secret = process.env.PAYPAL_CLIENT_SECRET || "";
  const basic = Buffer.from(`${clientId}:${secret}`).toString("base64");
  const res = await fetch(`${getPayPalBaseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });
  if (!res.ok) {
    throw new Error("Failed to authenticate with PayPal REST API.");
  }
  const data = await res.json();
  return data.access_token;
}
async function createLivePayPalOrder(input) {
  const accessToken = await getPayPalAccessToken();
  const res = await fetch(`${getPayPalBaseUrl()}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": input.orderId
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: input.orderId,
          custom_id: input.orderId,
          description: input.description.slice(0, 127),
          amount: {
            currency_code: "USD",
            value: input.amountUsd.toFixed(2)
          }
        }
      ],
      application_context: {
        brand_name: "DELOKEN Streaming",
        user_action: "PAY_NOW",
        return_url: input.returnUrl,
        cancel_url: input.cancelUrl
      }
    })
  });
  if (!res.ok) {
    throw new Error("Unable to create PayPal checkout order.");
  }
  const data = await res.json();
  const approve = data.links?.find((l) => l.rel === "approve")?.href ?? "";
  return { paypalOrderId: data.id, approvalUrl: approve };
}
async function captureLivePayPalOrder(paypalOrderId) {
  const accessToken = await getPayPalAccessToken();
  const res = await fetch(
    `${getPayPalBaseUrl()}/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      }
    }
  );
  if (!res.ok) {
    throw new Error("PayPal capture verification failed.");
  }
  const data = await res.json();
  const capture = data.purchase_units?.[0]?.payments?.captures?.[0];
  const completed = data.status === "COMPLETED" && capture?.status === "COMPLETED" && capture?.amount?.currency_code === "USD";
  return {
    completed,
    capturedUsd: Number(capture?.amount?.value ?? 0)
  };
}
function isMidtransConfigured() {
  return Boolean(
    process.env.MIDTRANS_SERVER_KEY && process.env.MIDTRANS_SERVER_KEY.trim().length > 5
  );
}
function getMidtransBaseUrl() {
  return process.env.MIDTRANS_IS_PRODUCTION === "true" ? "https://api.midtrans.com" : "https://api.sandbox.midtrans.com";
}
async function createLiveMidtransQris(input) {
  const serverKey = process.env.MIDTRANS_SERVER_KEY || "";
  const auth = Buffer.from(`${serverKey}:`).toString("base64");
  const res = await fetch(`${getMidtransBaseUrl()}/v2/charge`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      payment_type: "qris",
      transaction_details: {
        order_id: input.orderId,
        gross_amount: Math.round(input.amountIdr)
      }
    })
  });
  if (!res.ok) {
    throw new Error("Unable to create Midtrans QRIS charge.");
  }
  const data = await res.json();
  if (!data.qr_string) {
    throw new Error("Midtrans QRIS response missing qr_string.");
  }
  return {
    qrString: data.qr_string,
    transactionId: data.transaction_id || input.orderId
  };
}
function verifyMidtransWebhookSignature(input) {
  const serverKey = process.env.MIDTRANS_SERVER_KEY || "";
  if (!serverKey) return false;
  const expected = crypto.createHash("sha512").update(`${input.orderId}${input.statusCode}${input.grossAmount}${serverKey}`).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(input.signatureKey || "", "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// src/db/index.ts
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

// src/db/schema.ts
var schema_exports = {};
__export(schema_exports, {
  creatorEarnings: () => creatorEarnings,
  creatorMedia: () => creatorMedia,
  entitlements: () => entitlements,
  idempotencyRecords: () => idempotencyRecords,
  payments: () => payments,
  payouts: () => payouts,
  platformSettings: () => platformSettings,
  processedWebhooks: () => processedWebhooks,
  purchases: () => purchases,
  users: () => users,
  walletTransactions: () => walletTransactions,
  wallets: () => wallets
});
import {
  bigint,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp
} from "drizzle-orm/pg-core";
var users = pgTable("users", {
  id: serial("id").primaryKey(),
  uid: text("uid").notNull().unique(),
  email: text("email").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull()
});
var wallets = pgTable("wallets", {
  userId: text("user_id").primaryKey(),
  balanceCredits: integer("balance_credits").notNull().default(0),
  totalSpentCredits: integer("total_spent_credits").notNull().default(0),
  updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull()
});
var walletTransactions = pgTable("wallet_transactions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  type: text("type").notNull(),
  creditsDelta: integer("credits_delta").notNull(),
  description: text("description").notNull(),
  createdAt: text("created_at").notNull()
});
var payments = pgTable("payments", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  userEmail: text("user_email"),
  purpose: text("purpose").notNull(),
  targetId: text("target_id").notNull(),
  targetTitle: text("target_title").notNull(),
  method: text("method").notNull(),
  amount: doublePrecision("amount").notNull(),
  currency: text("currency").notNull(),
  creditsDelta: integer("credits_delta").notNull().default(0),
  status: text("status").notNull(),
  gatewayOrderId: text("gateway_order_id").notNull(),
  gatewayMode: text("gateway_mode").notNull(),
  approvalUrl: text("approval_url"),
  qrString: text("qr_string"),
  expiresAt: text("expires_at"),
  refundedAt: text("refunded_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});
var purchases = pgTable("purchases", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  videoId: text("video_id").notNull(),
  videoTitle: text("video_title").notNull(),
  method: text("method").notNull(),
  amount: doublePrecision("amount").notNull(),
  currency: text("currency").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull()
});
var entitlements = pgTable("entitlements", {
  compositeKey: text("composite_key").primaryKey(),
  id: text("id").notNull(),
  userId: text("user_id").notNull(),
  videoId: text("video_id").notNull(),
  videoTitle: text("video_title").notNull(),
  thumbnailUrl: text("thumbnail_url").notNull().default(""),
  grantedAtMs: bigint("granted_at_ms", { mode: "number" }).notNull(),
  expiresAtMs: bigint("expires_at_ms", { mode: "number" }).notNull(),
  resumeSeconds: integer("resume_seconds").notNull().default(0),
  status: text("status").notNull().default("active"),
  source: text("source").notNull()
});
var creatorEarnings = pgTable("creator_earnings", {
  id: text("id").primaryKey(),
  creatorId: text("creator_id").notNull(),
  videoId: text("video_id").notNull(),
  videoTitle: text("video_title").notNull(),
  purchaseId: text("purchase_id").notNull(),
  buyerUserId: text("buyer_user_id").notNull(),
  method: text("method").notNull(),
  grossUsd: doublePrecision("gross_usd").notNull(),
  grossIdr: integer("gross_idr").notNull(),
  commissionPercent: integer("commission_percent").notNull(),
  netUsd: doublePrecision("net_usd").notNull(),
  netIdr: integer("net_idr").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull()
});
var payouts = pgTable("payouts", {
  id: text("id").primaryKey(),
  creatorId: text("creator_id").notNull(),
  creatorName: text("creator_name").notNull(),
  amountUsd: doublePrecision("amount_usd").notNull(),
  amountIdr: integer("amount_idr").notNull(),
  currency: text("currency").notNull(),
  method: text("method").notNull(),
  destination: text("destination").notNull(),
  status: text("status").notNull(),
  adminNote: text("admin_note").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});
var idempotencyRecords = pgTable("idempotency_records", {
  fullKey: text("full_key").primaryKey(),
  status: integer("status").notNull(),
  bodyJson: jsonb("body_json").notNull(),
  createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull()
});
var processedWebhooks = pgTable("processed_webhooks", {
  eventKey: text("event_key").primaryKey(),
  processedAtMs: bigint("processed_at_ms", { mode: "number" }).notNull()
});
var creatorMedia = pgTable("creator_media", {
  videoId: text("video_id").primaryKey(),
  creatorId: text("creator_id").notNull(),
  provider: text("provider").notNull(),
  assetRef: text("asset_ref").notNull(),
  mimeType: text("mime_type"),
  updatedAtIso: text("updated_at_iso").notNull()
});
var platformSettings = pgTable("platform_settings", {
  id: text("id").primaryKey(),
  commissionPercent: integer("commission_percent").notNull().default(20),
  minPriceUsd: doublePrecision("min_price_usd").notNull().default(1.99),
  minPriceIdr: integer("min_price_idr").notNull().default(29e3)
});

// src/db/index.ts
function isSqlConfigured() {
  return Boolean(
    process.env.DATABASE_URL?.trim() || process.env.POSTGRES_URL?.trim() || process.env.SQL_HOST?.trim()
  );
}
var createPool = () => {
  if (!global._postgresPool) {
    const connectionString = process.env.DATABASE_URL?.trim() || process.env.POSTGRES_URL?.trim();
    if (connectionString) {
      const isLocal = connectionString.includes("localhost") || connectionString.includes("127.0.0.1");
      global._postgresPool = new Pool({
        connectionString,
        ssl: isLocal ? void 0 : { rejectUnauthorized: false },
        max: 10,
        connectionTimeoutMillis: 15e3
      });
    } else {
      global._postgresPool = new Pool({
        host: process.env.SQL_HOST,
        user: process.env.SQL_USER,
        password: process.env.SQL_PASSWORD,
        database: process.env.SQL_DB_NAME,
        max: 10,
        connectionTimeoutMillis: 15e3
      });
    }
    global._postgresPool.on("error", (err) => {
      console.error("Unexpected error on idle SQL pool client:", err);
    });
  }
  return global._postgresPool;
};
var pool = createPool();
var db = drizzle(pool, { schema: schema_exports });

// src/db/ledgerRepository.ts
import fs from "node:fs";
import path2 from "node:path";
import { and, desc, eq, gte, sql } from "drizzle-orm";
var SERVER_DATA_DIR2 = path2.resolve(process.cwd(), ".vyora_server_data");
var LEGACY_LEDGER_FILE = path2.resolve(SERVER_DATA_DIR2, "ledger.json");
var migrationPromise = null;
async function ensureSqlTablesExist() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      uid TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS wallets (
      user_id TEXT PRIMARY KEY,
      balance_credits INTEGER NOT NULL DEFAULT 0,
      total_spent_credits INTEGER NOT NULL DEFAULT 0,
      updated_at_ms BIGINT NOT NULL
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      credits_delta INTEGER NOT NULL,
      description TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  await db.execute(sql`
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
  `);
  await db.execute(sql`
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
  `);
  await db.execute(sql`
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
  `);
  await db.execute(sql`
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
  `);
  await db.execute(sql`
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
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS idempotency_records (
      full_key TEXT PRIMARY KEY,
      status INTEGER NOT NULL,
      body_json JSONB NOT NULL,
      created_at_ms BIGINT NOT NULL
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS processed_webhooks (
      event_key TEXT PRIMARY KEY,
      processed_at_ms BIGINT NOT NULL
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS creator_media (
      video_id TEXT PRIMARY KEY,
      creator_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      asset_ref TEXT NOT NULL,
      mime_type TEXT,
      updated_at_iso TEXT NOT NULL
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS platform_settings (
      id TEXT PRIMARY KEY,
      commission_percent INTEGER NOT NULL DEFAULT 20,
      min_price_usd DOUBLE PRECISION NOT NULL DEFAULT 1.99,
      min_price_idr INTEGER NOT NULL DEFAULT 29000
    )
  `);
}
async function ensureLegacyLedgerMigrated() {
  if (!isSqlConfigured()) {
    throw new Error("Database PostgreSQL belum dihubungkan (set DATABASE_URL atau SQL_HOST).");
  }
  if (!migrationPromise) {
    migrationPromise = (async () => {
      try {
        await ensureSqlTablesExist();
        await db.insert(platformSettings).values({
          id: "global",
          commissionPercent: 20,
          minPriceUsd: 1.99,
          minPriceIdr: 29e3
        }).onConflictDoNothing();
        if (!fs.existsSync(LEGACY_LEDGER_FILE)) return;
        const raw = fs.readFileSync(LEGACY_LEDGER_FILE, "utf-8");
        const parsed = JSON.parse(raw);
        await db.transaction(async (tx) => {
          if (parsed.platformSettings) {
            await tx.insert(platformSettings).values({
              id: "global",
              commissionPercent: parsed.platformSettings.commissionPercent ?? 20,
              minPriceUsd: parsed.platformSettings.minPriceUsd ?? 1.99,
              minPriceIdr: parsed.platformSettings.minPriceIdr ?? 29e3
            }).onConflictDoNothing();
          }
          for (const w of Object.values(parsed.wallets ?? {})) {
            await tx.insert(wallets).values({
              userId: w.userId,
              balanceCredits: w.balanceCredits ?? 0,
              totalSpentCredits: w.totalSpentCredits ?? 0,
              updatedAtMs: w.updatedAtMs ?? Date.now()
            }).onConflictDoNothing();
          }
          for (const wtx of parsed.walletTransactions ?? []) {
            await tx.insert(walletTransactions).values({
              id: wtx.id,
              userId: wtx.userId,
              type: wtx.type,
              creditsDelta: wtx.creditsDelta,
              description: wtx.description,
              createdAt: wtx.createdAt
            }).onConflictDoNothing();
          }
          for (const pay of Object.values(parsed.payments ?? {})) {
            await tx.insert(payments).values({
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
              updatedAt: pay.updatedAt
            }).onConflictDoNothing();
          }
          for (const pur of parsed.purchases ?? []) {
            await tx.insert(purchases).values({
              id: pur.id,
              userId: pur.userId,
              videoId: pur.videoId,
              videoTitle: pur.videoTitle,
              method: pur.method,
              amount: pur.amount,
              currency: pur.currency,
              status: pur.status,
              createdAt: pur.createdAt
            }).onConflictDoNothing();
          }
          for (const [key, ent] of Object.entries(parsed.entitlements ?? {})) {
            await tx.insert(entitlements).values({
              compositeKey: key,
              id: ent.id,
              userId: ent.userId,
              videoId: ent.videoId,
              videoTitle: ent.videoTitle,
              thumbnailUrl: ent.thumbnailUrl ?? "",
              grantedAtMs: ent.grantedAtMs,
              expiresAtMs: ent.expiresAtMs,
              resumeSeconds: ent.resumeSeconds ?? 0,
              status: ent.status ?? "active",
              source: ent.source
            }).onConflictDoNothing();
          }
          for (const earn of parsed.creatorEarnings ?? []) {
            await tx.insert(creatorEarnings).values({
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
              createdAt: earn.createdAt
            }).onConflictDoNothing();
          }
          for (const po of parsed.payouts ?? []) {
            await tx.insert(payouts).values({
              id: po.id,
              creatorId: po.creatorId,
              creatorName: po.creatorName,
              amountUsd: po.amountUsd,
              amountIdr: po.amountIdr,
              currency: po.currency,
              method: po.method,
              destination: po.destination,
              status: po.status,
              adminNote: po.adminNote ?? "",
              createdAt: po.createdAt,
              updatedAt: po.updatedAt
            }).onConflictDoNothing();
          }
          for (const [eventKey, processedAtMs] of Object.entries(
            parsed.processedWebhooks ?? {}
          )) {
            await tx.insert(processedWebhooks).values({ eventKey, processedAtMs }).onConflictDoNothing();
          }
          for (const media of Object.values(parsed.creatorMedia ?? {})) {
            await tx.insert(creatorMedia).values({
              videoId: media.videoId,
              creatorId: media.creatorId,
              provider: media.provider,
              assetRef: media.assetRef,
              mimeType: media.mimeType ?? null,
              updatedAtIso: media.updatedAtIso
            }).onConflictDoNothing();
          }
        });
      } catch (err) {
        console.error("Legacy ledger migration warning:", err);
        migrationPromise = null;
        throw err;
      }
    })();
  }
  await migrationPromise;
}
function mapPaymentRow(row) {
  return {
    id: row.id,
    userId: row.userId,
    userEmail: row.userEmail ?? null,
    purpose: row.purpose,
    targetId: row.targetId,
    targetTitle: row.targetTitle,
    method: row.method,
    amount: row.amount,
    currency: row.currency,
    creditsDelta: row.creditsDelta,
    status: row.status,
    gatewayOrderId: row.gatewayOrderId,
    gatewayMode: row.gatewayMode,
    approvalUrl: row.approvalUrl ?? void 0,
    qrString: row.qrString ?? void 0,
    expiresAt: row.expiresAt ?? void 0,
    refundedAt: row.refundedAt ?? void 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}
function mapEntitlementRow(row) {
  return {
    id: row.id,
    userId: row.userId,
    videoId: row.videoId,
    videoTitle: row.videoTitle,
    thumbnailUrl: row.thumbnailUrl,
    grantedAtMs: row.grantedAtMs,
    expiresAtMs: row.expiresAtMs,
    resumeSeconds: row.resumeSeconds,
    status: row.status,
    source: row.source
  };
}
function mapPurchaseRow(row) {
  return {
    id: row.id,
    userId: row.userId,
    videoId: row.videoId,
    videoTitle: row.videoTitle,
    method: row.method,
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    createdAt: row.createdAt
  };
}
function mapPayoutRow(row) {
  return {
    id: row.id,
    creatorId: row.creatorId,
    creatorName: row.creatorName,
    amountUsd: row.amountUsd,
    amountIdr: row.amountIdr,
    currency: row.currency,
    method: row.method,
    destination: row.destination,
    status: row.status,
    adminNote: row.adminNote,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}
function mapEarningRow(row) {
  return {
    id: row.id,
    creatorId: row.creatorId,
    videoId: row.videoId,
    videoTitle: row.videoTitle,
    purchaseId: row.purchaseId,
    buyerUserId: row.buyerUserId,
    method: row.method,
    grossUsd: row.grossUsd,
    grossIdr: row.grossIdr,
    commissionPercent: row.commissionPercent,
    netUsd: row.netUsd,
    netIdr: row.netIdr,
    status: row.status,
    createdAt: row.createdAt
  };
}
function makeIdemKey(scope, userId, key) {
  return `${scope}:${userId}:${key}`;
}
async function upsertCreatorMediaSql(binding) {
  try {
    await ensureLegacyLedgerMigrated();
    await db.insert(creatorMedia).values({
      videoId: binding.videoId,
      creatorId: binding.creatorId,
      provider: binding.provider,
      assetRef: binding.assetRef,
      mimeType: binding.mimeType ?? null,
      updatedAtIso: binding.updatedAtIso
    }).onConflictDoUpdate({
      target: creatorMedia.videoId,
      set: {
        creatorId: binding.creatorId,
        provider: binding.provider,
        assetRef: binding.assetRef,
        mimeType: binding.mimeType ?? null,
        updatedAtIso: binding.updatedAtIso
      }
    });
  } catch (error) {
    console.error("upsertCreatorMediaSql failed:", error);
    throw new Error("Failed to persist creator media reference.", { cause: error });
  }
}
async function saveThumbnailAssetSql(input) {
  try {
    await ensureLegacyLedgerMigrated();
    await db.insert(creatorMedia).values({
      videoId: input.key,
      creatorId: input.creatorId,
      provider: "thumbnail",
      assetRef: input.base64Data,
      mimeType: input.mimeType,
      updatedAtIso: input.updatedAtIso
    }).onConflictDoUpdate({
      target: creatorMedia.videoId,
      set: {
        creatorId: input.creatorId,
        provider: "thumbnail",
        assetRef: input.base64Data,
        mimeType: input.mimeType,
        updatedAtIso: input.updatedAtIso
      }
    });
  } catch (error) {
    console.error("saveThumbnailAssetSql failed:", error);
  }
}
async function getThumbnailAssetSql(key) {
  try {
    await ensureLegacyLedgerMigrated();
    const rows = await db.select().from(creatorMedia).where(and(eq(creatorMedia.videoId, key), eq(creatorMedia.provider, "thumbnail")));
    const row = rows[0];
    if (!row || !row.assetRef) return null;
    return {
      mimeType: row.mimeType || "image/jpeg",
      base64Data: row.assetRef
    };
  } catch (error) {
    console.error("getThumbnailAssetSql failed:", error);
    return null;
  }
}
async function getStreamAuthContextSql(uid, videoId) {
  try {
    await ensureLegacyLedgerMigrated();
    const [mediaRows, entRows] = await Promise.all([
      db.select().from(creatorMedia).where(eq(creatorMedia.videoId, videoId)),
      uid ? db.select().from(entitlements).where(eq(entitlements.compositeKey, entitlementKey(uid, videoId))) : Promise.resolve([])
    ]);
    const m = mediaRows[0];
    const e = entRows[0];
    return {
      mediaBinding: m ? {
        videoId: m.videoId,
        creatorId: m.creatorId,
        provider: m.provider,
        assetRef: m.assetRef,
        mimeType: m.mimeType ?? void 0,
        updatedAtIso: m.updatedAtIso
      } : null,
      entitlement: e ? mapEntitlementRow(e) : null
    };
  } catch (error) {
    console.error("getStreamAuthContextSql failed:", error);
    throw new Error("Failed to load stream authorization state.", { cause: error });
  }
}
async function getUserEntitlementsSql(uid) {
  try {
    await ensureLegacyLedgerMigrated();
    const rows = await db.select().from(entitlements).where(eq(entitlements.userId, uid));
    return rows.map(mapEntitlementRow);
  } catch (error) {
    console.error("getUserEntitlementsSql failed:", error);
    throw new Error("Failed to load entitlements.", { cause: error });
  }
}
async function updatePlaybackProgressSql(uid, videoId, positionSeconds) {
  try {
    await ensureLegacyLedgerMigrated();
    const key = entitlementKey(uid, videoId);
    const now = Date.now();
    const safeSec = Math.max(0, Math.min(36e3, Math.floor(positionSeconds)));
    return await db.transaction(async (tx) => {
      const rows = await tx.select().from(entitlements).where(eq(entitlements.compositeKey, key));
      const existing = rows[0];
      if (!existing || existing.status === "revoked" || now >= existing.expiresAtMs) {
        return { ok: false };
      }
      await tx.update(entitlements).set({ resumeSeconds: safeSec }).where(eq(entitlements.compositeKey, key));
      return { ok: true, resumeSeconds: safeSec };
    });
  } catch (error) {
    console.error("updatePlaybackProgressSql failed:", error);
    throw new Error("Failed to save playback progress.", { cause: error });
  }
}
async function upsertTrialEntitlementSql(record) {
  try {
    await ensureLegacyLedgerMigrated();
    const key = entitlementKey(record.userId, record.videoId);
    await db.insert(entitlements).values({
      compositeKey: key,
      id: record.id,
      userId: record.userId,
      videoId: record.videoId,
      videoTitle: record.videoTitle,
      thumbnailUrl: record.thumbnailUrl,
      grantedAtMs: record.grantedAtMs,
      expiresAtMs: record.expiresAtMs,
      resumeSeconds: record.resumeSeconds,
      status: record.status ?? "active",
      source: record.source
    }).onConflictDoUpdate({
      target: entitlements.compositeKey,
      set: {
        id: record.id,
        videoTitle: record.videoTitle,
        thumbnailUrl: record.thumbnailUrl,
        grantedAtMs: record.grantedAtMs,
        expiresAtMs: record.expiresAtMs,
        resumeSeconds: record.resumeSeconds,
        status: record.status ?? "active",
        source: record.source
      }
    });
  } catch (error) {
    console.error("upsertTrialEntitlementSql failed:", error);
    throw new Error("Failed to activate preview entitlement.", { cause: error });
  }
}
async function getWalletSnapshotSql(uid) {
  try {
    await ensureLegacyLedgerMigrated();
    await db.insert(wallets).values({
      userId: uid,
      balanceCredits: 0,
      totalSpentCredits: 0,
      updatedAtMs: Date.now()
    }).onConflictDoNothing();
    const [walletRows, txRows, purchaseRows, paymentRows] = await Promise.all([
      db.select().from(wallets).where(eq(wallets.userId, uid)),
      db.select().from(walletTransactions).where(eq(walletTransactions.userId, uid)).orderBy(desc(walletTransactions.createdAt)),
      db.select().from(purchases).where(eq(purchases.userId, uid)).orderBy(desc(purchases.createdAt)),
      db.select().from(payments).where(eq(payments.userId, uid)).orderBy(desc(payments.createdAt))
    ]);
    const w = walletRows[0] ?? {
      userId: uid,
      balanceCredits: 0,
      totalSpentCredits: 0
    };
    return {
      wallet: {
        userId: w.userId,
        balanceCredits: w.balanceCredits,
        totalSpentCredits: w.totalSpentCredits
      },
      transactions: txRows.map((r) => ({
        id: r.id,
        userId: r.userId,
        type: r.type,
        creditsDelta: r.creditsDelta,
        description: r.description,
        createdAt: r.createdAt
      })),
      purchases: purchaseRows.map(mapPurchaseRow),
      payments: paymentRows.map(mapPaymentRow)
    };
  } catch (error) {
    console.error("getWalletSnapshotSql failed:", error);
    throw new Error("Failed to load wallet ledger.", { cause: error });
  }
}
async function spendCreditsAtomicSql(input) {
  try {
    await ensureLegacyLedgerMigrated();
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const fullIdemKey = input.idemKey ? makeIdemKey("wallet_spend", input.uid, input.idemKey) : null;
    return await db.transaction(async (tx) => {
      if (fullIdemKey) {
        const cached = await tx.select().from(idempotencyRecords).where(eq(idempotencyRecords.fullKey, fullIdemKey));
        if (cached[0]) {
          return { status: cached[0].status, body: cached[0].bodyJson };
        }
      }
      const entKey = entitlementKey(input.uid, input.video.id);
      const entRows = await tx.select().from(entitlements).where(eq(entitlements.compositeKey, entKey));
      const existingEnt = entRows[0];
      if (existingEnt && existingEnt.status !== "revoked" && now < existingEnt.expiresAtMs) {
        const resp = {
          status: 409,
          body: { error: "You already have an active 30-day entitlement for this title." }
        };
        if (fullIdemKey) {
          await tx.insert(idempotencyRecords).values({
            fullKey: fullIdemKey,
            status: resp.status,
            bodyJson: resp.body,
            createdAtMs: now
          }).onConflictDoNothing();
        }
        return resp;
      }
      await tx.insert(wallets).values({
        userId: input.uid,
        balanceCredits: 0,
        totalSpentCredits: 0,
        updatedAtMs: now
      }).onConflictDoNothing();
      const debitedWallets = await tx.update(wallets).set({
        balanceCredits: sql`${wallets.balanceCredits} - ${input.video.creditCost}`,
        totalSpentCredits: sql`${wallets.totalSpentCredits} + ${input.video.creditCost}`,
        updatedAtMs: now
      }).where(
        and(
          eq(wallets.userId, input.uid),
          gte(wallets.balanceCredits, input.video.creditCost)
        )
      ).returning();
      if (!debitedWallets[0]) {
        const curWallet = await tx.select().from(wallets).where(eq(wallets.userId, input.uid));
        const bal = curWallet[0]?.balanceCredits ?? 0;
        return {
          status: 400,
          body: {
            error: `Insufficient credits. Requires ${input.video.creditCost} credits, available ${bal}.`,
            requiredCredits: input.video.creditCost,
            balanceCredits: bal
          }
        };
      }
      const updatedWallet = debitedWallets[0];
      await tx.insert(walletTransactions).values({
        id: `wtx_${input.paymentId}`,
        userId: input.uid,
        type: "spend",
        creditsDelta: -input.video.creditCost,
        description: `Unlocked "${input.video.title}" (30-Day Access)`,
        createdAt: nowIso
      });
      const paymentRow = {
        id: input.paymentId,
        userId: input.uid,
        userEmail: input.userEmail,
        purpose: "video_unlock",
        targetId: input.video.id,
        targetTitle: input.video.title,
        method: "credits",
        amount: input.video.creditCost,
        currency: "CREDITS",
        creditsDelta: -input.video.creditCost,
        status: "completed",
        gatewayOrderId: input.paymentId,
        gatewayMode: "live",
        approvalUrl: null,
        qrString: null,
        expiresAt: null,
        refundedAt: null,
        createdAt: nowIso,
        updatedAt: nowIso
      };
      await tx.insert(payments).values(paymentRow);
      const safeResume = Math.max(0, Math.min(36e3, Math.floor(input.resumeSeconds)));
      const entRow = {
        compositeKey: entKey,
        id: `ent_${input.uid.slice(0, 8)}_${input.video.id}`,
        userId: input.uid,
        videoId: input.video.id,
        videoTitle: input.video.title,
        thumbnailUrl: input.video.thumbnailUrl,
        grantedAtMs: now,
        expiresAtMs: now + ACCESS_WINDOW_MS,
        resumeSeconds: safeResume,
        status: "active",
        source: "payment_verified"
      };
      await tx.insert(entitlements).values(entRow).onConflictDoUpdate({
        target: entitlements.compositeKey,
        set: {
          id: entRow.id,
          videoTitle: entRow.videoTitle,
          thumbnailUrl: entRow.thumbnailUrl,
          grantedAtMs: entRow.grantedAtMs,
          expiresAtMs: entRow.expiresAtMs,
          resumeSeconds: entRow.resumeSeconds,
          status: "active",
          source: "payment_verified"
        }
      });
      const purchaseObj = {
        id: `pur_${input.paymentId}`,
        userId: input.uid,
        videoId: input.video.id,
        videoTitle: input.video.title,
        method: "credits",
        amount: input.video.creditCost,
        currency: "CREDITS",
        status: "completed",
        createdAt: nowIso
      };
      await tx.insert(purchases).values(purchaseObj);
      const settingsRows = await tx.select().from(platformSettings).where(eq(platformSettings.id, "global"));
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
        method: "credits",
        grossUsd,
        grossIdr,
        commissionPercent: commissionPct,
        netUsd,
        netIdr,
        status: "available",
        createdAt: nowIso
      });
      const body = {
        payment: {
          ...paymentRow,
          userEmail: paymentRow.userEmail ?? null
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
          status: "active",
          source: "payment_verified",
          expiresAt: new Date(entRow.expiresAtMs).toISOString(),
          remainingDays: 30
        },
        wallet: {
          userId: updatedWallet.userId,
          balanceCredits: updatedWallet.balanceCredits,
          totalSpentCredits: updatedWallet.totalSpentCredits
        }
      };
      if (fullIdemKey) {
        await tx.insert(idempotencyRecords).values({
          fullKey: fullIdemKey,
          status: 200,
          bodyJson: body,
          createdAtMs: now
        }).onConflictDoNothing();
      }
      return { status: 200, body };
    });
  } catch (error) {
    console.error("spendCreditsAtomicSql failed:", error);
    throw new Error("Failed to complete credit wallet transaction.", { cause: error });
  }
}
async function precheckCreateOrderSql(input) {
  try {
    await ensureLegacyLedgerMigrated();
    const now = Date.now();
    const fullIdemKey = input.idemKey ? makeIdemKey(input.scope, input.uid, input.idemKey) : null;
    return await db.transaction(async (tx) => {
      if (fullIdemKey) {
        const cached = await tx.select().from(idempotencyRecords).where(eq(idempotencyRecords.fullKey, fullIdemKey));
        if (cached[0]) {
          return { status: cached[0].status, body: cached[0].bodyJson };
        }
      }
      if (input.purpose === "video_unlock") {
        const entRows = await tx.select().from(entitlements).where(eq(entitlements.compositeKey, entitlementKey(input.uid, input.targetId)));
        const ent = entRows[0];
        if (ent && ent.status !== "revoked" && now < ent.expiresAtMs) {
          const resp = {
            status: 409,
            body: { error: "This release is already unlocked for your account." }
          };
          if (fullIdemKey) {
            await tx.insert(idempotencyRecords).values({
              fullKey: fullIdemKey,
              status: resp.status,
              bodyJson: resp.body,
              createdAtMs: now
            }).onConflictDoNothing();
          }
          return resp;
        }
      }
      return null;
    });
  } catch (error) {
    console.error("precheckCreateOrderSql failed:", error);
    throw new Error("Failed to validate checkout state.", { cause: error });
  }
}
async function savePendingPaymentOrderSql(input) {
  try {
    await ensureLegacyLedgerMigrated();
    const now = Date.now();
    const fullIdemKey = input.idemKey ? makeIdemKey(input.scope, input.uid, input.idemKey) : null;
    return await db.transaction(async (tx) => {
      if (fullIdemKey) {
        const cached = await tx.select().from(idempotencyRecords).where(eq(idempotencyRecords.fullKey, fullIdemKey));
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
        updatedAt: input.order.updatedAt
      });
      if (fullIdemKey) {
        await tx.insert(idempotencyRecords).values({
          fullKey: fullIdemKey,
          status: 200,
          bodyJson: input.responseBody,
          createdAtMs: now
        }).onConflictDoNothing();
      }
      return { status: 200, body: input.responseBody };
    });
  } catch (error) {
    console.error("savePendingPaymentOrderSql failed:", error);
    throw new Error("Failed to store payment order.", { cause: error });
  }
}
async function checkIdempotencySql(scope, uid, idemKey) {
  if (!idemKey) return null;
  try {
    await ensureLegacyLedgerMigrated();
    const rows = await db.select().from(idempotencyRecords).where(eq(idempotencyRecords.fullKey, makeIdemKey(scope, uid, idemKey)));
    return rows[0] ? { status: rows[0].status, body: rows[0].bodyJson } : null;
  } catch (error) {
    console.error("checkIdempotencySql failed:", error);
    throw new Error("Failed to check idempotency key.", { cause: error });
  }
}
async function getPaymentByIdSql(paymentId) {
  try {
    await ensureLegacyLedgerMigrated();
    const rows = await db.select().from(payments).where(eq(payments.id, paymentId));
    return rows[0] ? mapPaymentRow(rows[0]) : null;
  } catch (error) {
    console.error("getPaymentByIdSql failed:", error);
    throw new Error("Failed to look up payment record.", { cause: error });
  }
}
async function getPaymentStatusSnapshotSql(paymentId, uid) {
  try {
    await ensureLegacyLedgerMigrated();
    const payRows = await db.select().from(payments).where(eq(payments.id, paymentId));
    const payRow = payRows[0];
    if (!payRow || payRow.userId !== uid) return null;
    await db.insert(wallets).values({
      userId: uid,
      balanceCredits: 0,
      totalSpentCredits: 0,
      updatedAtMs: Date.now()
    }).onConflictDoNothing();
    const [walletRows, entRows] = await Promise.all([
      db.select().from(wallets).where(eq(wallets.userId, uid)),
      payRow.purpose === "video_unlock" ? db.select().from(entitlements).where(eq(entitlements.compositeKey, entitlementKey(uid, payRow.targetId))) : Promise.resolve([])
    ]);
    const w = walletRows[0] ?? {
      userId: uid,
      balanceCredits: 0,
      totalSpentCredits: 0
    };
    const ent = entRows[0] ? mapEntitlementRow(entRows[0]) : null;
    return {
      payment: mapPaymentRow(payRow),
      wallet: {
        userId: w.userId,
        balanceCredits: w.balanceCredits,
        totalSpentCredits: w.totalSpentCredits
      },
      entitlement: ent ? {
        ...ent,
        expiresAt: new Date(ent.expiresAtMs).toISOString(),
        remainingDays: Math.max(
          0,
          Math.ceil((ent.expiresAtMs - Date.now()) / (24 * 60 * 60 * 1e3))
        )
      } : null
    };
  } catch (error) {
    console.error("getPaymentStatusSnapshotSql failed:", error);
    throw new Error("Failed to load payment status.", { cause: error });
  }
}
async function findPaymentForWebhookSql(targetPaymentId, gatewayOrderId) {
  try {
    await ensureLegacyLedgerMigrated();
    if (targetPaymentId) {
      const byId = await db.select().from(payments).where(eq(payments.id, targetPaymentId));
      if (byId[0]) return mapPaymentRow(byId[0]);
    }
    if (gatewayOrderId) {
      const byGw = await db.select().from(payments).where(eq(payments.gatewayOrderId, gatewayOrderId));
      if (byGw[0]) return mapPaymentRow(byGw[0]);
    }
    return null;
  } catch (error) {
    console.error("findPaymentForWebhookSql failed:", error);
    throw new Error("Failed to query payment for webhook.", { cause: error });
  }
}
async function isWebhookProcessedSql(eventKey) {
  try {
    await ensureLegacyLedgerMigrated();
    const rows = await db.select().from(processedWebhooks).where(eq(processedWebhooks.eventKey, eventKey));
    return Boolean(rows[0]);
  } catch (error) {
    console.error("isWebhookProcessedSql failed:", error);
    throw new Error("Failed to check webhook status.", { cause: error });
  }
}
async function fulfillPaymentAtomicSql(input) {
  try {
    await ensureLegacyLedgerMigrated();
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const fullIdemKey = input.idemKey && input.idemScope && input.idemUid ? makeIdemKey(input.idemScope, input.idemUid, input.idemKey) : null;
    return await db.transaction(async (tx) => {
      if (input.webhookEventKey) {
        const existingHook = await tx.select().from(processedWebhooks).where(eq(processedWebhooks.eventKey, input.webhookEventKey));
        if (existingHook[0]) {
          return { duplicateWebhook: true };
        }
      }
      const existingRows = await tx.select().from(payments).where(eq(payments.id, input.paymentId));
      const existingPay = existingRows[0];
      if (!existingPay) {
        if (input.webhookEventKey) {
          await tx.insert(processedWebhooks).values({ eventKey: input.webhookEventKey, processedAtMs: now }).onConflictDoNothing();
        }
        return { notFound: true };
      }
      if (existingPay.status !== "pending" && existingPay.status !== "completed") {
        return { invalidStatus: existingPay.status };
      }
      await tx.insert(wallets).values({
        userId: existingPay.userId,
        balanceCredits: 0,
        totalSpentCredits: 0,
        updatedAtMs: now
      }).onConflictDoNothing();
      const transitioned = existingPay.status === "pending" ? await tx.update(payments).set({ status: "completed", updatedAt: nowIso }).where(and(eq(payments.id, input.paymentId), eq(payments.status, "pending"))).returning() : [];
      if (!transitioned[0]) {
        const latestRows = await tx.select().from(payments).where(eq(payments.id, input.paymentId));
        const latestPay = latestRows[0] ?? existingPay;
        if (latestPay.status !== "completed") {
          return { invalidStatus: latestPay.status };
        }
        const [walletRows, purRows, entRows] = await Promise.all([
          tx.select().from(wallets).where(eq(wallets.userId, latestPay.userId)),
          tx.select().from(purchases).where(eq(purchases.id, `pur_${latestPay.id}`)),
          latestPay.purpose === "video_unlock" ? tx.select().from(entitlements).where(
            eq(
              entitlements.compositeKey,
              entitlementKey(latestPay.userId, latestPay.targetId)
            )
          ) : Promise.resolve([])
        ]);
        const w2 = walletRows[0];
        const ent = entRows[0] ? mapEntitlementRow(entRows[0]) : null;
        if (input.webhookEventKey) {
          await tx.insert(processedWebhooks).values({ eventKey: input.webhookEventKey, processedAtMs: now }).onConflictDoNothing();
        }
        return {
          payment: mapPaymentRow(latestPay),
          purchase: purRows[0] ? mapPurchaseRow(purRows[0]) : null,
          entitlement: ent ? {
            ...ent,
            expiresAt: new Date(ent.expiresAtMs).toISOString(),
            remainingDays: 30
          } : null,
          wallet: {
            userId: latestPay.userId,
            balanceCredits: w2?.balanceCredits ?? 0,
            totalSpentCredits: w2?.totalSpentCredits ?? 0
          }
        };
      }
      const settledPay = mapPaymentRow(transitioned[0]);
      if (settledPay.purpose === "credit_topup") {
        const creditsToAdd = Math.max(0, Math.round(settledPay.creditsDelta));
        const updatedWallets = await tx.update(wallets).set({
          balanceCredits: sql`${wallets.balanceCredits} + ${creditsToAdd}`,
          updatedAtMs: now
        }).where(eq(wallets.userId, settledPay.userId)).returning();
        const w2 = updatedWallets[0];
        await tx.insert(walletTransactions).values({
          id: `wtx_${settledPay.id}`,
          userId: settledPay.userId,
          type: "topup",
          creditsDelta: creditsToAdd,
          description: `Top-up ${settledPay.targetTitle} via ${settledPay.method.toUpperCase()}`,
          createdAt: nowIso
        }).onConflictDoNothing();
        const purObj2 = {
          id: `pur_${settledPay.id}`,
          userId: settledPay.userId,
          videoId: settledPay.targetId,
          videoTitle: `${settledPay.targetTitle} (${creditsToAdd} Credits)`,
          method: settledPay.method,
          amount: settledPay.amount,
          currency: settledPay.currency,
          status: "completed",
          createdAt: nowIso
        };
        await tx.insert(purchases).values(purObj2).onConflictDoNothing();
        const body2 = {
          payment: settledPay,
          purchase: purObj2,
          entitlement: null,
          wallet: {
            userId: w2.userId,
            balanceCredits: w2.balanceCredits,
            totalSpentCredits: w2.totalSpentCredits
          }
        };
        if (fullIdemKey) {
          await tx.insert(idempotencyRecords).values({
            fullKey: fullIdemKey,
            status: 200,
            bodyJson: body2,
            createdAtMs: now
          }).onConflictDoNothing();
        }
        if (input.webhookEventKey) {
          await tx.insert(processedWebhooks).values({ eventKey: input.webhookEventKey, processedAtMs: now }).onConflictDoNothing();
        }
        return body2;
      }
      const video = input.videoEntry ?? SERVER_CATALOG[settledPay.targetId] ?? null;
      const entKey = entitlementKey(settledPay.userId, settledPay.targetId);
      const prevEntRows = await tx.select().from(entitlements).where(eq(entitlements.compositeKey, entKey));
      const safeResume = typeof input.resumeSeconds === "number" ? Math.max(0, Math.min(36e3, Math.floor(input.resumeSeconds))) : prevEntRows[0]?.resumeSeconds ?? 0;
      const entRecord = {
        id: `ent_${settledPay.userId.slice(0, 8)}_${settledPay.targetId}`,
        userId: settledPay.userId,
        videoId: settledPay.targetId,
        videoTitle: video?.title || settledPay.targetTitle,
        thumbnailUrl: video?.thumbnailUrl || "",
        grantedAtMs: now,
        expiresAtMs: now + ACCESS_WINDOW_MS,
        resumeSeconds: safeResume,
        status: "active",
        source: "payment_verified"
      };
      await tx.insert(entitlements).values({
        compositeKey: entKey,
        ...entRecord,
        status: "active"
      }).onConflictDoUpdate({
        target: entitlements.compositeKey,
        set: {
          id: entRecord.id,
          videoTitle: entRecord.videoTitle,
          thumbnailUrl: entRecord.thumbnailUrl,
          grantedAtMs: entRecord.grantedAtMs,
          expiresAtMs: entRecord.expiresAtMs,
          resumeSeconds: entRecord.resumeSeconds,
          status: "active",
          source: "payment_verified"
        }
      });
      const purObj = {
        id: `pur_${settledPay.id}`,
        userId: settledPay.userId,
        videoId: settledPay.targetId,
        videoTitle: entRecord.videoTitle,
        method: settledPay.method,
        amount: settledPay.amount,
        currency: settledPay.currency,
        status: "completed",
        createdAt: nowIso
      };
      await tx.insert(purchases).values(purObj).onConflictDoNothing();
      if (video) {
        const settingsRows = await tx.select().from(platformSettings).where(eq(platformSettings.id, "global"));
        const commissionPct = settingsRows[0]?.commissionPercent ?? 20;
        const grossUsd = settledPay.currency === "USD" ? settledPay.amount : video.priceUsd;
        const grossIdr = settledPay.currency === "IDR" ? settledPay.amount : video.priceIdr;
        const netUsd = Number((grossUsd * (1 - commissionPct / 100)).toFixed(2));
        const netIdr = Math.round(grossIdr * (1 - commissionPct / 100));
        await tx.insert(creatorEarnings).values({
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
          status: "available",
          createdAt: nowIso
        }).onConflictDoNothing();
      }
      const wRows = await tx.select().from(wallets).where(eq(wallets.userId, settledPay.userId));
      const w = wRows[0];
      const body = {
        payment: settledPay,
        purchase: purObj,
        entitlement: {
          ...entRecord,
          expiresAt: new Date(entRecord.expiresAtMs).toISOString(),
          remainingDays: 30
        },
        wallet: {
          userId: settledPay.userId,
          balanceCredits: w?.balanceCredits ?? 0,
          totalSpentCredits: w?.totalSpentCredits ?? 0
        }
      };
      if (fullIdemKey) {
        await tx.insert(idempotencyRecords).values({
          fullKey: fullIdemKey,
          status: 200,
          bodyJson: body,
          createdAtMs: now
        }).onConflictDoNothing();
      }
      if (input.webhookEventKey) {
        await tx.insert(processedWebhooks).values({ eventKey: input.webhookEventKey, processedAtMs: now }).onConflictDoNothing();
      }
      return body;
    });
  } catch (error) {
    console.error("fulfillPaymentAtomicSql failed:", error);
    throw new Error("Failed to fulfill verified payment.", { cause: error });
  }
}
async function recordWebhookOnlyOrFailureSql(input) {
  try {
    await ensureLegacyLedgerMigrated();
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    return await db.transaction(async (tx) => {
      const hookRows = await tx.select().from(processedWebhooks).where(eq(processedWebhooks.eventKey, input.webhookEventKey));
      if (hookRows[0]) {
        return { duplicate: true };
      }
      let currentStatus;
      if (input.paymentId) {
        const payRows = await tx.select().from(payments).where(eq(payments.id, input.paymentId));
        if (!payRows[0]) {
          return { duplicate: false, notFound: true };
        }
        currentStatus = payRows[0].status;
        if (input.nextStatus && payRows[0].status === "pending") {
          await tx.update(payments).set({ status: input.nextStatus, updatedAt: nowIso }).where(and(eq(payments.id, input.paymentId), eq(payments.status, "pending")));
          currentStatus = input.nextStatus;
        }
      }
      await tx.insert(processedWebhooks).values({ eventKey: input.webhookEventKey, processedAtMs: now }).onConflictDoNothing();
      return { duplicate: false, status: currentStatus };
    });
  } catch (error) {
    console.error("recordWebhookOnlyOrFailureSql failed:", error);
    throw new Error("Failed to record webhook status.", { cause: error });
  }
}
function computeCreatorEarningsSummaryFromRows(commissionPercent, earningRows, payoutRows) {
  const availableRows = earningRows.filter((e) => e.status === "available");
  const grossUsd = Number(availableRows.reduce((s, e) => s + e.grossUsd, 0).toFixed(2));
  const grossIdr = Math.round(availableRows.reduce((s, e) => s + e.grossIdr, 0));
  const netUsd = Number(availableRows.reduce((s, e) => s + e.netUsd, 0).toFixed(2));
  const netIdr = Math.round(availableRows.reduce((s, e) => s + e.netIdr, 0));
  const committedPayouts = payoutRows.filter((p) => p.status !== "rejected");
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
    payouts: payoutRows
  };
}
async function getCreatorEarningsSummarySql(creatorId) {
  try {
    await ensureLegacyLedgerMigrated();
    const [settingsRows, earnRows, payoutRows] = await Promise.all([
      db.select().from(platformSettings).where(eq(platformSettings.id, "global")),
      db.select().from(creatorEarnings).where(eq(creatorEarnings.creatorId, creatorId)).orderBy(desc(creatorEarnings.createdAt)),
      db.select().from(payouts).where(eq(payouts.creatorId, creatorId)).orderBy(desc(payouts.createdAt))
    ]);
    const commissionPercent = settingsRows[0]?.commissionPercent ?? 20;
    return computeCreatorEarningsSummaryFromRows(
      commissionPercent,
      earnRows.map(mapEarningRow),
      payoutRows.map(mapPayoutRow)
    );
  } catch (error) {
    console.error("getCreatorEarningsSummarySql failed:", error);
    throw new Error("Failed to load creator earnings summary.", { cause: error });
  }
}
async function requestCreatorPayoutAtomicSql(input) {
  try {
    await ensureLegacyLedgerMigrated();
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const fullIdemKey = input.idemKey ? makeIdemKey("creator_payout", input.uid, input.idemKey) : null;
    return await db.transaction(async (tx) => {
      if (fullIdemKey) {
        const cached = await tx.select().from(idempotencyRecords).where(eq(idempotencyRecords.fullKey, fullIdemKey));
        if (cached[0]) {
          return { status: cached[0].status, body: cached[0].bodyJson };
        }
      }
      const [settingsRows, earnRows, payoutRows] = await Promise.all([
        tx.select().from(platformSettings).where(eq(platformSettings.id, "global")),
        tx.select().from(creatorEarnings).where(eq(creatorEarnings.creatorId, input.uid)).orderBy(desc(creatorEarnings.createdAt)),
        tx.select().from(payouts).where(eq(payouts.creatorId, input.uid)).orderBy(desc(payouts.createdAt))
      ]);
      const commissionPercent = settingsRows[0]?.commissionPercent ?? 20;
      const mappedEarnings = earnRows.map(mapEarningRow);
      const mappedPayouts = payoutRows.map(mapPayoutRow);
      const summary = computeCreatorEarningsSummaryFromRows(
        commissionPercent,
        mappedEarnings,
        mappedPayouts
      );
      if (input.currency === "USD" && input.amount > summary.availableUsd + 1e-3) {
        return {
          status: 400,
          body: {
            error: `Requested $${input.amount.toFixed(
              2
            )} exceeds available USD balance ($${summary.availableUsd.toFixed(2)}).`
          }
        };
      }
      if (input.currency === "IDR" && input.amount > summary.availableIdr) {
        return {
          status: 400,
          body: {
            error: `Requested Rp ${input.amount} exceeds available IDR balance (Rp ${summary.availableIdr}).`
          }
        };
      }
      const payoutRecord = {
        id: input.payoutId,
        creatorId: input.uid,
        creatorName: input.creatorName,
        amountUsd: input.currency === "USD" ? Number(input.amount.toFixed(2)) : 0,
        amountIdr: input.currency === "IDR" ? Math.round(input.amount) : 0,
        currency: input.currency,
        method: input.method,
        destination: input.destination,
        status: "requested",
        adminNote: "",
        createdAt: nowIso,
        updatedAt: nowIso
      };
      await tx.insert(payouts).values(payoutRecord);
      const updatedSummary = computeCreatorEarningsSummaryFromRows(
        commissionPercent,
        mappedEarnings,
        [payoutRecord, ...mappedPayouts]
      );
      const body = { payout: payoutRecord, summary: updatedSummary };
      if (fullIdemKey) {
        await tx.insert(idempotencyRecords).values({
          fullKey: fullIdemKey,
          status: 200,
          bodyJson: body,
          createdAtMs: now
        }).onConflictDoNothing();
      }
      return { status: 200, body };
    });
  } catch (error) {
    console.error("requestCreatorPayoutAtomicSql failed:", error);
    throw new Error("Failed to submit payout request.", { cause: error });
  }
}
async function computeAdminOverviewFromDb(executor) {
  const now = Date.now();
  const [settingsRows, paymentRows, purchaseRows, payoutRows, earningRows, entRows] = await Promise.all([
    executor.select().from(platformSettings).where(eq(platformSettings.id, "global")),
    executor.select().from(payments).orderBy(desc(payments.createdAt)),
    executor.select().from(purchases).orderBy(desc(purchases.createdAt)),
    executor.select().from(payouts).orderBy(desc(payouts.createdAt)),
    executor.select().from(creatorEarnings),
    executor.select().from(entitlements)
  ]);
  const commissionPercent = settingsRows[0]?.commissionPercent ?? 20;
  const completedPayments = paymentRows.filter((p) => p.status === "completed");
  const totalGrossUsd = Number(
    completedPayments.filter((p) => p.currency === "USD").reduce((s, p) => s + p.amount, 0).toFixed(2)
  );
  const totalGrossIdr = Math.round(
    completedPayments.filter((p) => p.currency === "IDR").reduce((s, p) => s + p.amount, 0)
  );
  const validEarnings = earningRows.filter((e) => e.status === "available");
  const platformCommissionUsd = Number(
    validEarnings.reduce((s, e) => s + (e.grossUsd - e.netUsd), 0).toFixed(2)
  );
  const platformCommissionIdr = Math.round(
    validEarnings.reduce((s, e) => s + (e.grossIdr - e.netIdr), 0)
  );
  const activeEntitlementsCount = entRows.filter(
    (e) => e.status !== "revoked" && now < e.expiresAtMs
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
    activeEntitlementsCount
  };
}
async function getAdminFinanceOverviewSql() {
  try {
    await ensureLegacyLedgerMigrated();
    return await computeAdminOverviewFromDb(db);
  } catch (error) {
    console.error("getAdminFinanceOverviewSql failed:", error);
    throw new Error("Failed to load admin finance overview.", { cause: error });
  }
}
async function refundPaymentAtomicSql(input) {
  try {
    await ensureLegacyLedgerMigrated();
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const fullIdemKey = input.idemKey ? makeIdemKey("admin_refund", input.adminUid, input.idemKey) : null;
    return await db.transaction(async (tx) => {
      if (fullIdemKey) {
        const cached = await tx.select().from(idempotencyRecords).where(eq(idempotencyRecords.fullKey, fullIdemKey));
        if (cached[0]) {
          return { status: cached[0].status, body: cached[0].bodyJson };
        }
      }
      const payRows = await tx.select().from(payments).where(eq(payments.id, input.paymentId));
      const payment = payRows[0];
      if (!payment) {
        return { status: 404, body: { error: "Payment transaction not found." } };
      }
      if (payment.status !== "completed") {
        return {
          status: 400,
          body: { error: `Cannot refund payment in status "${payment.status}".` }
        };
      }
      const updatedPayments = await tx.update(payments).set({ status: "refunded", refundedAt: nowIso, updatedAt: nowIso }).where(and(eq(payments.id, input.paymentId), eq(payments.status, "completed"))).returning();
      if (!updatedPayments[0]) {
        return { status: 409, body: { error: "Payment was already refunded." } };
      }
      await tx.update(purchases).set({ status: "refunded" }).where(eq(purchases.id, `pur_${input.paymentId}`));
      if (payment.purpose === "video_unlock") {
        await tx.update(entitlements).set({ status: "revoked", expiresAtMs: now }).where(
          eq(
            entitlements.compositeKey,
            entitlementKey(payment.userId, payment.targetId)
          )
        );
        await tx.update(creatorEarnings).set({ status: "reversed" }).where(eq(creatorEarnings.id, `earn_${input.paymentId}`));
        if (payment.method === "credits") {
          const refundCredits = Math.abs(payment.creditsDelta);
          await tx.insert(wallets).values({
            userId: payment.userId,
            balanceCredits: 0,
            totalSpentCredits: 0,
            updatedAtMs: now
          }).onConflictDoNothing();
          await tx.update(wallets).set({
            balanceCredits: sql`${wallets.balanceCredits} + ${refundCredits}`,
            updatedAtMs: now
          }).where(eq(wallets.userId, payment.userId));
          await tx.insert(walletTransactions).values({
            id: `wtx_ref_${input.paymentId}`,
            userId: payment.userId,
            type: "refund",
            creditsDelta: refundCredits,
            description: `Refund for "${payment.targetTitle}"`,
            createdAt: nowIso
          });
        }
      } else if (payment.purpose === "credit_topup") {
        const wRows = await tx.select().from(wallets).where(eq(wallets.userId, payment.userId));
        const curBal = wRows[0]?.balanceCredits ?? 0;
        const deduct = Math.min(curBal, Math.max(0, payment.creditsDelta));
        if (deduct > 0) {
          await tx.update(wallets).set({
            balanceCredits: sql`GREATEST(0, ${wallets.balanceCredits} - ${deduct})`,
            updatedAtMs: now
          }).where(eq(wallets.userId, payment.userId));
        }
        await tx.insert(walletTransactions).values({
          id: `wtx_ref_${input.paymentId}`,
          userId: payment.userId,
          type: "refund",
          creditsDelta: -deduct,
          description: `Top-up refunded (${payment.targetTitle})`,
          createdAt: nowIso
        });
      }
      const overview = await computeAdminOverviewFromDb(tx);
      const body = {
        ok: true,
        payment: mapPaymentRow(updatedPayments[0]),
        overview
      };
      if (fullIdemKey) {
        await tx.insert(idempotencyRecords).values({
          fullKey: fullIdemKey,
          status: 200,
          bodyJson: body,
          createdAtMs: now
        }).onConflictDoNothing();
      }
      return { status: 200, body };
    });
  } catch (error) {
    console.error("refundPaymentAtomicSql failed:", error);
    throw new Error("Failed to process refund.", { cause: error });
  }
}
async function updatePayoutStatusSql(input) {
  try {
    await ensureLegacyLedgerMigrated();
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    return await db.transaction(async (tx) => {
      const existing = await tx.select().from(payouts).where(eq(payouts.id, input.payoutId));
      if (!existing[0]) {
        return { status: 404, body: { error: "Payout request not found." } };
      }
      const nextNote = typeof input.adminNote === "string" ? input.adminNote.trim().slice(0, 240) : existing[0].adminNote;
      const updated = await tx.update(payouts).set({
        status: input.status,
        adminNote: nextNote,
        updatedAt: nowIso
      }).where(eq(payouts.id, input.payoutId)).returning();
      const overview = await computeAdminOverviewFromDb(tx);
      return {
        status: 200,
        body: {
          payout: mapPayoutRow(updated[0]),
          overview
        }
      };
    });
  } catch (error) {
    console.error("updatePayoutStatusSql failed:", error);
    throw new Error("Failed to update payout status.", { cause: error });
  }
}
async function updatePlatformSettingsSql(input) {
  try {
    await ensureLegacyLedgerMigrated();
    const existing = await db.select().from(platformSettings).where(eq(platformSettings.id, "global"));
    const cur = existing[0] ?? {
      commissionPercent: 20,
      minPriceUsd: 1.99,
      minPriceIdr: 29e3
    };
    const nextCommission = Math.round(input.commissionPercent);
    const nextMinUsd = typeof input.minPriceUsd === "number" && input.minPriceUsd >= 0.99 ? Number(input.minPriceUsd.toFixed(2)) : cur.minPriceUsd;
    const nextMinIdr = typeof input.minPriceIdr === "number" && input.minPriceIdr >= 1e4 ? Math.round(input.minPriceIdr) : cur.minPriceIdr;
    await db.insert(platformSettings).values({
      id: "global",
      commissionPercent: nextCommission,
      minPriceUsd: nextMinUsd,
      minPriceIdr: nextMinIdr
    }).onConflictDoUpdate({
      target: platformSettings.id,
      set: {
        commissionPercent: nextCommission,
        minPriceUsd: nextMinUsd,
        minPriceIdr: nextMinIdr
      }
    });
  } catch (error) {
    console.error("updatePlatformSettingsSql failed:", error);
    throw new Error("Failed to save platform settings.", { cause: error });
  }
}

// src/db/users.ts
async function getOrCreateSqlUser(uid, email) {
  try {
    const safeEmail = (email || "").slice(0, 160);
    const result = await db.insert(users).values({
      uid,
      email: safeEmail
    }).onConflictDoUpdate({
      target: users.uid,
      set: {
        email: safeEmail
      }
    }).returning();
    return result[0];
  } catch (error) {
    console.error("Failed to upsert SQL user:", error);
    throw new Error("Failed to synchronize user account.", { cause: error });
  }
}

// server/cloudflareStream.ts
import crypto2 from "node:crypto";
function isCloudflareStreamConfigured() {
  const accountId = process.env.CLOUDFLARE_STREAM_ACCOUNT_ID?.trim() || "";
  const apiToken = process.env.CLOUDFLARE_STREAM_API_TOKEN?.trim() || "";
  return accountId.length >= 8 && apiToken.length >= 10;
}
function isCloudflareSigningConfigured() {
  const keyId = process.env.CLOUDFLARE_STREAM_SIGNING_KEY_ID?.trim() || "";
  const privKey = process.env.CLOUDFLARE_STREAM_SIGNING_PRIVATE_KEY?.trim() || "";
  return keyId.length >= 6 && privKey.length >= 20;
}
function getAccountAndToken() {
  const accountId = process.env.CLOUDFLARE_STREAM_ACCOUNT_ID?.trim() || "";
  const apiToken = process.env.CLOUDFLARE_STREAM_API_TOKEN?.trim() || "";
  if (!accountId || !apiToken) {
    throw new Error(
      "Cloudflare Stream credentials are not configured on the server."
    );
  }
  return { accountId, apiToken };
}
function parseCloudflarePrivateKey(rawInput) {
  const trimmed = rawInput.trim().replace(/\\n/g, "\n");
  if (trimmed.startsWith("-----BEGIN")) {
    return crypto2.createPrivateKey({ key: trimmed, format: "pem" });
  }
  if (trimmed.startsWith("{")) {
    const jwk = JSON.parse(trimmed);
    return crypto2.createPrivateKey({ key: jwk, format: "jwk" });
  }
  const decoded = Buffer.from(trimmed, "base64").toString("utf-8").trim();
  if (decoded.startsWith("-----BEGIN")) {
    return crypto2.createPrivateKey({ key: decoded, format: "pem" });
  }
  if (decoded.startsWith("{")) {
    const jwk = JSON.parse(decoded);
    return crypto2.createPrivateKey({ key: jwk, format: "jwk" });
  }
  throw new Error("Unsupported CLOUDFLARE_STREAM_SIGNING_PRIVATE_KEY format.");
}
function encodeBase64UrlJson(obj) {
  return Buffer.from(JSON.stringify(obj), "utf-8").toString("base64url");
}
function signCloudflareStreamToken(videoUid, options) {
  if (!isCloudflareSigningConfigured()) return null;
  const keyId = process.env.CLOUDFLARE_STREAM_SIGNING_KEY_ID.trim();
  const rawPrivateKey = process.env.CLOUDFLARE_STREAM_SIGNING_PRIVATE_KEY;
  const privateKey = parseCloudflarePrivateKey(rawPrivateKey);
  const nowSec = Math.floor(Date.now() / 1e3);
  const expSec = nowSec + Math.max(60, Math.min(86400, Math.round(options.ttlSeconds)));
  const header = encodeBase64UrlJson({ alg: "RS256", kid: keyId, typ: "JWT" });
  const payload = encodeBase64UrlJson({
    sub: videoUid,
    kid: keyId,
    exp: expSec,
    nbf: nowSec - 15,
    downloadable: false,
    accessRules: [{ type: "any", action: "allow" }]
  });
  const signingInput = `${header}.${payload}`;
  const signature = crypto2.sign("RSA-SHA256", Buffer.from(signingInput, "utf-8"), privateKey).toString("base64url");
  return `${signingInput}.${signature}`;
}
function buildCloudflareHlsUrl(uidOrSignedToken) {
  const rawSubdomain = (process.env.CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN || "").trim();
  const cleanSubdomain = rawSubdomain.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (cleanSubdomain && /^[a-zA-Z0-9.-]+$/.test(cleanSubdomain)) {
    const host = cleanSubdomain.includes(".") ? cleanSubdomain : `${cleanSubdomain}.cloudflarestream.com`;
    return `https://${host}/${encodeURIComponent(uidOrSignedToken)}/manifest/video.m3u8`;
  }
  return `https://videodelivery.net/${encodeURIComponent(uidOrSignedToken)}/manifest/video.m3u8`;
}
function encodeTusMetaValue(value) {
  return Buffer.from(value, "utf-8").toString("base64");
}
async function createCloudflareTusDirectUpload(input) {
  const { accountId, apiToken } = getAccountAndToken();
  const safeDuration = Math.max(
    60,
    Math.min(21600, Math.round(input.maxDurationSeconds ?? 21600))
  );
  const requiresSignedUrls = isCloudflareSigningConfigured();
  const safeName = (input.filename || "vyora-release").replace(/[^\w.\- ]/g, "_").slice(0, 120);
  const metaParts = [
    `name ${encodeTusMetaValue(safeName)}`,
    `maxdurationseconds ${encodeTusMetaValue(String(safeDuration))}`
  ];
  if (requiresSignedUrls) {
    metaParts.push("requiresignedurls");
  }
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
    accountId
  )}/stream?direct_user=true`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Tus-Resumable": "1.0.0",
      "Upload-Length": String(Math.round(input.uploadLength)),
      "Upload-Creator": input.creatorId.slice(0, 64),
      "Upload-Metadata": metaParts.join(",")
    }
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(
      `Cloudflare Stream Direct Upload failed (${res.status}): ${errText.slice(0, 200)}`
    );
  }
  const uploadUrl = res.headers.get("location") || "";
  const uid = res.headers.get("stream-media-id") || "";
  if (!uploadUrl || !uid) {
    throw new Error(
      "Cloudflare Stream response missing TUS upload Location or stream-media-id."
    );
  }
  return {
    uid,
    uploadUrl,
    requiresSignedUrls
  };
}
async function getCloudflareVideoStatus(uid) {
  const { accountId, apiToken } = getAccountAndToken();
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
    accountId
  )}/stream/${encodeURIComponent(uid)}`;
  const res = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${apiToken}`
    }
  });
  if (!res.ok) {
    throw new Error(`Unable to fetch Cloudflare Stream video status (${res.status}).`);
  }
  const data = await res.json();
  const result = data.result;
  return {
    uid: result?.uid || uid,
    readyToStream: Boolean(result?.readyToStream),
    state: result?.status?.state || "queued",
    pctComplete: Number(result?.status?.pctComplete ?? 0),
    durationSeconds: Number(result?.duration ?? 0),
    thumbnailUrl: result?.thumbnail
  };
}

// firebase-applet-config.json
var firebase_applet_config_default = {
  projectId: "yttriferous-bastion-ngtt6",
  appId: "1:621901173577:web:98e7b6fe05126414104098",
  apiKey: "AIzaSyA1JGFW57HPUsFgeDdpKGpNQt6-ad-Ubck",
  authDomain: "yttriferous-bastion-ngtt6.firebaseapp.com",
  firestoreDatabaseId: "ai-studio-vyora-43c45f27-10b7-475d-a607-c73b1a69a858",
  storageBucket: "yttriferous-bastion-ngtt6.firebasestorage.app",
  messagingSenderId: "621901173577",
  measurementId: "",
  oAuthClientId: "621901173577-i90eh24hnuuuhi34q0leeavvdl1kb7ci.apps.googleusercontent.com",
  recaptchaSiteKey: ""
};

// src/utils/youtube.ts
var YOUTUBE_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;
var ALLOWED_YOUTUBE_HOSTS = /* @__PURE__ */ new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com"
]);
function extractYouTubeVideoId(rawInput) {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;
  const withoutPrefix = trimmed.startsWith("youtube:") ? trimmed.slice("youtube:".length).trim() : trimmed;
  if (YOUTUBE_ID_REGEX.test(withoutPrefix)) {
    return withoutPrefix;
  }
  let parsed;
  try {
    const withScheme = withoutPrefix.startsWith("http://") || withoutPrefix.startsWith("https://") ? withoutPrefix : `https://${withoutPrefix}`;
    parsed = new URL(withScheme);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (!ALLOWED_YOUTUBE_HOSTS.has(host)) {
    return null;
  }
  let candidate = null;
  if (host === "youtu.be" || host === "www.youtu.be") {
    const seg = parsed.pathname.split("/").filter(Boolean)[0] || "";
    candidate = seg;
  } else {
    const vParam = parsed.searchParams.get("v");
    if (vParam) {
      candidate = vParam;
    } else {
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts.length >= 2 && (parts[0] === "embed" || parts[0] === "shorts" || parts[0] === "live" || parts[0] === "v")) {
        candidate = parts[1];
      }
    }
  }
  if (candidate && YOUTUBE_ID_REGEX.test(candidate)) {
    return candidate;
  }
  return null;
}

// src/utils/facebook.ts
var ALLOWED_FACEBOOK_HOSTS = /* @__PURE__ */ new Set([
  "facebook.com",
  "www.facebook.com",
  "m.facebook.com",
  "web.facebook.com",
  "mbasic.facebook.com",
  "fb.watch",
  "www.fb.watch"
]);
function extractFacebookVideoUrl(rawInput) {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;
  const withoutPrefix = trimmed.startsWith("facebook:") ? trimmed.slice("facebook:".length).trim() : trimmed;
  let parsed;
  try {
    const withScheme = withoutPrefix.startsWith("http://") || withoutPrefix.startsWith("https://") ? withoutPrefix : `https://${withoutPrefix}`;
    parsed = new URL(withScheme);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (!ALLOWED_FACEBOOK_HOSTS.has(host)) {
    return null;
  }
  if (parsed.pathname === "/plugins/video.php") {
    const innerHref = parsed.searchParams.get("href");
    if (!innerHref || innerHref === rawInput) {
      return null;
    }
    return extractFacebookVideoUrl(innerHref);
  }
  if (host === "fb.watch" || host === "www.fb.watch") {
    const segs = parsed.pathname.split("/").filter(Boolean);
    if (segs.length === 0 || !/^[a-zA-Z0-9_-]{3,64}$/.test(segs[0])) {
      return null;
    }
    return `https://fb.watch/${segs[0]}/`;
  }
  const cleanPath = parsed.pathname.replace(/\/+$/, "");
  const videoIdParam = parsed.searchParams.get("v");
  const isWatchPath = (cleanPath === "/watch" || cleanPath === "/video.php") && Boolean(videoIdParam && /^[0-9]{5,30}$/.test(videoIdParam));
  const isVideoPath = /\/videos\/(?:[a-zA-Z0-9._-]+\/)?[0-9]{5,30}$/.test(cleanPath) || /^\/reel\/[a-zA-Z0-9_-]{5,30}$/.test(cleanPath) || /^\/share\/[vr]\/[a-zA-Z0-9_-]{4,64}$/.test(cleanPath);
  if (!isWatchPath && !isVideoPath) {
    return null;
  }
  const canonical = isWatchPath ? `https://www.facebook.com${cleanPath}?v=${encodeURIComponent(videoIdParam)}` : `https://www.facebook.com${cleanPath}`;
  if (canonical.length > 280) {
    return null;
  }
  return canonical;
}
function getFacebookEmbedUrl(rawUrl, options) {
  const canonical = extractFacebookVideoUrl(rawUrl);
  if (!canonical) return "";
  const params = new URLSearchParams({
    href: canonical,
    show_text: "false",
    autoplay: options?.autoplay === false ? "false" : "true"
  });
  if (typeof options?.startSeconds === "number" && Number.isFinite(options.startSeconds) && options.startSeconds > 0) {
    params.set("t", String(Math.floor(options.startSeconds)));
  }
  return `https://www.facebook.com/plugins/video.php?${params.toString()}`;
}

// server/app.ts
dotenv.config();
var adminApp = getApps().length ? getApp() : initializeApp({ projectId: firebase_applet_config_default.projectId });
var adminAuth = getAuth(adminApp);
var IS_PRODUCTION = process.env.NODE_ENV === "production";
var BOOTSTRAPPED_ADMIN_EMAIL = "parjojuminet@gmail.com";
var PREVIEW_MAX_SEGMENT_INDEX = 29;
var FULL_MAX_SEGMENT_INDEX = 35;
var PLAYBACK_SECRET = process.env.PLAYBACK_TOKEN_SECRET && process.env.PLAYBACK_TOKEN_SECRET.length >= 16 ? process.env.PLAYBACK_TOKEN_SECRET : crypto3.randomBytes(32).toString("hex");
var PRIVATE_MEDIA_DIR = process.env.VERCEL === "1" ? path3.resolve(os2.tmpdir(), "deloken_private_media") : path3.resolve(process.cwd(), "private_media");
var UPLOADS_DIR = path3.resolve(PRIVATE_MEDIA_DIR, "uploads");
var THUMBNAILS_DIR = path3.resolve(PRIVATE_MEDIA_DIR, "thumbnails");
var ALLOWED_STREAMS = /* @__PURE__ */ new Set(["stream-cinema", "stream-doc", "uploaded-file"]);
var ALLOWED_QUALITIES = /* @__PURE__ */ new Set(["720p", "480p"]);
var ALLOWED_VIDEO_MIME = {
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov"
};
var ALLOWED_IMAGE_MIME = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp"
};
function isValidSafeId(value) {
  return typeof value === "string" && value.length >= 1 && value.length <= 128 && /^[a-zA-Z0-9_-]+$/.test(value);
}
function getIdempotencyKey(req) {
  const headerKey = req.headers["idempotency-key"];
  if (typeof headerKey === "string" && headerKey.trim().length >= 6 && headerKey.length <= 128) {
    return headerKey.trim();
  }
  const bodyKey = req.body?.idempotencyKey;
  if (typeof bodyKey === "string" && bodyKey.trim().length >= 6 && bodyKey.length <= 128) {
    return bodyKey.trim();
  }
  return void 0;
}
function pickStreamKey(videoId, category) {
  if (category === "Documentary" || category === "Education" || videoId.includes("caldera") || videoId.includes("ocean") || videoId.includes("optics")) {
    return "stream-doc";
  }
  return "stream-cinema";
}
function signPlaybackToken(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto3.createHmac("sha256", PLAYBACK_SECRET).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}
function verifyPlaybackToken(token) {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expectedSig = crypto3.createHmac("sha256", PLAYBACK_SECRET).update(encoded).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto3.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf-8")
    );
    if (!parsed || parsed.v !== 1 || typeof parsed.exp !== "number" || Date.now() > parsed.exp || !ALLOWED_STREAMS.has(parsed.streamKey)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
function signSandboxOrderToken(paymentId, userId, amount) {
  return crypto3.createHmac("sha256", PLAYBACK_SECRET).update(`sandbox:${paymentId}:${userId}:${amount}`).digest("hex");
}
var rateBucket = /* @__PURE__ */ new Map();
function rateLimitApi(req, res, next) {
  const ip = req.ip || "unknown";
  const now = Date.now();
  if (rateBucket.size > 2e3) {
    for (const [k, v] of rateBucket.entries()) {
      if (now > v.resetAt) {
        rateBucket.delete(k);
      }
    }
  }
  const entry = rateBucket.get(ip);
  if (!entry || now > entry.resetAt) {
    rateBucket.set(ip, { count: 1, resetAt: now + 6e4 });
    next();
    return;
  }
  entry.count += 1;
  if (entry.count > 240) {
    res.status(429).json({ error: "Too many requests. Please slow down." });
    return;
  }
  next();
}
async function extractUserFromBearer(req) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  const idToken = header.slice(7).trim();
  if (!idToken) return null;
  try {
    const decoded = await adminAuth.verifyIdToken(idToken);
    return {
      uid: decoded.uid,
      email: decoded.email ?? null,
      emailVerified: Boolean(decoded.email_verified),
      rawIdToken: idToken
    };
  } catch {
    return null;
  }
}
async function optionalAuth(req, _res, next) {
  const user = await extractUserFromBearer(req);
  if (user) req.user = user;
  next();
}
async function requireAuth(req, res, next) {
  const user = await extractUserFromBearer(req);
  if (!user) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  try {
    if (isSqlConfigured()) {
      await getOrCreateSqlUser(user.uid, user.email);
    }
  } catch (err) {
    console.error("SQL user sync failed during requireAuth:", err);
  }
  req.user = user;
  next();
}
async function isServerAdmin(user) {
  if (!user.emailVerified) return false;
  if (user.email === BOOTSTRAPPED_ADMIN_EMAIL) return true;
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      firebase_applet_config_default.projectId
    )}/databases/${encodeURIComponent(
      firebase_applet_config_default.firestoreDatabaseId
    )}/documents/admins/${encodeURIComponent(user.uid)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${user.rawIdToken}` }
    });
    return res.ok;
  } catch {
    return false;
  }
}
async function requireAdmin(req, res, next) {
  const user = await extractUserFromBearer(req);
  if (!user) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  const ok = await isServerAdmin(user);
  if (!ok) {
    res.status(403).json({ error: "Administrator privileges required." });
    return;
  }
  req.user = user;
  next();
}
async function resolveFirestoreVideoAssetForUser(videoId, userIdToken) {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      firebase_applet_config_default.projectId
    )}/databases/${encodeURIComponent(
      firebase_applet_config_default.firestoreDatabaseId
    )}/documents/video_assets/${encodeURIComponent(videoId)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${userIdToken}` }
    });
    if (!res.ok) return null;
    const doc = await res.json();
    const f = doc.fields;
    if (!f?.assetRef?.stringValue || !f?.creatorId?.stringValue) return null;
    const rawProvider = f.provider?.stringValue || "private_storage";
    const rawRef = f.assetRef.stringValue;
    let provider = "private_storage";
    let assetRef = rawRef;
    if (rawProvider === "cloudflare_stream") {
      provider = "cloudflare_stream";
    } else if (rawRef.startsWith("youtube:")) {
      provider = "youtube";
      assetRef = rawRef.slice("youtube:".length);
    } else if (rawRef.startsWith("facebook:")) {
      provider = "facebook";
      assetRef = rawRef.slice("facebook:".length);
    }
    return {
      videoId,
      creatorId: f.creatorId.stringValue,
      provider,
      assetRef,
      updatedAtIso: (/* @__PURE__ */ new Date()).toISOString()
    };
  } catch {
    return null;
  }
}
function safeResolveMediaFile(streamKey, quality, fileName) {
  if (!ALLOWED_STREAMS.has(streamKey) || !ALLOWED_QUALITIES.has(quality)) {
    return null;
  }
  const baseDir = path3.resolve(PRIVATE_MEDIA_DIR, streamKey, quality);
  const target = path3.resolve(baseDir, fileName);
  if (!target.startsWith(baseDir + path3.sep)) {
    return null;
  }
  return target;
}
function safeResolveUploadedAsset(baseRoot, uid, fileName) {
  if (!isValidSafeId(uid) || !/^[a-zA-Z0-9._-]+$/.test(fileName)) {
    return null;
  }
  const userDir = path3.resolve(baseRoot, uid);
  const target = path3.resolve(userDir, fileName);
  if (!target.startsWith(userDir + path3.sep)) {
    return null;
  }
  return target;
}
function createApiApp() {
  const app2 = express();
  app2.set("trust proxy", 1);
  app2.use("/api", (_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });
  app2.use("/api", rateLimitApi);
  app2.post(
    "/api/creator/upload-media",
    requireAuth,
    express.raw({
      type: [
        "video/mp4",
        "video/webm",
        "video/quicktime",
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/webp"
      ],
      limit: "100mb"
    }),
    async (req, res) => {
      const uid = req.user.uid;
      if (!isValidSafeId(uid)) {
        res.status(400).json({ error: "Invalid user identifier." });
        return;
      }
      const contentType = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
      const bodyBuffer = Buffer.isBuffer(req.body) ? req.body : null;
      if (!bodyBuffer || bodyBuffer.length === 0) {
        res.status(400).json({
          error: "Empty file upload. Select a valid MP4/WebM/MOV video or JPEG/PNG/WEBP image."
        });
        return;
      }
      const videoExt = ALLOWED_VIDEO_MIME[contentType];
      const imageExt = ALLOWED_IMAGE_MIME[contentType];
      if (!videoExt && !imageExt) {
        res.status(400).json({
          error: "Unsupported media format. Allowed: MP4, WebM, MOV, JPG, PNG, WEBP."
        });
        return;
      }
      if (imageExt && bodyBuffer.length > 5 * 1024 * 1024) {
        res.status(413).json({ error: "Thumbnail image exceeds 5MB limit." });
        return;
      }
      const rawOriginal = String(
        req.headers["x-deloken-filename"] || req.headers["x-vyora-filename"] || "media"
      ).replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
      const baseSlug = rawOriginal.length >= 2 ? rawOriginal.toLowerCase() : "deloken-media";
      const uniqueName = `${baseSlug}-${Date.now().toString(36)}-${crypto3.randomBytes(3).toString("hex")}${videoExt || imageExt}`;
      if (videoExt) {
        const target2 = safeResolveUploadedAsset(UPLOADS_DIR, uid, uniqueName);
        if (!target2) {
          res.status(400).json({ error: "Invalid upload path." });
          return;
        }
        try {
          fs2.mkdirSync(path3.dirname(target2), { recursive: true });
          fs2.writeFileSync(target2, bodyBuffer);
        } catch (err) {
          res.status(503).json({
            error: err instanceof Error ? `Video upload storage unavailable: ${err.message}. Use YouTube, Facebook, or Cloudflare Stream.` : "Video file storage unavailable in serverless mode."
          });
          return;
        }
        res.json({
          kind: "video",
          provider: "private_storage",
          assetRef: `private/uploads/${uid}/${uniqueName}`,
          mimeType: contentType,
          sizeBytes: bodyBuffer.length
        });
        return;
      }
      const target = safeResolveUploadedAsset(THUMBNAILS_DIR, uid, uniqueName);
      if (!target) {
        res.status(400).json({ error: "Invalid thumbnail upload path." });
        return;
      }
      try {
        fs2.mkdirSync(path3.dirname(target), { recursive: true });
        fs2.writeFileSync(target, bodyBuffer);
      } catch {
      }
      if (!isSqlConfigured()) {
        res.status(503).json({
          error: "Database PostgreSQL belum dihubungkan. Set DATABASE_URL di Vercel untuk menyimpan cover thumbnail."
        });
        return;
      }
      await saveThumbnailAssetSql({
        key: `thumb:${uid}:${uniqueName}`,
        creatorId: uid,
        mimeType: contentType,
        base64Data: bodyBuffer.toString("base64"),
        updatedAtIso: (/* @__PURE__ */ new Date()).toISOString()
      });
      res.json({
        kind: "thumbnail",
        thumbnailUrl: `/api/media/thumb/${encodeURIComponent(uid)}/${encodeURIComponent(
          uniqueName
        )}`,
        mimeType: contentType,
        sizeBytes: bodyBuffer.length
      });
    }
  );
  app2.get("/api/media/thumb/:uid/:fileName", async (req, res) => {
    const { uid, fileName } = req.params;
    const target = safeResolveUploadedAsset(THUMBNAILS_DIR, uid, fileName);
    if (!target) {
      res.status(400).json({ error: "Invalid thumbnail path." });
      return;
    }
    try {
      if (fs2.existsSync(target)) {
        const ext = path3.extname(fileName).toLowerCase();
        const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
        res.setHeader("Content-Type", mime);
        res.setHeader("Cache-Control", "public, max-age=86400");
        const stream = fs2.createReadStream(target);
        stream.on("error", () => {
          if (!res.headersSent) {
            res.status(500).json({ error: "Failed to read thumbnail file." });
          }
        });
        stream.pipe(res);
        return;
      }
      if (!isSqlConfigured()) {
        res.status(404).json({ error: "Thumbnail not found." });
        return;
      }
      const sqlThumb = await getThumbnailAssetSql(`thumb:${uid}:${fileName}`);
      if (!sqlThumb) {
        res.status(404).json({ error: "Thumbnail not found." });
        return;
      }
      const buf = Buffer.from(sqlThumb.base64Data, "base64");
      try {
        fs2.mkdirSync(path3.dirname(target), { recursive: true });
        fs2.writeFileSync(target, buf);
      } catch {
      }
      res.setHeader("Content-Type", sqlThumb.mimeType);
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.send(buf);
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({
          error: err instanceof Error ? err.message : "Unable to load thumbnail asset."
        });
      }
    }
  });
  app2.use(express.json({ limit: "128kb" }));
  app2.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      databaseConfigured: isSqlConfigured(),
      previewLimitSeconds: PREVIEW_LIMIT_SECONDS,
      accessDaysDuration: 30,
      gateways: {
        paypalConfigured: isPayPalConfigured(),
        paypalPaymentLinkConfigured: Boolean(getPayPalPaymentLink()),
        midtransQrisConfigured: isMidtransConfigured(),
        sandboxPreviewAllowed: !IS_PRODUCTION
      },
      media: {
        cloudflareStreamConfigured: isCloudflareStreamConfigured(),
        cloudflareSigningConfigured: isCloudflareSigningConfigured()
      },
      serverTimeIso: (/* @__PURE__ */ new Date()).toISOString()
    });
  });
  app2.post(
    "/api/creator/cloudflare-direct-upload",
    requireAuth,
    async (req, res) => {
      if (!isCloudflareStreamConfigured()) {
        res.status(503).json({
          error: "Cloudflare Stream is not configured. Set CLOUDFLARE_STREAM_ACCOUNT_ID and CLOUDFLARE_STREAM_API_TOKEN in server Secrets."
        });
        return;
      }
      const { uploadLength, filename, maxDurationSeconds } = req.body;
      const maxAllowedBytes = 30 * 1024 * 1024 * 1024;
      if (typeof uploadLength !== "number" || !Number.isFinite(uploadLength) || uploadLength < 1024 || uploadLength > maxAllowedBytes) {
        res.status(400).json({
          error: "Invalid uploadLength (expected 1 KB to 30 GB)."
        });
        return;
      }
      try {
        const result = await createCloudflareTusDirectUpload({
          uploadLength,
          creatorId: req.user.uid,
          filename: typeof filename === "string" ? filename : void 0,
          maxDurationSeconds: typeof maxDurationSeconds === "number" ? maxDurationSeconds : 21600
        });
        res.json({
          ...result,
          provider: "cloudflare_stream"
        });
      } catch (err) {
        res.status(502).json({
          error: err instanceof Error ? err.message : "Failed to create Cloudflare Stream upload session."
        });
      }
    }
  );
  app2.get(
    "/api/creator/cloudflare-status/:uid",
    requireAuth,
    async (req, res) => {
      if (!isCloudflareStreamConfigured()) {
        res.status(503).json({ error: "Cloudflare Stream is not configured." });
        return;
      }
      const cfUid = req.params.uid;
      if (!isValidSafeId(cfUid)) {
        res.status(400).json({ error: "Invalid Cloudflare Stream video UID." });
        return;
      }
      try {
        const status = await getCloudflareVideoStatus(cfUid);
        res.json(status);
      } catch (err) {
        res.status(502).json({
          error: err instanceof Error ? err.message : "Unable to query Cloudflare Stream video status."
        });
      }
    }
  );
  app2.post(
    "/api/creator/register-video-media",
    requireAuth,
    async (req, res) => {
      const uid = req.user.uid;
      const { videoId, provider, assetRef, mimeType } = req.body;
      if (!isValidSafeId(videoId) || provider !== "cloudflare_stream" && provider !== "private_storage" && provider !== "youtube" && provider !== "facebook" || typeof assetRef !== "string" || assetRef.trim().length < 3 || assetRef.trim().length > 300) {
        res.status(400).json({ error: "Invalid video media registration payload." });
        return;
      }
      let trimmedRef = assetRef.trim();
      if (provider === "youtube") {
        const ytId = extractYouTubeVideoId(trimmedRef);
        if (!ytId) {
          res.status(400).json({
            error: "Invalid YouTube link or Video ID. Use a standard youtube.com/watch?v=... or youtu.be/... link."
          });
          return;
        }
        trimmedRef = ytId;
      } else if (provider === "facebook") {
        const fbUrl = extractFacebookVideoUrl(trimmedRef);
        if (!fbUrl) {
          res.status(400).json({
            error: "Invalid Facebook video link. Use a public facebook.com/.../videos/..., facebook.com/watch?v=..., facebook.com/reel/..., or fb.watch/... URL."
          });
          return;
        }
        trimmedRef = fbUrl;
      } else if (trimmedRef.startsWith("private/uploads/")) {
        const expectedPrefix = `private/uploads/${uid}/`;
        if (!trimmedRef.startsWith(expectedPrefix)) {
          res.status(403).json({ error: "You may only bind media uploaded by your account." });
          return;
        }
      }
      try {
        await upsertCreatorMediaSql({
          videoId,
          creatorId: uid,
          provider,
          assetRef: trimmedRef,
          mimeType: typeof mimeType === "string" ? mimeType.slice(0, 60) : void 0,
          updatedAtIso: (/* @__PURE__ */ new Date()).toISOString()
        });
        res.json({ ok: true, videoId });
      } catch (err) {
        res.status(isSqlConfigured() ? 500 : 503).json({
          error: err instanceof Error ? err.message : "Failed to save video media mapping."
        });
      }
    }
  );
  app2.post("/api/stream/authorize", optionalAuth, async (req, res) => {
    const { videoId, category } = req.body;
    if (!isValidSafeId(videoId)) {
      res.status(400).json({ error: "Invalid videoId." });
      return;
    }
    const now = Date.now();
    const uid = req.user?.uid ?? "anonymous";
    const sqlReady = isSqlConfigured();
    let record = null;
    let mediaBinding = null;
    let resolvedVideo = null;
    try {
      const [ctx, videoMeta] = await Promise.all([
        sqlReady ? getStreamAuthContextSql(req.user?.uid, videoId) : Promise.resolve({ entitlement: null, mediaBinding: null }),
        resolveServerVideoEntry(
          videoId,
          firebase_applet_config_default.projectId,
          firebase_applet_config_default.firestoreDatabaseId
        )
      ]);
      record = ctx.entitlement;
      mediaBinding = ctx.mediaBinding;
      resolvedVideo = videoMeta;
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
              updatedAtIso: firestoreBinding.updatedAtIso
            }).catch(() => {
            });
          }
        }
      }
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to authorize stream."
      });
      return;
    }
    const isFreeRelease = Boolean(
      resolvedVideo && resolvedVideo.priceUsd === 0 && resolvedVideo.priceIdr === 0 && resolvedVideo.creditCost === 0
    );
    const hasPaidEntitlement = Boolean(
      record && record.status !== "revoked" && now < record.expiresAtMs
    );
    const isCreatorPreview = Boolean(
      req.user?.uid && mediaBinding && mediaBinding.creatorId === req.user.uid
    );
    const isActive = Boolean(hasPaidEntitlement || isCreatorPreview || isFreeRelease);
    const mode = isActive ? "full" : "preview";
    const maxSeg = isActive ? FULL_MAX_SEGMENT_INDEX : PREVIEW_MAX_SEGMENT_INDEX;
    const entitlementPayload = hasPaidEntitlement && record ? {
      status: "active",
      expiresAt: new Date(record.expiresAtMs).toISOString(),
      remainingDays: Math.max(
        1,
        Math.ceil((record.expiresAtMs - now) / (24 * 60 * 60 * 1e3))
      )
    } : isCreatorPreview ? {
      status: "active",
      expiresAt: new Date(now + ACCESS_WINDOW_MS).toISOString(),
      remainingDays: 30
    } : null;
    if (mediaBinding && mediaBinding.provider === "private_storage" && mediaBinding.assetRef.startsWith("private/uploads/")) {
      const relParts = mediaBinding.assetRef.replace("private/uploads/", "").split("/");
      if (relParts.length === 2) {
        const [ownerUid, fileName] = relParts;
        const resolved = safeResolveUploadedAsset(UPLOADS_DIR, ownerUid, fileName);
        if (resolved && fs2.existsSync(resolved)) {
          const token2 = signPlaybackToken({
            v: 1,
            uid,
            videoId,
            streamKey: "uploaded-file",
            mode,
            maxSeg,
            exp: now + (isActive ? 18e5 : 6e5),
            jti: crypto3.randomUUID(),
            fileRef: `${ownerUid}/${fileName}`,
            mimeType: mediaBinding.mimeType || "video/mp4"
          });
          res.json({
            mode,
            isFree: isFreeRelease,
            streamType: "file",
            videoId,
            previewLimitSeconds: PREVIEW_LIMIT_SECONDS,
            resumeSeconds: hasPaidEntitlement && record ? record.resumeSeconds : 0,
            manifestUrl: `/api/stream/file?token=${encodeURIComponent(token2)}`,
            entitlement: entitlementPayload,
            serverTimeIso: new Date(now).toISOString()
          });
          return;
        }
      }
    }
    if (mediaBinding && mediaBinding.provider === "cloudflare_stream" && isValidSafeId(mediaBinding.assetRef.trim()) && mediaBinding.assetRef.trim() !== "stream-cinema" && mediaBinding.assetRef.trim() !== "stream-doc") {
      const cfUid = mediaBinding.assetRef.trim();
      const ttlSeconds = isActive ? 3600 : 420;
      const signedToken = signCloudflareStreamToken(cfUid, { ttlSeconds });
      const manifestUrl = buildCloudflareHlsUrl(signedToken || cfUid);
      res.json({
        mode,
        isFree: isFreeRelease,
        streamType: "hls",
        provider: "cloudflare_stream",
        signedHls: Boolean(signedToken),
        videoId,
        previewLimitSeconds: PREVIEW_LIMIT_SECONDS,
        resumeSeconds: hasPaidEntitlement && record ? record.resumeSeconds : 0,
        manifestUrl,
        entitlement: entitlementPayload,
        serverTimeIso: new Date(now).toISOString()
      });
      return;
    }
    if (mediaBinding && (mediaBinding.provider === "youtube" || mediaBinding.provider === "private_storage" && mediaBinding.assetRef.startsWith("youtube:"))) {
      const ytId = extractYouTubeVideoId(mediaBinding.assetRef);
      if (ytId) {
        res.json({
          mode,
          isFree: isFreeRelease,
          streamType: "youtube",
          provider: "youtube",
          youtubeVideoId: ytId,
          videoId,
          previewLimitSeconds: PREVIEW_LIMIT_SECONDS,
          resumeSeconds: hasPaidEntitlement && record ? record.resumeSeconds : 0,
          manifestUrl: `https://www.youtube-nocookie.com/embed/${ytId}`,
          entitlement: entitlementPayload,
          serverTimeIso: new Date(now).toISOString()
        });
        return;
      }
    }
    if (mediaBinding && (mediaBinding.provider === "facebook" || mediaBinding.provider === "private_storage" && mediaBinding.assetRef.startsWith("facebook:"))) {
      const fbUrl = extractFacebookVideoUrl(mediaBinding.assetRef);
      if (fbUrl) {
        const resumeAt = hasPaidEntitlement && record ? record.resumeSeconds : 0;
        res.json({
          mode,
          isFree: isFreeRelease,
          streamType: "facebook",
          provider: "facebook",
          facebookVideoUrl: fbUrl,
          videoId,
          previewLimitSeconds: PREVIEW_LIMIT_SECONDS,
          resumeSeconds: resumeAt,
          manifestUrl: getFacebookEmbedUrl(fbUrl, {
            autoplay: true,
            startSeconds: resumeAt
          }),
          entitlement: entitlementPayload,
          serverTimeIso: new Date(now).toISOString()
        });
        return;
      }
    }
    const mappedPreset = mediaBinding?.assetRef === "stream-doc" ? "stream-doc" : mediaBinding?.assetRef === "stream-cinema" ? "stream-cinema" : null;
    const streamKey = mappedPreset ?? pickStreamKey(videoId, typeof category === "string" ? category : void 0);
    const token = signPlaybackToken({
      v: 1,
      uid,
      videoId,
      streamKey,
      mode,
      maxSeg,
      exp: now + (isActive ? 18e5 : 6e5),
      jti: crypto3.randomUUID()
    });
    res.json({
      mode,
      isFree: isFreeRelease,
      streamType: "hls",
      videoId,
      previewLimitSeconds: PREVIEW_LIMIT_SECONDS,
      resumeSeconds: hasPaidEntitlement && record ? record.resumeSeconds : 0,
      manifestUrl: `/api/stream/master.m3u8?token=${encodeURIComponent(token)}`,
      entitlement: entitlementPayload,
      serverTimeIso: new Date(now).toISOString()
    });
  });
  app2.get("/api/stream/file", (req, res) => {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    const payload = verifyPlaybackToken(token);
    if (!payload || payload.streamKey !== "uploaded-file" || !payload.fileRef) {
      res.status(403).json({ error: "Invalid or expired file playback token." });
      return;
    }
    const parts = payload.fileRef.split("/");
    if (parts.length !== 2) {
      res.status(400).json({ error: "Invalid media reference." });
      return;
    }
    const targetFile = safeResolveUploadedAsset(UPLOADS_DIR, parts[0], parts[1]);
    if (!targetFile || !fs2.existsSync(targetFile)) {
      res.status(404).json({ error: "Uploaded media file not found." });
      return;
    }
    const stat = fs2.statSync(targetFile);
    const total = stat.size;
    const ext = path3.extname(parts[1]).toLowerCase();
    const contentType = ext === ".webm" ? "video/webm" : ext === ".mov" ? "video/quicktime" : payload.mimeType || "video/mp4";
    const range = req.headers.range;
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "private, no-store");
    if (range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(range);
      if (!match) {
        res.status(416).setHeader("Content-Range", `bytes */${total}`).end();
        return;
      }
      const start = Number(match[1]);
      const end = match[2] ? Math.min(total - 1, Number(match[2])) : Math.min(total - 1, start + 2 * 1024 * 1024 - 1);
      if (start >= total || start > end) {
        res.status(416).setHeader("Content-Range", `bytes */${total}`).end();
        return;
      }
      res.status(206);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
      res.setHeader("Content-Length", String(end - start + 1));
      res.setHeader("Content-Type", contentType);
      const stream2 = fs2.createReadStream(targetFile, { start, end });
      stream2.pipe(res);
      res.on("close", () => stream2.destroy());
      return;
    }
    res.setHeader("Content-Length", String(total));
    res.setHeader("Content-Type", contentType);
    const stream = fs2.createReadStream(targetFile);
    stream.pipe(res);
    res.on("close", () => stream.destroy());
  });
  app2.get("/api/stream/master.m3u8", (req, res) => {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    const payload = verifyPlaybackToken(token);
    if (!payload) {
      res.status(403).json({ error: "Invalid or expired playback token." });
      return;
    }
    const encodedToken = encodeURIComponent(token);
    const masterPlaylist = [
      "#EXTM3U",
      "#EXT-X-VERSION:3",
      '#EXT-X-STREAM-INF:BANDWIDTH=980000,RESOLUTION=1280x720,NAME="720p"',
      `/api/stream/variant.m3u8?token=${encodedToken}&quality=720p`,
      '#EXT-X-STREAM-INF:BANDWIDTH=510000,RESOLUTION=854x480,NAME="480p"',
      `/api/stream/variant.m3u8?token=${encodedToken}&quality=480p`,
      ""
    ].join("\n");
    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    res.setHeader("Cache-Control", "private, no-store");
    res.send(masterPlaylist);
  });
  app2.get("/api/stream/variant.m3u8", (req, res) => {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    const quality = typeof req.query.quality === "string" ? req.query.quality : "720p";
    const payload = verifyPlaybackToken(token);
    if (!payload) {
      res.status(403).json({ error: "Invalid or expired playback token." });
      return;
    }
    const playlistFile = safeResolveMediaFile(payload.streamKey, quality, "index.m3u8");
    if (!playlistFile || !fs2.existsSync(playlistFile)) {
      res.status(404).json({ error: "Stream playlist unavailable." });
      return;
    }
    const rawLines = fs2.readFileSync(playlistFile, "utf-8").split("\n");
    const outputLines = [];
    const encodedToken = encodeURIComponent(token);
    let pendingExtInf = null;
    for (const line of rawLines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith("#EXTINF:")) {
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
      if (trimmed === "#EXT-X-ENDLIST") {
        continue;
      }
      outputLines.push(trimmed);
    }
    outputLines.push("#EXT-X-ENDLIST", "");
    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    res.setHeader("Cache-Control", "private, no-store");
    res.send(outputLines.join("\n"));
  });
  app2.get("/api/stream/segment/:index", (req, res) => {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    const quality = typeof req.query.quality === "string" ? req.query.quality : "720p";
    const payload = verifyPlaybackToken(token);
    if (!payload) {
      res.status(403).json({ error: "Invalid or expired playback token." });
      return;
    }
    const rawIndex = req.params.index;
    if (!/^\d{1,4}$/.test(rawIndex)) {
      res.status(400).json({ error: "Invalid segment index." });
      return;
    }
    const segIndex = Number(rawIndex);
    if (segIndex > payload.maxSeg) {
      res.status(402).json({
        error: "PREVIEW_LIMIT_REACHED",
        message: "Five-minute free preview reached. Unlock 30-day access to continue playback."
      });
      return;
    }
    const padded = String(segIndex).padStart(3, "0");
    const segFile = safeResolveMediaFile(payload.streamKey, quality, `seg_${padded}.ts`);
    if (!segFile || !fs2.existsSync(segFile)) {
      res.status(404).json({ error: "Segment not found." });
      return;
    }
    res.setHeader("Content-Type", "video/mp2t");
    res.setHeader("Cache-Control", "private, no-store");
    const stream = fs2.createReadStream(segFile);
    stream.on("error", () => {
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to stream media segment." });
      } else {
        res.end();
      }
    });
    res.on("close", () => {
      stream.destroy();
    });
    stream.pipe(res);
  });
  app2.get("/api/entitlements/me", requireAuth, async (req, res) => {
    if (!isSqlConfigured()) {
      res.json({ entitlements: [], serverTimeIso: (/* @__PURE__ */ new Date()).toISOString() });
      return;
    }
    const uid = req.user.uid;
    const now = Date.now();
    try {
      const entList = await getUserEntitlementsSql(uid);
      const items = entList.map((ent) => {
        const isRevoked = ent.status === "revoked";
        const isExpired = isRevoked || now >= ent.expiresAtMs;
        return {
          id: ent.id,
          userId: ent.userId,
          videoId: ent.videoId,
          videoTitle: ent.videoTitle,
          thumbnailUrl: ent.thumbnailUrl,
          status: isRevoked ? "revoked" : isExpired ? "expired" : "active",
          resumeSeconds: ent.resumeSeconds,
          expiresAt: new Date(ent.expiresAtMs).toISOString(),
          createdAt: new Date(ent.grantedAtMs).toISOString(),
          remainingDays: isExpired ? 0 : Math.max(1, Math.ceil((ent.expiresAtMs - now) / (24 * 60 * 60 * 1e3)))
        };
      });
      res.json({ entitlements: items, serverTimeIso: new Date(now).toISOString() });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Unable to load entitlements."
      });
    }
  });
  app2.post("/api/playback/progress", requireAuth, async (req, res) => {
    const { videoId, positionSeconds } = req.body;
    if (!isValidSafeId(videoId) || typeof positionSeconds !== "number") {
      res.status(400).json({ error: "Invalid videoId or positionSeconds." });
      return;
    }
    try {
      const result = await updatePlaybackProgressSql(
        req.user.uid,
        videoId,
        positionSeconds
      );
      if (!result.ok) {
        res.status(403).json({ error: "No active entitlement for this release." });
        return;
      }
      res.json(result);
    } catch (err) {
      res.status(isSqlConfigured() ? 500 : 503).json({
        error: err instanceof Error ? err.message : "Failed to update progress."
      });
    }
  });
  app2.post(
    "/api/entitlements/activate-phase3-pass",
    requireAuth,
    async (req, res) => {
      if (IS_PRODUCTION) {
        res.status(403).json({
          error: "Trial entitlement activation is disabled in production. Use verified PayPal, QRIS, or Credit Wallet checkout."
        });
        return;
      }
      const { videoId, videoTitle, thumbnailUrl, resumeSeconds } = req.body;
      if (!isValidSafeId(videoId)) {
        res.status(400).json({ error: "Invalid videoId." });
        return;
      }
      const now = Date.now();
      const uid = req.user.uid;
      const safeResume = typeof resumeSeconds === "number" ? Math.max(0, Math.min(36e3, Math.floor(resumeSeconds))) : PREVIEW_LIMIT_SECONDS;
      const record = {
        id: `ent_${uid.slice(0, 8)}_${videoId}`,
        userId: uid,
        videoId,
        videoTitle: typeof videoTitle === "string" ? videoTitle.slice(0, 140) : videoId,
        thumbnailUrl: typeof thumbnailUrl === "string" ? thumbnailUrl.slice(0, 500) : "",
        grantedAtMs: now,
        expiresAtMs: now + ACCESS_WINDOW_MS,
        resumeSeconds: safeResume,
        status: "active",
        source: "phase3_trial_pass"
      };
      try {
        await upsertTrialEntitlementSql(record);
        res.json({
          entitlement: {
            id: record.id,
            videoId: record.videoId,
            status: "active",
            resumeSeconds: record.resumeSeconds,
            expiresAt: new Date(record.expiresAtMs).toISOString(),
            remainingDays: 30
          }
        });
      } catch (err) {
        res.status(isSqlConfigured() ? 500 : 503).json({
          error: err instanceof Error ? err.message : "Unable to activate pass."
        });
      }
    }
  );
  app2.get("/api/wallet/me", requireAuth, async (req, res) => {
    try {
      const snapshot = await getWalletSnapshotSql(req.user.uid);
      res.json({
        ...snapshot,
        serverTimeIso: (/* @__PURE__ */ new Date()).toISOString()
      });
    } catch (err) {
      res.status(isSqlConfigured() ? 500 : 503).json({
        error: err instanceof Error ? err.message : "Failed to load wallet."
      });
    }
  });
  app2.post("/api/wallet/spend", requireAuth, async (req, res) => {
    const uid = req.user.uid;
    const idemKey = getIdempotencyKey(req);
    const { videoId, resumeSeconds } = req.body;
    if (!isValidSafeId(videoId)) {
      res.status(400).json({ error: "Invalid videoId." });
      return;
    }
    const resolvedVideo = await resolveServerVideoEntry(
      videoId,
      firebase_applet_config_default.projectId,
      firebase_applet_config_default.firestoreDatabaseId
    );
    if (!resolvedVideo) {
      res.status(404).json({ error: "Published video release not found." });
      return;
    }
    if (resolvedVideo.priceUsd === 0 && resolvedVideo.priceIdr === 0 && resolvedVideo.creditCost === 0) {
      res.status(400).json({ error: "Free release does not require credits." });
      return;
    }
    try {
      const paymentId = `pay_cr_${crypto3.randomUUID().slice(0, 12)}`;
      const result = await spendCreditsAtomicSql({
        uid,
        userEmail: req.user.email,
        video: resolvedVideo,
        resumeSeconds: typeof resumeSeconds === "number" ? resumeSeconds : 0,
        paymentId,
        idemKey
      });
      res.status(result.status).json(result.body);
    } catch (err) {
      res.status(isSqlConfigured() ? 500 : 503).json({
        error: err instanceof Error ? err.message : "Failed to spend credits."
      });
    }
  });
  app2.post("/api/payments/paypal/create-order", requireAuth, async (req, res) => {
    const uid = req.user.uid;
    const idemKey = getIdempotencyKey(req);
    const { purpose, targetId, resumeSeconds } = req.body;
    if (purpose !== "video_unlock" && purpose !== "credit_topup" || !isValidSafeId(targetId)) {
      res.status(400).json({ error: "Invalid payment purpose or targetId." });
      return;
    }
    const useLivePayPal = isPayPalConfigured();
    const paypalPaymentLink = !useLivePayPal ? getPayPalPaymentLink() : null;
    if (IS_PRODUCTION && !useLivePayPal && !paypalPaymentLink) {
      res.status(503).json({
        error: "PayPal gateway credentials are not configured in production."
      });
      return;
    }
    let amountUsd = 0;
    let targetTitle = "";
    let creditsDelta = 0;
    if (purpose === "credit_topup") {
      const pkg = SERVER_CREDIT_PACKAGES[targetId];
      if (!pkg) {
        res.status(404).json({ error: "Credit package not found." });
        return;
      }
      amountUsd = pkg.priceUsd;
      targetTitle = pkg.name;
      creditsDelta = pkg.credits + pkg.bonusCredits;
    } else {
      const vid = await resolveServerVideoEntry(
        targetId,
        firebase_applet_config_default.projectId,
        firebase_applet_config_default.firestoreDatabaseId
      );
      if (!vid) {
        res.status(404).json({ error: "Published release not found." });
        return;
      }
      if (vid.priceUsd === 0 && vid.priceIdr === 0 && vid.creditCost === 0) {
        res.status(400).json({ error: "Free release does not require payment." });
        return;
      }
      amountUsd = vid.priceUsd;
      targetTitle = vid.title;
    }
    try {
      const early = await precheckCreateOrderSql({
        scope: "pp_create",
        uid,
        idemKey,
        purpose,
        targetId
      });
      if (early) {
        res.status(early.status).json(early.body);
        return;
      }
    } catch (err) {
      res.status(isSqlConfigured() ? 500 : 503).json({
        error: err instanceof Error ? err.message : "Unable to validate checkout state."
      });
      return;
    }
    const paymentId = `pay_pp_${crypto3.randomUUID().slice(0, 12)}`;
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    let gatewayOrderId = `SBX-PP-${paymentId}`;
    let approvalUrl = "";
    let gatewayMode = "sandbox_preview";
    if (useLivePayPal) {
      try {
        const origin = process.env.APP_URL || `${req.protocol}://${req.get("host") || "localhost:3000"}`;
        const ppOrder = await createLivePayPalOrder({
          orderId: paymentId,
          amountUsd,
          description: `DELOKEN: ${targetTitle}`,
          returnUrl: `${origin}/?paypalReturn=1&paymentId=${paymentId}`,
          cancelUrl: `${origin}/?paypalCancel=1&paymentId=${paymentId}`
        });
        gatewayOrderId = ppOrder.paypalOrderId;
        approvalUrl = ppOrder.approvalUrl;
        gatewayMode = "live";
      } catch (err) {
        res.status(502).json({
          error: err instanceof Error ? err.message : "PayPal API order creation failed."
        });
        return;
      }
    } else if (paypalPaymentLink) {
      gatewayMode = "payment_link";
      gatewayOrderId = `PP-LINK-${paymentId.slice(-8).toUpperCase()}`;
      approvalUrl = paypalPaymentLink;
    }
    const sandboxCaptureToken = gatewayMode === "sandbox_preview" ? signSandboxOrderToken(paymentId, uid, amountUsd) : void 0;
    const order = {
      id: paymentId,
      userId: uid,
      userEmail: req.user.email,
      purpose,
      targetId,
      targetTitle,
      method: "paypal",
      amount: amountUsd,
      currency: "USD",
      creditsDelta,
      status: "pending",
      gatewayOrderId,
      gatewayMode,
      approvalUrl: approvalUrl || void 0,
      expiresAt: new Date(now + PAYMENT_TTL_MS).toISOString(),
      createdAt: nowIso,
      updatedAt: nowIso
    };
    try {
      const responseBody = {
        payment: order,
        sandboxCaptureToken,
        resumeSeconds: typeof resumeSeconds === "number" ? resumeSeconds : 0
      };
      const finalResp = await savePendingPaymentOrderSql({
        scope: "pp_create",
        uid,
        idemKey,
        order,
        responseBody
      });
      res.status(finalResp.status).json(finalResp.body);
    } catch (err) {
      res.status(isSqlConfigured() ? 500 : 503).json({
        error: err instanceof Error ? err.message : "Failed to store PayPal order."
      });
    }
  });
  app2.post("/api/payments/paypal/capture", requireAuth, async (req, res) => {
    const uid = req.user.uid;
    const idemKey = getIdempotencyKey(req);
    const { paymentId, sandboxCaptureToken, resumeSeconds } = req.body;
    if (!isValidSafeId(paymentId)) {
      res.status(400).json({ error: "Invalid paymentId." });
      return;
    }
    let payment = null;
    try {
      const cached = await checkIdempotencySql("pp_capture", uid, idemKey);
      if (cached) {
        res.status(cached.status).json(cached.body);
        return;
      }
      payment = await getPaymentByIdSql(paymentId);
    } catch (err) {
      res.status(isSqlConfigured() ? 500 : 503).json({
        error: err instanceof Error ? err.message : "Unable to look up PayPal order."
      });
      return;
    }
    if (!payment || payment.userId !== uid || payment.method !== "paypal") {
      res.status(404).json({ error: "PayPal payment order not found." });
      return;
    }
    if (payment.status === "completed") {
      try {
        const snap = await getPaymentStatusSnapshotSql(paymentId, uid);
        res.json({ payment, wallet: snap?.wallet });
      } catch (err) {
        res.status(500).json({
          error: err instanceof Error ? err.message : "Unable to read payment snapshot."
        });
      }
      return;
    }
    if (payment.status !== "pending") {
      res.status(409).json({
        error: `PayPal order cannot be captured from status '${payment.status}'.`
      });
      return;
    }
    if (payment.gatewayMode === "live") {
      try {
        const cap = await captureLivePayPalOrder(payment.gatewayOrderId);
        if (!cap.completed || Math.abs(cap.capturedUsd - payment.amount) > 0.02) {
          res.status(402).json({ error: "PayPal capture incomplete or amount mismatch." });
          return;
        }
      } catch (err) {
        res.status(502).json({
          error: err instanceof Error ? err.message : "PayPal capture verification failed."
        });
        return;
      }
    } else if (payment.gatewayMode === "payment_link") {
      res.status(409).json({
        error: "PayPal Payment Link orders activate via PayPal webhook or Admin verification after payment is received."
      });
      return;
    } else {
      if (IS_PRODUCTION) {
        res.status(403).json({ error: "Sandbox PayPal capture is disabled in production." });
        return;
      }
      const expectedToken = signSandboxOrderToken(payment.id, uid, payment.amount);
      const tokStr = typeof sandboxCaptureToken === "string" ? sandboxCaptureToken : "";
      const a = Buffer.from(expectedToken, "utf8");
      const b = Buffer.from(tokStr, "utf8");
      if (a.length !== b.length || !crypto3.timingSafeEqual(a, b)) {
        res.status(403).json({ error: "Invalid server sandbox capture signature." });
        return;
      }
    }
    const videoEntry = payment.purpose === "video_unlock" ? await resolveServerVideoEntry(
      payment.targetId,
      firebase_applet_config_default.projectId,
      firebase_applet_config_default.firestoreDatabaseId
    ) : null;
    try {
      const fulfilled = await fulfillPaymentAtomicSql({
        paymentId,
        videoEntry,
        resumeSeconds: typeof resumeSeconds === "number" ? resumeSeconds : 0,
        idemScope: "pp_capture",
        idemUid: uid,
        idemKey
      });
      if (fulfilled.notFound) {
        res.status(404).json({ error: "Order missing." });
        return;
      }
      if (fulfilled.invalidStatus) {
        res.status(409).json({
          error: `Order cannot be fulfilled from status '${fulfilled.invalidStatus}'.`
        });
        return;
      }
      res.status(200).json({
        payment: fulfilled.payment,
        purchase: fulfilled.purchase,
        entitlement: fulfilled.entitlement ?? null,
        wallet: fulfilled.wallet
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to capture PayPal payment."
      });
    }
  });
  app2.post("/api/payments/qris/create", requireAuth, async (req, res) => {
    const uid = req.user.uid;
    const idemKey = getIdempotencyKey(req);
    const { purpose, targetId, resumeSeconds } = req.body;
    if (purpose !== "video_unlock" && purpose !== "credit_topup" || !isValidSafeId(targetId)) {
      res.status(400).json({ error: "Invalid payment purpose or targetId." });
      return;
    }
    const useLiveMidtrans = isMidtransConfigured();
    if (IS_PRODUCTION && !useLiveMidtrans) {
      res.status(503).json({
        error: "Indonesian QRIS gateway credentials are not configured in production."
      });
      return;
    }
    let amountIdr = 0;
    let targetTitle = "";
    let creditsDelta = 0;
    if (purpose === "credit_topup") {
      const pkg = SERVER_CREDIT_PACKAGES[targetId];
      if (!pkg) {
        res.status(404).json({ error: "Credit package not found." });
        return;
      }
      amountIdr = pkg.priceIdr;
      targetTitle = pkg.name;
      creditsDelta = pkg.credits + pkg.bonusCredits;
    } else {
      const vid = await resolveServerVideoEntry(
        targetId,
        firebase_applet_config_default.projectId,
        firebase_applet_config_default.firestoreDatabaseId
      );
      if (!vid) {
        res.status(404).json({ error: "Published release not found." });
        return;
      }
      if (vid.priceUsd === 0 && vid.priceIdr === 0 && vid.creditCost === 0) {
        res.status(400).json({ error: "Free release does not require payment." });
        return;
      }
      amountIdr = vid.priceIdr;
      targetTitle = vid.title;
    }
    try {
      const early = await precheckCreateOrderSql({
        scope: "qris_create",
        uid,
        idemKey,
        purpose,
        targetId
      });
      if (early) {
        res.status(early.status).json(early.body);
        return;
      }
    } catch (err) {
      res.status(isSqlConfigured() ? 500 : 503).json({
        error: err instanceof Error ? err.message : "Unable to validate QRIS checkout."
      });
      return;
    }
    const paymentId = `pay_qr_${crypto3.randomUUID().slice(0, 12)}`;
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    let qrString = "";
    let gatewayOrderId = `DELOKEN-QRIS-${paymentId}`;
    let gatewayMode = "sandbox_preview";
    if (useLiveMidtrans) {
      try {
        const mt = await createLiveMidtransQris({
          orderId: paymentId,
          amountIdr
        });
        qrString = mt.qrString;
        gatewayOrderId = mt.transactionId;
        gatewayMode = "live";
      } catch (err) {
        res.status(502).json({
          error: err instanceof Error ? err.message : "Midtrans QRIS charge creation failed."
        });
        return;
      }
    } else {
      qrString = buildQrisPayloadString(paymentId, amountIdr);
    }
    const order = {
      id: paymentId,
      userId: uid,
      userEmail: req.user.email,
      purpose,
      targetId,
      targetTitle,
      method: "qris",
      amount: amountIdr,
      currency: "IDR",
      creditsDelta,
      status: "pending",
      gatewayOrderId,
      gatewayMode,
      qrString,
      expiresAt: new Date(now + PAYMENT_TTL_MS).toISOString(),
      createdAt: nowIso,
      updatedAt: nowIso
    };
    try {
      const responseBody = {
        payment: order,
        resumeSeconds: typeof resumeSeconds === "number" ? resumeSeconds : 0
      };
      const result = await savePendingPaymentOrderSql({
        scope: "qris_create",
        uid,
        idemKey,
        order,
        responseBody
      });
      res.status(result.status).json(result.body);
    } catch (err) {
      res.status(isSqlConfigured() ? 500 : 503).json({
        error: err instanceof Error ? err.message : "Failed to store QRIS order."
      });
    }
  });
  app2.get("/api/payments/:paymentId/status", requireAuth, async (req, res) => {
    const paymentId = req.params.paymentId;
    if (!isValidSafeId(paymentId)) {
      res.status(400).json({ error: "Invalid paymentId." });
      return;
    }
    try {
      const snapshot = await getPaymentStatusSnapshotSql(paymentId, req.user.uid);
      if (!snapshot) {
        res.status(404).json({ error: "Payment not found." });
        return;
      }
      res.json(snapshot);
    } catch (err) {
      res.status(isSqlConfigured() ? 500 : 503).json({
        error: err instanceof Error ? err.message : "Failed to fetch payment status."
      });
    }
  });
  app2.post(
    "/api/payments/qris/sandbox-settle",
    requireAuth,
    async (req, res) => {
      if (IS_PRODUCTION) {
        res.status(403).json({
          error: "Simulated QRIS settlement is strictly forbidden in production. Payments settle only via authenticated gateway webhooks."
        });
        return;
      }
      const uid = req.user.uid;
      const { paymentId, resumeSeconds } = req.body;
      if (!isValidSafeId(paymentId)) {
        res.status(400).json({ error: "Invalid paymentId." });
        return;
      }
      let existingPayment = null;
      try {
        existingPayment = await getPaymentByIdSql(paymentId);
      } catch (err) {
        res.status(isSqlConfigured() ? 500 : 503).json({
          error: err instanceof Error ? err.message : "Failed to read QRIS order."
        });
        return;
      }
      if (!existingPayment || existingPayment.userId !== uid || existingPayment.method !== "qris") {
        res.status(404).json({ error: "Pending QRIS order not found." });
        return;
      }
      const videoEntry = existingPayment.purpose === "video_unlock" ? await resolveServerVideoEntry(
        existingPayment.targetId,
        firebase_applet_config_default.projectId,
        firebase_applet_config_default.firestoreDatabaseId
      ) : null;
      try {
        const settled = await fulfillPaymentAtomicSql({
          paymentId,
          videoEntry,
          resumeSeconds: typeof resumeSeconds === "number" ? resumeSeconds : 0
        });
        if (settled.notFound) {
          res.status(404).json({ error: "QRIS order not found." });
          return;
        }
        res.json({
          payment: settled.payment,
          purchase: settled.purchase,
          entitlement: settled.entitlement ?? null,
          wallet: settled.wallet
        });
      } catch (err) {
        res.status(500).json({
          error: err instanceof Error ? err.message : "Failed to settle sandbox QRIS order."
        });
      }
    }
  );
  app2.post("/api/webhooks/paypal", async (req, res) => {
    const body = req.body;
    const webhookId = process.env.PAYPAL_WEBHOOK_ID;
    if (webhookId && isPayPalConfigured()) {
      try {
        const token = await getPayPalAccessToken();
        const base = process.env.PAYPAL_MODE === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
        const verifyRes = await fetch(`${base}/v1/notifications/verify-webhook-signature`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            auth_algo: req.headers["paypal-auth-algo"],
            cert_url: req.headers["paypal-cert-url"],
            transmission_id: req.headers["paypal-transmission-id"],
            transmission_sig: req.headers["paypal-transmission-sig"],
            transmission_time: req.headers["paypal-transmission-time"],
            webhook_id: webhookId,
            webhook_event: body
          })
        });
        const verifyJson = await verifyRes.json();
        if (!verifyRes.ok || verifyJson.verification_status !== "SUCCESS") {
          res.status(401).json({ error: "Invalid PayPal webhook signature." });
          return;
        }
      } catch {
        res.status(401).json({ error: "PayPal webhook verification failed." });
        return;
      }
    } else {
      const secret = process.env.PAYPAL_WEBHOOK_SECRET || (!IS_PRODUCTION ? PLAYBACK_SECRET : "");
      const sigHeader = String(req.headers["x-vyora-webhook-signature"] || "");
      if (!secret || !sigHeader) {
        res.status(401).json({ error: "Missing PayPal webhook authentication." });
        return;
      }
      const expected = crypto3.createHmac("sha256", secret).update(JSON.stringify(body)).digest("hex");
      const a = Buffer.from(expected, "utf8");
      const b = Buffer.from(sigHeader, "utf8");
      if (a.length !== b.length || !crypto3.timingSafeEqual(a, b)) {
        res.status(401).json({ error: "Invalid PayPal webhook HMAC signature." });
        return;
      }
    }
    const eventId = body.id || "";
    if (!eventId) {
      res.status(400).json({ error: "Missing webhook event id." });
      return;
    }
    const webhookKey = `pp:${eventId}`;
    const targetPaymentId = body.resource?.custom_id || "";
    const gatewayOrderId = body.resource?.supplementary_data?.related_ids?.order_id || body.resource?.id || "";
    try {
      if (await isWebhookProcessedSql(webhookKey)) {
        res.json({ ok: true, duplicate: true });
        return;
      }
      const payment = await findPaymentForWebhookSql(targetPaymentId, gatewayOrderId);
      const reportedUsd = Number(body.resource?.amount?.value);
      const amountMatches = !Number.isFinite(reportedUsd) || !payment || Math.abs(reportedUsd - payment.amount) <= 0.02;
      if (payment && amountMatches && (body.event_type === "PAYMENT.CAPTURE.COMPLETED" || body.event_type === "CHECKOUT.ORDER.APPROVED")) {
        const video = payment.purpose === "video_unlock" ? await resolveServerVideoEntry(
          payment.targetId,
          firebase_applet_config_default.projectId,
          firebase_applet_config_default.firestoreDatabaseId
        ) : null;
        const settled = await fulfillPaymentAtomicSql({
          paymentId: payment.id,
          videoEntry: video,
          webhookEventKey: webhookKey
        });
        res.json({ ok: true, duplicate: Boolean(settled.duplicateWebhook) });
        return;
      }
      const rec = await recordWebhookOnlyOrFailureSql({ webhookEventKey: webhookKey });
      res.json({ ok: true, duplicate: rec.duplicate });
    } catch (err) {
      res.status(isSqlConfigured() ? 500 : 503).json({
        error: err instanceof Error ? err.message : "PayPal webhook processing failed."
      });
    }
  });
  app2.post("/api/webhooks/qris", async (req, res) => {
    const body = req.body;
    const orderId = body.order_id || "";
    const statusCode = body.status_code || "200";
    const grossAmount = body.gross_amount || "";
    if (isMidtransConfigured()) {
      const valid = verifyMidtransWebhookSignature({
        orderId,
        statusCode,
        grossAmount,
        signatureKey: body.signature_key || ""
      });
      if (!valid) {
        res.status(401).json({ error: "Invalid Midtrans QRIS webhook signature." });
        return;
      }
    } else {
      const secret = process.env.QRIS_WEBHOOK_SECRET || (!IS_PRODUCTION ? PLAYBACK_SECRET : "");
      const sigHeader = String(req.headers["x-vyora-webhook-signature"] || "");
      if (!secret || !sigHeader) {
        res.status(401).json({ error: "Missing QRIS webhook authentication." });
        return;
      }
      const expected = crypto3.createHmac("sha256", secret).update(JSON.stringify(body)).digest("hex");
      const a = Buffer.from(expected, "utf8");
      const b = Buffer.from(sigHeader, "utf8");
      if (a.length !== b.length || !crypto3.timingSafeEqual(a, b)) {
        res.status(401).json({ error: "Invalid QRIS webhook signature." });
        return;
      }
    }
    if (!isValidSafeId(orderId)) {
      res.status(400).json({ error: "Invalid order_id." });
      return;
    }
    const eventKey = `qris:${orderId}:${body.transaction_status || "unknown"}`;
    try {
      if (await isWebhookProcessedSql(eventKey)) {
        res.json({ ok: true, duplicate: true });
        return;
      }
      const payment = await getPaymentByIdSql(orderId);
      if (!payment) {
        res.status(404).json({ error: "QRIS payment order not found." });
        return;
      }
      const parsedGross = Number(grossAmount);
      const qrisAmountValid = !grossAmount || Number.isFinite(parsedGross) && Math.round(parsedGross) === payment.amount;
      if (qrisAmountValid && (body.transaction_status === "settlement" || body.transaction_status === "capture")) {
        const video = payment.purpose === "video_unlock" ? await resolveServerVideoEntry(
          payment.targetId,
          firebase_applet_config_default.projectId,
          firebase_applet_config_default.firestoreDatabaseId
        ) : null;
        const settled = await fulfillPaymentAtomicSql({
          paymentId: payment.id,
          videoEntry: video,
          webhookEventKey: eventKey
        });
        res.json({
          ok: true,
          duplicate: Boolean(settled.duplicateWebhook),
          status: settled.payment?.status ?? "completed"
        });
        return;
      }
      const nextStatus = body.transaction_status === "expire" ? "expired" : body.transaction_status === "cancel" || body.transaction_status === "deny" ? "failed" : void 0;
      const recorded = await recordWebhookOnlyOrFailureSql({
        webhookEventKey: eventKey,
        paymentId: orderId,
        nextStatus
      });
      if (recorded.notFound) {
        res.status(404).json({ error: "QRIS payment order not found." });
        return;
      }
      res.json({ ok: true, duplicate: recorded.duplicate, status: recorded.status });
    } catch (err) {
      res.status(isSqlConfigured() ? 500 : 503).json({
        error: err instanceof Error ? err.message : "QRIS webhook processing failed."
      });
    }
  });
  app2.get("/api/creator/earnings/me", requireAuth, async (req, res) => {
    try {
      const summary = await getCreatorEarningsSummarySql(req.user.uid);
      res.json(summary);
    } catch (err) {
      res.status(isSqlConfigured() ? 500 : 503).json({
        error: err instanceof Error ? err.message : "Unable to load creator earnings."
      });
    }
  });
  app2.post("/api/creator/payouts/request", requireAuth, async (req, res) => {
    const uid = req.user.uid;
    const idemKey = getIdempotencyKey(req);
    const { creatorName, currency, amount, method, destination } = req.body;
    const validMethod = method === "bank_transfer_idr" || method === "ewallet_idr" || method === "paypal_usd" ? method : null;
    if (currency !== "USD" && currency !== "IDR" || !validMethod || currency === "USD" && validMethod !== "paypal_usd" || currency === "IDR" && validMethod !== "bank_transfer_idr" && validMethod !== "ewallet_idr" || typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 || typeof destination !== "string" || destination.trim().length < 4) {
      res.status(400).json({ error: "Invalid payout request fields or currency/channel mismatch." });
      return;
    }
    try {
      const result = await requestCreatorPayoutAtomicSql({
        uid,
        creatorName: typeof creatorName === "string" && creatorName.trim().length >= 2 ? creatorName.trim().slice(0, 80) : req.user.email || "DELOKEN Creator",
        currency,
        amount,
        method: validMethod,
        destination: destination.trim().slice(0, 160),
        payoutId: `payo_${crypto3.randomUUID().slice(0, 10)}`,
        idemKey
      });
      res.status(result.status).json(result.body);
    } catch (err) {
      res.status(isSqlConfigured() ? 500 : 503).json({
        error: err instanceof Error ? err.message : "Failed to request creator payout."
      });
    }
  });
  app2.get("/api/admin/finance/overview", requireAdmin, async (_req, res) => {
    try {
      const overview = await getAdminFinanceOverviewSql();
      res.json(overview);
    } catch (err) {
      res.status(isSqlConfigured() ? 500 : 503).json({
        error: err instanceof Error ? err.message : "Failed to load admin overview."
      });
    }
  });
  app2.post("/api/admin/refunds", requireAdmin, async (req, res) => {
    const idemKey = getIdempotencyKey(req);
    const { paymentId } = req.body;
    if (!isValidSafeId(paymentId)) {
      res.status(400).json({ error: "Invalid paymentId." });
      return;
    }
    try {
      const result = await refundPaymentAtomicSql({
        adminUid: req.user.uid,
        paymentId,
        idemKey
      });
      res.status(result.status).json(result.body);
    } catch (err) {
      res.status(isSqlConfigured() ? 500 : 503).json({
        error: err instanceof Error ? err.message : "Refund processing failed."
      });
    }
  });
  app2.post("/api/admin/payments/:paymentId/approve", requireAdmin, async (req, res) => {
    const paymentId = req.params.paymentId;
    const idemKey = getIdempotencyKey(req);
    if (!isValidSafeId(paymentId)) {
      res.status(400).json({ error: "Invalid paymentId." });
      return;
    }
    try {
      const cached = await checkIdempotencySql("admin_approve", req.user.uid, idemKey);
      if (cached) {
        res.status(cached.status).json(cached.body);
        return;
      }
      const payment = await getPaymentByIdSql(paymentId);
      if (!payment) {
        res.status(404).json({ error: "Payment order not found." });
        return;
      }
      if (payment.status === "refunded" || payment.status === "failed" || payment.status === "expired") {
        res.status(400).json({
          error: `Cannot approve payment in '${payment.status}' status.`
        });
        return;
      }
      const videoEntry = payment.purpose === "video_unlock" ? await resolveServerVideoEntry(
        payment.targetId,
        firebase_applet_config_default.projectId,
        firebase_applet_config_default.firestoreDatabaseId
      ) : null;
      const settled = await fulfillPaymentAtomicSql({
        paymentId,
        videoEntry,
        idemScope: "admin_approve",
        idemUid: req.user.uid,
        idemKey
      });
      if (settled.notFound) {
        res.status(404).json({ error: "Payment order not found." });
        return;
      }
      if (settled.invalidStatus) {
        res.status(400).json({
          error: `Cannot approve payment in '${settled.invalidStatus}' status.`
        });
        return;
      }
      const overview = await getAdminFinanceOverviewSql();
      res.json({
        ok: true,
        payment: settled.payment,
        overview
      });
    } catch (err) {
      res.status(isSqlConfigured() ? 500 : 503).json({
        error: err instanceof Error ? err.message : "Failed to approve pending payment."
      });
    }
  });
  app2.post("/api/admin/payouts/:payoutId/status", requireAdmin, async (req, res) => {
    const payoutId = req.params.payoutId;
    const { status, adminNote } = req.body;
    if (!isValidSafeId(payoutId) || status !== "processing" && status !== "paid" && status !== "rejected") {
      res.status(400).json({ error: "Invalid payoutId or status." });
      return;
    }
    try {
      const result = await updatePayoutStatusSql({
        payoutId,
        status,
        adminNote: typeof adminNote === "string" ? adminNote : void 0
      });
      res.status(result.status).json(result.body);
    } catch (err) {
      res.status(isSqlConfigured() ? 500 : 503).json({
        error: err instanceof Error ? err.message : "Failed to update payout status."
      });
    }
  });
  app2.post("/api/admin/settings", requireAdmin, async (req, res) => {
    const { commissionPercent, minPriceUsd, minPriceIdr } = req.body;
    if (typeof commissionPercent !== "number" || commissionPercent < 0 || commissionPercent > 50) {
      res.status(400).json({ error: "Invalid commissionPercent (0-50)." });
      return;
    }
    try {
      await updatePlatformSettingsSql({
        commissionPercent,
        minPriceUsd: typeof minPriceUsd === "number" ? minPriceUsd : void 0,
        minPriceIdr: typeof minPriceIdr === "number" ? minPriceIdr : void 0
      });
      res.json({ ok: true });
    } catch (err) {
      res.status(isSqlConfigured() ? 500 : 503).json({
        error: err instanceof Error ? err.message : "Failed to update settings."
      });
    }
  });
  return app2;
}

// server/vercelEntry.ts
var app = createApiApp();
var vercelEntry_default = app;
export {
  vercelEntry_default as default
};
