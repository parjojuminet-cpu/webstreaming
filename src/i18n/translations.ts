import type { ContentCategory, CurrencyCode, LocaleCode } from '../types/vyora';

export const CATEGORY_LIST: ContentCategory[] = [
  'Movies',
  'Education',
  'Documentary',
  'Events',
  'Creator Exclusives',
];

export const CATEGORY_DESCRIPTIONS: Record<
  ContentCategory,
  { en: string; id: string; subtitleEn: string; subtitleId: string }
> = {
  Movies: {
    en: 'Independent feature films, festival selections, and director cuts mastered in 4K HDR.',
    id: 'Film panjang independen, pilihan festival, dan edisi sutradara dalam kualitas 4K HDR.',
    subtitleEn: 'Cinema & Narrative Features',
    subtitleId: 'Sinema & Film Naratif',
  },
  Education: {
    en: 'In-depth craft masterclasses, cinematography labs, and architectural design workshops.',
    id: 'Kelas master mendalam, laboratorium sinematografi, dan lokakarya desain arsitektur.',
    subtitleEn: 'Masterclasses & Craft Labs',
    subtitleId: 'Kelas Master & Lokakarya',
  },
  Documentary: {
    en: 'Long-form investigative reporting, natural history expeditions, and cultural portraits.',
    id: 'Laporan investigasi panjang, ekspedisi alam, dan potret budaya Nusantara hingga global.',
    subtitleEn: 'Expeditions & Non-Fiction',
    subtitleId: 'Ekspedisi & Dokumenter',
  },
  Events: {
    en: 'Captured live concerts, stage performances, and intimate acoustic sessions with spatial audio.',
    id: 'Rekaman konser langsung, pertunjukan panggung, dan sesi akustik intim dengan audio spasial.',
    subtitleEn: 'Live Concerts & Stage Captures',
    subtitleId: 'Konser Langsung & Panggung',
  },
  'Creator Exclusives': {
    en: 'Original series, visual essays, and behind-the-scenes releases direct from independent studios.',
    id: 'Serial orisinal, esai visual, dan rilis eksklusif langsung dari studio kreator independen.',
    subtitleEn: 'Independent Studio Originals',
    subtitleId: 'Orisinal Studio Independen',
  },
};

export const CATEGORY_LABELS_ID: Record<ContentCategory, string> = {
  Movies: 'Film',
  Education: 'Edukasi',
  Documentary: 'Dokumenter',
  Events: 'Acara Langsung',
  'Creator Exclusives': 'Eksklusif Kreator',
};

export interface Dictionary {
  tagline: string;
  nav: {
    home: string;
    explore: string;
    categories: string;
    pricing: string;
    search: string;
    login: string;
    signup: string;
  };
  hero: {
    featuredLabel: string;
    watchPreview: string;
    viewDetails: string;
    previewNote: string;
  };
  sections: {
    galleryHeading: string;
    gallerySubtitle: string;
    allCategories: string;
    trendingNow: string;
    trendingSubtitle: string;
    exploreCategories: string;
    categoriesSubtitle: string;
    featuredCreators: string;
    creatorsSubtitle: string;
    recentlyAdded: string;
    recentlySubtitle: string;
    howItWorks: string;
    howItWorksSubtitle: string;
    viewAll: string;
  };
  howSteps: {
    step1Title: string;
    step1Desc: string;
    step2Title: string;
    step2Desc: string;
    step3Title: string;
    step3Desc: string;
  };
  cta: {
    heading: string;
    body: string;
    primaryBtn: string;
    secondaryBtn: string;
  };
  cards: {
    watchPreview: string;
    watchFree: string;
    viewDetails: string;
    exploreCreator: string;
    titles: string;
    access30Days: string;
    freeAccess: string;
    freePreview: string;
  };
  footer: {
    about: string;
    contact: string;
    terms: string;
    privacy: string;
    guidelines: string;
    social: string;
    language: string;
    currency: string;
    rights: string;
  };
}

