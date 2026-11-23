# VYORA Firestore Security Specification (Phase 2)

## 1. Data Invariants
1. **Zero Self-Privilege Escalation**: A non-admin user creating `users/{uid}` MUST only create `role: "viewer"`. Users CANNOT modify `role`, `uid`, `email`, or `createdAt` on update.
2. **PII Isolation**: `users/{userId}` contains `email` and is readable ONLY by the document owner (`request.auth.uid == userId`) or an Admin.
3. **Creator Verification Integrity**: A user creating `creators/{uid}` MUST set `uid == request.auth.uid`, `status: "pending"`, `verified: false`, `contentCount: 0`. Only an Admin can set `verified: true` or `status: "approved"`.
4. **Content Moderation State Machine**: Creators can create `videos/{videoId}` ONLY with `creatorId == request.auth.uid` and `status in ["draft", "pending_review"]`. Only Admins can transition `pending_review` to `"approved"` or `"rejected"`. Only `"approved"` content can transition to `"published"`.
5. **Private Asset Protection**: `video_assets/{videoId}` is NEVER readable or listable by public users or viewers—only the owning Creator or an Admin.
6. **Immutable Financial Records**: Client SDKs CANNOT modify `wallets/{userId}.balanceCredits`, `wallet_transactions`, `purchases`, or `entitlements`. Owners may initialize `wallets/{userId}` with `balanceCredits == 0` and `totalSpentCredits == 0` only.
7. **Temporal Integrity**: All `createdAt` and `updatedAt` timestamps on client-writable documents MUST strictly equal `request.time`.
8. **Bootstrapped Admin + Email Spoofing Guard**: Bootstrapped admin email checks MUST require `request.auth.token.email_verified == true`.

## 2. The "Dirty Dozen" Adversarial Payloads (Must Return PERMISSION_DENIED)
1. **Self-Admin Registration**: `POST /users/{uid}` with `{ "role": "admin" }` by a regular user.
2. **Role Escalation Update**: `PATCH /users/{uid}` modifying `affectedKeys: ["role"]` to `"creator"` or `"admin"`.
3. **PII Cross-Read**: `GET /users/{otherUid}` by a non-owner authenticated viewer.
4. **Blanket User Listing**: `LIST /users` by a non-admin user.
5. **Self-Verified Creator**: `POST /creators/{uid}` with `{ "verified": true, "status": "approved" }`.
6. **Unapproved Self-Publish**: `POST /videos/{id}` with `{ "status": "published" }` by a creator.
7. **State Shortcutting**: `PATCH /videos/{id}` transitioning `"draft"` directly to `"published"` by a creator.
8. **Shadow Ghost Field**: `POST /videos/{id}` including an undeclared field `{ "featuredHero": true, "isAdminPick": true }`.
9. **Wallet Balance Tampering**: `PATCH /wallets/{uid}` setting `balanceCredits: 99999`.
10. **Fake Purchase Injection**: `POST /purchases/{id}` setting `status: "completed"` from the client SDK.
11. **Private Video Asset Leak**: `GET /video_assets/{videoId}` by a viewer who is not the creator or admin.
12. **Client-Spoofed Timestamp**: `POST /reports/{id}` with `createdAt` set to a past client `Timestamp` instead of `request.time`.
