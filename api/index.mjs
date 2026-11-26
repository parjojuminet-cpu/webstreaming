var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// server/app.ts
import crypto4 from "node:crypto";
import fs4 from "node:fs";
import os2 from "node:os";
import path4 from "node:path";
import express from "express";
import dotenv from "dotenv";

// server/paymentService.ts
import crypto from "node:crypto";
import fs from "node:fs";
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
async function withLedgerLock(task) {
  const previous = mutexTail;
  let release;
  mutexTail = new Promise((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await task();
  } finally {
    release();
  }
}
function ensureDataDir() {
  if (!fs.existsSync(SERVER_DATA_DIR)) {
    fs.mkdirSync(SERVER_DATA_DIR, { recursive: true });
  }
}
function loadLedger() {
  ensureDataDir();
  if (fs.existsSync(LEDGER_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(LEDGER_FILE, "utf-8"));
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
        videoDeletionJobs: parsed.videoDeletionJobs ?? [],
        platformSettings: parsed.platformSettings ?? {
          commissionPercent: 20,
          minPriceUsd: 1.99,
          minPriceIdr: 29e3
        }
      };
    } catch {
    }
  }
  let initialEntitlements = {};
  if (fs.existsSync(LEGACY_ENTITLEMENTS_FILE)) {
    try {
      initialEntitlements = JSON.parse(
        fs.readFileSync(LEGACY_ENTITLEMENTS_FILE, "utf-8")
      );
    } catch {
      initialEntitlements = {};
    }
  }
  const initial = {
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
    videoDeletionJobs: [],
    platformSettings: {
      commissionPercent: 20,
      minPriceUsd: 1.99,
      minPriceIdr: 29e3
    }
  };
  saveLedger(initial);
  return initial;
}
function saveLedger(state) {
  ensureDataDir();
  const idemKeys = Object.keys(state.idempotency);
  if (idemKeys.length > 1e3) {
    idemKeys.sort((a, b) => state.idempotency[a].createdAtMs - state.idempotency[b].createdAtMs).slice(0, idemKeys.length - 1e3).forEach((k) => {
      delete state.idempotency[k];
    });
  }
  const tempFile = path.resolve(
    SERVER_DATA_DIR,
    `ledger.${process.pid}.${Date.now()}.tmp`
  );
  fs.writeFileSync(tempFile, JSON.stringify(state, null, 2), "utf-8");
  fs.renameSync(tempFile, LEDGER_FILE);
}
function entitlementKey(uid, videoId) {
  return `${uid}::${videoId}`;
}
async function resolveServerVideoState(videoId, projectId, databaseId, callerIdToken) {
  if (SERVER_CATALOG[videoId]) {
    return { state: "published", entry: SERVER_CATALOG[videoId] };
  }
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      projectId
    )}/databases/${encodeURIComponent(databaseId)}/documents/videos/${encodeURIComponent(
      videoId
    )}`;
    const res = await fetch(
      url,
      callerIdToken ? { headers: { Authorization: `Bearer ${callerIdToken}` } } : void 0
    );
    if (res.status === 404) {
      return { state: "not_found", entry: null };
    }
    if (res.status === 403 || res.status === 401) {
      return { state: "unavailable", entry: null };
    }
    if (!res.ok) {
      return { state: "error", entry: null };
    }
    const doc = await res.json();
    const f = doc.fields;
    if (!f) return { state: "not_found", entry: null };
    const rawStatus = f.status?.stringValue || "draft";
    const validStates = /* @__PURE__ */ new Set([
      "published",
      "archived",
      "deletion_pending",
      "draft",
      "pending_review",
      "approved",
      "rejected"
    ]);
    const state = validStates.has(rawStatus) ? rawStatus : "unavailable";
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
      state,
      entry: {
        id: videoId,
        title: f.title?.stringValue || videoId,
        category: f.category?.stringValue || "Movies",
        creatorId: f.creatorId?.stringValue || "creator-unknown",
        thumbnailUrl: f.thumbnailUrl?.stringValue || "",
        priceUsd,
        priceIdr,
        creditCost
      }
    };
  } catch {
    return { state: "error", entry: null };
  }
}
async function resolveServerVideoEntry(videoId, projectId, databaseId) {
  const resolved = await resolveServerVideoState(videoId, projectId, databaseId);
  if (resolved.state !== "published") return null;
  return resolved.entry;
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
  videoDeletionJobs: () => videoDeletionJobs,
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
var videoDeletionJobs = pgTable("video_deletion_jobs", {
  operationId: text("operation_id").primaryKey(),
  videoId: text("video_id").notNull(),
  videoTitleSnapshot: text("video_title_snapshot").notNull(),
  provider: text("provider").notNull(),
  assetRefFingerprint: text("asset_ref_fingerprint").notNull(),
  requestedBy: text("requested_by").notNull(),
  requestedAt: text("requested_at").notNull(),
  status: text("status").notNull(),
  providerResult: text("provider_result").notNull().default("pending"),
  firestoreResult: text("firestore_result").notNull().default("pending"),
  sqlResult: text("sql_result").notNull().default("pending"),
  thumbnailResult: text("thumbnail_result").notNull().default("skipped"),
  externalMediaWarning: text("external_media_warning"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  completedAt: text("completed_at")
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
import fs2 from "node:fs";
import path2 from "node:path";
import { and, desc, eq, gte, sql } from "drizzle-orm";
var SERVER_DATA_DIR2 = path2.resolve(process.cwd(), ".vyora_server_data");
var LEGACY_LEDGER_FILE = path2.resolve(SERVER_DATA_DIR2, "ledger.json");
var migrationPromise = null;
var TABLE_DDL_STATEMENTS = [
  {
    tableName: "users",
    ddl: sql`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        uid TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `
  },
  {
    tableName: "wallets",
    ddl: sql`
      CREATE TABLE IF NOT EXISTS wallets (
        user_id TEXT PRIMARY KEY,
        balance_credits INTEGER NOT NULL DEFAULT 0,
        total_spent_credits INTEGER NOT NULL DEFAULT 0,
        updated_at_ms BIGINT NOT NULL
      )
    `
  },
  {
    tableName: "wallet_transactions",
    ddl: sql`
      CREATE TABLE IF NOT EXISTS wallet_transactions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        credits_delta INTEGER NOT NULL,
        description TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `
  },
  {
    tableName: "payments",
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
    `
  },
  {
    tableName: "purchases",
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
    `
  },
  {
    tableName: "entitlements",
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
    `
  },
  {
    tableName: "creator_earnings",
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
    `
  },
  {
    tableName: "payouts",
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
    `
  },
  {
    tableName: "idempotency_records",
    ddl: sql`
      CREATE TABLE IF NOT EXISTS idempotency_records (
        full_key TEXT PRIMARY KEY,
        status INTEGER NOT NULL,
        body_json JSONB NOT NULL,
        created_at_ms BIGINT NOT NULL
      )
    `
  },
  {
    tableName: "processed_webhooks",
    ddl: sql`
      CREATE TABLE IF NOT EXISTS processed_webhooks (
        event_key TEXT PRIMARY KEY,
        processed_at_ms BIGINT NOT NULL
      )
    `
  },
  {
    tableName: "creator_media",
    ddl: sql`
      CREATE TABLE IF NOT EXISTS creator_media (
        video_id TEXT PRIMARY KEY,
        creator_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        asset_ref TEXT NOT NULL,
        mime_type TEXT,
        updated_at_iso TEXT NOT NULL
      )
    `
  },
  {
    tableName: "platform_settings",
    ddl: sql`
      CREATE TABLE IF NOT EXISTS platform_settings (
        id TEXT PRIMARY KEY,
        commission_percent INTEGER NOT NULL DEFAULT 20,
        min_price_usd DOUBLE PRECISION NOT NULL DEFAULT 1.99,
        min_price_idr INTEGER NOT NULL DEFAULT 29000
      )
    `
  },
  {
    tableName: "video_deletion_jobs",
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
    `
  }
];
async function ensureSqlTablesExist() {
  const existingResult = await db.execute(sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
  `);
  const existingTables = new Set(
    (existingResult.rows ?? []).map((row) => String(row.table_name ?? "").trim()).filter(Boolean)
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
      const code = err?.code ?? err?.cause?.code;
      if (code === "42501") {
        throw new Error(
          `Database table "${tableName}" is missing and the runtime SQL role lacks schema CREATE privileges. Push the Drizzle schema using admin credentials.`,
          { cause: err }
        );
      }
      throw err;
    }
  }
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
        if (!fs2.existsSync(LEGACY_LEDGER_FILE)) return;
        const raw = fs2.readFileSync(LEGACY_LEDGER_FILE, "utf-8");
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
function mapDeletionJobRow(row) {
  return {
    operationId: row.operationId,
    videoId: row.videoId,
    videoTitleSnapshot: row.videoTitleSnapshot,
    provider: row.provider,
    assetRefFingerprint: row.assetRefFingerprint,
    requestedBy: row.requestedBy,
    requestedAt: row.requestedAt,
    status: row.status,
    providerResult: row.providerResult,
    firestoreResult: row.firestoreResult,
    sqlResult: row.sqlResult,
    thumbnailResult: row.thumbnailResult,
    externalMediaWarning: row.externalMediaWarning ?? null,
    errorCode: row.errorCode ?? null,
    errorMessage: row.errorMessage ?? null,
    completedAt: row.completedAt ?? null
  };
}
async function createVideoDeletionJobSql(job) {
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
    completedAt: job.completedAt ?? null
  });
  return job;
}
async function updateVideoDeletionJobSql(operationId, patch) {
  await ensureLegacyLedgerMigrated();
  await db.update(videoDeletionJobs).set({
    ...patch.videoTitleSnapshot !== void 0 ? { videoTitleSnapshot: patch.videoTitleSnapshot } : {},
    ...patch.provider !== void 0 ? { provider: patch.provider } : {},
    ...patch.assetRefFingerprint !== void 0 ? { assetRefFingerprint: patch.assetRefFingerprint } : {},
    ...patch.status !== void 0 ? { status: patch.status } : {},
    ...patch.providerResult !== void 0 ? { providerResult: patch.providerResult } : {},
    ...patch.firestoreResult !== void 0 ? { firestoreResult: patch.firestoreResult } : {},
    ...patch.sqlResult !== void 0 ? { sqlResult: patch.sqlResult } : {},
    ...patch.thumbnailResult !== void 0 ? { thumbnailResult: patch.thumbnailResult } : {},
    ...patch.externalMediaWarning !== void 0 ? { externalMediaWarning: patch.externalMediaWarning } : {},
    ...patch.errorCode !== void 0 ? { errorCode: patch.errorCode } : {},
    ...patch.errorMessage !== void 0 ? { errorMessage: patch.errorMessage } : {},
    ...patch.completedAt !== void 0 ? { completedAt: patch.completedAt } : {}
  }).where(eq(videoDeletionJobs.operationId, operationId));
}
async function getLatestVideoDeletionJobSql(videoId) {
  await ensureLegacyLedgerMigrated();
  const rows = await db.select().from(videoDeletionJobs).where(eq(videoDeletionJobs.videoId, videoId)).orderBy(desc(videoDeletionJobs.requestedAt));
  return rows[0] ? mapDeletionJobRow(rows[0]) : null;
}
async function listVideoDeletionJobsSql(limitCount = 40) {
  await ensureLegacyLedgerMigrated();
  const rows = await db.select().from(videoDeletionJobs).orderBy(desc(videoDeletionJobs.requestedAt)).limit(Math.max(1, Math.min(100, limitCount)));
  return rows.map(mapDeletionJobRow);
}
async function getCreatorMediaByVideoIdSql(videoId) {
  await ensureLegacyLedgerMigrated();
  const rows = await db.select().from(creatorMedia).where(eq(creatorMedia.videoId, videoId));
  const m = rows[0];
  if (!m || m.provider === "thumbnail") return null;
  return {
    videoId: m.videoId,
    creatorId: m.creatorId,
    provider: m.provider,
    assetRef: m.assetRef,
    mimeType: m.mimeType ?? void 0,
    updatedAtIso: m.updatedAtIso
  };
}
async function deleteCreatorMediaByVideoIdSql(videoId) {
  await ensureLegacyLedgerMigrated();
  const deleted = await db.delete(creatorMedia).where(eq(creatorMedia.videoId, videoId)).returning();
  return { deletedCount: deleted.length };
}
async function deleteThumbnailAssetSql(key) {
  await ensureLegacyLedgerMigrated();
  const deleted = await db.delete(creatorMedia).where(and(eq(creatorMedia.videoId, key), eq(creatorMedia.provider, "thumbnail"))).returning();
  return { deletedCount: deleted.length };
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
async function deleteCloudflareVideo(uid) {
  const cleanUid = uid.trim();
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(cleanUid)) {
    throw new Error("Invalid Cloudflare Stream video UID.");
  }
  const { accountId, apiToken } = getAccountAndToken();
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
    accountId
  )}/stream/${encodeURIComponent(cleanUid)}`;
  const res = await fetch(endpoint, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${apiToken}`
    }
  });
  if (res.status === 404) {
    return { deleted: true, alreadyMissing: true };
  }
  if (!res.ok) {
    throw new Error(`Cloudflare Stream deletion failed with HTTP ${res.status}.`);
  }
  return { deleted: true, alreadyMissing: false };
}

// server/mediaLifecycle.ts
import crypto3 from "node:crypto";
import fs3 from "node:fs";
import path3 from "node:path";

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

// src/utils/youtube.ts
var YOUTUBE_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;
var YOUTUBE_PLAYLIST_ID_REGEX = /^[a-zA-Z0-9_-]{10,64}$/;
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
  if (withoutPrefix.startsWith("playlist:")) {
    return null;
  }
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
      if (parts.length >= 2 && (parts[0] === "embed" || parts[0] === "shorts" || parts[0] === "live" || parts[0] === "v") && parts[1] !== "videoseries") {
        candidate = parts[1];
      }
    }
  }
  if (candidate && YOUTUBE_ID_REGEX.test(candidate)) {
    return candidate;
  }
  return null;
}
function extractYouTubePlaylistId(rawInput) {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;
  const withoutPrefix = trimmed.startsWith("youtube:") ? trimmed.slice("youtube:".length).trim() : trimmed;
  if (withoutPrefix.startsWith("playlist:")) {
    const candidate = withoutPrefix.slice("playlist:".length).trim();
    return YOUTUBE_PLAYLIST_ID_REGEX.test(candidate) ? candidate : null;
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
  const parts = parsed.pathname.split("/").filter(Boolean);
  const isPlaylistPath = parts[0] === "playlist" || parts[0] === "embed" && parts[1] === "videoseries";
  if (!isPlaylistPath) {
    return null;
  }
  const listParam = parsed.searchParams.get("list")?.trim() || "";
  if (YOUTUBE_PLAYLIST_ID_REGEX.test(listParam)) {
    return listParam;
  }
  return null;
}
function extractYouTubeEmbedTarget(rawInput) {
  const videoId = extractYouTubeVideoId(rawInput);
  if (videoId) {
    return {
      kind: "video",
      videoId,
      canonicalRef: videoId,
      canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
      embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}`
    };
  }
  const playlistId = extractYouTubePlaylistId(rawInput);
  if (playlistId) {
    return {
      kind: "playlist",
      playlistId,
      canonicalRef: `playlist:${playlistId}`,
      canonicalUrl: `https://www.youtube.com/playlist?list=${playlistId}`,
      embedUrl: `https://www.youtube-nocookie.com/embed/videoseries?list=${playlistId}`
    };
  }
  return null;
}
function getYouTubeThumbnailUrl(videoId) {
  const cleanId = extractYouTubeVideoId(videoId);
  if (!cleanId) return "";
  return `https://i.ytimg.com/vi/${cleanId}/hqdefault.jpg`;
}

