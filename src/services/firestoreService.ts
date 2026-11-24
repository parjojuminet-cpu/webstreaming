import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  BOOTSTRAPPED_ADMIN_EMAIL,
  OperationType,
  db,
  handleFirestoreError,
  type FirebaseUser,
} from '../lib/firebase';
import type {
  ContentCategory,
  ContentItem,
  ContentStatus,
  CreatorProfile,
  CreatorStatus,
  CurrencyCode,
  EntitlementRecord,
  LocaleCode,
  PlatformSettingRecord,
  PurchaseRecord,
  ReportRecord,
  ReviewItem,
  UserProfile,
  UserRole,
  WalletRecord,
  WalletTransactionRecord,
} from '../types/vyora';

function sanitizeId(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 90);
}

function sanitizeSlug(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 90);
  return cleaned.length >= 2 ? cleaned : `deloken-${Date.now()}`;
}

function clampString(val: string, maxLen: number): string {
  return val.trim().slice(0, maxLen);
}

export async function ensureUserProfile(
  firebaseUser: FirebaseUser,
  defaultLocale: LocaleCode,
  defaultCurrency: CurrencyCode
): Promise<UserProfile> {
  const userPath = `users/${firebaseUser.uid}`;
  const userRef = doc(db, 'users', firebaseUser.uid);

  let existingSnap;
  try {
    existingSnap = await getDoc(userRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, userPath);
  }

  const isBootstrapAdmin =
    firebaseUser.email === BOOTSTRAPPED_ADMIN_EMAIL &&
    firebaseUser.emailVerified === true;

  if (!existingSnap.exists()) {
    const safeName = clampString(
      firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'DELOKEN Member',
      80
    );
    const displayName = safeName.length >= 2 ? safeName : 'DELOKEN User';
    const email = clampString(firebaseUser.email || '', 160);
    const photoURL = clampString(firebaseUser.photoURL || '', 500);
    const role: UserRole = isBootstrapAdmin ? 'admin' : 'viewer';

    const payload = {
      uid: firebaseUser.uid,
      email,
      displayName,
      photoURL,
      role,
      preferredLocale: defaultLocale,
      preferredCurrency: defaultCurrency,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    try {
      await setDoc(userRef, payload);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, userPath);
    }

    // Initialize zero-balance Credit Wallet for the user
    const walletPath = `wallets/${firebaseUser.uid}`;
    const walletRef = doc(db, 'wallets', firebaseUser.uid);
    try {
      const walletSnap = await getDoc(walletRef);
      if (!walletSnap.exists()) {
        await setDoc(walletRef, {
          userId: firebaseUser.uid,
          balanceCredits: 0,
          totalSpentCredits: 0,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, walletPath);
    }

    return {
      uid: firebaseUser.uid,
      email,
      displayName,
      photoURL,
      role,
      preferredLocale: defaultLocale,
      preferredCurrency: defaultCurrency,
    };
  }

  // Ensure wallet exists even if user existed earlier
  const walletPath = `wallets/${firebaseUser.uid}`;
  try {
    const walletRef = doc(db, 'wallets', firebaseUser.uid);
    const walletSnap = await getDoc(walletRef);
    if (!walletSnap.exists()) {
      await setDoc(walletRef, {
        userId: firebaseUser.uid,
        balanceCredits: 0,
        totalSpentCredits: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, walletPath);
  }

  return existingSnap.data() as UserProfile;
}

export async function updateUserPreferences(
  uid: string,
  updates: {
    displayName: string;
    preferredLocale: LocaleCode;
    preferredCurrency: CurrencyCode;
    photoURL?: string;
  }
): Promise<void> {
  const path = `users/${uid}`;
  try {
    const safeName = clampString(updates.displayName, 80);
    if (safeName.length < 2) {
      throw new Error('Display name must be at least 2 characters.');
    }
    const payload: Record<string, unknown> = {
      displayName: safeName,
      preferredLocale: updates.preferredLocale,
      preferredCurrency: updates.preferredCurrency,
      updatedAt: serverTimestamp(),
    };
    if (typeof updates.photoURL === 'string') {
      payload.photoURL = clampString(updates.photoURL, 500);
    }
    await updateDoc(doc(db, 'users', uid), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function upsertCreatorProfile(
  uid: string,
  input: {
    name: string;
    handle: string;
    role: string;
    location: string;
    avatarUrl: string;
    bio: string;
    bioId: string;
    specialty: ContentCategory;
  },
  isExisting: boolean
): Promise<void> {
  const path = `creators/${uid}`;
  const normalizedHandle = input.handle.startsWith('@')
    ? input.handle.replace(/[^@a-zA-Z0-9_]/g, '').slice(0, 40)
    : `@${input.handle.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 39)}`;

  try {
    if (!isExisting) {
      await setDoc(doc(db, 'creators', uid), {
        uid,
        name: clampString(input.name, 80),
        handle: normalizedHandle.length >= 2 ? normalizedHandle : `@creator_${uid.slice(0, 6)}`,
        role: clampString(input.role, 80),
        location: clampString(input.location, 80),
        avatarUrl: clampString(input.avatarUrl || '', 500),
        bio: clampString(input.bio, 600),
        bioId: clampString(input.bioId || input.bio, 600),
        specialty: input.specialty,
        status: 'pending',
        verified: false,
        contentCount: 0,
        joinedYear: new Date().getFullYear(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(doc(db, 'creators', uid), {
        name: clampString(input.name, 80),
        handle: normalizedHandle.length >= 2 ? normalizedHandle : `@creator_${uid.slice(0, 6)}`,
        role: clampString(input.role, 80),
        location: clampString(input.location, 80),
        avatarUrl: clampString(input.avatarUrl || '', 500),
        bio: clampString(input.bio, 600),
        bioId: clampString(input.bioId || input.bio, 600),
        specialty: input.specialty,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, isExisting ? OperationType.UPDATE : OperationType.CREATE, path);
  }
}

export function subscribePublicCreators(
  callback: (creators: CreatorProfile[]) => void
): Unsubscribe {
  const path = 'creators';
  return onSnapshot(
    collection(db, 'creators'),
    (snapshot) => {
      const list = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<CreatorProfile, 'id'>),
      }));
      callback(list);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

export function subscribePublishedVideos(
  callback: (videos: ContentItem[]) => void
): Unsubscribe {
  const path = 'videos';
  const q = query(collection(db, 'videos'), where('status', '==', 'published'));
  return onSnapshot(
    q,
    (snapshot) => {
      const list = snapshot.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        return {
          ...(data as unknown as ContentItem),
          id: d.id,
          credits: (data.credits as ContentItem['credits']) || {
            director: String(data.creatorName || 'DELOKEN Creator'),
            cinematography: String(data.creatorName || 'DELOKEN Studio'),
            sound: 'DELOKEN Mastering',
          },
        };
      });
      callback(list);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

export function subscribeCreatorVideos(
  creatorId: string,
  callback: (videos: ContentItem[]) => void
): Unsubscribe {
  const path = 'videos';
  const q = query(collection(db, 'videos'), where('creatorId', '==', creatorId));
  return onSnapshot(
    q,
    (snapshot) => {
      const list = snapshot.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        return {
          ...(data as unknown as ContentItem),
          id: d.id,
          credits: (data.credits as ContentItem['credits']) || {
            director: String(data.creatorName || ''),
            cinematography: String(data.creatorName || ''),
            sound: 'DELOKEN Studio',
          },
        };
      });
      callback(list);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

export interface CreateVideoInput {
  title: string;
  subtitle: string;
  description: string;
  descriptionId: string;
  category: ContentCategory;
  thumbnailUrl: string;
  durationMinutes: number;
  isFree?: boolean;
  priceUsd: number;
  priceIdr: number;
  creditCost: number;
  releaseYear: number;
  resolution: '4K HDR' | '4K UHD' | '1080p HD';
  audioFormat: string;
  languages: string[];
  assetProvider: 'cloudflare_stream' | 'private_storage' | 'youtube' | 'facebook';
  assetRef: string;
  initialStatus: 'draft' | 'pending_review';
}

export async function createCreatorVideo(
  creatorId: string,
  creatorName: string,
  input: CreateVideoInput
): Promise<string> {
  const slug = sanitizeSlug(input.title);
  const videoId = sanitizeId(`${slug}-${Date.now().toString(36)}`);
  const videoPath = `videos/${videoId}`;
  const assetPath = `video_assets/${videoId}`;

  const safeCreatorName = clampString(creatorName, 80);
  const safeDuration = Number.isFinite(input.durationMinutes)
    ? Math.max(1, Math.min(600, Math.round(input.durationMinutes)))
    : 60;
  const isFreeRelease =
    input.isFree === true ||
    (Number(input.priceUsd) === 0 &&
      Number(input.priceIdr) === 0 &&
      Number(input.creditCost) === 0);
  const safePriceUsd = isFreeRelease
    ? 0
    : Number.isFinite(input.priceUsd)
    ? Math.max(0.99, Math.min(500, Number(Number(input.priceUsd).toFixed(2))))
    : 4.99;
  const safePriceIdr = isFreeRelease
    ? 0
    : Number.isFinite(input.priceIdr)
    ? Math.max(10000, Math.min(10000000, Math.round(input.priceIdr)))
    : 75000;
  const safeCreditCost = isFreeRelease
    ? 0
    : Number.isFinite(input.creditCost)
    ? Math.max(1, Math.min(500, Math.round(input.creditCost)))
    : 5;
  const safeReleaseYear = Number.isFinite(input.releaseYear)
    ? Math.max(1950, Math.min(2100, Math.round(input.releaseYear)))
    : new Date().getFullYear();

  const videoPayload = {
    id: videoId,
    slug,
    title: clampString(input.title, 140),
    subtitle: clampString(input.subtitle, 220),
    description: clampString(input.description, 2000),
    descriptionId: clampString(input.descriptionId || input.description, 2000),
    category: input.category,
    creatorId,
    creatorName: safeCreatorName.length >= 2 ? safeCreatorName : 'DELOKEN Creator',
    thumbnailUrl: clampString(
      input.thumbnailUrl || '/src/assets/images/hero_featured_film_1794930897673.jpg',
      500
    ),
    backdropUrl: clampString(
      input.thumbnailUrl || '/src/assets/images/hero_featured_film_1794930897673.jpg',
      500
    ),
    durationMinutes: safeDuration,
    previewSeconds: 300,
    priceUsd: safePriceUsd,
    priceIdr: safePriceIdr,
    creditCost: safeCreditCost,
    releaseYear: safeReleaseYear,
    publishedAt: '',
    resolution: input.resolution,
    audioFormat: clampString(input.audioFormat || 'Studio Stereo', 60),
    languages: input.languages.length > 0 ? input.languages.slice(0, 8) : ['Indonesian', 'English'],
    status: input.initialStatus,
    moderationNote: '',
    viewCount: 0,
    rating: 0,
    reviewCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'videos', videoId), videoPayload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, videoPath);
  }

  try {
    const firestoreAssetProvider =
      input.assetProvider === 'youtube' || input.assetProvider === 'facebook'
        ? 'private_storage'
        : input.assetProvider;
    const firestoreAssetRef =
      input.assetProvider === 'youtube'
        ? input.assetRef.startsWith('youtube:')
          ? input.assetRef
          : `youtube:${input.assetRef}`
        : input.assetProvider === 'facebook'
        ? input.assetRef.startsWith('facebook:')
          ? input.assetRef
          : `facebook:${input.assetRef}`
        : input.assetRef;

    await setDoc(doc(db, 'video_assets', videoId), {
      videoId,
      creatorId,
      provider: firestoreAssetProvider,
      assetRef: clampString(firestoreAssetRef, 300),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, assetPath);
  }

  return videoId;
}

export async function creatorSubmitForReview(videoId: string): Promise<void> {
  const path = `videos/${videoId}`;
  try {
    await updateDoc(doc(db, 'videos', videoId), {
      status: 'pending_review',
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function creatorPublishApprovedVideo(videoId: string): Promise<void> {
  const path = `videos/${videoId}`;
  try {
    await updateDoc(doc(db, 'videos', videoId), {
      status: 'published',
      publishedAt: new Date().toISOString().slice(0, 10),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function creatorArchiveVideo(videoId: string): Promise<void> {
  const path = `videos/${videoId}`;
  try {
    await updateDoc(doc(db, 'videos', videoId), {
      status: 'archived',
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateVideoCover(
  videoId: string,
  coverUrl: string
): Promise<void> {
  const path = `videos/${videoId}`;
  const safeCover = clampString(coverUrl, 500);
  if (!safeCover) {
    throw new Error('Cover URL cannot be empty.');
  }
  try {
    await updateDoc(doc(db, 'videos', videoId), {
      thumbnailUrl: safeCover,
      backdropUrl: safeCover,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export function subscribeWallet(
  uid: string,
  callback: (wallet: WalletRecord | null) => void
): Unsubscribe {
  const path = `wallets/${uid}`;
  return onSnapshot(
    doc(db, 'wallets', uid),
    (snap) => {
      callback(snap.exists() ? (snap.data() as WalletRecord) : null);
    },
    (error) => handleFirestoreError(error, OperationType.GET, path)
  );
}

export function subscribeWalletTransactions(
  uid: string,
  callback: (txs: WalletTransactionRecord[]) => void
): Unsubscribe {
  const path = 'wallet_transactions';
  const q = query(collection(db, 'wallet_transactions'), where('userId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      callback(
        snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<WalletTransactionRecord, 'id'>),
        }))
      );
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

export function subscribePurchases(
  uid: string,
  callback: (purchases: PurchaseRecord[]) => void
): Unsubscribe {
  const path = 'purchases';
  const q = query(collection(db, 'purchases'), where('userId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      callback(
        snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<PurchaseRecord, 'id'>),
        }))
      );
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

export function subscribeEntitlements(
  uid: string,
  callback: (items: EntitlementRecord[]) => void
): Unsubscribe {
  const path = 'entitlements';
  const q = query(collection(db, 'entitlements'), where('userId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      callback(
        snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<EntitlementRecord, 'id'>),
        }))
      );
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

export function subscribeContentReviews(
  contentId: string,
  callback: (reviews: ReviewItem[]) => void
): Unsubscribe {
  const path = 'reviews';
  const q = query(collection(db, 'reviews'), where('contentId', '==', contentId));
  return onSnapshot(
    q,
    (snapshot) => {
      const list = snapshot.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        const rawTs = data.createdAt as { toDate?: () => Date } | undefined;
        const createdAt =
          rawTs && typeof rawTs.toDate === 'function'
            ? rawTs.toDate().toISOString().slice(0, 10)
            : new Date().toISOString().slice(0, 10);
        return {
          id: d.id,
          contentId: String(data.contentId || contentId),
          authorName: String(data.authorName || 'DELOKEN Viewer'),
          authorLocation: 'Verified Viewer',
          rating: Number(data.rating || 5),
          comment: String(data.comment || ''),
          createdAt,
        } satisfies ReviewItem;
      });
      callback(list);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

export async function submitContentReview(input: {
  userId: string;
  contentId: string;
  authorName: string;
  rating: number;
  comment: string;
}): Promise<void> {
  const safeContentId = sanitizeId(input.contentId);
  const reviewId = sanitizeId(`rev-${input.userId.slice(0, 8)}-${safeContentId}-${Date.now().toString(36)}`);
  const path = `reviews/${reviewId}`;
  const safeName = clampString(input.authorName, 80);
  const safeComment = clampString(input.comment, 1000);
  const safeRating = Math.max(1, Math.min(5, Math.round(input.rating)));

  try {
    await setDoc(doc(db, 'reviews', reviewId), {
      userId: input.userId,
      contentId: safeContentId,
      authorName: safeName.length >= 2 ? safeName : 'DELOKEN Viewer',
      rating: safeRating,
      comment: safeComment,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function submitReport(
  reporterId: string,
  targetType: 'video' | 'creator',
  targetId: string,
  reason: string
): Promise<void> {
  const reportId = sanitizeId(`rep-${reporterId.slice(0, 8)}-${Date.now().toString(36)}`);
  const path = `reports/${reportId}`;
  try {
    await setDoc(doc(db, 'reports', reportId), {
      reporterId,
      targetType,
      targetId: sanitizeId(targetId),
      reason: clampString(reason, 500),
      status: 'open',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

// ADMIN OPERATIONS
export function subscribeAllUsers(
  callback: (users: UserProfile[]) => void
): Unsubscribe {
  const path = 'users';
  return onSnapshot(
    collection(db, 'users'),
    (snap) => {
      callback(snap.docs.map((d) => d.data() as UserProfile));
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

export function subscribeAdminVideos(
  callback: (videos: ContentItem[]) => void
): Unsubscribe {
  const path = 'videos';
  return onSnapshot(
    collection(db, 'videos'),
    (snap) => {
      callback(
        snap.docs.map((d) => {
          const data = d.data() as Record<string, unknown>;
          return {
            ...(data as unknown as ContentItem),
            id: d.id,
            credits: (data.credits as ContentItem['credits']) || {
              director: String(data.creatorName || ''),
              cinematography: String(data.creatorName || ''),
              sound: 'DELOKEN Studio',
            },
          };
        })
      );
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

export function subscribeAllReports(
  callback: (reports: ReportRecord[]) => void
): Unsubscribe {
  const path = 'reports';
  return onSnapshot(
    collection(db, 'reports'),
    (snap) => {
      callback(
        snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<ReportRecord, 'id'>),
        }))
      );
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

export function subscribePlatformSettings(
  callback: (settings: PlatformSettingRecord | null) => void
): Unsubscribe {
  const path = 'platform_settings/global';
  return onSnapshot(
    doc(db, 'platform_settings', 'global'),
    (snap) => {
      callback(snap.exists() ? (snap.data() as PlatformSettingRecord) : null);
    },
    (error) => handleFirestoreError(error, OperationType.GET, path)
  );
}

export async function adminUpdateUserRole(uid: string, role: UserRole): Promise<void> {
  const path = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      role,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function adminModerateCreator(
  creatorId: string,
  status: CreatorStatus,
  verified: boolean
): Promise<void> {
  const path = `creators/${creatorId}`;
  try {
    await updateDoc(doc(db, 'creators', creatorId), {
      status,
      verified,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function adminModerateVideo(
  videoId: string,
  status: ContentStatus,
  moderationNote: string
): Promise<void> {
  const path = `videos/${videoId}`;
  const updates: Record<string, unknown> = {
    status,
    moderationNote: clampString(moderationNote, 500),
    updatedAt: serverTimestamp(),
  };
  if (status === 'published') {
    updates.publishedAt = new Date().toISOString().slice(0, 10);
  }
  try {
    await updateDoc(doc(db, 'videos', videoId), updates);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function adminResolveReport(
  reportId: string,
  status: 'resolved' | 'dismissed'
): Promise<void> {
  const path = `reports/${reportId}`;
  try {
    await updateDoc(doc(db, 'reports', reportId), {
      status,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function adminSavePlatformSettings(input: {
  commissionPercent: number;
  minPriceUsd: number;
  minPriceIdr: number;
}): Promise<void> {
  const path = 'platform_settings/global';
  try {
    await setDoc(doc(db, 'platform_settings', 'global'), {
      commissionPercent: Math.max(0, Math.min(50, Math.round(input.commissionPercent))),
      previewSecondsLimit: 300,
      accessDaysDuration: 30,
      minPriceUsd: Math.max(0.99, Number(input.minPriceUsd)),
      minPriceIdr: Math.max(10000, Math.round(input.minPriceIdr)),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}
