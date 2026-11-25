import { VIDEO_PLATFORM_ADAPTERS } from './adapters';
import type { DetectedVideoSource } from './types';
import { parseStrictHttpsUrl } from './urlGuards';

export interface PlatformDetectionOutcome {
  detected: DetectedVideoSource | null;
  errorCode?: string;
  errorMessageId?: string;
  errorMessageEn?: string;
}

export function detectVideoSourceFromInput(rawInput: string): PlatformDetectionOutcome {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return {
      detected: null,
      errorCode: 'EMPTY_URL',
      errorMessageId: 'Masukkan tautan video terlebih dahulu.',
      errorMessageEn: 'Please paste a video link first.',
    };
  }

  for (const adapter of VIDEO_PLATFORM_ADAPTERS) {
    const match = adapter.detect(trimmed);
    if (match) {
      return { detected: match };
    }
  }

  // Provide specific diagnostic if URL syntax/scheme failed
  const guard = parseStrictHttpsUrl(trimmed, { allowBareHostname: true });
  if (!guard.ok) {
    return {
      detected: null,
      errorCode: guard.reasonCode,
      errorMessageId: guard.messageId,
      errorMessageEn: guard.messageEn,
    };
  }

  return {
    detected: null,
    errorCode: 'UNSUPPORTED_PLATFORM_OR_PATH',
    errorMessageId:
      'Tautan dari domain atau format ini belum dikenali/didukung untuk embed resmi atau stream langsung.',
    errorMessageEn:
      'This URL format or domain is not recognized as a supported official embed or direct stream.',
  };
}
