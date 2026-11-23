# Security Summary

**Reviewed Files**: 14
**Issues Resolved**: 3

### Issues Resolved
| Area | File | Line | What Was Happening | Impact | Status | How It Was Fixed |
|---|---|---|---|---|---|---|
| Webhook Authentication Secret | `server.ts` | 1329 | The fallback PayPal webhook HMAC verification previously allowed `process.env.PAYPAL_WEBHOOK_ID` (a non-secret webhook identifier) as an HMAC signing secret when PayPal REST credentials were absent. | High | Fixed | Removed `PAYPAL_WEBHOOK_ID` from HMAC verification, introduced a dedicated `PAYPAL_WEBHOOK_SECRET` in `.env.example` and `server.ts`, and fail-closed in production when no PayPal REST credentials or `PAYPAL_WEBHOOK_SECRET` are set. |
| Webhook Settlement Amount Integrity | `server.ts` | 1367, 1460 | PayPal and QRIS webhook handlers checked the order status string without cross-checking the settled payment amount against the server-recorded order total. | Medium | Fixed | Added server-side amount verification comparing PayPal `amount.value` (within $0.02 rounding tolerance) and Midtrans QRIS `gross_amount` against the stored ledger order before fulfilling entitlements or wallet credits. |
| Creator Payout Currency & Channel Validation | `server.ts` | 1524 | `POST /api/creator/payouts/request` accepted any valid payout method regardless of whether the requested payout currency was `USD` or `IDR`. | Low | Fixed | Enforced strict pairing (`USD` requires `paypal_usd`; `IDR` requires `bank_transfer_idr` or `ewallet_idr`) and narrowed the validated method type server-side. |

### Safeguards Verified
| Area | File | How It's Protected |
|---|---|---|
| API Keys & Gateway Secrets | `server.ts`, `.env.example` | PayPal, Midtrans QRIS, playback signing, and webhook HMAC secrets are loaded solely from `process.env` on the Express server and never sent to the browser bundle. |
| Media Path Confinement & Preview Limit | `server.ts` | `safeResolveMediaFile` enforces `ALLOWED_STREAMS` and `ALLOWED_QUALITIES` allowlists plus `path.resolve` prefix confinement inside `private_media/`. `GET /api/stream/segment/:index` returns `402 PREVIEW_LIMIT_REACHED` whenever `segIndex > payload.maxSeg` (index `29`, 300s). |
| Authentication & Role Enforcement | `server.ts` | Protected viewer, creator, and admin routes verify Firebase ID tokens via `firebase-admin/auth` (`verifyIdToken`) and check verified admin claims (`isServerAdmin`) before processing mutations or returning private data. |
| Payment Idempotency & Wallet Atomicity | `server.ts`, `server/paymentService.ts` | Wallet deductions, payment capture, webhooks, creator payouts, and refunds execute sequentially inside `withLedgerLock` with persisted `Idempotency-Key` and `processedWebhooks` tracking to prevent double-spending and duplicate grants. |
| QR Code Rendering | `src/components/checkout/CheckoutModal.tsx`, `server.ts` | Dynamic QRIS codes are encoded client-side via `QRCode.toDataURL` and rendered safely in a standard `<img>` element rather than raw SVG/HTML injection; unused `qrSvg` payload was removed from the API response. |
| Firestore Access Control & Schema Rules | `firestore.rules` | Default-deny root rule, server-only writes on financial collections (`wallets` updates, `wallet_transactions`, `purchases`, `entitlements`, `payments`, `creator_earnings`, `payouts`), owner isolation on PII, and verified schema checks validated with zero `eslint` errors. |

---

## PoC Verification

### 1. Forged PayPal Webhook Signature Using Public `PAYPAL_WEBHOOK_ID`

#### Summary
| Field | Value |
|---|---|
| Issue Type | Weak Webhook Signature Verification Fallback |
| Impact | High |
| Affected File | `server.ts:1329-1344` |
| Test Scenario | `POST /api/webhooks/paypal` under `NODE_ENV=production` with `PAYPAL_WEBHOOK_ID=WH-PUBLIC-ID-TEST` and `x-vyora-webhook-signature` computed via HMAC-SHA256 using `WH-PUBLIC-ID-TEST` |

