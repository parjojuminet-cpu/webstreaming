export type LanguageCode = 'id' | 'en';
export type CurrencyCode = 'IDR' | 'USD';
export type RoleMode = 'viewer' | 'creator' | 'admin';

export type ProjectCategory =
  | 'DIY & Crafts'
  | 'Culinary & Recipes'
  | 'Technical & Repair'
  | 'Documentary';

export type VideoProvider =
  | 'youtube_unlisted'
  | 'archive_org_mp4'
  | 'google_drive'
  | 'deloken_hosted';

export type PublicationStatus =
  | 'pending_review'
  | 'published'
  | 'rejected'
  | 'revision_requested'
  | 'unpublished';

export type TransactionStatus =
  | 'pending_verification'
  | 'paid'
  | 'rejected'
  | 'refunded';

export type PaymentMethod = 'qris' | 'paypal' | 'card';

export interface BilingualText {
  id: string;
  en: string;
}

export interface BilingualList {
  id: string[];
  en: string[];
}

export interface ProjectAttachment {
  id: string;
  name: string;
  sizeBytes: number;
  sizeLabel: string;
  mimeType: string;
  sourceType: 'google_drive_restricted' | 'simulated_local_file';
  url: string;
  note?: string;
}

export interface ProjectPricing {
  idr: number;
  usd: number;
}

export interface Project {
  id: string;
  creatorId: string;
  creatorName: string;
  title: BilingualText;
  description: BilingualText;
  category: ProjectCategory;
  pricing: ProjectPricing;
  videoProvider: VideoProvider;
  videoUrl: string;
  videoNote: string;
  thumbnailUrl: string;
  attachments: ProjectAttachment[];
  materials: BilingualList;
  steps: BilingualList;
  duration: string;
  durationSeconds: number;
  publicationStatus: PublicationStatus;
  adminNote?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserAccount {
  id: string;
  name: string;
  email?: string;
  role: RoleMode;
  preferredLanguage: LanguageCode;
}

export interface Transaction {
  id: string;
  userId: string;
  userName: string;
  projectId: string | null;
  membershipId: string | null;
  targetTitle: string;
  method: PaymentMethod;
  currency: CurrencyCode;
  amount: number;
  uniqueCode: number;
  finalAmount: number;
  status: TransactionStatus;
  isSimulatedInstant?: boolean;
  createdAt: string;
  verifiedAt: string | null;
}

export interface Membership {
  id: string;
  userId: string;
  status: 'active' | 'expired' | 'pending';
  currency: CurrencyCode;
  startDate: string;
  expiryDate: string;
  transactionId: string;
}

export interface PlatformSettings {
  schemaVersion: number;
  membershipPriceIdr: number;
  membershipPriceUsd: number;
  previewLimitSeconds: number;
}

export type ActivityAction =
  | 'project_submitted'
  | 'project_resubmitted'
  | 'project_published'
  | 'project_rejected'
  | 'project_revision_requested'
  | 'project_unpublished'
  | 'payment_created'
  | 'payment_verified'
  | 'payment_rejected'
  | 'payment_refunded'
  | 'membership_activated'
  | 'membership_expired'
  | 'demo_reset';

export interface ActivityLog {
  id: string;
  actorId: string;
  actorName: string;
  action: ActivityAction;
  entityId: string;
  timestamp: string;
  details: string;
}

export interface DelokenStoreState {
  schemaVersion: number;
  projects: Project[];
  users: UserAccount[];
  transactions: Transaction[];
  memberships: Membership[];
  settings: PlatformSettings;
  activityLogs: ActivityLog[];
  activeRole: RoleMode;
  language: LanguageCode;
  storageWarning: string | null;
}
