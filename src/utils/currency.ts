import type { CurrencyCode, LanguageCode, ProjectPricing } from '../types/deloken';

export function getCurrencyForLanguage(language: LanguageCode): CurrencyCode {
  return language === 'id' ? 'IDR' : 'USD';
}

export function formatIdr(amount: number): string {
  const safe = Number.isFinite(amount) ? Math.round(amount) : 0;
  return `Rp${new Intl.NumberFormat('id-ID').format(safe)}`;
}

export function formatUsd(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return `$${safe.toFixed(2)}`;
}

export function formatCurrency(amount: number, currency: CurrencyCode): string {
  return currency === 'IDR' ? formatIdr(amount) : formatUsd(amount);
}

/**
 * Harga IDR dan USD disimpan secara terpisah pada objek proyek,
 * bukan dihitung menggunakan kurs otomatis.
 */
export function formatProjectPrice(
  pricing: ProjectPricing,
  language: LanguageCode
): string {
  return language === 'id' ? formatIdr(pricing.idr) : formatUsd(pricing.usd);
}

export function formatTimeSeconds(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}