export const TRANSLATIONS: Record<LocaleCode, Dictionary> = {
  en: {
    tagline: 'Learn Practical Skills. Stream Curated Documentaries.',
    nav: {
      home: 'Home',
      explore: 'Explore',
      categories: 'Categories',
      pricing: 'Pricing',
      search: 'Search',
      login: 'Login',
      signup: 'Sign Up',
    },
    hero: {
      featuredLabel: 'Featured Premiere',
      watchPreview: 'Watch Preview',
      viewDetails: 'View Details',
      previewNote: '5-minute free preview · 30-day access upon unlock',
    },
    sections: {
      galleryHeading: 'Curated Learning, DIY & Documentary Catalog',
      gallerySubtitle: 'Select any documentary, practical workshop, or independent release to stream a 5-minute free preview immediately.',
      allCategories: 'All',
      trendingNow: 'Trending Now',
      trendingSubtitle: 'Most watched Pay-Per-View releases across Indonesia and international audiences.',
      exploreCategories: 'Explore Categories',
      categoriesSubtitle: 'Curated films, masterclasses, documentaries, live performances, and creator originals.',
      featuredCreators: 'Featured Creators',
      creatorsSubtitle: 'Independent filmmakers, craft educators, and visual storytellers publishing directly on DELOKEN.',
      recentlyAdded: 'Recently Added',
      recentlySubtitle: 'Newly approved premieres ready for instant five-minute preview.',
      howItWorks: 'How DELOKEN Works',
      howItWorksSubtitle: 'Transparent Pay-Per-View streaming with zero recurring subscription lock-in.',
      viewAll: 'View All',
    },
    howSteps: {
      step1Title: '01. Watch Five Minutes Free',
      step1Desc: 'Start any documentary, workshop, or film immediately. Experience the first five minutes in full resolution before deciding.',
      step2Title: '02. Unlock Premium Access',
      step2Desc: 'Pay per title via PayPal, Indonesian QRIS, or your DELOKEN Credit Wallet with instant server-verified entitlement.',
      step3Title: '03. Enjoy 30 Days of Access',
      step3Desc: 'Stream seamlessly across desktop, tablet, and mobile for 30 full days from purchase, resuming right where you paused.',
    },
    cta: {
      heading: 'Become a DELOKEN Creator',
      body: 'Publish practical workshops, craft documentaries, or independent cinema directly to Indonesian and global viewers with transparent Pay-Per-View revenue.',
      primaryBtn: 'Start Publishing Content',
      secondaryBtn: 'Read Creator Guidelines',
    },
    cards: {
      watchPreview: 'Watch Preview',
      watchFree: 'Watch Free',
      viewDetails: 'Details',
      exploreCreator: 'Explore Creator',
      titles: 'titles',
      access30Days: '30-day access',
      freeAccess: 'Free full access',
      freePreview: '5m free preview',
    },
    footer: {
      about: 'About',
      contact: 'Contact',
      terms: 'Terms',
      privacy: 'Privacy',
      guidelines: 'Creator Guidelines',
      social: 'Social Media',
      language: 'Language',
      currency: 'Currency',
      rights: 'DELOKEN Hybrid Learning & Documentary Platform. All rights reserved.',
    },
  },
  id: {
    tagline: 'Belajar Keterampilan Praktis. Tonton Dokumenter Terkurasi.',
    nav: {
      home: 'Beranda',
      explore: 'Jelajah',
      categories: 'Kategori',
      pricing: 'Harga',
      search: 'Cari',
      login: 'Masuk',
      signup: 'Daftar',
    },
    hero: {
      featuredLabel: 'Tayangan Unggulan',
      watchPreview: 'Tonton Pratinjau',
      viewDetails: 'Lihat Detail',
      previewNote: 'Pratinjau gratis 5 menit · Akses penuh 30 hari setelah dibuka',
    },
    sections: {
      galleryHeading: 'Katalog Edukasi, DIY & Dokumenter',
      gallerySubtitle: 'Pilih film dokumenter, kelas keterampilan praktis, atau karya independen untuk langsung menonton pratinjau gratis 5 menit.',
      allCategories: 'Semua',
      trendingNow: 'Sedang Tren',
      trendingSubtitle: 'Rilisan Pay-Per-View paling banyak ditonton di Indonesia dan mancanegara.',
      exploreCategories: 'Jelajahi Kategori',
      categoriesSubtitle: 'Kurasi film, kelas praktik, dokumenter, konser langsung, dan karya eksklusif kreator independen.',
      featuredCreators: 'Kreator Pilihan',
      creatorsSubtitle: 'Pembuat film, pengajar praktis, dan dokumenter independen yang merilis karya langsung di DELOKEN.',
      recentlyAdded: 'Baru Ditambahkan',
      recentlySubtitle: 'Tayangan terbaru yang siap ditonton pratinjau gratis lima menit.',
      howItWorks: 'Cara Kerja DELOKEN',
      howItWorksSubtitle: 'Streaming Pay-Per-View transparan tanpa kewajiban langganan bulanan.',
      viewAll: 'Lihat Semua',
    },
    howSteps: {
      step1Title: '01. Tonton Lima Menit Gratis',
      step1Desc: 'Mulai tonton dokumenter, kelas praktik, atau film apa pun seketika. Evaluasi lima menit pertama sebelum memutuskan membeli.',
      step2Title: '02. Buka Akses Premium',
      step2Desc: 'Bayar per judul melalui QRIS Indonesia, PayPal internasional, atau Dompet Kredit DELOKEN dengan verifikasi server instan.',
      step3Title: '03. Nikmati Akses 30 Hari',
      step3Desc: 'Streaming lancar di desktop, tablet, dan ponsel selama 30 hari penuh, melanjutkan tepat dari posisi terakhir.',
    },
    cta: {
      heading: 'Jadilah Kreator DELOKEN',
      body: 'Publikasikan kelas praktik, dokumenter kerajinan, atau film independen langsung ke penonton Indonesia dan global dengan bagi hasil transparan.',
      primaryBtn: 'Mulai Publikasi Konten',
      secondaryBtn: 'Baca Panduan Kreator',
    },
    cards: {
      watchPreview: 'Pratinjau',
      watchFree: 'Tonton Gratis',
      viewDetails: 'Detail',
      exploreCreator: 'Jelajahi Kreator',
      titles: 'karya',
      access30Days: 'akses 30 hari',
      freeAccess: 'akses penuh gratis',
      freePreview: 'pratinjau 5 menit',
    },
    footer: {
      about: 'Tentang',
      contact: 'Kontak',
      terms: 'Syarat & Ketentuan',
      privacy: 'Privasi',
      guidelines: 'Panduan Kreator',
      social: 'Media Sosial',
      language: 'Bahasa',
      currency: 'Mata Uang',
      rights: 'DELOKEN Hybrid Learning & Documentary Platform. Hak cipta dilindungi.',
    },
  },
};

export function isFreeContent(item: {
  priceUsd: number;
  priceIdr: number;
  creditCost: number;
}): boolean {
  return item.priceUsd === 0 && item.priceIdr === 0 && item.creditCost === 0;
}

export function formatPrice(priceUsd: number, priceIdr: number, currency: CurrencyCode): string {
  if (currency === 'IDR') {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0,
    }).format(priceIdr);
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(priceUsd);
}

export function formatReleasePrice(
  item: { priceUsd: number; priceIdr: number; creditCost: number },
  locale: LocaleCode,
  currency: CurrencyCode
): string {
  if (isFreeContent(item)) {
    return locale === 'id' ? 'Gratis' : 'Free';
  }
  return formatPrice(item.priceUsd, item.priceIdr, currency);
}

export function formatDuration(minutes: number, locale: LocaleCode): string {
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (locale === 'id') {
    return hrs > 0 ? `${hrs}j ${mins}m` : `${mins} mnt`;
  }
  return hrs > 0 ? `${hrs}h ${mins}m` : `${mins} min`;
}

export function formatLocalizedDate(isoDate: string, locale: LocaleCode): string {
  const date = new Date(isoDate);
  return new Intl.DateTimeFormat(locale === 'id' ? 'id-ID' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}
