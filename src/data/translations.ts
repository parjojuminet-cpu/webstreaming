import type { LanguageCode, ProjectCategory, PublicationStatus, TransactionStatus, VideoProvider } from '../types/deloken';

export const CATEGORY_LABELS: Record<ProjectCategory | 'All', { id: string; en: string }> = {
  All: { id: 'Semua', en: 'All' },
  'DIY & Crafts': { id: 'DIY & Kerajinan', en: 'DIY & Crafts' },
  'Culinary & Recipes': { id: 'Kuliner & Resep', en: 'Culinary & Recipes' },
  'Technical & Repair': { id: 'Teknis & Perbaikan', en: 'Technical & Repair' },
  Documentary: { id: 'Dokumenter', en: 'Documentary' },
};

export const PROVIDER_LABELS: Record<VideoProvider, { id: string; en: string }> = {
  youtube_unlisted: { id: 'YouTube Unlisted', en: 'YouTube Unlisted' },
  archive_org_mp4: { id: 'Archive.org Direct MP4', en: 'Archive.org Direct MP4' },
  google_drive: { id: 'Google Drive Video', en: 'Google Drive Video' },
  deloken_hosted: { id: 'DELOKEN Hosted Video', en: 'DELOKEN Hosted Video' },
};

export const PUBLICATION_STATUS_LABELS: Record<PublicationStatus, { id: string; en: string }> = {
  pending_review: { id: 'Pending Review', en: 'Pending Review' },
  published: { id: 'Published', en: 'Published' },
  rejected: { id: 'Rejected', en: 'Rejected' },
  revision_requested: { id: 'Revision Requested', en: 'Revision Requested' },
  unpublished: { id: 'Unpublished', en: 'Unpublished' },
};

export const TRANSACTION_STATUS_LABELS: Record<TransactionStatus, { id: string; en: string }> = {
  pending_verification: { id: 'Pending Verification', en: 'Pending Verification' },
  paid: { id: 'Paid', en: 'Paid' },
  rejected: { id: 'Rejected', en: 'Rejected' },
  refunded: { id: 'Refunded', en: 'Refunded' },
};

