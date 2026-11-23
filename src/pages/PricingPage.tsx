import React from 'react';
import { Check, CreditCard, Globe, QrCode, ShieldCheck, Wallet } from 'lucide-react';
import type {
  CreditPackage,
  CurrencyCode,
  LocaleCode,
  ViewRoute,
} from '../types/vyora';
import { formatPrice } from '../i18n/translations';
import { Button } from '../components/ui/Button';

interface PricingPageProps {
  packages: CreditPackage[];
  locale: LocaleCode;
  currency: CurrencyCode;
  onChangeCurrency: (currency: CurrencyCode) => void;
  onSelectPackage: (pkg: CreditPackage) => void;
  onNavigate: (route: ViewRoute) => void;
}

export const PricingPage: React.FC<PricingPageProps> = ({
  packages,
  locale,
  currency,
  onChangeCurrency,
  onSelectPackage,
  onNavigate,
}) => {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 space-y-10 sm:space-y-16">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-5 pb-6 sm:pb-8 border-b border-white/8">
        <div className="max-w-2xl space-y-3">
          <h1 className="font-display text-2xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-[#F5F5F7]">
            {locale === 'id'
              ? 'Bayar Hanya untuk Apa yang Anda Tonton'
              : 'Pay Only for What You Watch'}
          </h1>
          <p className="text-sm sm:text-base text-[#A5A6B2] leading-relaxed">
            {locale === 'id'
              ? 'Tidak ada biaya langganan bulanan berulang. Tonton pratinjau gratis 5 menit pada setiap judul, lalu buka akses penuh 30 hari per tayangan atau dengan Dompet Kredit.'
              : 'No recurring subscription lock-in. Watch a free five-minute preview on any title, then unlock full 30-day streaming access per release or via Credit Wallet.'}
          </p>
        </div>

        {/* Currency Switcher */}
        <div className="grid grid-cols-2 sm:flex items-center gap-1.5 self-stretch sm:self-start md:self-auto bg-[#1B1C27] border border-white/10 p-1 rounded-xl">
          <button
            type="button"
            onClick={() => onChangeCurrency('USD')}
            className={`min-h-[44px] sm:min-h-[38px] px-4 py-2 rounded-lg text-xs font-mono font-semibold transition-colors cursor-pointer ${
              currency === 'USD'
                ? 'bg-[#7957ED] text-[#F5F5F7]'
                : 'text-[#A5A6B2] hover:text-[#F5F5F7]'
            }`}
          >
            USD ($)
          </button>
          <button
            type="button"
            onClick={() => onChangeCurrency('IDR')}
            className={`min-h-[44px] sm:min-h-[38px] px-4 py-2 rounded-lg text-xs font-mono font-semibold transition-colors cursor-pointer ${
              currency === 'IDR'
                ? 'bg-[#7957ED] text-[#F5F5F7]'
                : 'text-[#A5A6B2] hover:text-[#F5F5F7]'
            }`}
          >
            IDR (Rp)
          </button>
        </div>
      </header>

      {/* Two Ways to Unlock */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-[#1B1C27] border border-white/10 rounded-2xl p-7 space-y-4">
          <div className="w-11 h-11 rounded-xl bg-[#11121A] border border-white/10 text-[#A78BFA] flex items-center justify-center">
            <CreditCard className="w-5 h-5" aria-hidden="true" />
          </div>
          <h2 className="font-display text-xl font-bold text-[#F5F5F7]">
            {locale === 'id' ? 'Pay-Per-View Langsung' : 'Direct Pay-Per-View'}
          </h2>
          <p className="text-sm text-[#A5A6B2] leading-relaxed">
            {locale === 'id'
              ? 'Beli satu judul mulai dari Rp 45.000 dengan akses streaming penuh selama 30 hari. Mendukung QRIS Indonesia dan PayPal internasional.'
              : 'Unlock individual premieres starting from $2.99 for 30 days of unlimited playback. Instant verification via PayPal or Indonesian QRIS.'}
          </p>
          <ul className="space-y-2 pt-2 text-sm text-[#F5F5F7]/90">
            <li className="flex items-center gap-2.5">
              <Check className="w-4 h-4 text-[#A78BFA] shrink-0" aria-hidden="true" />
              <span>
                {locale === 'id'
                  ? 'Pratinjau gratis 5 menit sebelum membayar'
                  : '5-minute free preview before every purchase'}
              </span>
            </li>
            <li className="flex items-center gap-2.5">
              <Check className="w-4 h-4 text-[#A78BFA] shrink-0" aria-hidden="true" />
              <span>
                {locale === 'id'
                  ? 'Akses aktif selama 30 hari kalender penuh'
                  : 'Full 30-day streaming window calculated server-side'}
              </span>
            </li>
          </ul>
        </div>

        <div className="bg-[#1B1C27] border border-white/10 rounded-2xl p-7 space-y-4">
          <div className="w-11 h-11 rounded-xl bg-[#11121A] border border-white/10 text-[#A78BFA] flex items-center justify-center">
            <Wallet className="w-5 h-5" aria-hidden="true" />
          </div>
          <h2 className="font-display text-xl font-bold text-[#F5F5F7]">
            {locale === 'id' ? 'Dompet Kredit VYORA' : 'VYORA Credit Wallet'}
          </h2>
          <p className="text-sm text-[#A5A6B2] leading-relaxed">
            {locale === 'id'
              ? 'Isi saldo kredit satu kali dan buka berbagai film, dokumenter, atau kelas master dengan sekali klik tanpa perlu checkout ulang setiap saat.'
              : 'Top up credits once with bonus allocations and unlock any release in one click without repeated checkout friction.'}
          </p>
          <ul className="space-y-2 pt-2 text-sm text-[#F5F5F7]/90">
            <li className="flex items-center gap-2.5">
              <Check className="w-4 h-4 text-[#A78BFA] shrink-0" aria-hidden="true" />
              <span>
                {locale === 'id'
                  ? 'Kredit tidak memiliki tanggal kedaluwarsa'
                  : 'Purchased credits never expire'}
              </span>
            </li>
            <li className="flex items-center gap-2.5">
              <Check className="w-4 h-4 text-[#A78BFA] shrink-0" aria-hidden="true" />
              <span>
                {locale === 'id'
                  ? 'Catatan transaksi saldo transparan dan permanen'
                  : 'Immutable wallet ledger & instant title unlocking'}
              </span>
            </li>
          </ul>
        </div>
      </section>

      {/* Credit Packages */}
      <section aria-labelledby="packages-heading" className="space-y-6">
        <div className="space-y-2">
          <h2
            id="packages-heading"
            className="font-display text-2xl sm:text-3xl font-bold text-[#F5F5F7]"
          >
            {locale === 'id' ? 'Paket Dompet Kredit' : 'Credit Wallet Packages'}
          </h2>
          <p className="text-sm text-[#A5A6B2]">
            {locale === 'id'
              ? 'Pilih paket kredit untuk menikmati tayangan 4K HDR lebih hemat.'
              : 'Pre-load credits with bonus value for cinema premieres and masterclasses.'}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {packages.map((pkg) => {
            const totalCredits = pkg.credits + pkg.bonusCredits;
            return (
              <div
                key={pkg.id}
                className={`flex flex-col rounded-2xl p-6 bg-[#1B1C27] border transition-colors ${
                  pkg.recommended
                    ? 'border-[#7957ED] shadow-lg shadow-[#7957ED]/10'
                    : 'border-white/10'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-4">
                  <h3 className="text-lg font-bold text-[#F5F5F7]">
                    {locale === 'id' ? pkg.nameId : pkg.name}
                  </h3>
                  {pkg.recommended && (
                    <span className="text-xs font-semibold text-[#A78BFA]">
                      {locale === 'id' ? 'Paling Populer' : 'Most Popular'}
                    </span>
                  )}
                </div>

                <div className="mb-4">
                  <div className="text-3xl font-bold font-mono tabular-nums text-[#F5F5F7]">
                    {formatPrice(pkg.priceUsd, pkg.priceIdr, currency)}
                  </div>
                  <div className="text-xs font-mono tabular-nums text-[#A78BFA] mt-1">
                    {totalCredits} {locale === 'id' ? 'Total Kredit' : 'Total Credits'}
                    {pkg.bonusCredits > 0
                      ? ` (${pkg.credits} + ${pkg.bonusCredits} bonus)`
                      : ''}
                  </div>
                </div>

                <p className="text-sm text-[#A5A6B2] leading-relaxed mb-6 flex-1">
                  {locale === 'id' ? pkg.descriptionId : pkg.description}
                </p>

                <Button
                  variant={pkg.recommended ? 'primary' : 'secondary'}
                  size="md"
                  className="w-full"
                  onClick={() => onSelectPackage(pkg)}
                >
                  {locale === 'id' ? 'Pilih Paket Kredit' : 'Select Credit Pack'}
                </Button>
              </div>
            );
          })}
        </div>
      </section>

      {/* Supported Global & Indonesian Payment Methods */}
      <section className="bg-[#1B1C27] border border-white/10 rounded-2xl p-7 sm:p-9 grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 text-sm font-semibold text-[#F5F5F7]">
            <Globe className="w-4 h-4 text-[#A78BFA]" aria-hidden="true" />
            <span>PayPal International</span>
          </div>
          <p className="text-xs text-[#A5A6B2] leading-relaxed">
            {locale === 'id'
              ? 'Pembayaran kartu kredit, debit, dan saldo PayPal lintas negara dalam mata uang USD.'
              : 'Global checkout supporting cards and PayPal balances in USD with server-verified capture.'}
          </p>
        </div>

        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 text-sm font-semibold text-[#F5F5F7]">
            <QrCode className="w-4 h-4 text-[#A78BFA]" aria-hidden="true" />
            <span>QRIS Indonesia</span>
          </div>
          <p className="text-xs text-[#A5A6B2] leading-relaxed">
            {locale === 'id'
              ? 'Pembayaran instan dalam Rupiah melalui QRIS dari seluruh bank dan e-wallet Indonesia.'
              : 'Instant Indonesian Rupiah settlement supporting all major Indonesian mobile banking and e-wallet apps.'}
          </p>
        </div>

        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 text-sm font-semibold text-[#F5F5F7]">
            <ShieldCheck className="w-4 h-4 text-[#A78BFA]" aria-hidden="true" />
            <span>
              {locale === 'id' ? 'Keamanan Transaksi' : 'Verified Entitlements'}
            </span>
          </div>
          <p className="text-xs text-[#A5A6B2] leading-relaxed">
            {locale === 'id'
              ? 'Setiap pembukaan konten dan top-up kredit diverifikasi di sisi server untuk mencegah transaksi ganda.'
              : 'Every unlock and wallet top-up uses server-side verification and idempotent records.'}
          </p>
          <button
            type="button"
            onClick={() => onNavigate('explore')}
            className="inline-flex items-center min-h-[44px] text-xs font-semibold text-[#A78BFA] hover:text-[#F5F5F7] cursor-pointer"
          >
            {locale === 'id' ? 'Jelajahi Katalog →' : 'Browse Catalog →'}
          </button>
        </div>
      </section>
    </div>
  );
};
