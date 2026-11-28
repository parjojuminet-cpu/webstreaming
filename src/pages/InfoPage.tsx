import React, { useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2 } from 'lucide-react';
import type { LocaleCode, ViewRoute } from '../types/vyora';
import { TRANSLATIONS } from '../i18n/translations';
import { Button } from '../components/ui/Button';

export type InfoSectionRoute =
  | 'guide'
  | 'about'
  | 'contact'
  | 'terms'
  | 'privacy'
  | 'guidelines';

interface InfoPageProps {
  section: InfoSectionRoute;
  locale: LocaleCode;
  onBack: () => void;
  onNavigate: (route: ViewRoute) => void;
  onOpenSocialNotice?: (platformName: string) => void;
}

export const InfoPage: React.FC<InfoPageProps> = ({
  section,
  locale,
  onBack,
  onNavigate,
  onOpenSocialNotice,
}) => {
  const dict = TRANSLATIONS[locale];
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [contactError, setContactError] = useState<string | null>(null);
  const [contactSent, setContactSent] = useState(false);

  const subNavTabs: { route: InfoSectionRoute; label: string }[] = [
    { route: 'guide', label: locale === 'id' ? 'Cara Kerja & Direktori' : 'Guide & Directory' },
    { route: 'about', label: dict.footer.about },
    { route: 'guidelines', label: dict.footer.guidelines },
    { route: 'contact', label: dict.footer.contact },
    { route: 'terms', label: dict.footer.terms },
    { route: 'privacy', label: dict.footer.privacy },
  ];

  const handleContactSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setContactError(null);
    if (!name.trim() || !email.includes('@') || message.trim().length < 10) {
      setContactError(
        locale === 'id'
          ? 'Mohon isi nama, email valid, dan pesan minimal 10 karakter.'
          : 'Please enter your name, a valid email address, and a message of at least 10 characters.'
      );
      return;
    }
    setContactSent(true);
    setName('');
    setEmail('');
    setMessage('');
  };

  return (
    <div className="max-w-5xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-8 space-y-4 sm:space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 min-h-[40px] text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          <span>{locale === 'id' ? 'Kembali ke Beranda' : 'Back to Home'}</span>
        </button>
      </div>

      {/* Dedicated Menu Sub-Navigation */}
      <nav
        aria-label={locale === 'id' ? 'Menu Panduan & Informasi' : 'Guide & Info Menu'}
        className="deloken-scroll flex items-center gap-1.5 overflow-x-auto pb-1 -mx-3 px-3 sm:mx-0 sm:px-0"
      >
        {subNavTabs.map((tab) => {
          const active = section === tab.route;
          return (
            <button
              key={tab.route}
              type="button"
              onClick={() => onNavigate(tab.route)}
              aria-current={active ? 'page' : undefined}
              className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                active
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-slate-800'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>

      {section === 'guide' && (
        <div className="space-y-5 sm:space-y-7">
          {/* Intro Header */}
          <header className="space-y-1.5 pb-3 border-b border-slate-200 dark:border-slate-800">
            <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white text-balance">
              {locale === 'id' ? 'Panduan & Informasi DELOKEN' : 'DELOKEN Guide & Platform Info'}
            </h1>
            <p className="text-sm sm:text-base text-slate-600 dark:text-slate-300 max-w-2xl leading-relaxed">
              {dict.tagline}
            </p>
          </header>

          {/* 1. Cara Kerja DELOKEN */}
          <section
            aria-labelledby="guide-how-heading"
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-8 shadow-xs"
          >
            <div className="max-w-2xl mb-4 sm:mb-6 space-y-1">
              <h2
                id="guide-how-heading"
                className="font-display text-lg sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white"
              >
                {dict.sections.howItWorks}
              </h2>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">
                {dict.sections.howItWorksSubtitle}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-slate-200 dark:divide-slate-800 pt-3.5 sm:pt-5 border-t border-slate-200 dark:border-slate-800">
              <div className="space-y-1.5 py-3.5 first:pt-0 md:py-0 md:pr-6">
                <h3 className="text-sm sm:text-base font-semibold text-slate-900 dark:text-white">
                  {dict.howSteps.step1Title}
                </h3>
                <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                  {dict.howSteps.step1Desc}
                </p>
              </div>

              <div className="space-y-1.5 py-3.5 md:py-0 md:px-6">
                <h3 className="text-sm sm:text-base font-semibold text-slate-900 dark:text-white">
                  {dict.howSteps.step2Title}
                </h3>
                <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                  {dict.howSteps.step2Desc}
                </p>
              </div>

              <div className="space-y-1.5 py-3.5 last:pb-0 md:py-0 md:pl-6">
                <h3 className="text-sm sm:text-base font-semibold text-slate-900 dark:text-white">
                  {dict.howSteps.step3Title}
                </h3>
                <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                  {dict.howSteps.step3Desc}
                </p>
              </div>
            </div>
          </section>

          {/* 2. DELOKEN Creator Economy */}
          <section
            aria-labelledby="guide-creator-cta-heading"
            className="rounded-2xl bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800/70 p-4 sm:p-8 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4 sm:gap-6"
          >
            <div className="max-w-2xl space-y-1.5 sm:space-y-2.5">
              <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                DELOKEN Creator Economy
              </p>
              <h2
                id="guide-creator-cta-heading"
                className="font-display text-lg sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white"
              >
                {dict.cta.heading}
              </h2>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                {dict.cta.body}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:flex sm:flex-wrap items-stretch sm:items-center gap-2.5 sm:gap-3 shrink-0">
              <Button
                variant="primary"
                size="md"
                className="w-full sm:w-auto"
                onClick={() => onNavigate('signup')}
              >
                {dict.cta.primaryBtn}
              </Button>
              <Button
                variant="outline"
                size="md"
                className="w-full sm:w-auto"
                onClick={() => onNavigate('guidelines')}
              >
                {dict.cta.secondaryBtn}
              </Button>
            </div>
          </section>

          {/* 3. Platform, Company & Legal, Social Media Directory */}
          <section
            aria-labelledby="guide-directory-heading"
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-8 shadow-xs"
          >
            <h2 id="guide-directory-heading" className="sr-only">
              {locale === 'id' ? 'Direktori Platform & Legal' : 'Platform & Legal Directory'}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 sm:gap-8">
              <div className="space-y-2.5">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Platform
                </h3>
                <ul className="space-y-1 text-sm text-slate-600 dark:text-slate-400">
                  {(
                    [
                      { route: 'explore' as ViewRoute, label: dict.nav.explore },
                      { route: 'categories' as ViewRoute, label: dict.nav.categories },
                      { route: 'pricing' as ViewRoute, label: dict.nav.pricing },
                      { route: 'search' as ViewRoute, label: dict.nav.search },
                    ] as const
                  ).map((item) => (
                    <li key={item.route}>
                      <button
                        type="button"
                        onClick={() => onNavigate(item.route)}
                        className="min-h-[40px] w-full flex items-center justify-between py-1 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                      >
                        <span>{item.label}</span>
                        <ArrowRight className="w-3.5 h-3.5 opacity-60" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="space-y-2.5">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Company &amp; Legal
                </h3>
                <ul className="space-y-1 text-sm text-slate-600 dark:text-slate-400">
                  {(
                    [
                      { route: 'about' as ViewRoute, label: dict.footer.about },
                      { route: 'contact' as ViewRoute, label: dict.footer.contact },
                      { route: 'guidelines' as ViewRoute, label: dict.footer.guidelines },
                      { route: 'terms' as ViewRoute, label: dict.footer.terms },
                      { route: 'privacy' as ViewRoute, label: dict.footer.privacy },
                    ] as const
                  ).map((item) => (
                    <li key={item.route}>
                      <button
                        type="button"
                        onClick={() => onNavigate(item.route)}
                        className="min-h-[40px] w-full flex items-center justify-between py-1 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                      >
                        <span>{item.label}</span>
                        <ArrowRight className="w-3.5 h-3.5 opacity-60" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="space-y-2.5">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  {dict.footer.social}
                </h3>
                <ul className="space-y-1 text-sm text-slate-600 dark:text-slate-400">
                  {['Instagram', 'YouTube', 'X / Twitter', 'LinkedIn'].map((platform) => (
                    <li key={platform}>
                      <button
                        type="button"
                        onClick={() => onOpenSocialNotice?.(platform)}
                        className="min-h-[40px] w-full flex items-center justify-between py-1 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                      >
                        <span>{platform}</span>
                        <ArrowRight className="w-3.5 h-3.5 opacity-60" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        </div>
      )}

      {section === 'about' && (
        <article className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-8 space-y-4 sm:space-y-5 shadow-xs">
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">
            {locale === 'id' ? 'Tentang DELOKEN' : 'About DELOKEN'}
          </h1>
          <p className="text-sm sm:text-base text-slate-600 dark:text-slate-300 leading-relaxed">
            {locale === 'id'
              ? 'DELOKEN adalah platform edukasi praktis, DIY, dokumenter, dan streaming Pay-Per-View internasional yang menghubungkan pembuat film independen, instruktur keterampilan, tim dokumenter, dan kreator dengan penonton di Indonesia maupun global.'
              : 'DELOKEN is a hybrid learning, DIY, documentary, and Pay-Per-View streaming platform connecting independent filmmakers, craft educators, documentary teams, and live event producers with audiences in Indonesia and worldwide.'}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-4 border-t border-slate-200 dark:border-slate-800">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white mb-1">
                {locale === 'id' ? 'Pratinjau 5 Menit' : '5-Minute Free Preview'}
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                {locale === 'id'
                  ? 'Penonton selalu dapat menilai kualitas visual dan materi sebelum membuka konten.'
                  : 'Every title allows five minutes of uncompromised playback before unlocking.'}
              </p>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white mb-1">
                {locale === 'id' ? 'Akses 30 Hari' : '30-Day Entitlements'}
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                {locale === 'id'
                  ? 'Setiap pembelian memberikan masa akses penuh 30 hari tanpa perpanjangan otomatis.'
                  : 'Unlocking a title grants 30 calendar days of streaming with zero auto-renewals.'}
              </p>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white mb-1">
                {locale === 'id' ? 'Ekonomi Kreator' : 'Creator-First Revenue'}
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                {locale === 'id'
                  ? 'Kreator menetapkan harga sendiri dalam USD dan IDR dengan analitik dan payout transparan.'
                  : 'Creators control their pricing, multi-currency reach, and verified payout schedule.'}
              </p>
            </div>
          </div>
        </article>
      )}

      {section === 'guidelines' && (
        <article className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-8 space-y-4 sm:space-y-5 shadow-xs">
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">
            {locale === 'id' ? 'Panduan Kreator DELOKEN' : 'DELOKEN Creator Guidelines'}
          </h1>
          <p className="text-sm sm:text-base text-slate-600 dark:text-slate-300 leading-relaxed">
            {locale === 'id'
              ? 'Semua karya yang diajukan melalui Studio Kreator melewati tinjauan kurasi dan moderasi sebelum diterbitkan ke katalog DELOKEN.'
              : 'All submissions pass through editorial curation and content moderation before transitioning from pending review to published.'}
          </p>
          <ul className="space-y-4 text-sm text-slate-600 dark:text-slate-300 pt-2 border-t border-slate-200 dark:border-slate-800">
            <li>
              <strong className="text-slate-900 dark:text-white block mb-1">
                01. {locale === 'id' ? 'Kepemilikan Hak Cipta' : 'Original Rights & Licensing'}
              </strong>
              {locale === 'id'
                ? 'Kreator wajib memiliki hak distribusi global atau regional atas seluruh materi video, musik, dan gambar pendukung.'
                : 'Creators must hold verified distribution rights for all video, music stems, and promotional artwork submitted.'}
            </li>
            <li>
              <strong className="text-slate-900 dark:text-white block mb-1">
                02. {locale === 'id' ? 'Standar Teknis Video' : 'Technical Mastering Standards'}
              </strong>
              {locale === 'id'
                ? 'Minimal 1080p HD (disarankan 4K UHD/HDR), audio stereo atau spasial jernih, dan poster rasio 16:9 tanpa teks berlebihan.'
                : 'Minimum 1080p HD (4K UHD/HDR recommended), balanced stereo or spatial audio, and clean 16:9 key art.'}
            </li>
            <li>
              <strong className="text-slate-900 dark:text-white block mb-1">
                03. {locale === 'id' ? 'Status Moderasi' : 'Moderation Lifecycle'}
              </strong>
              {locale === 'id'
                ? 'Alur status konten: draft → pending_review → approved → published. Hanya konten disetujui Admin yang dapat tayang publik.'
                : 'Workflow states: draft → pending_review → approved → published. Only Admin-approved titles can be published.'}
            </li>
          </ul>
          <div className="pt-2">
            <Button variant="primary" size="md" className="w-full sm:w-auto" onClick={() => onNavigate('signup')}>
              {locale === 'id' ? 'Daftar sebagai Kreator' : 'Apply as a Creator'}
            </Button>
          </div>
        </article>
      )}

      {section === 'terms' && (
        <article className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-8 space-y-4 sm:space-y-5 shadow-xs">
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">
            {locale === 'id' ? 'Syarat & Ketentuan' : 'Terms of Service'}
          </h1>
          <div className="space-y-4 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            <p>
              <strong className="text-slate-900 dark:text-white">
                {locale === 'id'
                  ? '1. Pay-Per-View & Akses 30 Hari:'
                  : '1. Pay-Per-View & 30-Day Entitlements:'}
              </strong>{' '}
              {locale === 'id'
                ? 'Pembelian tayangan berbayar di DELOKEN melalui PayPal, QRIS, atau Dompet Kredit memberikan hak akses streaming 30 hari yang terhubung ke akun Anda dan dihitung berdasarkan waktu server.'
                : 'Purchasing a title on DELOKEN via PayPal, QRIS, or Credit Wallet grants a non-transferable 30-day streaming entitlement calculated using server timestamps.'}
            </p>
            <p>
              <strong className="text-slate-900 dark:text-white">
                {locale === 'id'
                  ? '2. Kebijakan Pratinjau Gratis:'
                  : '2. Free Preview Policy:'}
              </strong>{' '}
              {locale === 'id'
                ? 'Setiap rilis berbayar menyertakan pratinjau gratis maksimal 5 menit, sedangkan rilis gratis kreator dapat langsung ditonton penuh. Upaya memintas batasan pratinjau atau pembatasan pemutar melanggar kebijakan keamanan platform.'
                : 'Every paid release includes a 5-minute free preview, while free creator releases stream in full. Automated or client-side attempts to bypass preview gates violate platform security policies.'}
            </p>
            <p>
              <strong className="text-slate-900 dark:text-white">
                {locale === 'id'
                  ? '3. Buku Besar Dompet Kredit:'
                  : '3. Credit Wallet Ledger:'}
              </strong>{' '}
              {locale === 'id'
                ? 'Saldo dan mutasi Dompet Kredit dicatat dalam buku besar transaksi yang diaudit di server dan dapat ditukarkan untuk membuka rilis Pay-Per-View aktif di DELOKEN.'
                : 'Credit balances are recorded in immutable wallet transactions and may be redeemed for any active Pay-Per-View release on DELOKEN.'}
            </p>
          </div>
        </article>
      )}

      {section === 'privacy' && (
        <article className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-8 space-y-4 sm:space-y-5 shadow-xs">
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">
            {locale === 'id' ? 'Kebijakan Privasi' : 'Privacy Policy'}
          </h1>
          <div className="space-y-4 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            <p>
              <strong className="text-slate-900 dark:text-white">
                {locale === 'id'
                  ? '1. Data Akun & Pemutaran:'
                  : '1. Account & Playback Data:'}
              </strong>{' '}
              {locale === 'id'
                ? 'DELOKEN hanya mengumpulkan data akun yang diperlukan untuk autentikasi, verifikasi pembelian, dan penyimpanan posisi lanjut tonton lintas perangkat.'
                : 'DELOKEN collects only the account details required for authentication, purchase verification, and saving playback resume positions across devices.'}
            </p>
            <p>
              <strong className="text-slate-900 dark:text-white">
                {locale === 'id'
                  ? '2. Keamanan Pembayaran:'
                  : '2. Payment Security:'}
              </strong>{' '}
              {locale === 'id'
                ? 'Proses pembayaran melalui PayPal maupun QRIS Indonesia diverifikasi secara aman melalui gateway pembayaran sisi server, webhook terautentikasi, atau verifikasi Admin.'
                : 'Payment credentials for PayPal and Indonesian QRIS are processed exclusively through verified server-side payment gateways and authenticated webhooks.'}
            </p>
            <p>
              <strong className="text-slate-900 dark:text-white">
                {locale === 'id'
                  ? '3. Perlindungan Aset Media:'
                  : '3. Media Protection:'}
              </strong>{' '}
              {locale === 'id'
                ? 'Berkas video sumber disimpan secara privat dan diputar melalui token otorisasi sementara maupun pemutar terproteksi anti-pengalihan.'
                : 'Source video assets remain private and are streamed only via short-lived, signed playback authorization tokens.'}
            </p>
          </div>
        </article>
      )}

      {section === 'contact' && (
        <article className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-8 space-y-4 sm:space-y-5 shadow-xs">
          <div className="space-y-2">
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">
              {locale === 'id' ? 'Hubungi DELOKEN' : 'Contact DELOKEN'}
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {locale === 'id'
                ? 'Pertanyaan seputar kemitraan kreator, dukungan penayangan, atau pembayaran internasional.'
                : 'Reach our curation, creator partnerships, or viewer support teams.'}
            </p>
          </div>

          {contactError && (
            <div
              role="alert"
              className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800/70 text-xs text-rose-700 dark:text-rose-300"
            >
              {contactError}
            </div>
          )}

          {contactSent && (
            <div
              role="status"
              className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/70 text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-2.5"
            >
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />
              <span>
                {locale === 'id'
                  ? 'Pesan Anda telah dicatat. Tim DELOKEN akan merespons dalam 1–2 hari kerja.'
                  : 'Your inquiry has been recorded. The DELOKEN team responds within 1–2 business days.'}
              </span>
            </div>
          )}

          <form onSubmit={handleContactSubmit} noValidate className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="contact-name" className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                  {locale === 'id' ? 'Nama' : 'Name'}
                </label>
                <input
                  id="contact-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>
              <div>
                <label htmlFor="contact-email" className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                  Email
                </label>
                <input
                  id="contact-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>
            </div>
            <div>
              <label htmlFor="contact-msg" className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                {locale === 'id' ? 'Pesan' : 'Message'}
              </label>
              <textarea
                id="contact-msg"
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>
            <Button type="submit" variant="primary" size="md" className="w-full sm:w-auto">
              {locale === 'id' ? 'Kirim Pesan' : 'Send Message'}
            </Button>
          </form>
        </article>
      )}
    </div>
  );
};
