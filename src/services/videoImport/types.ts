import type {
  DirectStreamFormat,
  LinkCheckStatus,
  PlaybackCheckStatus,
  VideoAssetProvider,
} from '../../types/vyora';

export type PlaybackVerifiability = 'verifiable' | 'conditional' | 'unverifiable';

export interface DetectedVideoSource {
  provider: VideoAssetProvider;
  platformLabel: string;
  originalUrl: string;
  canonicalRef: string;
  canonicalUrl: string;
  embedUrl?: string;
  directFormat?: DirectStreamFormat;
  thumbnailUrl?: string;
  verifiability: PlaybackVerifiability;
  verifiabilityNoteId: string;
  verifiabilityNoteEn: string;
}

export interface VideoPlatformAdapter {
  id: VideoAssetProvider;
  label: string;
  allowedHosts?: ReadonlySet<string>;
  verifiability: PlaybackVerifiability;
  detect: (rawInput: string) => DetectedVideoSource | null;
}

export interface LinkInspectionDiagnostics {
  detected: boolean;
  provider: VideoAssetProvider | null;
  platformLabel: string;
  canonicalRef: string;
  canonicalUrl: string;
  embedUrl?: string;
  directFormat?: DirectStreamFormat;
  linkStatus: LinkCheckStatus;
  reasonCode: string;
  messageId: string;
  messageEn: string;
  titleHint?: string;
  authorHint?: string;
  thumbnailUrl?: string;
  durationSecondsHint?: number;
  mimeType?: string;
  contentLength?: number;
  supportsRange?: boolean;
  corsReady?: boolean | null;
  verifiability: PlaybackVerifiability;
  verifiabilityNoteId: string;
  verifiabilityNoteEn: string;
}

export interface PlaybackVerificationResult {
  status: PlaybackCheckStatus;
  reasonCode?: string;
  messageId: string;
  messageEn: string;
  observedSeconds: number;
  detectedDurationSeconds?: number;
  mimeOrPlayer?: string;
}
