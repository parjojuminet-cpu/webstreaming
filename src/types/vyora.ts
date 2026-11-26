export type ContentCategory =
  | 'Movies'
  | 'Education'
  | 'Documentary'
  | 'Events'
  | 'Creator Exclusives';

export type ContentStatus =
  | 'draft'
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'published'
  | 'archived'
  | 'deletion_pending';

export type VideoDeletionJobStatus =
  | 'pending'
  | 'asset_deleted'
  | 'metadata_deleted'
  | 'completed'
  | 'failed';

export interface VideoDeletionJobRecord {
  operationId: string;
  videoId: string;
  videoTitleSnapshot: string;
  provider: string;
  assetRefFingerprint: string;
  requestedBy: string;
  requestedAt: string;
  status: VideoDeletionJobStatus;
  providerResult: string;
  firestoreResult: string;
  sqlResult: string;
  thumbnailResult: string;
  externalMediaWarning?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  completedAt?: string | null;
}

export type VideoAssetProvider =
  | 'cloudflare_stream'
  | 'private_storage'
  | 'youtube'
  | 'vimeo'
  | 'dailymotion'
  | 'tiktok'
  | 'facebook'
  | 'x'
  | 'instagram'
  | 'streamable'
  | 'direct_video';

export type LinkCheckStatus =
  | 'waiting'
  | 'checking'
  | 'embeddable'
  | 'unavailable'
  | 'uncertain';

export type PlaybackCheckStatus =
  | 'waiting_play'
  | 'verifying'
  | 'verified_playing'
  | 'play_failed'
  | 'unverifiable';

export type DirectStreamFormat = 'mp4' | 'hls' | 'dash';

export interface AdminVideoAssetInfo {
  videoId: string;
  title: string;
  status: ContentStatus;
  previousStatus: ContentStatus | '';
  provider: VideoAssetProvider | 'unknown';
  assetRefFingerprint: string;
  isExternalPlatform: boolean;
  externalMediaWarning: string | null;
  thumbnailUrl: string;
  creatorId: string;
}

export type UserRole = 'viewer' | 'creator' | 'admin';
export type CreatorStatus = 'pending' | 'approved' | 'suspended';

export type LocaleCode = 'en' | 'id';
export type CurrencyCode = 'USD' | 'IDR';

