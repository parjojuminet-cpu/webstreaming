import React, { useState } from 'react';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import type { LocaleCode, ViewRoute } from '../types/vyora';
import { Button } from '../components/ui/Button';

interface InfoPageProps {
  section: 'about' | 'contact' | 'terms' | 'privacy' | 'guidelines';
  locale: LocaleCode;
  onBack: () => void;
  onNavigate: (route: ViewRoute) => void;
}

export const InfoPage: React.FC<InfoPageProps> = ({
  section,
  locale,
  onBack,
  onNavigate,
}) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [contactError, setContactError] = useState<string | null>(null);
  const [contactSent, setContactSent] = useState(false);

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
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 space-y-6 sm:space-y-8">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 min-h-[44px] text-xs font-semibold text-[#A5A6B2] hover:text-[#F5F5F7] transition-colors cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        <span>{locale === 'id' ? 'Kembali ke Beranda' : 'Back to Home'}</span>
      </button>

      {section === 'about' && (
        <article className="bg-[#1B1C27] border border-white/10 rounded-2xl p-5 sm:p-10 space-y-5 sm:space-y-6">
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#F5F5F7]">
            {locale === 'id' ? 'Tentang VYORA' : 'About VYORA'}
          </h1>
          <p className="text-sm sm:text-base text-[#A5A6B2] leading-relaxed">
            {locale === 'id'
              ? 'VYORA adalah platform streaming Pay-Per-View internasional dan pasar kreator yang menghubungkan pembuat film independen, pengajar, dokumenter, dan penyelenggara acara dengan penonton di Indonesia maupun global.'
              : 'VYORA is an international Pay-Per-View streaming platform and creator marketplace built to connect independent filmmakers, educators, documentary teams, and live event producers directly with audiences in Indonesia and worldwide.'}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-4 border-t border-white/8">
            <div>
              <h2 className="text-sm font-semibold text-[#F5F5F7] mb-1">
                {locale === 'id' ? 'Pratinjau 5 Menit' : '5-Minute Free Preview'}
              </h2>
              <p className="text-xs text-[#A5A6B2] leading-relaxed">
                {locale === 'id'
                  ? 'Penonton selalu dapat menilai kualitas visual dan narasi sebelum membuka konten.'
                  : 'Every title allows five minutes of uncompromised playback before unlocking.'}
              </p>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[#F5F5F7] mb-1">
                {locale === 'id' ? 'Akses 30 Hari' : '30-Day Entitlements'}
              </h2>
              <p className="text-xs text-[#A5A6B2] leading-relaxed">
                {locale === 'id'
                  ? 'Setiap pembelian memberikan masa akses penuh 30 hari tanpa perpanjangan otomatis.'
                  : 'Unlocking a title grants 30 calendar days of streaming with zero auto-renewals.'}
              </p>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[#F5F5F7] mb-1">
                {locale === 'id' ? 'Ekonomi Kreator' : 'Creator-First Revenue'}
              </h2>
              <p className="text-xs text-[#A5A6B2] leading-relaxed">
                {locale === 'id'
                  ? 'Kreator menetapkan harga sendiri dalam USD dan IDR dengan analitik transparan.'
                  : 'Creators control their pricing, multi-currency reach, and verified payout schedule.'}
              </p>
            </div>
          </div>
        </article>
      )}

      {section === 'guidelines' && (
        <article className="bg-[#1B1C27] border border-white/10 rounded-2xl p-5 sm:p-10 space-y-5 sm:space-y-6">
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#F5F5F7]">
            {locale === 'id' ? 'Panduan Kreator VYORA' : 'VYORA Creator Guidelines'}
          </h1>
          <p className="text-sm sm:text-base text-[#A5A6B2] leading-relaxed">
            {locale === 'id'
              ? 'Semua karya yang diajukan melalui Creator Studio melewati tinjauan kurasi dan moderasi sebelum diterbitkan.'
              : 'All submissions pass through editorial curation and content moderation before transitioning from pending review to published.'}
          </p>
          <ul className="space-y-4 text-sm text-[#A5A6B2] pt-2 border-t border-white/8">
            <li>
              <strong className="text-[#F5F5F7] block mb-1">
                01. {locale === 'id' ? 'Kepemilikan Hak Cipta' : 'Original Rights & Licensing'}
              </strong>
              {locale === 'id'
                ? 'Kreator wajib memiliki hak distribusi global atau regional atas seluruh materi video, musik, dan gambar pendukung.'
                : 'Creators must hold verified distribution rights for all video, music stems, and promotional artwork submitted.'}
            </li>
            <li>
              <strong className="text-[#F5F5F7] block mb-1">
                02. {locale === 'id' ? 'Standar Teknis Video' : 'Technical Mastering Standards'}
              </strong>
              {locale === 'id'
                ? 'Minimal 1080p HD (disarankan 4K UHD/HDR), audio stereo atau spasial jernih, dan poster rasio 16:9 tanpa teks berlebihan.'
                : 'Minimum 1080p HD (4K UHD/HDR recommended), balanced stereo or spatial audio, and clean 16:9 key art.'}
            </li>
            <li>
              <strong className="text-[#F5F5F7] block mb-1">
                03. {locale === 'id' ? 'Status Moderasi' : 'Moderation Lifecycle'}
              </strong>
              {locale === 'id'
                ? 'Alur status konten: draft → pending_review → approved → published. Hanya konten disetujui yang dapat tayang.'
                : 'Workflow states: draft → pending_review → approved → published. Only approved titles can be published.'}
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
        <article className="bg-[#1B1C27] border border-white/10 rounded-2xl p-5 sm:p-10 space-y-5">
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#F5F5F7]">
            {locale === 'id' ? 'Syarat & Ketentuan' : 'Terms of Service'}
          </h1>
          <div className="space-y-4 text-sm text-[#A5A6B2] leading-relaxed">
            <p>
              <strong className="text-[#F5F5F7]">1. Pay-Per-View & 30-Day Entitlements:</strong>{' '}
              Purchasing a title on VYORA via PayPal, QRIS, or Credit Wallet grants a non-transferable 30-day streaming entitlement calculated using server timestamps.
            </p>
            <p>
              <strong className="text-[#F5F5F7]">2. Free Preview Policy:</strong>{' '}
              Every published release includes a 5-minute free preview. Automated or client-side attempts to bypass preview gates violate platform security policies.
            </p>
            <p>
              <strong className="text-[#F5F5F7]">3. Credit Wallet Ledger:</strong>{' '}
              Credit balances are recorded in immutable wallet transactions and may be redeemed for any active Pay-Per-View release on VYORA.
            </p>
          </div>
        </article>
      )}

      {section === 'privacy' && (
        <article className="bg-[#1B1C27] border border-white/10 rounded-2xl p-5 sm:p-10 space-y-5">
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#F5F5F7]">
            {locale === 'id' ? 'Kebijakan Privasi' : 'Privacy Policy'}
          </h1>
          <div className="space-y-4 text-sm text-[#A5A6B2] leading-relaxed">
            <p>
              <strong className="text-[#F5F5F7]">1. Account & Playback Data:</strong>{' '}
              VYORA collects only the account details required for authentication, purchase verification, and saving playback resume positions across devices.
            </p>
            <p>
              <strong className="text-[#F5F5F7]">2. Payment Security:</strong>{' '}
              Payment credentials for PayPal and Indonesian QRIS are processed exclusively through verified server-side payment gateways and authenticated webhooks.
            </p>
            <p>
              <strong className="text-[#F5F5F7]">3. Media Protection:</strong>{' '}
              Source video assets remain private and are streamed only via short-lived, signed playback authorization tokens.
            </p>
          </div>
        </article>
      )}

      {section === 'contact' && (
        <article className="bg-[#1B1C27] border border-white/10 rounded-2xl p-5 sm:p-10 space-y-5 sm:space-y-6">
          <div className="space-y-2">
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#F5F5F7]">
              {locale === 'id' ? 'Hubungi VYORA' : 'Contact VYORA'}
            </h1>
            <p className="text-sm text-[#A5A6B2]">
              {locale === 'id'
                ? 'Pertanyaan seputar kemitraan kreator, dukungan penayangan, atau pembayaran internasional.'
                : 'Reach our curation, creator partnerships, or viewer support teams.'}
            </p>
          </div>

          {contactError && (
            <div
              role="alert"
              className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300"
            >
              {contactError}
            </div>
          )}

          {contactSent && (
            <div
              role="status"
              className="p-4 rounded-xl bg-[#7957ED]/15 border border-[#7957ED]/40 text-xs text-[#F5F5F7] flex items-center gap-2.5"
            >
              <CheckCircle2 className="w-4 h-4 text-[#A78BFA] shrink-0" aria-hidden="true" />
              <span>
                {locale === 'id'
                  ? 'Pesan Anda telah dicatat. Tim VYORA akan merespons dalam 1–2 hari kerja.'
                  : 'Your inquiry has been recorded. The VYORA team responds within 1–2 business days.'}
              </span>
            </div>
          )}

          <form onSubmit={handleContactSubmit} noValidate className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="contact-name" className="block text-xs font-medium text-[#A5A6B2] mb-1.5">
                  {locale === 'id' ? 'Nama' : 'Name'}
                </label>
                <input
                  id="contact-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[#11121A] border border-white/12 text-sm text-[#F5F5F7] focus:outline-none focus:ring-2 focus:ring-[#7957ED]"
                />
              </div>
              <div>
                <label htmlFor="contact-email" className="block text-xs font-medium text-[#A5A6B2] mb-1.5">
                  Email
                </label>
                <input
                  id="contact-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[#11121A] border border-white/12 text-sm text-[#F5F5F7] focus:outline-none focus:ring-2 focus:ring-[#7957ED]"
                />
              </div>
            </div>
            <div>
              <label htmlFor="contact-msg" className="block text-xs font-medium text-[#A5A6B2] mb-1.5">
                {locale === 'id' ? 'Pesan' : 'Message'}
              </label>
              <textarea
                id="contact-msg"
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#11121A] border border-white/12 text-sm text-[#F5F5F7] focus:outline-none focus:ring-2 focus:ring-[#7957ED]"
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
