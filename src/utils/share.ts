import type { LocaleCode } from '../types/vyora';

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback below
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export async function shareContentUrl(input: {
  title: string;
  text?: string;
  url: string;
}): Promise<'shared' | 'copied' | 'failed'> {
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({
        title: input.title,
        text: input.text || input.title,
        url: input.url,
      });
      return 'shared';
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return 'failed';
      }
      // Fall back to clipboard copy
    }
  }
  const copied = await copyTextToClipboard(input.url);
  return copied ? 'copied' : 'failed';
}

export function buildWhatsAppShareHref(title: string, url: string, locale: LocaleCode): string {
  const message =
    locale === 'id'
      ? `Tonton "${title}" di DELOKEN: ${url}`
      : `Watch "${title}" on DELOKEN: ${url}`;
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

export function formatViewCount(count: number | undefined, locale: LocaleCode): string {
  const safe = Math.max(0, Math.floor(count ?? 0));
  if (safe === 0) {
    return locale === 'id' ? '0 ditonton' : '0 views';
  }
  if (safe < 1000) {
    return locale === 'id' ? `${safe} ditonton` : `${safe} views`;
  }
  if (safe < 1_000_000) {
    const compact = (safe / 1000).toFixed(safe >= 10000 ? 0 : 1).replace(/\.0$/, '');
    return locale === 'id' ? `${compact.replace('.', ',')} rb ditonton` : `${compact}K views`;
  }
  const compactM = (safe / 1_000_000).toFixed(1).replace(/\.0$/, '');
  return locale === 'id' ? `${compactM.replace('.', ',')} jt ditonton` : `${compactM}M views`;
}

export function formatCompactViews(count: number | undefined, locale: LocaleCode): string {
  const safe = Math.max(0, Math.floor(count ?? 0));
  if (safe === 0) return '';
  if (safe < 1000) return locale === 'id' ? `${safe}×` : `${safe} views`;
  if (safe < 1_000_000) {
    const compact = (safe / 1000).toFixed(safe >= 10000 ? 0 : 1).replace(/\.0$/, '');
    return locale === 'id' ? `${compact.replace('.', ',')} rb×` : `${compact}K`;
  }
  const compactM = (safe / 1_000_000).toFixed(1).replace(/\.0$/, '');
  return locale === 'id' ? `${compactM.replace('.', ',')} jt×` : `${compactM}M`;
}
