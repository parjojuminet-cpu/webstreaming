import type { ContentItem, CreatorProfile, CreditPackage, ReviewItem } from '../types/vyora';

export const CREATORS: CreatorProfile[] = [];

export const CATALOG_ITEMS: ContentItem[] = [];

export const CREDIT_PACKAGES: CreditPackage[] = [
  {
    id: 'pack-starter',
    name: 'Viewer Pack',
    nameId: 'Paket Penonton',
    credits: 10,
    bonusCredits: 0,
    priceUsd: 9.5,
    priceIdr: 149000,
    description: 'Ideal for two to three weekend premieres or documentaries.',
    descriptionId: 'Ideal untuk menonton dua hingga tiga film perdana atau dokumenter.',
  },
  {
    id: 'pack-cinema',
    name: 'Cinema Pass',
    nameId: 'Paket Sinema',
    credits: 25,
    bonusCredits: 4,
    priceUsd: 22.0,
    priceIdr: 349000,
    description: 'Includes 4 bonus credits. Covers up to six 4K HDR features or masterclasses.',
    descriptionId: 'Termasuk 4 kredit bonus. Cukup untuk hingga enam tayangan 4K HDR atau kelas master.',
    recommended: true,
  },
  {
    id: 'pack-studio',
    name: 'Patron Vault',
    nameId: 'Paket Kolektor',
    credits: 60,
    bonusCredits: 12,
    priceUsd: 49.0,
    priceIdr: 779000,
    description: 'Built for frequent viewers and design/film students. Credits never expire.',
    descriptionId: 'Dirancang untuk penikmat film rutin dan pelajar desain. Kredit berlaku selamanya.',
  },
];

export const SAMPLE_REVIEWS: ReviewItem[] = [];
