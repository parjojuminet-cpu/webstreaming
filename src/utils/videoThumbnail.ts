/**
 * Captures a JPEG frame from an already-loaded HTMLVideoElement at its current playback position.
 */
export async function captureVideoFrameAsFile(
  videoEl: HTMLVideoElement,
  fileNameBase = 'deloken-video-cover'
): Promise<File> {
  const vw = videoEl.videoWidth || 1280;
  const vh = videoEl.videoHeight || 720;
  const targetWidth = Math.min(1280, Math.max(320, vw));
  const targetHeight = Math.max(180, Math.round((targetWidth / vw) * vh));

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Unable to initialize canvas context for video frame capture.');
  }

  ctx.drawImage(videoEl, 0, 0, targetWidth, targetHeight);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((result) => resolve(result), 'image/jpeg', 0.88);
  });

  if (!blob) {
    throw new Error('Failed to encode captured video frame as JPEG.');
  }

  const safeBase = fileNameBase
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .slice(0, 32) || 'deloken-cover';

  return new File([blob], `${safeBase}-frame.jpg`, { type: 'image/jpeg' });
}

/**
 * Automatically seeks slightly into a local video File (skipping black intro frames)
 * and extracts a crisp JPEG cover thumbnail File.
 */
export async function autoCaptureCoverFromVideoFile(file: File): Promise<File> {
  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;

  try {
    await new Promise<void>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        reject(new Error('Timed out loading video metadata for cover frame.'));
      }, 10000);

      video.onloadedmetadata = () => {
        window.clearTimeout(timeoutId);
        resolve();
      };
      video.onerror = () => {
        window.clearTimeout(timeoutId);
        reject(new Error('Unsupported video codec for browser thumbnail capture.'));
      };
      video.src = objectUrl;
    });

    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 2;
    if (duration > 0.15) {
      const seekSec = Math.min(2.5, Math.max(0.05, duration * 0.15));
      const targetTime = Math.min(seekSec, Math.max(0.01, duration - 0.05));

      await new Promise<void>((resolve, reject) => {
        const timeoutId = window.setTimeout(() => {
          resolve(); // Fallback to whatever frame decoded
        }, 6000);

        video.onseeked = () => {
          window.clearTimeout(timeoutId);
          resolve();
        };
        video.onerror = () => {
          window.clearTimeout(timeoutId);
          reject(new Error('Failed seeking video for cover capture.'));
        };
        video.currentTime = targetTime;
      });
    } else if (video.readyState < 2) {
      await new Promise<void>((resolve) => {
        const timeoutId = window.setTimeout(resolve, 1500);
        video.onloadeddata = () => {
          window.clearTimeout(timeoutId);
          resolve();
        };
      });
    }

    return await captureVideoFrameAsFile(video, file.name);
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(objectUrl);
  }
}