export const DELOKEN_I18N = {
  id: {
    brandTagline: 'Platform Belajar Hybrid, DIY & Dokumenter',
    prototypeNotice:
      'Mode Prototipe Interaktif — Data proyek, transaksi, keanggotaan, dan log disimpan di localStorage browser (bukan database multi-pengguna produksi).',
    roles: {
      viewer: 'Mode Penonton',
      creator: 'Mode Kreator',
      admin: 'Mode Admin',
    },
    nav: {
      catalog: 'Katalog',
      creatorStudio: 'Studio Kreator',
      adminCenter: 'Admin Center',
      signIn: 'Masuk Google',
      signedInAs: 'Akun Google',
    },
    viewer: {
      heroTitle: 'Belajar Keterampilan Praktis, DIY & Dokumenter Pilihan',
      heroSubtitle:
        'Tonton pratinjau gratis 5 menit pertama. Buka materi penuh, rincian bahan, langkah teknik, dan lampiran blueprint dalam satu platform kurasi DELOKEN.',
      searchPlaceholder: 'Cari proyek DIY, kuliner, perbaikan, atau kreator...',
      publishedCountSuffix: 'proyek diterbitkan',
      membershipBannerTitle: 'Langganan Semua Akses DELOKEN',
      membershipActive: 'Membership Aktif hingga',
      membershipExpired: 'Membership Kedaluwarsa — Pembelian individual Anda tetap berlaku.',
      membershipInactive: 'Buka seluruh katalog proyek dengan 1 langganan bulanan atau beli per proyek.',
      getMembershipBtn: 'Langganan Semua Akses',
      attachmentsBadge: 'Ada Lampiran',
      viewDetails: 'Lihat Detail',
      emptyCatalogTitle: 'Belum ada proyek yang cocok',
      emptyCatalogDesc: 'Ubah kata kunci pencarian atau pilih kategori lain.',
      unlockedLabel: 'Akses Terbuka',
      lockedPreviewLabel: 'Pratinjau 5 Menit',
    },
    detail: {
      backToCatalog: 'Kembali ke Katalog',
      tabOverview: 'Overview & Tools',
      tabMaterials: 'Materials & Steps',
      tabAttachments: 'Attachments & Download',
      lockedTabHint: 'Tab terkunci. Selesaikan pembayaran untuk membuka daftar bahan, langkah teknik, dan lampiran.',
      unlockNow: 'Buka Akses Proyek',
      accessActiveIndividual: 'Akses Proyek Aktif (Pembelian Individual)',
      accessActiveMembership: 'Akses Proyek Aktif (All-Access Membership)',
      accessPreviewOnly: 'Pratinjau Terbatas 5 Menit — Belum Lunas',
      materialsHeading: 'Rincian Bahan & Peralatan',
      stepsHeading: 'Langkah Teknik Pengerjaan',
      attachmentsHeading: 'Berkas Lampiran Proyek',
      driveRestrictedNotice:
        'Catatan Lampiran Google Drive Restricted: Berkas dengan izin Restricted tidak dapat diunduh otomatis tanpa izin akses Google Drive yang sesuai dari kreator/admin.',
      openAttachment: 'Buka / Unduh Lampiran',
      simulatedAttachmentNotice:
        'Lampiran ini berasal dari simulasi unggah file lokal browser (tidak diunggah ke server produksi).',
    },
    player: {
      modeSim: 'Timer Simulasi Akses (00:00 – 30:00)',
      modeProvider: 'Pemutar Sumber Video',
      simNotice:
        'Timer simulasi di bawah terpisah dari durasi pemutar video eksternal dan digunakan untuk menguji penguncian akses tepat pada menit ke-05:00.',
      jumpTo455: 'Simulasi Lompat ke 04:55',
      lockTitle: 'Batas Pratinjau 5 Menit Tercapai',
      lockDesc:
        'Timer mencapai 05:00 dan akses proyek ini belum lunas. Buka proyek ini atau aktifkan Membership untuk melanjutkan pemutaran.',
      unlockBtn: 'Buka Akses & Lanjutkan',
      providerErrorTitle: 'Sumber video gagal dimuat',
    },
    payment: {
      title: 'Buka Akses DELOKEN',
      subtitle: 'Pilih metode pembayaran tanpa redirect (Simulasi Prototipe)',
      tabQris: 'Indonesia (QRIS)',
      tabPaypal: 'International (PayPal)',
      optProjectIdr: 'Buka Proyek Ini Saja',
      optMembershipIdr: 'Langganan Semua Akses (30 Hari)',
      optProjectUsd: 'Unlock This Project',
      optMembershipUsd: 'All-Access Monthly Pass',
      baseAmount: 'Nominal Dasar',
      uniqueCode: 'Kode Unik (3 Digit)',
      finalAmount: 'Total Transfer',
      copyNominal: 'Salin Nominal',
      copied: 'Tersalin',
      qrisPlaceholderLabel: 'QRIS Merchant Placeholder',
      qrisPlaceholderDesc:
        'Gambar QRIS ini adalah placeholder prototipe dan belum terhubung ke merchant QRIS sungguhan.',
      btnPaidConfirm: 'Saya Sudah Bayar',
      btnSimInstant: 'Simulasi Verifikasi Instan (Uji Coba)',
      simInstantNote:
        'Tombol Uji Coba Instan hanya untuk pengujian prototipe dan bukan bukti pembayaran sungguhan.',
      pendingCreated:
        'Transaksi tersimpan sebagai Pending Verification dan masuk ke antrean Kurasi Pembayaran Admin. Akses masih terkunci sampai Admin menyetujui.',
      paypalDisclaimer:
        'Simulasi Checkout Internasional: Tidak memproses pembayaran PayPal/Kartu sungguhan. Produksi memerlukan PayPal API & webhook backend.',
      btnPaypal: 'Pay with PayPal',
      btnCard: 'Debit or Credit Card',
      duplicatePendingNote:
        'Order QRIS yang sama masih Pending Verification dengan kode unik tetap di atas.',
    },
    creator: {
      title: 'Creator Studio DELOKEN',
      subtitle: 'Ajukan proyek pembelajaran, DIY, atau dokumenter untuk dikurasi Admin.',
      kpiRevenueIdr: 'Total Pendapatan IDR (Paid)',
      kpiRevenueUsd: 'Total Pendapatan USD (Paid)',
      kpiTotalProjects: 'Total Proyek',
      kpiPublished: 'Diterbitkan',
      kpiPending: 'Menunggu Seleksi',
      formHeading: 'Form Pengajuan Proyek Baru',
      editingHeading: 'Perbarui Pengajuan (Diminta Revisi)',
      submitBtn: 'Kirim ke Kurasi Admin',
      resubmitBtn: 'Kirim Ulang ke Kurasi Admin',
      tableHeading: 'Daftar Proyek Saya',
    },
    admin: {
      title: 'DELOKEN Admin Control Center',
      subtitle: 'Kelola kurasi konten kreator, verifikasi pembayaran QRIS, keanggotaan, dan log aktivitas.',
      tabCuration: 'Curation Management',
      tabPayments: 'Payment Management',
      tabLogs: 'Activity Log & Kontrol Demo',
      btnApprovePublish: 'Layak & Terbitkan',
      btnRequestRevision: 'Minta Revisi',
      btnReject: 'Tolak',
      btnUnpublish: 'Tarik dari Katalog',
      btnApprovePayment: 'Setujui (Lunas)',
      btnRejectPayment: 'Tolak',
      btnRefundPayment: 'Refund',
      btnResetDemo: 'Reset Demo Data',
      resetConfirmTitle: 'Reset Semua Data Prototipe DELOKEN?',
      resetConfirmDesc:
        'Tindakan ini mengembalikan proyek ke 3 data awal dan menghapus seluruh transaksi, keanggotaan, serta log aktivitas di localStorage.',
    },
  },
  en: {
    brandTagline: 'Hybrid Learning, DIY & Documentary Platform',
    prototypeNotice:
      'Interactive Prototype Mode — Projects, transactions, memberships, and logs are persisted in browser localStorage (simulated single-browser store, not a production multi-user database).',
    roles: {
      viewer: 'Viewer Mode',
      creator: 'Creator Mode',
      admin: 'Admin Mode',
    },
    nav: {
      catalog: 'Catalog',
      creatorStudio: 'Creator Studio',
      adminCenter: 'Admin Center',
      signIn: 'Google Sign In',
      signedInAs: 'Google Account',
    },
    viewer: {
      heroTitle: 'Practical Skills, DIY Builds & Curated Documentaries',
      heroSubtitle:
        'Watch the first 5 minutes free. Unlock complete video lessons, material lists, technical steps, and downloadable blueprints on DELOKEN.',
      searchPlaceholder: 'Search DIY builds, culinary docs, repairs, or creators...',
      publishedCountSuffix: 'published projects',
      membershipBannerTitle: 'DELOKEN All-Access Membership',
      membershipActive: 'Membership Active until',
      membershipExpired: 'Membership Expired — Your individual project purchases remain active.',
      membershipInactive: 'Unlock all published projects with a monthly pass or unlock individually.',
      getMembershipBtn: 'Get All-Access Pass',
      attachmentsBadge: 'Attachments Included',
      viewDetails: 'View Details',
      emptyCatalogTitle: 'No matching projects found',
      emptyCatalogDesc: 'Try adjusting your search query or switching categories.',
      unlockedLabel: 'Unlocked',
      lockedPreviewLabel: '5-Min Free Preview',
    },
    detail: {
      backToCatalog: 'Back to Catalog',
      tabOverview: 'Overview & Tools',
      tabMaterials: 'Materials & Steps',
      tabAttachments: 'Attachments & Download',
      lockedTabHint: 'Tab locked. Complete payment to unlock materials, technical steps, and attachments.',
      unlockNow: 'Unlock Full Project',
      accessActiveIndividual: 'Access Active (Individual Purchase)',
      accessActiveMembership: 'Access Active (All-Access Membership)',
      accessPreviewOnly: '5-Minute Free Preview — Unpaid',
      materialsHeading: 'Materials & Tools Breakdown',
      stepsHeading: 'Technical Execution Steps',
      attachmentsHeading: 'Project Attachments',
      driveRestrictedNotice:
        'Google Drive Restricted Notice: Restricted attachments cannot be downloaded automatically without matching Google Drive access permissions.',
      openAttachment: 'Open / Download Attachment',
      simulatedAttachmentNotice:
        'This attachment was added via simulated browser local file selection (not uploaded to a production server).',
    },
    player: {
      modeSim: 'Access Simulation Timer (00:00 – 30:00)',
      modeProvider: 'External Video Source',
      simNotice:
        'The simulation timer operates independently of external provider video duration to verify access locking at 05:00.',
      jumpTo455: 'Jump to 04:55',
      lockTitle: '5-Minute Free Preview Limit Reached',
      lockDesc:
        'The timer reached 05:00 and this project is still unpaid. Unlock this project or activate an All-Access Pass to continue.',
      unlockBtn: 'Unlock & Resume',
      providerErrorTitle: 'Video source failed to load',
    },
    payment: {
      title: 'Unlock DELOKEN Access',
      subtitle: 'No-redirect prototype checkout modal',
      tabQris: 'Indonesia (QRIS)',
      tabPaypal: 'International (PayPal)',
      optProjectIdr: 'Unlock This Project Only',
      optMembershipIdr: 'All-Access Pass (30 Days)',
      optProjectUsd: 'Unlock This Project',
      optMembershipUsd: 'All-Access Monthly Pass',
      baseAmount: 'Base Amount',
      uniqueCode: 'Unique Code (3 Digits)',
      finalAmount: 'Final Amount',
      copyNominal: 'Copy Amount',
      copied: 'Copied',
      qrisPlaceholderLabel: 'QRIS Merchant Placeholder',
      qrisPlaceholderDesc:
        'This QRIS image is a prototype placeholder and is not connected to a live QRIS merchant.',
      btnPaidConfirm: 'I Have Paid',
      btnSimInstant: 'Simulate Instant Verification (Test)',
      simInstantNote:
        'Instant verification is strictly for prototype testing and does not represent real payment settlement.',
      pendingCreated:
        'Transaction saved as Pending Verification in the Admin queue. Project access remains locked until approved.',
      paypalDisclaimer:
        'Simulated Checkout: No live PayPal or card charge is processed. Production requires PayPal API & backend webhooks.',
      btnPaypal: 'Pay with PayPal',
      btnCard: 'Debit or Credit Card',
      duplicatePendingNote:
        'An identical QRIS order is already Pending Verification using the preserved unique code above.',
    },
    creator: {
      title: 'DELOKEN Creator Studio',
      subtitle: 'Submit DIY, practical skills, or documentary projects for Admin curation.',
      kpiRevenueIdr: 'Total Revenue IDR (Paid)',
      kpiRevenueUsd: 'Total Revenue USD (Paid)',
      kpiTotalProjects: 'Total Projects',
      kpiPublished: 'Published',
      kpiPending: 'Pending Review',
      formHeading: 'Submit New Project',
      editingHeading: 'Update Submission (Revision Requested)',
      submitBtn: 'Submit to Admin Curation',
      resubmitBtn: 'Resubmit to Admin Curation',
      tableHeading: 'My Submissions',
    },
    admin: {
      title: 'DELOKEN Admin Control Center',
      subtitle: 'Curate creator submissions, verify QRIS payments, inspect memberships, and review activity logs.',
      tabCuration: 'Curation Management',
      tabPayments: 'Payment Management',
      tabLogs: 'Activity Log & Demo Controls',
      btnApprovePublish: 'Approve & Publish',
      btnRequestRevision: 'Request Revision',
      btnReject: 'Reject',
      btnUnpublish: 'Unpublish',
      btnApprovePayment: 'Approve (Paid)',
      btnRejectPayment: 'Reject',
      btnRefundPayment: 'Refund',
      btnResetDemo: 'Reset Demo Data',
      resetConfirmTitle: 'Reset All DELOKEN Prototype Data?',
      resetConfirmDesc:
        'This restores the 3 initial seeded projects and clears all browser transactions, memberships, and activity logs.',
    },
  },
} as const;

export function getTranslation(language: LanguageCode) {
  return DELOKEN_I18N[language];
}
