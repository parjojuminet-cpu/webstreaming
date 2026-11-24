import type {
  ActivityLog,
  Membership,
  PlatformSettings,
  Project,
  Transaction,
  UserAccount,
} from '../types/deloken';

import thumbWoodworking from '../assets/images/deloken_woodworking_workshop_1795504288328.jpg';
import thumbFoodDoc from '../assets/images/deloken_traditional_food_doc_1795504288538.jpg';
import thumbElectrical from '../assets/images/deloken_electrical_repair_1795504290568.jpg';

export const DELOKEN_SCHEMA_VERSION = 1;

export const INITIAL_USERS: UserAccount[] = [
  {
    id: 'usr_viewer_demo',
    name: 'Raka Pratama',
    email: 'raka.viewer@deloken.example',
    role: 'viewer',
    preferredLanguage: 'id',
  },
  {
    id: 'usr_creator_demo',
    name: 'Studio Kayu Nusantara',
    email: 'creator@deloken.example',
    role: 'creator',
    preferredLanguage: 'id',
  },
  {
    id: 'usr_admin_demo',
    name: 'Kurator DELOKEN',
    email: 'parjojuminet@gmail.com',
    role: 'admin',
    preferredLanguage: 'id',
  },
];

export const INITIAL_SETTINGS: PlatformSettings = {
  schemaVersion: DELOKEN_SCHEMA_VERSION,
  membershipPriceIdr: 15000,
  membershipPriceUsd: 2.0,
  previewLimitSeconds: 300,
};