// src/services/videoImport/urlGuards.ts
var PRIVATE_IPV4_REGEX = /^(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}|0\.0\.0\.0)$/;
function isDisallowedClientHost(hostname, allowLocalDev = false) {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return true;
  if (host === "localhost" || host === "localhost.localdomain" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0") {
    return !allowLocalDev;
  }
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost") || host.endsWith(".arpa")) {
    return true;
  }
  if (PRIVATE_IPV4_REGEX.test(host)) {
    return true;
  }
  if (/^(?:fc|fd|fe8|fe9|fea|feb)[0-9a-f]{1,2}:/i.test(host) || host.startsWith("::ffff:")) {
    return true;
  }
  return false;
}
function parseStrictHttpsUrl(rawInput, options) {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return {
      ok: false,
      reasonCode: "EMPTY_URL",
      messageId: "Masukkan tautan video terlebih dahulu.",
      messageEn: "Please paste a video URL first."
    };
  }
  if (/[\u0000-\u001f\u007f]/.test(trimmed) || /\s/.test(trimmed)) {
    return {
      ok: false,
      reasonCode: "MALFORMED_URL",
      messageId: "Tautan mengandung spasi atau karakter kontrol yang tidak valid.",
      messageEn: "URL contains invalid whitespace or control characters."
    };
  }
  if (trimmed.length > 980) {
    return {
      ok: false,
      reasonCode: "URL_TOO_LONG",
      messageId: "Tautan terlalu panjang (maksimal 980 karakter).",
      messageEn: "URL is too long (maximum 980 characters)."
    };
  }
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("javascript:") || lower.startsWith("data:") || lower.startsWith("blob:") || lower.startsWith("file:") || lower.startsWith("vbscript:") || lower.startsWith("ftp:")) {
    return {
      ok: false,
      reasonCode: "UNSUPPORTED_SCHEME",
      messageId: "Skema tautan tidak diizinkan. Hanya tautan HTTPS resmi yang diperbolehkan.",
      messageEn: "URL scheme is not allowed. Only official HTTPS links are permitted."
    };
  }
  const hasExplicitScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed);
  if (!hasExplicitScheme && options?.allowBareHostname === false) {
    return {
      ok: false,
      reasonCode: "MISSING_HTTPS",
      messageId: "Tautan harus diawali dengan https://.",
      messageEn: "URL must start with https://."
    };
  }
  const candidate = hasExplicitScheme ? trimmed : `https://${trimmed}`;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return {
      ok: false,
      reasonCode: "INVALID_URL",
      messageId: "Format URL tidak valid.",
      messageEn: "Invalid URL syntax."
    };
  }
  if (parsed.username || parsed.password) {
    return {
      ok: false,
      reasonCode: "CREDENTIALS_IN_URL",
      messageId: "Tautan tidak boleh menyertakan username atau password.",
      messageEn: "URLs with embedded credentials are not allowed."
    };
  }
  const isLocalHost = parsed.hostname.toLowerCase() === "localhost" || parsed.hostname === "127.0.0.1";
  const allowLocal = Boolean(options?.allowLocalHttp && isLocalHost);
  if (parsed.protocol !== "https:" && !(allowLocal && parsed.protocol === "http:")) {
    return {
      ok: false,
      reasonCode: "HTTPS_REQUIRED",
      messageId: "Hanya protokol HTTPS yang diizinkan untuk tautan video eksternal.",
      messageEn: "Only HTTPS URLs are permitted for external video links."
    };
  }
  if (isDisallowedClientHost(parsed.hostname, allowLocal)) {
    return {
      ok: false,
      reasonCode: "PRIVATE_OR_LOCAL_HOST_BLOCKED",
      messageId: "Alamat jaringan lokal atau IP internal tidak diizinkan.",
      messageEn: "Local network or private IP addresses are not permitted."
    };
  }
  if (!parsed.hostname.includes(".") && !allowLocal) {
    return {
      ok: false,
      reasonCode: "INVALID_HOST",
      messageId: "Domain pada tautan tidak valid.",
      messageEn: "Invalid domain name in URL."
    };
  }
  return { ok: true, url: parsed };
}

// src/services/videoImport/adapters.ts
var YOUTUBE_HOSTS = /* @__PURE__ */ new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com"
]);
var VIMEO_HOSTS = /* @__PURE__ */ new Set([
  "vimeo.com",
  "www.vimeo.com",
  "player.vimeo.com"
]);
var DAILYMOTION_HOSTS = /* @__PURE__ */ new Set([
  "dailymotion.com",
  "www.dailymotion.com",
  "dai.ly",
  "www.dai.ly",
  "geo.dailymotion.com"
]);
var STREAMABLE_HOSTS = /* @__PURE__ */ new Set([
  "streamable.com",
  "www.streamable.com"
]);
var TIKTOK_HOSTS = /* @__PURE__ */ new Set([
  "tiktok.com",
  "www.tiktok.com",
  "m.tiktok.com",
  "vt.tiktok.com",
  "vm.tiktok.com"
]);
var FACEBOOK_HOSTS = /* @__PURE__ */ new Set([
  "facebook.com",
  "www.facebook.com",
  "m.facebook.com",
  "web.facebook.com",
  "mbasic.facebook.com",
  "fb.watch",
  "www.fb.watch"
]);
var X_HOSTS = /* @__PURE__ */ new Set([
  "x.com",
  "www.x.com",
  "mobile.x.com",
  "twitter.com",
  "www.twitter.com",
  "mobile.twitter.com"
]);
var INSTAGRAM_HOSTS = /* @__PURE__ */ new Set([
  "instagram.com",
  "www.instagram.com",
  "m.instagram.com"
]);
function extractVimeoVideoRef(rawInput) {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.startsWith("vimeo:") ? trimmed.slice("vimeo:".length).trim() : trimmed;
  if (/^\d{5,14}(?::[a-zA-Z0-9]{6,24})?$/.test(cleaned)) {
    const [id2, hash2] = cleaned.split(":");
    const qs2 = hash2 ? `?h=${encodeURIComponent(hash2)}` : "";
    return {
      id: id2,
      hash: hash2,
      canonicalRef: hash2 ? `${id2}:${hash2}` : id2,
      canonicalUrl: hash2 ? `https://vimeo.com/${id2}/${hash2}` : `https://vimeo.com/${id2}`,
      embedUrl: `https://player.vimeo.com/video/${id2}${qs2}`
    };
  }
  const parsedRes = parseStrictHttpsUrl(cleaned, { allowBareHostname: true });
  if (!parsedRes.ok) return null;
  const parsed = parsedRes.url;
  const host = parsed.hostname.toLowerCase();
  if (!VIMEO_HOSTS.has(host)) return null;
  const segments = parsed.pathname.split("/").filter(Boolean);
  let id = null;
  let hash = parsed.searchParams.get("h") || void 0;
  if (host === "player.vimeo.com" && segments[0] === "video" && /^\d{5,14}$/.test(segments[1] || "")) {
    id = segments[1];
  } else if (segments.length >= 1) {
    for (let i = 0; i < segments.length; i += 1) {
      if (/^\d{5,14}$/.test(segments[i])) {
        id = segments[i];
        if (!hash && segments[i + 1] && /^[a-zA-Z0-9]{6,24}$/.test(segments[i + 1])) {
          hash = segments[i + 1];
        }
        break;
      }
    }
  }
  if (!id) return null;
  const safeHash = hash && /^[a-zA-Z0-9]{6,24}$/.test(hash) ? hash : void 0;
  const qs = safeHash ? `?h=${encodeURIComponent(safeHash)}` : "";
  return {
    id,
    hash: safeHash,
    canonicalRef: safeHash ? `${id}:${safeHash}` : id,
    canonicalUrl: safeHash ? `https://vimeo.com/${id}/${safeHash}` : `https://vimeo.com/${id}`,
    embedUrl: `https://player.vimeo.com/video/${id}${qs}`
  };
}
function extractDailymotionVideoId(rawInput) {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.startsWith("dailymotion:") ? trimmed.slice("dailymotion:".length).trim() : trimmed;
  if (/^x[a-zA-Z0-9]{5,12}$/.test(cleaned)) {
    return cleaned;
  }
  const parsedRes = parseStrictHttpsUrl(cleaned, { allowBareHostname: true });
  if (!parsedRes.ok) return null;
  const parsed = parsedRes.url;
  const host = parsed.hostname.toLowerCase();
  if (!DAILYMOTION_HOSTS.has(host)) return null;
  const segs = parsed.pathname.split("/").filter(Boolean);
  let candidate = null;
  if (host === "dai.ly" || host === "www.dai.ly") {
    candidate = segs[0] || null;
  } else if (host === "geo.dailymotion.com") {
    candidate = parsed.searchParams.get("video");
  } else if (segs[0] === "video" && segs[1]) {
    candidate = segs[1].split("_")[0] || null;
  } else if (segs[0] === "embed" && segs[1] === "video" && segs[2]) {
    candidate = segs[2].split("_")[0] || null;
  }
  if (candidate && /^[a-zA-Z0-9]{5,16}$/.test(candidate)) {
    return candidate;
  }
  return null;
}
function extractStreamableId(rawInput) {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.startsWith("streamable:") ? trimmed.slice("streamable:".length).trim() : trimmed;
  if (/^[a-zA-Z0-9]{4,14}$/.test(cleaned) && trimmed.startsWith("streamable:")) {
    return cleaned;
  }
  const parsedRes = parseStrictHttpsUrl(cleaned, { allowBareHostname: true });
  if (!parsedRes.ok) return null;
  const parsed = parsedRes.url;
  if (!STREAMABLE_HOSTS.has(parsed.hostname.toLowerCase())) return null;
  const segs = parsed.pathname.split("/").filter(Boolean);
  const candidate = segs[0] === "e" || segs[0] === "o" || segs[0] === "s" ? segs[1] : segs[0];
  if (candidate && /^[a-zA-Z0-9]{4,14}$/.test(candidate)) {
    return candidate;
  }
  return null;
}
function extractTikTokVideoInfo(rawInput) {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.startsWith("tiktok:") ? trimmed.slice("tiktok:".length).trim() : trimmed;
  if (/^\d{15,24}$/.test(cleaned) && trimmed.startsWith("tiktok:")) {
    return {
      videoId: cleaned,
      canonicalUrl: `https://www.tiktok.com/video/${cleaned}`,
      canonicalRef: cleaned,
      isShortUrl: false
    };
  }
  const parsedRes = parseStrictHttpsUrl(cleaned, { allowBareHostname: true });
  if (!parsedRes.ok) return null;
  const parsed = parsedRes.url;
  const host = parsed.hostname.toLowerCase();
  if (!TIKTOK_HOSTS.has(host)) return null;
  const segs = parsed.pathname.split("/").filter(Boolean);
  if (host === "vm.tiktok.com" || host === "vt.tiktok.com" || segs[0] === "t") {
    const code = host === "vm.tiktok.com" || host === "vt.tiktok.com" ? segs[0] : segs[1];
    if (!code || !/^[a-zA-Z0-9_-]{4,40}$/.test(code)) return null;
    const canonicalUrl = `https://${host}/${segs[0] === "t" ? `t/${code}` : code}/`;
    return {
      videoId: null,
      canonicalUrl,
      canonicalRef: canonicalUrl,
      isShortUrl: true
    };
  }
  const vidIndex = segs.indexOf("video");
  if (vidIndex >= 0 && segs[vidIndex + 1] && /^\d{15,24}$/.test(segs[vidIndex + 1])) {
    const videoId = segs[vidIndex + 1];
    const handle = vidIndex === 1 && segs[0].startsWith("@") ? segs[0] : null;
    const canonicalUrl = handle ? `https://www.tiktok.com/${handle}/video/${videoId}` : `https://www.tiktok.com/video/${videoId}`;
    return {
      videoId,
      canonicalUrl,
      canonicalRef: canonicalUrl,
      isShortUrl: false
    };
  }
  if (segs[0] === "embed" && segs[1] === "v2" && segs[2] && /^\d{15,24}$/.test(segs[2])) {
    const videoId = segs[2];
    return {
      videoId,
      canonicalUrl: `https://www.tiktok.com/video/${videoId}`,
      canonicalRef: `https://www.tiktok.com/video/${videoId}`,
      isShortUrl: false
    };
  }
  return null;
}
function extractXPostInfo(rawInput) {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.startsWith("x:") ? trimmed.slice("x:".length).trim() : trimmed;
  const parsedRes = parseStrictHttpsUrl(cleaned, { allowBareHostname: true });
  if (!parsedRes.ok) return null;
  const parsed = parsedRes.url;
  const host = parsed.hostname.toLowerCase();
  if (!X_HOSTS.has(host)) return null;
  const segs = parsed.pathname.split("/").filter(Boolean);
  let statusId = null;
  let username = "i";
  if (segs.length >= 3 && (segs[1] === "status" || segs[1] === "statuses") && /^\d{10,24}$/.test(segs[2])) {
    username = segs[0];
    statusId = segs[2];
  } else if (segs.length >= 4 && segs[0] === "i" && segs[2] === "status" && /^\d{10,24}$/.test(segs[3])) {
    username = "i";
    statusId = segs[3];
  }
  if (!statusId || !/^[a-zA-Z0-9_]{1,32}$/.test(username)) return null;
  const canonicalUrl = `https://x.com/${username}/status/${statusId}`;
  return { statusId, username, canonicalUrl };
}
function extractInstagramPostInfo(rawInput) {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.startsWith("instagram:") ? trimmed.slice("instagram:".length).trim() : trimmed;
  const parsedRes = parseStrictHttpsUrl(cleaned, { allowBareHostname: true });
  if (!parsedRes.ok) return null;
  const parsed = parsedRes.url;
  if (!INSTAGRAM_HOSTS.has(parsed.hostname.toLowerCase())) return null;
  const segs = parsed.pathname.split("/").filter(Boolean);
  if (segs.length < 2) return null;
  const rawKind = segs[0];
  const kind = rawKind === "p" ? "p" : rawKind === "reel" || rawKind === "reels" ? "reel" : rawKind === "tv" ? "tv" : null;
  const shortcode = segs[1];
  if (!kind || !shortcode || !/^[a-zA-Z0-9_-]{5,40}$/.test(shortcode)) return null;
  const canonicalUrl = `https://www.instagram.com/${kind}/${shortcode}/`;
  const embedUrl = `https://www.instagram.com/${kind}/${shortcode}/embed/`;
  return { kind, shortcode, canonicalUrl, embedUrl };
}
function inferDirectFormatFromUrl(url) {
  const pathname = url.pathname.toLowerCase();
  if (pathname.endsWith(".m3u8")) return "hls";
  if (pathname.endsWith(".mpd")) return "dash";
  if (pathname.endsWith(".mp4") || pathname.endsWith(".m4v") || pathname.endsWith(".webm") || pathname.endsWith(".mov") || pathname.endsWith(".ogv") || pathname.endsWith(".ogg")) {
    return "mp4";
  }
  const formatParam = (url.searchParams.get("format") || "").toLowerCase();
  if (formatParam === "m3u8" || formatParam === "hls") return "hls";
  if (formatParam === "mpd" || formatParam === "dash") return "dash";
  if (formatParam === "mp4" || formatParam === "webm") return "mp4";
  return null;
}
var youtubeAdapter = {
  id: "youtube",
  label: "YouTube",
  allowedHosts: YOUTUBE_HOSTS,
  verifiability: "verifiable",
  detect: (rawInput) => {
    const trimmed = rawInput.trim();
    if (!trimmed) return null;
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
      const check = parseStrictHttpsUrl(trimmed, { allowBareHostname: false });
      if (!check.ok) return null;
      if (!YOUTUBE_HOSTS.has(check.url.hostname.toLowerCase())) return null;
    } else if (!trimmed.startsWith("youtube:") && !/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
      const check = parseStrictHttpsUrl(trimmed, { allowBareHostname: true });
      if (!check.ok || !YOUTUBE_HOSTS.has(check.url.hostname.toLowerCase())) return null;
    }
    const target = extractYouTubeEmbedTarget(trimmed);
    if (!target) return null;
    if (target.kind === "playlist") {
      return {
        provider: "youtube",
        platformLabel: "YouTube Playlist",
        originalUrl: trimmed,
        canonicalRef: target.canonicalRef,
        canonicalUrl: target.canonicalUrl,
        embedUrl: target.embedUrl,
        verifiability: "verifiable",
        verifiabilityNoteId: "Menggunakan YouTube IFrame Player API resmi (Playlist). Sistem memverifikasi pemutaran nyata dan izin penyematan.",
        verifiabilityNoteEn: "Uses official YouTube IFrame Player API (Playlist). Real playback and embed permissions are verified directly."
      };
    }
    return {
      provider: "youtube",
      platformLabel: "YouTube",
      originalUrl: trimmed,
      canonicalRef: target.canonicalRef,
      canonicalUrl: target.canonicalUrl,
      embedUrl: target.embedUrl,
      thumbnailUrl: getYouTubeThumbnailUrl(target.videoId),
      verifiability: "verifiable",
      verifiabilityNoteId: "Menggunakan YouTube IFrame Player API resmi. Sistem dapat memverifikasi pemutaran nyata dan izin penyematan.",
      verifiabilityNoteEn: "Uses official YouTube IFrame Player API. Real playback and embed permissions are verified directly."
    };
  }
};
var vimeoAdapter = {
  id: "vimeo",
  label: "Vimeo",
  allowedHosts: VIMEO_HOSTS,
  verifiability: "verifiable",
  detect: (rawInput) => {
    const info = extractVimeoVideoRef(rawInput);
    if (!info) return null;
    return {
      provider: "vimeo",
      platformLabel: "Vimeo",
      originalUrl: rawInput.trim(),
      canonicalRef: info.canonicalRef,
      canonicalUrl: info.canonicalUrl,
      embedUrl: info.embedUrl,
      verifiability: "verifiable",
      verifiabilityNoteId: "Menggunakan Vimeo Player API resmi (postMessage). Pemutaran nyata diverifikasi langsung dari event player.",
      verifiabilityNoteEn: "Uses official Vimeo Player API (postMessage). Real playback is verified from live player events."
    };
  }
};
var dailymotionAdapter = {
  id: "dailymotion",
  label: "Dailymotion",
  allowedHosts: DAILYMOTION_HOSTS,
  verifiability: "verifiable",
  detect: (rawInput) => {
    const dmId = extractDailymotionVideoId(rawInput);
    if (!dmId) return null;
    return {
      provider: "dailymotion",
      platformLabel: "Dailymotion",
      originalUrl: rawInput.trim(),
      canonicalRef: dmId,
      canonicalUrl: `https://www.dailymotion.com/video/${dmId}`,
      embedUrl: `https://www.dailymotion.com/embed/video/${dmId}?api=postMessage&autoplay=0`,
      verifiability: "verifiable",
      verifiabilityNoteId: "Menggunakan Dailymotion Embed Player API resmi. Status putar diverifikasi dari event player resmi.",
      verifiabilityNoteEn: "Uses official Dailymotion Embed Player API. Playback status is verified from live player events."
    };
  }
};
var streamableAdapter = {
  id: "streamable",
  label: "Streamable",
  allowedHosts: STREAMABLE_HOSTS,
  verifiability: "conditional",
  detect: (rawInput) => {
    const id = extractStreamableId(rawInput);
    if (!id) return null;
    return {
      provider: "streamable",
      platformLabel: "Streamable",
      originalUrl: rawInput.trim(),
      canonicalRef: id,
      canonicalUrl: `https://streamable.com/${id}`,
      embedUrl: `https://streamable.com/e/${id}`,
      verifiability: "conditional",
      verifiabilityNoteId: "Menggunakan embed resmi Streamable. Tombol Lanjutkan aktif hanya jika player mengirim event pemutaran nyata.",
      verifiabilityNoteEn: "Uses official Streamable embed. Continue unlocks only if the embed emits real playback events."
    };
  }
};
var tiktokAdapter = {
  id: "tiktok",
  label: "TikTok",
  allowedHosts: TIKTOK_HOSTS,
  verifiability: "conditional",
  detect: (rawInput) => {
    const info = extractTikTokVideoInfo(rawInput);
    if (!info) return null;
    return {
      provider: "tiktok",
      platformLabel: "TikTok",
      originalUrl: rawInput.trim(),
      canonicalRef: info.canonicalRef,
      canonicalUrl: info.canonicalUrl,
      embedUrl: info.videoId ? `https://www.tiktok.com/player/v1/${info.videoId}?autoplay=0&controls=1` : void 0,
      verifiability: "conditional",
      verifiabilityNoteId: "Menggunakan TikTok Embed Player resmi. Jika browser atau TikTok membatasi event lintas-domain, status akan dilaporkan jujur sebagai Tidak Dapat Diverifikasi.",
      verifiabilityNoteEn: "Uses official TikTok Embed Player. If cross-origin playback events are blocked by TikTok or the browser, status will honestly report as Not Verifiable."
    };
  }
};
var facebookAdapter = {
  id: "facebook",
  label: "Facebook",
  allowedHosts: FACEBOOK_HOSTS,
  verifiability: "unverifiable",
  detect: (rawInput) => {
    const trimmed = rawInput.trim();
    if (!trimmed) return null;
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
      const check = parseStrictHttpsUrl(trimmed, { allowBareHostname: false });
      if (!check.ok || !FACEBOOK_HOSTS.has(check.url.hostname.toLowerCase())) return null;
    } else if (!trimmed.startsWith("facebook:")) {
      const check = parseStrictHttpsUrl(trimmed, { allowBareHostname: true });
      if (!check.ok || !FACEBOOK_HOSTS.has(check.url.hostname.toLowerCase())) return null;
    }
    const fbUrl = extractFacebookVideoUrl(trimmed);
    if (!fbUrl) return null;
    return {
      provider: "facebook",
      platformLabel: "Facebook",
      originalUrl: trimmed,
      canonicalRef: fbUrl,
      canonicalUrl: fbUrl,
      embedUrl: getFacebookEmbedUrl(fbUrl, { autoplay: false }),
      verifiability: "unverifiable",
      verifiabilityNoteId: "Facebook Video Plugin berjalan di iframe terisolasi dan tidak menyediakan konfirmasi status PLAY lintas-domain. Pemutaran video ini tidak dapat diverifikasi otomatis oleh sistem.",
      verifiabilityNoteEn: "Facebook Video Plugin runs in an isolated iframe without reliable cross-origin PLAY verification. Playback cannot be automatically confirmed."
    };
  }
};
var xAdapter = {
  id: "x",
  label: "X (Twitter)",
  allowedHosts: X_HOSTS,
  verifiability: "unverifiable",
  detect: (rawInput) => {
    const info = extractXPostInfo(rawInput);
    if (!info) return null;
    return {
      provider: "x",
      platformLabel: "X (Twitter)",
      originalUrl: rawInput.trim(),
      canonicalRef: info.canonicalUrl,
      canonicalUrl: info.canonicalUrl,
      verifiability: "unverifiable",
      verifiabilityNoteId: "X (Twitter) hanya menyediakan embed postingan (oEmbed) tanpa API verifikasi playback video langsung yang andal lintas-domain.",
      verifiabilityNoteEn: "X (Twitter) provides post oEmbed cards without a reliable cross-origin HTML5 video playback confirmation API."
    };
  }
};
var instagramAdapter = {
  id: "instagram",
  label: "Instagram",
  allowedHosts: INSTAGRAM_HOSTS,
  verifiability: "unverifiable",
  detect: (rawInput) => {
    const info = extractInstagramPostInfo(rawInput);
    if (!info) return null;
    return {
      provider: "instagram",
      platformLabel: "Instagram",
      originalUrl: rawInput.trim(),
      canonicalRef: info.canonicalUrl,
      canonicalUrl: info.canonicalUrl,
      embedUrl: info.embedUrl,
      verifiability: "unverifiable",
      verifiabilityNoteId: "Embed Instagram tidak menyediakan API status pemutaran lintas-domain dan sering meminta login Instagram.",
      verifiabilityNoteEn: "Instagram embeds expose no cross-origin playback verification API and frequently trigger login walls."
    };
  }
};
var directVideoAdapter = {
  id: "direct_video",
  label: "Direct Video / Stream",
  verifiability: "verifiable",
  detect: (rawInput) => {
    const trimmed = rawInput.trim();
    if (!trimmed) return null;
    const clean = trimmed.startsWith("direct:") ? trimmed.slice("direct:".length).trim() : trimmed;
    const parsedRes = parseStrictHttpsUrl(clean, {
      allowBareHostname: false,
      allowLocalHttp: false
    });
    if (!parsedRes.ok) return null;
    const host = parsedRes.url.hostname.toLowerCase();
    if (YOUTUBE_HOSTS.has(host) || VIMEO_HOSTS.has(host) || DAILYMOTION_HOSTS.has(host) || STREAMABLE_HOSTS.has(host) || TIKTOK_HOSTS.has(host) || FACEBOOK_HOSTS.has(host) || X_HOSTS.has(host) || INSTAGRAM_HOSTS.has(host)) {
      return null;
    }
    const directFormat = inferDirectFormatFromUrl(parsedRes.url) ?? void 0;
    const formatLabel = directFormat === "hls" ? "Direct Stream (HLS .m3u8)" : directFormat === "dash" ? "Direct Stream (MPEG-DASH .mpd)" : directFormat === "mp4" ? "Direct Video (MP4 / WebM / MOV)" : "Direct HTTPS Video URL";
    return {
      provider: "direct_video",
      platformLabel: formatLabel,
      originalUrl: trimmed,
      canonicalRef: parsedRes.url.toString(),
      canonicalUrl: parsedRes.url.toString(),
      directFormat,
      verifiability: "verifiable",
      verifiabilityNoteId: "Pemutaran MP4, WebM, MOV, HLS (.m3u8), atau MPEG-DASH (.mpd) diverifikasi langsung melalui HTML5 Video, hls.js, atau dash.js.",
      verifiabilityNoteEn: "MP4, WebM, MOV, HLS (.m3u8), or MPEG-DASH (.mpd) playback is verified directly via HTML5 Video, hls.js, or dash.js."
    };
  }
};
var VIDEO_PLATFORM_ADAPTERS = [
  youtubeAdapter,
  vimeoAdapter,
  dailymotionAdapter,
  streamableAdapter,
  tiktokAdapter,
  facebookAdapter,
  xAdapter,
  instagramAdapter,
  directVideoAdapter
];

