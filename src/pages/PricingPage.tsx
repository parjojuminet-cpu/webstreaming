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
    <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-8 space-y-6 sm:space-y-10">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-3.5 pb-4 sm:pb-6 border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-2xl space-y-1.5 sm:space-y-2">
          <h1 className="font-display text-xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-slate-900 dark:text-white">
            {locale === 'id'
              ? 'Bayar Hanya untuk Apa yang Anda Tonton'
              : 'Pay Only for What You Watch'}
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            {locale === 'id'
              ? 'Tidak ada biaya langganan bulanan berulang. Tonton pratinjau gratis 5 menit pada setiap judul, lalu buka akses penuh 30 hari per tayangan atau dengan Dompet Kredit.'
              : 'No recurring subscription lock-in. Watch a free five-minute preview on any title, then unlock full 30-day streaming access per release or via Credit Wallet.'}
          </p>
        </div>

        {/* Currency Switcher */}
        <div className="grid grid-cols-2 sm:flex items-center gap-1.5 self-stretch sm:self-start md:self-auto bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-1 rounded-xl">
          <button
            type="button"
            onClick={() => onChangeCurrency('USD')}
            className={`min-h-[38px] px-4 py-1.5 rounded-lg text-xs font-mono font-semibold transition-colors cursor-pointer ${
              currency === 'USD'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            USD ($)
          </button>
          <button
            type="button"
            onClick={() => onChangeCurrency('IDR')}
            className={`min-h-[38px] px-4 py-1.5 rounded-lg text-xs font-mono font-semibold transition-colors cursor-pointer ${
              currency === 'IDR'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            IDR (Rp)
          </button>
        </div>
      </header>

      {/* Two Ways to Unlock */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-3.5 sm:gap-6">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 space-y-2.5 sm:space-y-3.5 shadow-xs">
          <div className="w-11 h-11 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/70 text-emerald-700 dark:text-emerald-400 flex items-center justify-center">
            <CreditCard className="w-5 h-5" aria-hidden="true" />
          </div>
          <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">
            {locale === 'id' ? 'Pay-Per-View Langsung' : 'Direct Pay-Per-View'}
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            {locale === 'id'
              ? 'Beli satu judul mulai dari Rp 45.000 dengan akses streaming penuh selama 30 hari. Mendukung QRIS Indonesia dan PayPal internasional.'
              : 'Unlock individual premieres starting from $2.99 for 30 days of unlimited playback. Instant verification via PayPal or Indonesian QRIS.'}
          </p>
          <ul className="space-y-2 pt-2 text-sm text-slate-700 dark:text-slate-200">
            <li className="flex items-center gap-2.5">
              <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />
              <span>
                {locale === 'id'
                  ? 'Pratinjau gratis 5 menit sebelum membayar'
                  : '5-minute free preview before every purchase'}
              </span>
            </li>
            <li className="flex items-center gap-2.5">
              <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />
              <span>
                {locale === 'id'
                  ? 'Akses aktif selama 30 hari kalender penuh'
                  : 'Full 30-day streaming window calculated server-side'}
              </span>
            </li>
          </ul>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 space-y-2.5 sm:space-y-3.5 shadow-xs">
          <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/70 text-emerald-700 dark:text-emerald-400 flex items-center justify-center">
            <Wallet className="w-5 h-5" aria-hidden="true" />
          </div>
          <h2 className="font-display text-lg sm:text-xl font-bold text-slate-900 dark:text-white">
            {locale === 'id' ? 'Dompet Kredit DELOKEN' : 'DELOKEN Credit Wallet'}
          </h2>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            {locale === 'id'
              ? 'Isi saldo kredit satu kali dan buka berbagai film, dokumenter, atau kelas master dengan sekali klik tanpa perlu checkout ulang setiap saat.'
              : 'Top up credits once with bonus allocations and unlock any release in one click without repeated checkout friction.'}
          </p>
          <ul className="space-y-1.5 pt-1 text-xs sm:text-sm text-slate-700 dark:text-slate-200">
            <li className="flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />
              <span>
                {locale === 'id'
                  ? 'Kredit tidak memiliki tanggal kedaluwarsa'
                  : 'Purchased credits never expire'}
              </span>
            </li>
            <li className="flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />
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
      <section aria-labelledby="packages-heading" className="space-y-4 sm:space-y-5">
        <div className="space-y-1">
          <h2
            id="packages-heading"
            className="font-display text-lg sm:text-2xl font-bold text-slate-900 dark:text-white"
          >
            {locale === 'id' ? 'Paket Dompet Kredit' : 'Credit Wallet Packages'}
          </h2>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300">
            {locale === 'id'
              ? 'Pilih paket kredit untuk menikmati tayangan 4K HDR lebih hemat.'
              : 'Pre-load credits with bonus value for cinema premieres and masterclasses.'}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 sm:gap-5">
          {packages.map((pkg) => {
            const totalCredits = pkg.credits + pkg.bonusCredits;
            return (
              <div
                key={pkg.id}
                className={`flex flex-col rounded-2xl p-4 sm:p-6 bg-white dark:bg-slate-900 border transition-colors ${
                  pkg.recommended
                    ? 'border-emerald-600 dark:border-emerald-500 shadow-lg shadow-emerald-600/10'
                    : 'border-slate-200 dark:border-slate-800 shadow-xs'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-2.5 sm:mb-4">
                  <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                    {locale === 'id' ? pkg.nameId : pkg.name}
                  </h3>
                  {pkg.recommended && (
                    <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                      {locale === 'id' ? 'Paling Populer' : 'Most Popular'}
                    </span>
                  )}
                </div>

                <div className="mb-3 sm:mb-4">
                  <div className="text-2xl sm:text-3xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                    {formatPrice(pkg.priceUsd, pkg.priceIdr, currency)}
                  </div>
                  <div className="text-xs font-mono tabular-nums text-emerald-700 dark:text-emerald-400 font-semibold mt-0.5">
                    {totalCredits} {locale === 'id' ? 'Total Kredit' : 'Total Credits'}
                    {pkg.bonusCredits > 0
                      ? ` (${pkg.credits} + ${pkg.bonusCredits} bonus)`
                      : ''}
                  </div>
                </div>

                <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed mb-4 sm:mb-5 flex-1">
                  {locale === 'id' ? pkg.descriptionId : pkg.description}
                </p>

                <Button
                  variant={pkg.recommended ? 'primary' : 'outline'}
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
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-7 grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-7 shadow-xs">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
            <Globe className="w-4 h-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            <span>PayPal International</span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            {locale === 'id'
              ? 'Pembayaran kartu kredit, debit, dan saldo PayPal lintas negara dalam mata uang USD.'
              : 'Global checkout supporting cards and PayPal balances in USD with server-verified capture.'}
          </p>
        </div>

        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
            <QrCode className="w-4 h-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            <span>QRIS Indonesia</span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            {locale === 'id'
              ? 'Pembayaran instan dalam Rupiah melalui QRIS dari seluruh bank dan e-wallet Indonesia.'
              : 'Instant Indonesian Rupiah settlement supporting all major Indonesian mobile banking and e-wallet apps.'}
          </p>
        </div>

        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
            <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            <span>
              {locale === 'id' ? 'Keamanan Transaksi' : 'Verified Entitlements'}
            </span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            {locale === 'id'
              ? 'Setiap pembukaan konten dan top-up kredit diverifikasi di sisi server untuk mencegah transaksi ganda.'
              : 'Every unlock and wallet top-up uses server-side verification and idempotent records.'}
          </p>
          <button
            type="button"
            onClick={() => onNavigate('explore')}
            className="inline-flex items-center min-h-[44px] text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 cursor-pointer"
          >
            {locale === 'id' ? 'Jelajahi Katalog →' : 'Browse Catalog →'}
          </button>
        </div>
      </section>
    </div>
  );
};