export const INITIAL_PROJECTS: Project[] = [
  {
    id: 'DLK-WOOD-001',
    creatorId: 'usr_creator_demo',
    creatorName: 'Bramantyo Craft Lab',
    title: {
      id: 'Rustic Workshop — Pertukangan Kayu DIY',
      en: 'Rustic Workshop — DIY Woodworking',
    },
    description: {
      id: 'Panduan lengkap teknik sambungan kayu mortise-and-tenon tanpa paku besi, mulai dari pemilihan serat kayu jati bekas hingga finishing minyak tung alami.',
      en: 'Complete hands-on guide to classic mortise-and-tenon joinery without metal fasteners, from reclaiming seasoned hardwood to natural tung oil finishing.',
    },
    category: 'DIY & Crafts',
    pricing: {
      idr: 15000,
      usd: 1.5,
    },
    videoProvider: 'youtube_unlisted',
    videoUrl: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
    videoNote: 'YouTube Unlisted 1080p stream via YouTube IFrame Player API.',
    thumbnailUrl: thumbWoodworking,
    attachments: [
      {
        id: 'att_wood_01',
        name: 'Rustic_Joinery_Blueprint_A3.pdf',
        sizeBytes: 3420160,
        sizeLabel: '3.26 MB',
        mimeType: 'application/pdf',
        sourceType: 'google_drive_restricted',
        url: 'https://drive.google.com/file/d/1DelokenWoodBlueprintExample01/view?usp=sharing',
        note: 'Google Drive Restricted — Requires approved DELOKEN viewer Drive access.',
      },
    ],
    materials: {
      id: [
        '2 batang kayu oak/jati kering (50 x 50 x 800 mm)',
        'Pahat kayu ukuran 12 mm dan 18 mm',
        'Ketam tangan (hand plane) dan palu kayu',
        'Lem kayu PVA tahan air & ampelas grit 120–320',
        'Minyak tung murni 150 ml untuk pelapis akhir',
      ],
      en: [
        '2 seasoned oak or teak stock pieces (50 x 50 x 800 mm)',
        '12 mm and 18 mm bevel-edge wood chisels',
        'Smoothing hand plane and wooden joiner mallet',
        'Water-resistant PVA wood glue & 120–320 grit sandpaper',
        '150 ml pure tung oil for matte protective finish',
      ],
    },
    steps: {
      id: [
        '01. Ratakan empat sisi balok kayu memakai hand plane lalu periksa kesikuan dengan mistar siku.',
        '02. Tandai garis bahu tenon dan lubang mortise menggunakan marking gauge secara presisi.',
        '03. Pahat lubang mortise bertahap sedalam 28 mm sambil rutin membersihkan serutan kayu.',
        '04. Uji sambungan kering (dry-fit), sesuaikan kelonggaran, lalu rekatkan dengan lem PVA.',
        '05. Haluskan sambungan dengan ampelas bertahap hingga grit 320 dan oleskan dua lapis minyak tung.',
      ],
      en: [
        '01. Flatten all four faces using a hand plane and verify 90-degree squareness.',
        '02. Scribe tenon shoulders and mortise walls cleanly with a wheel marking gauge.',
        '03. Chop the 28 mm deep mortise incrementally, clearing waste chips each pass.',
        '04. Perform a dry-fit check, pare cheeks lightly if tight, and clamp with PVA glue.',
        '05. Sand progressively to 320 grit and apply two cured coats of pure tung oil.',
      ],
    },
    duration: '28:40',
    durationSeconds: 1720,
    publicationStatus: 'published',
    createdAt: '2026-10-12T08:30:00.000Z',
    updatedAt: '2026-10-12T08:30:00.000Z',
  },
  {
    id: 'DLK-FOOD-002',
    creatorId: 'usr_creator_food',
    creatorName: 'Arsip Rasa Studio',
    title: {
      id: 'Dokumenter Kuliner Tradisional: Tungku & Rempah',
      en: 'Traditional Food Documentary',
    },
    description: {
      id: 'Film dokumenter lapangan yang merekam teknik memasak gerabah tanah liat, pengasapan bumbu rempah desa, serta pelestarian resep warisan tiga generasi.',
      en: 'Field documentary chronicling terracotta hearth cooking, slow-smoked heritage spice pastes, and three-generation culinary preservation across rural kitchens.',
    },
    category: 'Documentary',
    pricing: {
      idr: 15000,
      usd: 1.5,
    },
    videoProvider: 'archive_org_mp4',
    videoUrl:
      'https://archive.org/download/BigBuckBunny_124/Content/big_buck_bunny_720p_surround.mp4',
    videoNote: 'Archive.org Direct MP4 stream rendered through HTML5 video adapter.',
    thumbnailUrl: thumbFoodDoc,
    attachments: [
      {
        id: 'att_food_02',
        name: 'Field_Recipe_Booklet_Heritage_Kitchen.pdf',
        sizeBytes: 4812800,
        sizeLabel: '4.59 MB',
        mimeType: 'application/pdf',
        sourceType: 'google_drive_restricted',
        url: 'https://drive.google.com/file/d/1DelokenFoodDocArchiveExample02/view?usp=sharing',
        note: 'Google Drive Restricted — Requires Google Drive access permission.',
      },
    ],
    materials: {
      id: [
        'Kuali gerabah tanah liat yang sudah di-seasoning',
        'Bumbu dasar kuning: kunyit tua, kemiri sangrai, lengkuas, serai',
        'Cobek batu vulkanik untuk menggerus rempah utuh',
        'Kayu bakar kering beraroma ringan (rambutan/kopi)',
      ],
      en: [
        'Seasoned unglazed terracotta clay pot',
        'Golden spice base: aged turmeric, toasted candlenut, galangal, lemongrass',
        'Volcanic stone mortar and pestle for cold spice grinding',
        'Dry seasoned fruitwood embers for steady low-smoke heat',
      ],
    },
    steps: {
      id: [
        '01. Hangatkan kuali gerabah perlahan di atas bara api agar pori-pori tanah liat memuai merata.',
        '02. Sangrai rempah kering tanpa minyak sebelum dihaluskan di atas cobek batu.',
        '03. Tumis pasta rempah hingga minyak alaminya keluar dan aroma harum stabil.',
        '04. Tutup kuali dan masak perlahan selama 90 menit dengan pengaturan bara minimal.',
      ],
      en: [
        '01. Pre-warm the clay pot gradually over low embers to avoid thermal shock.',
        '02. Dry-toast whole aromatics before crushing on stone to release essential oils.',
        '03. Gently bloom the spice paste until natural oils separate along the rim.',
        '04. Cover and braise for 90 minutes over steady banked coals.',
      ],
    },
    duration: '42:15',
    durationSeconds: 2535,
    publicationStatus: 'published',
    createdAt: '2026-10-18T10:15:00.000Z',
    updatedAt: '2026-10-18T10:15:00.000Z',
  },
  {
    id: 'DLK-ELEC-003',
    creatorId: 'usr_creator_tech',
    creatorName: 'Bengkel Teknik Mandiri',
    title: {
      id: 'Perbaikan Kelistrikan Bengkel Rumah (Panduan Aman)',
      en: 'Home Workshop Electrical Repair',
    },
    description: {
      id: 'Pelatihan praktis mendiagnosis gangguan MCB/ELCB, membaca nilai multimeter digital, dan menata jalur grounding bengkel rumah sesuai standar keselamatan.',
      en: 'Practical diagnostic training for household MCB/ELCB breaker trips, digital multimeter testing, and safe workshop earthing circuit layout.',
    },
    category: 'Technical & Repair',
    pricing: {
      idr: 15000,
      usd: 1.5,
    },
    videoProvider: 'google_drive',
    videoUrl: 'https://drive.google.com/file/d/1DelokenElectricalSampleVideo03/view',
    videoNote:
      'Google Drive Video embed adapter. Requires file permission set to accessible embed.',
    thumbnailUrl: thumbElectrical,
    attachments: [
      {
        id: 'att_elec_03',
        name: 'Workshop_MCB_Wiring_Schematics_Pack.zip',
        sizeBytes: 6144000,
        sizeLabel: '5.86 MB',
        mimeType: 'application/zip',
        sourceType: 'google_drive_restricted',
        url: 'https://drive.google.com/file/d/1DelokenElectricalSchematics03/view?usp=sharing',
        note: 'Google Drive Restricted — Contains printable wiring schematics & safety checklist.',
      },
    ],
    materials: {
      id: [
        'Multimeter digital True-RMS CAT III 600V',
        'Set obeng terisolasi VDE 1000V & tang pengupas kabel',
        'MCB 10A/16A dan RCD/ELCB 30mA untuk panel uji',
        'Kabel NYM 3x2.5 mm² (Fasa, Netral, Grounding)',
      ],
      en: [
        'True-RMS CAT III 600V digital multimeter',
        'VDE 1000V insulated screwdriver kit and wire stripper',
        '10A/16A MCB breakers and 30mA RCD safety switch',
        '3x2.5 mm² insulated copper cable (Line, Neutral, Earth)',
      ],
    },
    steps: {
      id: [
        '01. Matikan MCB utama dan lakukan verifikasi nol-tegangan memakai multimeter sebelum menyentuh terminal.',
        '02. Identifikasi jalur Fasa (L), Netral (N), dan Grounding (PE) dengan kode warna standar.',
        '03. Pasang RCD 30mA di hulu sirkuit stopkontak bengkel untuk proteksi kebocoran arus.',
        '04. Kencangkan baut terminal dengan torsi merata dan uji tombol Test Trip pada RCD.',
      ],
      en: [
        '01. Isolate the main breaker and prove zero voltage with a calibrated multimeter.',
        '02. Trace Line (L), Neutral (N), and Protective Earth (PE) conductors by standard color code.',
        '03. Wire the 30mA RCD upstream of workshop socket circuits for earth-fault protection.',
        '04. Torque all DIN-rail terminals securely and verify the mechanical RCD test trip.',
      ],
    },
    duration: '34:10',
    durationSeconds: 2050,
    publicationStatus: 'published',
    createdAt: '2026-10-25T14:00:00.000Z',
    updatedAt: '2026-10-25T14:00:00.000Z',
  },
];