// server/mediaLifecycle.ts
var EXTERNAL_LINK_PROVIDERS = /* @__PURE__ */ new Set([
  "youtube",
  "vimeo",
  "dailymotion",
  "tiktok",
  "facebook",
  "x",
  "instagram",
  "streamable",
  "direct_video"
]);
function isExternalLinkProvider(provider) {
  return provider !== "unknown" && EXTERNAL_LINK_PROVIDERS.has(provider);
}
var VALID_RESTORABLE_STATUSES = /* @__PURE__ */ new Set([
  "draft",
  "pending_review",
  "approved",
  "rejected",
  "published"
]);
function isValidSafePathSegment(value) {
  return typeof value === "string" && value.length >= 1 && value.length <= 128 && /^[a-zA-Z0-9_-]+$/.test(value);
}
function safeResolveInUploadsDir(uploadsDir, ownerUid, fileName) {
  if (!isValidSafePathSegment(ownerUid) || !/^[a-zA-Z0-9._-]+$/.test(fileName)) {
    return null;
  }
  if (fileName === "." || fileName === ".." || fileName.includes("..")) {
    return null;
  }
  const rootResolved = path3.resolve(uploadsDir);
  const ownerDir = path3.resolve(rootResolved, ownerUid);
  const target = path3.resolve(ownerDir, fileName);
  if (!ownerDir.startsWith(rootResolved + path3.sep) || !target.startsWith(ownerDir + path3.sep)) {
    return null;
  }
  return target;
}
function validatePrivateStorageAssetRef(uploadsDir, rawRef) {
  const trimmed = rawRef.trim();
  if (trimmed === "stream-cinema" || trimmed === "stream-doc") {
    return { kind: "shared_preset", preset: trimmed };
  }
  if (!trimmed.startsWith("private/uploads/") || trimmed.includes("..") || trimmed.includes("\\") || trimmed.includes("?") || trimmed.includes("#")) {
    return { kind: "invalid", reason: "Asset path violates private/uploads/ format." };
  }
  const match = /^private\/uploads\/([a-zA-Z0-9_-]{1,128})\/([a-zA-Z0-9._-]+)$/.exec(
    trimmed
  );
  if (!match) {
    return { kind: "invalid", reason: "Asset path segments contain disallowed characters." };
  }
  const [, ownerUid, fileName] = match;
  const resolvedPath = safeResolveInUploadsDir(uploadsDir, ownerUid, fileName);
  if (!resolvedPath) {
    return { kind: "invalid", reason: "Resolved path escaped upload root directory." };
  }
  return {
    kind: "uploaded_file",
    ownerUid,
    fileName,
    resolvedPath
  };
}
function normalizeMediaSource(rawProvider, rawRef) {
  const p = (rawProvider || "").trim();
  const r = (rawRef || "").trim();
  if (p === "cloudflare_stream") {
    return { provider: "cloudflare_stream", assetRef: r };
  }
  if (p === "youtube" || r.startsWith("youtube:")) {
    return {
      provider: "youtube",
      assetRef: r.startsWith("youtube:") ? r.slice("youtube:".length).trim() : r
    };
  }
  if (p === "facebook" || r.startsWith("facebook:")) {
    return {
      provider: "facebook",
      assetRef: r.startsWith("facebook:") ? r.slice("facebook:".length).trim() : r
    };
  }
  if (p === "vimeo" || r.startsWith("vimeo:")) {
    return {
      provider: "vimeo",
      assetRef: r.startsWith("vimeo:") ? r.slice("vimeo:".length).trim() : r
    };
  }
  if (p === "dailymotion" || r.startsWith("dailymotion:")) {
    return {
      provider: "dailymotion",
      assetRef: r.startsWith("dailymotion:") ? r.slice("dailymotion:".length).trim() : r
    };
  }
  if (p === "streamable" || r.startsWith("streamable:")) {
    return {
      provider: "streamable",
      assetRef: r.startsWith("streamable:") ? r.slice("streamable:".length).trim() : r
    };
  }
  if (p === "tiktok" || r.startsWith("tiktok:")) {
    return {
      provider: "tiktok",
      assetRef: r.startsWith("tiktok:") ? r.slice("tiktok:".length).trim() : r
    };
  }
  if (p === "x" || r.startsWith("x:")) {
    return {
      provider: "x",
      assetRef: r.startsWith("x:") ? r.slice("x:".length).trim() : r
    };
  }
  if (p === "instagram" || r.startsWith("instagram:")) {
    return {
      provider: "instagram",
      assetRef: r.startsWith("instagram:") ? r.slice("instagram:".length).trim() : r
    };
  }
  if (p === "direct_video" || r.startsWith("direct:")) {
    return {
      provider: "direct_video",
      assetRef: r.startsWith("direct:") ? r.slice("direct:".length).trim() : r
    };
  }
  if (p === "private_storage") {
    return { provider: "private_storage", assetRef: r };
  }
  return { provider: "unknown", assetRef: r };
}
function validateExternalProviderAssetRef(provider, assetRef) {
  if (provider === "youtube") return Boolean(extractYouTubeEmbedTarget(assetRef));
  if (provider === "facebook") return Boolean(extractFacebookVideoUrl(assetRef));
  if (provider === "vimeo") return Boolean(extractVimeoVideoRef(assetRef));
  if (provider === "dailymotion") return Boolean(extractDailymotionVideoId(assetRef));
  if (provider === "streamable") return Boolean(extractStreamableId(assetRef));
  if (provider === "tiktok") return Boolean(extractTikTokVideoInfo(assetRef));
  if (provider === "x") return Boolean(extractXPostInfo(assetRef));
  if (provider === "instagram") return Boolean(extractInstagramPostInfo(assetRef));
  if (provider === "direct_video") {
    return parseStrictHttpsUrl(assetRef, { allowBareHostname: false }).ok;
  }
  return false;
}
function buildAssetRefFingerprint(provider, assetRef) {
  const clean = assetRef.trim();
  if (!clean) return `${provider}:empty`;
  const shortHash = crypto3.createHash("sha256").update(`${provider}:${clean}`).digest("hex").slice(0, 10);
  if (provider === "cloudflare_stream") {
    const head = clean.slice(0, 6);
    const tail = clean.length > 10 ? clean.slice(-4) : "";
    return `cf:${head}...${tail}#${shortHash}`;
  }
  if (provider === "private_storage") {
    if (clean === "stream-cinema" || clean === "stream-doc") {
      return `preset:${clean}`;
    }
    const base = path3.posix.basename(clean).slice(0, 28);
    return `local:${base}#${shortHash}`;
  }
  if (provider === "youtube") {
    const target = extractYouTubeEmbedTarget(clean);
    if (!target) return `yt:#${shortHash}`;
    return target.kind === "playlist" ? `yt-pl:${target.playlistId.slice(0, 14)}#${shortHash}` : `yt:${target.videoId}`;
  }
  if (provider === "vimeo") {
    const vimeo = extractVimeoVideoRef(clean);
    return vimeo ? `vimeo:${vimeo.id}` : `vimeo:#${shortHash}`;
  }
  if (provider === "dailymotion") {
    const dmId = extractDailymotionVideoId(clean);
    return dmId ? `dm:${dmId}` : `dm:#${shortHash}`;
  }
  if (provider === "streamable") {
    const stId = extractStreamableId(clean);
    return stId ? `streamable:${stId}` : `streamable:#${shortHash}`;
  }
  if (provider === "tiktok") {
    return `tiktok:#${shortHash}`;
  }
  if (provider === "x") {
    return `x:#${shortHash}`;
  }
  if (provider === "instagram") {
    return `ig:#${shortHash}`;
  }
  if (provider === "direct_video") {
    try {
      const u = new URL(clean);
      return `direct:${u.hostname}#${shortHash}`;
    } catch {
      return `direct:#${shortHash}`;
    }
  }
  if (provider === "facebook") {
    const fbUrl = extractFacebookVideoUrl(clean);
    return fbUrl ? `fb:#${shortHash}` : `fb:invalid#${shortHash}`;
  }
  return `unknown:#${shortHash}`;
}
var PROVIDER_DISPLAY_NAMES = {
  youtube: "YouTube",
  facebook: "Facebook",
  vimeo: "Vimeo",
  dailymotion: "Dailymotion",
  tiktok: "TikTok",
  x: "X (Twitter)",
  instagram: "Instagram",
  streamable: "Streamable",
  direct_video: "URL Video/Stream Eksternal"
};
function getExternalPlatformWarning(provider) {
  const label = PROVIDER_DISPLAY_NAMES[provider];
  if (!label) return null;
  return `Video berasal dari ${label}. Menghapus dari DELOKEN hanya menghapus katalog dan referensi tautan internal; media asli di sumber eksternal tidak dihapus.`;
}
function getFirestoreBaseUrl(projectId, databaseId) {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    projectId
  )}/databases/${encodeURIComponent(databaseId)}/documents`;
}
async function firestoreGetDocument(projectId, databaseId, collectionName, docId, bearerToken) {
  const url = `${getFirestoreBaseUrl(projectId, databaseId)}/${encodeURIComponent(
    collectionName
  )}/${encodeURIComponent(docId)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${bearerToken}` }
  });
  if (res.status === 404) {
    return { exists: false, status: 404, fields: {} };
  }
  if (!res.ok) {
    throw new Error(
      `Firestore read failed for ${collectionName}/${docId} (HTTP ${res.status}).`
    );
  }
  const json = await res.json();
  return {
    exists: true,
    status: res.status,
    fields: json.fields ?? {}
  };
}
async function firestoreCommitVideoFields(projectId, databaseId, videoId, fields, bearerToken) {
  const baseUrl = getFirestoreBaseUrl(projectId, databaseId);
  const docName = `projects/${projectId}/databases/${databaseId}/documents/videos/${videoId}`;
  const fieldPaths = Object.keys(fields);
  const res = await fetch(`${baseUrl}:commit`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      writes: [
        {
          update: {
            name: docName,
            fields
          },
          updateMask: {
            fieldPaths
          },
          updateTransforms: [
            {
              fieldPath: "updatedAt",
              setToServerValue: "REQUEST_TIME"
            }
          ],
          currentDocument: {
            exists: true
          }
        }
      ]
    })
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(
      `Firestore commit failed for videos/${videoId} (HTTP ${res.status}): ${errBody.slice(0, 180)}`
    );
  }
}
async function firestoreDeleteDocument(projectId, databaseId, collectionName, docId, bearerToken) {
  const url = `${getFirestoreBaseUrl(projectId, databaseId)}/${encodeURIComponent(
    collectionName
  )}/${encodeURIComponent(docId)}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${bearerToken}` }
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
async function runFirestoreEqualityQuery(projectId, databaseId, collectionId, fieldPath, value, limit, bearerToken) {
  const url = `${getFirestoreBaseUrl(projectId, databaseId)}:runQuery`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId }],
        where: {
          fieldFilter: {
            field: { fieldPath },
            op: "EQUAL",
            value: { stringValue: value }
          }
        },
        limit
      }
    })
  });
  if (!res.ok) {
    throw new Error(`Firestore runQuery failed (${res.status}).`);
  }
  const rows = await res.json();
  return rows.map((r) => r.document?.name).filter((n) => typeof n === "string" && n.length > 0).map((n) => n.split("/").pop() || "").filter(Boolean);
}
async function verifyExclusiveLocalThumbnail(input) {
  const rawUrl = (input.thumbUrl || "").trim();
  const match = /^\/api\/media\/thumb\/([^/]+)\/([^/?#]+)$/.exec(rawUrl);
  if (!match) {
    return { safeToDelete: false, reason: "external_or_builtin_asset" };
  }
  let ownerUid = "";
  let fileName = "";
  try {
    ownerUid = decodeURIComponent(match[1]);
    fileName = decodeURIComponent(match[2]);
  } catch {
    return { safeToDelete: false, reason: "invalid_thumbnail_encoding" };
  }
  const resolvedPath = safeResolveInUploadsDir(
    input.thumbnailsDir,
    ownerUid,
    fileName
  );
  if (!resolvedPath) {
    return { safeToDelete: false, reason: "invalid_thumbnail_path" };
  }
  if (!input.expectedCreatorId || ownerUid !== input.expectedCreatorId) {
    return { safeToDelete: false, reason: "thumbnail_ownership_unclear" };
  }
  try {
    const [thumbMatches, backdropMatches, creatorAvatarMatches] = await Promise.all([
      runFirestoreEqualityQuery(
        input.projectId,
        input.databaseId,
        "videos",
        "thumbnailUrl",
        rawUrl,
        5,
        input.bearerToken
      ),
      runFirestoreEqualityQuery(
        input.projectId,
        input.databaseId,
        "videos",
        "backdropUrl",
        rawUrl,
        5,
        input.bearerToken
      ),
      runFirestoreEqualityQuery(
        input.projectId,
        input.databaseId,
        "creators",
        "avatarUrl",
        rawUrl,
        2,
        input.bearerToken
      )
    ]);
    const otherVideos = [...thumbMatches, ...backdropMatches].filter(
      (id) => id !== input.excludeVideoId
    );
    if (otherVideos.length > 0 || creatorAvatarMatches.length > 0) {
      return { safeToDelete: false, reason: "shared_thumbnail_retained" };
    }
    return {
      safeToDelete: true,
      ownerUid,
      fileName,
      resolvedPath,
      sqlThumbKey: `thumb:${ownerUid}:${fileName}`
    };
  } catch {
    return { safeToDelete: false, reason: "sharing_check_failed_retained" };
  }
}
function deleteFileIfExists(resolvedPath) {
  if (!fs3.existsSync(resolvedPath)) {
    return "already_missing";
  }
  fs3.unlinkSync(resolvedPath);
  return "deleted";
}

// server/videoInspector.ts
import dns from "node:dns/promises";
import net from "node:net";

// src/services/videoImport/registry.ts
function detectVideoSourceFromInput(rawInput) {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return {
      detected: null,
      errorCode: "EMPTY_URL",
      errorMessageId: "Masukkan tautan video terlebih dahulu.",
      errorMessageEn: "Please paste a video link first."
    };
  }
  for (const adapter of VIDEO_PLATFORM_ADAPTERS) {
    const match = adapter.detect(trimmed);
    if (match) {
      return { detected: match };
    }
  }
  const guard = parseStrictHttpsUrl(trimmed, { allowBareHostname: true });
  if (!guard.ok) {
    return {
      detected: null,
      errorCode: guard.reasonCode,
      errorMessageId: guard.messageId,
      errorMessageEn: guard.messageEn
    };
  }
  return {
    detected: null,
    errorCode: "UNSUPPORTED_PLATFORM_OR_PATH",
    errorMessageId: "Tautan dari domain atau format ini belum dikenali/didukung untuk embed resmi atau stream langsung.",
    errorMessageEn: "This URL format or domain is not recognized as a supported official embed or direct stream."
  };
}

// src/utils/videoAspect.ts
var VIDEO_ASPECT_OPTIONS = [
  {
    value: "auto",
    shortLabel: "Auto",
    labelId: "Otomatis",
    labelEn: "Auto Detect",
    cssRatio: "16 / 9",
    numericRatio: 16 / 9,
    isPortrait: false
  },
  {
    value: "16:9",
    shortLabel: "16:9",
    labelId: "16:9 (Landscape)",
    labelEn: "16:9 (Widescreen)",
    cssRatio: "16 / 9",
    numericRatio: 16 / 9,
    isPortrait: false
  },
  {
    value: "9:16",
    shortLabel: "9:16",
    labelId: "9:16 (Vertikal / Shorts)",
    labelEn: "9:16 (Vertical / Shorts)",
    cssRatio: "9 / 16",
    numericRatio: 9 / 16,
    isPortrait: true
  },
  {
    value: "4:5",
    shortLabel: "4:5",
    labelId: "4:5 (Potret Feed)",
    labelEn: "4:5 (Portrait Feed)",
    cssRatio: "4 / 5",
    numericRatio: 4 / 5,
    isPortrait: true
  },
  {
    value: "1:1",
    shortLabel: "1:1",
    labelId: "1:1 (Persegi)",
    labelEn: "1:1 (Square)",
    cssRatio: "1 / 1",
    numericRatio: 1,
    isPortrait: false
  },
  {
    value: "4:3",
    shortLabel: "4:3",
    labelId: "4:3 (Klasik)",
    labelEn: "4:3 (Classic)",
    cssRatio: "4 / 3",
    numericRatio: 4 / 3,
    isPortrait: false
  },
  {
    value: "21:9",
    shortLabel: "21:9",
    labelId: "21:9 (Sinema)",
    labelEn: "21:9 (Cinema)",
    cssRatio: "21 / 9",
    numericRatio: 21 / 9,
    isPortrait: false
  }
];
function inferAspectRatioFromDimensions(width, height) {
  if (typeof width !== "number" || typeof height !== "number" || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return "16:9";
  }
  const ratio = width / height;
  if (ratio <= 0.68) return "9:16";
  if (ratio <= 0.9) return "4:5";
  if (ratio <= 1.15) return "1:1";
  if (ratio <= 1.52) return "4:3";
  if (ratio <= 2.05) return "16:9";
  return "21:9";
}
function inferAspectRatioFromUrlOrProvider(params) {
  if (typeof params.width === "number" && typeof params.height === "number" && params.width > 0 && params.height > 0) {
    return inferAspectRatioFromDimensions(params.width, params.height);
  }
  const lowerUrl = (params.url || "").toLowerCase();
  if (lowerUrl.includes("/shorts/") || lowerUrl.includes("/reel/") || lowerUrl.includes("/reels/") || params.provider === "tiktok") {
    return "9:16";
  }
  return "16:9";
}

// server/videoInspector.ts
var INSPECT_TIMEOUT_MS = 7e3;
var MAX_REDIRECT_HOPS = 3;
var MAX_PROBE_BYTES = 32 * 1024;
var TIKTOK_ALLOWED_HOSTS = /* @__PURE__ */ new Set([
  "tiktok.com",
  "www.tiktok.com",
  "m.tiktok.com",
  "vt.tiktok.com",
  "vm.tiktok.com"
]);
function ipv4ToInt(ip) {
  const parts = ip.split(".").map(Number);
  return (parts[0] << 24 | parts[1] << 16 | parts[2] << 8 | parts[3]) >>> 0;
}
function inCidr4(ipInt, base, maskBits) {
  const baseInt = ipv4ToInt(base);
  const mask = maskBits === 0 ? 0 : ~0 << 32 - maskBits >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}
function isPrivateOrReservedIp(rawIp) {
  const ip = rawIp.trim().toLowerCase().replace(/%.*$/, "");
  const kind = net.isIP(ip);
  if (kind === 0) return true;
  if (kind === 4) {
    const n = ipv4ToInt(ip);
    return inCidr4(n, "0.0.0.0", 8) || // "This" network
    inCidr4(n, "10.0.0.0", 8) || // RFC1918
    inCidr4(n, "100.64.0.0", 10) || // CGNAT
    inCidr4(n, "127.0.0.0", 8) || // Loopback
    inCidr4(n, "169.254.0.0", 16) || // Link-local & AWS/GCP metadata
    inCidr4(n, "172.16.0.0", 12) || // RFC1918
    inCidr4(n, "192.0.0.0", 24) || // IETF Protocol Assignments
    inCidr4(n, "192.0.2.0", 24) || // TEST-NET-1
    inCidr4(n, "192.168.0.0", 16) || // RFC1918
    inCidr4(n, "198.18.0.0", 15) || // Benchmarking
    inCidr4(n, "198.51.100.0", 24) || // TEST-NET-2
    inCidr4(n, "203.0.113.0", 24) || // TEST-NET-3
    inCidr4(n, "224.0.0.0", 4) || // Multicast
    inCidr4(n, "240.0.0.0", 4);
  }
  if (ip === "::" || ip === "::1") return true;
  if (ip.startsWith("::ffff:")) {
    const mapped = ip.slice("::ffff:".length);
    if (net.isIPv4(mapped)) {
      return isPrivateOrReservedIp(mapped);
    }
    return true;
  }
  if (ip.startsWith("fc") || ip.startsWith("fd") || // ULA fc00::/7
  ip.startsWith("fe8") || ip.startsWith("fe9") || ip.startsWith("fea") || ip.startsWith("feb") || // Link-local fe80::/10
  ip.startsWith("ff")) {
    return true;
  }
  return false;
}
async function assertPublicRoutableTarget(rawUrl, allowedHosts) {
  const parsedGuard = parseStrictHttpsUrl(rawUrl, {
    allowBareHostname: false,
    allowLocalHttp: false
  });
  if (!parsedGuard.ok) {
    throw new Error(parsedGuard.messageEn);
  }
  const parsed = parsedGuard.url;
  if (parsed.port && parsed.port !== "443") {
    throw new Error("Only standard HTTPS port 443 is allowed.");
  }
  const host = parsed.hostname.toLowerCase();
  if (allowedHosts && !allowedHosts.has(host)) {
    throw new Error("Target host outside allowed platform domains.");
  }
  if (net.isIP(host)) {
    if (isPrivateOrReservedIp(host)) {
      throw new Error("Direct private/internal IP targets are blocked.");
    }
    return parsed;
  }
  const records = await dns.lookup(host, { all: true });
  if (!records || records.length === 0) {
    throw new Error("DNS lookup returned no addresses.");
  }
  for (const rec of records) {
    if (isPrivateOrReservedIp(rec.address)) {
      throw new Error("Target domain resolved to a blocked private or internal IP address.");
    }
  }
  return parsed;
}
async function readCappedTextSnippet(response, maxBytes) {
  if (!response.body) {
    return { text: "", bytes: new Uint8Array(0) };
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const take = Math.min(value.byteLength, maxBytes - total);
      chunks.push(value.subarray(0, take));
      total += take;
      if (total >= maxBytes) {
        await reader.cancel().catch(() => {
        });
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {
    text: new TextDecoder("utf-8", { fatal: false }).decode(combined),
    bytes: combined
  };
}
async function safePublicFetch(initialUrl, options) {
  let currentUrl = initialUrl;
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
    const validatedUrl = await assertPublicRoutableTarget(
      currentUrl,
      options.allowedHosts
    );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), INSPECT_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(validatedUrl.toString(), {
        method: options.method,
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": "DELOKEN-MediaInspector/1.0",
          ...options.headers || {}
        }
      });
    } finally {
      clearTimeout(timer);
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) {
        return { response: res, finalUrl: validatedUrl.toString() };
      }
      if (hop === MAX_REDIRECT_HOPS) {
        throw new Error("Too many HTTP redirects while inspecting video link.");
      }
      currentUrl = new URL(location, validatedUrl).toString();
      continue;
    }
    return { response: res, finalUrl: validatedUrl.toString() };
  }
  throw new Error("Redirect limit exceeded.");
}
async function probeOfficialOEmbed(oEmbedUrl, platformLabel) {
  try {
    const { response } = await safePublicFetch(oEmbedUrl, {
      method: "GET",
      headers: { Accept: "application/json" }
    });
    if (response.ok) {
      const snippet = await readCappedTextSnippet(response, MAX_PROBE_BYTES);
      try {
        const parsed = JSON.parse(snippet.text);
        return {
          status: "ok",
          httpStatus: response.status,
          title: typeof parsed.title === "string" ? parsed.title.slice(0, 140) : void 0,
          authorName: typeof parsed.author_name === "string" ? parsed.author_name.slice(0, 80) : void 0,
          thumbnailUrl: typeof parsed.thumbnail_url === "string" && parsed.thumbnail_url.startsWith("https://") ? parsed.thumbnail_url.slice(0, 500) : void 0,
          durationSeconds: typeof parsed.duration === "number" && Number.isFinite(parsed.duration) ? Math.round(parsed.duration) : void 0,
          width: typeof parsed.width === "number" && Number.isFinite(parsed.width) && parsed.width > 0 ? Math.round(parsed.width) : void 0,
          height: typeof parsed.height === "number" && Number.isFinite(parsed.height) && parsed.height > 0 ? Math.round(parsed.height) : void 0
        };
      } catch {
        return {
          status: "uncertain",
          httpStatus: response.status,
          errorDetail: `${platformLabel} returned an unexpected oEmbed response.`
        };
      }
    }
    if (response.status === 401 || response.status === 403) {
      return { status: "blocked", httpStatus: response.status };
    }
    if (response.status === 404 || response.status === 400 || response.status === 410) {
      return { status: "not_found", httpStatus: response.status };
    }
    return { status: "uncertain", httpStatus: response.status };
  } catch (err) {
    return {
      status: "uncertain",
      errorDetail: err instanceof Error ? err.message : "Network timeout during link probe."
    };
  }
}
function detectDirectFormatFromProbe(urlObj, contentTypeRaw, snippetText, snippetBytes) {
  const mime = contentTypeRaw.split(";")[0].trim().toLowerCase();
  const isHtmlPage = mime === "text/html" || mime === "application/xhtml+xml" || snippetText.trimStart().toLowerCase().startsWith("<!doctype html") || snippetText.trimStart().toLowerCase().startsWith("<html");
  if (isHtmlPage) {
    return { isLikelyVideo: false, isHtmlPage: true, directFormat: void 0 };
  }
  if (mime === "application/vnd.apple.mpegurl" || mime === "application/x-mpegurl" || mime === "audio/mpegurl" || snippetText.trimStart().startsWith("#EXTM3U")) {
    return { isLikelyVideo: true, isHtmlPage: false, directFormat: "hls" };
  }
  if (mime === "application/dash+xml" || snippetText.includes("<MPD") && snippetText.includes("urn:mpeg:dash:schema:mpd")) {
    return { isLikelyVideo: true, isHtmlPage: false, directFormat: "dash" };
  }
  const hasMp4Box = snippetBytes.byteLength >= 8 && snippetBytes[4] === 102 && snippetBytes[5] === 116 && snippetBytes[6] === 121 && snippetBytes[7] === 112;
  const hasWebmHeader = snippetBytes.byteLength >= 4 && snippetBytes[0] === 26 && snippetBytes[1] === 69 && snippetBytes[2] === 223 && snippetBytes[3] === 163;
  if (mime.startsWith("video/") || hasMp4Box || hasWebmHeader) {
    const inferred = inferDirectFormatFromUrl(urlObj) ?? "mp4";
    return { isLikelyVideo: true, isHtmlPage: false, directFormat: inferred };
  }
  const urlFormat = inferDirectFormatFromUrl(urlObj);
  if (urlFormat && (mime === "" || mime === "application/octet-stream" || mime === "binary/octet-stream")) {
    return { isLikelyVideo: true, isHtmlPage: false, directFormat: urlFormat };
  }
  return { isLikelyVideo: false, isHtmlPage: false, directFormat: urlFormat ?? void 0 };
}
async function inspectUniversalVideoLink(rawUrl) {
  const detectedOutcome = detectVideoSourceFromInput(rawUrl);
  if (!detectedOutcome.detected) {
    return {
      detected: false,
      provider: null,
      platformLabel: "Tidak Dikenal",
      canonicalRef: "",
      canonicalUrl: "",
      linkStatus: "unavailable",
      reasonCode: detectedOutcome.errorCode || "UNSUPPORTED_URL",
      messageId: detectedOutcome.errorMessageId || "Tautan tidak valid atau platform tidak didukung.",
      messageEn: detectedOutcome.errorMessageEn || "Invalid link or unsupported platform.",
      verifiability: "unverifiable",
      verifiabilityNoteId: "Tautan tidak dapat ditampilkan.",
      verifiabilityNoteEn: "Link cannot be embedded or played."
    };
  }
  const source = detectedOutcome.detected;
  if (source.provider === "youtube" || source.provider === "vimeo" || source.provider === "dailymotion" || source.provider === "streamable") {
    const oEmbedEndpoint = source.provider === "youtube" ? `https://www.youtube.com/oembed?url=${encodeURIComponent(
      source.canonicalUrl
    )}&format=json` : source.provider === "vimeo" ? `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(
      source.canonicalUrl
    )}` : source.provider === "dailymotion" ? `https://www.dailymotion.com/services/oembed?url=${encodeURIComponent(
      source.canonicalUrl
    )}&format=json` : `https://api.streamable.com/oembed.json?url=${encodeURIComponent(
      source.canonicalUrl
    )}`;
    const probe = await probeOfficialOEmbed(oEmbedEndpoint, source.platformLabel);
    if (probe.status === "ok") {
      const urlBasedRatio = inferAspectRatioFromUrlOrProvider({
        provider: source.provider,
        url: rawUrl,
        width: probe.width,
        height: probe.height
      });
      return {
        detected: true,
        provider: source.provider,
        platformLabel: source.platformLabel,
        canonicalRef: source.canonicalRef,
        canonicalUrl: source.canonicalUrl,
        embedUrl: source.embedUrl,
        linkStatus: "embeddable",
        reasonCode: "OEMBED_VERIFIED",
        messageId: `${source.platformLabel} mengenali video ini dan mengizinkan embed resmi. Klik PREVIEW lalu PLAY untuk memverifikasi pemutaran nyata.`,
        messageEn: `${source.platformLabel} confirmed official embed availability. Click PREVIEW and then PLAY to verify real playback.`,
        titleHint: probe.title,
        authorHint: probe.authorName,
        thumbnailUrl: probe.thumbnailUrl || source.thumbnailUrl,
        durationSecondsHint: probe.durationSeconds,
        detectedWidth: probe.width,
        detectedHeight: probe.height,
        aspectRatioHint: urlBasedRatio,
        verifiability: source.verifiability,
        verifiabilityNoteId: source.verifiabilityNoteId,
        verifiabilityNoteEn: source.verifiabilityNoteEn
      };
    }
    if (probe.status === "blocked") {
      return {
        detected: true,
        provider: source.provider,
        platformLabel: source.platformLabel,
        canonicalRef: source.canonicalRef,
        canonicalUrl: source.canonicalUrl,
        embedUrl: source.embedUrl,
        linkStatus: "unavailable",
        reasonCode: "EMBED_DISABLED_BY_OWNER",
        messageId: `${source.platformLabel} menolak penyematan (HTTP ${probe.httpStatus}). Pemilik video menonaktifkan izin embed atau mengatur video menjadi privat.`,
        messageEn: `${source.platformLabel} rejected embedding (HTTP ${probe.httpStatus}). Embedding is disabled by owner or video is private.`,
        thumbnailUrl: source.thumbnailUrl,
        verifiability: source.verifiability,
        verifiabilityNoteId: source.verifiabilityNoteId,
        verifiabilityNoteEn: source.verifiabilityNoteEn
      };
    }
    if (probe.status === "not_found") {
      return {
        detected: true,
        provider: source.provider,
        platformLabel: source.platformLabel,
        canonicalRef: source.canonicalRef,
        canonicalUrl: source.canonicalUrl,
        embedUrl: source.embedUrl,
        linkStatus: "unavailable",
        reasonCode: "VIDEO_NOT_FOUND_OR_PRIVATE",
        messageId: `Video tidak ditemukan di ${source.platformLabel} atau berstatus privat (HTTP ${probe.httpStatus}).`,
        messageEn: `Video not found on ${source.platformLabel} or marked private (HTTP ${probe.httpStatus}).`,
        verifiability: source.verifiability,
        verifiabilityNoteId: source.verifiabilityNoteId,
        verifiabilityNoteEn: source.verifiabilityNoteEn
      };
    }
    return {
      detected: true,
      provider: source.provider,
      platformLabel: source.platformLabel,
      canonicalRef: source.canonicalRef,
      canonicalUrl: source.canonicalUrl,
      embedUrl: source.embedUrl,
      linkStatus: "uncertain",
      reasonCode: "OEMBED_INCONCLUSIVE",
      messageId: `Format ${source.platformLabel} valid, namun respons pemeriksaan oEmbed belum dapat dipastikan (${probe.httpStatus || probe.errorDetail || "timeout"}). Anda tetap dapat menekan PREVIEW dan PLAY untuk menguji pemutaran langsung.`,
      messageEn: `${source.platformLabel} link format is valid, but oEmbed probe was inconclusive (${probe.httpStatus || probe.errorDetail || "timeout"}). You can still press PREVIEW and PLAY to test live playback.`,
      thumbnailUrl: source.thumbnailUrl,
      verifiability: source.verifiability,
      verifiabilityNoteId: source.verifiabilityNoteId,
      verifiabilityNoteEn: source.verifiabilityNoteEn
    };
  }
  if (source.provider === "tiktok") {
    let resolvedUrl = source.canonicalUrl;
    let resolvedRef = source.canonicalRef;
    let resolvedEmbedUrl = source.embedUrl;
    if (!resolvedEmbedUrl) {
      try {
        const redirectRes = await safePublicFetch(source.canonicalUrl, {
          method: "HEAD",
          allowedHosts: TIKTOK_ALLOWED_HOSTS
        });
        const resolvedInfo = extractTikTokVideoInfo(redirectRes.finalUrl);
        if (resolvedInfo?.videoId) {
          resolvedUrl = resolvedInfo.canonicalUrl;
          resolvedRef = resolvedInfo.canonicalRef;
          resolvedEmbedUrl = `https://www.tiktok.com/player/v1/${resolvedInfo.videoId}?autoplay=0&controls=1`;
        }
      } catch {
      }
    }
    const probe = await probeOfficialOEmbed(
      `https://www.tiktok.com/oembed?url=${encodeURIComponent(resolvedUrl)}`,
      "TikTok"
    );
    if (probe.status === "ok") {
      return {
        detected: true,
        provider: "tiktok",
        platformLabel: "TikTok",
        canonicalRef: resolvedRef,
        canonicalUrl: resolvedUrl,
        embedUrl: resolvedEmbedUrl,
        linkStatus: resolvedEmbedUrl ? "embeddable" : "uncertain",
        reasonCode: resolvedEmbedUrl ? "OEMBED_VERIFIED" : "SHORT_URL_NO_VIDEO_ID",
        messageId: resolvedEmbedUrl ? "TikTok mengembalikan metadata embed resmi. Klik PREVIEW lalu PLAY \u2014 sistem akan jujur melaporkan apakah player TikTok mengirim status putar nyata." : "Tautan pendek TikTok ditemukan, namun ID numerik video belum berhasil diurai untuk player embed.",
        messageEn: resolvedEmbedUrl ? "TikTok returned official embed metadata. Click PREVIEW then PLAY \u2014 the player will verify whether TikTok emits real playback events." : "TikTok short URL resolved metadata, but numeric video ID could not be extracted for embed playback.",
        titleHint: probe.title,
        authorHint: probe.authorName,
        thumbnailUrl: probe.thumbnailUrl,
        detectedWidth: probe.width,
        detectedHeight: probe.height,
        aspectRatioHint: inferAspectRatioFromUrlOrProvider({
          provider: "tiktok",
          url: resolvedUrl,
          width: probe.width,
          height: probe.height
        }),
        verifiability: source.verifiability,
        verifiabilityNoteId: source.verifiabilityNoteId,
        verifiabilityNoteEn: source.verifiabilityNoteEn
      };
    }
    if (probe.status === "not_found") {
      return {
        detected: true,
        provider: "tiktok",
        platformLabel: "TikTok",
        canonicalRef: resolvedRef,
        canonicalUrl: resolvedUrl,
        embedUrl: resolvedEmbedUrl,
        linkStatus: "unavailable",
        reasonCode: "TIKTOK_UNAVAILABLE",
        messageId: "Video TikTok tidak ditemukan, privat, atau penyematan dinonaktifkan.",
        messageEn: "TikTok video is unavailable, private, or embedding is disabled.",
        verifiability: source.verifiability,
        verifiabilityNoteId: source.verifiabilityNoteId,
        verifiabilityNoteEn: source.verifiabilityNoteEn
      };
    }
    return {
      detected: true,
      provider: "tiktok",
      platformLabel: "TikTok",
      canonicalRef: resolvedRef,
      canonicalUrl: resolvedUrl,
      embedUrl: resolvedEmbedUrl,
      linkStatus: "uncertain",
      reasonCode: "TIKTOK_OEMBED_UNCERTAIN",
      messageId: "Pemeriksaan TikTok belum dapat dipastikan karena pembatasan jaringan/API platform. Anda bisa mencoba PREVIEW untuk melihat perilaku embed.",
      messageEn: "TikTok embed support could not be confirmed due to network/platform restrictions. You can still test PREVIEW.",
      verifiability: source.verifiability,
      verifiabilityNoteId: source.verifiabilityNoteId,
      verifiabilityNoteEn: source.verifiabilityNoteEn
    };
  }
  if (source.provider === "x") {
    const probe = await probeOfficialOEmbed(
      `https://publish.twitter.com/oembed?url=${encodeURIComponent(
        source.canonicalUrl
      )}&omit_script=true`,
      "X (Twitter)"
    );
    if (probe.status === "ok") {
      return {
        detected: true,
        provider: "x",
        platformLabel: "X (Twitter)",
        canonicalRef: source.canonicalRef,
        canonicalUrl: source.canonicalUrl,
        linkStatus: "embeddable",
        reasonCode: "OEMBED_POST_FOUND",
        messageId: "Postingan X ditemukan melalui oEmbed resmi. Catatan: X tidak menyediakan konfirmasi status pemutaran video lintas-domain yang dapat diverifikasi.",
        messageEn: "X post confirmed via official oEmbed. Note: X does not provide verifiable cross-origin video playback state.",
        authorHint: probe.authorName,
        verifiability: "unverifiable",
        verifiabilityNoteId: source.verifiabilityNoteId,
        verifiabilityNoteEn: source.verifiabilityNoteEn
      };
    }
    if (probe.status === "not_found" || probe.status === "blocked") {
      return {
        detected: true,
        provider: "x",
        platformLabel: "X (Twitter)",
        canonicalRef: source.canonicalRef,
        canonicalUrl: source.canonicalUrl,
        linkStatus: "unavailable",
        reasonCode: "X_POST_UNAVAILABLE",
        messageId: `Postingan X tidak ditemukan atau bersifat privat (HTTP ${probe.httpStatus}).`,
        messageEn: `X post not found or protected (HTTP ${probe.httpStatus}).`,
        verifiability: "unverifiable",
        verifiabilityNoteId: source.verifiabilityNoteId,
        verifiabilityNoteEn: source.verifiabilityNoteEn
      };
    }
    return {
      detected: true,
      provider: "x",
      platformLabel: "X (Twitter)",
      canonicalRef: source.canonicalRef,
      canonicalUrl: source.canonicalUrl,
      linkStatus: "uncertain",
      reasonCode: "X_OEMBED_UNCERTAIN",
      messageId: "Pemeriksaan oEmbed X belum dapat dipastikan karena batas akses jaringan/platform.",
      messageEn: "X oEmbed verification was inconclusive due to network or platform limits.",
      verifiability: "unverifiable",
      verifiabilityNoteId: source.verifiabilityNoteId,
      verifiabilityNoteEn: source.verifiabilityNoteEn
    };
  }
  if (source.provider === "facebook" || source.provider === "instagram") {
    return {
      detected: true,
      provider: source.provider,
      platformLabel: source.platformLabel,
      canonicalRef: source.canonicalRef,
      canonicalUrl: source.canonicalUrl,
      embedUrl: source.embedUrl,
      aspectRatioHint: inferAspectRatioFromUrlOrProvider({
        provider: source.provider,
        url: rawUrl
      }),
      linkStatus: "uncertain",
      reasonCode: "PLATFORM_NO_PUBLIC_OEMBED",
      messageId: `Tautan ${source.platformLabel} dikenali, tetapi ketersediaan privasi dan status putar lintas-domain tidak dapat dipastikan dari server. Anda dapat mencoba PREVIEW, namun pemutaran di iframe ${source.platformLabel} tidak dapat diverifikasi oleh sistem.`,
      messageEn: `${source.platformLabel} URL recognized, but privacy and cross-origin playback cannot be verified automatically. You may try PREVIEW, though playback inside ${source.platformLabel} iframe cannot be confirmed.`,
      verifiability: "unverifiable",
      verifiabilityNoteId: source.verifiabilityNoteId,
      verifiabilityNoteEn: source.verifiabilityNoteEn
    };
  }
  try {
    let headResult = await safePublicFetch(source.canonicalUrl, {
      method: "HEAD"
    });
    if (headResult.response.status === 405 || headResult.response.status === 403 || headResult.response.status === 501) {
      headResult = await safePublicFetch(source.canonicalUrl, {
        method: "GET",
        headers: { Range: "bytes=0-2047" }
      });
    }
    const res = headResult.response;
    const finalParsed = new URL(headResult.finalUrl);
    if (!res.ok) {
      return {
        detected: true,
        provider: "direct_video",
        platformLabel: source.platformLabel,
        canonicalRef: headResult.finalUrl,
        canonicalUrl: headResult.finalUrl,
        directFormat: source.directFormat,
        linkStatus: "unavailable",
        reasonCode: `DIRECT_HTTP_${res.status}`,
        messageId: res.status === 401 || res.status === 403 ? `Akses ke file video ditolak atau URL kedaluwarsa (HTTP ${res.status}).` : `Tautan video langsung gagal diakses (HTTP ${res.status}).`,
        messageEn: res.status === 401 || res.status === 403 ? `Direct video access denied or link expired (HTTP ${res.status}).` : `Direct video URL returned HTTP ${res.status}.`,
        verifiability: "verifiable",
        verifiabilityNoteId: source.verifiabilityNoteId,
        verifiabilityNoteEn: source.verifiabilityNoteEn
      };
    }
    const contentType = res.headers.get("content-type") || "";
    const contentLengthHeader = res.headers.get("content-length");
    const acceptRanges = res.headers.get("accept-ranges") || "";
    const acao = res.headers.get("access-control-allow-origin");
    let snippetText = "";
    let snippetBytes = new Uint8Array(0);
    if (contentType.includes("mpegurl") || contentType.includes("dash+xml") || contentType.includes("text/html") || !contentType || contentType.includes("octet-stream")) {
      try {
        const rangeRes = await safePublicFetch(headResult.finalUrl, {
          method: "GET",
          headers: { Range: "bytes=0-4095" }
        });
        if (rangeRes.response.ok) {
          const snip = await readCappedTextSnippet(rangeRes.response, MAX_PROBE_BYTES);
          snippetText = snip.text;
          snippetBytes = snip.bytes;
        }
      } catch {
      }
    }
    const formatInspection = detectDirectFormatFromProbe(
      finalParsed,
      contentType,
      snippetText,
      snippetBytes
    );
    if (formatInspection.isHtmlPage || !formatInspection.isLikelyVideo) {
      return {
        detected: true,
        provider: "direct_video",
        platformLabel: "URL Bukan Media Video",
        canonicalRef: headResult.finalUrl,
        canonicalUrl: headResult.finalUrl,
        linkStatus: "unavailable",
        reasonCode: formatInspection.isHtmlPage ? "HTML_PAGE_NOT_VIDEO" : "UNSUPPORTED_MIME_TYPE",
        mimeType: contentType.split(";")[0].trim() || void 0,
        messageId: formatInspection.isHtmlPage ? "Tautan ini mengarah ke halaman web HTML, bukan file video langsung (.mp4/.webm/.mov/.m3u8/.mpd)." : `Tipe media server (${contentType || "tidak diketahui"}) tidak dikenali sebagai format video atau manifest streaming yang didukung.`,
        messageEn: formatInspection.isHtmlPage ? "URL points to an HTML web page rather than a direct video or streaming manifest (.mp4/.webm/.mov/.m3u8/.mpd)." : `Server media type (${contentType || "unknown"}) is not a supported video or streaming manifest format.`,
        verifiability: "verifiable",
        verifiabilityNoteId: source.verifiabilityNoteId,
        verifiabilityNoteEn: source.verifiabilityNoteEn
      };
    }
    const resolvedFormat = formatInspection.directFormat || "mp4";
    const needsCorsForXhr = resolvedFormat === "hls" || resolvedFormat === "dash";
    const corsReady = acao ? acao.trim().length > 0 : null;
    const labelByFormat = resolvedFormat === "hls" ? "Direct Stream (HLS .m3u8)" : resolvedFormat === "dash" ? "Direct Stream (MPEG-DASH .mpd)" : "Direct Video (MP4 / WebM / MOV)";
    if (needsCorsForXhr && corsReady === null) {
      return {
        detected: true,
        provider: "direct_video",
        platformLabel: labelByFormat,
        canonicalRef: headResult.finalUrl,
        canonicalUrl: headResult.finalUrl,
        directFormat: resolvedFormat,
        mimeType: contentType.split(";")[0].trim() || void 0,
        contentLength: contentLengthHeader ? Number(contentLengthHeader) : void 0,
        supportsRange: acceptRanges.toLowerCase().includes("bytes") || res.status === 206,
        corsReady: false,
        linkStatus: "uncertain",
        reasonCode: "MISSING_CORS_HEADER_FOR_MANIFEST",
        messageId: `${labelByFormat} ditemukan, namun header CORS (Access-Control-Allow-Origin) tidak terdeteksi. Klik PREVIEW lalu PLAY untuk menguji apakah browser mengizinkan pemutarannya.`,
        messageEn: `${labelByFormat} detected, but Access-Control-Allow-Origin header was not present. Click PREVIEW and PLAY to test browser playback.`,
        verifiability: "verifiable",
        verifiabilityNoteId: source.verifiabilityNoteId,
        verifiabilityNoteEn: source.verifiabilityNoteEn
      };
    }
    return {
      detected: true,
      provider: "direct_video",
      platformLabel: labelByFormat,
      canonicalRef: headResult.finalUrl,
      canonicalUrl: headResult.finalUrl,
      directFormat: resolvedFormat,
      mimeType: contentType.split(";")[0].trim() || void 0,
      contentLength: contentLengthHeader ? Number(contentLengthHeader) : void 0,
      supportsRange: acceptRanges.toLowerCase().includes("bytes") || res.status === 206,
      corsReady: corsReady ?? true,
      linkStatus: "embeddable",
      reasonCode: "DIRECT_MEDIA_READY",
      messageId: `${labelByFormat} valid (${contentType.split(";")[0].trim() || "stream ready"}). Klik PREVIEW lalu PLAY untuk memverifikasi pemutaran di browser Anda.`,
      messageEn: `${labelByFormat} verified (${contentType.split(";")[0].trim() || "stream ready"}). Click PREVIEW and PLAY to confirm browser playback.`,
      verifiability: "verifiable",
      verifiabilityNoteId: source.verifiabilityNoteId,
      verifiabilityNoteEn: source.verifiabilityNoteEn
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Network error during media inspection.";
    const isBlockedIp = msg.toLowerCase().includes("blocked") || msg.toLowerCase().includes("private") || msg.toLowerCase().includes("https");
    return {
      detected: true,
      provider: "direct_video",
      platformLabel: source.platformLabel,
      canonicalRef: source.canonicalRef,
      canonicalUrl: source.canonicalUrl,
      directFormat: source.directFormat,
      linkStatus: isBlockedIp ? "unavailable" : "uncertain",
      reasonCode: isBlockedIp ? "SSRF_OR_PROTOCOL_BLOCKED" : "DIRECT_PROBE_TIMEOUT_OR_ERROR",
      messageId: isBlockedIp ? `Tautan ditolak oleh kebijakan keamanan: ${msg}` : `Pemeriksaan server belum dapat memastikan tautan ini (${msg}). Anda masih bisa menekan PREVIEW dan PLAY untuk menguji langsung di browser.`,
      messageEn: isBlockedIp ? `Rejected by security policy: ${msg}` : `Server probe could not confirm this URL (${msg}). You can still test PREVIEW and PLAY directly in your browser.`,
      verifiability: "verifiable",
      verifiabilityNoteId: source.verifiabilityNoteId,
      verifiabilityNoteEn: source.verifiabilityNoteEn
    };
  }
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

// server/app.ts
dotenv.config();
var FIREBASE_CERTS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
var cachedFirebaseCerts = null;
async function getFirebasePublicCerts(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedFirebaseCerts && now < cachedFirebaseCerts.expiresAtMs) {
    return cachedFirebaseCerts.certs;
  }
  const res = await fetch(FIREBASE_CERTS_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch Firebase public certificates (${res.status}).`);
  }
  const cacheControl = res.headers.get("cache-control") || "";
  const maxAgeMatch = /max-age=(\d+)/i.exec(cacheControl);
  const maxAgeSeconds = maxAgeMatch ? Number(maxAgeMatch[1]) : 3600;
  const certs = await res.json();
  cachedFirebaseCerts = {
    certs,
    expiresAtMs: now + Math.max(60, maxAgeSeconds) * 1e3
  };
  return certs;
}
function decodeBase64UrlJson(segment) {
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf-8"));
  } catch {
    return null;
  }
}
async function verifyFirebaseIdToken(idToken) {
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;
  if (!headerB64 || !payloadB64 || !signatureB64) return null;
  const header = decodeBase64UrlJson(headerB64);
  if (!header || header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid) {
    return null;
  }
  let certs = await getFirebasePublicCerts(false);
  let certPem = certs[header.kid];
  if (!certPem) {
    certs = await getFirebasePublicCerts(true);
    certPem = certs[header.kid];
  }
  if (typeof certPem !== "string" || !certPem.includes("BEGIN CERTIFICATE")) {
    return null;
  }
  const signingInput = Buffer.from(`${headerB64}.${payloadB64}`, "utf-8");
  const signatureBuf = Buffer.from(signatureB64, "base64url");
  if (!crypto4.verify("RSA-SHA256", signingInput, certPem, signatureBuf)) {
    return null;
  }
  const payload = decodeBase64UrlJson(payloadB64);
  if (!payload) return null;
  const nowSec = Math.floor(Date.now() / 1e3);
  const expectedIssuer = `https://securetoken.google.com/${firebase_applet_config_default.projectId}`;
  if (payload.aud !== firebase_applet_config_default.projectId || payload.iss !== expectedIssuer || typeof payload.sub !== "string" || payload.sub.length === 0 || payload.sub.length > 128 || typeof payload.exp !== "number" || payload.exp <= nowSec || typeof payload.iat !== "number" || payload.iat > nowSec + 300 || typeof payload.auth_time !== "number" || payload.auth_time > nowSec + 300) {
    return null;
  }
  return {
    uid: payload.sub,
    email: typeof payload.email === "string" ? payload.email : null,
    emailVerified: Boolean(payload.email_verified),
    rawIdToken: idToken
  };
}
var IS_PRODUCTION = process.env.NODE_ENV === "production";
var BOOTSTRAPPED_ADMIN_EMAIL = "parjojuminet@gmail.com";
var PREVIEW_MAX_SEGMENT_INDEX = 29;
var FULL_MAX_SEGMENT_INDEX = 35;
var PLAYBACK_SECRET = process.env.PLAYBACK_TOKEN_SECRET && process.env.PLAYBACK_TOKEN_SECRET.length >= 16 ? process.env.PLAYBACK_TOKEN_SECRET : crypto4.randomBytes(32).toString("hex");
var PRIVATE_MEDIA_DIR = process.env.VERCEL === "1" ? path4.resolve(os2.tmpdir(), "deloken_private_media") : path4.resolve(process.cwd(), "private_media");
var UPLOADS_DIR = path4.resolve(PRIVATE_MEDIA_DIR, "uploads");
var THUMBNAILS_DIR = path4.resolve(PRIVATE_MEDIA_DIR, "thumbnails");
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
var blockedVideoStatuses = /* @__PURE__ */ new Map();
async function saveDeletionJob(job) {
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
async function patchDeletionJob(operationId, patch) {
  if (isSqlConfigured()) {
    await updateVideoDeletionJobSql(operationId, patch);
    return;
  }
  await withLedgerLock(async () => {
    const ledger = loadLedger();
    const jobs = ledger.videoDeletionJobs ?? [];
    ledger.videoDeletionJobs = jobs.map(
      (j) => j.operationId === operationId ? { ...j, ...patch } : j
    );
    saveLedger(ledger);
  });
}
async function fetchLatestDeletionJob(videoId) {
  if (isSqlConfigured()) {
    return getLatestVideoDeletionJobSql(videoId);
  }
  const ledger = loadLedger();
  return (ledger.videoDeletionJobs ?? []).filter((j) => j.videoId === videoId).sort((a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt))[0] ?? null;
}
async function fetchDeletionJobs(limitCount = 40) {
  if (isSqlConfigured()) {
    return listVideoDeletionJobsSql(limitCount);
  }
  const ledger = loadLedger();
  return (ledger.videoDeletionJobs ?? []).slice().sort((a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt)).slice(0, limitCount);
}
async function fetchStoredMediaBinding(videoId) {
  if (isSqlConfigured()) {
    return getCreatorMediaByVideoIdSql(videoId);
  }
  const ledger = loadLedger();
  return ledger.creatorMedia?.[videoId] ?? null;
}
async function removeStoredMediaBinding(videoId) {
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
async function isPlaybackBlockedForToken(payload) {
  if (blockedVideoStatuses.has(payload.videoId)) {
    return true;
  }
  try {
    const latestJob = await fetchLatestDeletionJob(payload.videoId);
    if (latestJob && (latestJob.status === "pending" || latestJob.status === "asset_deleted" || latestJob.status === "metadata_deleted" || latestJob.status === "completed")) {
      blockedVideoStatuses.set(payload.videoId, "deleted");
      return true;
    }
  } catch {
  }
  if (!payload.creatorPreview) {
    const resolved = await resolveServerVideoState(
      payload.videoId,
      firebase_applet_config_default.projectId,
      firebase_applet_config_default.firestoreDatabaseId
    );
    if (resolved.state !== "published") {
      return true;
    }
  }
  return false;
}
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
  const sig = crypto4.createHmac("sha256", PLAYBACK_SECRET).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}
function verifyPlaybackToken(token) {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expectedSig = crypto4.createHmac("sha256", PLAYBACK_SECRET).update(encoded).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto4.timingSafeEqual(sigBuf, expBuf)) {
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
  return crypto4.createHmac("sha256", PLAYBACK_SECRET).update(`sandbox:${paymentId}:${userId}:${amount}`).digest("hex");
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
    return await verifyFirebaseIdToken(idToken);
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
    const normalized = normalizeMediaSource(rawProvider, rawRef);
    const provider = normalized.provider === "unknown" ? "private_storage" : normalized.provider;
    const assetRef = normalized.assetRef;
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
  const baseDir = path4.resolve(PRIVATE_MEDIA_DIR, streamKey, quality);
  const target = path4.resolve(baseDir, fileName);
  if (!target.startsWith(baseDir + path4.sep)) {
    return null;
  }
  return target;
}
function safeResolveUploadedAsset(baseRoot, uid, fileName) {
  if (!isValidSafeId(uid) || !/^[a-zA-Z0-9._-]+$/.test(fileName)) {
    return null;
  }
  const userDir = path4.resolve(baseRoot, uid);
  const target = path4.resolve(userDir, fileName);
  if (!target.startsWith(userDir + path4.sep)) {
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
      const uniqueName = `${baseSlug}-${Date.now().toString(36)}-${crypto4.randomBytes(3).toString("hex")}${videoExt || imageExt}`;
      if (videoExt) {
        const target2 = safeResolveUploadedAsset(UPLOADS_DIR, uid, uniqueName);
        if (!target2) {
          res.status(400).json({ error: "Invalid upload path." });
          return;
        }
        try {
          fs4.mkdirSync(path4.dirname(target2), { recursive: true });
          fs4.writeFileSync(target2, bodyBuffer);
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
        fs4.mkdirSync(path4.dirname(target), { recursive: true });
        fs4.writeFileSync(target, bodyBuffer);
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
      if (fs4.existsSync(target)) {
        const ext = path4.extname(fileName).toLowerCase();
        const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
        res.setHeader("Content-Type", mime);
        res.setHeader("Cache-Control", "public, max-age=86400");
        const stream = fs4.createReadStream(target);
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
        fs4.mkdirSync(path4.dirname(target), { recursive: true });
        fs4.writeFileSync(target, buf);
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
  const inspectRateMap = /* @__PURE__ */ new Map();
  app2.post(
    "/api/creator/inspect-video-link",
    requireAuth,
    async (req, res) => {
      const uid = req.user.uid;
      const now = Date.now();
      const bucket = inspectRateMap.get(uid);
      if (!bucket || now > bucket.resetAt) {
        inspectRateMap.set(uid, { count: 1, resetAt: now + 6e4 });
      } else {
        bucket.count += 1;
        if (bucket.count > 25) {
          res.status(429).json({
            error: "Terlalu banyak pemeriksaan tautan dalam 1 menit. Tunggu sebentar lalu coba lagi."
          });
          return;
        }
      }
      const { url } = req.body;
      if (typeof url !== "string" || url.trim().length === 0 || url.trim().length > 980) {
        res.status(400).json({
          error: "Masukkan tautan HTTPS video yang valid (maksimal 980 karakter)."
        });
        return;
      }
      try {
        const result = await inspectUniversalVideoLink(url.trim());
        res.json(result);
      } catch (err) {
        res.status(500).json({
          error: err instanceof Error ? err.message : "Gagal memeriksa tautan video di server."
        });
      }
    }
  );
  const ALLOWED_REGISTER_PROVIDERS = /* @__PURE__ */ new Set([
    "cloudflare_stream",
    "private_storage",
    "youtube",
    "vimeo",
    "dailymotion",
    "tiktok",
    "facebook",
    "x",
    "instagram",
    "streamable",
    "direct_video"
  ]);
  app2.post(
    "/api/creator/register-video-media",
    requireAuth,
    async (req, res) => {
      const uid = req.user.uid;
      const { videoId, provider, assetRef, mimeType } = req.body;
      if (!isValidSafeId(videoId) || typeof provider !== "string" || !ALLOWED_REGISTER_PROVIDERS.has(provider) || typeof assetRef !== "string" || assetRef.trim().length < 3 || assetRef.trim().length > 1e3) {
        res.status(400).json({ error: "Invalid video media registration payload." });
        return;
      }
      const typedProvider = provider;
      let trimmedRef = assetRef.trim();
      if (typedProvider === "youtube") {
        const ytTarget = extractYouTubeEmbedTarget(trimmedRef);
        if (!ytTarget) {
          res.status(400).json({
            error: "Invalid YouTube link or ID. Use a standard youtube.com/watch?v=..., youtu.be/..., or youtube.com/playlist?list=... link."
          });
          return;
        }
        trimmedRef = ytTarget.canonicalRef;
      } else if (typedProvider === "facebook") {
        const fbUrl = extractFacebookVideoUrl(trimmedRef);
        if (!fbUrl) {
          res.status(400).json({
            error: "Invalid Facebook video link. Use a public facebook.com/.../videos/..., facebook.com/watch?v=..., facebook.com/reel/..., or fb.watch/... URL."
          });
          return;
        }
        trimmedRef = fbUrl;
      } else if (typedProvider === "vimeo") {
        const vimeo = extractVimeoVideoRef(trimmedRef);
        if (!vimeo) {
          res.status(400).json({ error: "Invalid Vimeo video URL or ID." });
          return;
        }
        trimmedRef = vimeo.canonicalRef;
      } else if (typedProvider === "dailymotion") {
        const dmId = extractDailymotionVideoId(trimmedRef);
        if (!dmId) {
          res.status(400).json({ error: "Invalid Dailymotion video URL or ID." });
          return;
        }
        trimmedRef = dmId;
      } else if (typedProvider === "streamable") {
        const stId = extractStreamableId(trimmedRef);
        if (!stId) {
          res.status(400).json({ error: "Invalid Streamable video URL or ID." });
          return;
        }
        trimmedRef = stId;
      } else if (typedProvider === "tiktok") {
        const tt = extractTikTokVideoInfo(trimmedRef);
        if (!tt) {
          res.status(400).json({ error: "Invalid TikTok video URL." });
          return;
        }
        trimmedRef = tt.canonicalRef;
      } else if (typedProvider === "x") {
        const xInfo = extractXPostInfo(trimmedRef);
        if (!xInfo) {
          res.status(400).json({ error: "Invalid X (Twitter) status URL." });
          return;
        }
        trimmedRef = xInfo.canonicalUrl;
      } else if (typedProvider === "instagram") {
        const ig = extractInstagramPostInfo(trimmedRef);
        if (!ig) {
          res.status(400).json({ error: "Invalid Instagram post or reel URL." });
          return;
        }
        trimmedRef = ig.canonicalUrl;
      } else if (typedProvider === "direct_video") {
        const guard = parseStrictHttpsUrl(trimmedRef, { allowBareHostname: false });
        if (!guard.ok) {
          res.status(400).json({ error: guard.messageEn });
          return;
        }
        trimmedRef = guard.url.toString();
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
          provider: typedProvider,
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
    let videoLifecycleState = "unavailable";
    let latestDeletionJob = null;
    try {
      const [ctx, videoState, priorJob] = await Promise.all([
        sqlReady ? getStreamAuthContextSql(req.user?.uid, videoId) : Promise.resolve({
          entitlement: null,
          mediaBinding: loadLedger().creatorMedia?.[videoId] ?? null
        }),
        resolveServerVideoState(
          videoId,
          firebase_applet_config_default.projectId,
          firebase_applet_config_default.firestoreDatabaseId,
          req.user?.rawIdToken
        ),
        fetchLatestDeletionJob(videoId).catch(() => null)
      ]);
      record = ctx.entitlement;
      mediaBinding = ctx.mediaBinding;
      resolvedVideo = videoState.entry;
      videoLifecycleState = videoState.state;
      latestDeletionJob = priorJob;
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
    const activeDeletionBlock = blockedVideoStatuses.get(videoId) === "deletion_pending" || blockedVideoStatuses.get(videoId) === "deleted" || Boolean(
      latestDeletionJob && (latestDeletionJob.status === "pending" || latestDeletionJob.status === "asset_deleted" || latestDeletionJob.status === "metadata_deleted" || latestDeletionJob.status === "completed")
    );
    if (videoLifecycleState === "deletion_pending" || activeDeletionBlock) {
      res.status(410).json({
        error: "Video ini telah dihapus atau sedang dalam proses penghapusan permanen.",
        code: "VIDEO_DELETED_OR_PENDING"
      });
      return;
    }
    if (videoLifecycleState === "archived" || blockedVideoStatuses.get(videoId) === "archived") {
      res.status(403).json({
        error: "Video ini telah diarsipkan dan tidak lagi tersedia untuk pemutaran.",
        code: "VIDEO_ARCHIVED"
      });
      return;
    }
    if (videoLifecycleState === "not_found") {
      res.status(404).json({
        error: "Video tidak ditemukan atau telah dihapus dari katalog.",
        code: "VIDEO_NOT_FOUND"
      });
      return;
    }
    if (videoLifecycleState === "unavailable") {
      res.status(403).json({
        error: "Video ini belum dipublikasikan, telah diarsipkan, atau tidak tersedia.",
        code: "VIDEO_UNAVAILABLE"
      });
      return;
    }
    if (videoLifecycleState === "error") {
      res.status(503).json({
        error: "Gagal memverifikasi status ketersediaan video dari server.",
        code: "VIDEO_STATUS_CHECK_FAILED"
      });
      return;
    }
    const isCreatorPreview = Boolean(
      req.user?.uid && (resolvedVideo && resolvedVideo.creatorId === req.user.uid || mediaBinding && mediaBinding.creatorId === req.user.uid)
    );
    if (videoLifecycleState !== "published" && !isCreatorPreview) {
      res.status(403).json({
        error: "Video ini belum tersedia untuk publik.",
        code: "VIDEO_NOT_PUBLISHED"
      });
      return;
    }
    const isFreeRelease = Boolean(
      resolvedVideo && resolvedVideo.priceUsd === 0 && resolvedVideo.priceIdr === 0 && resolvedVideo.creditCost === 0
    );
    const hasPaidEntitlement = Boolean(
      record && record.status !== "revoked" && now < record.expiresAtMs
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
        if (resolved && fs4.existsSync(resolved)) {
          const token2 = signPlaybackToken({
            v: 1,
            uid,
            videoId,
            streamKey: "uploaded-file",
            mode,
            maxSeg,
            exp: now + (isActive ? 18e5 : 6e5),
            jti: crypto4.randomUUID(),
            fileRef: `${ownerUid}/${fileName}`,
            mimeType: mediaBinding.mimeType || "video/mp4",
            creatorPreview: isCreatorPreview && videoLifecycleState !== "published"
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
      const ytTarget = extractYouTubeEmbedTarget(mediaBinding.assetRef);
      if (ytTarget) {
        res.json({
          mode,
          isFree: isFreeRelease,
          streamType: "youtube",
          provider: "youtube",
          ...ytTarget.kind === "video" ? { youtubeVideoId: ytTarget.videoId } : { youtubePlaylistId: ytTarget.playlistId },
          videoId,
          previewLimitSeconds: PREVIEW_LIMIT_SECONDS,
          resumeSeconds: hasPaidEntitlement && record ? record.resumeSeconds : 0,
          manifestUrl: ytTarget.embedUrl,
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
    if (mediaBinding && (mediaBinding.provider === "vimeo" || mediaBinding.provider === "private_storage" && mediaBinding.assetRef.startsWith("vimeo:"))) {
      const vimeo = extractVimeoVideoRef(mediaBinding.assetRef);
      if (vimeo) {
        res.json({
          mode,
          isFree: isFreeRelease,
          streamType: "vimeo",
          provider: "vimeo",
          vimeoVideoId: vimeo.id,
          vimeoHash: vimeo.hash,
          videoId,
          previewLimitSeconds: PREVIEW_LIMIT_SECONDS,
          resumeSeconds: hasPaidEntitlement && record ? record.resumeSeconds : 0,
          manifestUrl: vimeo.embedUrl,
          entitlement: entitlementPayload,
          serverTimeIso: new Date(now).toISOString()
        });
        return;
      }
    }
    if (mediaBinding && (mediaBinding.provider === "dailymotion" || mediaBinding.provider === "private_storage" && mediaBinding.assetRef.startsWith("dailymotion:"))) {
      const dmId = extractDailymotionVideoId(mediaBinding.assetRef);
      if (dmId) {
        res.json({
          mode,
          isFree: isFreeRelease,
          streamType: "dailymotion",
          provider: "dailymotion",
          dailymotionVideoId: dmId,
          videoId,
          previewLimitSeconds: PREVIEW_LIMIT_SECONDS,
          resumeSeconds: hasPaidEntitlement && record ? record.resumeSeconds : 0,
          manifestUrl: `https://www.dailymotion.com/embed/video/${dmId}?api=postMessage&autoplay=1`,
          entitlement: entitlementPayload,
          serverTimeIso: new Date(now).toISOString()
        });
        return;
      }
    }
    if (mediaBinding && mediaBinding.provider === "streamable") {
      const stId = extractStreamableId(mediaBinding.assetRef);
      if (stId) {
        res.json({
          mode,
          isFree: isFreeRelease,
          streamType: "streamable",
          provider: "streamable",
          streamableId: stId,
          videoId,
          previewLimitSeconds: PREVIEW_LIMIT_SECONDS,
          resumeSeconds: hasPaidEntitlement && record ? record.resumeSeconds : 0,
          manifestUrl: `https://streamable.com/e/${stId}?autoplay=1`,
          entitlement: entitlementPayload,
          serverTimeIso: new Date(now).toISOString()
        });
        return;
      }
    }
    if (mediaBinding && mediaBinding.provider === "tiktok") {
      const tt = extractTikTokVideoInfo(mediaBinding.assetRef);
      if (tt?.videoId) {
        res.json({
          mode,
          isFree: isFreeRelease,
          streamType: "tiktok",
          provider: "tiktok",
          videoId,
          previewLimitSeconds: PREVIEW_LIMIT_SECONDS,
          resumeSeconds: hasPaidEntitlement && record ? record.resumeSeconds : 0,
          manifestUrl: `https://www.tiktok.com/player/v1/${tt.videoId}?autoplay=1&controls=1`,
          entitlement: entitlementPayload,
          serverTimeIso: new Date(now).toISOString()
        });
        return;
      }
    }
    if (mediaBinding && (mediaBinding.provider === "direct_video" || mediaBinding.provider === "private_storage" && mediaBinding.assetRef.startsWith("direct:"))) {
      const cleanDirect = mediaBinding.assetRef.startsWith("direct:") ? mediaBinding.assetRef.slice("direct:".length).trim() : mediaBinding.assetRef.trim();
      const guard = parseStrictHttpsUrl(cleanDirect, { allowBareHostname: false });
      if (guard.ok) {
        const mimeLower = (mediaBinding.mimeType || "").toLowerCase();
        const inferredFormat = mimeLower.includes("mpegurl") || mimeLower.includes("hls") ? "hls" : mimeLower.includes("dash") ? "dash" : inferDirectFormatFromUrl(guard.url) ?? "mp4";
        res.json({
          mode,
          isFree: isFreeRelease,
          streamType: "direct_video",
          provider: "direct_video",
          directFormat: inferredFormat,
          videoId,
          previewLimitSeconds: PREVIEW_LIMIT_SECONDS,
          resumeSeconds: hasPaidEntitlement && record ? record.resumeSeconds : 0,
          manifestUrl: guard.url.toString(),
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
      jti: crypto4.randomUUID(),
      creatorPreview: isCreatorPreview && videoLifecycleState !== "published"
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
  app2.get("/api/stream/file", async (req, res) => {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    const payload = verifyPlaybackToken(token);
    if (!payload || payload.streamKey !== "uploaded-file" || !payload.fileRef) {
      res.status(403).json({ error: "Invalid or expired file playback token." });
      return;
    }
    if (await isPlaybackBlockedForToken(payload)) {
      res.status(403).json({ error: "This release is archived or no longer available." });
      return;
    }
    const parts = payload.fileRef.split("/");
    if (parts.length !== 2) {
      res.status(400).json({ error: "Invalid media reference." });
      return;
    }
    const targetFile = safeResolveUploadedAsset(UPLOADS_DIR, parts[0], parts[1]);
    if (!targetFile || !fs4.existsSync(targetFile)) {
      res.status(404).json({ error: "Uploaded media file not found." });
      return;
    }
    const stat = fs4.statSync(targetFile);
    const total = stat.size;
    const ext = path4.extname(parts[1]).toLowerCase();
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
      const stream2 = fs4.createReadStream(targetFile, { start, end });
      stream2.pipe(res);
      res.on("close", () => stream2.destroy());
      return;
    }
    res.setHeader("Content-Length", String(total));
    res.setHeader("Content-Type", contentType);
    const stream = fs4.createReadStream(targetFile);
    stream.pipe(res);
    res.on("close", () => stream.destroy());
  });
  app2.get("/api/stream/master.m3u8", async (req, res) => {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    const payload = verifyPlaybackToken(token);
    if (!payload) {
      res.status(403).json({ error: "Invalid or expired playback token." });
      return;
    }
    if (await isPlaybackBlockedForToken(payload)) {
      res.status(403).json({ error: "This release is archived or no longer available." });
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
    if (blockedVideoStatuses.has(payload.videoId)) {
      res.status(403).json({ error: "This release is archived or no longer available." });
      return;
    }
    const playlistFile = safeResolveMediaFile(payload.streamKey, quality, "index.m3u8");
    if (!playlistFile || !fs4.existsSync(playlistFile)) {
      res.status(404).json({ error: "Stream playlist unavailable." });
      return;
    }
    const rawLines = fs4.readFileSync(playlistFile, "utf-8").split("\n");
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
    if (blockedVideoStatuses.has(payload.videoId)) {
      res.status(403).json({ error: "This release is archived or no longer available." });
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
    if (!segFile || !fs4.existsSync(segFile)) {
      res.status(404).json({ error: "Segment not found." });
      return;
    }
    res.setHeader("Content-Type", "video/mp2t");
    res.setHeader("Cache-Control", "private, no-store");
    const stream = fs4.createReadStream(segFile);
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
      const videoState = await resolveServerVideoState(
        videoId,
        firebase_applet_config_default.projectId,
        firebase_applet_config_default.firestoreDatabaseId,
        req.user?.rawIdToken
      );
      if (blockedVideoStatuses.has(videoId) || videoState.state === "archived" || videoState.state === "deletion_pending" || videoState.state === "not_found" || videoState.state === "unavailable") {
        res.status(403).json({ error: "Release is archived or unavailable." });
        return;
      }
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
      const paymentId = `pay_cr_${crypto4.randomUUID().slice(0, 12)}`;
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
    const paymentId = `pay_pp_${crypto4.randomUUID().slice(0, 12)}`;
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
      if (a.length !== b.length || !crypto4.timingSafeEqual(a, b)) {
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
    const paymentId = `pay_qr_${crypto4.randomUUID().slice(0, 12)}`;
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
      const expected = crypto4.createHmac("sha256", secret).update(JSON.stringify(body)).digest("hex");
      const a = Buffer.from(expected, "utf8");
      const b = Buffer.from(sigHeader, "utf8");
      if (a.length !== b.length || !crypto4.timingSafeEqual(a, b)) {
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
      const expected = crypto4.createHmac("sha256", secret).update(JSON.stringify(body)).digest("hex");
      const a = Buffer.from(expected, "utf8");
      const b = Buffer.from(sigHeader, "utf8");
      if (a.length !== b.length || !crypto4.timingSafeEqual(a, b)) {
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
        payoutId: `payo_${crypto4.randomUUID().slice(0, 10)}`,
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
  app2.get("/api/admin/video-deletion-jobs", requireAdmin, async (_req, res) => {
    try {
      const jobs = await fetchDeletionJobs(40);
      res.json({ jobs });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to load video deletion audit logs."
      });
    }
  });
  app2.get("/api/admin/videos/:videoId/asset-info", requireAdmin, async (req, res) => {
    const videoId = req.params.videoId;
    if (!isValidSafeId(videoId)) {
      res.status(400).json({ error: "Invalid videoId." });
      return;
    }
    try {
      const bearerToken = req.user.rawIdToken;
      const [videoDoc, assetDoc, sqlMedia, latestJob] = await Promise.all([
        firestoreGetDocument(
          firebase_applet_config_default.projectId,
          firebase_applet_config_default.firestoreDatabaseId,
          "videos",
          videoId,
          bearerToken
        ),
        firestoreGetDocument(
          firebase_applet_config_default.projectId,
          firebase_applet_config_default.firestoreDatabaseId,
          "video_assets",
          videoId,
          bearerToken
        ),
        fetchStoredMediaBinding(videoId).catch(() => null),
        fetchLatestDeletionJob(videoId).catch(() => null)
      ]);
      if (!videoDoc.exists && !latestJob) {
        res.status(404).json({ error: "Video not found." });
        return;
      }
      const rawProvider = assetDoc.fields.provider?.stringValue || sqlMedia?.provider || "";
      const rawRef = assetDoc.fields.assetRef?.stringValue || sqlMedia?.assetRef || "";
      const normalized = rawProvider || rawRef ? normalizeMediaSource(rawProvider, rawRef) : {
        provider: latestJob?.provider || "unknown",
        assetRef: ""
      };
      const title = videoDoc.fields.title?.stringValue || latestJob?.videoTitleSnapshot || videoId;
      const status = videoDoc.fields.status?.stringValue || (latestJob?.status === "completed" ? "deletion_pending" : "draft");
      const previousStatus = videoDoc.fields.previousStatus?.stringValue || "";
      const thumbnailUrl = videoDoc.fields.thumbnailUrl?.stringValue || "";
      const creatorId = videoDoc.fields.creatorId?.stringValue || assetDoc.fields.creatorId?.stringValue || sqlMedia?.creatorId || "";
      const assetRefFingerprint = rawRef ? buildAssetRefFingerprint(normalized.provider, normalized.assetRef) : latestJob?.assetRefFingerprint || "unknown:unavailable";
      const assetInfo = {
        videoId,
        title,
        status,
        previousStatus,
        provider: normalized.provider,
        assetRefFingerprint,
        isExternalPlatform: isExternalLinkProvider(normalized.provider),
        externalMediaWarning: getExternalPlatformWarning(normalized.provider),
        thumbnailUrl,
        creatorId
      };
      res.json({ assetInfo, latestJob });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Unable to inspect video asset metadata."
      });
    }
  });
  app2.post("/api/admin/videos/:videoId/archive", requireAdmin, async (req, res) => {
    const videoId = req.params.videoId;
    if (!isValidSafeId(videoId)) {
      res.status(400).json({ error: "Invalid videoId." });
      return;
    }
    const body = req.body || {};
    const rawNote = typeof body.moderationNote === "string" ? body.moderationNote.trim().slice(0, 500) : "";
    try {
      const bearerToken = req.user.rawIdToken;
      const videoDoc = await firestoreGetDocument(
        firebase_applet_config_default.projectId,
        firebase_applet_config_default.firestoreDatabaseId,
        "videos",
        videoId,
        bearerToken
      );
      if (!videoDoc.exists) {
        res.status(404).json({ error: "Video not found." });
        return;
      }
      const currentStatus = videoDoc.fields.status?.stringValue || "draft";
      if (currentStatus === "deletion_pending") {
        res.status(409).json({
          error: "Video sedang dalam proses penghapusan permanen dan tidak dapat diarsipkan."
        });
        return;
      }
      const existingPrevious = videoDoc.fields.previousStatus?.stringValue || "";
      const previousStatus = currentStatus === "archived" ? VALID_RESTORABLE_STATUSES.has(existingPrevious) ? existingPrevious : "" : VALID_RESTORABLE_STATUSES.has(currentStatus) ? currentStatus : "";
      const nextNote = rawNote || videoDoc.fields.moderationNote?.stringValue || "Archived by Admin";
      await firestoreCommitVideoFields(
        firebase_applet_config_default.projectId,
        firebase_applet_config_default.firestoreDatabaseId,
        videoId,
        {
          status: { stringValue: "archived" },
          previousStatus: { stringValue: previousStatus },
          moderationNote: { stringValue: nextNote }
        },
        bearerToken
      );
      blockedVideoStatuses.set(videoId, "archived");
      res.json({
        ok: true,
        videoId,
        status: "archived",
        previousStatus
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to archive video."
      });
    }
  });
  app2.post("/api/admin/videos/:videoId/restore", requireAdmin, async (req, res) => {
    const videoId = req.params.videoId;
    if (!isValidSafeId(videoId)) {
      res.status(400).json({ error: "Invalid videoId." });
      return;
    }
    const body = req.body || {};
    const requestedTarget = typeof body.targetStatus === "string" && VALID_RESTORABLE_STATUSES.has(body.targetStatus) ? body.targetStatus : null;
    const rawNote = typeof body.moderationNote === "string" ? body.moderationNote.trim().slice(0, 500) : "";
    try {
      const bearerToken = req.user.rawIdToken;
      const videoDoc = await firestoreGetDocument(
        firebase_applet_config_default.projectId,
        firebase_applet_config_default.firestoreDatabaseId,
        "videos",
        videoId,
        bearerToken
      );
      if (!videoDoc.exists) {
        res.status(404).json({ error: "Video not found." });
        return;
      }
      const currentStatus = videoDoc.fields.status?.stringValue || "draft";
      if (currentStatus === "deletion_pending") {
        res.status(409).json({
          error: "Video sedang dalam proses penghapusan permanen."
        });
        return;
      }
      if (currentStatus !== "archived") {
        res.status(409).json({
          error: `Video tidak berada dalam status arsip (status saat ini: ${currentStatus}).`
        });
        return;
      }
      const storedPrevious = videoDoc.fields.previousStatus?.stringValue || "";
      const hasValidPrevious = VALID_RESTORABLE_STATUSES.has(
        storedPrevious
      );
      let restoredStatus;
      if (hasValidPrevious) {
        restoredStatus = storedPrevious;
      } else if (requestedTarget) {
        restoredStatus = requestedTarget;
      } else {
        res.status(400).json({
          error: "Status asal video tidak tersedia. Pilih status tujuan pemulihan secara eksplisit (tidak dipublikasikan otomatis).",
          code: "TARGET_STATUS_REQUIRED"
        });
        return;
      }
      const existingPublishedAt = videoDoc.fields.publishedAt?.stringValue || "";
      const nextPublishedAt = restoredStatus === "published" && !existingPublishedAt ? (/* @__PURE__ */ new Date()).toISOString().slice(0, 10) : existingPublishedAt;
      const nextNote = rawNote || `Restored by Admin to ${restoredStatus.replace("_", " ")}`;
      await firestoreCommitVideoFields(
        firebase_applet_config_default.projectId,
        firebase_applet_config_default.firestoreDatabaseId,
        videoId,
        {
          status: { stringValue: restoredStatus },
          previousStatus: { stringValue: "" },
          publishedAt: { stringValue: nextPublishedAt },
          moderationNote: { stringValue: nextNote }
        },
        bearerToken
      );
      blockedVideoStatuses.delete(videoId);
      res.json({
        ok: true,
        videoId,
        status: restoredStatus,
        restoredFromPreviousStatus: hasValidPrevious
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to restore archived video."
      });
    }
  });
  const performPermanentVideoDelete = async (params) => {
    const { videoId, adminUid, bearerToken, confirmationMode, confirmationText = "" } = params;
    if (!isValidSafeId(videoId)) {
      return { ok: false, status: 400, error: "Invalid videoId." };
    }
    let videoDoc;
    let assetDoc;
    let sqlMedia = null;
    let priorJob = null;
    try {
      [videoDoc, assetDoc, sqlMedia, priorJob] = await Promise.all([
        firestoreGetDocument(
          firebase_applet_config_default.projectId,
          firebase_applet_config_default.firestoreDatabaseId,
          "videos",
          videoId,
          bearerToken
        ),
        firestoreGetDocument(
          firebase_applet_config_default.projectId,
          firebase_applet_config_default.firestoreDatabaseId,
          "video_assets",
          videoId,
          bearerToken
        ),
        fetchStoredMediaBinding(videoId).catch(() => null),
        fetchLatestDeletionJob(videoId).catch(() => null)
      ]);
    } catch (err) {
      return {
        ok: false,
        status: 500,
        error: err instanceof Error ? err.message : "Failed to read authoritative video records."
      };
    }
    if (priorJob?.status === "completed" && !videoDoc.exists && !assetDoc.exists && !sqlMedia) {
      blockedVideoStatuses.set(videoId, "deleted");
      return {
        ok: true,
        idempotent: true,
        job: priorJob,
        preservedFinancialRecords: true
      };
    }
    const titleSnapshot = (videoDoc.fields.title?.stringValue || priorJob?.videoTitleSnapshot || "").trim();
    if (!titleSnapshot) {
      return { ok: false, status: 404, error: "Video record not found." };
    }
    if (confirmationMode === "exact_title") {
      const rawConfirmation = confirmationText.trim();
      if (!rawConfirmation || rawConfirmation.toLowerCase() !== titleSnapshot.toLowerCase()) {
        return {
          ok: false,
          status: 400,
          error: `Konfirmasi penghapusan gagal. Ketik judul video secara persis: "${titleSnapshot}".`,
          code: "CONFIRMATION_MISMATCH"
        };
      }
    }
    const rawProvider = assetDoc.fields.provider?.stringValue || sqlMedia?.provider || "";
    const rawRef = assetDoc.fields.assetRef?.stringValue || sqlMedia?.assetRef || "";
    const normalized = rawProvider || rawRef ? normalizeMediaSource(rawProvider, rawRef) : priorJob && (priorJob.providerResult === "deleted" || priorJob.providerResult === "already_missing" || priorJob.providerResult === "external_retained" || priorJob.providerResult === "shared_preset_retained") ? {
      provider: priorJob.provider,
      assetRef: ""
    } : { provider: "unknown", assetRef: "" };
    const providerAlreadyResolved = Boolean(
      priorJob && (priorJob.providerResult === "deleted" || priorJob.providerResult === "already_missing" || priorJob.providerResult === "external_retained" || priorJob.providerResult === "shared_preset_retained")
    );
    const fingerprint = normalized.assetRef ? buildAssetRefFingerprint(normalized.provider, normalized.assetRef) : priorJob?.assetRefFingerprint || "unknown:unavailable";
    const externalWarning = getExternalPlatformWarning(normalized.provider);
    let validatedPrivateFile = null;
    if (!providerAlreadyResolved) {
      if (normalized.provider === "unknown" || !normalized.assetRef) {
        return {
          ok: false,
          status: 422,
          error: "Provider media tidak dikenal atau metadata aset video tidak ditemukan. Penghapusan dihentikan aman tanpa menghapus metadata.",
          code: "UNKNOWN_OR_MISSING_ASSET_PROVIDER"
        };
      }
      if (normalized.provider === "cloudflare_stream") {
        if (!/^[a-zA-Z0-9_-]{8,128}$/.test(normalized.assetRef)) {
          return {
            ok: false,
            status: 422,
            error: "ID aset Cloudflare Stream tidak valid. Penghapusan dihentikan aman tanpa menghapus metadata.",
            code: "INVALID_CLOUDFLARE_UID"
          };
        }
        if (!isCloudflareStreamConfigured()) {
          return {
            ok: false,
            status: 503,
            error: "Kredensial Cloudflare Stream server belum aktif sehingga penghapusan file Cloudflare tidak dapat dilakukan.",
            code: "CLOUDFLARE_NOT_CONFIGURED"
          };
        }
      } else if (normalized.provider === "private_storage") {
        validatedPrivateFile = validatePrivateStorageAssetRef(
          UPLOADS_DIR,
          normalized.assetRef
        );
        if (validatedPrivateFile.kind === "invalid") {
          return {
            ok: false,
            status: 422,
            error: "Referensi file penyimpanan lokal tidak valid atau keluar dari direktori upload. Penghapusan dihentikan aman.",
            code: "INVALID_ASSET_REF"
          };
        }
      } else if (isExternalLinkProvider(normalized.provider)) {
        if (!validateExternalProviderAssetRef(normalized.provider, normalized.assetRef)) {
          return {
            ok: false,
            status: 422,
            error: `Referensi tautan eksternal (${normalized.provider}) tidak valid.`,
            code: "INVALID_EXTERNAL_REF"
          };
        }
      }
    }
    const operationId = `del_${crypto4.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    let job = {
      operationId,
      videoId,
      videoTitleSnapshot: titleSnapshot.slice(0, 140),
      provider: normalized.provider,
      assetRefFingerprint: fingerprint,
      requestedBy: adminUid,
      requestedAt: nowIso,
      status: "pending",
      providerResult: providerAlreadyResolved ? priorJob.providerResult : "pending",
      firestoreResult: !videoDoc.exists && !assetDoc.exists ? "already_missing" : "pending",
      sqlResult: !sqlMedia ? "already_missing" : "pending",
      thumbnailResult: "skipped",
      externalMediaWarning: externalWarning,
      errorCode: null,
      errorMessage: null,
      completedAt: null
    };
    try {
      job = await saveDeletionJob(job);
    } catch (err) {
      return {
        ok: false,
        status: 500,
        error: err instanceof Error ? err.message : "Unable to create deletion audit record."
      };
    }
    blockedVideoStatuses.set(videoId, "deletion_pending");
    if (videoDoc.exists) {
      const currentStatus = videoDoc.fields.status?.stringValue || "draft";
      if (currentStatus !== "deletion_pending") {
        try {
          await firestoreCommitVideoFields(
            firebase_applet_config_default.projectId,
            firebase_applet_config_default.firestoreDatabaseId,
            videoId,
            {
              status: { stringValue: "deletion_pending" },
              moderationNote: {
                stringValue: `Permanent deletion in progress (${operationId})`
              }
            },
            bearerToken
          );
        } catch (err) {
          const safeMsg = err instanceof Error ? err.message : "Failed to set deletion_pending tombstone.";
          await patchDeletionJob(operationId, {
            status: "failed",
            errorCode: "TOMBSTONE_FAILED",
            errorMessage: safeMsg.slice(0, 280)
          }).catch(() => {
          });
          return {
            ok: false,
            status: 502,
            error: safeMsg,
            code: "TOMBSTONE_FAILED",
            job
          };
        }
      }
    }
    if (!providerAlreadyResolved) {
      try {
        if (normalized.provider === "cloudflare_stream") {
          const cfRes = await deleteCloudflareVideo(normalized.assetRef);
          job.providerResult = cfRes.alreadyMissing ? "already_missing" : "deleted";
        } else if (normalized.provider === "private_storage" && validatedPrivateFile) {
          if (validatedPrivateFile.kind === "shared_preset") {
            job.providerResult = "shared_preset_retained";
          } else if (validatedPrivateFile.kind === "uploaded_file") {
            job.providerResult = deleteFileIfExists(validatedPrivateFile.resolvedPath);
          }
        } else if (isExternalLinkProvider(normalized.provider)) {
          job.providerResult = "external_retained";
        }
        job.status = "asset_deleted";
        await patchDeletionJob(operationId, {
          status: job.status,
          providerResult: job.providerResult
        });
      } catch (err) {
        const safeMsg = err instanceof Error ? err.message : "Provider asset deletion failed.";
        job.status = "failed";
        job.errorCode = "PROVIDER_DELETE_FAILED";
        job.errorMessage = safeMsg.slice(0, 280);
        await patchDeletionJob(operationId, {
          status: "failed",
          providerResult: "failed",
          errorCode: job.errorCode,
          errorMessage: job.errorMessage
        }).catch(() => {
        });
        return {
          ok: false,
          status: 502,
          error: safeMsg,
          code: "PROVIDER_DELETE_FAILED",
          job
        };
      }
    } else {
      job.status = "asset_deleted";
      await patchDeletionJob(operationId, {
        status: "asset_deleted",
        providerResult: job.providerResult
      }).catch(() => {
      });
    }
    const thumbUrl = videoDoc.fields.thumbnailUrl?.stringValue || "";
    const creatorId = videoDoc.fields.creatorId?.stringValue || assetDoc.fields.creatorId?.stringValue || sqlMedia?.creatorId || "";
    if (thumbUrl) {
      const thumbCheck = await verifyExclusiveLocalThumbnail({
        thumbnailsDir: THUMBNAILS_DIR,
        thumbUrl,
        excludeVideoId: videoId,
        expectedCreatorId: creatorId,
        projectId: firebase_applet_config_default.projectId,
        databaseId: firebase_applet_config_default.firestoreDatabaseId,
        bearerToken
      });
      if (thumbCheck.safeToDelete) {
        try {
          const fileStatus = deleteFileIfExists(thumbCheck.resolvedPath);
          let sqlThumbDeleted = 0;
          if (isSqlConfigured()) {
            const sqlRes = await deleteThumbnailAssetSql(thumbCheck.sqlThumbKey);
            sqlThumbDeleted = sqlRes.deletedCount;
          }
          job.thumbnailResult = fileStatus === "deleted" || sqlThumbDeleted > 0 ? "deleted" : "already_missing";
        } catch {
          job.thumbnailResult = "retained_cleanup_error";
        }
      } else {
        job.thumbnailResult = thumbCheck.reason;
      }
    }
    try {
      const [assetDel, videoDel] = await Promise.all([
        firestoreDeleteDocument(
          firebase_applet_config_default.projectId,
          firebase_applet_config_default.firestoreDatabaseId,
          "video_assets",
          videoId,
          bearerToken
        ),
        firestoreDeleteDocument(
          firebase_applet_config_default.projectId,
          firebase_applet_config_default.firestoreDatabaseId,
          "videos",
          videoId,
          bearerToken
        )
      ]);
      blockedVideoStatuses.set(videoId, "deleted");
      job.firestoreResult = assetDel.alreadyMissing && videoDel.alreadyMissing ? "already_missing" : "deleted";
      job.status = "metadata_deleted";
      await patchDeletionJob(operationId, {
        status: job.status,
        firestoreResult: job.firestoreResult,
        thumbnailResult: job.thumbnailResult
      });
    } catch (err) {
      const safeMsg = err instanceof Error ? err.message : "Failed to delete Firestore video metadata.";
      job.status = "asset_deleted";
      job.errorCode = "FIRESTORE_DELETE_FAILED";
      job.errorMessage = safeMsg.slice(0, 280);
      await patchDeletionJob(operationId, {
        status: "asset_deleted",
        firestoreResult: "failed",
        thumbnailResult: job.thumbnailResult,
        errorCode: job.errorCode,
        errorMessage: job.errorMessage
      }).catch(() => {
      });
      return {
        ok: false,
        status: 502,
        error: safeMsg,
        code: "FIRESTORE_DELETE_FAILED",
        job
      };
    }
    try {
      const sqlCleanup = await removeStoredMediaBinding(videoId);
      job.sqlResult = sqlCleanup.deletedCount > 0 ? "deleted" : "already_missing";
      job.status = "completed";
      job.completedAt = (/* @__PURE__ */ new Date()).toISOString();
      job.errorCode = null;
      job.errorMessage = null;
      await patchDeletionJob(operationId, {
        status: "completed",
        sqlResult: job.sqlResult,
        completedAt: job.completedAt,
        errorCode: null,
        errorMessage: null
      });
    } catch (err) {
      const safeMsg = err instanceof Error ? err.message : "Failed to remove creator_media mapping.";
      job.status = "metadata_deleted";
      job.errorCode = "SQL_CLEANUP_FAILED";
      job.errorMessage = safeMsg.slice(0, 280);
      await patchDeletionJob(operationId, {
        status: "metadata_deleted",
        sqlResult: "failed",
        errorCode: job.errorCode,
        errorMessage: job.errorMessage
      }).catch(() => {
      });
      return {
        ok: false,
        status: 502,
        error: safeMsg,
        code: "SQL_CLEANUP_FAILED",
        job
      };
    }
    return {
      ok: true,
      job,
      preservedFinancialRecords: true
    };
  };
  app2.delete("/api/admin/videos/:videoId", requireAdmin, async (req, res) => {
    const videoId = req.params.videoId;
    const body = req.body || {};
    const headerConf = req.headers["x-delete-confirmation"];
    const rawConfirmation = typeof body.confirmationText === "string" ? body.confirmationText.trim() : typeof headerConf === "string" ? headerConf.trim() : "";
    const outcome = await performPermanentVideoDelete({
      videoId,
      adminUid: req.user.uid,
      bearerToken: req.user.rawIdToken,
      confirmationMode: "exact_title",
      confirmationText: rawConfirmation
    });
    if (!outcome.ok) {
      res.status(outcome.status).json({
        error: outcome.error,
        ...outcome.code ? { code: outcome.code } : {},
        ...outcome.job ? { job: outcome.job } : {}
      });
      return;
    }
    res.json(outcome);
  });
  app2.post("/api/admin/videos/bulk-delete", requireAdmin, async (req, res) => {
    const body = req.body || {};
    if (!Array.isArray(body.videoIds) || body.videoIds.length === 0) {
      res.status(400).json({ error: "Pilih minimal satu video untuk dihapus permanen." });
      return;
    }
    const uniqueIds = Array.from(
      new Set(
        body.videoIds.filter((id) => typeof id === "string").map((id) => id.trim()).filter(Boolean)
      )
    );
    if (uniqueIds.length === 0 || uniqueIds.length > 50) {
      res.status(400).json({
        error: "Jumlah video untuk penghapusan massal harus antara 1 sampai 50 video."
      });
      return;
    }
    for (const id of uniqueIds) {
      if (!isValidSafeId(id)) {
        res.status(400).json({ error: `Invalid videoId in selection: ${id}` });
        return;
      }
    }
    const rawPhrase = typeof body.confirmationPhrase === "string" ? body.confirmationPhrase.trim().toUpperCase().replace(/\s+/g, " ") : "";
    const expectedIdPhrase = `HAPUS ${uniqueIds.length} VIDEO`;
    const expectedEnPhrase = `DELETE ${uniqueIds.length} VIDEOS`;
    const expectedEnSingular = `DELETE ${uniqueIds.length} VIDEO`;
    if (rawPhrase !== expectedIdPhrase && rawPhrase !== expectedEnPhrase && rawPhrase !== expectedEnSingular) {
      res.status(400).json({
        error: `Konfirmasi penghapusan massal tidak cocok. Ketik "${expectedIdPhrase}" untuk melanjutkan.`,
        code: "BULK_CONFIRMATION_MISMATCH"
      });
      return;
    }
    const results = [];
    let deletedCount = 0;
    let failedCount = 0;
    for (const videoId of uniqueIds) {
      const outcome = await performPermanentVideoDelete({
        videoId,
        adminUid: req.user.uid,
        bearerToken: req.user.rawIdToken,
        confirmationMode: "bulk_verified"
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
          job: outcome.job
        });
      }
    }
    res.json({
      ok: deletedCount > 0 || failedCount === 0,
      total: uniqueIds.length,
      deletedCount,
      failedCount,
      preservedFinancialRecords: true,
      results
    });
  });
  return app2;
}

// server/vercelEntry.ts
var app = createApiApp();
var vercelEntry_default = app;
export {
  vercelEntry_default as default
};