export type ViewRoute =
  | 'home'
  | 'explore'
  | 'categories'
  | 'search'
  | 'pricing'
  | 'detail'
  | 'creator'
  | 'login'
  | 'signup'
  | 'viewer-dashboard'
  | 'creator-dashboard'
  | 'admin-dashboard'
  | 'about'
  | 'contact'
  | 'terms'
  | 'privacy'
  | 'guidelines';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  role: UserRole;
  preferredLocale: LocaleCode;
  preferredCurrency: CurrencyCode;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface CreatorProfile {
  id: string;
  uid?: string;
  name: string;
  handle: string;
  role: string;
  location: string;
  avatarUrl: string;
  bio: string;
  bioId: string;
  contentCount: number;
  verified: boolean;
  status?: CreatorStatus;
  joinedYear: number;
  specialty: ContentCategory;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ContentItem {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  descriptionId: string;
  category: ContentCategory;
  creatorId: string;
  creatorName: string;
  thumbnailUrl: string;
  backdropUrl: string;
  durationMinutes: number;
  previewSeconds: number;
  priceUsd: number;
  priceIdr: number;
  creditCost: number;
  releaseYear: number;
  publishedAt: string;
  resolution: '4K HDR' | '4K UHD' | '1080p HD';
  audioFormat: string;
  languages: string[];
  status: ContentStatus;
  previousStatus?: ContentStatus | '';
  moderationNote?: string;
  viewCount?: number;
  trending?: boolean;
  recentlyAdded?: boolean;
  featuredHero?: boolean;
  createdAtMs?: number;
  updatedAtMs?: number;
  rating: number;
  reviewCount: number;
  credits: {
    director: string;
    cinematography: string;
    sound: string;
  };
}

export interface WalletRecord {
  userId: string;
  balanceCredits: number;
  totalSpentCredits: number;
}

export interface WalletTransactionRecord {
  id: string;
  userId: string;
  type: 'topup' | 'spend' | 'refund' | 'bonus';
  creditsDelta: number;
  description: string;
  createdAt: string;
}

export interface PurchaseRecord {
  id: string;
  userId: string;
  videoId: string;
  videoTitle: string;
  method: 'paypal' | 'qris' | 'credits';
  amount: number;
  currency: 'USD' | 'IDR' | 'CREDITS';
  status: 'pending' | 'completed' | 'failed' | 'refunded';
  createdAt: string;
}

export interface EntitlementRecord {
  id: string;
  userId: string;
  videoId: string;
  videoTitle: string;
  thumbnailUrl: string;
  status: 'active' | 'expired' | 'revoked';
  resumeSeconds: number;
  expiresAt: string;
  createdAt: string;
}

export interface ReportRecord {
  id: string;
  reporterId: string;
  targetType: 'video' | 'creator';
  targetId: string;
  reason: string;
  status: 'open' | 'resolved' | 'dismissed';
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PlatformSettingRecord {
  commissionPercent: number;
  previewSecondsLimit: number;
  accessDaysDuration: number;
  minPriceUsd: number;
  minPriceIdr: number;
  updatedAt?: unknown;
}

export interface CreditPackage {
  id: string;
  name: string;
  nameId: string;
  credits: number;
  bonusCredits: number;
  priceUsd: number;
  priceIdr: number;
  description: string;
  descriptionId: string;
  recommended?: boolean;
}

export interface ReviewItem {
  id: string;
  contentId: string;
  authorName: string;
  authorLocation: string;
  rating: number;
  comment: string;
  createdAt: string;
}

export type PaymentGateway = 'paypal' | 'qris' | 'credits';
export type PaymentGatewayMode = 'live' | 'payment_link' | 'sandbox_preview';
export type PaymentPurpose = 'video_unlock' | 'credit_topup';
export type PaymentStatus = 'pending' | 'completed' | 'failed' | 'expired' | 'refunded';

export interface PaymentOrderRecord {
  id: string;
  userId: string;
  userEmail: string | null;
  purpose: PaymentPurpose;
  targetId: string;
  targetTitle: string;
  method: PaymentGateway;
  amount: number;
  currency: 'USD' | 'IDR' | 'CREDITS';
  creditsDelta: number;
  status: PaymentStatus;
  gatewayOrderId: string;
  gatewayMode: PaymentGatewayMode;
  approvalUrl?: string;
  qrString?: string;
  qrSvg?: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
  refundedAt?: string;
}

export interface CreatorEarningRecord {
  id: string;
  creatorId: string;
  videoId: string;
  videoTitle: string;
  purchaseId: string;
  buyerUserId: string;
  method: PaymentGateway;
  grossUsd: number;
  grossIdr: number;
  commissionPercent: number;
  netUsd: number;
  netIdr: number;
  status: 'available' | 'reversed';
  createdAt: string;
}

export interface PayoutRecord {
  id: string;
  creatorId: string;
  creatorName: string;
  amountUsd: number;
  amountIdr: number;
  currency: 'USD' | 'IDR';
  method: 'bank_transfer_idr' | 'ewallet_idr' | 'paypal_usd';
  destination: string;
  status: 'requested' | 'processing' | 'paid' | 'rejected';
  adminNote: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdminFinanceOverview {
  commissionPercent: number;
  totalGrossUsd: number;
  totalGrossIdr: number;
  platformCommissionUsd: number;
  platformCommissionIdr: number;
  payments: PaymentOrderRecord[];
  purchases: PurchaseRecord[];
  payouts: PayoutRecord[];
  activeEntitlementsCount: number;
}