export const INITIAL_TRANSACTIONS: Transaction[] = [];
export const INITIAL_MEMBERSHIPS: Membership[] = [];
export const INITIAL_ACTIVITY_LOGS: ActivityLog[] = [
  {
    id: 'log_seed_01',
    actorId: 'usr_admin_demo',
    actorName: 'Kurator DELOKEN',
    action: 'project_published',
    entityId: 'DLK-WOOD-001',
    timestamp: '2026-10-12T08:30:00.000Z',
    details: 'Initial catalog seeded: Rustic Workshop — DIY Woodworking (YouTube Unlisted).',
  },
  {
    id: 'log_seed_02',
    actorId: 'usr_admin_demo',
    actorName: 'Kurator DELOKEN',
    action: 'project_published',
    entityId: 'DLK-FOOD-002',
    timestamp: '2026-10-18T10:15:00.000Z',
    details: 'Initial catalog seeded: Traditional Food Documentary (Archive.org Direct MP4).',
  },
  {
    id: 'log_seed_03',
    actorId: 'usr_admin_demo',
    actorName: 'Kurator DELOKEN',
    action: 'project_published',
    entityId: 'DLK-ELEC-003',
    timestamp: '2026-10-25T14:00:00.000Z',
    details: 'Initial catalog seeded: Home Workshop Electrical Repair (Google Drive Video).',
  },
];