#### How It Was Fixed
Removed `process.env.PAYPAL_WEBHOOK_ID` from the HMAC fallback expression at `server.ts:1329`. When full PayPal REST signature verification (`isPayPalConfigured() && webhookId`) is inactive, the endpoint now requires `process.env.PAYPAL_WEBHOOK_SECRET` in production and immediately rejects missing or mismatched secrets with HTTP `401`.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | Forged `PAYMENT.CAPTURE.COMPLETED` payload signed with `WH-PUBLIC-ID-TEST` arrives at `POST /api/webhooks/paypal` (`server.ts:1278`). | Request enters webhook handler |
| 2 | PayPal REST client credentials are not active, so execution enters the fallback branch (`server.ts:1328`). `secret` resolves from `process.env.PAYPAL_WEBHOOK_SECRET \|\| (!IS_PRODUCTION ? PLAYBACK_SECRET : '')`, yielding `''` in production. | `WH-PUBLIC-ID-TEST` is ignored as a signing key |
| 3 | `!secret \|\| !sigHeader` triggers at `server.ts:1331-1333` and returns HTTP `401` (`"Missing PayPal webhook authentication."`). | **Handled Safely** |

#### Conclusion
**Fix Verified** - Verified live against `NODE_ENV=production node server.ts` on port `3098`, where the forged webhook returned HTTP `401` without modifying any payment or entitlement records.

---

### 2. Streaming Path Traversal & 5-Minute Preview Bypass Attempt

#### Summary
| Field | Value |
|---|---|
| Issue Type | Path Traversal & Access Control Enforcement |
| Impact | High |
| Affected File | `server.ts:275-289`, `server.ts:477-491` |
| Test Scenario | `GET /api/stream/segment/0?quality=../../etc/passwd` and `GET /api/stream/segment/30` with a valid `preview` playback token |

#### How It Was Fixed
`safeResolveMediaFile` (`server.ts:275-289`) checks `ALLOWED_STREAMS` and `ALLOWED_QUALITIES` before resolving inside `PRIVATE_MEDIA_DIR` and verifying `target.startsWith(baseDir + path.sep)`. Additionally, `segIndex > payload.maxSeg` (`server.ts:477`) blocks any request past segment `29` (300 seconds) in `preview` mode with HTTP `402`.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | Caller requests `/api/stream/segment/0?quality=../../etc/passwd` with a valid preview token (`server.ts:461`). | Token verified; `safeResolveMediaFile` called |
| 2 | `ALLOWED_QUALITIES.has('../../etc/passwd')` evaluates to `false` at `server.ts:280`, returning `null`, which yields HTTP `404` (`server.ts:488-490`). | **Handled Safely** |
| 3 | Caller requests `/api/stream/segment/30` (310s mark) with the same preview token. `segIndex > payload.maxSeg` (`30 > 29`) triggers at `server.ts:477`, returning HTTP `402 PREVIEW_LIMIT_REACHED`. | **Handled Safely** |

#### Conclusion
**Fix Verified** - Verified live against the running server: traversal request returned HTTP `404`, segment `0` returned HTTP `200`, and segment `30` returned HTTP `402`.

---

### 3. Creator Payout Currency & Method Mismatch

#### Summary
| Field | Value |
|---|---|
| Issue Type | Request Validation & Business Rule Enforcement |
| Impact | Low |
| Affected File | `server.ts:1524-1546` |
| Test Scenario | `POST /api/creator/payouts/request` requesting `currency: "USD"` with `method: "bank_transfer_idr"` |

#### How It Was Fixed
Added explicit currency-to-channel pairing validation (`server.ts:1534-1537`) and narrowed `validMethod` (`server.ts:1524-1529`) before acquiring the ledger lock or creating a payout record.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | Authenticated creator sends `currency: "USD"` paired with `method: "bank_transfer_idr"` (`server.ts:1513`). | Request enters handler after `requireAuth` |
| 2 | `currency === 'USD' && validMethod !== 'paypal_usd'` evaluates to `true` at `server.ts:1534`. | Mismatch detected |
| 3 | Handler returns HTTP `400` (`"Invalid payout request fields or currency/channel mismatch."`) before mutating ledger state (`server.ts:1544`). | **Handled Safely** |

#### Conclusion
**Fix Verified** - Currency and payout channel pairings are strictly enforced server-side before ledger persistence.
